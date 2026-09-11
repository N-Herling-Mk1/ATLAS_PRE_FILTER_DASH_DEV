"""Real-data tests (canon C1: there is no other kind). They skip, by name, when
no locations file is configured: run_tests.ps1 -Data home|office|<path>."""
import io
import json
import os
import time

import pytest

from conftest import make_app, needs_data, real_locations

pytestmark = needs_data


@pytest.fixture(scope="module")
def loc():
    from engine import loader
    return loader.parse_locations(real_locations())


def _regions(loc):
    import os as _o
    from engine import loader
    return [r for r in ("barrel", "endcap")
            if all(_o.path.isfile(loc.get(k, "")) for k in loader.region_keys(r))]


def test_smoke_gate_and_canaries(loc):
    from engine import canaries
    from engine.gate import run_gate
    regs = _regions(loc)
    assert regs, "no region has all five files"
    for r in regs:
        res = run_gate(loc, r, nrows=2000)
        assert res["columns"], r
        fails = [c for c in canaries.evaluate(res) if c["status"] == "FAIL"]
        # smoke rows can hide a constant; FAIL is only asserted on full runs below
        json.dumps(res)                              # JSON-safe end to end
        assert set(res["counts"]) == {"bkg", "mS5", "mS16", "mS35", "mS55"}


def test_full_gate_canaries(loc):
    from engine import canaries
    from engine.gate import run_gate
    for r in _regions(loc):
        res = run_gate(loc, r)
        fails = [c for c in canaries.evaluate(res) if c["status"] == "FAIL"]
        assert not fails, fails


def _login(c, pw):
    assert c.post("/login", data={"password": pw, "who": "tester"}).status_code == 302


def _wait(c, jid):
    for _ in range(3000):
        j = c.get(f"/api/jobs/{jid}").get_json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_bundle_round_trip_and_stale(tmp_path):
    app, pw = make_app(tmp_path / "store", PFD_LOCATIONS=real_locations())
    a = app.test_client()
    _login(a, pw)
    from engine import loader
    region = _regions(loader.parse_locations(real_locations()))[0]
    j = a.post("/api/gate/run", json={"region": region, "smoke": True}).get_json()["job"]
    assert _wait(a, j["id"])["status"] == "done"
    ws = app.extensions["pfd"]["ws"]
    with a.session_transaction() as s:
        sid_a = s["sid"]
    before = open(ws.result_path(sid_a, region), "rb").read()
    bundle = a.get("/api/session/save").data

    b = app.test_client()
    _login(b, pw)
    r = b.post("/api/session/load", data={"bundle": (io.BytesIO(bundle), "s.pfd.zip")},
               content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    with b.session_transaction() as s:
        sid_b = s["sid"]
    assert open(ws.result_path(sid_b, region), "rb").read() == before, "round trip must be byte-for-byte"

    # a bundle whose data hash does not match the current files reads as STALE
    st = ws.state(sid_b)
    st["results"][region]["data_hash"] = "0" * 16
    ws.save_state(sid_b, st)
    assert b.get("/api/state").get_json()["regions"][region]["data_state"] == "STALE"


def test_catalogue_with_real_lists(tmp_path, loc):
    for k in ("NN_KJ_NN1", "NN_KJ_NN2"):
        if not os.path.isfile(loc.get(k, "")):
            pytest.skip(f"{k} not in the locations file")
    app, pw = make_app(tmp_path / "store", PFD_LOCATIONS=real_locations())
    c = app.test_client()
    _login(c, pw)
    files = {"nn1": (open(loc["NN_KJ_NN1"], "rb"), "nn1.csv"), "nn2": (open(loc["NN_KJ_NN2"], "rb"), "nn2.csv")}
    parsed = c.post("/api/catalogue/parse_csv", data=files, content_type="multipart/form-data").get_json()
    assert "content" in parsed, parsed
    v1 = c.post("/api/catalogue/commit", json={"name": "kj_Jul_26", "content": parsed["content"],
                                               "note": "KJ July sheet", "create": True}).get_json()
    slug, head = v1["slug"], v1["version"]
    vfile = os.path.join(tmp_path, "store", "catalogue", slug, "versions", f"{head}.json")
    frozen = open(vfile, "rb").read()
    feat = next(f for r in ("barrel", "endcap") for f in parsed["content"][r]["NN1"])
    reg = next(r for r in ("barrel", "endcap") if feat in parsed["content"][r]["NN1"])
    ops = [{"op": "move", "region": reg, "net": "NN1", "feature": feat, "to_net": "NN2"}]
    v2 = c.post(f"/api/catalogue/{slug}/edit", json={"base": head, "ops": ops, "note": "move"}).get_json()
    assert v2["changed"]
    stale = c.post(f"/api/catalogue/{slug}/edit", json={"base": head, "ops": ops, "note": "again"})
    assert stale.status_code == 409, "an edit against a stale head must be rejected"
    assert open(vfile, "rb").read() == frozen, "versions are immutable"
    z = c.get(f"/api/catalogue/{slug}/{v2['version']}/export").data
    import zipfile
    zf = zipfile.ZipFile(io.BytesIO(z))
    n1 = [n for n in zf.namelist() if n.endswith("_NN1.csv")][0]
    n2 = [n for n in zf.namelist() if n.endswith("_NN2.csv")][0]
    back = c.post("/api/catalogue/parse_csv", data={"nn1": (io.BytesIO(zf.read(n1)), "a.csv"),
                                                    "nn2": (io.BytesIO(zf.read(n2)), "b.csv")},
                  content_type="multipart/form-data").get_json()["content"]
    now = c.get(f"/api/catalogue/{slug}").get_json()["version"]["content"]
    assert back == now, "export -> re-import must be identical"
