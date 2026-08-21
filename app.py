import os
from flask import Flask, render_template

from auth import hub_auth_bp, current_hub_user, login_required
from games.teinte import teinte_bp
from games.motus import motus_bp
from games.casino import casino_bp

app = Flask(__name__)
app.secret_key = os.environ.get("HUB_SECRET_KEY", "change-moi-en-prod")

app.register_blueprint(hub_auth_bp)
app.register_blueprint(teinte_bp)
app.register_blueprint(motus_bp)
app.register_blueprint(casino_bp)


@app.context_processor
def inject_hub_user():
    return {"hub_user": current_hub_user()}

# Pour ajouter un nouveau petit jeu :
# 1. crée games/<nom>/ sur le même modèle que games/teinte/
#    (un blueprint avec son propre url_prefix, ses templates sous
#    templates/<nom>/, son static namespacé, sa propre base SQLite)
# 2. importe son blueprint ci-dessus et enregistre-le avec app.register_blueprint(...)
# 3. ajoute une entrée dans la liste GAMES ci-dessous

GAMES = [
    {
        "name": "Teinte",
        "tagline": "Devine la couleur exacte",
        "description": "Devine la couleur d'un élément d'un personnage du domaine public "
                        "(la cape de Dracula, le chapeau du Chapelier Fou…), entre potes, "
                        "en 10 manches chronométrées par manche.",
        "url": "/teinte/",
        "status": "available",
        "tags": ["Multijoueur", "10 manches"],
    },
    {
        "name": "Motus",
        "tagline": "Le mot mystère du jour",
        "description": "Le jeu de mots français façon Wordle, avec comptes, "
                        "classement et parties entre amis.",
        "url": "/motus/",
        "status": "available",
        "tags": ["Multijoueur", "Classement"],
    },
    {
        "name": "Casino",
        "tagline": "Poker, roulette, blackjack, dés, machines à sous",
        "description": "Le casino multijoueur : jusqu'à 5 joueurs par table, comptes et jetons "
                        "persistants. Vrai Texas Hold'em avec mises, tapis et pots partagés.",
        "url": "/casino/",
        "status": "available",
        "tags": ["Multijoueur", "5 joueurs max"],
    },
]


@app.route("/")
@login_required
def home():
    return render_template("home.html", games=GAMES)


if __name__ == "__main__":
    app.run(debug=True, port=5060)
