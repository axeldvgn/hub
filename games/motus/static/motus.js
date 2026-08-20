let MOTS_5 = [];

let motSecret = "";
let essaiActuel = 0;
let lettreActuelle = 0;
let grilleEtat = [];
let partieFinie = false;

const grilleEl = document.getElementById('grille');
const messageEl = document.getElementById('message');
const clavierEl = document.getElementById('clavier');

const disposition = [
  "AZERTYUIOP",
  "QSDFGHJKLM",
  "ENTRER-WXCVBN-EFFACER"
];

let lastTouchEnd = 0;
document.addEventListener('touchend', function(e) {
  const now = Date.now();
  const dejaDoubleTap = (now - lastTouchEnd) <= 300;
  lastTouchEnd = now;

  if (!dejaDoubleTap) return;

  const bouton = e.target.closest('button');
  if (bouton) {
    e.preventDefault();
    bouton.click();
  } else {
    e.preventDefault();
  }
}, { passive: false });


function normaliser(mot){
  return mot.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
}

function nouvellePartie(){
  motSecret = normaliser(MOTS_5[Math.floor(Math.random()*MOTS_5.length)]);
  essaiActuel = 0;
  lettreActuelle = 0;
  partieFinie = false;
  grilleEtat = Array.from({length:6}, () => Array(5).fill(""));
  messageEl.textContent = "";
  construireGrille();
  construireClavier();
}

function construireGrille(){
  grilleEl.innerHTML = "";
  for(let i=0;i<6;i++){
    const ligne = document.createElement('div');
    ligne.className = 'ligne';
    ligne.id = 'ligne-'+i;
    for(let j=0;j<5;j++){
      const c = document.createElement('div');
      c.className = 'case';
      c.id = `case-${i}-${j}`;
      ligne.appendChild(c);
    }
    grilleEl.appendChild(ligne);
  }
}

function construireClavier(){
  clavierEl.innerHTML = "";
  disposition.forEach(rangee => {
    const div = document.createElement('div');
    div.className = 'rangee-clavier';
    let touches = rangee.split('-');
    touches.forEach(groupe => {
      if(groupe === "ENTRER" || groupe === "EFFACER"){
        const b = document.createElement('button');
        b.className = 'touche large';
        b.textContent = groupe === "ENTRER" ? "ENTRER" : "EFFACER";
        b.onclick = () => groupe === "ENTRER" ? valider() : effacer();
        div.appendChild(b);
      } else {
        groupe.split('').forEach(l => {
          const b = document.createElement('button');
          b.className = 'touche';
          b.textContent = l;
          b.id = 'touche-'+l;
          b.onclick = () => saisirLettre(l);
          div.appendChild(b);
        });
      }
    });
    clavierEl.appendChild(div);
  });
}

function saisirLettre(l){
  if(partieFinie || lettreActuelle >= 5) return;
  grilleEtat[essaiActuel][lettreActuelle] = l;
  const c = document.getElementById(`case-${essaiActuel}-${lettreActuelle}`);
  c.textContent = l;
  c.classList.add('rempli','pop');
  lettreActuelle++;
}

function effacer(){
  if(partieFinie || lettreActuelle === 0) return;
  lettreActuelle--;
  grilleEtat[essaiActuel][lettreActuelle] = "";
  const c = document.getElementById(`case-${essaiActuel}-${lettreActuelle}`);
  c.textContent = "";
  c.classList.remove('rempli');
}

function secouerLigne(){
  const ligne = document.getElementById('ligne-'+essaiActuel);
  ligne.querySelectorAll('.case').forEach(c => {
    c.classList.add('shake');
    setTimeout(()=>c.classList.remove('shake'), 300);
  });
}

function valider(){
  if(partieFinie) return;
  if(lettreActuelle < 5){
    messageEl.textContent = "Il manque des lettres !";
    secouerLigne();
    return;
  }
  const motEssai = grilleEtat[essaiActuel].join('');

  if(!MOTS_5.includes(motEssai)){
    messageEl.style.color = "#c1443c";
    messageEl.textContent = "Ce mot n'existe pas !";
    secouerLigne();
    return;
  }

  const resultat = evaluer(motEssai, motSecret);
  colorierLigne(essaiActuel, resultat, motEssai);

  if(motEssai === motSecret){
    partieFinie = true;
    messageEl.style.color = "#4f8a5b";
    messageEl.textContent = "Bravo ! Le mot était " + motSecret + " 🎉";
    return;
  }

  essaiActuel++;
  lettreActuelle = 0;

  if(essaiActuel === 6){
    partieFinie = true;
    messageEl.style.color = "#c1443c";
    messageEl.textContent = "Perdu ! Le mot était " + motSecret + " gros looser 🤪";
  }
}

function evaluer(motEssai, motCible){
  const resultat = Array(5).fill('absent');
  const cibleLettres = motCible.split('');
  const utilisees = Array(5).fill(false);

  // Lettres correctes
  for(let i=0;i<5;i++){
    if(motEssai[i] === motCible[i]){
      resultat[i] = 'correct';
      utilisees[i] = true;
    }
  }
  // Lettres présentes mais mal placées
  for(let i=0;i<5;i++){
    if(resultat[i] === 'correct') continue;
    const idx = cibleLettres.findIndex((l,j) => l === motEssai[i] && !utilisees[j]);
    if(idx !== -1){
      resultat[i] = 'present';
      utilisees[idx] = true;
    }
  }
  return resultat;
}

function colorierLigne(ligne, resultat, motEssai){
  for(let j=0;j<5;j++){
    const c = document.getElementById(`case-${ligne}-${j}`);
    setTimeout(() => {
      c.classList.add(resultat[j]);
    }, j*120);

    const touche = document.getElementById('touche-'+motEssai[j]);
    if(touche){
      if(resultat[j] === 'correct'){
        touche.classList.remove('present','absent');
        touche.classList.add('correct');
      } else if(resultat[j] === 'present' && !touche.classList.contains('correct')){
        touche.classList.remove('absent');
        touche.classList.add('present');
      } else if(!touche.classList.contains('correct') && !touche.classList.contains('present')){
        touche.classList.add('absent');
      }
    }
  }
}

document.addEventListener('keydown', (e) => {
  const touche = e.key.toUpperCase();
  if(touche === 'ENTER') valider();
  else if(touche === 'BACKSPACE') effacer();
  else if(/^[A-Z]$/.test(touche)) saisirLettre(touche);
});

async function chargerMots(){
  try{
    const reponse = await fetch('/motus/static/mots.txt');
    if(!reponse.ok) throw new Error('Fichier introuvable');
    const texte = await reponse.text();
    MOTS_5 = [...new Set(
      texte.split(/\r?\n/)
        .map(m => normaliser(m.trim()))
        .filter(m => m.length === 5)
    )];
    if(MOTS_5.length === 0) throw new Error('Liste vide');
    nouvellePartie();
  } catch(e){
    messageEl.style.color = "#c1443c";
    messageEl.textContent = "Impossible de charger mots.txt (utilise un serveur local, ex. Live Server, pas un double-clic sur le fichier).";
  }
}

document.getElementById('btn-nouvelle-partie').onclick = nouvellePartie;

chargerMots();