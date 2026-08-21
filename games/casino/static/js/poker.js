window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.poker = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const seatsRow = $("seatsRow");
    const potDisplay = $("potDisplay");
    const communityCards = $("communityCards");
    const turnBanner = $("turnBanner");
    const myCards = $("myCards");
    const actionRow = $("actionRow");
    const foldBtn = $("foldBtn");
    const callBtn = $("callBtn");
    const raiseAmount = $("raiseAmount");
    const raiseBtn = $("raiseBtn");
    const allinBtn = $("allinBtn");
    const resultPanel = $("resultPanel");
    const nextHandBtn = $("nextHandBtn");
    const rebuyBtn = $("rebuyBtn");
    const standUpBtn = $("standUpBtn");
    const handStrength = $("handStrength");
    const pokerMsg = $("pokerMsg");

    let lastState = null;
    let shownCommunity = 0;
    let shownMine = 0;
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

    async function post(url, body) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erreur serveur.");
        return json;
    }

    async function poll() {
        try {
            const res = await fetch(`/casino/api/salon/${code}/poker/state`);
            const json = await res.json();
            if (!res.ok) { pokerMsg.textContent = json.error || "Erreur."; return; }
            lastState = json;
            render(json);
        } catch (e) {
            pokerMsg.textContent = "Connexion au serveur perdue, nouvelle tentative…";
        }
    }

    function render(state) {
        const topbarChips = document.getElementById("topbarChips");
        if (topbarChips) topbarChips.textContent = state.my_chips.toLocaleString('fr-FR') + " 🪙";
        const game = state.game || { phase: "idle" };
        const gamePlayersByUser = {};
        (game.players || []).forEach(p => gamePlayersByUser[p.user_id] = p);

        seatsRow.innerHTML = state.players.map(p => {
            const gp = gamePlayersByUser[p.user_id];
            const isMe = p.user_id === myUserId;
            const isTurn = game.turn_seat === p.seat;
            const isDealer = game.dealer_seat === p.seat;
            const folded = gp && gp.status === 'folded';
            const classes = ['seat'];
            if (isMe) classes.push('me');
            if (isTurn) classes.push('turn');
            if (folded) classes.push('folded');
            return `<div class="${classes.join(' ')}">
                ${isDealer ? '<span class="seat-tag">D</span>' : ''}
                <div class="seat-name">${escapeHtml(p.username)}${p.user_id === state.host_id ? ' 👑' : ''}</div>
                <div class="seat-stack">${p.stack.toLocaleString('fr-FR')} 🪙</div>
                ${gp ? `<div class="seat-bet">${gp.status === 'folded' ? 'Couché' : (gp.status === 'all_in' ? 'Tapis' : (gp.bet_street ? 'Mise: ' + gp.bet_street : ''))}</div>` : ''}
            </div>`;
        }).join('');

        potDisplay.textContent = `Pot : ${(game.pot || 0).toLocaleString('fr-FR')} 🪙`;
        const community = game.community_cards || [];
        if (community.length < shownCommunity) shownCommunity = 0; // nouvelle main
        if (community.length > shownCommunity && window.CasinoSound) window.CasinoSound.cardDeal();
        communityCards.innerHTML = community.map((c, i) => cardHtml(c, i >= shownCommunity)).join('') || '<span style="color:var(--text-dim);font-size:13px;">—</span>';
        shownCommunity = community.length;

        const me = gamePlayersByUser[myUserId];
        const myHole = (me && me.hole_cards) || [];
        if (myHole.length < shownMine) shownMine = 0;
        if (myHole.length > shownMine && window.CasinoSound) window.CasinoSound.cardDeal();
        myCards.innerHTML = myHole.length ? myHole.map((c, i) => cardHtml(c, i >= shownMine)).join('') : '<span style="color:var(--text-dim);font-size:13px;">—</span>';
        shownMine = myHole.length;
        handStrength.textContent = (game.phase !== 'done' && game.my_hand_label) ? `Votre main : ${game.my_hand_label}` : '';

        if (game.phase === 'idle') {
            turnBanner.textContent = '';
        } else if (game.phase === 'done') {
            turnBanner.textContent = 'Main terminée';
        } else if (game.my_turn) {
            turnBanner.textContent = "C'est votre tour !";
        } else {
            const turnPlayer = state.players.find(p => p.seat === game.turn_seat);
            turnBanner.textContent = turnPlayer ? `Au tour de ${turnPlayer.username}…` : '';
        }

        actionRow.hidden = !game.my_turn;
        if (game.my_turn) {
            const toCall = game.to_call || 0;
            callBtn.textContent = toCall > 0 ? `Suivre (${toCall})` : 'Checker';
            const minAmount = toCall + (game.min_raise_total || 20);
            raiseAmount.min = minAmount;
            if (!raiseAmount.value || parseInt(raiseAmount.value, 10) < minAmount) raiseAmount.value = minAmount;
            raiseBtn.textContent = (game.current_bet || 0) > 0 ? 'Relancer' : 'Miser';
        }

        if (game.phase === 'done' && game.last_result) {
            resultPanel.hidden = false;
            const r = game.last_result;
            const lines = r.breakdown.map(b => {
                const names = b.winners.map(w => escapeHtml(w.username)).join(', ');
                return `<p class="pot-line">${b.amount} 🪙 pour ${names}${b.hand ? ' (' + b.hand + ')' : ''}</p>`;
            }).join('');
            const reveal = (r.reveal || []).map(rv => `
                <div class="rh">
                    <div class="cards">${rv.hole_cards.map(c => cardHtml(c, false)).join('')}</div>
                    ${escapeHtml(rv.username)}
                </div>
            `).join('');
            resultPanel.innerHTML = `<h3>Résultat de la main</h3>${lines}
                <div class="reveal-hands">${reveal}</div>`;

            const handKey = game.hand_number + ':done';
            if (handKey !== celebratedHandKey) {
                celebratedHandKey = handKey;
                const iWon = r.breakdown.some(b => b.winners.some(w => w.user_id === myUserId));
                if (iWon) {
                    window.CasinoFX.confetti(resultPanel, 20);
                    if (window.CasinoSound) window.CasinoSound.win(r.pot >= 300);
                } else if (me && me.status !== 'folded' && window.CasinoSound) {
                    window.CasinoSound.lose();
                }
            }
        } else {
            resultPanel.hidden = true;
        }

        const myTp = state.players.find(p => p.user_id === myUserId);
        const canStartNext = (game.phase === 'done' || game.phase === 'idle');
        nextHandBtn.hidden = !(state.is_host && canStartNext);
        rebuyBtn.hidden = !(myTp && myTp.stack <= 0);
    }

    foldBtn.addEventListener("click", async () => {
        if (window.CasinoSound) window.CasinoSound.button();
        try { await post(`/casino/api/salon/${code}/poker/action`, { action: 'fold' }); poll(); }
        catch (e) { pokerMsg.textContent = e.message; }
    });
    callBtn.addEventListener("click", async () => {
        const action = callBtn.textContent.startsWith('Checker') ? 'check' : 'call';
        if (window.CasinoSound) action === 'check' ? window.CasinoSound.button() : window.CasinoSound.chip(2);
        try { await post(`/casino/api/salon/${code}/poker/action`, { action }); poll(); }
        catch (e) { pokerMsg.textContent = e.message; }
    });
    raiseBtn.addEventListener("click", async () => {
        const action = raiseBtn.textContent === 'Relancer' ? 'raise' : 'bet';
        const amount = parseInt(raiseAmount.value, 10);
        if (window.CasinoSound) window.CasinoSound.chip(3);
        try { await post(`/casino/api/salon/${code}/poker/action`, { action, amount }); poll(); }
        catch (e) { pokerMsg.textContent = e.message; }
    });
    allinBtn.addEventListener("click", async () => {
        const myTp = lastState && lastState.players.find(p => p.user_id === myUserId);
        const stack = myTp ? myTp.stack : 0;
        const action = raiseBtn.textContent === 'Relancer' ? 'raise' : 'bet';
        if (window.CasinoSound) window.CasinoSound.chip(4);
        try { await post(`/casino/api/salon/${code}/poker/action`, { action, amount: stack }); poll(); }
        catch (e) { pokerMsg.textContent = e.message; }
    });
    nextHandBtn.addEventListener("click", async () => {
        nextHandBtn.disabled = true;
        try { await post(`/casino/api/salon/${code}/poker/next-hand`, {}); }
        catch (e) { pokerMsg.textContent = e.message; }
        nextHandBtn.disabled = false;
        poll();
    });
    rebuyBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/poker/rebuy`, {}); poll(); }
        catch (e) { pokerMsg.textContent = e.message; }
    });
    standUpBtn.addEventListener("click", async () => {
        await fetch(`/casino/api/salon/${code}/poker/stand`, { method: "POST" });
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    poll();
    const intervalId = setInterval(poll, 1200);
    return { stop() { clearInterval(intervalId); } };
};
