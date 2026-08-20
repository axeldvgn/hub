const screenEl = document.querySelector(".table-screen");
const code = screenEl.dataset.code;
const myUserId = parseInt(screenEl.dataset.userId, 10);

const seatsRow = document.getElementById("seatsRow");
const potDisplay = document.getElementById("potDisplay");
const communityCards = document.getElementById("communityCards");
const turnBanner = document.getElementById("turnBanner");
const myCards = document.getElementById("myCards");
const actionRow = document.getElementById("actionRow");
const foldBtn = document.getElementById("foldBtn");
const callBtn = document.getElementById("callBtn");
const raiseAmount = document.getElementById("raiseAmount");
const raiseBtn = document.getElementById("raiseBtn");
const allinBtn = document.getElementById("allinBtn");
const resultPanel = document.getElementById("resultPanel");
const nextHandBtn = document.getElementById("nextHandBtn");
const rebuyBtn = document.getElementById("rebuyBtn");
const pokerMsg = document.getElementById("pokerMsg");

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
        const res = await fetch(`/casino/api/table/${code}/state`);
        const json = await res.json();
        if (!res.ok) { pokerMsg.textContent = json.error || "Erreur."; return; }
        window.__lastState = json;
        render(json);
    } catch (e) {
        pokerMsg.textContent = "Connexion au serveur perdue, nouvelle tentative…";
    }
}

function render(state) {
    document.getElementById("topbarChips").textContent = state.my_chips.toLocaleString('fr-FR') + " 🪙";
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
    communityCards.innerHTML = (game.community_cards || []).map(cardHtml).join('') || '<span style="color:var(--text-dim);font-size:13px;">—</span>';

    const me = gamePlayersByUser[myUserId];
    myCards.innerHTML = me && me.hole_cards ? me.hole_cards.map(cardHtml).join('') : '<span style="color:var(--text-dim);font-size:13px;">—</span>';

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
                <div class="cards">${rv.hole_cards.map(cardHtml).join('')}</div>
                ${escapeHtml(rv.username)}
            </div>
        `).join('');
        resultPanel.innerHTML = `<h3>Résultat de la main</h3>${lines}
            <div class="reveal-hands">${reveal}</div>`;
    } else {
        resultPanel.hidden = true;
    }

    const myTp = state.players.find(p => p.user_id === myUserId);
    const canStartNext = (game.phase === 'done' || game.phase === 'idle');
    nextHandBtn.hidden = !(state.is_host && canStartNext);
    rebuyBtn.hidden = !(myTp && myTp.stack <= 0);
}

foldBtn.addEventListener("click", async () => {
    try { await post(`/casino/api/table/${code}/poker/action`, { action: 'fold' }); poll(); }
    catch (e) { pokerMsg.textContent = e.message; }
});
callBtn.addEventListener("click", async () => {
    const action = callBtn.textContent.startsWith('Checker') ? 'check' : 'call';
    try { await post(`/casino/api/table/${code}/poker/action`, { action }); poll(); }
    catch (e) { pokerMsg.textContent = e.message; }
});
raiseBtn.addEventListener("click", async () => {
    const action = raiseBtn.textContent === 'Relancer' ? 'raise' : 'bet';
    const amount = parseInt(raiseAmount.value, 10);
    try { await post(`/casino/api/table/${code}/poker/action`, { action, amount }); poll(); }
    catch (e) { pokerMsg.textContent = e.message; }
});
allinBtn.addEventListener("click", async () => {
    const myTp = window.__lastState && window.__lastState.players.find(p => p.user_id === myUserId);
    const stack = myTp ? myTp.stack : 0;
    const action = raiseBtn.textContent === 'Relancer' ? 'raise' : 'bet';
    try { await post(`/casino/api/table/${code}/poker/action`, { action, amount: stack }); poll(); }
    catch (e) { pokerMsg.textContent = e.message; }
});
nextHandBtn.addEventListener("click", async () => {
    nextHandBtn.disabled = true;
    try { await post(`/casino/api/table/${code}/poker/next-hand`, {}); }
    catch (e) { pokerMsg.textContent = e.message; }
    nextHandBtn.disabled = false;
    poll();
});
rebuyBtn.addEventListener("click", async () => {
    try { await post(`/casino/api/table/${code}/rebuy`, {}); poll(); }
    catch (e) { pokerMsg.textContent = e.message; }
});
document.getElementById("leaveBtn").addEventListener("click", async () => {
    await fetch(`/casino/api/table/${code}/leave`, { method: "POST" });
    window.location.href = "/casino/";
});

poll();
setInterval(poll, 1200);
