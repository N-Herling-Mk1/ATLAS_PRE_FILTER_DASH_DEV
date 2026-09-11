"""Versioned list store (scope §5).

Layout under <store>/catalogue/<slug>/:
    meta.json          {"name", "created"}
    head               current version hash
    versions/<v>.json  {"version","parent","created","note","content"}
Every upload/edit writes a NEW immutable version; nothing is overwritten.
An edit made against a base that is no longer head is rejected (StaleHead).
"""
import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone

from .parsers import NETS, REGIONS, empty_content

_lock = threading.Lock()


class StaleHead(Exception):
    pass


class NotFound(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def content_hash(content):
    blob = json.dumps(content, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def normalise(content):
    c = empty_content()
    for r in REGIONS:
        for n in NETS:
            seen, out = set(), []
            for f in (content.get(r, {}) or {}).get(n, []) or []:
                f = str(f).strip()
                if f and f not in seen:
                    seen.add(f)
                    out.append(f)
            c[r][n] = out
    return c


class Catalogue:
    def __init__(self, store_dir):
        self.root = os.path.join(store_dir, "catalogue")
        os.makedirs(self.root, exist_ok=True)

    @staticmethod
    def slug(name):
        s = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip()).strip("_")
        if not s:
            raise ValueError("list name is empty")
        return s[:80]

    def _dir(self, slug):
        d = os.path.join(self.root, slug)
        if not os.path.isdir(d):
            raise NotFound(f"no list '{slug}'")
        return d

    def lists(self):
        out = []
        for slug in sorted(os.listdir(self.root)):
            d = os.path.join(self.root, slug)
            if not os.path.isfile(os.path.join(d, "head")):
                continue
            meta = json.load(open(os.path.join(d, "meta.json")))
            head = open(os.path.join(d, "head")).read().strip()
            v = self.version(slug, head)
            out.append({"slug": slug, "name": meta["name"], "head": head,
                        "updated": v["created"], "n_versions": len(os.listdir(os.path.join(d, "versions"))),
                        "counts": {r: {n: len(v["content"][r][n]) for n in NETS} for r in REGIONS}})
        return out

    def head(self, slug):
        return open(os.path.join(self._dir(slug), "head")).read().strip()

    def version(self, slug, vhash):
        p = os.path.join(self._dir(slug), "versions", f"{vhash}.json")
        if not os.path.isfile(p):
            raise NotFound(f"list '{slug}' has no version {vhash}")
        return json.load(open(p))

    def history(self, slug):
        d = os.path.join(self._dir(slug), "versions")
        vs = [json.load(open(os.path.join(d, f))) for f in os.listdir(d) if f.endswith(".json")]
        return sorted(({k: v.get(k) for k in ("version", "parent", "created", "note", "author")} for v in vs),
                      key=lambda v: v["created"], reverse=True)

    def commit(self, name_or_slug, content, note, base=None, create=False, author=None):
        """Write a new version. Returns (version_dict, changed: bool)."""
        if not note or not note.strip():
            raise ValueError("a change note is required")
        content = normalise(content)
        vh = content_hash(content)
        with _lock:
            slug = self.slug(name_or_slug)
            d = os.path.join(self.root, slug)
            exists = os.path.isfile(os.path.join(d, "head"))
            if create and exists:
                raise ValueError(f"a list named '{slug}' already exists; upload a new version to it instead")
            if not create and not exists:
                raise NotFound(f"no list '{slug}'")
            parent = None
            if exists:
                parent = open(os.path.join(d, "head")).read().strip()
                if base is not None and base != parent:
                    raise StaleHead(f"list '{slug}' moved: you edited {base}, head is now {parent}")
                if parent == vh:
                    return self.version(slug, vh), False
            os.makedirs(os.path.join(d, "versions"), exist_ok=True)
            if not exists:
                _atomic_write(os.path.join(d, "meta.json"), {"name": name_or_slug.strip(), "created": _now()})
            v = {"version": vh, "parent": parent, "created": _now(), "note": note.strip(),
                 "author": author, "content": content}
            vp = os.path.join(d, "versions", f"{vh}.json")
            if not os.path.exists(vp):          # identical content revisited keeps its first record
                _atomic_write(vp, v)
            else:
                v = json.load(open(vp))
            tmp = os.path.join(d, "head.tmp")
            with open(tmp, "w") as f:
                f.write(vh)
            os.replace(tmp, os.path.join(d, "head"))
            return v, True


def _restore(self, slug, v):
    """Put a version record from a session bundle back into the store, unchanged.
    Returns True if anything was written. The head only moves for a new list."""
    if content_hash(normalise(v["content"])) != v["version"]:
        raise ValueError(f"bundle version {v.get('version')} fails its content hash")
    with _lock:
        d = os.path.join(self.root, self.slug(slug))
        vp = os.path.join(d, "versions", f"{v['version']}.json")
        if os.path.exists(vp):
            return False
        os.makedirs(os.path.join(d, "versions"), exist_ok=True)
        _atomic_write(vp, v)
        if not os.path.isfile(os.path.join(d, "head")):
            _atomic_write(os.path.join(d, "meta.json"), {"name": slug, "created": _now()})
            with open(os.path.join(d, "head"), "w") as f:
                f.write(v["version"])
        return True


Catalogue.restore_version = _restore


def apply_ops(content, ops):
    """ops: [{op: add|remove|move, region, net, feature, to_net?}] -> new content."""
    c = normalise(content)
    for o in ops:
        r, n, f = o.get("region"), o.get("net"), (o.get("feature") or "").strip()
        if r not in REGIONS or n not in NETS or not f:
            raise ValueError(f"bad op: {o}")
        if o["op"] == "add":
            if f not in c[r][n]:
                c[r][n].append(f)
        elif o["op"] == "remove":
            c[r][n] = [x for x in c[r][n] if x != f]
        elif o["op"] == "move":
            t = o.get("to_net")
            if t not in NETS or t == n:
                raise ValueError(f"bad move target: {o}")
            c[r][n] = [x for x in c[r][n] if x != f]
            if f not in c[r][t]:
                c[r][t].append(f)
        else:
            raise ValueError(f"unknown op '{o.get('op')}'")
    return c


def diff(a, b):
    """content a -> content b, per region: added / removed / moved."""
    out = {}
    for r in REGIONS:
        A = {f: n for n in NETS for f in a[r][n]}
        B = {f: n for n in NETS for f in b[r][n]}
        out[r] = {
            "added": sorted(f"{f} -> {B[f]}" for f in B if f not in A),
            "removed": sorted(f"{f} (was {A[f]})" for f in A if f not in B),
            "moved": sorted(f"{f}: {A[f]} -> {B[f]}" for f in A if f in B and A[f] != B[f]),
        }
    return out


def matrix(entries):
    """entries: [(label, content)] -> rows of per-feature membership across lists,
    per region, with conflicts marked (scan layer §16.3: the catalogue's first job
    is showing where the registries disagree)."""
    rows = []
    for r in REGIONS:
        feats = []
        seen = set()
        for _, c in entries:
            for n in NETS:
                for f in c[r][n]:
                    if f not in seen:
                        seen.add(f)
                        feats.append(f)
        for f in sorted(feats, key=str.lower):
            cells = []
            for _, c in entries:
                cells.append("NN1" if f in c[r]["NN1"] else "NN2" if f in c[r]["NN2"] else None)
            rows.append({"region": r, "feature": f, "cells": cells,
                         "conflict": len(set(cells)) > 1})
    return {"lists": [lab for lab, _ in entries], "rows": rows,
            "n_conflicts": sum(1 for x in rows if x["conflict"])}


def validate(content, data_columns):
    """data_columns: {region: [names] or None} -> {region: [MISSING_IN_DATA names]}"""
    out = {}
    for r in REGIONS:
        cols = data_columns.get(r)
        if cols is None:
            out[r] = None
            continue
        s = set(cols)
        out[r] = [f for n in NETS for f in content[r][n] if f not in s]
    return out
