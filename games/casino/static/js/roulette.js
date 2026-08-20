const screenEl = document.querySelector(".table-screen");
const code = screenEl.dataset.code;
const myUserId = parseInt(screenEl.dataset.userId, 10);

const seatsRow = document.getElementById("seatsRow");
const resultDisplay = document.getElementById("resultDisplay");
const statusBanner = document.getElementById("statusBanner");
const numberGrid = document.getElementById("numberGrid");
const betRow = document.getElementById("betRow");
const betAmount = document.getElementById("betAmount");
const placeBetBtn = document.getElementById("placeBetBtn");
const betsSummary = document.getElementById("betsSummary");
const forceResolveBtn = document.getElementById("forceResolveBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const gameMsg = document.getElementById("gameMsg");

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
let selectedBet = null;

for (let n = 0; n <= 36; n++) {
    const btn = document.createElement("button");
    btn.className = "num-btn " + (n === 0 ? "green" : (RED_NUMBERS.has(n) ? "red" : "black"));
    btn.textContent = n;
    btn.addEventListener("click", () => {
        selectedBet = { bet_type: "number", bet_value: n };
        highlight(btn);
    });
    numberGrid.appendChild(btn);
}
document.querySelectorAll("#outsideBets .btn-outline").forEach(btn => {
    btn.addEventListener("click", () => {
        selectedBet = { bet_type: btn.dataset.type, bet_value: null };
        highlight(btn);
    });
});
function highlight(el) {
    document.querySelectorAll(".num-btn, #outsideBets .btn-outline").forEach(b => b.classList.remove("selected"));
    el.classList.add("selected");
}

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

    if (game.phase === 'idle') {
        resultDisplay.textContent = '—';
        statusBanner.textContent = '';
    } else if (game.phase === 'betting') {
        resultDisplay.textContent = '—';
        statusBanner.textContent = `Manche ${game.round_number} — mises ouvertes (${game.bet_count}/${state.players.length})`;
    } else {
        const r = game.result;
        resultDisplay.textContent = `${r.number} (${r.color})`;
        statusBanner.textContent = 'Résultat';
    }

    const alreadyBet = !!game.my_bet;
    betRow.hidden = game.phase !== 'betting' || alreadyBet;
    numberGrid.style.pointerEvents = (game.phase === 'betting' && !alreadyBet) ? 'auto' : 'none';
    numberGrid.style.opacity = (game.phase === 'betting' && !alreadyBet) ? '1' : '0.5';

    if (game.phase === 'resolved') {
        betsSummary.innerHTML = (game.bets || []).map(b => `
            <li><span>${escapeHtml(b.username)} — ${describeBet(b)} (${b.amount})</span>
            <span class="${b.payout > 0 ? 'win' : 'lose'}">${b.payout > 0 ? '+' + b.payout : 'Perdu'}</span></li>
        `).join('');
    } else {
        betsSummary.innerHTML = '';
    }

    forceResolveBtn.hidden = !(state.is_host && game.phase === 'betting');
    nextRoundBtn.hidden = !(state.is_host && (game.phase === 'resolved' || game.phase === 'idle'));
}

function describeBet(b) {
    const labels = { red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: 'Manque', high: 'Passe', number: 'N°' + b.bet_value };
    return labels[b.bet_type] || b.bet_type;
}

async function poll() {
    try {
        const res = await fetch(`/casino/api/table/${code}/state`);
        const json = await res.json();
        if (res.ok) render(json);
    } catch (e) {}
}

placeBetBtn.addEventListener("click", async () => {
    if (!selectedBet) { gameMsg.textContent = "Choisissez une mise d'abord."; return; }
    const amount = parseInt(betAmount.value, 10);
    try {
        await post(`/casino/api/table/${code}/round/bet`, { ...selectedBet, amount });
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
