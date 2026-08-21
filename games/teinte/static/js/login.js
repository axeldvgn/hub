const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const guestForm = document.getElementById("guestForm");
const forms = { login: loginForm, register: registerForm, guest: guestForm };

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const active = tab.dataset.tab;
        Object.entries(forms).forEach(([name, form]) => {
            form.hidden = name !== active;
        });
    });
});

async function handleAuth(form, endpoint, errorEl) {
    form.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        errorEl.textContent = "";
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!res.ok) {
                errorEl.textContent = json.error || "Une erreur est survenue.";
                return;
            }
            window.location.href = "/teinte/";
        } catch (e) {
            errorEl.textContent = "Impossible de contacter le serveur.";
        }
    });
}

handleAuth(loginForm, "/teinte/api/login", document.getElementById("loginError"));
handleAuth(registerForm, "/teinte/api/register", document.getElementById("registerError"));
handleAuth(guestForm, "/teinte/api/guest", document.getElementById("guestError"));
