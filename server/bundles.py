"""Session SAVE / LOAD bundles (scope §6). Derived results only (canon C3).

    manifest.json               schema, app, created, regions{data_hash,...}, rulings, settings, ui
    results/gate_<region>.json  byte-for-byte copy of the scratch result
    catalogue/<slug>@<v>.json   the list version the session had active
"""
import io
import json
import os
import zipfile
from datetime import datetime, timezone

from engine.provenance import stamp

APP = "ATLAS_PRE_FILTER_DASH"
SCHEMA_VERSION = 2


class BundleError(Exception):
    pass


def build(ws, sid, catalogue, who=None):
    st = ws.state(sid)
    mem = io.BytesIO()
    regions = {}
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        for region, meta in st["results"].items():
            p = ws.result_path(sid, region)
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    z.writestr(f"results/gate_{region}.json", f.read())
                regions[region] = meta
        for region in st.get("crossblock", {}):
            p = os.path.join(ws.dir(sid), f"crossblock_{region}.json")
            if os.path.isfile(p):
                with open(p, "rb") as f:
                    z.writestr(f"results/crossblock_{region}.json", f.read())
        al = st.get("active_list")
        if al:
            v = catalogue.version(al["slug"], al["version"])
            z.writestr(f"catalogue/{al['slug']}@{al['version']}.json", json.dumps(v, indent=1))
        manifest = {"schema_version": SCHEMA_VERSION, "app": APP,
                    "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "regions": regions, "crossblock": st.get("crossblock", {}),
                    "rulings": st["rulings"], "settings": st["settings"],
                    "ui": st["ui"], "active_list": al, "saved_by": who, **stamp()}
        z.writestr("manifest.json", json.dumps(manifest, indent=1))
    return mem.getvalue(), manifest


def load(ws, sid, data, catalogue):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise BundleError("not a session bundle (not a zip file)")
    names = set(z.namelist())
    if "manifest.json" not in names:
        raise BundleError("not a session bundle (no manifest.json)")
    m = json.loads(z.read("manifest.json"))
    if m.get("app") != APP:
        raise BundleError(f"bundle is from '{m.get('app')}', not {APP}")
    if m.get("schema_version") != SCHEMA_VERSION:
        raise BundleError(f"bundle schema {m.get('schema_version')} is not supported "
                          f"(this build reads schema {SCHEMA_VERSION})")
    # validate everything before writing anything: never half-load
    results = {}
    for region in m.get("regions", {}):
        key = f"results/gate_{region}.json"
        if key not in names:
            raise BundleError(f"manifest lists {region} but {key} is missing")
        raw = z.read(key)
        r = json.loads(raw)
        if r.get("kind") != "gate" or r.get("region") != region:
            raise BundleError(f"{key} is not a gate result for {region}")
        results[region] = raw
    cbs = {}
    for region in m.get("crossblock", {}):
        key = f"results/crossblock_{region}.json"
        if key not in names:
            raise BundleError(f"manifest lists S14.5 {region} but {key} is missing")
        cbs[region] = z.read(key)
    cat_entries = [n for n in names if n.startswith("catalogue/")]
    ws.discard(sid)
    for region, raw in results.items():
        with open(ws.result_path(sid, region), "wb") as f:
            f.write(raw)
    for region, raw in cbs.items():
        with open(os.path.join(ws.dir(sid), f"crossblock_{region}.json"), "wb") as f:
            f.write(raw)
    restored = []
    for n in cat_entries:
        v = json.loads(z.read(n))
        slug = n.split("/", 1)[1].rsplit("@", 1)[0]
        if catalogue.restore_version(slug, v):
            restored.append(f"{slug}@{v['version']}")
    st = ws.state(sid)
    st.update({"results": m["regions"], "crossblock": m.get("crossblock", {}),
               "rulings": m.get("rulings", {}),
               "settings": m.get("settings", {}), "ui": m.get("ui", {}),
               "active_list": m.get("active_list"), "dirty": False,
               "loaded_bundle": m.get("created")})
    ws.save_state(sid, st)
    return m, restored
