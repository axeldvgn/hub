"""Logique pure du poker : deck, évaluation de mains, répartition des pots.

Aucune de ces fonctions ne touche à la base de données — elles ne manipulent
que des structures Python simples (listes de dicts {"rank":.., "suit":..})
pour rester faciles à tester unitairement.
"""
import random
from collections import Counter
from itertools import combinations

RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'A']
SUITS = ['♠', '♥', '♦', '♣']

HAND_NAMES = {
    8: 'Quinte flush',
    7: 'Carré',
    6: 'Full',
    5: 'Couleur',
    4: 'Suite',
    3: 'Brelan',
    2: 'Double paire',
    1: 'Paire',
    0: 'Carte haute',
}


def build_deck():
    deck = [{'rank': r, 'suit': s} for s in SUITS for r in RANKS]
    random.shuffle(deck)
    return deck


def rank_value(rank):
    if rank == 'A':
        return 14
    if rank == 'R':
        return 13
    if rank == 'D':
        return 12
    if rank == 'V':
        return 11
    return int(rank)


def evaluate_5(cards):
    """Retourne un tuple (categorie, [kickers]) comparable pour 5 cartes exactement."""
    values = sorted((rank_value(c['rank']) for c in cards), reverse=True)
    suits = [c['suit'] for c in cards]
    is_flush = len(set(suits)) == 1

    uniq_vals = sorted(set(values), reverse=True)
    is_straight = False
    straight_high = None
    if len(uniq_vals) == 5:
        if uniq_vals[0] - uniq_vals[4] == 4:
            is_straight = True
            straight_high = uniq_vals[0]
        elif uniq_vals == [14, 5, 4, 3, 2]:
            is_straight = True
            straight_high = 5  # quinte "roue" A-2-3-4-5, la plus faible

    counts = Counter(values)
    groups = sorted(counts.items(), key=lambda kv: (-kv[1], -kv[0]))
    pattern = [g[1] for g in groups]

    if is_straight and is_flush:
        return (8, [straight_high])
    if pattern[0] == 4:
        four_val = groups[0][0]
        kicker = max(v for v in values if v != four_val)
        return (7, [four_val, kicker])
    if pattern[0] == 3 and pattern[1] == 2:
        return (6, [groups[0][0], groups[1][0]])
    if is_flush:
        return (5, values)
    if is_straight:
        return (4, [straight_high])
    if pattern[0] == 3:
        trip_val = groups[0][0]
        kickers = sorted((v for v in values if v != trip_val), reverse=True)[:2]
        return (3, [trip_val] + kickers)
    if pattern[0] == 2 and pattern[1] == 2:
        pair_vals = sorted([groups[0][0], groups[1][0]], reverse=True)
        kicker = max(v for v in values if v not in pair_vals)
        return (2, pair_vals + [kicker])
    if pattern[0] == 2:
        pair_val = groups[0][0]
        kickers = sorted((v for v in values if v != pair_val), reverse=True)[:3]
        return (1, [pair_val] + kickers)
    return (0, values)


def evaluate_best_of_7(cards7):
    """Meilleure main de 5 cartes parmi les 7 (2 privées + 5 communes)."""
    best = None
    for combo in combinations(cards7, 5):
        r = evaluate_5(list(combo))
        if best is None or r > best:
            best = r
    return best


def hand_label(rank_tuple):
    category, kickers = rank_tuple
    if category == 8 and kickers[0] == 14:
        return 'Quinte flush royale'
    return HAND_NAMES[category]


def compute_side_pots(contributions):
    """contributions: [{"user_id":.., "bet_total":.., "folded": bool}, ...]
    Retourne une liste de pots [{"amount":.., "eligible":[user_id,...]}, ...]
    en couches (pot principal + pots annexes), du plus bas au plus haut palier.
    Les joueurs couchés laissent leur mise dans le pot mais ne sont jamais éligibles.
    """
    positive = [c for c in contributions if c['bet_total'] > 0]
    if not positive:
        return []
    levels = sorted(set(c['bet_total'] for c in positive))
    pots = []
    prev = 0
    for level in levels:
        layer_amount = 0
        eligible = []
        for c in contributions:
            layer_amount += max(0, min(c['bet_total'], level) - prev)
            if c['bet_total'] >= level and not c['folded']:
                eligible.append(c['user_id'])
        if layer_amount > 0 and eligible:
            pots.append({'amount': layer_amount, 'eligible': eligible})
        prev = level
    return pots


def resolve_pots(pots, hole_cards_by_user, community_cards, seat_order_from_dealer):
    """Calcule les gains par joueur pour une liste de pots (side pots inclus).
    seat_order_from_dealer: liste de user_id dans l'ordre du siège en partant
    du joueur juste après le donneur (pour attribuer les jetons impairs).
    Retourne {user_id: montant_gagné, ...} + liste d'infos de main pour l'affichage.
    """
    winnings = {}
    breakdown = []
    for pot in pots:
        eligible = pot['eligible']
        if len(eligible) == 1:
            uid = eligible[0]
            winnings[uid] = winnings.get(uid, 0) + pot['amount']
            breakdown.append({'amount': pot['amount'], 'winners': [uid], 'hand': None})
            continue
        ranked = []
        for uid in eligible:
            cards7 = hole_cards_by_user[uid] + community_cards
            ranked.append((uid, evaluate_best_of_7(cards7)))
        best_rank = max(r for _, r in ranked)
        winners = [uid for uid, r in ranked if r == best_rank]
        share = pot['amount'] // len(winners)
        remainder = pot['amount'] - share * len(winners)
        for uid in winners:
            winnings[uid] = winnings.get(uid, 0) + share
        ordered_winners = [uid for uid in seat_order_from_dealer if uid in winners]
        for i in range(remainder):
            uid = ordered_winners[i % len(ordered_winners)]
            winnings[uid] = winnings.get(uid, 0) + 1
        breakdown.append({
            'amount': pot['amount'], 'winners': winners,
            'hand': hand_label(best_rank),
        })
    return winnings, breakdown
