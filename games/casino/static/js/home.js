const createBtn = document.getElementById("createBtn");

createBtn.addEventListener("click", async () => {
    const errorEl = document.getElementById("createError");
    errorEl.textContent = "";
    createBtn.disabled = true;
    try {
        const res = await fetch("/casino/api/salon/create", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de créer le salon.";
            createBtn.disabled = false;
            return;
        }
        window.location.href = `/casino/salon/${json.code}`;
    } catch (e) {
        errorEl.textContent = "Impossible de contacter le serveur.";
        createBtn.disabled = false;
    }
});

document.getElementById("joinForm").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const errorEl = document.getElementById("joinError");
    errorEl.textContent = "";
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    if (!code) return;
    try {
        const res = await fetch("/casino/api/salon/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de rejoindre ce salon.";
            return;
        }
        window.location.href = `/casino/salon/${json.code}`;
    } catch (e) {
        errorEl.textContent = "Impossible de contacter le serveur.";
    }
});
