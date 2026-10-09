"""Page routes. Each page is a template shell; data arrives from /api.

mk22: the hub is the landing page. Signing in drops you on `/`, which is the
navigation surface -- TV, tiles, turnstile -- and the old Run sheet moves to
`/run`. Everything here sits behind the lock in app.py, the TV listing included.
"""
import os

from flask import Blueprint, current_app, jsonify, render_template

bp = Blueprint("pages", __name__)

# repo root, derived the same way app.py derives it -- not from Flask's
# root_path, which moves if the app is ever created with a custom static folder
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "web", "static", "public", "assets", "images")

PAGES = [("hub", "/", "Home"), ("run", "/run", "Run"), ("board", "/board", "Verdict board"),
         ("feature", "/feature", "Feature card"), ("catalogue", "/catalogue", "Catalogue"),
         ("session", "/session", "Session")]

# The tiles, in turnstile order. One list, read by the template for the top
# panel and handed to hub.js for the dial, so the two can never disagree.
TILES = [
    ("info-theory", "Information Theory", "H, I, KL", "Entropy and mutual information over the feature set."),
    ("tokenization", "Tokenization", "tok", "How rows and fields are cut into units before modelling."),
    ("bayesian", "Bayesian", "p(θ|D)", "Posteriors, priors, and what the data actually moved."),
    ("max-entropy", "Max Entropy", "maxent", "Least-committed distributions under the stated constraints."),
    ("forge", "Forge", "forge", "The posterior observatory and its runs."),
    ("features", "Features", "X", "The feature set itself: definitions, coverage, drift."),
    ("genealogy", "NN Genealogy", "ΔX", "Version history of the MSVtx NN1 / NN2 input features, barrel and endcap, with per-selection downloads."),
    ("code-truth", "Code Truth", "#", "AI-generated, human-reviewed, hash-sealed code units and the lineage between them."),
    ("models", "Models", "f(X)", "Trained models, their inputs, and their verdicts."),
    ("eda", "EDA Dashboard", "EDA", "Distributions, correlations and coverage across the prefilter inputs."),
    ("root2csv", "root2csv", "ROOT→CSV", "Scan and flatten ATLAS ROOT ntuples to CSV. Opens its front end or its repo."),
]

# Tiles whose sheet is a pointer to somewhere else. The template reads the URL
# from here so the link lives in one place.
EXTERNAL = {"root2csv": {
    "site": "https://n-herling-mk1.github.io/root_to_csv/",           # the front end (index.html, GitHub Pages)
    "repo": "https://github.com/N-Herling-Mk1/root_to_csv#readme",    # the repo, opened at its README
}, "genealogy": {
    # mk48: this one is embedded, not just linked -- the sheet frames `site`.
    "site": "https://n-herling-mk1.github.io/atlas_nn_genealogy/",
    "repo": "https://github.com/N-Herling-Mk1/atlas_nn_genealogy#readme",
    # (hash, label, tag) for the side panel, newest first. The page builds its
    # own tabs from its registry; this list is only the dashboard's shortcuts,
    # so add a line here when a new mk lands there.
    # mk49: the page's full size in CSS px (width it lays out at, height of
    # the timeline). The sheet scales the frame down from this so the whole
    # timeline shows without scrolling. Raise "h" when the timeline grows.
    "size": {"w": 1160, "h": 1200},
    "views": [("", "Timeline", "all"), ("mk4", "mk4", "Sep 2026"),
              ("mk3", "mk3", "Jul 2026"), ("mk2", "mk2", "Jun 2026")],
}, "code-truth": {
    # mk51: same treatment as genealogy -- framed whole, scaled to fit.
    "site": "https://n-herling-mk1.github.io/code_truth_genealogy/",
    "repo": "https://github.com/N-Herling-Mk1/code_truth_genealogy#readme",
    "title": "Code Truth Genealogy",
    # "h" is an ESTIMATE (the page could not be measured when this was written).
    # Measure it: open the site, F12 console, document.documentElement.scrollHeight.
    "size": {"w": 1160, "h": 1400},
    # unit ids are the page's own hashes (its data.js), newest lineage first
    "views": [("", "Timeline", "all"), ("dncn_qn_mk1", "dncn_qn_mk1", "sealed"),
              ("dnc_flr_mk1", "dnc_flr_mk1", "exp"), ("disco_mk1", "disco_mk1", "sealed"),
              ("bce_mlp_mk1", "bce_mlp_mk1", "sealed")],
}}
EXTERNAL["genealogy"]["title"] = "NN Feature Genealogy"

# The only places this site may put in a frame. app.py turns this into the
# Content-Security-Policy frame-src; anything not listed stays blocked.
EMBED_SRC = (EXTERNAL["genealogy"]["site"], EXTERNAL["code-truth"]["site"])

# Images the TV will not show: these are user-interface assets that happen to
# live in the same folder. Everything else in assets/images gets a turn.
_TV_SKIP = {"favicon.svg", "proton_2.png", "proton_2_256.png", "proton_crt_64.png"}
_TV_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}


def _render(key, **extra):
    title = dict((k, t) for k, _, t in PAGES)[key]
    return render_template(f"{key}.html", page=key, title=title, pages=PAGES,
                           mode=current_app.extensions["pfd"]["cfg"].mode, **extra)


@bp.get("/")
def hub():
    return _render("hub", tiles=TILES, external=EXTERNAL)


@bp.get("/run")
def run():
    return _render("run")


@bp.get("/board")
def board():
    return _render("board")


@bp.get("/feature")
def feature():
    return _render("feature")


@bp.get("/catalogue")
def catalogue():
    return _render("catalogue")


@bp.get("/session")
def session_page():
    return _render("session")


@bp.get("/api/tv")
def tv_images():
    """Whatever is in assets/images, in name order, for the TV to cycle.

    Sorted naturally, so image_2 comes before image_10 rather than after it.
    Drop files in and reload; nothing else needs to change.
    """
    names = []
    try:
        for n in os.listdir(IMAGES):
            if n in _TV_SKIP or n.startswith("."):
                continue
            if os.path.splitext(n)[1].lower() in _TV_EXT:
                names.append(n)
    except OSError:
        names = []

    def natural(n):
        stem = os.path.splitext(n)[0]
        digits = "".join(c for c in stem if c.isdigit())
        return (0 if digits else 1, int(digits) if digits else 0, n.lower())

    names.sort(key=natural)
    return jsonify(images=[f"/static/public/assets/images/{n}" for n in names])
