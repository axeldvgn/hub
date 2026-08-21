import sqlite3
import random
import string
import math
import os
import secrets
from datetime import datetime
from flask import Blueprint, g, session, request, jsonify, render_template, redirect, url_for
from werkzeug.security import generate_password_hash

from auth import current_hub_user, sync_local_account

DB_PATH = os.path.join(os.path.dirname(__file__), "teinte.db")
TOTAL_ROUNDS = 10

# Blueprint monté sous /teinte par le hub (voir app.py à la racine).
# Static et templates sont namespacés pour ne pas entrer en conflit avec
# les autres jeux du hub.
teinte_bp = Blueprint(
    "teinte",
    __name__,
    url_prefix="/teinte",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

SESSION_KEY = "teinte_user_id"  # namespacé pour ne pas entrer en collision
                                  # avec la session d'un autre jeu du hub


# ---------------------------------------------------------------------------
# Base de données
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@teinte_bp.teardown_app_request
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_guest INTEGER NOT NULL DEFAULT 0,
    hub_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    franchise TEXT NOT NULL,
    name TEXT NOT NULL,
    item TEXT NOT NULL,
    color_hex TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    current_round INTEGER NOT NULL DEFAULT 0,
    total_rounds INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    score_total REAL NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    UNIQUE(game_id, user_id),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'guessing',
    started_at TEXT NOT NULL,
    UNIQUE(game_id, round_number),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (character_id) REFERENCES characters(id)
);

CREATE TABLE IF NOT EXISTS guesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    guessed_hex TEXT NOT NULL,
    score_pct REAL,
    submitted_at TEXT NOT NULL,
    UNIQUE(round_id, user_id),
    FOREIGN KEY (round_id) REFERENCES rounds(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
"""

CHARACTERS = [
    # Personnages du domaine public / du folklore — aucun droit d'auteur
    # ne s'applique à ces figures littéraires, mythologiques ou de contes.
    ("Littérature classique", "Sherlock Holmes", "son manteau", "#8C8172"),
    ("Littérature classique", "Dracula", "sa cape", "#171216"),
    ("Littérature classique", "Frankenstein", "sa peau", "#6B8E4E"),
    ("Alice au pays des merveilles", "Alice", "sa robe", "#3B6FB6"),
    ("Alice au pays des merveilles", "Le Chapelier Fou", "son chapeau", "#6A3FA0"),
    ("Alice au pays des merveilles", "Le Lapin Blanc", "son gilet", "#C0392B"),
    ("Alice au pays des merveilles", "Le Chat du Cheshire", "son pelage", "#B983D6"),
    ("Alice au pays des merveilles", "La Reine de Cœur", "sa robe", "#C0142B"),
    ("Folklore anglais", "Robin des Bois", "sa tenue", "#2F6B3C"),
    ("Légende arthurienne", "Merlin l'Enchanteur", "sa robe", "#3B3A78"),
    ("Contes de Perrault", "Le Petit Chaperon Rouge", "sa cape", "#C21E27"),
    ("Contes de Perrault", "Le Grand Méchant Loup", "son pelage", "#6E6E6E"),
    ("Contes de Perrault", "Le Chat Botté", "son pelage", "#D97B29"),
    ("Contes de Perrault", "Cendrillon", "sa robe", "#7FB2DE"),
    ("Contes de Perrault", "Barbe Bleue", "sa barbe", "#1B4F8C"),
    ("Contes de Perrault", "Peau d'Âne", "sa robe", "#C7C7D6"),
    ("Contes de Perrault", "La Belle au Bois Dormant", "sa robe", "#E08FB0"),
    ("Les Misérables", "Jean Valjean", "sa veste", "#5B4630"),
    ("Les Misérables", "Cosette", "sa robe", "#A9C4DE"),
    ("Les Misérables", "Javert", "son uniforme", "#1F2A44"),
    ("Notre-Dame de Paris", "Quasimodo", "sa tenue", "#6B4A2F"),
    ("Les Trois Mousquetaires", "D'Artagnan", "son manteau", "#2A4B8D"),
    ("Cyrano de Bergerac", "Cyrano de Bergerac", "son chapeau", "#7A1F2B"),
    ("Arsène Lupin", "Arsène Lupin", "son chapeau", "#2B2B2E"),
    ("Peter Pan", "Le Capitaine Crochet", "son manteau", "#7A1E1E"),
    ("Peter Pan", "Peter Pan", "sa tenue", "#3C8C4B"),
    ("Mythologie grecque", "Zeus", "sa toge", "#C9A227"),
    ("Mythologie nordique", "Thor", "sa cape", "#B71C2B"),
    ("Folklore de Noël", "Le Père Noël", "son manteau", "#D7263D"),
    ("Folklore slave", "Baba Yaga", "sa robe", "#4A5D3A"),
]


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    # Migrations douces pour une base créée avant l'ajout du mode invité /
    # de la connexion unique du hub.
    cols = [row[1] for row in db.execute("PRAGMA table_info(users)")]
    if "is_guest" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0")
    if "hub_user_id" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN hub_user_id INTEGER")
    count = db.execute("SELECT COUNT(*) FROM characters").fetchone()[0]
    if count == 0:
        db.executemany(
            "INSERT INTO characters (franchise, name, item, color_hex) VALUES (?, ?, ?, ?)",
            CHARACTERS,
        )
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Aides
# ---------------------------------------------------------------------------

def now():
    return datetime.utcnow().isoformat()


def _create_synced_row(conn, username, hub_id, is_guest):
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at, is_guest, hub_user_id) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, generate_password_hash(secrets.token_hex(16)), now(), int(is_guest), hub_id),
    )
    conn.commit()


def current_user():
    uid = session.get(SESSION_KEY)
    if uid:
        user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if user:
            return user

    # Pas de session locale : si une session hub existe, on relie (ou crée)
    # automatiquement le compte teinte correspondant — connexion unique.
    hub_user = current_hub_user()
    if not hub_user:
        return None
    db = get_db()
    user = sync_local_account(
        db, hub_user,
        lambda conn, username, hub_id: _create_synced_row(conn, username, hub_id, hub_user["is_guest"]),
    )
    session[SESSION_KEY] = user["id"]
    return user


def login_required(view):
    def wrapped(*args, **kwargs):
        if not current_user():
            return redirect(url_for("hub_auth.login_page", next=request.path))
        return view(*args, **kwargs)
    wrapped.__name__ = view.__name__
    return wrapped


def generate_code():
    db = get_db()
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
        exists = db.execute("SELECT 1 FROM games WHERE code = ?", (code,)).fetchone()
        if not exists:
            return code


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        raise ValueError("hex invalide")
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def color_score(hex1, hex2):
    """Score de 0 à 100 selon la distance euclidienne dans l'espace RGB."""
    r1, g1, b1 = hex_to_rgb(hex1)
    r2, g2, b2 = hex_to_rgb(hex2)
    dist = math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
    max_dist = math.sqrt(255 ** 2 * 3)
    score = max(0.0, 100.0 * (1 - dist / max_dist))
    return round(score, 1)


def get_game_by_code(code):
    return get_db().execute(
        "SELECT * FROM games WHERE code = ?", (code.upper(),)
    ).fetchone()


def get_players(game_id):
    return get_db().execute(
        """SELECT gp.user_id, gp.score_total, u.username
           FROM game_players gp JOIN users u ON u.id = gp.user_id
           WHERE gp.game_id = ? ORDER BY gp.joined_at ASC""",
        (game_id,),
    ).fetchall()


def get_current_round(game_id, round_number):
    return get_db().execute(
        """SELECT r.*, c.franchise, c.name AS character_name, c.item, c.color_hex
           FROM rounds r JOIN characters c ON c.id = r.character_id
           WHERE r.game_id = ? AND r.round_number = ?""",
        (game_id, round_number),
    ).fetchone()


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@teinte_bp.route("/")
def home():
    if not current_user():
        return redirect(url_for("hub_auth.login_page", next=request.path))
    return render_template("teinte/home.html", user=current_user())


@teinte_bp.route("/game/<code>/lobby")
@login_required
def lobby_page(code):
    game = get_game_by_code(code)
    if not game:
        return redirect(url_for("teinte.home"))
    if game["status"] == "playing":
        return redirect(url_for("teinte.play_page", code=code))
    if game["status"] == "finished":
        return redirect(url_for("teinte.results_page", code=code))
    return render_template("teinte/lobby.html", code=game["code"], user=current_user())


@teinte_bp.route("/game/<code>/play")
@login_required
def play_page(code):
    game = get_game_by_code(code)
    if not game:
        return redirect(url_for("teinte.home"))
    if game["status"] == "waiting":
        return redirect(url_for("teinte.lobby_page", code=code))
    if game["status"] == "finished":
        return redirect(url_for("teinte.results_page", code=code))
    return render_template("teinte/play.html", code=game["code"], user=current_user(),
                            total_rounds=game["total_rounds"])


@teinte_bp.route("/game/<code>/results")
@login_required
def results_page(code):
    game = get_game_by_code(code)
    if not game:
        return redirect(url_for("teinte.home"))
    return render_template("teinte/results.html", code=game["code"], user=current_user())


# ---------------------------------------------------------------------------
# API — compte
# ---------------------------------------------------------------------------
# La connexion se fait au niveau du hub (voir /login) ; current_user()
# relie/crée automatiquement le compte teinte correspondant. Seule la
# déconnexion reste exposée ici, et elle est globale (session.clear() vide
# aussi la session hub et celle des autres jeux).

@teinte_bp.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# API — parties
# ---------------------------------------------------------------------------

@teinte_bp.route("/api/game/create", methods=["POST"])
@login_required
def api_create_game():
    db = get_db()
    user = current_user()
    code = generate_code()
    cur = db.execute(
        "INSERT INTO games (code, host_id, status, current_round, total_rounds, created_at) "
        "VALUES (?, ?, 'waiting', 0, ?, ?)",
        (code, user["id"], TOTAL_ROUNDS, now()),
    )
    game_id = cur.lastrowid
    db.execute(
        "INSERT INTO game_players (game_id, user_id, score_total, joined_at) VALUES (?, ?, 0, ?)",
        (game_id, user["id"], now()),
    )
    db.commit()
    return jsonify(ok=True, code=code)


@teinte_bp.route("/api/game/join", methods=["POST"])
@login_required
def api_join_game():
    data = request.get_json(force=True)
    code = (data.get("code") or "").strip().upper()
    game = get_game_by_code(code)
    if not game:
        return jsonify(error="Code de partie introuvable."), 404
    if game["status"] != "waiting":
        return jsonify(error="Cette partie a déjà commencé."), 400
    db = get_db()
    user = current_user()
    already = db.execute(
        "SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?",
        (game["id"], user["id"]),
    ).fetchone()
    if not already:
        db.execute(
            "INSERT INTO game_players (game_id, user_id, score_total, joined_at) VALUES (?, ?, 0, ?)",
            (game["id"], user["id"], now()),
        )
        db.commit()
    return jsonify(ok=True, code=game["code"])


def get_shape_for_item(item):
    """Associe l'objet à deviner à une silhouette générique (pas liée à un
    personnage précis, pour rester dans les clous côté droits d'auteur)."""
    text = item.lower()
    if "barbe" in text:
        return "beard"
    if "casquette" in text or "chapeau" in text or "bonnet" in text:
        return "hat"
    if "peau" in text:
        return "skin"
    if "pelage" in text or "plumage" in text:
        return "fur"
    if "cheveux" in text:
        return "hair"
    if "robe" in text or "kimono" in text:
        return "dress"
    if "corps" in text:
        return "blob"
    if "bretelles" in text:
        return "straps"
    return "outfit"  # tenue, gi, gilet, salopette, pull, combinaison, etc.


@teinte_bp.route("/api/game/<code>/state")
@login_required
def api_game_state(code):
    game = get_game_by_code(code)
    if not game:
        return jsonify(error="Partie introuvable."), 404
    user = current_user()
    players = get_players(game["id"])
    is_player = any(p["user_id"] == user["id"] for p in players)
    if not is_player:
        return jsonify(error="Tu ne fais pas partie de cette partie."), 403

    payload = {
        "code": game["code"],
        "status": game["status"],
        "host_id": game["host_id"],
        "is_host": game["host_id"] == user["id"],
        "current_round": game["current_round"],
        "total_rounds": game["total_rounds"],
        "players": [
            {"user_id": p["user_id"], "username": p["username"],
             "score_total": round(p["score_total"], 1)}
            for p in players
        ],
    }

    if game["status"] == "playing":
        rnd = get_current_round(game["id"], game["current_round"])
        guesses = get_db().execute(
            """SELECT g.user_id, g.guessed_hex, g.score_pct, u.username
               FROM guesses g JOIN users u ON u.id = g.user_id
               WHERE g.round_id = ?""",
            (rnd["id"],),
        ).fetchall()
        my_guess = next((g for g in guesses if g["user_id"] == user["id"]), None)
        payload["round"] = {
            "round_number": rnd["round_number"],
            "franchise": rnd["franchise"],
            "character_name": rnd["character_name"],
            "item": rnd["item"],
            "shape": get_shape_for_item(rnd["item"]),
            "status": rnd["status"],
            "submitted_count": len(guesses),
            "player_count": len(players),
            "my_submitted": my_guess is not None,
        }
        if rnd["status"] == "revealed":
            payload["round"]["color_hex"] = rnd["color_hex"]
            payload["round"]["guesses"] = [
                {"username": g["username"], "guessed_hex": g["guessed_hex"],
                 "score_pct": g["score_pct"]}
                for g in guesses
            ]

    return jsonify(payload)


@teinte_bp.route("/api/game/<code>/start", methods=["POST"])
@login_required
def api_start_game(code):
    game = get_game_by_code(code)
    if not game:
        return jsonify(error="Partie introuvable."), 404
    user = current_user()
    if game["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut démarrer la partie."), 403
    players = get_players(game["id"])
    if len(players) < 2:
        return jsonify(error="Il faut au moins 2 joueurs pour démarrer."), 400

    db = get_db()
    all_chars = db.execute("SELECT id FROM characters").fetchall()
    chosen = random.sample(all_chars, min(game["total_rounds"], len(all_chars)))

    db.execute("UPDATE games SET status = 'playing', current_round = 1 WHERE id = ?", (game["id"],))
    for i, char in enumerate(chosen, start=1):
        db.execute(
            "INSERT INTO rounds (game_id, round_number, character_id, status, started_at) "
            "VALUES (?, ?, ?, 'guessing', ?)",
            (game["id"], i, char["id"], now()),
        )
    db.commit()
    return jsonify(ok=True)


@teinte_bp.route("/api/game/<code>/guess", methods=["POST"])
@login_required
def api_submit_guess(code):
    game = get_game_by_code(code)
    if not game or game["status"] != "playing":
        return jsonify(error="Partie non disponible."), 400
    data = request.get_json(force=True)
    guessed_hex = (data.get("hex") or "").strip()
    try:
        hex_to_rgb(guessed_hex)
    except Exception:
        return jsonify(error="Couleur invalide."), 400

    db = get_db()
    user = current_user()
    rnd = get_current_round(game["id"], game["current_round"])
    if rnd["status"] != "guessing":
        return jsonify(error="Cette manche est déjà révélée."), 400

    already = db.execute(
        "SELECT 1 FROM guesses WHERE round_id = ? AND user_id = ?",
        (rnd["id"], user["id"]),
    ).fetchone()
    if already:
        return jsonify(error="Tu as déjà validé ta couleur pour cette manche."), 400

    score = color_score(guessed_hex, rnd["color_hex"])
    db.execute(
        "INSERT INTO guesses (round_id, user_id, guessed_hex, score_pct, submitted_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (rnd["id"], user["id"], guessed_hex, score, now()),
    )
    db.commit()

    players = get_players(game["id"])
    submitted = db.execute(
        "SELECT COUNT(*) c FROM guesses WHERE round_id = ?", (rnd["id"],)
    ).fetchone()["c"]
    if submitted >= len(players):
        _reveal_round(db, game, rnd)

    return jsonify(ok=True, score=score)


def _reveal_round(db, game, rnd):
    db.execute("UPDATE rounds SET status = 'revealed' WHERE id = ?", (rnd["id"],))
    guesses = db.execute("SELECT * FROM guesses WHERE round_id = ?", (rnd["id"],)).fetchall()
    for guess in guesses:
        db.execute(
            "UPDATE game_players SET score_total = score_total + ? WHERE game_id = ? AND user_id = ?",
            (guess["score_pct"], game["id"], guess["user_id"]),
        )
    db.commit()


@teinte_bp.route("/api/game/<code>/reveal", methods=["POST"])
@login_required
def api_force_reveal(code):
    game = get_game_by_code(code)
    if not game or game["status"] != "playing":
        return jsonify(error="Partie non disponible."), 400
    user = current_user()
    if game["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut forcer la révélation."), 403
    db = get_db()
    rnd = get_current_round(game["id"], game["current_round"])
    if rnd["status"] != "guessing":
        return jsonify(ok=True)
    # Les joueurs n'ayant pas validé reçoivent un score de 0 pour la manche.
    players = get_players(game["id"])
    existing = {g["user_id"] for g in db.execute(
        "SELECT user_id FROM guesses WHERE round_id = ?", (rnd["id"],))}
    for p in players:
        if p["user_id"] not in existing:
            db.execute(
                "INSERT INTO guesses (round_id, user_id, guessed_hex, score_pct, submitted_at) "
                "VALUES (?, ?, '#000000', 0, ?)",
                (rnd["id"], p["user_id"], now()),
            )
    db.commit()
    rnd = get_current_round(game["id"], game["current_round"])
    _reveal_round(db, game, rnd)
    return jsonify(ok=True)


@teinte_bp.route("/api/game/<code>/next", methods=["POST"])
@login_required
def api_next_round(code):
    game = get_game_by_code(code)
    if not game or game["status"] != "playing":
        return jsonify(error="Partie non disponible."), 400
    user = current_user()
    if game["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut passer à la manche suivante."), 403
    db = get_db()
    rnd = get_current_round(game["id"], game["current_round"])
    if rnd["status"] != "revealed":
        return jsonify(error="La manche en cours n'est pas encore révélée."), 400

    if game["current_round"] >= game["total_rounds"]:
        db.execute("UPDATE games SET status = 'finished' WHERE id = ?", (game["id"],))
    else:
        db.execute("UPDATE games SET current_round = current_round + 1 WHERE id = ?", (game["id"],))
    db.commit()
    return jsonify(ok=True)


@teinte_bp.route("/api/game/<code>/results")
@login_required
def api_results(code):
    game = get_game_by_code(code)
    if not game:
        return jsonify(error="Partie introuvable."), 404
    players = get_players(game["id"])
    ranking = sorted(players, key=lambda p: p["score_total"], reverse=True)
    total_rounds = game["total_rounds"]
    return jsonify(
        status=game["status"],
        total_rounds=total_rounds,
        ranking=[
            {
                "username": p["username"],
                "score_total": round(p["score_total"], 1),
                "average_pct": round(p["score_total"] / total_rounds, 1) if total_rounds else 0,
            }
            for p in ranking
        ],
    )


# Ce module est monté comme blueprint par le hub (voir app.py à la racine),
# il n'est jamais lancé directement : la base est initialisée à l'import.
init_db()
