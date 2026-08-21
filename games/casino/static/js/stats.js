const GAME_LABELS = {
    poker: { icon: '♠️', name: 'Poker', unit: 'mains' },
    blackjack: { icon: '🃏', name: 'Blackjack', unit: 'mains' },
    roulette: { icon: '🎡', name: 'Roulette', unit: 'manches' },
    dice: { icon: '🎲', name: 'Dés', unit: 'manches' },
    slots: { icon: '🎰', name: 'Machines à sous', unit: 'manches' },
};

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function fmt(n) {
    return (n || 0).toLocaleString('fr-FR');
}

async function loadStats() {
    const res = await fetch('/casino/api/stats');
    const data = await res.json();
    document.getElementById('statsBalance').textContent = fmt(data.chips) + ' 🪙';

    const grid = document.getElementById('statsGrid');
    grid.innerHTML = Object.keys(GAME_LABELS).map(gt => {
        const s = data.stats[gt] || {};
        const played = s.rounds_played != null ? s.rounds_played : s.hands_played;
        const won = s.hands_won != null ? s.hands_won : null;
        const label = GAME_LABELS[gt];
        const netClass = (s.net || 0) > 0 ? 'win' : ((s.net || 0) < 0 ? 'lose' : '');
        return `<div class="stat-card">
            <h3>${label.icon} ${label.name}</h3>
            <p class="stat-line"><span>${label.unit} joué(e)s</span><span>${fmt(played)}</span></p>
            ${won != null ? `<p class="stat-line"><span>Gagné(e)s</span><span>${fmt(won)}</span></p>` : ''}
            <p class="stat-line"><span>Misé</span><span>${fmt(s.wagered)} 🪙</span></p>
            <p class="stat-line"><span>Récupéré</span><span>${fmt(s.won)} 🪙</span></p>
            <p class="stat-line net ${netClass}"><span>Solde net</span><span>${s.net > 0 ? '+' : ''}${fmt(s.net)} 🪙</span></p>
            <p class="stat-line"><span>Plus gros gain</span><span>${fmt(s.biggest_win)} 🪙</span></p>
        </div>`;
    }).join('');
}

async function loadLeaderboard() {
    const res = await fetch('/casino/api/leaderboard');
    const data = await res.json();
    const list = document.getElementById('leaderboard');
    list.innerHTML = data.leaderboard.map((p, i) => `
        <li><span class="rank-pos">#${i + 1}</span><span class="rank-name">${escapeHtml(p.username)}</span><span class="rank-score">${fmt(p.chips)} 🪙</span></li>
    `).join('') || '<li>Personne pour l\'instant.</li>';
}

loadStats();
loadLeaderboard();
