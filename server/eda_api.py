"""/api/eda -- the EDA sheet (docs/EDA_PLAN_mk1.md). Behind the lock like all /api.

  GET  /api/eda/files        file manifest: names, found, size, column counts (headers only)
  POST /api/eda/run          {"region": "barrel"|"endcap", "smoke": bool} -> job
  GET  /api/eda/<region>     this session's last result for the region
  GET  /api/eda/<region>/feature?col=NAME
                             one column in full for the enlarged view: per-mass
                             histograms, CDFs and KS, descriptive stats, and the
                             MaxEnt ladder with its curves. Synchronous: it reads
                             the loader's frame cache, so it is quick after a run.

The run is a job (Cloudflare cuts a request at 100 s). Results are cached in the
store on (data hash, settings hash, rulings hash, eda version, row limit), so an
identical second run is a file read.
"""
import json
import os

from flask import Blueprint, g, jsonify, request

from engine import eda, loader
from engine.config import REGIONS, resolve, settings_hash
from engine.provenance import code_commit

from .api import P, bad, locations, rulings_hash

bp = Blueprint("eda_api", __name__, url_prefix="/api/eda")


def _result_path(sid, region):
    return os.path.join(P()["ws"].dir(sid), f"eda_{region}.json")


@bp.get("/files")
def files():
    try:
        path, loc = locations()
    except loader.MissingInput as e:
        return bad(str(e), 404, hint=r"start with  .\run_local.ps1 -Data home  (or office, or a path), "
                                     r"or set PFD_LOCATIONS in .env")
    m = eda.file_manifest(loc)
    return jsonify(locations=path, **m)


@bp.post("/run")
def run():
    body = request.get_json(force=True) or {}
    region = body.get("region")
    smoke = bool(body.get("smoke"))
    if region not in REGIONS:
        return bad(f"region must be one of {REGIONS}")
    pfd, sid, who = P(), g.sid, g.who
    if pfd["jobs"].running_for(sid, f"eda:{region}"):
        return bad(f"an EDA {region} run is already queued or running", 409)
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
    out = _result_path(sid, region)

    def work(progress):
        progress(0.0, f"{region}: hashing inputs")
        dh, _ = loader.region_hash(loc, region)
        tag = eda.EDA_VERSION.replace(" ", "_")
        cp = os.path.join(cache_dir, f"eda_{region}_{dh}_{settings_hash(settings)}_"
                                     f"{rulings_hash(rul)}_{tag}_{nrows or 'full'}.json")
        if os.path.isfile(cp):
            progress(0.95, "cache hit: identical data, settings and rulings")
            raw = open(cp, "rb").read()
            res = json.loads(raw)
        else:
            res = eda.run_eda(loc, region, settings=settings, rulings=rul, progress=progress,
                              nrows=nrows, identity=who, code_commit=code_commit())
            res["smoke"] = smoke
            raw = json.dumps(res).encode()
            tmp = cp + ".tmp"
            with open(tmp, "wb") as f:
                f.write(raw)
            os.replace(tmp, cp)
        with open(out, "wb") as f:
            f.write(raw)
        return {"region": region, "n_graphed": res["n_graphed"]}

    j = pfd["jobs"].submit(sid, f"eda:{region}", f"EDA {region}{' (smoke)' if smoke else ''}", work,
                           who=who)
    return jsonify(job=j.public(1))


@bp.get("/<region>")
def result(region):
    if region not in REGIONS:
        return bad(f"region must be one of {REGIONS}")
    p = _result_path(g.sid, region)
    if not os.path.isfile(p):
        return bad(f"no EDA result for {region} in this session yet", 404)
    return jsonify(json.load(open(p)))


@bp.get("/<region>/feature")
def feature(region):
    if region not in REGIONS:
        return bad(f"region must be one of {REGIONS}")
    col = request.args.get("col", "")
    if not col:
        return bad("pass ?col=<column name>")
    try:
        _, loc = locations()
    except loader.MissingInput as e:
        return bad(str(e), 404)
    st = P()["ws"].state(g.sid)
    try:
        d = eda.feature_detail(loc, region, col, settings=resolve(st["settings"]),
                               rulings=st["rulings"].get(region, {}))
    except loader.MissingInput as e:
        return bad(str(e), 404)
    except KeyError as e:
        return bad(str(e).strip("'\""), 404)
    except ValueError as e:
        return bad(str(e), 422)
    return jsonify(d)
