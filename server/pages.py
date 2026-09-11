"""Page routes. Each page is a template shell; data arrives from /api."""
from flask import Blueprint, current_app, render_template

bp = Blueprint("pages", __name__)

PAGES = [("run", "/", "Run"), ("board", "/board", "Verdict board"),
         ("feature", "/feature", "Feature card"), ("catalogue", "/catalogue", "Catalogue"),
         ("session", "/session", "Session")]


def _render(key):
    title = dict((k, t) for k, _, t in PAGES)[key]
    return render_template(f"{key}.html", page=key, title=title, pages=PAGES,
                           mode=current_app.extensions["pfd"]["cfg"].mode)


@bp.get("/")
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
