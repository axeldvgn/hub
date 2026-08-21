let selectedType = null;
const createBtn = document.getElementById("createBtn");

document.querySelectorAll(".game-type-option").forEach(opt => {
    opt.addEventListener("click", () => {
        document.querySelectorAll(".game-type-option").forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
        selectedType = opt.dataset.type;
        createBtn.disabled = false;
    });
});

createBtn.addEventListener("click", async () => {
    const errorEl = document.getElementById("createError");
    errorEl.textContent = "";
    if (!selectedType) return;
    createBtn.disabled = true;
    try {
        const res = await fetch("/casino/api/table/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game_type: selectedType }),
        });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de créer la table.";
            createBtn.disabled = false;
            return;
        }
        window.location.href = `/casino/table/${json.code}`;
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
        const res = await fetch("/casino/api/table/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        const json = await res.json();
        if (!res.ok) {
            errorEl.textContent = json.error || "Impossible de rejoindre cette table.";
            return;
        }
        window.location.href = `/casino/table/${json.code}`;
    } catch (e) {
        errorEl.textContent = "Impossible de contacter le serveur.";
    }
});
