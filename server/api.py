"""/api -- every route here sits behind the lock in app.py."""
import hashlib
import json
import os
import time
from datetime import datetime

from flask import Blueprint, current_app, g, jsonify, request, send_file, session
import io

from catalogue import parsers
from catalogue import store as cstore
from catalogue.export import export_zip
from engine import canaries, loader, reference
from engine.config import REGIONS, resolve, settings_hash
from engine.gate import run_gate
from engine.crossblock import run_crossblock
from engine import transforms
from engine.provenance import code_commit, stamp

from . import notifier
from engine.scans import NOT_BUILT

from . import bundles

bp = Blueprint("api", __name__, url_prefix="/api")


def P():
    return current_app.extensions["pfd"]


def bad(msg, code=400, **extra):
    return jsonify(error=msg, code=code, **extra), code


def rulings_hash(r):
    return hashlib.sha256(json.dumps(r or {}, sort_keys=True).encode()).hexdigest()[:12]


# ---------------------------------------------------------------- locations --
def locations():
    """-> (path, loc dict) or raises loader.MissingInput."""
    cfg = P()["cfg"]
    path = loader.resolve_locations(explicit=cfg.locations or None)
    return path, loader.parse_locations(path)


def _cur_hash(loc, region):
    try:
        return loader.region_hash(loc, region)[0]
    except loader.MissingInput:
        return None


def _ref_path(region, dh, sh, rh):
    d = os.path.join(P()["cfg"].store_dir, "reference")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{region}_{dh}_{sh}_{rh}.json")


_cmp_memo = {}


def _compare_memo(rp, sid, region, result):
    """reference.compare is cached on (reference file, result file mtime)."""
    res_path = P()["ws"].result_path(sid, region)
    key = (rp, res_path, os.path.getmtime(res_path) if os.path.isfile(res_path) else None)
    if key not in _cmp_memo:
        if result is None:
            result = json.load(open(res_path))
        if len(_cmp_memo) > 64:
            _cmp_memo.clear()
        _cmp_memo[key] = reference.compare(json.load(open(rp)), result)
    return _cmp_memo[key]


def region_status(st, region, result=None, loc=None):
    meta = st["results"].get(region)
    if not meta:
        return None
    out = dict(meta)
    if loc is None:
        try:
            _, loc = locations()
        except loader.MissingInput:
            loc = {}
    cur = _cur_hash(loc, region)
    out["data_state"] = ("DATA_MISSING" if cur is None else
                         "STALE" if cur != meta["data_hash"] else "CURRENT")
    out["rulings_changed"] = rulings_hash(st["rulings"].get(region)) != meta.get("rulings_hash")
    if meta.get("smoke"):
        out["reference"] = {"status": "SMOKE", "detail": "smoke runs cannot be signed off"}
    else:
        rp = _ref_path(region, meta["data_hash"], meta["settings_hash"], meta.get("rulings_hash"))
        if not os.path.isfile(rp):
            out["reference"] = {"status": "UNVERIFIED"}
        else:
            diffs = _compare_memo(rp, g.sid, region, result)
            out["reference"] = {"status": "REGRESSION" if diffs else "VERIFIED",
                                "n_diffs": len(diffs), "diffs": diffs[:200]}
    return out


# ------------------------------------------------------------------ session --
@bp.get("/whoami")
def whoami():
    cfg = P()["cfg"]
    left = cfg.idle_hours * 3600 - (time.time() - float(session.get("t", 0)))
    return jsonify(mode=cfg.mode, idle_hours=cfg.idle_hours, expires_in_s=int(left),
                   sid=g.sid[:6], who=g.who, weak_password=cfg.password_weak, **stamp(),
                   s9_source=transforms.source(), notifier=notifier.status())


@bp.post("/session/name")
def session_name():
    """Optional attribution tag for this session's runs, list versions and bundles
    (scan layer §16.1). Not authentication; sign-in is password only."""
    from .app import clean_identity
    name = clean_identity((request.get_json(force=True) or {}).get("name", ""))
    session["who"] = name or None
    return jsonify(who=name or "unnamed")


@bp.post("/notify/test")
def notify_test():
    return jsonify(notifier.test_alert(g.who))


@bp.post("/ping")
def ping():
    return jsonify(ok=True)


@bp.get("/state")
def state():
    st = P()["ws"].state(g.sid)
    try:
        lpath, loc = locations()
        lerr = None
    except loader.MissingInput as e:
        lpath, loc, lerr = None, {}, str(e)
    regions = {}
    for r in REGIONS:
        if r in st["results"]:
            try:
                regions[r] = region_status(st, r, loc=loc)
            except FileNotFoundError:
                regions[r] = None
    return jsonify(locations=lpath, locations_error=lerr, regions=regions, dirty=st["dirty"],
                   crossblock=st.get("crossblock", {}),
                   last_saved=st["last_saved"], loaded_bundle=st["loaded_bundle"],
                   active_list=st["active_list"], ui=st["ui"], mode=P()["cfg"].mode)


@bp.post("/session/ui")
def set_ui():
    body = request.get_json(force=True) or {}
    P()["ws"].mutate(g.sid, lambda st: st["ui"].update(body), dirty=False)
    return jsonify(ok=True)


@bp.get("/inventory")
def inventory():
    try:
        path, loc = locations()
    except loader.MissingInput as e:
        return bad(str(e), 404, hint=r"start with  .\run_local.ps1 -Data home  (or office, or a path), or set PFD_LOCATIONS in .env")
    return jsonify(locations=path, rows=loader.check_inventory(loc))


# --------------------------------------------------------------------- jobs --
@bp.get("/jobs")
def jobs():
    return jsonify(jobs=P()["jobs"].for_session(g.sid), workers=P()["jobs"].workers)


@bp.get("/jobs/<jid>")
def job(jid):
    j = P()["jobs"].get(g.sid, jid)
    return jsonify(j) if j else bad("no such job for this session", 404)


# --------------------------------------------------------------------- gate --
@bp.post("/gate/run")
def gate_run():
    body = request.get_json(force=True) or {}
    region = body.get("region")
    smoke = bool(body.get("smoke"))
    if region not in REGIONS:
        return bad(f"region must be one of {REGIONS}")
    pfd, sid, who = P(), g.sid, g.who
    if pfd["jobs"].running_for(sid, f"gate:{region}"):
        return bad(f"a {region} gate run is already queued or running", 409)
    try:
        _, loc = locations()
    except loader.MissingInput as e:
        return bad(str(e), 404)
    st = pfd["ws"].state(sid)
    rul = st["rulings"].get(region, {})
    settings = resolve(st["settings"])
    nrows = 2000 if smoke else None
    cache_dir = os.path.join(pfd["cfg"].store_dir, "cache")
    os.makedirs(cache_dir, exist_ok=True)

    def work(progress):
        progress(0.0, "hashing inputs")
        dh, _ = loader.region_hash(loc, region)
        sh, rh = settings_hash(settings), rulings_hash(rul)
        ts = transforms.source()
        tk = "llp" if ts["kind"] == "llp" else "ref"
        cp = os.path.join(cache_dir, f"gate_{region}_{dh}_{sh}_{rh}_{tk}_{nrows or 'full'}.json")
        hit = os.path.isfile(cp)
        if hit:
            progress(0.9, "cache hit: identical data, settings and rulings")
            raw = open(cp, "rb").read()
            res = json.loads(raw)
        else:
            res = run_gate(loc, region, settings=settings, rulings=rul, progress=progress,
                           nrows=nrows, identity=who, code_commit=code_commit())
            raw = json.dumps(res).encode()
            tmp = cp + ".tmp"
            with open(tmp, "wb") as f:
                f.write(raw)
            os.replace(tmp, cp)
        with open(pfd["ws"].result_path(sid, region), "wb") as f:
            f.write(raw)
        meta = {"data_hash": res["data_hash"], "settings_hash": res["settings_hash"],
                "rulings_hash": rh, "counts": res["counts"], "generated": res["generated"],
                "smoke": smoke, "cache_hit": hit, "tally": res["tally"],
                "identity": res.get("identity"), "code_commit": res.get("code_commit"),
                "s9_source": (res.get("s9_source") or {}).get("kind")}
        pfd["ws"].mutate(sid, lambda s: s["results"].__setitem__(region, meta))
        return meta

    j = pfd["jobs"].submit(sid, f"gate:{region}", f"gate {region}{' (smoke)' if smoke else ''}", work,
                           who=who)
    return jsonify(job=j.public(1))


def _load_result(region):
    p = P()["ws"].result_path(g.sid, region)
    if not os.path.isfile(p):
        return None
    return json.load(open(p))


def _membership(region):
    st = P()["ws"].state(g.sid)
    al = st.get("active_list")
    if not al:
        return None, {}
    try:
        v = P()["catalogue"].version(al["slug"], al["version"])
    except cstore.NotFound:
        return al, {}
    m = {}
    for net in parsers.NETS:
        for f in v["content"][region][net]:
            m[f] = net
    return al, m


@bp.get("/gate/<region>")
def gate_summary(region):
    if region not in REGIONS:
        return bad("unknown region", 404)
    res = _load_result(region)
    if res is None:
        return bad(f"no {region} result in this session; run the gate first", 404)
    st = P()["ws"].state(g.sid)
    al, mem = _membership(region)
    rows = []
    for c, r in res["columns"].items():
        s3 = r["s3"]
        rows.append({
            "name": c, "verdict": r["verdict"]["verdict"],
            "reasons": [f"{x['gate']}: {x['why']}" for x in r["verdict"]["reasons"]],
            "notes": r["verdict"]["notes"],
            "type": r["s1"].get("type"),
            "s2": r["s2"].get("class"), "s2_worst": r["s2"].get("worst_invalid_frac"),
            "s2_pending": len(r["s2"].get("candidate_values", [])),
            "s3": ("empty" if s3.get("empty") else "constant" if s3.get("constant") else
                   "near-constant" if s3.get("near_constant") else
                   f"constant in {s3['constant_in']}" if s3.get("constant_in") else "ok"),
            "s4": r["s4"].get("n_unique"), "s4_low": r["s4"].get("low_card"),
            "s5": r["s5"].get("fired"),
            "s13_sep": r["s13"].get("value_sep"), "s13_nan": r["s13"].get("nan_sep"),
            "s13_leak": r["s13"].get("leak"), "s13_prov": r["s13"].get("provenance_flag"),
            "s13_mass_z": ((r["s13"].get("mass_mi") or {}).get("z")),
            "s13_mass_flag": bool((r["s13"].get("mass_mi") or {}).get("flag")),
            "s9_pinned": ((r.get("s9") or {}).get("scalers") or {}).get((r.get("s9") or {}).get("pinned"), {}).get("realised_frac"),
            "s9_flag": bool((r.get("s9") or {}).get("pinned_flag")),
            "s9_others": [m for m, x in (((r.get("s9") or {}).get("scalers")) or {}).items() if x.get("flag")],
            "s9_limited": bool((r.get("s9") or {}).get("column_limited")),
            "net": mem.get(c),
        })
    in_list_missing = sorted(f for f in mem if f not in res["columns"])
    return jsonify(region=region, generated=res["generated"], counts=res["counts"],
                   identity=res.get("identity"), code_commit=res.get("code_commit"),
                   engine=res.get("engine"), s9_source=res.get("s9_source"),
                   admin_present=res.get("admin_columns_present", []),
                   pileup_present=res.get("pileup_columns_present", []),
                   crossblock=_crossblock_meta(region),
                   schema=res.get("schema"),
                   tally=res["tally"], data_hash=res["data_hash"], settings=res["settings"],
                   nrows_limit=res["nrows_limit"], rows=rows,
                   canaries=canaries.evaluate(res), not_built=NOT_BUILT,
                   status=region_status(st, region, result=res), active_list=al,
                   list_missing_in_data=in_list_missing)


@bp.get("/gate/<region>/column")
def gate_column(region):
    res = _load_result(region)
    if res is None:
        return bad(f"no {region} result in this session", 404)
    name = request.args.get("name", "")
    r = res["columns"].get(name)
    if r is None:
        return bad(f"no column '{name}' in the {region} result", 404)
    _, mem = _membership(region)
    st = P()["ws"].state(g.sid)
    return jsonify(region=region, name=name, result=r, net=mem.get(name),
                   samples=list(res["counts"].keys()), counts=res["counts"],
                   rulings=st["rulings"].get(region, {}).get(name, {}),
                   columns=list(res["columns"].keys()),
                   status=region_status(st, region, result=res))


@bp.post("/gate/<region>/ruling")
def gate_ruling(region):
    body = request.get_json(force=True) or {}
    col, ruling = body.get("column"), body.get("ruling")
    try:
        value = float(body.get("value"))
    except (TypeError, ValueError):
        return bad("value must be a number")
    if ruling not in ("sentinel", "genuine", "clear"):
        return bad("ruling must be sentinel, genuine or clear")

    def fn(st):
        rr = st["rulings"].setdefault(region, {}).setdefault(col, {"sentinel": [], "genuine": []})
        rr["sentinel"] = [v for v in rr.get("sentinel", []) if v != value]
        rr["genuine"] = [v for v in rr.get("genuine", []) if v != value]
        if ruling != "clear":
            rr[ruling].append(value)
        if not rr["sentinel"] and not rr["genuine"]:
            st["rulings"][region].pop(col, None)

    st = P()["ws"].mutate(g.sid, fn)
    return jsonify(rulings=st["rulings"].get(region, {}).get(col, {}),
                   note="re-run the gate to apply rulings")


@bp.post("/reference/<region>/signoff")
def signoff(region):
    st = P()["ws"].state(g.sid)
    res = _load_result(region)
    if res is None:
        return bad("nothing to sign off", 404)
    s = region_status(st, region, result=res)
    if res.get("nrows_limit"):
        return bad("smoke runs cannot be signed off; run the full gate")
    if s["data_state"] != "CURRENT":
        return bad(f"result is {s['data_state']}; re-run on the current data first")
    if s["rulings_changed"]:
        return bad("rulings changed since this run; re-run the gate first")
    rp = _ref_path(region, res["data_hash"], res["settings_hash"], rulings_hash(res["rulings"]))
    if os.path.isfile(rp):
        return bad("a reference already exists for this data, settings and rulings", 409)
    d = reference.digest(res)
    d["signed_off"] = datetime.now().isoformat(timespec="seconds")
    with open(rp, "w") as f:
        json.dump(d, f, indent=1)
    return jsonify(ok=True, reference=os.path.basename(rp))


# ---------------------------------------------------------------- catalogue --
def _data_columns():
    try:
        _, loc = locations()
    except loader.MissingInput:
        return {r: None for r in REGIONS}
    out = {}
    for r in REGIONS:
        try:
            out[r] = loader.region_columns(loc, r)
        except loader.MissingInput:
            out[r] = None
    return out


@bp.get("/catalogue")
def cat_lists():
    return jsonify(lists=P()["catalogue"].lists())


@bp.post("/catalogue/parse_csv")
def cat_parse_csv():
    region = request.form.get("region") or None
    content = parsers.empty_content()
    got = False
    try:
        for net in parsers.NETS:
            f = request.files.get(net.lower())
            if f and f.filename:
                got = True
                for r, feats in parsers.parse_csv(f.read(), region).items():
                    content[r][net] = feats
    except parsers.ParseError as e:
        return bad(str(e))
    if not got:
        return bad("attach an NN1 and/or NN2 CSV")
    return jsonify(content=content, missing_in_data=cstore.validate(content, _data_columns()))


@bp.post("/catalogue/discover_py")
def cat_discover_py():
    f = request.files.get("file")
    if not f or not f.filename:
        return bad("attach a .py file")
    try:
        return jsonify(found=parsers.discover_py(f.read()))
    except parsers.ParseError as e:
        return bad(str(e))


@bp.post("/catalogue/validate")
def cat_validate():
    content = cstore.normalise((request.get_json(force=True) or {}).get("content", {}))
    return jsonify(missing_in_data=cstore.validate(content, _data_columns()))


@bp.post("/catalogue/commit")
def cat_commit():
    b = request.get_json(force=True) or {}
    try:
        v, changed = P()["catalogue"].commit(b.get("name", ""), b.get("content", {}),
                                             b.get("note", ""), base=b.get("base"),
                                             create=bool(b.get("create")), author=g.who)
    except cstore.StaleHead as e:
        return bad(str(e), 409)
    except (ValueError, cstore.NotFound) as e:
        return bad(str(e))
    return jsonify(version=v["version"], changed=changed,
                   slug=cstore.Catalogue.slug(b.get("name", "")))


@bp.get("/catalogue/<slug>")
def cat_get(slug):
    cat = P()["catalogue"]
    try:
        v = cat.version(slug, request.args.get("v") or cat.head(slug))
        hist = cat.history(slug)
        head = cat.head(slug)
    except cstore.NotFound as e:
        return bad(str(e), 404)
    return jsonify(slug=slug, head=head, version=v, history=hist,
                   missing_in_data=cstore.validate(v["content"], _data_columns()))


@bp.post("/catalogue/<slug>/edit")
def cat_edit(slug):
    b = request.get_json(force=True) or {}
    cat = P()["catalogue"]
    try:
        base = b.get("base")
        cur = cat.version(slug, base)
        new = cstore.apply_ops(cur["content"], b.get("ops", []))
        v, changed = cat.commit(slug, new, b.get("note", ""), base=base, author=g.who)
    except cstore.StaleHead as e:
        return bad(str(e), 409)
    except (ValueError, cstore.NotFound) as e:
        return bad(str(e))
    return jsonify(version=v["version"], changed=changed)


@bp.get("/catalogue_diff")
def cat_diff():
    cat = P()["catalogue"]
    try:
        sa, va = request.args["a"].split("@")
        sb, vb = request.args["b"].split("@")
        a, b = cat.version(sa, va)["content"], cat.version(sb, vb)["content"]
    except (KeyError, ValueError):
        return bad("use ?a=<slug>@<version>&b=<slug>@<version>")
    except cstore.NotFound as e:
        return bad(str(e), 404)
    return jsonify(diff=cstore.diff(a, b))


@bp.get("/catalogue/<slug>/<v>/export")
def cat_export(slug, v):
    try:
        ver = P()["catalogue"].version(slug, v)
    except cstore.NotFound as e:
        return bad(str(e), 404)
    return send_file(io.BytesIO(export_zip(slug, ver)), mimetype="application/zip",
                     as_attachment=True, download_name=f"{slug}_{v}.zip")


@bp.get("/catalogue_matrix")
def cat_matrix():
    cat = P()["catalogue"]
    want = [x for x in (request.args.get("lists") or "").split(",") if x]
    entries = []
    try:
        if want:
            for w in want:
                sl, v = w.split("@")
                entries.append((w, cat.version(sl, v)["content"]))
        else:
            for l in cat.lists():
                entries.append((f"{l['slug']}@{l['head']}", cat.version(l["slug"], l["head"])["content"]))
    except (ValueError, cstore.NotFound) as e:
        return bad(str(e))
    return jsonify(cstore.matrix(entries))


def _cb_path(region):
    return os.path.join(P()["ws"].dir(g.sid), f"crossblock_{region}.json")


def _crossblock_meta(region):
    p = _cb_path(region)
    if not os.path.isfile(p):
        return None
    r = json.load(open(p))
    return {k: r.get(k) for k in ("dcor_mean", "dcor_sd", "null_mean", "null_sd", "z", "n_used",
                                  "subsample", "repeats", "perms", "list", "overlap", "missing_nn1",
                                  "missing_nn2", "data_hash", "generated", "identity")}


@bp.post("/crossblock/run")
def crossblock_run():
    region = (request.get_json(force=True) or {}).get("region")
    if region not in REGIONS:
        return bad(f"region must be one of {REGIONS}")
    pfd, sid, who = P(), g.sid, g.who
    st = pfd["ws"].state(sid)
    al = st.get("active_list")
    if not al:
        return bad("pick an active list on the Catalogue page first: S14.5 needs an NN1 and an NN2 set")
    content = pfd["catalogue"].version(al["slug"], al["version"])["content"][region]
    if pfd["jobs"].running_for(sid, f"crossblock:{region}"):
        return bad(f"an S14.5 {region} run is already queued or running", 409)
    try:
        _, loc = locations()
    except loader.MissingInput as e:
        return bad(str(e), 404)
    settings = resolve(st["settings"])
    out_path = os.path.join(pfd["ws"].dir(sid), f"crossblock_{region}.json")

    def work(progress):
        r = run_crossblock(loc, region, content["NN1"], content["NN2"], settings=settings,
                           progress=progress)
        r.update(list=f"{al['slug']}@{al['version']}", identity=who,
                 generated=datetime.now().isoformat(timespec="seconds"), **stamp())
        with open(out_path, "w") as f:
            json.dump(r, f)
        pfd["ws"].mutate(sid, lambda s: s.setdefault("crossblock", {}).__setitem__(
            region, {"list": r["list"], "data_hash": r["data_hash"], "dcor_mean": r["dcor_mean"],
                     "z": r["z"]}))
        return {"dcor_mean": r["dcor_mean"]}

    j = pfd["jobs"].submit(sid, f"crossblock:{region}", f"S14.5 cross-block dCor {region}", work, who=who)
    return jsonify(job=j.public(1))


@bp.get("/crossblock/<region>")
def crossblock_get(region):
    p = _cb_path(region)
    if not os.path.isfile(p):
        return bad(f"no S14.5 result for {region} in this session", 404)
    return jsonify(json.load(open(p)))


@bp.post("/session/active_list")
def active_list():
    b = request.get_json(force=True) or {}
    slug = b.get("slug")
    if not slug:
        P()["ws"].mutate(g.sid, lambda st: st.__setitem__("active_list", None))
        return jsonify(active_list=None)
    try:
        v = b.get("version") or P()["catalogue"].head(slug)
        P()["catalogue"].version(slug, v)
    except cstore.NotFound as e:
        return bad(str(e), 404)
    al = {"slug": slug, "version": v}
    P()["ws"].mutate(g.sid, lambda st: st.__setitem__("active_list", al))
    return jsonify(active_list=al)


# ----------------------------------------------------------------- bundles --
@bp.get("/session/save")
def session_save():
    ws = P()["ws"]
    data, m = bundles.build(ws, g.sid, P()["catalogue"], who=g.who)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ws.mutate(g.sid, lambda st: st.update(dirty=False, last_saved=m["created"]), dirty=False)
    return send_file(io.BytesIO(data), mimetype="application/zip", as_attachment=True,
                     download_name=f"pfd_session_{stamp}.pfd.zip")


@bp.post("/session/load")
def session_load():
    f = request.files.get("bundle")
    if not f or not f.filename:
        return bad("attach a .pfd.zip bundle")
    try:
        m, restored = bundles.load(P()["ws"], g.sid, f.read(), P()["catalogue"])
    except (bundles.BundleError, ValueError) as e:
        return bad(str(e))
    return jsonify(ok=True, created=m["created"], regions=list(m["regions"]),
                   restored_versions=restored)
