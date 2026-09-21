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
    ("models", "Models", "f(X)", "Trained models, their inputs, and their verdicts."),
    ("eda", "EDA Dashboard", "EDA", "Distributions, correlations and coverage across the prefilter inputs."),
]

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
    return _render("hub", tiles=TILES)


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
