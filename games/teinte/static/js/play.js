const screen = document.querySelector(".play-screen");
const code = screen.dataset.code;

const wheelCanvas = document.getElementById("wheelCanvas");
const wheelCursor = document.getElementById("wheelCursor");
const wheelPreview = document.getElementById("wheelPreview");
const characterShapeEl = document.getElementById("characterShape");
const officialShapeEl = document.getElementById("officialShape");
const colorPreviewBox = document.getElementById("colorPreviewBox");
const presetSwatches = document.getElementById("presetSwatches");
const valueSlider = document.getElementById("valueSlider");
const hexInput = document.getElementById("hexInput");
const rInput = document.getElementById("rInput");
const gInput = document.getElementById("gInput");
const bInput = document.getElementById("bInput");
const validateBtn = document.getElementById("validateBtn");

const roundNumberEl = document.getElementById("roundNumber");
const franchiseLabel = document.getElementById("franchiseLabel");
const promptText = document.getElementById("promptText");
const submitStatus = document.getElementById("submitStatus");
const scoreboardMini = document.getElementById("scoreboardMini");
const pickerArea = document.getElementById("pickerArea");
const revealArea = document.getElementById("revealArea");
const officialHex = document.getElementById("officialHex");
const guessResults = document.getElementById("guessResults");
const hostNextControls = document.getElementById("hostNextControls");
const waitingNextHint = document.getElementById("waitingNextHint");
const nextBtn = document.getElementById("nextBtn");
const hostForceControls = document.getElementById("hostForceControls");
const forceRevealBtn = document.getElementById("forceRevealBtn");

let wheel;
let lastRoundNumber = null;
let lastRoundStatus = null;
let hasSubmittedLocally = false;
let syncingInputs = false;
let updateShapeColor = null;
let currentShapeKey = "outfit";

function initWheel() {
    wheel = new ColorWheel(wheelCanvas, wheelCursor, wheelPreview, {
        onChange: ({ r, g, b, hex }) => syncFrom({ r, g, b, hex }, "wheel"),
    });
    wheel.setValue(parseInt(valueSlider.value, 10) / 100);
    wheel.setHex(hexInput.value);
}

function syncFrom(color, source) {
    if (syncingInputs) return;
    syncingInputs = true;
    if (source !== "wheel") {
        wheel.setHex(color.hex);
        valueSlider.value = Math.round(wheel.v * 100);
    }
    hexInput.value = color.hex;
    rInput.value = color.r;
    gInput.value = color.g;
    bInput.value = color.b;
    colorPreviewBox.style.background = color.hex;
    if (updateShapeColor) updateShapeColor(color.hex);
    syncingInputs = false;
}

valueSlider.addEventListener("input", () => {
    wheel.setValue(parseInt(valueSlider.value, 10) / 100);
    const [r, g, b] = wheel.getRgb();
    syncFrom({ r, g, b, hex: wheel.getHex() }, "value");
});

hexInput.addEventListener("change", () => {
    const val = hexInput.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
        const hex = val.startsWith("#") ? val : "#" + val;
        wheel.setHex(hex);
        valueSlider.value = Math.round(wheel.v * 100);
        const [r, g, b] = wheel.getRgb();
        syncFrom({ r, g, b, hex: wheel.getHex() }, "hex");
    }
});

function rgbInputsChanged() {
    const r = clamp255(rInput.value);
    const g = clamp255(gInput.value);
    const b = clamp255(bInput.value);
    const hex = "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    wheel.setHex(hex);
    valueSlider.value = Math.round(wheel.v * 100);
    syncFrom({ r, g, b, hex }, "rgb");
}
[rInput, gInput, bInput].forEach(inp => inp.addEventListener("change", rgbInputsChanged));

presetSwatches.querySelectorAll(".preset-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
        const hex = btn.dataset.hex;
        wheel.setHex(hex);
        valueSlider.value = Math.round(wheel.v * 100);
        const [r, g, b] = wheel.getRgb();
        syncFrom({ r, g, b, hex: wheel.getHex() }, "preset");
    });
});

function clamp255(v) {
    v = parseInt(v, 10);
    if (isNaN(v)) return 0;
    return Math.max(0, Math.min(255, v));
}

validateBtn.addEventListener("click", async () => {
    if (hasSubmittedLocally) return;
    validateBtn.disabled = true;
    try {
        const res = await fetch(`/teinte/api/game/${code}/guess`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hex: hexInput.value }),
        });
        const json = await res.json();
        if (!res.ok) {
            submitStatus.textContent = json.error || "Erreur lors de l'envoi.";
            validateBtn.disabled = false;
            return;
        }
        hasSubmittedLocally = true;
        submitStatus.textContent = "Couleur validée, en attente des autres joueurs…";
    } catch (e) {
        submitStatus.textContent = "Impossible de contacter le serveur.";
        validateBtn.disabled = false;
    }
});

forceRevealBtn.addEventListener("click", async () => {
    forceRevealBtn.disabled = true;
    await fetch(`/teinte/api/game/${code}/reveal`, { method: "POST" });
});

nextBtn.addEventListener("click", async () => {
    nextBtn.disabled = true;
    await fetch(`/teinte/api/game/${code}/next`, { method: "POST" });
});

function renderScoreboard(players) {
    scoreboardMini.innerHTML = players
        .slice()
        .sort((a, b) => b.score_total - a.score_total)
        .map(p => `<span class="chip">${escapeHtml(p.username)} <b>${p.score_total}</b></span>`)
        .join("");
}

function renderReveal(round) {
    renderCharacterShape(officialShapeEl, round.shape, round.color_hex, round.character_name);
    officialHex.textContent = round.color_hex;

    const sorted = round.guesses.slice().sort((a, b) => b.score_pct - a.score_pct);
    guessResults.innerHTML = sorted
        .map((g, i) => `
            <div class="guess-card${i === 0 ? " is-winner" : ""}">
                <div class="character-shape" data-hex="${g.guessed_hex}"></div>
                <div class="guess-card-footer">
                    <span class="guess-card-name">${escapeHtml(g.username)}</span>
                    <span class="guess-card-score">${g.score_pct}%</span>
                </div>
            </div>
        `)
        .join("");
    guessResults.querySelectorAll(".character-shape").forEach(el => {
        renderCharacterShape(el, round.shape, el.dataset.hex, round.character_name);
    });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

async function poll() {
    try {
        const res = await fetch(`/teinte/api/game/${code}/state`);
        const json = await res.json();
        if (!res.ok) return;

        if (json.status === "finished") {
            window.location.href = `/teinte/game/${code}/results`;
            return;
        }
        if (json.status !== "playing" || !json.round) return;

        renderScoreboard(json.players);
        const round = json.round;
        roundNumberEl.textContent = round.round_number;

        if (round.round_number !== lastRoundNumber) {
            lastRoundNumber = round.round_number;
            hasSubmittedLocally = false;
            validateBtn.disabled = false;
            currentShapeKey = round.shape;
            wheel.setHSV(Math.random() * 360, 0.5, 0.8);
            valueSlider.value = 80;
            updateShapeColor = renderCharacterShape(characterShapeEl, currentShapeKey, wheel.getHex(), round.character_name);
            const [r, g, b] = wheel.getRgb();
            syncFrom({ r, g, b, hex: wheel.getHex() }, "reset");
        }

        franchiseLabel.textContent = round.franchise;
        promptText.textContent = `Quelle est la couleur de ${round.item} de ${round.character_name} ?`;

        if (round.status === "guessing") {
            pickerArea.hidden = false;
            revealArea.hidden = true;
            submitStatus.textContent = round.my_submitted
                ? "Couleur validée, en attente des autres joueurs…"
                : `${round.submitted_count}/${round.player_count} joueurs ont validé`;
            if (round.my_submitted) {
                hasSubmittedLocally = true;
                validateBtn.disabled = true;
            }
            hostForceControls.hidden = !json.is_host;
        } else if (round.status === "revealed") {
            pickerArea.hidden = true;
            revealArea.hidden = false;
            hostForceControls.hidden = true;
            renderReveal(round);
            if (json.is_host) {
                hostNextControls.hidden = false;
                waitingNextHint.hidden = true;
                nextBtn.disabled = false;
            } else {
                hostNextControls.hidden = true;
                waitingNextHint.hidden = false;
            }
        }
    } catch (e) {
        // silencieux : on retentera au prochain cycle
    }
}

initWheel();
poll();
setInterval(poll, 1500);
