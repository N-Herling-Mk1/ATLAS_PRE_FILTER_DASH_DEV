"""Export a list version as NN1/NN2 CSVs in the July convention (barrel,endcap
header), zipped with a manifest. The version hash is in every filename and in
the manifest, so a pipeline log can name exactly which version it read.
.py export is deferred until the nn_features_mk3_v3.py layout is pinned.
"""
import csv
import io
import json
import zipfile

from .parsers import NETS, REGIONS


def _csv_for(content, net):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(REGIONS)
    cols = [content[r][net] for r in REGIONS]
    for i in range(max((len(c) for c in cols), default=0)):
        w.writerow([c[i] if i < len(c) else "" for c in cols])
    return buf.getvalue()


def export_zip(slug, version):
    v = version["version"]
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        for n in NETS:
            z.writestr(f"{slug}_{v}_{n}.csv", _csv_for(version["content"], n))
        z.writestr(f"{slug}_{v}_manifest.json", json.dumps(
            {"list": slug, "version": v, "parent": version["parent"],
             "created": version["created"], "note": version["note"]}, indent=1))
    return mem.getvalue()
