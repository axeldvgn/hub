document.getElementById("createBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("createError");
    errorEl.textContent = "";
    try {
        const res = await fetch("/teinte/api/game/create", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de créer la partie.";
            return;
        }
        window.location.href = `/teinte/game/${json.code}/lobby`;
    } catch (e) {
        errorEl.textContent = "Impossible de contacter le serveur.";
    }
});

document.getElementById("joinForm").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const errorEl = document.getElementById("joinError");
    errorEl.textContent = "";
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    if (!code) return;
    try {
        const res = await fetch("/teinte/api/game/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de rejoindre la partie.";
            return;
        }
        window.location.href = `/teinte/game/${json.code}/lobby`;
    } catch (e) {
        errorEl.textContent = "Impossible de contacter le serveur.";
    }
});
