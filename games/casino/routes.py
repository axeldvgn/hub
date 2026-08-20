import json
import os
import random
import sqlite3
import string
from datetime import datetime

from flask import Blueprint, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from . import poker_engine as poker

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
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    game_type TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    created_at TEXT NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id)
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
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Aides générales
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
            return redirect(url_for("casino.login_page"))
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
        exists = db.execute("SELECT 1 FROM tables WHERE code = ?", (code,)).fetchone()
        if not exists:
            return code


def get_table_by_code(code):
    return get_db().execute("SELECT * FROM tables WHERE code = ?", (code.upper(),)).fetchone()


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
# Pages
# ---------------------------------------------------------------------------

@casino_bp.route("/")
def home():
    if not current_user():
        return redirect(url_for("casino.login_page"))
    return render_template("casino/home.html", user=current_user(), game_types=GAME_TYPES)


@casino_bp.route("/login")
def login_page():
    if current_user():
        return redirect(url_for("casino.home"))
    return render_template("casino/login.html")


@casino_bp.route("/table/<code>/lobby")
@login_required
def lobby_page(code):
    table = get_table_by_code(code)
    if not table:
        return redirect(url_for("casino.home"))
    if table["status"] == "playing":
        return redirect(url_for("casino.table_page", code=code))
    return render_template("casino/lobby.html", code=table["code"], user=current_user(),
                            game_type=table["game_type"], game_label=GAME_TYPES.get(table["game_type"], table["game_type"]))


@casino_bp.route("/table/<code>")
@login_required
def table_page(code):
    table = get_table_by_code(code)
    if not table:
        return redirect(url_for("casino.home"))
    if table["status"] == "waiting":
        return redirect(url_for("casino.lobby_page", code=code))
    template = f"casino/table_{table['game_type']}.html"
    return render_template(template, code=table["code"], user=current_user())


# ---------------------------------------------------------------------------
# API — comptes
# ---------------------------------------------------------------------------

@casino_bp.route("/api/register", methods=["POST"])
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
        "INSERT INTO users (username, password_hash, chips, created_at) VALUES (?, ?, ?, ?)",
        (username, generate_password_hash(password), STARTING_CHIPS, now()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    session[SESSION_KEY] = user["id"]
    return jsonify(ok=True)


@casino_bp.route("/api/login", methods=["POST"])
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


@casino_bp.route("/api/table/create", methods=["POST"])
@api_login_required
def api_create_table():
    data = request.get_json(force=True)
    game_type = data.get("game_type")
    if game_type not in GAME_TYPES:
        return jsonify(error="Type de jeu invalide."), 400
    db = get_db()
    user = current_user()
    if game_type == "poker" and user["chips"] < 20:
        return jsonify(error="Il vous faut au moins 20 jetons pour ouvrir une table de poker."), 400
    code = generate_code()
    cur = db.execute(
        "INSERT INTO tables (code, game_type, host_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)",
        (code, game_type, user["id"], now()),
    )
    table_id = cur.lastrowid
    stack = 0
    if game_type == "poker":
        stack = min(POKER_BUYIN, user["chips"])
        db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (stack, user["id"]))
    _seat_player(db, table_id, user["id"], stack)
    db.commit()
    return jsonify(ok=True, code=code)


@casino_bp.route("/api/table/join", methods=["POST"])
@api_login_required
def api_join_table():
    data = request.get_json(force=True)
    code = (data.get("code") or "").strip().upper()
    table = get_table_by_code(code)
    if not table:
        return jsonify(error="Table introuvable."), 404
    db = get_db()
    user = current_user()
    already = db.execute(
        "SELECT 1 FROM table_players WHERE table_id = ? AND user_id = ?", (table["id"], user["id"])
    ).fetchone()
    if already:
        return jsonify(ok=True, code=table["code"])
    count = db.execute(
        "SELECT COUNT(*) c FROM table_players WHERE table_id = ?", (table["id"],)
    ).fetchone()["c"]
    if count >= MAX_PLAYERS:
        return jsonify(error="Cette table est complète (5 joueurs max)."), 400
    stack = 0
    if table["game_type"] == "poker":
        if user["chips"] < 20:
            return jsonify(error="Il vous faut au moins 20 jetons pour vous asseoir."), 400
        stack = min(POKER_BUYIN, user["chips"])
        db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (stack, user["id"]))
    _seat_player(db, table["id"], user["id"], stack)
    db.commit()
    return jsonify(ok=True, code=table["code"])


@casino_bp.route("/api/table/<code>/leave", methods=["POST"])
@api_login_required
def api_leave_table(code):
    table = get_table_by_code(code)
    if not table:
        return jsonify(error="Table introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if tp:
        if tp["stack"] > 0:
            db.execute("UPDATE users SET chips = chips + ? WHERE id = ?", (tp["stack"], user["id"]))
        db.execute("DELETE FROM table_players WHERE id = ?", (tp["id"],))
        remaining = db.execute(
            "SELECT COUNT(*) c FROM table_players WHERE table_id = ?", (table["id"],)
        ).fetchone()["c"]
        if remaining == 0:
            db.execute("UPDATE tables SET status = 'finished' WHERE id = ?", (table["id"],))
        elif table["host_id"] == user["id"]:
            new_host = db.execute(
                "SELECT user_id FROM table_players WHERE table_id = ? ORDER BY seat ASC LIMIT 1",
                (table["id"],),
            ).fetchone()
            db.execute("UPDATE tables SET host_id = ? WHERE id = ?", (new_host["user_id"], table["id"]))
        db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/rebuy", methods=["POST"])
@api_login_required
def api_rebuy(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "poker":
        return jsonify(error="Rachat impossible ici."), 400
    db = get_db()
    user = current_user()
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


@casino_bp.route("/api/table/<code>/start", methods=["POST"])
@api_login_required
def api_start_table(code):
    table = get_table_by_code(code)
    if not table:
        return jsonify(error="Table introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut démarrer la table."), 403
    db = get_db()
    players = get_table_players(table["id"])
    if len(players) < 2:
        return jsonify(error="Il faut au moins 2 joueurs pour démarrer."), 400
    db.execute("UPDATE tables SET status = 'playing' WHERE id = ?", (table["id"],))
    db.commit()
    if table["game_type"] == "poker":
        _start_poker_hand(db, table["id"])
    elif table["game_type"] == "blackjack":
        _start_blackjack_hand(db, table["id"])
    else:
        _start_round(db, table["id"])
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/state")
@api_login_required
def api_table_state(code):
    table = get_table_by_code(code)
    if not table:
        return jsonify(error="Table introuvable."), 404
    db = get_db()
    user = current_user()
    players = get_table_players(table["id"])
    my_tp = next((p for p in players if p["user_id"] == user["id"]), None)
    if not my_tp:
        return jsonify(error="Vous ne faites pas partie de cette table."), 403

    payload = {
        "code": table["code"],
        "game_type": table["game_type"],
        "game_label": GAME_TYPES.get(table["game_type"], table["game_type"]),
        "status": table["status"],
        "host_id": table["host_id"],
        "is_host": table["host_id"] == user["id"],
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


@casino_bp.route("/api/table/<code>/poker/action", methods=["POST"])
@api_login_required
def api_poker_action(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "poker":
        return jsonify(error="Table de poker introuvable."), 404
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

    hand_players = _poker_players_for_hand(db, hand_row["id"])
    by_seat = {p["seat"]: p for p in hand_players}
    me = by_seat[tp["seat"]]

    data = request.get_json(force=True)
    action = data.get("action")
    amount = int(data.get("amount") or 0)
    current_bet = hand_row["current_bet"]
    to_call = current_bet - me["bet_street"]
    stack = tp["stack"]

    if action == "fold":
        db.execute("UPDATE poker_hand_players SET status = 'folded', has_acted = 1 WHERE id = ?", (me["id"],))
        me = dict(me); me["status"] = "folded"; me["has_acted"] = 1
    elif action == "check":
        if to_call > 0:
            return jsonify(error="Vous devez suivre ou vous coucher."), 400
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
            return jsonify(error="Montant invalide."), 400
        target_total = me["bet_street"] + amount
        is_all_in = amount == stack
        min_needed = BIG_BLIND if current_bet == 0 else hand_row["min_raise"]
        if not is_all_in and (target_total - current_bet) < min_needed:
            return jsonify(error=f"La relance minimum est de {min_needed} jetons."), 400
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
        return jsonify(error="Action inconnue."), 400

    hand_row = db.execute("SELECT * FROM poker_hands WHERE id = ?", (hand_row["id"],)).fetchone()
    hand_players = _poker_players_for_hand(db, hand_row["id"])
    non_folded = [p for p in hand_players if p["status"] != "folded"]

    if len(non_folded) == 1:
        _finish_poker_hand(db, table["id"], hand_row, hand_players, json.loads(hand_row["community_cards"]))
        db.commit()
        return jsonify(ok=True)

    seats = sorted(p["seat"] for p in hand_players)
    rotated = rotate_from(seats, hand_row["dealer_seat"])
    next_seat = _next_to_act(hand_players, rotated, hand_row["current_bet"], tp["seat"])

    if next_seat is None:
        _advance_poker_street(db, hand_row, hand_players)
    else:
        db.execute("UPDATE poker_hands SET turn_seat = ? WHERE id = ?", (next_seat, hand_row["id"]))

    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/poker/next-hand", methods=["POST"])
@api_login_required
def api_poker_next_hand(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "poker":
        return jsonify(error="Table de poker introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la main suivante."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM poker_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if hand_row and hand_row["phase"] != "done":
        return jsonify(error="La main en cours n'est pas terminée."), 400
    _start_poker_hand(db, table["id"])
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


@casino_bp.route("/api/table/<code>/round/bet", methods=["POST"])
@api_login_required
def api_round_bet(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] not in ("roulette", "dice", "slots"):
        return jsonify(error="Table introuvable."), 404
    db = get_db()
    user = current_user()
    tp = get_my_seat(table["id"], user["id"])
    if not tp:
        return jsonify(error="Vous n'êtes pas à cette table."), 403
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not round_row or round_row["phase"] != "betting":
        return jsonify(error="Les mises ne sont pas ouvertes."), 400
    already = db.execute(
        "SELECT 1 FROM round_bets WHERE round_id = ? AND user_id = ?", (round_row["id"], user["id"])
    ).fetchone()
    if already:
        return jsonify(error="Vous avez déjà misé sur cette manche."), 400
    data = request.get_json(force=True)
    amount = int(data.get("amount") or 0)
    bet_type = data.get("bet_type") or "spin"
    bet_value = data.get("bet_value")
    if amount <= 0 or amount > user["chips"]:
        return jsonify(error="Mise invalide."), 400
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
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/round/resolve", methods=["POST"])
@api_login_required
def api_round_resolve(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] not in ("roulette", "dice", "slots"):
        return jsonify(error="Table introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut forcer le lancer."), 403
    db = get_db()
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not round_row or round_row["phase"] != "betting":
        return jsonify(ok=True)
    _resolve_round(db, table, round_row)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/round/next", methods=["POST"])
@api_login_required
def api_round_next(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] not in ("roulette", "dice", "slots"):
        return jsonify(error="Table introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la manche suivante."), 403
    db = get_db()
    round_row = db.execute(
        "SELECT * FROM rounds WHERE table_id = ? ORDER BY round_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if round_row and round_row["phase"] != "resolved":
        return jsonify(error="La manche en cours n'est pas terminée."), 400
    _start_round(db, table["id"])
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


@casino_bp.route("/api/table/<code>/blackjack/bet", methods=["POST"])
@api_login_required
def api_blackjack_bet(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "blackjack":
        return jsonify(error="Table introuvable."), 404
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
    if amount <= 0 or amount > user["chips"]:
        return jsonify(error="Mise invalide."), 400
    hp = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND user_id = ?", (hand_row["id"], user["id"])
    ).fetchone()
    if not hp or hp["bet"] > 0:
        return jsonify(error="Mise déjà placée."), 400
    db.execute("UPDATE users SET chips = chips - ? WHERE id = ?", (amount, user["id"]))
    db.execute("UPDATE blackjack_hand_players SET bet = ? WHERE id = ?", (amount, hp["id"]))
    players = get_table_players(table["id"])
    bet_count = db.execute(
        "SELECT COUNT(*) c FROM blackjack_hand_players WHERE hand_id = ? AND bet > 0", (hand_row["id"],)
    ).fetchone()["c"]
    if bet_count >= len(players):
        _bj_deal(db, hand_row)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/blackjack/force-deal", methods=["POST"])
@api_login_required
def api_blackjack_force_deal(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "blackjack":
        return jsonify(error="Table introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut forcer la distribution."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if not hand_row or hand_row["phase"] != "betting":
        return jsonify(ok=True)
    _bj_deal(db, hand_row)
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/blackjack/action", methods=["POST"])
@api_login_required
def api_blackjack_action(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "blackjack":
        return jsonify(error="Table introuvable."), 404
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
    hp = db.execute(
        "SELECT * FROM blackjack_hand_players WHERE hand_id = ? AND user_id = ?", (hand_row["id"], user["id"])
    ).fetchone()
    data = request.get_json(force=True)
    action = data.get("action")
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
        return jsonify(error="Action inconnue."), 400

    if finished_turn:
        next_seat = _bj_advance_turn(db, hand_row["id"], tp["seat"])
        db.execute("UPDATE blackjack_hands SET turn_seat = ? WHERE id = ?", (next_seat, hand_row["id"]))
        if next_seat is None:
            _bj_resolve(db, table["id"], hand_row["id"])
    db.commit()
    return jsonify(ok=True)


@casino_bp.route("/api/table/<code>/blackjack/next", methods=["POST"])
@api_login_required
def api_blackjack_next(code):
    table = get_table_by_code(code)
    if not table or table["game_type"] != "blackjack":
        return jsonify(error="Table introuvable."), 404
    user = current_user()
    if table["host_id"] != user["id"]:
        return jsonify(error="Seul l'hôte peut lancer la main suivante."), 403
    db = get_db()
    hand_row = db.execute(
        "SELECT * FROM blackjack_hands WHERE table_id = ? ORDER BY hand_number DESC LIMIT 1", (table["id"],)
    ).fetchone()
    if hand_row and hand_row["phase"] not in ("done",):
        return jsonify(error="La main en cours n'est pas terminée."), 400
    _start_blackjack_hand(db, table["id"])
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


init_db()
