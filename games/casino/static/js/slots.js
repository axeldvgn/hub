const screenEl = document.querySelector(".table-screen");
const code = screenEl.dataset.code;
const myUserId = parseInt(screenEl.dataset.userId, 10);

const seatsRow = document.getElementById("seatsRow");
const statusBanner = document.getElementById("statusBanner");
const slotResult = document.getElementById("slotResult");
const betRow = document.getElementById("betRow");
const betAmount = document.getElementById("betAmount");
const placeBetBtn = document.getElementById("placeBetBtn");
const betsSummary = document.getElementById("betsSummary");
const forceResolveBtn = document.getElementById("forceResolveBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const gameMsg = document.getElementById("gameMsg");

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

async function post(url, body) {
    const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Erreur serveur.");
    return json;
}

function render(state) {
    document.getElementById("topbarChips").textContent = state.my_chips.toLocaleString('fr-FR') + " 🪙";
    const game = state.game || { phase: "idle" };

    seatsRow.innerHTML = state.players.map(p => `
        <div class="seat${p.user_id === myUserId ? ' me' : ''}">
            <div class="seat-name">${escapeHtml(p.username)}${p.user_id === state.host_id ? ' 👑' : ''}</div>
        </div>
    `).join('');

    if (game.phase === 'betting' || game.phase === 'idle') {
        slotResult.innerHTML = '<div class="sym">❔</div><div class="sym">❔</div><div class="sym">❔</div>';
        statusBanner.textContent = game.phase === 'betting'
            ? `Manche ${game.round_number} — mises ouvertes (${game.bet_count}/${state.players.length})` : '';
    } else {
        const r = game.result;
        slotResult.innerHTML = r.symbols.map(s => `<div class="sym">${s}</div>`).join('');
        statusBanner.textContent = 'Résultat';
    }

    const alreadyBet = !!game.my_bet;
    betRow.hidden = game.phase !== 'betting' || alreadyBet;

    betsSummary.innerHTML = game.phase === 'resolved' ? (game.bets || []).map(b => `
        <li><span>${escapeHtml(b.username)} — mise ${b.amount}</span>
        <span class="${b.payout > 0 ? 'win' : 'lose'}">${b.payout > 0 ? '+' + b.payout : 'Perdu'}</span></li>
    `).join('') : '';

    forceResolveBtn.hidden = !(state.is_host && game.phase === 'betting');
    nextRoundBtn.hidden = !(state.is_host && (game.phase === 'resolved' || game.phase === 'idle'));
}

async function poll() {
    try {
        const res = await fetch(`/casino/api/table/${code}/state`);
        const json = await res.json();
        if (res.ok) render(json);
    } catch (e) {}
}

placeBetBtn.addEventListener("click", async () => {
    const amount = parseInt(betAmount.value, 10);
    try {
        await post(`/casino/api/table/${code}/round/bet`, { bet_type: 'spin', amount });
        gameMsg.textContent = '';
        poll();
    } catch (e) { gameMsg.textContent = e.message; }
});
forceResolveBtn.addEventListener("click", async () => {
    try { await post(`/casino/api/table/${code}/round/resolve`, {}); poll(); }
    catch (e) { gameMsg.textContent = e.message; }
});
nextRoundBtn.addEventListener("click", async () => {
    try { await post(`/casino/api/table/${code}/round/next`, {}); poll(); }
    catch (e) { gameMsg.textContent = e.message; }
});
document.getElementById("leaveBtn").addEventListener("click", async () => {
    await fetch(`/casino/api/table/${code}/leave`, { method: "POST" });
    window.location.href = "/casino/";
});

poll();
setInterval(poll, 1500);
