window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.slots = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const seatsRow = $("seatsRow");
    const statusBanner = $("statusBanner");
    const slotCabinet = $("slotCabinet");
    const bulbRow = $("bulbRow");
    const strip1 = $("strip1");
    const strip2 = $("strip2");
    const strip3 = $("strip3");
    const betRow = $("betRow");
    const betAmount = $("betAmount");
    const placeBetBtn = $("placeBetBtn");
    const betsSummary = $("betsSummary");
    const forceResolveBtn = $("forceResolveBtn");
    const nextRoundBtn = $("nextRoundBtn");
    const standUpBtn = $("standUpBtn");
    const gameMsg = $("gameMsg");

    const SLOT_SYMS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
    let lastRoundKey = null;
    let revealAt = 0;
    let celebratedRoundKey = null;
    let spinning = false;

    for (let i = 0; i < 10; i++) {
        const b = document.createElement('span');
        b.className = 'bulb';
        b.style.animationDelay = (i * 0.12) + 's';
        bulbRow.appendChild(b);
    }

    function randomSymbol() { return SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)]; }
    function buildStrip(stripEl, finalSymbol) {
        stripEl.style.transition = 'none';
        stripEl.style.transform = 'translateY(0px)';
        stripEl.innerHTML = '';
        const N = 18;
        for (let i = 0; i < N - 1; i++) {
            const d = document.createElement('div');
            d.className = 'sym';
            d.textContent = randomSymbol();
            stripEl.appendChild(d);
        }
        const last = document.createElement('div');
        last.className = 'sym';
        last.textContent = finalSymbol;
        stripEl.appendChild(last);
        void stripEl.offsetHeight;
    }
    function spinStrip(stripEl, finalSymbol, durationMs) {
        return new Promise(resolve => {
            buildStrip(stripEl, finalSymbol);
            const totalHeight = 17 * 70;
            requestAnimationFrame(() => {
                stripEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.17,0.67,0.24,1)`;
                stripEl.style.transform = `translateY(-${totalHeight}px)`;
            });
            setTimeout(resolve, durationMs + 40);
        });
    }
    async function playSpin(symbols) {
        spinning = true;
        await Promise.all([
            spinStrip(strip1, symbols[0], 900),
            spinStrip(strip2, symbols[1], 1150),
            spinStrip(strip3, symbols[2], 1400),
        ]);
        spinning = false;
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
            revealAt = Date.now() + 1500;
            playSpin(game.result.symbols);
        }
        lastRoundKey = roundKey;
        const revealing = game.phase === 'resolved' && (spinning || Date.now() < revealAt);

        if (game.phase === 'betting' || game.phase === 'idle') {
            statusBanner.textContent = game.phase === 'betting'
                ? `Manche ${game.round_number} — mises ouvertes (${game.bet_count}/${state.players.length})` : '';
        } else if (revealing) {
            statusBanner.textContent = 'Les rouleaux tournent…';
            setTimeout(() => render(state), 200);
        } else {
            statusBanner.textContent = 'Résultat';
        }

        const alreadyBet = !!game.my_bet;
        betRow.hidden = game.phase !== 'betting' || alreadyBet;

        if (game.phase === 'resolved' && !revealing) {
            betsSummary.innerHTML = (game.bets || []).map(b => `
                <li><span>${escapeHtml(b.username)} — mise ${b.amount}</span>
                <span class="${b.payout > 0 ? 'win' : 'lose'}">${b.payout > 0 ? '+' + b.payout : 'Perdu'}</span></li>
            `).join('');
            if (roundKey !== celebratedRoundKey) {
                celebratedRoundKey = roundKey;
                if (game.my_bet && game.my_bet.payout > 0) {
                    slotCabinet.classList.add('win-glow');
                    setTimeout(() => slotCabinet.classList.remove('win-glow'), 1100);
                    window.CasinoFX.confetti(slotCabinet, game.my_bet.payout >= game.my_bet.amount * 10 ? 22 : 12);
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
