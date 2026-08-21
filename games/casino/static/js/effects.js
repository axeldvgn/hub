window.CasinoFX = {
    confetti(container, count) {
        const pieces = ['✨', '🎉', '⭐', '💰'];
        count = count || 16;
        for (let i = 0; i < count; i++) {
            const el = document.createElement('span');
            el.className = 'confetti-piece';
            el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 70;
            el.style.setProperty('--tx', (Math.cos(angle) * dist) + 'px');
            el.style.setProperty('--ty', (Math.sin(angle) * dist - 20) + 'px');
            el.style.left = '50%';
            el.style.top = '40%';
            container.appendChild(el);
            setTimeout(() => el.remove(), 950);
        }
    },
};
