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

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function cardHtml(card) {
        if (!card) return '<div class="card card-back"></div>';
        const isRed = card.suit === '♥' || card.suit === '♦';
        const color = isRed ? '#c0264a' : '#1b1b1b';
        return `<div class="card" style="color:${color}">
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
        } else {
            const cards = game.dealer_cards || [];
            if (game.dealer_cards_hidden && cards.length >= 2) {
                dealerCards.innerHTML = cardHtml(cards[0]) + cardHtml(null);
                dealerValue.textContent = 'Valeur : ?';
            } else {
                dealerCards.innerHTML = cards.map(cardHtml).join('');
                dealerValue.textContent = game.dealer_value != null ? `Valeur : ${game.dealer_value}` : 'Valeur : ?';
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
                    <div class="hand-cards" style="min-height:auto;transform:scale(0.7);margin:2px -10px;">${gp.cards.map(cardHtml).join('')}</div>
                    <div class="seat-stack">${gp.value} pts — ${STATUS_LABELS[gp.status] || gp.status}</div>
                    <div class="seat-bet">Mise: ${gp.bet}</div>
                ` : '<div class="seat-bet">En attente…</div>'}
            </div>`;
        }).join('');

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
        try { await post(`/casino/api/salon/${code}/blackjack/bet`, { amount }); gameMsg.textContent = ''; poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    hitBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/blackjack/action`, { action: 'hit' }); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standBtn.addEventListener("click", async () => {
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
