from flask import Blueprint, request, jsonify, render_template
import sqlite3
import hashlib
import secrets
import os
from datetime import datetime

# Blueprint monté sous /motus par le hub (voir app.py à la racine).
# Auth par token (pas de session Flask ici), donc aucun risque de
# collision avec la session utilisée par un autre jeu du hub.
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
            token TEXT
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


# ---------- Page HTML principale ----------

@motus_bp.route('/')
def index():
    return render_template('motus/motus.html')


# ---------- Routes API ----------

@motus_bp.route("/api/inscription", methods=["POST"])
def inscription():
    data = request.get_json(force=True, silent=True) or {}
    pseudo = (data.get("pseudo") or "").strip()
    mdp = data.get("mot_de_passe") or ""

    if len(pseudo) < 3 or len(mdp) < 4:
        return jsonify({"erreur": "Pseudo (3+ caractères) et mot de passe (4+ caractères) requis"}), 400

    conn = get_db()
    existe = conn.execute("SELECT id FROM users WHERE pseudo = ?", (pseudo,)).fetchone()
    if existe:
        conn.close()
        return jsonify({"erreur": "Ce pseudo est déjà pris"}), 409

    token = secrets.token_hex(16)
    conn.execute(
        "INSERT INTO users (pseudo, mot_de_passe_hash, token) VALUES (?, ?, ?)",
        (pseudo, hash_mdp(mdp), token)
    )
    conn.commit()
    conn.close()
    return jsonify({"pseudo": pseudo, "token": token})


@motus_bp.route("/api/connexion", methods=["POST"])
def connexion():
    data = request.get_json(force=True, silent=True) or {}
    pseudo = (data.get("pseudo") or "").strip()
    mdp = data.get("mot_de_passe") or ""

    conn = get_db()
    u = conn.execute("SELECT * FROM users WHERE pseudo = ?", (pseudo,)).fetchone()
    if not u or u["mot_de_passe_hash"] != hash_mdp(mdp):
        conn.close()
        return jsonify({"erreur": "Pseudo ou mot de passe incorrect"}), 401

    token = secrets.token_hex(16)
    conn.execute("UPDATE users SET token = ? WHERE id = ?", (token, u["id"]))
    conn.commit()
    conn.close()
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
