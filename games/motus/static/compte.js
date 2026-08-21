/* compte.js
   Doit être chargé APRÈS motus.js dans la page (ordre des <script>).
   Le compte est celui du hub (connexion unique) : ce fichier ne fait plus
   que réclamer un token motus via la session hub (cookie envoyé
   automatiquement), sans jamais redemander pseudo/mot de passe ici.
*/

const API_BASE = "/motus/api";

let compteToken = localStorage.getItem("motus_token");
let comptePseudo = localStorage.getItem("motus_pseudo");

/* ---------- Construction de l'UI (injectée avant la grille) ---------- */
function injecterUI() {
  const sidebar = document.createElement("div");
  sidebar.id = "compte-sidebar";
  document.body.appendChild(sidebar);

  const panel = document.createElement("div");
  panel.id = "compte-panel";
  sidebar.appendChild(panel);

  const classementTable = document.createElement("table");
  classementTable.id = "compte-classement";
  sidebar.appendChild(classementTable);

  afficherPanel();
  chargerClassement();
  connecterViaHub();
}

function afficherPanel() {
  const panel = document.getElementById("compte-panel");

  if (!compteToken) {
    panel.innerHTML = `
      <h2>Compte</h2>
      <div class="cp-infos">Connecte-toi une fois sur le hub pour retrouver ton compte ici.</div>
      <div class="cp-boutons">
        <a id="cp-connexion" href="/login?next=/motus/">Se connecter</a>
      </div>
    `;
  } else {
    panel.innerHTML = `
      <h2>Compte</h2>
      <div class="cp-infos">Connecté en tant que <b>${comptePseudo}</b></div>
      <div class="cp-boutons">
        <button id="cp-deconnexion">Déconnexion</button>
      </div>
    `;
    document.getElementById("cp-deconnexion").onclick = deconnexion;
  }
}

/* ---------- Auth (via la session du hub) ---------- */
async function connecterViaHub() {
  if (compteToken) return; // déjà un token motus valide, rien à faire
  try {
    const reponse = await fetch(API_BASE + "/auto", { method: "POST" });
    if (!reponse.ok) return; // pas connecté au hub : on laisse le lien "Se connecter"
    const data = await reponse.json();
    compteToken = data.token;
    comptePseudo = data.pseudo;
    localStorage.setItem("motus_token", compteToken);
    localStorage.setItem("motus_pseudo", comptePseudo);
    afficherPanel();
  } catch (e) { /* silencieux : pas de blocage du jeu si le serveur est injoignable */ }
}

async function deconnexion() {
  try {
    await fetch(API_BASE + "/deconnexion", {
      method: "POST",
      headers: { "Authorization": "Bearer " + compteToken }
    });
  } catch (e) { /* silencieux */ }

  compteToken = null;
  comptePseudo = null;
  localStorage.removeItem("motus_token");
  localStorage.removeItem("motus_pseudo");
  window.location.href = "/login";
}

/* ---------- Classement (toujours visible, à droite) ---------- */
async function chargerClassement() {
  const table = document.getElementById("compte-classement");
  try {
    const reponse = await fetch(API_BASE + "/classement", { cache: "no-store" });
    const lignes = await reponse.json();

    let html = `
      <caption>Classement</caption>
      <tr>
        <th>#</th><th>Pseudo</th><th>Parties</th><th>Victoires</th><th>Essais moy.</th>
      </tr>
    `;
    if (lignes.length === 0) {
      html += `<tr><td colspan="5">Aucune partie enregistrée</td></tr>`;
    }
    lignes.forEach((l, i) => {
      html += `
        <tr>
          <td>${i + 1}</td>
          <td>${l.pseudo}</td>
          <td>${l.parties_jouees}</td>
          <td>${l.victoires}</td>
          <td>${l.moyenne_essais ?? "—"}</td>
        </tr>
      `;
    });
    table.innerHTML = html;
  } catch (e) {
    table.innerHTML = `<caption>Classement</caption><tr><td>Serveur injoignable</td></tr>`;
  }
}

/* ---------- Envoi automatique du score en fin de partie ---------- */
async function envoyerScore(gagne, essais) {
  if (!compteToken) return;
  try {
    await fetch(API_BASE + "/score", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + compteToken
      },
      body: JSON.stringify({ gagne, essais })
    });
    chargerClassement();
  } catch (e) { /* silencieux : pas de blocage du jeu si le serveur est éteint */ }
}

/* Récupère la fonction valider() de motus.js et l'enrobe, sans toucher au fichier */
function accrocherAuJeu() {
  if (typeof valider !== "function") {
    console.warn("compte.js : fonction valider() introuvable, vérifie l'ordre des <script>.");
    return;
  }
  const validerOriginale = valider;
  valider = function () {
    const finiAvant = partieFinie;
    validerOriginale();
    if (!finiAvant && partieFinie) {
      const gagne = messageEl.textContent.includes("Bravo");
      const nbEssais = gagne ? essaiActuel + 1 : 6;
      envoyerScore(gagne, nbEssais);
    }
  };
}

/* ---------- Initialisation ---------- */
document.addEventListener("DOMContentLoaded", () => {
  injecterUI();
  accrocherAuJeu();
});