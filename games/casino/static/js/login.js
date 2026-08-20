const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const isLogin = tab.dataset.tab === "login";
        loginForm.hidden = !isLogin;
        registerForm.hidden = isLogin;
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
            window.location.href = "/casino/";
        } catch (e) {
            errorEl.textContent = "Impossible de contacter le serveur.";
        }
    });
}

handleAuth(loginForm, "/casino/api/login", document.getElementById("loginError"));
handleAuth(registerForm, "/casino/api/register", document.getElementById("registerError"));
