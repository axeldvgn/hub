window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.dice = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const seatsRow = $("seatsRow");
    const statusBanner = $("statusBanner");
    const sumDisplay = $("sumDisplay");
    const dice1El = $("dice1");
    const dice2El = $("dice2");
    const betRow = $("betRow");
    const betAmount = $("betAmount");
    const placeBetBtn = $("placeBetBtn");
    const betsSummary = $("betsSummary");
    const forceResolveBtn = $("forceResolveBtn");
    const nextRoundBtn = $("nextRoundBtn");
    const standUpBtn = $("standUpBtn");
    const gameMsg = $("gameMsg");
    const betTypes = root.querySelector("#betTypes");

    const PIP_PATTERNS = {1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
    function renderDie(dieEl, value) {
        dieEl.innerHTML = '';
        for (let i = 1; i <= 9; i++) {
            const p = document.createElement('div');
            p.className = 'pip';
            dieEl.appendChild(p);
        }
        (PIP_PATTERNS[value] || []).forEach(i => { dieEl.children[i - 1].style.opacity = 1; });
    }
    renderDie(dice1El, 1);
    renderDie(dice2El, 1);

    let selectedType = null;
    let lastRoundKey = null;
    let revealAt = 0;
    let celebratedRoundKey = null;
    let rollTimer = null;

    betTypes.querySelectorAll(".btn-outline").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedType = btn.dataset.type;
            betTypes.querySelectorAll(".btn-outline").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
        });
    });

    function playRoll(d1, d2) {
        dice1El.classList.add('rolling');
        dice2El.classList.add('rolling');
        let ticks = 0;
        clearInterval(rollTimer);
        rollTimer = setInterval(() => {
            renderDie(dice1El, 1 + Math.floor(Math.random() * 6));
            renderDie(dice2El, 1 + Math.floor(Math.random() * 6));
            ticks++;
            if (ticks > 8) {
                clearInterval(rollTimer);
                dice1El.classList.remove('rolling');
                dice2El.classList.remove('rolling');
                renderDie(dice1El, d1);
                renderDie(dice2El, d2);
            }
        }, 110);
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

    function describeBet(b) {
        const labels = { petit: 'Petit (2-6)', grand: 'Grand (8-12)', sept: 'Sept pile' };
        return labels[b.bet_type] || b.bet_type;
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

        const roundKey = game.round_number + ':' + game.phase;
        const justResolved = game.phase === 'resolved' && roundKey !== lastRoundKey;
        if (justResolved) {
            revealAt = Date.now() + 1000;
            playRoll(game.result.d1, game.result.d2);
        }
        lastRoundKey = roundKey;
        const revealing = game.phase === 'resolved' && Date.now() < revealAt;

        if (game.phase === 'betting' || game.phase === 'idle') {
            if (!justResolved) { sumDisplay.textContent = 'Total : —'; renderDie(dice1El, 1); renderDie(dice2El, 1); }
            statusBanner.textContent = game.phase === 'betting'
                ? `Manche ${game.round_number} — mises ouvertes (${game.bet_count}/${state.players.length})` : '';
        } else if (revealing) {
            sumDisplay.textContent = 'Total : —';
            statusBanner.textContent = 'Les dés roulent…';
            setTimeout(() => render(state), 150);
        } else {
            const r = game.result;
            sumDisplay.textContent = `Total : ${r.total}`;
            statusBanner.textContent = 'Résultat';
        }

        const alreadyBet = !!game.my_bet;
        betRow.hidden = game.phase !== 'betting' || alreadyBet;
        betTypes.querySelectorAll('.btn-outline').forEach(b => { b.disabled = game.phase !== 'betting' || alreadyBet; });

        if (game.phase === 'resolved' && !revealing) {
            betsSummary.innerHTML = (game.bets || []).map(b => `
                <li><span>${escapeHtml(b.username)} — ${describeBet(b)} (${b.amount})</span>
                <span class="${b.payout > 0 ? 'win' : 'lose'}">${b.payout > 0 ? '+' + b.payout : 'Perdu'}</span></li>
            `).join('');
            if (roundKey !== celebratedRoundKey) {
                celebratedRoundKey = roundKey;
                if (game.my_bet && game.my_bet.payout > 0) {
                    window.CasinoFX.confetti(root.querySelector('.dice-faces').parentElement, game.my_bet.payout >= game.my_bet.amount * 3 ? 20 : 12);
                }
            }
        } else {
            betsSummary.innerHTML = '';
        }

        forceResolveBtn.hidden = !(state.is_host && game.phase === 'betting');
        nextRoundBtn.hidden = !(state.is_host && (game.phase === 'resolved' && !revealing || game.phase === 'idle'));
    }

    async function poll() {
        try {
            const res = await fetch(`/casino/api/salon/${code}/dice/state`);
            const json = await res.json();
            if (res.ok) render(json);
        } catch (e) {}
    }

    placeBetBtn.addEventListener("click", async () => {
        if (!selectedType) { gameMsg.textContent = "Choisissez un pari d'abord."; return; }
        const amount = parseInt(betAmount.value, 10);
        try {
            await post(`/casino/api/salon/${code}/round/dice/bet`, { bet_type: selectedType, amount });
            gameMsg.textContent = '';
            poll();
        } catch (e) { gameMsg.textContent = e.message; }
    });
    forceResolveBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/dice/resolve`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    nextRoundBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/dice/next`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standUpBtn.addEventListener("click", async () => {
        await fetch(`/casino/api/salon/${code}/dice/stand`, { method: "POST" });
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    poll();
    const intervalId = setInterval(poll, 1500);
    return { stop() { clearInterval(rollTimer); clearInterval(intervalId); } };
};
