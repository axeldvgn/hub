const code = document.querySelector(".lobby-screen").dataset.code;
const playerList = document.getElementById("playerList");
const playerCount = document.getElementById("playerCount");
const hostControls = document.getElementById("hostControls");
const waitingHint = document.getElementById("waitingHint");
const startBtn = document.getElementById("startBtn");
const lobbyError = document.getElementById("lobbyError");

document.getElementById("copyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(code);
    const btn = document.getElementById("copyBtn");
    const original = btn.textContent;
    btn.textContent = "Copié !";
    setTimeout(() => { btn.textContent = original; }, 1200);
});

async function poll() {
    try {
        const res = await fetch(`/teinte/api/game/${code}/state`);
        const json = await res.json();
        if (!res.ok) {
            lobbyError.textContent = json.error || "Erreur.";
            return;
        }
        if (json.status === "playing") {
            window.location.href = `/teinte/game/${code}/play`;
            return;
        }
        if (json.status === "finished") {
            window.location.href = `/teinte/game/${code}/results`;
            return;
        }
        playerCount.textContent = json.players.length;
        playerList.innerHTML = json.players.map(p => `
            <li>
                <span>${escapeHtml(p.username)}</span>
                ${p.user_id === json.host_id ? '<span class="tag-host">Hôte</span>' : ''}
            </li>
        `).join("");

        if (json.is_host) {
            hostControls.hidden = false;
            waitingHint.hidden = true;
            startBtn.disabled = json.players.length < 2;
        } else {
            hostControls.hidden = true;
            waitingHint.hidden = false;
        }
    } catch (e) {
        lobbyError.textContent = "Connexion au serveur perdue, nouvelle tentative…";
    }
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    lobbyError.textContent = "";
    try {
        const res = await fetch(`/teinte/api/game/${code}/start`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
            lobbyError.textContent = json.error || "Impossible de démarrer.";
            startBtn.disabled = false;
        }
    } catch (e) {
        lobbyError.textContent = "Impossible de contacter le serveur.";
        startBtn.disabled = false;
    }
});

poll();
setInterval(poll, 1500);
