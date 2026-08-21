"""Connexion unique (SSO) du hub.

Un seul compte est créé ici, au niveau du hub. Chaque mini-jeu garde sa
propre base SQLite (stats, scores, jetons...) mais n'a plus sa propre page
de connexion : dès qu'une session hub existe, `sync_local_account` relie ou
crée automatiquement le compte correspondant dans la base du jeu, sans
jamais réutiliser un ancien compte du jeu créé avant la mise en place du
SSO (la liaison se fait via la colonne users.hub_user_id, jamais par pseudo).
"""

import os
import random
import sqlite3
from datetime import datetime

from flask import Blueprint, request, jsonify, render_template, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), "hub_users.db")
SESSION_KEY = "hub_user_id"

hub_auth_bp = Blueprint("hub_auth", __name__, template_folder="templates")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_guest INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()
    db.close()


def now():
    return datetime.utcnow().isoformat()


def current_hub_user():
    uid = session.get(SESSION_KEY)
    if not uid:
        return None
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    db.close()
    return user


def login_required(view):
    def wrapped(*args, **kwargs):
        if not current_hub_user():
            return redirect(url_for("hub_auth.login_page", next=request.path))
        return view(*args, **kwargs)
    wrapped.__name__ = view.__name__
    return wrapped


def sync_local_account(conn, hub_user, insert_row):
    """Retrouve (ou crée) dans la base `conn` d'un jeu le compte lié au
    compte hub `hub_user`, en cherchant par hub_user_id (jamais par pseudo,
    pour ne pas accrocher un compte du jeu créé avant le SSO).
    `insert_row(conn, safe_username, hub_id)` doit insérer la ligne et
    committer ; `safe_username` est garanti libre dans cette base."""
    existing = conn.execute(
        "SELECT * FROM users WHERE hub_user_id = ?", (hub_user["id"],)
    ).fetchone()
    if existing:
        return existing
    username = hub_user["username"]
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        username = f"{username}-{random.randint(1000, 9999)}"
    insert_row(conn, username, hub_user["id"])
    return conn.execute(
        "SELECT * FROM users WHERE hub_user_id = ?", (hub_user["id"],)
    ).fetchone()


@hub_auth_bp.route("/login")
def login_page():
    if current_hub_user():
        return redirect(request.args.get("next") or url_for("home"))
    return render_template("login.html", next=request.args.get("next") or "")


@hub_auth_bp.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if len(username) < 3 or len(password) < 4:
        return jsonify(error="Pseudo (3+ car.) et mot de passe (4+ car.) requis."), 400
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        db.close()
        return jsonify(error="Ce pseudo est déjà pris."), 400
    db.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (username, generate_password_hash(password), now()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True, username=user["username"])


@hub_auth_bp.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify(error="Identifiants incorrects."), 400
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True, username=user["username"])


@hub_auth_bp.route("/api/guest", methods=["POST"])
def api_guest():
    data = request.get_json(force=True)
    pseudo = (data.get("username") or "").strip()
    if len(pseudo) < 2 or len(pseudo) > 20:
        return jsonify(error="Pseudo entre 2 et 20 caractères."), 400
    db = get_db()
    username = pseudo
    if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        username = f"{pseudo}-{random.randint(1000, 9999)}"
    db.execute(
        "INSERT INTO users (username, password_hash, is_guest, created_at) VALUES (?, ?, 1, ?)",
        (username, generate_password_hash(os.urandom(16).hex()), now()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True, username=user["username"])


@hub_auth_bp.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify(ok=True)


init_db()
