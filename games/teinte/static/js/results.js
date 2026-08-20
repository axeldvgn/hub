const code = document.querySelector(".results-screen").dataset.code;
const heading = document.getElementById("winnerHeading");
const rankingList = document.getElementById("rankingList");

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

async function load() {
    const res = await fetch(`/teinte/api/game/${code}/results`);
    const json = await res.json();
    if (!res.ok || !json.ranking.length) {
        heading.textContent = "Impossible de charger les résultats.";
        return;
    }
    heading.textContent = `🏆 ${json.ranking[0].username} remporte la partie !`;
    rankingList.innerHTML = json.ranking.map((p, i) => `
        <li>
            <span class="rank-pos">#${i + 1}</span>
            <span class="rank-name">${escapeHtml(p.username)}</span>
            <span class="rank-score">${p.average_pct}% de moyenne · ${p.score_total} pts</span>
        </li>
    `).join("");
}

load();
