window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.slots = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const seatsRow = $("seatsRow");
    const statusBanner = $("statusBanner");
    const slotResult = $("slotResult");
    const betRow = $("betRow");
    const betAmount = $("betAmount");
    const placeBetBtn = $("placeBetBtn");
    const betsSummary = $("betsSummary");
    const forceResolveBtn = $("forceResolveBtn");
    const nextRoundBtn = $("nextRoundBtn");
    const standUpBtn = $("standUpBtn");
    const gameMsg = $("gameMsg");

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
        const topbarChips = document.getElementById("topbarChips");
        if (topbarChips) topbarChips.textContent = state.my_chips.toLocaleString('fr-FR') + " 🪙";
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
            const res = await fetch(`/casino/api/salon/${code}/slots/state`);
            const json = await res.json();
            if (res.ok) render(json);
        } catch (e) {}
    }

    placeBetBtn.addEventListener("click", async () => {
        const amount = parseInt(betAmount.value, 10);
        try {
            await post(`/casino/api/salon/${code}/round/slots/bet`, { bet_type: 'spin', amount });
            gameMsg.textContent = '';
            poll();
        } catch (e) { gameMsg.textContent = e.message; }
    });
    forceResolveBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/slots/resolve`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    nextRoundBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/slots/next`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standUpBtn.addEventListener("click", async () => {
        await fetch(`/casino/api/salon/${code}/slots/stand`, { method: "POST" });
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    poll();
    const intervalId = setInterval(poll, 1500);
    return { stop() { clearInterval(intervalId); } };
};
