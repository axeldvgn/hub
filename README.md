# Le Labo

Le hub qui regroupe tous les petits jeux. Un seul site Flask, un jeu par
blueprint, chacun avec ses propres comptes/base de données, tout accessible
depuis une page d'accueil unique.

Pourquoi une seule appli Flask plutôt qu'un site par jeu : le plan gratuit
PythonAnywhere n'autorise qu'une seule "web app" par compte. En regroupant
tout derrière un seul `app.py` avec des routes préfixées (`/teinte`, `/motus`,
…), tous les jeux tournent sur le même déploiement.

## Structure

```
hub/
  app.py                    ← crée l'appli, enregistre les blueprints, page d'accueil
  templates/home.html       ← page d'accueil (liste des jeux)
  static/css/style.css      ← style du hub (identité de ton portfolio)
  games/
    teinte/
      routes.py             ← blueprint Flask, prefixé /teinte, sa propre DB
      templates/teinte/     ← templates namespacés (évite les collisions)
      static/               ← JS/CSS de Teinte, servis sous /teinte/static/
      teinte.db             ← créée automatiquement au 1er lancement
    motus/
      routes.py             ← blueprint Flask, prefixé /motus, auth par token
      templates/motus/      ← motus.html namespacé
      static/               ← motus.js, compte.js, motus.css, mots.txt
      motus.db              ← reprend tes comptes/parties existants
```

## Lancer en local

```bash
pip install -r requirements.txt
python app.py
```

Ouvre http://127.0.0.1:5060 — la page d'accueil liste les jeux disponibles.
Teinte est jouable directement sous `/teinte/`.

## Déployer sur PythonAnywhere

Même principe que pour Teinte seul :

1. Upload du dossier `hub/` dans `/home/tonpseudo/hub/`.
2. Onglet **Web** → Flask → fichier WSGI pointant vers `hub/app.py` :
   ```python
   import sys
   path = '/home/tonpseudo/hub'
   if path not in sys.path:
       sys.path.append(path)
   from app import app as application
   ```
3. `pip install -r requirements.txt` dans une console Bash.
4. Change `app.secret_key` (ou la variable d'environnement
   `HUB_SECRET_KEY`) avant la mise en ligne.
5. Reload de l'appli web.

## Ajouter un nouveau jeu

1. Crée `games/<nom_du_jeu>/` sur le modèle de `games/teinte/` :
   - `routes.py` définit un `Blueprint("<nom>", __name__, url_prefix="/<nom>", template_folder="templates", static_folder="static", static_url_path="/static")`
   - templates sous `templates/<nom>/...` (référencés par `render_template("<nom>/xxx.html")`)
   - toute la logique du jeu (routes, base de données) dans ce blueprint
   - une **clé de session namespacée**, par ex. `session["<nom>_user_id"]`,
     pour ne pas entrer en collision avec les comptes d'un autre jeu
   - sa propre base SQLite, dans le dossier du blueprint
2. Dans `app.py` à la racine :
   ```python
   from games.<nom> import <nom>_bp
   app.register_blueprint(<nom>_bp)
   ```
3. Ajoute une entrée dans la liste `GAMES` (nom, description, url, status).

Teinte suit exactement ce patron — c'est le meilleur exemple à copier.

## Motus

Motus est intégré comme blueprint sous `/motus/`. Différence à noter :
Motus utilise une authentification par token (`Authorization: Bearer ...`)
plutôt que des sessions Flask comme Teinte — les deux mécanismes cohabitent
sans risque de collision puisqu'ils ne touchent pas les mêmes emplacements
(cookie de session vs en-tête HTTP). `games/motus/motus.db` reprend tel quel
les comptes et parties déjà enregistrés sur ton déploiement PythonAnywhere
actuel.
