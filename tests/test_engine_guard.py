"""Canon C2: engine/ and catalogue/ never import Flask."""
import os
import re

from conftest import ROOT


def test_no_flask_in_engine_or_catalogue():
    bad = []
    for pkg in ("engine", "catalogue"):
        for dp, _, fs in os.walk(os.path.join(ROOT, pkg)):
            for f in fs:
                if f.endswith(".py"):
                    src = open(os.path.join(dp, f), encoding="utf-8").read()
                    if re.search(r"^\s*(import|from)\s+(flask|werkzeug)\b", src, re.M):
                        bad.append(os.path.join(dp, f))
    assert not bad, f"Flask imported in stage-B code: {bad}"


def test_no_synthetic_data_generators_in_repo():
    """Canon C1: nothing in the repo fabricates event data."""
    pat = re.compile(r"np\.random\.(normal|uniform|poisson|exponential|randn|rand)\b|synth", re.I)
    hits = []
    for pkg in ("engine", "catalogue", "server"):
        for dp, _, fs in os.walk(os.path.join(ROOT, pkg)):
            for f in fs:
                if f.endswith(".py") and pat.search(open(os.path.join(dp, f), encoding="utf-8").read()):
                    hits.append(os.path.join(dp, f))
    assert not hits, f"possible synthetic-data code: {hits}"
