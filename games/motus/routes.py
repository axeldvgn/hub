from flask import Blueprint, request, jsonify, render_template, session
import sqlite3
import hashlib
import random
import secrets
import os
from datetime import datetime

from auth import current_hub_user

# Blueprint monté sous /motus par le hub (voir app.py à la racine).
# Auth par token (pas de session Flask ici pour ses propres comptes), mais
# le token est désormais obtenu automatiquement via la session du hub
# (voir /api/auto) : plus besoin de se reconnecter jeu par jeu.
motus_bp = Blueprint(
    "motus",
    __name__,
    url_prefix="/motus",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "motus.db")


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pseudo TEXT UNIQUE NOT NULL,
            mot_de_passe_hash TEXT NOT NULL,
            token TEXT,
            hub_user_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS parties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            gagne INTEGER NOT NULL,
            essais INTEGER NOT NULL,
            date TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
    if "hub_user_id" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN hub_user_id INTEGER")
    conn.commit()
    conn.close()


def hash_mdp(mdp):
    return hashlib.sha256(mdp.encode()).hexdigest()


def utilisateur_depuis_token(token):
    if not token:
        return None
    conn = get_db()
    u = conn.execute("SELECT * FROM users WHERE token = ?", (token,)).fetchone()
    conn.close()
    return u


def utilisateur_depuis_hub(hub_user):
    """Retrouve (ou crée) le compte motus lié au compte hub, via
    hub_user_id — jamais par pseudo, pour ne pas accrocher un compte motus
    créé avant la mise en place de la connexion unique."""
    conn = get_db()
    u = conn.execute("SELECT * FROM users WHERE hub_user_id = ?", (hub_user["id"],)).fetchone()
    if not u:
        pseudo = hub_user["username"]
        if conn.execute("SELECT 1 FROM users WHERE pseudo = ?", (pseudo,)).fetchone():
            pseudo = f"{pseudo}-{random.randint(1000, 9999)}"
        conn.execute(
            "INSERT INTO users (pseudo, mot_de_passe_hash, token, hub_user_id) VALUES (?, ?, ?, ?)",
            (pseudo, hash_mdp(secrets.token_hex(16)), None, hub_user["id"]),
        )
        conn.commit()
        u = conn.execute("SELECT * FROM users WHERE hub_user_id = ?", (hub_user["id"],)).fetchone()

    token = secrets.token_hex(16)
    conn.execute("UPDATE users SET token = ? WHERE id = ?", (token, u["id"]))
    conn.commit()
    conn.close()
    return u["pseudo"], token


# ---------- Page HTML principale ----------

@motus_bp.route('/')
def index():
    return render_template('motus/motus.html')


# ---------- Routes API ----------
# La connexion se fait au niveau du hub (voir /login) : plus d'inscription
# ni de connexion propres à motus. /api/auto échange la session hub contre
# un token motus (créant le compte lié au premier accès).

@motus_bp.route("/api/auto", methods=["POST"])
def auto_login():
    hub_user = current_hub_user()
    if not hub_user:
        return jsonify({"erreur": "Non connecté"}), 401
    pseudo, token = utilisateur_depuis_hub(hub_user)
    return jsonify({"pseudo": pseudo, "token": token})


@motus_bp.route("/api/deconnexion", methods=["POST"])
def deconnexion():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    u = utilisateur_depuis_token(token)
    if u:
        conn = get_db()
        conn.execute("UPDATE users SET token = NULL WHERE id = ?", (u["id"],))
        conn.commit()
        conn.close()
    # Déconnexion globale : vide aussi la session hub et celle des autres jeux.
    session.clear()
    return jsonify({"ok": True})


@motus_bp.route("/api/score", methods=["POST"])
def enregistrer_score():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    u = utilisateur_depuis_token(token)
    if not u:
        return jsonify({"erreur": "Non connecté"}), 401

    data = request.get_json(force=True, silent=True) or {}
    gagne = 1 if data.get("gagne") else 0
    essais = int(data.get("essais", 6))

    conn = get_db()
    conn.execute(
        "INSERT INTO parties (user_id, gagne, essais, date) VALUES (?, ?, ?, ?)",
        (u["id"], gagne, essais, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@motus_bp.route("/api/classement", methods=["GET"])
def classement():
    conn = get_db()
    lignes = conn.execute("""
        SELECT users.pseudo AS pseudo,
               COUNT(parties.id) AS parties_jouees,
               COALESCE(SUM(parties.gagne), 0) AS victoires,
               ROUND(AVG(parties.essais), 2) AS moyenne_essais
        FROM users
        JOIN parties ON parties.user_id = users.id
        GROUP BY users.id
        ORDER BY victoires DESC, moyenne_essais ASC
    """).fetchall()
    conn.close()
    return jsonify([dict(l) for l in lignes])


@motus_bp.route("/api/moi", methods=["GET"])
def moi():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    u = utilisateur_depuis_token(token)
    if not u:
        return jsonify({"erreur": "Non connecté"}), 401

    conn = get_db()
    stats = conn.execute(
        "SELECT COUNT(*) AS parties_jouees, COALESCE(SUM(gagne),0) AS victoires FROM parties WHERE user_id = ?",
        (u["id"],)
    ).fetchone()
    conn.close()
    return jsonify({
        "pseudo": u["pseudo"],
        "parties_jouees": stats["parties_jouees"],
        "victoires": stats["victoires"]
    })


# Ce module est monté comme blueprint par le hub (voir app.py à la racine),
# il n'est jamais lancé directement : la base est initialisée à l'import.
# CREATE TABLE IF NOT EXISTS ne touche pas aux données existantes de
# motus.db (comptes et parties déjà enregistrés sont conservés).
init_db()
