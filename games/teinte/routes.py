import sqlite3
import random
import string
import math
import os
from datetime import datetime
from flask import Blueprint, g, session, request, jsonify, render_template, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

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
    created_at TEXT NOT NULL
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
    ("Scooby-Doo", "Scooby-Doo", "son pelage", "#8B5A2B"),
    ("Naruto", "Naruto Uzumaki", "sa tenue", "#FF7800"),
    ("Naruto", "Sasuke Uchiwa", "sa tenue", "#26415E"),
    ("One Piece", "Monkey D. Luffy", "son gilet", "#B2211A"),
    ("Pokémon", "Pikachu", "son pelage", "#FFD700"),
    ("Dragon Ball", "Son Goku", "son gi", "#FF6A00"),
    ("Dragon Ball", "Piccolo", "sa peau", "#2E8B57"),
    ("Bob l'éponge", "Bob l'éponge", "sa peau", "#FFD93D"),
    ("Bob l'éponge", "Patrick", "sa peau", "#FF8FB1"),
    ("Les Simpson", "Homer Simpson", "sa peau", "#FCD34D"),
    ("Les Simpson", "Marge Simpson", "ses cheveux", "#4A90D9"),
    ("Shrek", "Shrek", "sa peau", "#7CB342"),
    ("Sonic", "Sonic", "son pelage", "#1E90FF"),
    ("Super Mario", "Mario", "sa casquette", "#E4000F"),
    ("Super Mario", "Luigi", "sa casquette", "#00A651"),
    ("My Hero Academia", "Izuku Midoriya", "sa tenue de héros", "#1B7A3D"),
    ("Demon Slayer", "Nezuko Kamado", "son kimono", "#FF6FA5"),
    ("Minions", "Un Minion", "sa salopette", "#1560BD"),
    ("Winnie l'ourson", "Winnie l'ourson", "son pull", "#C1272D"),
    ("Peppa Pig", "Peppa Pig", "sa robe", "#E4536B"),
    ("Les Schtroumpfs", "Un Schtroumpf", "sa peau", "#4FC3F7"),
    ("Batman", "Batman", "sa tenue", "#232B3A"),
    ("Hulk", "Hulk", "sa peau", "#6FCF37"),
    ("Kirby", "Kirby", "son corps", "#FFB6D9"),
    ("Astérix", "Obélix", "ses bretelles", "#3E6DBF"),
    ("Toy Story", "Buzz l'Éclair", "sa combinaison", "#3C6E47"),
    ("Toy Story", "Woody", "son chapeau", "#B8621B"),
    ("Angry Birds", "Red", "son plumage", "#D6291E"),
    ("Adventure Time", "Finn", "son bonnet", "#F2F2F2"),
    ("Adventure Time", "Jake", "son pelage", "#F5C05A"),
]


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
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


def current_user():
    uid = session.get(SESSION_KEY)
    if not uid:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def login_required(view):
    def wrapped(*args, **kwargs):
        if not current_user():
            return redirect(url_for("teinte.login_page"))
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
        return redirect(url_for("teinte.login_page"))
    return render_template("teinte/home.html", user=current_user())


@teinte_bp.route("/login")
def login_page():
    if current_user():
        return redirect(url_for("teinte.home"))
    return render_template("teinte/login.html")


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
# API — comptes
# ---------------------------------------------------------------------------

@teinte_bp.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if len(username) < 3 or len(password) < 4:
        return jsonify(error="Pseudo (3+ car.) et mot de passe (4+ car.) requis."), 400
    db = get_db()
    exists = db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
        return jsonify(error="Ce pseudo est déjà pris."), 400
    db.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (username, generate_password_hash(password), now()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True)


@teinte_bp.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify(error="Identifiants incorrects."), 400
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True)


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
