window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.blackjack = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const dealerCards = $("dealerCards");
    const dealerValue = $("dealerValue");
    const seatsRow = $("seatsRow");
    const betRow = $("betRow");
    const betAmount = $("betAmount");
    const placeBetBtn = $("placeBetBtn");
    const turnBanner = $("turnBanner");
    const actionRow = $("actionRow");
    const hitBtn = $("hitBtn");
    const standBtn = $("standBtn");
    const forceDealBtn = $("forceDealBtn");
    const nextHandBtn = $("nextHandBtn");
    const standUpBtn = $("standUpBtn");
    const gameMsg = $("gameMsg");

    let shownDealer = 0;
    let celebratedHandKey = null;

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function cardHtml(card, isNew) {
        if (!card) return '<div class="card card-back"></div>';
        const isRed = card.suit === '♥' || card.suit === '♦';
        const color = isRed ? '#c0264a' : '#1b1b1b';
        return `<div class="card${isNew ? ' deal-in' : ''}" style="color:${color}">
            <span class="corner tl">${card.rank}${card.suit}</span>
            <span class="pip">${card.suit}</span>
            <span class="corner br">${card.rank}${card.suit}</span>
        </div>`;
    }

    const STATUS_LABELS = { betting: 'Mise en attente', playing: 'En jeu', stand: 'Reste', bust: 'Sauté', blackjack: 'Blackjack !' };

    async function post(url, body) {
        const res = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erreur serveur.");
        return json;
    }

    function render(state) {
        const topbarChips = document.getElementById("topbarChips");
        if (topbarChips) topbarChips.textContent = state.my_chips.toLocaleString('fr-FR') + " 🪙";
        const game = state.game || { phase: "idle" };

        if (game.phase === 'betting' || game.phase === 'idle') {
            dealerCards.innerHTML = '';
            dealerValue.textContent = 'Valeur : ?';
            shownDealer = 0;
        } else {
            const cards = game.dealer_cards || [];
            if (cards.length < shownDealer) shownDealer = 0;
            if (game.dealer_cards_hidden && cards.length >= 2) {
                if (shownDealer < 1 && window.CasinoSound) window.CasinoSound.cardDeal();
                dealerCards.innerHTML = cardHtml(cards[0], shownDealer < 1) + cardHtml(null);
                dealerValue.textContent = 'Valeur : ?';
                shownDealer = 1;
            } else {
                if (cards.length > shownDealer && window.CasinoSound) window.CasinoSound.cardDeal();
                dealerCards.innerHTML = cards.map((c, i) => cardHtml(c, i >= shownDealer)).join('');
                dealerValue.textContent = game.dealer_value != null ? `Valeur : ${game.dealer_value}` : 'Valeur : ?';
                shownDealer = cards.length;
            }
        }

        const gamePlayersByUser = {};
        (game.players || []).forEach(p => gamePlayersByUser[p.user_id] = p);
        seatsRow.innerHTML = state.players.map(p => {
            const gp = gamePlayersByUser[p.user_id];
            const isMe = p.user_id === myUserId;
            const isTurn = gp && game.turn_seat === gp.seat;
            const classes = ['seat'];
            if (isMe) classes.push('me');
            if (isTurn) classes.push('turn');
            return `<div class="${classes.join(' ')}">
                <div class="seat-name">${escapeHtml(p.username)}${p.user_id === state.host_id ? ' 👑' : ''}</div>
                ${gp && gp.bet > 0 ? `
                    <div class="hand-cards" style="min-height:auto;transform:scale(0.7);margin:2px -10px;">${gp.cards.map(c => cardHtml(c, false)).join('')}</div>
                    <div class="seat-stack">${gp.value} pts — ${STATUS_LABELS[gp.status] || gp.status}</div>
                    <div class="seat-bet">Mise: ${gp.bet}</div>
                ` : '<div class="seat-bet">En attente…</div>'}
            </div>`;
        }).join('');

        if (game.phase === 'done') {
            const handKey = game.hand_number + ':done';
            if (handKey !== celebratedHandKey) {
                celebratedHandKey = handKey;
                const me = gamePlayersByUser[myUserId];
                const dealerVal = game.dealer_value;
                const iWon = me && me.bet > 0 && me.status !== 'bust' &&
                    (me.status === 'blackjack' || dealerVal == null || dealerVal > 21 || me.value > dealerVal);
                const isPush = me && me.bet > 0 && me.status !== 'bust' && dealerVal != null && dealerVal <= 21 && me.value === dealerVal;
                if (iWon) {
                    window.CasinoFX.confetti(root.querySelector('.felt'), 18);
                    if (window.CasinoSound) window.CasinoSound.win(me.status === 'blackjack');
                } else if (me && me.bet > 0 && !isPush && window.CasinoSound) {
                    window.CasinoSound.lose();
                }
            }
        }

        const myPlaced = game.my_bet_placed;
        betRow.hidden = game.phase !== 'betting' || myPlaced;

        if (game.phase === 'playing' && game.my_turn) {
            turnBanner.textContent = "C'est votre tour !";
            actionRow.hidden = false;
        } else if (game.phase === 'playing') {
            const turnP = (game.players || []).find(p => p.seat === game.turn_seat);
            turnBanner.textContent = turnP ? `Au tour de ${turnP.username}…` : '';
            actionRow.hidden = true;
        } else if (game.phase === 'done') {
            turnBanner.textContent = 'Main terminée';
            actionRow.hidden = true;
        } else {
            turnBanner.textContent = '';
            actionRow.hidden = true;
        }

        forceDealBtn.hidden = !(state.is_host && game.phase === 'betting');
        nextHandBtn.hidden = !(state.is_host && (game.phase === 'done' || game.phase === 'idle'));
    }

    async function poll() {
        try {
            const res = await fetch(`/casino/api/salon/${code}/blackjack/state`);
            const json = await res.json();
            if (res.ok) render(json);
        } catch (e) {}
    }

    placeBetBtn.addEventListener("click", async () => {
        const amount = parseInt(betAmount.value, 10);
        try {
            if (window.CasinoSound) window.CasinoSound.chip(3);
            await post(`/casino/api/salon/${code}/blackjack/bet`, { amount }); gameMsg.textContent = ''; poll();
        } catch (e) { gameMsg.textContent = e.message; }
    });
    hitBtn.addEventListener("click", async () => {
        if (window.CasinoSound) window.CasinoSound.button();
        try { await post(`/casino/api/salon/${code}/blackjack/action`, { action: 'hit' }); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standBtn.addEventListener("click", async () => {
        if (window.CasinoSound) window.CasinoSound.button();
        try { await post(`/casino/api/salon/${code}/blackjack/action`, { action: 'stand' }); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    forceDealBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/blackjack/force-deal`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    nextHandBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/blackjack/next`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standUpBtn.addEventListener("click", async () => {
        await fetch(`/casino/api/salon/${code}/blackjack/stand`, { method: "POST" });
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    poll();
    const intervalId = setInterval(poll, 1500);
    return { stop() { clearInterval(intervalId); } };
};
