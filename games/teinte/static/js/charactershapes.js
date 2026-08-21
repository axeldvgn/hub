/* Silhouettes originales (dessins vectoriels maison, pas des reproductions
   d'œuvres protégées) pour visualiser la couleur directement "sur" le
   personnage. Chaque personnage a une base (forme générale liée à l'objet à
   deviner) + un accessoire distinctif (chapeau, oreilles, couronne...) qui
   le rend reconnaissable, tout en gardant l'attribut à colorer en évidence. */

const NEUTRAL = "#3a3856";
const OUTLINE = "#4a4770";

const SHAPE_TEMPLATES = {
    skin: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="46" rx="30" ry="32" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M40 150 C40 100 55 82 80 82 C105 82 120 100 120 150 Z" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    fur: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="55" cy="45" r="16" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
            <circle cx="105" cy="45" r="16" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
            <ellipse cx="80" cy="95" rx="55" ry="48" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    hair: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="70" rx="34" ry="36" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M44 60 C44 20 116 20 116 60 C116 40 100 30 80 32 C60 30 44 40 44 60 Z" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M40 140 C40 100 56 90 80 90 C104 90 120 100 120 140 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    beard: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="50" rx="28" ry="30" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M52 55 C52 95 64 118 80 118 C96 118 108 95 108 55 C108 75 96 85 80 85 C64 85 52 75 52 55 Z" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M40 150 C40 112 56 98 80 98 C104 98 120 112 120 150 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    hat: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="80" cy="80" rx="34" ry="36" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M40 150 C40 108 56 96 80 96 C104 96 120 108 120 150 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M42 58 C42 30 118 30 118 58 L128 66 L32 66 Z" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    dress: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="80" cy="34" r="22" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M60 56 L100 56 L130 150 L30 150 Z" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    blob: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="80" cy="85" r="60" data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
    straps: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="80" cy="34" r="20" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <rect x="42" y="58" width="76" height="92" rx="10" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M55 58 L70 150" data-colorable="stroke" stroke-width="14" stroke-linecap="round" fill="none"/>
            <path d="M105 58 L90 150" data-colorable="stroke" stroke-width="14" stroke-linecap="round" fill="none"/>
        </svg>`,
    outfit: `
        <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
            <circle cx="80" cy="32" r="20" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M50 56 L30 76 L44 96 L58 84 L58 150 L102 150 L102 84 L116 96 L130 76 L110 56 C110 68 96 76 80 76 C64 76 50 68 50 56 Z"
                  data-colorable="fill" stroke="${OUTLINE}" stroke-width="3"/>
        </svg>`,
};

/* Petits accessoires distinctifs (couleur fixe, non éditable) ajoutés
   au-dessus de la forme de base pour rendre chaque personnage
   reconnaissable. Coordonnées calées sur le viewBox 0 0 160 160 de la
   forme de base correspondante. */
const CHARACTER_ACCESSORIES = {
    "Sherlock Holmes": `
        <path d="M55 22 C55 6 105 6 105 22 L112 18 L118 26 L104 30 L98 20 L62 20 L56 30 L42 26 L48 18 Z"
              fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>`,
    "Dracula": `
        <path d="M80 12 L68 24 L80 20 L92 24 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M50 56 L40 44 L58 52 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M110 56 L120 44 L102 52 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Frankenstein": `
        <rect x="58" y="14" width="44" height="14" rx="3" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <circle cx="52" cy="74" r="5" fill="${OUTLINE}"/>
        <circle cx="108" cy="74" r="5" fill="${OUTLINE}"/>`,
    "Alice": `
        <path d="M46 24 C60 12 100 12 114 24" fill="none" stroke="${OUTLINE}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="112" cy="30" r="6" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    "Le Lapin Blanc": `
        <path d="M60 34 C56 4 70 -4 72 20 C74 4 82 4 78 30 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M100 34 C96 4 82 -4 80 20 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <circle cx="100" cy="90" r="9" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/>`,
    "Le Chat du Cheshire": `
        <path d="M60 40 L48 20 L64 32 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M100 40 L112 20 L96 32 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M60 100 C70 112 90 112 100 100" fill="none" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "La Reine de Cœur": `
        <path d="M52 22 L60 8 L68 20 L80 4 L92 20 L100 8 L108 22 L108 30 L52 30 Z"
              fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M80 96 C74 88 62 90 62 100 C62 110 80 122 80 122 C80 122 98 110 98 100 C98 90 86 88 80 96 Z"
              fill="${OUTLINE}"/>`,
    "Robin des Bois": `
        <path d="M56 30 C56 4 104 4 104 30 L92 40 L68 40 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M104 14 L124 6" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "Merlin l'Enchanteur": `
        <path d="M56 22 L104 22 L80 -22 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M78 -6 L82 -6 L83 -2 L87 -2 L84 1 L85 5 L80 3 L75 5 L76 1 L73 -2 L77 -2 Z" fill="${OUTLINE}"/>
        <path d="M52 90 C52 130 60 148 62 150 L58 150 C56 148 46 128 48 88 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    "Le Petit Chaperon Rouge": `
        <path d="M52 30 C52 2 108 2 108 30 L98 42 L62 42 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5" opacity="0.85"/>`,
    "Le Grand Méchant Loup": `
        <path d="M56 34 L44 12 L66 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M104 34 L116 12 L94 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M80 110 L68 128 L92 128 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Le Chat Botté": `
        <path d="M58 34 L48 14 L68 28 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M102 34 L112 14 L92 28 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M50 20 C50 8 80 6 96 16 L88 26 L54 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M30 146 L30 160 L48 160 L48 150 L40 150 L40 140 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="1.5"/>
        <path d="M130 146 L130 160 L112 160 L112 150 L120 150 L120 140 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="1.5"/>`,
    "Cendrillon": `
        <path d="M54 20 C54 8 106 8 106 20 L98 26 L62 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <circle cx="34" cy="70" r="14" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <circle cx="126" cy="70" r="14" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Barbe Bleue": `
        <circle cx="68" cy="44" r="4" fill="${OUTLINE}"/>
        <circle cx="92" cy="44" r="4" fill="${OUTLINE}"/>
        <path d="M62 34 L74 30" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>
        <path d="M98 34 L86 30" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "Peau d'Âne": `
        <ellipse cx="52" cy="10" rx="10" ry="20" transform="rotate(-20 52 10)" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <ellipse cx="108" cy="10" rx="10" ry="20" transform="rotate(20 108 10)" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "La Belle au Bois Dormant": `
        <path d="M80 -20 L60 24 L100 24 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M80 -14 C100 10 96 40 84 56" fill="none" stroke="${OUTLINE}" stroke-width="2" opacity="0.6"/>`,
    "Jean Valjean": `
        <path d="M52 22 C52 8 108 8 108 22 C108 28 52 28 52 22 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>`,
    "Cosette": `
        <path d="M54 26 C54 6 106 6 106 26 C106 34 54 34 54 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M54 24 L40 34 M106 24 L120 34" stroke="${OUTLINE}" stroke-width="2.5" stroke-linecap="round"/>`,
    "Javert": `
        <path d="M50 26 C50 -4 110 -4 110 26 C90 16 70 16 50 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <circle cx="80" cy="60" r="7" fill="none" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Quasimodo": `
        <circle cx="112" cy="90" r="22" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M62 24 C58 18 66 12 70 18" fill="none" stroke="${OUTLINE}" stroke-width="2" stroke-linecap="round"/>`,
    "D'Artagnan": `
        <path d="M46 26 C46 4 114 4 114 26 C100 14 60 14 46 26 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M114 14 L134 -2" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>
        <path d="M120 90 L142 140" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "Cyrano de Bergerac": `
        <path d="M118 62 C132 64 132 74 118 76 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M114 6 L146 -6" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "Arsène Lupin": `
        <circle cx="98" cy="72" r="9" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M120 92 C130 100 130 130 122 148" fill="none" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    "Le Capitaine Crochet": `
        <path d="M50 24 C50 2 110 2 110 24 C90 12 70 12 50 24 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M50 22 Q30 30 46 44" fill="none" stroke="${OUTLINE}" stroke-width="2" opacity="0.7"/>
        <path d="M110 22 Q130 30 114 44" fill="none" stroke="${OUTLINE}" stroke-width="2" opacity="0.7"/>
        <path d="M122 96 C136 96 138 108 128 112 L118 104 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Peter Pan": `
        <path d="M58 26 C58 4 102 4 102 26 L80 8 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <circle cx="80" cy="4" r="5" fill="${OUTLINE}"/>`,
    "Zeus": `
        <path d="M54 22 C64 14 96 14 106 22 C96 18 64 18 54 22 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <path d="M128 60 L114 84 L124 84 L110 116 L134 86 L122 86 Z" fill="${OUTLINE}"/>`,
    "Thor": `
        <path d="M52 24 C52 6 108 6 108 24 L96 14 L64 14 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M40 12 L52 24 M120 12 L108 24" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>
        <path d="M118 100 L138 100 L138 116 L128 116 L128 132 L118 116 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Le Père Noël": `
        <path d="M56 24 C56 -6 104 -6 104 24 C90 14 70 14 56 24 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <circle cx="104" cy="20" r="8" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>
        <rect x="64" y="112" width="32" height="12" rx="2" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2"/>`,
    "Baba Yaga": `
        <path d="M50 24 C50 8 68 -4 80 -4 C92 -4 110 8 110 24 L94 16 L66 16 Z" fill="${NEUTRAL}" stroke="${OUTLINE}" stroke-width="2.5"/>
        <path d="M120 96 L146 130" stroke="${OUTLINE}" stroke-width="4" stroke-linecap="round"/>`,
};

/**
 * Affiche une silhouette dans le container donné, avec une couleur de
 * départ, puis retourne une fonction updateColor(hex) pour la faire
 * évoluer en direct (utilisée pendant le choix, et pour révéler la
 * vraie couleur en fin de manche).
 */
function renderCharacterShape(container, shapeKey, initialHex, characterName) {
    const template = SHAPE_TEMPLATES[shapeKey] || SHAPE_TEMPLATES.outfit;
    const accessory = CHARACTER_ACCESSORIES[characterName] || "";
    container.innerHTML = accessory
        ? template.replace("</svg>", accessory + "</svg>")
        : template;
    const colorables = container.querySelectorAll("[data-colorable]");
    const updateColor = (hex) => {
        colorables.forEach((el) => {
            const mode = el.getAttribute("data-colorable");
            el.setAttribute(mode, hex);
        });
    };
    updateColor(initialHex);
    return updateColor;
}
