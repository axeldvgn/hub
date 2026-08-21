import json
import os
import random
import sqlite3
import string
from datetime import datetime

from flask import Blueprint, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import generate_password_hash

from . import poker_engine as poker
from auth import current_hub_user, sync_local_account

DB_PATH = os.path.join(os.path.dirname(__file__), "casino.db")
SESSION_KEY = "casino_user_id"
MAX_PLAYERS = 5
STARTING_CHIPS = 1000
POKER_BUYIN = 500
SMALL_BLIND = 10
BIG_BLIND = 20

casino_bp = Blueprint(
    "casino",
    __name__,
    url_prefix="/casino",
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

GAME_TYPES = {
    "poker": "Poker (Texas Hold'em)",
    "roulette": "Roulette",
    "blackjack": "Blackjack",
    "dice": "Dés",
    "slots": "Machines à sous",
}

SKINS = [
    {"id": "default", "name": "Néon Rose", "color": "0xff2e8f", "price": 0},
    {"id": "gold", "name": "Or Royal", "color": "0xf3d67a", "price": 150},
    {"id": "emerald", "name": "Émeraude", "color": "0x1d9e75", "price": 150},
    {"id": "sapphire", "name": "Saphir", "color": "0x378add", "price": 150},
    {"id": "amethyst", "name": "Améthyste", "color": "0x7f77dd", "price": 200},
    {"id": "ember", "name": "Braise", "color": "0xd85a30", "price": 200},
    {"id": "platinum", "name": "Platine", "color": "0xe8e8e8", "price": 320},
    {"id": "cosmic", "name": "Cosmique", "color": "0x9b5de5", "price": 400},
]
SKINS_BY_ID = {s["id"]: s for s in SKINS}


# ---------------------------------------------------------------------------
# Base de données
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@casino_bp.teardown_app_request
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    chips INTEGER NOT NULL DEFAULT 1000,
    is_bot INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    hub_user_id INTEGER,
    equipped_skin TEXT NOT NULL DEFAULT 'default',
    owned_skins TEXT NOT NULL DEFAULT '["default"]'
);

CREATE TABLE IF NOT EXISTS salons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS salon_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT NOT NULL,
    UNIQUE(salon_id, user_id),
    FOREIGN KEY (salon_id) REFERENCES salons(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Une "table" est une instance de jeu (poker/roulette/blackjack/dés/machines à sous)
-- à l'intérieur d'un salon : chaque salon en a exactement 5, une par jeu.
CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salon_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL,
    UNIQUE(salon_id, game_type),
    FOREIGN KEY (salon_id) REFERENCES salons(id)
);

CREATE TABLE IF NOT EXISTS table_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    stack INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    UNIQUE(table_id, user_id),
    UNIQUE(table_id, seat),
    FOREIGN KEY (table_id) REFERENCES tables(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS poker_hands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    hand_number INTEGER NOT NULL,
    phase TEXT NOT NULL,
    community_cards TEXT NOT NULL DEFAULT '[]',
    deck TEXT NOT NULL DEFAULT '[]',
    pot INTEGER NOT NULL DEFAULT 0,
    current_bet INTEGER NOT NULL DEFAULT 0,
    min_raise INTEGER NOT NULL DEFAULT 20,
    dealer_seat INTEGER NOT NULL,
    turn_seat INTEGER,
    last_result TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS poker_hand_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    hole_cards TEXT NOT NULL,
    bet_street INTEGER NOT NULL DEFAULT 0,
    bet_total INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    has_acted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(hand_id, user_id)
);

CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'betting',
    result TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS round_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    bet_type TEXT NOT NULL,
    bet_value TEXT,
    amount INTEGER NOT NULL,
    payout INTEGER,
    UNIQUE(round_id, user_id)
);

CREATE TABLE IF NOT EXISTS blackjack_hands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    hand_number INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'betting',
    dealer_cards TEXT NOT NULL DEFAULT '[]',
    deck TEXT NOT NULL DEFAULT '[]',
    turn_seat INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blackjack_hand_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    cards TEXT NOT NULL DEFAULT '[]',
    bet INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'betting',
    UNIQUE(hand_id, user_id)
);
"""


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    cols = [row[1] for row in db.execute("PRAGMA table_info(users)")]
    if "is_bot" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0")
    if "hub_user_id" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN hub_user_id INTEGER")
    if "equipped_skin" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN equipped_skin TEXT NOT NULL DEFAULT 'default'")
    if "owned_skins" not in cols:
        db.execute("ALTER TABLE users ADD COLUMN owned_skins TEXT NOT NULL DEFAULT '[\"default\"]'")
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Aides générales
# ---------------------------------------------------------------------------

def now():
    return datetime.utcnow().isoformat()


def _create_synced_row(conn, username, hub_id):
    conn.execute(
        "INSERT INTO users (username, password_hash, chips, created_at, hub_user_id) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, generate_password_hash(os.urandom(16).hex()), STARTING_CHIPS, now(), hub_id),
    )
    conn.commit()


def current_user():
    uid = session.get(SESSION_KEY)
    if uid:
        user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if user:
            return user

    # Pas de session locale : si une session hub existe, on relie (ou crée)
    # automatiquement le compte casino correspondant — connexion unique.
    hub_user = current_hub_user()
    if not hub_user:
        return None
    db = get_db()
    user = sync_local_account(db, hub_user, _create_synced_row)
    session[SESSION_KEY] = user["id"]
    return user


def login_required(view):
    def wrapped(*args, **kwargs):
        if not current_user():
            return redirect(url_for("hub_auth.login_page", next=request.path))
        return view(*args, **kwargs)
    wrapped.__name__ = view.__name__
    return wrapped


def api_login_required(view):
    def wrapped(*args, **kwargs):
        if not current_user():
            return jsonify(error="Non connecté."), 401
        return view(*args, **kwargs)
    wrapped.__name__ = view.__name__
    return wrapped


def generate_code():
    db = get_db()
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
        exists = db.execute("SELECT 1 FROM salons WHERE code = ?", (code,)).fetchone()
        if not exists:
            return code


def get_salon_by_code(code):
    return get_db().execute("SELECT * FROM salons WHERE code = ?", (code.upper(),)).fetchone()


def get_salon_member(salon_id, user_id):
    return get_db().execute(
        "SELECT * FROM salon_members WHERE salon_id = ? AND user_id = ?", (salon_id, user_id)
    ).fetchone()


def get_salon_members(salon_id):
    return get_db().execute(
        """SELECT sm.*, u.username FROM salon_members sm JOIN users u ON u.id = sm.user_id
           WHERE sm.salon_id = ? ORDER BY sm.joined_at ASC""",
        (salon_id,),
    ).fetchall()


def get_game_table(salon_id, game_type):
    """La ligne 'tables' (instance de jeu) d'un salon pour un type de jeu donné.
    Les 5 instances sont créées en même temps que le salon, donc toujours présentes."""
    return get_db().execute(
        "SELECT * FROM tables WHERE salon_id = ? AND game_type = ?", (salon_id, game_type)
    ).fetchone()


def _salon_and_table(code, game_type):
    """Résout un code de salon + un type de jeu vers (salon, table). (None, None) si absent."""
    salon = get_salon_by_code(code)
    if not salon:
        return None, None
    return salon, get_game_table(salon["id"], game_type)


def get_table_players(table_id):
    return get_db().execute(
        """SELECT tp.*, u.username FROM table_players tp
           JOIN users u ON u.id = tp.user_id
           WHERE tp.table_id = ? ORDER BY tp.seat ASC""",
        (table_id,),
    ).fetchall()


def get_my_seat(table_id, user_id):
    row = get_db().execute(
        "SELECT * FROM table_players WHERE table_id = ? AND user_id = ?", (table_id, user_id)
    ).fetchone()
    return row


def rotate_from(seats, start_seat):
    """seats triés, renvoie la liste qui commence à start_seat et tourne."""
    idx = seats.index(start_seat)
    return seats[idx:] + seats[:idx]


# ---------------------------------------------------------------------------
# Bots — remplissent les sièges vides pour qu'on puisse jouer seul
# ---------------------------------------------------------------------------

BOT_NAMES = ["Léa", "Max", "Sam", "Nina", "Théo", "Iris", "Noah", "Zoé"]
BOT_BANKROLL = 1_000_000  # solde "infini" pour ne jamais bloquer une table par manque de jetons


def _ensure_bots(db, n):
    """Garantit qu'au moins n comptes-bots existent, les crée si besoin. Renvoie leurs lignes."""
    rows = db.execute("SELECT * FROM users WHERE is_bot = 1 ORDER BY id ASC").fetchall()
    if len(rows) < n:
        for name in BOT_NAMES:
            username = f"Bot {name}"
            exists = db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
            if not exists:
                db.execute(
                    "INSERT INTO users (username, password_hash, chips, is_bot, created_at) "
                    "VALUES (?, '', ?, 1, ?)",
                    (username, BOT_BANKROLL, now()),
                )
            if db.execute("SELECT COUNT(*) c FROM users WHERE is_bot = 1", ).fetchone()["c"] >= n:
                break
        rows = db.execute("SELECT * FROM users WHERE is_bot = 1 ORDER BY id ASC").fetchall()
    return rows[:max(n, len(rows))]


BOT_FREE_GAMES = {"roulette", "dice", "slots"}  # jeux contre la banque : pas besoin d'adversaires


def _fill_with_bots(db, table):
    """Complète les sièges vides d'une table avec des bots (jusqu'à MAX_PLAYERS).
    Inutile pour les jeux contre la banque (roulette/dés/machines à sous) : on y
    joue seul contre un résultat partagé, pas besoin d'adversaires assis."""
    if table["game_type"] in BOT_FREE_GAMES:
        return
    count = db.execute(
        "SELECT COUNT(*) c FROM table_players WHERE table_id = ?", (table["id"],)
    ).fetchone()["c"]
    missing = MAX_PLAYERS - count
    if missing <= 0:
        return
    bots = _ensure_bots(db, missing)
    used_ids = {r["user_id"] for r in db.execute(
        "SELECT user_id FROM table_players WHERE table_id = ?", (table["id"],)
    )}
    available_bots = [b for b in bots if b["id"] not in used_ids]
    for bot in available_bots[:missing]:
        stack = min(POKER_BUYIN, bot["chips"]) if table["game_type"] == "poker" else 0
        if stack:
            db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (stack, bot["id"]))
        _seat_player(db, table["id"], bot["id"], stack)


def _bot_replace_seat(db, table, human):
    """Si la table est pleine mais contient un bot, et qu'on est entre deux mains/manches,
    remplace ce bot par le joueur humain. Renvoie True si un siège a été libéré."""
    bot_tp = db.execute(
        """SELECT tp.* FROM table_players tp JOIN users u ON u.id = tp.user_id
           WHERE tp.table_id = ? AND u.is_bot = 1 ORDER BY tp.seat ASC LIMIT 1""",
        (table["id"],),
    ).fetchone()
    if not bot_tp:
        return False
    if not _table_is_between_hands(db, table):
        return False
    if bot_tp["stack"] > 0:
        db.execute("UPDATE users SET chips = chips + ? WHERE id = ?", (bot_tp["stack"], bot_tp["user_id"]))
    db.execute("DELETE FROM table_players WHERE id = ?", (bot_tp["id"],))
    stack = 0
    if table["game_type"] == "poker":
        stack = min(POKER_BUYIN, human["chips"])
        db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (stack, human["id"]))
    db.execute(
        "INSERT INTO table_players (table_id, user_id, seat, stack, joined_at) VALUES (?, ?, ?, ?, ?)",
        (table["id"], human["id"], bot_tp["seat"], stack, now()),
    )
    return True


def _table_is_between_hands(db, table):
    if table["game_type"] == "poker":
        hand_row = db.execute(
            "SELECT phase FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
        ).fetchone()
        return (not hand_row) or hand_row["phase"] == "done"
    if table["game_type"] == "blackjack":
        hand_row = db.execute(
            "SELECT phase FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
        ).fetchone()
        return (not hand_row) or hand_row["phase"] in ("betting", "done")
    round_row = db.execute(
        "SELECT phase FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    return (not round_row) or round_row["phase"] == "resolved"


def _run_bot_turns(db, table):
    """Fait agir tous les bots dont c'est le tour, en boucle, jusqu'à ce qu'il ne reste
    plus que des humains à faire attendre (ou que la main/manche soit terminée)."""
    game_type = table["game_type"]
    for _ in range(40):  # garde-fou anti-boucle-infinie
        acted = False
        if game_type == "poker":
            acted = _run_one_poker_bot(db, table)
        elif game_type == "blackjack":
            acted = _run_one_blackjack_bot(db, table)
        elif game_type in ("roulette", "dice", "slots"):
            acted = _run_one_round_bot(db, table)
        if not acted:
            break


def _run_one_poker_bot(db, table):
    hand_row = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] == "done" or hand_row["turn_seat"] is None:
        return False
    tp = db.execute(
        "SELECT * FROM table_players WHERE table_id = ? AND seat = ?", (table["id"], hand_row["turn_seat"])
    ).fetchone()
    bot_user = db.execute("SELECT * FROM users WHERE id = ? AND is_bot = 1", (tp["user_id"],)).fetchone()
    if not bot_user:
        return False
    hand_players = _poker_players_for_hand(db, hand_row["id"])
    me = next(p for p in hand_players if p["seat"] == tp["seat"])
    action, amount = _bot_poker_decision(hand_row, me, tp["stack"])
    _apply_poker_action(db, table["id"], hand_row, tp, action, amount)
    return True


def _preflop_strength(hole_cards):
    """Force approximative d'une main de départ (0..1), sans les cartes communes."""
    v1, v2 = poker.rank_value(hole_cards[0]["rank"]), poker.rank_value(hole_cards[1]["rank"])
    hi, lo = max(v1, v2), min(v1, v2)
    pair = v1 == v2
    suited = hole_cards[0]["suit"] == hole_cards[1]["suit"]
    gap = hi - lo
    score = (hi + lo) / 28.0
    if pair:
        score += 0.25 + (hi - 2) / 40.0
    if suited:
        score += 0.08
    if not pair and gap == 1:
        score += 0.05
    elif not pair and gap == 2:
        score += 0.02
    return max(0.0, min(1.0, score))


def _hand_strength(hole_cards, community_cards):
    """Force de la main (0..1) : heuristique avant le flop, évaluation réelle ensuite."""
    if not community_cards:
        return _preflop_strength(hole_cards)
    category, _ = poker.evaluate_best_of_7(hole_cards + community_cards)
    return max(0.0, min(1.0, (category + 1) / 9.0 + random.uniform(-0.03, 0.03)))


def _bot_poker_decision(hand_row, me, stack):
    """Décision d'un bot basée sur la force réelle de sa main plutôt que le hasard pur :
    il suit les cotes du pot, relance avec les mains fortes, se couche sur les mains
    faibles face à une grosse mise, et bluffe occasionnellement pour rester imprévisible."""
    to_call = hand_row["current_bet"] - me["bet_street"]
    hole = json.loads(me["hole_cards"])
    community = json.loads(hand_row["community_cards"])
    strength = _hand_strength(hole, community)
    bluff = random.random() < 0.08

    if to_call <= 0:
        if (strength > 0.55 or bluff) and stack > BIG_BLIND:
            size = BIG_BLIND * (3 if strength > 0.75 else 2)
            return "bet", min(size, stack)
        return "check", 0

    if to_call >= stack:
        threshold = 0.35 if to_call <= stack * 0.3 else 0.6
        return ("call", 0) if (strength > threshold or bluff) else ("fold", 0)

    pot_odds = to_call / max(1, hand_row["pot"] + to_call)
    if strength < pot_odds - 0.15 and not bluff:
        return "fold", 0
    if strength > 0.72 and random.random() < 0.55:
        raise_mult = 2 if strength > 0.85 else 1
        raise_amt = min(to_call + max(hand_row["min_raise"], BIG_BLIND) * raise_mult, stack)
        return "raise", raise_amt
    if bluff and random.random() < 0.3:
        raise_amt = min(to_call + max(hand_row["min_raise"], BIG_BLIND), stack)
        return "raise", raise_amt
    return "call", 0


def _run_one_blackjack_bot(db, table):
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row:
        return False
    if hand_row["phase"] == "betting":
        players = db.execute(
            "SELECT * FROM blackjack_hand_players WHERE hand_id = ?", (hand_row["id"],)
        ).fetchall()
        for p in players:
            bot_user = db.execute("SELECT * FROM users WHERE id = ? AND is_bot = 1", (p["user_id"],)).fetchone()
            if bot_user and p["bet"] == 0:
                amount = min(random.choice([20, 30, 50]), bot_user["chips"])
                if amount <= 0:
                    continue
                _apply_blackjack_bet(db, table, hand_row, bot_user, amount)
                return True
        return False
    if hand_row["phase"] != "playing" or hand_row["turn_seat"] is None:
        return False
    tp = db.execute(
        "SELECT * FROM table_players WHERE table_id = ? AND seat = ?", (table["id"], hand_row["turn_seat"])
    ).fetchone()
    bot_user = db.execute("SELECT * FROM users WHERE id = ? AND is_bot = 1", (tp["user_id"],)).fetchone()
    if not bot_user:
        return False
    hp = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND user_id = ?", (hand_row["id"], bot_user["id"])
    ).fetchone()
    value = _bj_value(json.loads(hp["cards"]))
    action = "hit" if value < 17 else "stand"
    _apply_blackjack_action(db, table["id"], hand_row, tp, bot_user["id"], action)
    return True


def _run_one_round_bot(db, table):
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not round_row or round_row["phase"] != "betting":
        return False
    seated = db.execute(
        """SELECT tp.user_id FROM table_players tp JOIN users u ON u.id = tp.user_id
           WHERE tp.table_id = ? AND u.is_bot = 1""",
        (table["id"],),
    ).fetchall()
    already_bet = {b["user_id"] for b in db.execute(
        "SELECT user_id FROM round_bets WHERE round_id = ?", (round_row["id"],)
    )}
    for row in seated:
        if row["user_id"] in already_bet:
            continue
        bot_user = db.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
        bet_type, bet_value, amount = _bot_round_bet(table["game_type"], bot_user["chips"])
        _apply_round_bet(db, table, bot_user, bet_type, bet_value, amount)
        return True
    return False


def _bot_round_bet(game_type, chips):
    amount = min(random.choice([20, 30, 50, 100]), max(10, chips))
    if game_type == "roulette":
        bet_type = random.choice(["red", "black", "even", "odd", "low", "high", "number"])
        bet_value = random.randint(0, 36) if bet_type == "number" else None
        return bet_type, bet_value, amount
    if game_type == "dice":
        return random.choice(["petit", "grand", "sept"]), None, amount
    return "spin", None, amount


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@casino_bp.route("/")
def home():
    if not current_user():
        return redirect(url_for("hub_auth.login_page", next=request.path))
    return render_template("casino/home.html", user=current_user(), game_types=GAME_TYPES)


GAME_ICONS = {"poker": "♠️", "roulette": "🎡", "blackjack": "🃏", "dice": "🎲", "slots": "🎰"}


@casino_bp.route("/salon/<code>")
@login_required
def salon_page(code):
    salon = get_salon_by_code(code)
    if not salon:
        return redirect(url_for("casino.home"))
    user = current_user()
    if not get_salon_member(salon["id"], user["id"]):
        return redirect(url_for("casino.home"))
    my_skin = SKINS_BY_ID.get(user["equipped_skin"], SKINS_BY_ID["default"])
    return render_template(
        "casino/table_3d.html", code=salon["code"], user=user,
        game_types=GAME_TYPES, game_icons=GAME_ICONS, my_skin_color=my_skin["color"],
    )


@casino_bp.route("/stats")
@login_required
def stats_page():
    return render_template("casino/stats.html", user=current_user())


# ---------------------------------------------------------------------------
# API — compte
# ---------------------------------------------------------------------------
# La connexion se fait au niveau du hub (voir /login) ; current_user()
# relie/crée automatiquement le compte casino correspondant. Seule la
# déconnexion reste exposée ici, et elle est globale (session.clear() vide
# aussi la session hub et celle des autres jeux).

@casino_bp.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# API — salons / tables
# ---------------------------------------------------------------------------

def _seat_player(db, table_id, user_id, stack=0):
    taken = {r["seat"] for r in db.execute(
        "SELECT seat FROM table_players WHERE table_id = ?", (table_id,)
    )}
    seat = next(s for s in range(MAX_PLAYERS) if s not in taken)
    db.execute(
        "INSERT INTO table_players (table_id, user_id, seat, stack, joined_at) VALUES (?, ?, ?, ?, ?)",
        (table_id, user_id, seat, stack, now()),
    )
    return seat


def _launch_table(db, table):
    """Démarre la partie (statut playing + première main/manche + rattrapage des bots)."""
    table_id, game_type = table["id"], table["game_type"]
    db.execute("UPDATE tables SET status = 'playing' WHERE id = ?", (table_id,))
    if game_type == "poker":
        _start_poker_hand(db, table_id)
    elif game_type == "blackjack":
        _start_blackjack_hand(db, table_id)
    else:
        _start_round(db, table_id)
    _run_bot_turns(db, table)


def _leave_current_seat(db, salon_id, user):
    """Quitte proprement le siège que user occupe (au plus un, parmi les 5 tables du
    salon) : se couche/reste si une main est en cours pour ne pas bloquer les autres,
    rembourse le tapis restant. Ne fait rien si user n'est assis nulle part."""
    game_tables = db.execute("SELECT * FROM tables WHERE salon_id = ?", (salon_id,)).fetchall()
    for table in game_tables:
        tp = get_my_seat(table["id"], user["id"])
        if not tp:
            continue
        if table["game_type"] == "poker":
            hand_row = db.execute(
                "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1",
                (table["id"],),
            ).fetchone()
            if hand_row and hand_row["phase"] != "done":
                hp = db.execute(
                    "SELECT * FROM poker_hand_players WHERE hand_id = ? AND user_id = ?",
                    (hand_row["id"], user["id"]),
                ).fetchone()
                if hp and hp["status"] == "active":
                    _apply_poker_action(db, table["id"], hand_row, tp, "fold", 0)
        elif table["game_type"] == "blackjack":
            hand_row = db.execute(
                "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1",
                (table["id"],),
            ).fetchone()
            if hand_row and hand_row["phase"] == "playing" and hand_row["turn_seat"] == tp["seat"]:
                _apply_blackjack_action(db, table["id"], hand_row, tp, user["id"], "stand")
        tp = get_my_seat(table["id"], user["id"])  # re-lire (le tapis a pu changer via fold/stand)
        if tp:
            if tp["stack"] > 0:
                db.execute("UPDATE users SET chips = chips + ? WHERE id = ?", (tp["stack"], user["id"]))
            db.execute("DELETE FROM table_players WHERE id = ?", (tp["id"],))
        return table["game_type"]
    return None


@casino_bp.route("/api/salon/create", methods=["POST"])
@api_login_required
def api_create_salon():
    db = get_db()
    user = current_user()
    code = generate_code()
    cur = db.execute(
        "INSERT INTO salons (code, host_id, created_at) VALUES (?, ?, ?)",
        (code, user["id"], now()),
    )
    salon_id = cur.lastrowid
    db.execute(
        "INSERT INTO salon_members (salon_id, user_id, joined_at) VALUES (?, ?, ?)",
        (salon_id, user["id"], now()),
    )
    for game_type in GAME_TYPES:
        db.execute(
            "INSERT INTO tables (salon_id, game_type, status, created_at) VALUES (?, ?, 'waiting', ?)",
            (salon_id, game_type, now()),
        )
    db.commit()
    return jsonify(ok=True, code=code)


@casino_bp.route("/api/salon/join", methods=["POST"])
@api_login_required
def api_join_salon():
    data = request.get_json(force=True)
    code = (data.get("code") or "").strip().upper()
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    if get_salon_member(salon["id"], user["id"]):
        return jsonify(ok=True, code=salon["code"])
    count = len(get_salon_members(salon["id"]))
    if count >= MAX_PLAYERS:
        return jsonify(error="Ce salon est complet (5 joueurs max)."), 400
    db.execute(
        "INSERT INTO salon_members (salon_id, user_id, joined_at) VALUES (?, ?, ?)",
        (salon["id"], user["id"], now()),
    )
    db.commit()
    return jsonify(ok=True, code=salon["code"])


@casino_bp.route("/api/salon/<code>/leave", methods=["POST"])
@api_login_required
def api_leave_salon(code):
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    _leave_current_seat(db, salon["id"], user)
    db.execute(
        "DELETE FROM salon_members WHERE salon_id = ? AND user_id = ?", (salon["id"], user["id"])
    )
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/<game_type>/stand", methods=["POST"])
@api_login_required
def api_stand(code, game_type):
    if game_type not in GAME_TYPES:
        return jsonify(error="Type de jeu invalide."), 404
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    _leave_current_seat(db, salon["id"], user)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/poker/rebuy", methods=["POST"])
@api_login_required
def api_rebuy(code):
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    table = get_game_table(salon["id"], "poker")
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 400
    amount = min(POKER_BUYIN, user["chips"])
    if amount <= 0:
        return jsonify(error="Solde insuffisant."), 400
    db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (amount, user["id"]))
    db.execute("UPDATE table_players SET stack = stack + ? WHERE id = ?", (amount, tp["id"]))
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/<game_type>/sit", methods=["POST"])
@api_login_required
def api_sit(code, game_type):
    if game_type not in GAME_TYPES:
        return jsonify(error="Type de jeu invalide."), 400
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    if not get_salon_member(salon["id"], user["id"]):
        return jsonify(error="Vous ne faites pas partie de ce salon."), 403
    table = get_game_table(salon["id"], game_type)

    already_here = get_my_seat(table["id"], user["id"])
    if not already_here:
        left_type = _leave_current_seat(db, salon["id"], user)
        if left_type == game_type:
            already_here = get_my_seat(table["id"], user["id"])

    if not already_here:
        count = db.execute(
            "SELECT COUNT(*) c FROM table_players WHERE table_id = ?", (table["id"],)
        ).fetchone()["c"]
        if count >= MAX_PLAYERS:
            if not _bot_replace_seat(db, table, user):
                db.commit()
                return jsonify(error="Cette table est complète. Réessayez entre deux manches "
                                      "pour prendre la place d'un bot."), 400
        else:
            stack = 0
            if game_type == "poker":
                if user["chips"] < 20:
                    db.commit()
                    return jsonify(error="Il vous faut au moins 20 jetons pour vous asseoir au poker."), 400
                stack = min(POKER_BUYIN, user["chips"])
                db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (stack, user["id"]))
            _seat_player(db, table["id"], user["id"], stack)

    table = db.execute("SELECT * FROM tables WHERE id = ?", (table["id"],)).fetchone()
    if table["status"] != "playing":
        _fill_with_bots(db, table)
        _launch_table(db, table)
    else:
        _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/state")
@api_login_required
def api_salon_state(code):
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    if not get_salon_member(salon["id"], user["id"]):
        return jsonify(error="Vous ne faites pas partie de ce salon."), 403
    members = get_salon_members(salon["id"])
    my_seat_game = None
    occupancy = {}
    for table in db.execute("SELECT * FROM tables WHERE salon_id = ?", (salon["id"],)):
        if get_my_seat(table["id"], user["id"]):
            my_seat_game = table["game_type"]
        seated = db.execute(
            """SELECT tp.seat, u.username, u.is_bot, u.equipped_skin FROM table_players tp
               JOIN users u ON u.id = tp.user_id WHERE tp.table_id = ? ORDER BY tp.seat ASC""",
            (table["id"],),
        ).fetchall()
        occupancy[table["game_type"]] = [
            {"seat": s["seat"], "username": s["username"], "is_bot": bool(s["is_bot"]),
             "color": SKINS_BY_ID.get(s["equipped_skin"], SKINS_BY_ID["default"])["color"]}
            for s in seated
        ]
    return jsonify({
        "code": salon["code"],
        "host_id": salon["host_id"],
        "is_host": salon["host_id"] == user["id"],
        "my_chips": user["chips"],
        "my_seat_game": my_seat_game,
        "members": [{"user_id": m["user_id"], "username": m["username"]} for m in members],
        "tables": occupancy,
    })


@casino_bp.route("/api/salon/<code>/<game_type>/state")
@api_login_required
def api_table_state(code, game_type):
    if game_type not in GAME_TYPES:
        return jsonify(error="Type de jeu invalide."), 404
    salon = get_salon_by_code(code)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    table = get_game_table(salon["id"], game_type)
    players = get_table_players(table["id"])
    my_tp = next((p for p in players if p["user_id"] == user["id"]), None)
    if not my_tp:
        return jsonify(error="Vous n'êtes pas assis à cette table."), 403

    if table["status"] == "playing":
        _run_bot_turns(db, table)
        db.commit()
        players = get_table_players(table["id"])

    payload = {
        "code": salon["code"],
        "game_type": table["game_type"],
        "game_label": GAME_TYPES.get(table["game_type"], table["game_type"]),
        "status": table["status"],
        "host_id": salon["host_id"],
        "is_host": salon["host_id"] == user["id"],
        "my_seat": my_tp["seat"],
        "my_chips": user["chips"],
        "players": [
            {"user_id": p["user_id"], "username": p["username"], "seat": p["seat"], "stack": p["stack"]}
            for p in players
        ],
    }

    if table["status"] == "playing":
        if table["game_type"] == "poker":
            payload["game"] = _poker_state(db, table["id"], user["id"])
        elif table["game_type"] == "blackjack":
            payload["game"] = _blackjack_state(db, table["id"], user["id"])
        else:
            payload["game"] = _round_state(db, table["id"], table["game_type"], user["id"])

    return jsonify(payload)


# ---------------------------------------------------------------------------
# Poker — Texas Hold'em
# ---------------------------------------------------------------------------

def _poker_players_for_hand(db, hand_id):
    return db.execute(
        """SELECT php.*, u.username FROM poker_hand_players php
           JOIN users u ON u.id = php.user_id
           WHERE php.hand_id = ? ORDER BY php.seat ASC""",
        (hand_id,),
    ).fetchall()


def _start_poker_hand(db, table_id):
    eligible = db.execute(
        """SELECT tp.*, u.username FROM table_players tp JOIN users u ON u.id = tp.user_id
           WHERE tp.table_id = ? AND tp.stack > 0 ORDER BY tp.seat ASC""",
        (table_id,),
    ).fetchall()
    if len(eligible) < 2:
        return
    seats = [p["seat"] for p in eligible]
    prev = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table_id,)
    ).fetchone()
    hand_number = (prev["hand_number"] + 1) if prev else 1
    if prev and prev["dealer_seat"] in seats:
        prev_idx = seats.index(prev["dealer_seat"])
        dealer_seat = seats[(prev_idx + 1) % len(seats)]
    elif prev:
        # l'ancien donneur n'est plus assis : on prend le prochain siège occupé
        dealer_seat = next((s for s in seats if s > prev["dealer_seat"]), seats[0])
    else:
        dealer_seat = seats[0]

    rotated = rotate_from(seats, dealer_seat)
    n = len(rotated)
    deck = poker.build_deck()

    seat_to_userid = {p["seat"]: p["user_id"] for p in eligible}
    seat_to_stack = {p["seat"]: p["stack"] for p in eligible}

    hole_by_seat = {s: [deck.pop(), deck.pop()] for s in seats}

    cur = db.execute(
        """INSERT INTO poker_hands (table_id, hand_number, phase, community_cards, deck, pot,
             current_bet, min_raise, dealer_seat, turn_seat, created_at)
           VALUES (?, ?, 'preflop', '[]', ?, 0, 0, ?, ?, NULL, ?)""",
        (table_id, hand_number, json.dumps(deck), BIG_BLIND, dealer_seat, now()),
    )
    hand_id = cur.lastrowid

    for s in seats:
        db.execute(
            """INSERT INTO poker_hand_players (hand_id, user_id, seat, hole_cards, bet_street,
                 bet_total, status, has_acted) VALUES (?, ?, ?, ?, 0, 0, 'active', 0)""",
            (hand_id, seat_to_userid[s], s, json.dumps(hole_by_seat[s])),
        )

    def post_blind(seat, amount):
        stack = seat_to_stack[seat]
        pay = min(amount, stack)
        seat_to_stack[seat] = stack - pay
        db.execute(
            "UPDATE table_players SET stack = ? WHERE table_id = ? AND seat = ?",
            (seat_to_stack[seat], table_id, seat),
        )
        db.execute(
            """UPDATE poker_hand_players SET bet_street = bet_street + ?, bet_total = bet_total + ?,
                 status = CASE WHEN ? >= ? THEN 'all_in' ELSE status END
               WHERE hand_id = ? AND seat = ?""",
            (pay, pay, pay, stack, hand_id, seat),
        )
        return pay

    if n == 2:
        sb_seat, bb_seat = rotated[0], rotated[1]
        first_preflop = rotated[0]
    else:
        sb_seat, bb_seat = rotated[1], rotated[2]
        first_preflop = rotated[3 % n]

    sb_paid = post_blind(sb_seat, SMALL_BLIND)
    bb_paid = post_blind(bb_seat, BIG_BLIND)
    pot = sb_paid + bb_paid
    db.execute(
        "UPDATE poker_hands SET pot = ?, current_bet = ?, turn_seat = ? WHERE id = ?",
        (pot, bb_paid, first_preflop, hand_id),
    )


def _next_to_act(hand_players, rotated, current_bet, after_seat):
    by_seat = {p["seat"]: p for p in hand_players}
    n = len(rotated)
    start_idx = rotated.index(after_seat)
    for i in range(1, n + 1):
        seat = rotated[(start_idx + i) % n]
        p = by_seat.get(seat)
        if p and p["status"] == "active" and (p["bet_street"] < current_bet or not p["has_acted"]):
            return seat
    return None


def _first_active_after(hand_players, rotated, from_seat):
    by_seat = {p["seat"]: p for p in hand_players}
    n = len(rotated)
    start_idx = rotated.index(from_seat)
    for i in range(0, n):
        seat = rotated[(start_idx + i) % n]
        p = by_seat.get(seat)
        if p and p["status"] == "active":
            return seat
    return None


def _finish_poker_hand(db, table_id, hand_row, hand_players, community_cards):
    contributions = [
        {"user_id": p["user_id"], "bet_total": p["bet_total"], "folded": p["status"] == "folded"}
        for p in hand_players
    ]
    hole_by_user = {p["user_id"]: json.loads(p["hole_cards"]) for p in hand_players}
    seats = sorted(p["seat"] for p in hand_players)
    rotated = rotate_from(seats, hand_row["dealer_seat"])
    by_seat = {p["seat"]: p for p in hand_players}
    seat_order_from_dealer = [by_seat[s]["user_id"] for s in (rotated[1:] + rotated[:1])]

    non_folded = [p for p in hand_players if p["status"] != "folded"]
    if len(non_folded) == 1:
        winner = non_folded[0]
        winnings = {winner["user_id"]: hand_row["pot"]}
        breakdown = [{"amount": hand_row["pot"], "winners": [winner["user_id"]], "hand": None}]
        reveal = []
    else:
        pots = poker.compute_side_pots(contributions)
        winnings, breakdown = poker.resolve_pots(pots, hole_by_user, community_cards, seat_order_from_dealer)
        reveal = [
            {"user_id": p["user_id"], "username": p["username"], "hole_cards": hole_by_user[p["user_id"]]}
            for p in non_folded
        ]

    for p in hand_players:
        win = winnings.get(p["user_id"], 0)
        if win:
            db.execute(
                "UPDATE table_players SET stack = stack + ? WHERE table_id = ? AND user_id = ?",
                (win, table_id, p["user_id"]),
            )

    result = {
        "pot": hand_row["pot"],
        "breakdown": [
            {"amount": b["amount"], "hand": b["hand"],
             "winners": [{"user_id": uid, "username": by_seat_uid(hand_players, uid)} for uid in b["winners"]]}
            for b in breakdown
        ],
        "reveal": reveal,
        "community_cards": community_cards,
    }
    db.execute(
        "UPDATE poker_hands SET phase = 'done', turn_seat = NULL, last_result = ?, ended_at = ? WHERE id = ?",
        (json.dumps(result), now(), hand_row["id"]),
    )


def by_seat_uid(hand_players, uid):
    for p in hand_players:
        if p["user_id"] == uid:
            return p["username"]
    return "?"


def _advance_poker_street(db, hand_row, hand_players):
    deck = json.loads(hand_row["deck"])
    community = json.loads(hand_row["community_cards"])
    phase = hand_row["phase"]
    if phase == "preflop":
        community += [deck.pop() for _ in range(3)]
        new_phase = "flop"
    elif phase == "flop":
        community += [deck.pop()]
        new_phase = "turn"
    elif phase == "turn":
        community += [deck.pop()]
        new_phase = "river"
    else:
        _finish_poker_hand(db, hand_row["table_id"], hand_row, hand_players, community)
        return

    for p in hand_players:
        db.execute(
            "UPDATE poker_hand_players SET bet_street = 0, has_acted = 0 WHERE id = ?", (p["id"],)
        )

    non_folded = [p for p in hand_players if p["status"] != "folded"]
    active_can_act = [p for p in non_folded if p["status"] == "active"]
    seats = sorted(p["seat"] for p in hand_players)
    rotated = rotate_from(seats, hand_row["dealer_seat"])

    if len(active_can_act) <= 1:
        db.execute(
            "UPDATE poker_hands SET phase = ?, community_cards = ?, deck = ?, current_bet = 0, turn_seat = NULL WHERE id = ?",
            (new_phase, json.dumps(community), json.dumps(deck), hand_row["id"]),
        )
        refreshed = dict(hand_row)
        refreshed["phase"] = new_phase
        refreshed["community_cards"] = json.dumps(community)
        refreshed["deck"] = json.dumps(deck)
        refreshed_players = _poker_players_for_hand(db, hand_row["id"])
        _advance_poker_street(db, refreshed, refreshed_players)
        return

    turn_seat = _first_active_after(non_folded, rotated, rotated[1 % len(rotated)] if len(rotated) > 1 else rotated[0])
    db.execute(
        """UPDATE poker_hands SET phase = ?, community_cards = ?, deck = ?, current_bet = 0,
             min_raise = ?, turn_seat = ? WHERE id = ?""",
        (new_phase, json.dumps(community), json.dumps(deck), BIG_BLIND, turn_seat, hand_row["id"]),
    )


@casino_bp.route("/api/salon/<code>/poker/action", methods=["POST"])
@api_login_required
def api_poker_action(code):
    salon, table = _salon_and_table(code, "poker")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 403

    hand_row = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] in ("done",):
        return jsonify(error="Aucune main en cours."), 400
    if hand_row["turn_seat"] != tp["seat"]:
        return jsonify(error="Ce n'est pas votre tour."), 400

    data = request.get_json(force=True)
    action = data.get("action")
    amount = int(data.get("amount") or 0)
    error = _apply_poker_action(db, table["id"], hand_row, tp, action, amount)
    if error:
        return jsonify(error=error), 400
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _apply_poker_action(db, table_id, hand_row, tp, action, amount):
    """Applique une action de poker (fold/check/call/bet/raise) pour le siège tp,
    fait avancer le tour/la rue si besoin. Retourne un message d'erreur (str) ou None.
    Utilisé à la fois par la route HTTP et par le moteur de bots."""
    hand_players = _poker_players_for_hand(db, hand_row["id"])
    by_seat = {p["seat"]: p for p in hand_players}
    me = by_seat[tp["seat"]]

    current_bet = hand_row["current_bet"]
    to_call = current_bet - me["bet_street"]
    stack = tp["stack"]

    if action == "fold":
        db.execute("UPDATE poker_hand_players SET status = 'folded', has_acted = 1 WHERE id = ?", (me["id"],))
        me = dict(me); me["status"] = "folded"; me["has_acted"] = 1
    elif action == "check":
        if to_call > 0:
            return "Vous devez suivre ou vous coucher."
        db.execute("UPDATE poker_hand_players SET has_acted = 1 WHERE id = ?", (me["id"],))
        me = dict(me); me["has_acted"] = 1
    elif action == "call":
        pay = min(to_call, stack)
        new_stack = stack - pay
        new_status = "all_in" if pay >= stack else me["status"]
        db.execute("UPDATE table_players SET stack = ? WHERE id = ?", (new_stack, tp["id"]))
        db.execute(
            "UPDATE poker_hand_players SET bet_street = bet_street + ?, bet_total = bet_total + ?, status = ?, has_acted = 1 WHERE id = ?",
            (pay, pay, new_status, me["id"]),
        )
        db.execute("UPDATE poker_hands SET pot = pot + ? WHERE id = ?", (pay, hand_row["id"]))
        me = dict(me); me["bet_street"] += pay; me["bet_total"] += pay; me["status"] = new_status; me["has_acted"] = 1
    elif action in ("bet", "raise"):
        if amount <= 0 or amount > stack:
            return "Montant invalide."
        target_total = me["bet_street"] + amount
        is_all_in = amount == stack
        min_needed = BIG_BLIND if current_bet == 0 else hand_row["min_raise"]
        if not is_all_in and (target_total - current_bet) < min_needed:
            return f"La relance minimum est de {min_needed} jetons."
        new_stack = stack - amount
        new_status = "all_in" if is_all_in else me["status"]
        db.execute("UPDATE table_players SET stack = ? WHERE id = ?", (new_stack, tp["id"]))
        db.execute(
            "UPDATE poker_hand_players SET bet_street = ?, bet_total = bet_total + ?, status = ?, has_acted = 1 WHERE id = ?",
            (target_total, amount, new_status, me["id"]),
        )
        raise_increment = target_total - current_bet
        new_min_raise = raise_increment if raise_increment >= hand_row["min_raise"] else hand_row["min_raise"]
        db.execute(
            "UPDATE poker_hands SET pot = pot + ?, current_bet = ?, min_raise = ? WHERE id = ?",
            (amount, target_total, new_min_raise, hand_row["id"]),
        )
        if target_total > current_bet:
            db.execute(
                "UPDATE poker_hand_players SET has_acted = 0 WHERE hand_id = ? AND id != ? AND status = 'active'",
                (hand_row["id"], me["id"]),
            )
        me = dict(me); me["bet_street"] = target_total; me["bet_total"] += amount; me["status"] = new_status; me["has_acted"] = 1
    else:
        return "Action inconnue."

    hand_row = db.execute("SELECT * FROM poker_hands WHERE id = ?", (hand_row["id"],)).fetchone()
    hand_players = _poker_players_for_hand(db, hand_row["id"])
    non_folded = [p for p in hand_players if p["status"] != "folded"]

    if len(non_folded) == 1:
        _finish_poker_hand(db, table_id, hand_row, hand_players, json.loads(hand_row["community_cards"]))
        return None

    seats = sorted(p["seat"] for p in hand_players)
    rotated = rotate_from(seats, hand_row["dealer_seat"])
    next_seat = _next_to_act(hand_players, rotated, hand_row["current_bet"], tp["seat"])

    if next_seat is None:
        _advance_poker_street(db, hand_row, hand_players)
    else:
        db.execute("UPDATE poker_hands SET turn_seat = ? WHERE id = ?", (next_seat, hand_row["id"]))
    return None


@casino_bp.route("/api/salon/<code>/poker/next-hand", methods=["POST"])
@api_login_required
def api_poker_next_hand(code):
    salon, table = _salon_and_table(code, "poker")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    user = current_user()
    if salon["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la main suivante."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if hand_row and hand_row["phase"] != "done":
        return jsonify(error="La main en cours n'est pas terminée."), 400
    _start_poker_hand(db, table["id"])
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _poker_state(db, table_id, user_id):
    hand_row = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table_id,)
    ).fetchone()
    if not hand_row:
        return {"phase": "idle"}
    hand_players = _poker_players_for_hand(db, hand_row["id"])
    show_all = hand_row["phase"] == "done"

    def card_view(p):
        if p["user_id"] == user_id or show_all:
            return json.loads(p["hole_cards"])
        return None

    me = next((p for p in hand_players if p["user_id"] == user_id), None)
    my_seat = me["seat"] if me else None
    to_call = 0
    min_raise_total = 0
    if me and hand_row["turn_seat"] == my_seat and hand_row["phase"] != "done":
        to_call = min(hand_row["current_bet"] - me["bet_street"], _stack_for(db, table_id, user_id))
        min_raise_total = hand_row["min_raise"]

    my_hand_label = None
    if me and me["status"] != "folded":
        my_hole = json.loads(me["hole_cards"])
        community = json.loads(hand_row["community_cards"])
        if community:
            category, _ = poker.evaluate_best_of_7(my_hole + community)
            my_hand_label = poker.hand_label((category, _))
        elif my_hole[0]["rank"] == my_hole[1]["rank"]:
            my_hand_label = f"Paire de {my_hole[0]['rank']}"

    return {
        "hand_number": hand_row["hand_number"],
        "phase": hand_row["phase"],
        "community_cards": json.loads(hand_row["community_cards"]),
        "pot": hand_row["pot"],
        "current_bet": hand_row["current_bet"],
        "min_raise": hand_row["min_raise"],
        "dealer_seat": hand_row["dealer_seat"],
        "turn_seat": hand_row["turn_seat"],
        "my_turn": hand_row["turn_seat"] == my_seat if me else False,
        "to_call": to_call,
        "min_raise_total": min_raise_total,
        "my_hand_label": my_hand_label,
        "last_result": json.loads(hand_row["last_result"]) if hand_row["last_result"] else None,
        "players": [
            {
                "user_id": p["user_id"], "username": p["username"], "seat": p["seat"],
                "bet_street": p["bet_street"], "bet_total": p["bet_total"], "status": p["status"],
                "hole_cards": card_view(p),
            }
            for p in hand_players
        ],
    }


def _stack_for(db, table_id, user_id):
    row = db.execute(
        "SELECT stack FROM table_players WHERE table_id = ? AND user_id = ?", (table_id, user_id)
    ).fetchone()
    return row["stack"] if row else 0


# ---------------------------------------------------------------------------
# Roulette / Dés / Machines à sous — résultat partagé, mises individuelles
# ---------------------------------------------------------------------------

WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
               16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
RED_NUMBERS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
SLOT_SYMS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣']


def _start_round(db, table_id):
    prev = db.execute(
        "SELECT MAX(round_number) n FROM rounds WHERE table_id = ?", (table_id,)
    ).fetchone()
    round_number = (prev["n"] or 0) + 1
    db.execute(
        "INSERT INTO rounds (table_id, round_number, phase, created_at) VALUES (?, ?, 'betting', ?)",
        (table_id, round_number, now()),
    )


def _resolve_round(db, table, round_row):
    game_type = table["game_type"]
    bets = db.execute("SELECT * FROM round_bets WHERE round_id = ?", (round_row["id"],)).fetchall()

    if game_type == "roulette":
        number = random.randint(0, 36)
        color = "vert" if number == 0 else ("rouge" if number in RED_NUMBERS else "noir")
        result = {"number": number, "color": color}
        for b in bets:
            win = 0
            if b["bet_type"] == "number" and int(b["bet_value"]) == number:
                win = b["amount"] * 36
            elif b["bet_type"] == "red" and color == "rouge":
                win = b["amount"] * 2
            elif b["bet_type"] == "black" and color == "noir":
                win = b["amount"] * 2
            elif b["bet_type"] == "even" and number != 0 and number % 2 == 0:
                win = b["amount"] * 2
            elif b["bet_type"] == "odd" and number % 2 == 1:
                win = b["amount"] * 2
            elif b["bet_type"] == "low" and 1 <= number <= 18:
                win = b["amount"] * 2
            elif b["bet_type"] == "high" and 19 <= number <= 36:
                win = b["amount"] * 2
            _settle_bet(db, b, win)
    elif game_type == "dice":
        d1, d2 = random.randint(1, 6), random.randint(1, 6)
        total = d1 + d2
        result = {"d1": d1, "d2": d2, "total": total}
        for b in bets:
            win = 0
            if b["bet_type"] == "sept" and total == 7:
                win = b["amount"] * 5
            elif b["bet_type"] == "petit" and 2 <= total <= 6:
                win = b["amount"] * 2
            elif b["bet_type"] == "grand" and 8 <= total <= 12:
                win = b["amount"] * 2
            _settle_bet(db, b, win)
    else:  # slots
        symbols = [random.choice(SLOT_SYMS) for _ in range(3)]
        result = {"symbols": symbols}
        for b in bets:
            win = 0
            if symbols[0] == symbols[1] == symbols[2]:
                mult = 50 if symbols[0] == '7️⃣' else (20 if symbols[0] == '💎' else 10)
                win = b["amount"] * mult
            elif symbols[0] == symbols[1] or symbols[1] == symbols[2] or symbols[0] == symbols[2]:
                win = b["amount"] * 2
            _settle_bet(db, b, win)

    db.execute(
        "UPDATE rounds SET phase = 'resolved', result = ?, resolved_at = ? WHERE id = ?",
        (json.dumps(result), now(), round_row["id"]),
    )


def _settle_bet(db, bet_row, win):
    db.execute("UPDATE round_bets SET payout = ? WHERE id = ?", (win, bet_row["id"]))
    if win > 0:
        db.execute("UPDATE users SET chips = chips + ? WHERE id = ?", (win, bet_row["user_id"]))


@casino_bp.route("/api/salon/<code>/round/<game_type>/bet", methods=["POST"])
@api_login_required
def api_round_bet(code, game_type):
    if game_type not in ("roulette", "dice", "slots"):
        return jsonify(error="Type de jeu invalide."), 404
    salon, table = _salon_and_table(code, game_type)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 403
    data = request.get_json(force=True)
    amount = int(data.get("amount") or 0)
    bet_type = data.get("bet_type") or "spin"
    bet_value = data.get("bet_value")
    error = _apply_round_bet(db, table, user, bet_type, bet_value, amount)
    if error:
        return jsonify(error=error), 400
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _apply_round_bet(db, table, user, bet_type, bet_value, amount):
    """Place une mise pour user sur la manche en cours (roulette/dés/slots).
    Retourne un message d'erreur (str) ou None. Utilisé par la route HTTP et les bots."""
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not round_row or round_row["phase"] != "betting":
        return "Les mises ne sont pas ouvertes."
    already = db.execute(
        "SELECT 1 FROM round_bets WHERE round_id = ? AND user_id = ?", (round_row["id"], user["id"])
    ).fetchone()
    if already:
        return "Vous avez déjà misé sur cette manche."
    if amount <= 0 or amount > user["chips"]:
        return "Mise invalide."
    db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (amount, user["id"]))
    db.execute(
        "INSERT INTO round_bets (round_id, user_id, bet_type, bet_value, amount) VALUES (?, ?, ?, ?, ?)",
        (round_row["id"], user["id"], bet_type, str(bet_value) if bet_value is not None else None, amount),
    )
    players = get_table_players(table["id"])
    bet_count = db.execute(
        "SELECT COUNT(*) c FROM round_bets WHERE round_id = ?", (round_row["id"],)
    ).fetchone()["c"]
    if bet_count >= len(players):
        _resolve_round(db, table, round_row)
    return None


@casino_bp.route("/api/salon/<code>/round/<game_type>/resolve", methods=["POST"])
@api_login_required
def api_round_resolve(code, game_type):
    if game_type not in ("roulette", "dice", "slots"):
        return jsonify(error="Type de jeu invalide."), 404
    salon, table = _salon_and_table(code, game_type)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    user = current_user()
    if salon["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut forcer le lancer."), 403
    db = get_db()
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not round_row or round_row["phase"] != "betting":
        return jsonify(ok=True)
    _resolve_round(db, table, round_row)
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/round/<game_type>/next", methods=["POST"])
@api_login_required
def api_round_next(code, game_type):
    if game_type not in ("roulette", "dice", "slots"):
        return jsonify(error="Type de jeu invalide."), 404
    salon, table = _salon_and_table(code, game_type)
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    user = current_user()
    if salon["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la manche suivante."), 403
    db = get_db()
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if round_row and round_row["phase"] != "resolved":
        return jsonify(error="La manche en cours n'est pas terminée."), 400
    _start_round(db, table["id"])
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _round_state(db, table_id, game_type, user_id):
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table_id,)
    ).fetchone()
    if not round_row:
        return {"phase": "idle"}
    bets = db.execute(
        """SELECT rb.*, u.username FROM round_bets rb JOIN users u ON u.id = rb.user_id
           WHERE rb.round_id = ?""",
        (round_row["id"],),
    ).fetchall()
    my_bet = next((b for b in bets if b["user_id"] == user_id), None)
    return {
        "round_number": round_row["round_number"],
        "phase": round_row["phase"],
        "result": json.loads(round_row["result"]) if round_row["result"] else None,
        "my_bet": {"bet_type": my_bet["bet_type"], "bet_value": my_bet["bet_value"],
                    "amount": my_bet["amount"], "payout": my_bet["payout"]} if my_bet else None,
        "bets": [
            {"username": b["username"], "bet_type": b["bet_type"], "bet_value": b["bet_value"],
             "amount": b["amount"], "payout": b["payout"]}
            for b in bets
        ] if round_row["phase"] == "resolved" else [],
        "bet_count": len(bets),
    }


# ---------------------------------------------------------------------------
# Blackjack multijoueur — croupier partagé, tours séquentiels
# ---------------------------------------------------------------------------

def _bj_draw(deck):
    if not deck:
        deck.extend(poker.build_deck())
    return deck.pop()


def _bj_value(cards):
    total, aces = 0, 0
    for c in cards:
        r = c["rank"]
        if r == "A":
            total += 11
            aces += 1
        elif r in ("V", "D", "R"):
            total += 10
        else:
            total += int(r)
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1
    return total


def _start_blackjack_hand(db, table_id):
    players = db.execute(
        """SELECT tp.*, u.username, u.chips FROM table_players tp JOIN users u ON u.id = tp.user_id
           WHERE tp.table_id = ? ORDER BY tp.seat ASC""",
        (table_id,),
    ).fetchall()
    prev = db.execute(
        "SELECT MAX(hand_number) n FROM blackjack_hands WHERE table_id = ?", (table_id,)
    ).fetchone()
    hand_number = (prev["n"] or 0) + 1
    cur = db.execute(
        "INSERT INTO blackjack_hands (table_id, hand_number, phase, dealer_cards, deck, turn_seat, created_at) "
        "VALUES (?, ?, 'betting', '[]', '[]', NULL, ?)",
        (table_id, hand_number, now()),
    )
    hand_id = cur.lastrowid
    for p in players:
        db.execute(
            "INSERT INTO blackjack_hand_players (hand_id, user_id, seat, cards, bet, status) "
            "VALUES (?, ?, ?, '[]', 0, 'betting')",
            (hand_id, p["user_id"], p["seat"]),
        )


def _bj_deal(db, hand_row):
    deck = poker.build_deck()
    players = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? ORDER BY seat ASC", (hand_row["id"],)
    ).fetchall()
    betting_players = [p for p in players if p["bet"] > 0]
    if not betting_players:
        return
    dealer_cards = [_bj_draw(deck), _bj_draw(deck)]
    for p in betting_players:
        cards = [_bj_draw(deck), _bj_draw(deck)]
        status = "blackjack" if _bj_value(cards) == 21 else "playing"
        db.execute(
            "UPDATE blackjack_hand_players SET cards = ?, status = ? WHERE id = ?",
            (json.dumps(cards), status, p["id"]),
        )
    turn_seat = None
    # déterminer le premier siège qui n'a pas déjà 21 (blackjack naturel)
    fresh = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? ORDER BY seat ASC", (hand_row["id"],)
    ).fetchall()
    for p in fresh:
        if p["bet"] > 0 and p["status"] == "playing":
            turn_seat = p["seat"]
            break
    db.execute(
        "UPDATE blackjack_hands SET phase = 'playing', dealer_cards = ?, deck = ?, turn_seat = ? WHERE id = ?",
        (json.dumps(dealer_cards), json.dumps(deck), turn_seat, hand_row["id"]),
    )
    if turn_seat is None:
        _bj_resolve(db, hand_row["table_id"], hand_row["id"])


def _bj_advance_turn(db, hand_id, from_seat):
    players = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND bet > 0 ORDER BY seat ASC", (hand_id,)
    ).fetchall()
    seats = [p["seat"] for p in players]
    if from_seat not in seats:
        nxt_candidates = [s for s in seats if s > from_seat]
    else:
        idx = seats.index(from_seat)
        nxt_candidates = seats[idx + 1:]
    by_seat = {p["seat"]: p for p in players}
    for s in nxt_candidates:
        if by_seat[s]["status"] == "playing":
            return s
    return None


def _bj_resolve(db, table_id, hand_id):
    hand_row = db.execute("SELECT * FROM blackjack_hands WHERE id = ?", (hand_id,)).fetchone()
    deck = json.loads(hand_row["deck"])
    dealer_cards = json.loads(hand_row["dealer_cards"])
    players = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND bet > 0", (hand_id,)
    ).fetchall()
    any_live = any(p["status"] in ("playing", "stand", "blackjack") for p in players)
    if any_live:
        while _bj_value(dealer_cards) < 17:
            dealer_cards.append(_bj_draw(deck))
    dealer_val = _bj_value(dealer_cards)

    for p in players:
        cards = json.loads(p["cards"])
        val = _bj_value(cards)
        status = p["status"]
        if status == "bust":
            continue
        if status == "blackjack":
            win = round(p["bet"] * 2.5)
        elif dealer_val > 21 or val > dealer_val:
            win = p["bet"] * 2
        elif val == dealer_val:
            win = p["bet"]
        else:
            win = 0
        if win:
            db.execute("UPDATE users SET chips = chips + ? WHERE id = ?", (win, p["user_id"]))

    db.execute(
        "UPDATE blackjack_hands SET phase = 'done', dealer_cards = ?, deck = ?, turn_seat = NULL WHERE id = ?",
        (json.dumps(dealer_cards), json.dumps(deck), hand_id),
    )


@casino_bp.route("/api/salon/<code>/blackjack/bet", methods=["POST"])
@api_login_required
def api_blackjack_bet(code):
    salon, table = _salon_and_table(code, "blackjack")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 403
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] != "betting":
        return jsonify(error="Les mises ne sont pas ouvertes."), 400
    data = request.get_json(force=True)
    amount = int(data.get("amount") or 0)
    error = _apply_blackjack_bet(db, table, hand_row, user, amount)
    if error:
        return jsonify(error=error), 400
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _apply_blackjack_bet(db, table, hand_row, user, amount):
    """Place la mise de user pour la main de blackjack en cours. Retourne un message
    d'erreur (str) ou None. Utilisé par la route HTTP et les bots."""
    if amount <= 0 or amount > user["chips"]:
        return "Mise invalide."
    hp = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND user_id = ?", (hand_row["id"], user["id"])
    ).fetchone()
    if not hp or hp["bet"] > 0:
        return "Mise déjà placée."
    db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (amount, user["id"]))
    db.execute("UPDATE blackjack_hand_players SET bet = ? WHERE id = ?", (amount, hp["id"]))
    players = get_table_players(table["id"])
    bet_count = db.execute(
        "SELECT COUNT(*) c FROM blackjack_hand_players WHERE hand_id = ? AND bet > 0", (hand_row["id"],)
    ).fetchone()["c"]
    if bet_count >= len(players):
        _bj_deal(db, hand_row)
    return None


@casino_bp.route("/api/salon/<code>/blackjack/force-deal", methods=["POST"])
@api_login_required
def api_blackjack_force_deal(code):
    salon, table = _salon_and_table(code, "blackjack")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    user = current_user()
    if salon["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut forcer la distribution."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] != "betting":
        return jsonify(ok=True)
    _bj_deal(db, hand_row)
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/salon/<code>/blackjack/action", methods=["POST"])
@api_login_required
def api_blackjack_action(code):
    salon, table = _salon_and_table(code, "blackjack")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 403
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] != "playing" or hand_row["turn_seat"] != tp["seat"]:
        return jsonify(error="Ce n'est pas votre tour."), 400
    data = request.get_json(force=True)
    action = data.get("action")
    error = _apply_blackjack_action(db, table["id"], hand_row, tp, user["id"], action)
    if error:
        return jsonify(error=error), 400
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _apply_blackjack_action(db, table_id, hand_row, tp, user_id, action):
    """Applique hit/stand pour user_id au blackjack, avance le tour ou résout la main.
    Retourne un message d'erreur (str) ou None. Utilisé par la route HTTP et les bots."""
    hp = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND user_id = ?", (hand_row["id"], user_id)
    ).fetchone()
    deck = json.loads(hand_row["deck"])
    cards = json.loads(hp["cards"])

    if action == "hit":
        cards.append(_bj_draw(deck))
        val = _bj_value(cards)
        status = "bust" if val > 21 else "playing"
        db.execute(
            "UPDATE blackjack_hand_players SET cards = ?, status = ? WHERE id = ?",
            (json.dumps(cards), status, hp["id"]),
        )
        db.execute("UPDATE blackjack_hands SET deck = ? WHERE id = ?", (json.dumps(deck), hand_row["id"]))
        finished_turn = status != "playing"
    elif action == "stand":
        db.execute("UPDATE blackjack_hand_players SET status = 'stand' WHERE id = ?", (hp["id"],))
        finished_turn = True
    else:
        return "Action inconnue."

    if finished_turn:
        next_seat = _bj_advance_turn(db, hand_row["id"], tp["seat"])
        db.execute("UPDATE blackjack_hands SET turn_seat = ? WHERE id = ?", (next_seat, hand_row["id"]))
        if next_seat is None:
            _bj_resolve(db, table_id, hand_row["id"])
    return None


@casino_bp.route("/api/salon/<code>/blackjack/next", methods=["POST"])
@api_login_required
def api_blackjack_next(code):
    salon, table = _salon_and_table(code, "blackjack")
    if not salon:
        return jsonify(error="Salon introuvable."), 404
    user = current_user()
    if salon["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la main suivante."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if hand_row and hand_row["phase"] not in ("done",):
        return jsonify(error="La main en cours n'est pas terminée."), 400
    _start_blackjack_hand(db, table["id"])
    _run_bot_turns(db, table)
    db.commit()
    return jsonify(ok=True)


def _blackjack_state(db, table_id, user_id):
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table_id,)
    ).fetchone()
    if not hand_row:
        return {"phase": "idle"}
    players = db.execute(
        """SELECT bhp.*, u.username FROM blackjack_hand_players bhp JOIN users u ON u.id = bhp.user_id
           WHERE bhp.hand_id = ? ORDER BY bhp.seat ASC""",
        (hand_row["id"],),
    ).fetchall()
    show_dealer_full = hand_row["phase"] == "done"
    dealer_cards = json.loads(hand_row["dealer_cards"])
    me = next((p for p in players if p["user_id"] == user_id), None)
    return {
        "hand_number": hand_row["hand_number"],
        "phase": hand_row["phase"],
        "dealer_cards": dealer_cards if show_dealer_full or hand_row["phase"] == "playing" else [],
        "dealer_cards_hidden": (not show_dealer_full) and hand_row["phase"] == "playing",
        "dealer_value": _bj_value(dealer_cards) if show_dealer_full else None,
        "turn_seat": hand_row["turn_seat"],
        "my_turn": bool(me) and hand_row["turn_seat"] == me["seat"],
        "my_bet_placed": bool(me) and me["bet"] > 0,
        "players": [
            {
                "user_id": p["user_id"], "username": p["username"], "seat": p["seat"],
                "cards": json.loads(p["cards"]), "value": _bj_value(json.loads(p["cards"])),
                "bet": p["bet"], "status": p["status"],
            }
            for p in players
        ],
    }


# ---------------------------------------------------------------------------
# Statistiques et classement
# ---------------------------------------------------------------------------

def _compute_stats(db, user_id):
    stats = {}

    round_rows = db.execute(
        """SELECT t.game_type AS game_type, COUNT(*) AS rounds_played,
                  COALESCE(SUM(rb.amount), 0) AS wagered,
                  COALESCE(SUM(rb.payout), 0) AS won,
                  COALESCE(MAX(rb.payout), 0) AS biggest_win
           FROM round_bets rb
           JOIN rounds r ON r.id = rb.round_id
           JOIN tables t ON t.id = r.table_id
           WHERE rb.user_id = ? AND rb.payout IS NOT NULL
           GROUP BY t.game_type""",
        (user_id,),
    ).fetchall()
    by_game = {row["game_type"]: row for row in round_rows}
    for gt in ("roulette", "dice", "slots"):
        row = by_game.get(gt)
        wagered = row["wagered"] if row else 0
        won = row["won"] if row else 0
        stats[gt] = {
            "rounds_played": row["rounds_played"] if row else 0,
            "wagered": wagered, "won": won, "net": won - wagered,
            "biggest_win": row["biggest_win"] if row else 0,
        }

    bj_rows = db.execute(
        """SELECT bhp.status, bhp.bet, bhp.cards, bh.dealer_cards
           FROM blackjack_hand_players bhp JOIN blackjack_hands bh ON bh.id = bhp.hand_id
           WHERE bhp.user_id = ? AND bhp.bet > 0 AND bh.phase = 'done'""",
        (user_id,),
    ).fetchall()
    bj_wins = bj_wagered = bj_won = bj_biggest = 0
    for row in bj_rows:
        bet = row["bet"]
        bj_wagered += bet
        if row["status"] == "bust":
            win = 0
        else:
            val = _bj_value(json.loads(row["cards"]))
            dealer_val = _bj_value(json.loads(row["dealer_cards"]))
            if row["status"] == "blackjack":
                win = round(bet * 2.5)
            elif dealer_val > 21 or val > dealer_val:
                win = bet * 2
            elif val == dealer_val:
                win = bet
            else:
                win = 0
        bj_won += win
        if win > bet:
            bj_wins += 1
            bj_biggest = max(bj_biggest, win - bet)
    stats["blackjack"] = {
        "hands_played": len(bj_rows), "hands_won": bj_wins,
        "wagered": bj_wagered, "won": bj_won, "net": bj_won - bj_wagered,
        "biggest_win": bj_biggest,
    }

    poker_rows = db.execute(
        """SELECT php.bet_total, ph.last_result
           FROM poker_hand_players php JOIN poker_hands ph ON ph.id = php.hand_id
           WHERE php.user_id = ? AND ph.phase = 'done'""",
        (user_id,),
    ).fetchall()
    poker_wins = poker_wagered = 0
    poker_won = 0.0
    poker_biggest = 0.0
    for row in poker_rows:
        poker_wagered += row["bet_total"]
        if not row["last_result"]:
            continue
        result = json.loads(row["last_result"])
        hand_won = 0.0
        for b in result.get("breakdown", []):
            winner_ids = [w["user_id"] for w in b["winners"]]
            if user_id in winner_ids:
                hand_won += b["amount"] / len(winner_ids)
        if hand_won > 0:
            poker_wins += 1
            poker_biggest = max(poker_biggest, hand_won)
        poker_won += hand_won
    stats["poker"] = {
        "hands_played": len(poker_rows), "hands_won": poker_wins,
        "wagered": poker_wagered, "won": round(poker_won), "net": round(poker_won - poker_wagered),
        "biggest_win": round(poker_biggest),
    }

    return stats


@casino_bp.route("/api/stats")
@api_login_required
def api_stats():
    db = get_db()
    user = current_user()
    stats = _compute_stats(db, user["id"])
    return jsonify(chips=user["chips"], username=user["username"], stats=stats)


@casino_bp.route("/api/skins")
@api_login_required
def api_skins():
    user = current_user()
    owned = set(json.loads(user["owned_skins"]))
    return jsonify(
        equipped=user["equipped_skin"],
        chips=user["chips"],
        skins=[
            {"id": s["id"], "name": s["name"], "color": s["color"], "price": s["price"],
             "owned": s["id"] in owned}
            for s in SKINS
        ],
    )


@casino_bp.route("/api/skins/equip", methods=["POST"])
@api_login_required
def api_skins_equip():
    data = request.get_json(force=True)
    skin_id = data.get("skin_id")
    if skin_id not in SKINS_BY_ID:
        return jsonify(error="Skin inconnu."), 404
    db = get_db()
    user = current_user()
    owned = set(json.loads(user["owned_skins"]))
    if skin_id not in owned:
        price = SKINS_BY_ID[skin_id]["price"]
        if user["chips"] < price:
            return jsonify(error="Solde insuffisant pour débloquer ce skin."), 400
        db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (price, user["id"]))
        owned.add(skin_id)
        db.execute("UPDATE users SET owned_skins = ? WHERE id = ?", (json.dumps(list(owned)), user["id"]))
    db.execute("UPDATE users SET equipped_skin = ? WHERE id = ?", (skin_id, user["id"]))
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/leaderboard")
@api_login_required
def api_leaderboard():
    db = get_db()
    rows = db.execute(
        "SELECT username, chips FROM users WHERE is_bot = 0 ORDER BY chips DESC LIMIT 10"
    ).fetchall()
    return jsonify(leaderboard=[{"username": r["username"], "chips": r["chips"]} for r in rows])


init_db()
