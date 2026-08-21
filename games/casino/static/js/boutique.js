window.CasinoGames = window.CasinoGames || {};
window.CasinoGames.boutique = function (root) {
    const $ = (id) => root.querySelector("#" + id);
    const chipsDisplay = $("boutiqueChips");
    const skinGrid = $("skinGrid");
    const closeBtn = $("boutiqueCloseBtn");
    const msg = $("boutiqueMsg");

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function swatchHex(color) {
        return '#' + parseInt(color, 16).toString(16).padStart(6, '0');
    }

    async function load() {
        try {
            const res = await fetch('/casino/api/skins');
            const data = await res.json();
            if (!res.ok) { msg.textContent = data.error || 'Erreur.'; return; }
            render(data);
        } catch (e) {
            msg.textContent = "Connexion au serveur perdue.";
        }
    }

    function render(data) {
        chipsDisplay.textContent = `${data.chips.toLocaleString('fr-FR')} 🪙`;
        const topbarChips = document.getElementById("topbarChips");
        if (topbarChips) topbarChips.textContent = data.chips.toLocaleString('fr-FR') + " 🪙";

        skinGrid.innerHTML = data.skins.map(s => {
            const equipped = s.id === data.equipped;
            const label = equipped ? 'Équipé' : (s.owned ? 'Équiper' : `Débloquer (${s.price} 🪙)`);
            return `<div class="skin-card${equipped ? ' equipped' : ''}">
                <div class="skin-swatch" style="background:${swatchHex(s.color)}"></div>
                <p class="skin-name">${escapeHtml(s.name)}</p>
                <button class="btn-outline skin-btn" data-skin="${s.id}"${equipped ? ' disabled' : ''}>${label}</button>
            </div>`;
        }).join('');

        skinGrid.querySelectorAll('.skin-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                msg.textContent = '';
                try {
                    if (window.CasinoSound) window.CasinoSound.chip(2);
                    const res = await fetch('/casino/api/skins/equip', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ skin_id: btn.dataset.skin }),
                    });
                    const json = await res.json();
                    if (!res.ok) { msg.textContent = json.error || 'Erreur.'; return; }
                    const chosen = data.skins.find(sk => sk.id === btn.dataset.skin);
                    if (window.__casinoApplySkin && chosen) window.__casinoApplySkin(chosen.color);
                    load();
                } catch (e) { msg.textContent = "Impossible de contacter le serveur."; }
            });
        });
    }

    closeBtn.addEventListener("click", () => {
        if (window.__casinoCloseModal) window.__casinoCloseModal();
    });

    load();
    return { stop() {} };
};
