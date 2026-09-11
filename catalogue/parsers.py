"""Upload parsers. Nothing is ever exec'd.

CSV: the July convention -- a header row naming regions ('barrel', 'endcap'),
     one feature per cell below. A header-less single column needs a region.
.py: parsed with ast. Every list/tuple of string literals found in a top-level
     assignment is reported with its path (e.g. NN_FEATURES['barrel']['NN1']);
     the user maps each one to a region/net. No layout is assumed.
JSON: not supported in mk1 -- the llp_features.json layout is not on record, so
     no parser is guessed.
"""
import ast
import csv
import io

REGIONS = ("barrel", "endcap")
NETS = ("NN1", "NN2")


class ParseError(Exception):
    pass


def _dedupe(xs):
    out, seen = [], set()
    for x in xs:
        x = x.strip()
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def parse_csv(data, region_if_headerless=None):
    """bytes -> {region: [features]}"""
    text = data.decode("utf-8-sig")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        raise ParseError("CSV is empty")
    header = [c.strip().lower() for c in rows[0]]
    if any(h in REGIONS for h in header):
        out = {}
        for j, h in enumerate(header):
            if h in REGIONS:
                out[h] = _dedupe(r[j] for r in rows[1:] if j < len(r))
        return out
    if header and header[0] in ("feature", "features", "name", "column", "var", "variable"):
        rows = rows[1:]
    if not region_if_headerless:
        raise ParseError("CSV has no 'barrel'/'endcap' header; choose which region it is for")
    feats = _dedupe(c for r in rows for c in r)
    regs = REGIONS if region_if_headerless == "both" else (region_if_headerless,)
    return {r: list(feats) for r in regs}


def _strlists(node, path, out):
    if isinstance(node, (ast.List, ast.Tuple)):
        if node.elts and all(isinstance(e, ast.Constant) and isinstance(e.value, str)
                             for e in node.elts):
            out.append({"path": path, "items": _dedupe(e.value for e in node.elts)})
        else:
            for i, e in enumerate(node.elts):
                _strlists(e, f"{path}[{i}]", out)
    elif isinstance(node, ast.Dict):
        for k, v in zip(node.keys, node.values):
            key = repr(k.value) if isinstance(k, ast.Constant) else "?"
            _strlists(v, f"{path}[{key}]", out)


def discover_py(data):
    """bytes -> [{path, items}] for every string list in top-level assignments."""
    try:
        tree = ast.parse(data.decode("utf-8-sig"))
    except SyntaxError as e:
        raise ParseError(f"not valid python: line {e.lineno}: {e.msg}")
    out = []
    for node in tree.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value:
            targets = [node.target.id]
            value = node.value
        for t in targets:
            _strlists(value, t, out)
    if not out:
        raise ParseError("no lists of string literals found in top-level assignments")
    return out


def empty_content():
    return {r: {n: [] for n in NETS} for r in REGIONS}
