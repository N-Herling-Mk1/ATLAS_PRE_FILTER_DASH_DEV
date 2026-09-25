"""EDA sheet (mk45). Route tests need no data; the engine tests run on real data
only (canon C1) and skip, by name, without it."""
import json
import math

import pytest

from conftest import make_app, needs_data, real_locations


def _client(tmp_path):
    app, pw = make_app(tmp_path / "store")
    c = app.test_client()
    assert c.post("/login", data={"password": pw}).status_code == 302
    return c


def test_eda_routes_locked(app_pw):
    app, _ = app_pw
    c = app.test_client()
    assert c.get("/api/eda/files").status_code == 401
    assert c.post("/api/eda/run", json={"region": "barrel"}).status_code == 401


def test_eda_bad_region_and_empty_result(tmp_path):
    c = _client(tmp_path)
    assert c.post("/api/eda/run", json={"region": "forward"}).status_code == 400
    r = c.get("/api/eda/barrel")
    assert r.status_code == 404 and "no EDA result" in r.get_json()["error"]


def test_hub_renders_eda_sheet(tmp_path):
    c = _client(tmp_path)
    html = c.get("/").get_data(as_text=True)
    assert 'id="eda-go"' in html and "/static/app/js/eda.js" in html and "eda.css" in html


@needs_data
def test_eda_real_smoke():
    from engine import eda, loader
    loc = loader.parse_locations(real_locations())
    m = eda.file_manifest(loc)
    assert m["files"] and all(("n_columns" in f) for f in m["files"])
    regs = [r for r in ("barrel", "endcap")
            if all(__import__("os").path.isfile(loc.get(k, "")) for k in loader.region_keys(r))]
    assert regs, "no region has all five files"
    res = eda.run_eda(loc, regs[0], nrows=2000)
    json.dumps(res)                                           # JSON-safe end to end
    assert res["n_graphed"] > 0
    for c in res["columns"]:
        for k in ("sig", "bkg"):
            s = c["stats"][k]
            if s["var"] is not None:
                assert s["var"] >= 0 and math.isclose(s["std"] ** 2, s["var"], rel_tol=1e-9)
        g = c["gauss_ref"]                                    # mk46: renamed from "maxent"
        if g["DB_hist"] is not None:
            assert g["DB_hist"] >= 0
        if g.get("moment_share") is not None:
            assert not g["share_at_noise"]


def test_feature_route_validates(tmp_path):
    c = _client(tmp_path)
    assert c.get("/api/eda/forward/feature?col=x").status_code == 400
    assert c.get("/api/eda/barrel/feature").status_code == 400


@needs_data
def test_maxent_real():
    """mk46: every graphed column carries a MaxEnt case; fitted columns carry a
    ladder on identical rows per class, and the detail view adds curves."""
    import os
    from engine import eda, loader
    loc = loader.parse_locations(real_locations())
    regs = [r for r in ("barrel", "endcap")
            if all(os.path.isfile(loc.get(k, "")) for k in loader.region_keys(r))]
    res = eda.run_eda(loc, regs[0], nrows=2000)
    fitted = None
    for col in res["columns"]:
        me = col["maxent"]
        assert me["case"]["case"] in ("binary", "lattice", "real", "positive", "unit", "unsupported", "error")
        assert me["case"]["case"] != "error", me["case"]["label"]
        for tag in ("sig", "bkg"):
            rows = me.get("classes", {}).get(tag, {}).get("rungs", [])
            if rows:
                assert min(r["d_bic"] for r in rows) == 0.0
                # rule 1: same rows for every rung -> BIC - AIC = k (ln n - 2) exactly
                n = me["classes"][tag]["n"]
                for r in rows:
                    assert math.isclose(r["bic"] - r["aic"], r["k"] * (math.log(n) - 2), abs_tol=1e-6)
                fitted = fitted or col["column"]
    assert fitted, "no column was fitted"
    d = eda.feature_detail(loc, regs[0], fitted)
    json.dumps(d)
    assert d["maxent"].get("curves", {}).get("rungs")
    assert 0.0 <= d["cdf"]["ks"] <= 1.0
