window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.roulette = function (root, code, myUserId) {
    const $ = (id) => root.querySelector("#" + id);

    const seatsRow = $("seatsRow");
    const wheelOuter = $("wheelOuter");
    const resultDisplay = $("resultDisplay");
    const statusBanner = $("statusBanner");
    const numberGrid = $("numberGrid");
    const betRow = $("betRow");
    const betAmount = $("betAmount");
    const placeBetBtn = $("placeBetBtn");
    const betsSummary = $("betsSummary");
    const forceResolveBtn = $("forceResolveBtn");
    const nextRoundBtn = $("nextRoundBtn");
    const standUpBtn = $("standUpBtn");
    const gameMsg = $("gameMsg");
    const outsideBets = root.querySelector("#outsideBets");

    const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
    let selectedBet = null;
    let wheelRotation = 0;
    let lastRoundKey = null;      // `${round_number}:${phase}` déjà traité (pour ne lancer l'animation qu'une fois)
    let revealAt = 0;             // timestamp où on peut révéler le résultat texte
    let celebratedRoundKey = null; // manche pour laquelle les confettis ont déjà été lancés

    function polarXY(cx, cy, r, angleDeg) {
        const rad = (angleDeg - 90) * Math.PI / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }
    function wedgePath(cx, cy, r, a0, a1) {
        const p0 = polarXY(cx, cy, r, a0), p1 = polarXY(cx, cy, r, a1);
        const large = (a1 - a0) > 180 ? 1 : 0;
        return `M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z`;
    }
    function buildWheel() {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 220 220');
        svg.classList.add('wheel-svg');
        const seg = 360 / 37;
        WHEEL_ORDER.forEach((num, i) => {
            const a0 = i * seg, a1 = (i + 1) * seg;
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', wedgePath(110, 110, 100, a0, a1));
            path.setAttribute('fill', num === 0 ? '#0b3d2e' : (RED_NUMBERS.has(num) ? '#a3294f' : '#161016'));
            path.setAttribute('stroke', '#d4af37');
            path.setAttribute('stroke-width', '0.6');
            svg.appendChild(path);
            const mid = a0 + seg / 2;
            const labelPos = polarXY(110, 110, 82, mid);
            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', labelPos.x.toFixed(2));
            text.setAttribute('y', labelPos.y.toFixed(2));
            text.setAttribute('fill', '#f6eeff');
            text.setAttribute('font-size', '9');
            text.setAttribute('font-family', 'Inter, sans-serif');
            text.setAttribute('font-weight', '700');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('transform', `rotate(${mid.toFixed(2)} ${labelPos.x.toFixed(2)} ${labelPos.y.toFixed(2)})`);
            text.textContent = num;
            svg.appendChild(text);
        });
        const rim = document.createElementNS(svgNS, 'circle');
        rim.setAttribute('cx', 110); rim.setAttribute('cy', 110); rim.setAttribute('r', 101);
        rim.setAttribute('fill', 'none'); rim.setAttribute('stroke', '#d4af37'); rim.setAttribute('stroke-width', '3');
        svg.appendChild(rim);
        const hub = document.createElementNS(svgNS, 'circle');
        hub.setAttribute('cx', 110); hub.setAttribute('cy', 110); hub.setAttribute('r', 14);
        hub.setAttribute('fill', '#d4af37');
        svg.appendChild(hub);
        wheelOuter.appendChild(svg);
        return svg;
    }
    const wheelSvg = buildWheel();
    function spinWheelTo(number) {
        const seg = 360 / 37;
        const idx = WHEEL_ORDER.indexOf(number);
        const center = idx * seg + seg / 2;
        const targetMod = ((-center) % 360 + 360) % 360;
        const prevMod = ((wheelRotation % 360) + 360) % 360;
        let delta = targetMod - prevMod;
        if (delta < 0) delta += 360;
        wheelRotation += 6 * 360 + delta;
        wheelSvg.style.transition = 'transform 3.2s cubic-bezier(0.12,0.72,0.18,1)';
        wheelSvg.style.transform = `rotate(${wheelRotation}deg)`;
    }

    numberGrid.innerHTML = '';
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
    outsideBets.querySelectorAll(".btn-outline").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedBet = { bet_type: btn.dataset.type, bet_value: null };
            highlight(btn);
        });
    });
    function highlight(el) {
        root.querySelectorAll(".num-btn, #outsideBets .btn-outline").forEach(b => b.classList.remove("selected"));
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
            spinWheelTo(game.result.number);
            if (window.CasinoSound) window.CasinoSound.spinWheel(3.2);
            revealAt = Date.now() + 3200;
        }
        lastRoundKey = roundKey;
        const revealing = game.phase === 'resolved' && Date.now() < revealAt;

        if (game.phase === 'idle') {
            resultDisplay.textContent = '—';
            statusBanner.textContent = '';
        } else if (game.phase === 'betting') {
            resultDisplay.textContent = '—';
            statusBanner.textContent = `Manche ${game.round_number} — mises ouvertes (${game.bet_count}/${state.players.length})`;
        } else if (revealing) {
            resultDisplay.textContent = '—';
            statusBanner.textContent = 'La bille tourne…';
            setTimeout(() => render(state), 250);
        } else {
            const r = game.result;
            resultDisplay.textContent = `${r.number} (${r.color})`;
            statusBanner.textContent = 'Résultat';
        }

        const alreadyBet = !!game.my_bet;
        betRow.hidden = game.phase !== 'betting' || alreadyBet;
        numberGrid.style.pointerEvents = (game.phase === 'betting' && !alreadyBet) ? 'auto' : 'none';
        numberGrid.style.opacity = (game.phase === 'betting' && !alreadyBet) ? '1' : '0.5';

        if (game.phase === 'resolved' && !revealing) {
            betsSummary.innerHTML = (game.bets || []).map(b => `
                <li><span>${escapeHtml(b.username)} — ${describeBet(b)} (${b.amount})</span>
                <span class="${b.payout > 0 ? 'win' : 'lose'}">${b.payout > 0 ? '+' + b.payout : 'Perdu'}</span></li>
            `).join('');
            if (roundKey !== celebratedRoundKey) {
                celebratedRoundKey = roundKey;
                if (game.my_bet) {
                    if (game.my_bet.payout > 0) {
                        const big = game.my_bet.payout >= game.my_bet.amount * 5;
                        window.CasinoFX.confetti(wheelOuter, big ? 24 : 14);
                        if (window.CasinoSound) big ? window.CasinoSound.jackpot() : window.CasinoSound.win(false);
                    } else if (window.CasinoSound) {
                        window.CasinoSound.lose();
                    }
                }
            }
        } else {
            betsSummary.innerHTML = '';
        }

        forceResolveBtn.hidden = !(state.is_host && game.phase === 'betting');
        nextRoundBtn.hidden = !(state.is_host && (game.phase === 'resolved' && !revealing || game.phase === 'idle'));
    }

    function describeBet(b) {
        const labels = { red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: 'Manque', high: 'Passe', number: 'N°' + b.bet_value };
        return labels[b.bet_type] || b.bet_type;
    }

    async function poll() {
        try {
            const res = await fetch(`/casino/api/salon/${code}/roulette/state`);
            const json = await res.json();
            if (res.ok) render(json);
        } catch (e) {}
    }

    placeBetBtn.addEventListener("click", async () => {
        if (!selectedBet) { gameMsg.textContent = "Choisissez une mise d'abord."; return; }
        const amount = parseInt(betAmount.value, 10);
        try {
            if (window.CasinoSound) window.CasinoSound.chip(3);
            await post(`/casino/api/salon/${code}/round/roulette/bet`, { ...selectedBet, amount });
            gameMsg.textContent = '';
            poll();
        } catch (e) { gameMsg.textContent = e.message; }
    });
    forceResolveBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/roulette/resolve`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    nextRoundBtn.addEventListener("click", async () => {
        try { await post(`/casino/api/salon/${code}/round/roulette/next`, {}); poll(); }
        catch (e) { gameMsg.textContent = e.message; }
    });
    standUpBtn.addEventListener("click", async () => {
        await fetch(`/casino/api/salon/${code}/roulette/stand`, { method: "POST" });
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    poll();
    const intervalId = setInterval(poll, 1500);
    return { stop() { clearInterval(intervalId); } };
};
