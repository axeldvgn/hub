/* Roue de couleur (teinte + saturation), la luminosité (value) est pilotée
   par un slider externe. Composant autonome, sans dépendance. */

function hsvToRgb(h, s, v) {
    // h: 0-360, s: 0-1, v: 0-1
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return [h, s, v];
}

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

class ColorWheel {
    constructor(canvas, cursorEl, previewEl, { onChange } = {}) {
        this.canvas = canvas;
        this.cursorEl = cursorEl;
        this.previewEl = previewEl;
        this.ctx = canvas.getContext("2d");
        this.size = canvas.width;
        this.radius = this.size / 2;
        this.onChange = onChange || (() => {});
        this.h = 0; this.s = 0; this.v = 0.8;

        this._bindEvents();
        this.render();
    }

    _bindEvents() {
        let dragging = false;
        const pointerToHS = (evt) => {
            const rect = this.canvas.getBoundingClientRect();
            const scale = this.size / rect.width;
            const point = evt.touches ? evt.touches[0] : evt;
            const x = (point.clientX - rect.left) * scale - this.radius;
            const y = (point.clientY - rect.top) * scale - this.radius;
            let dist = Math.sqrt(x * x + y * y);
            const s = Math.min(dist / this.radius, 1);
            let h = Math.atan2(y, x) * (180 / Math.PI);
            if (h < 0) h += 360;
            return [h, s];
        };

        const start = (evt) => {
            dragging = true;
            move(evt);
            evt.preventDefault();
        };
        const move = (evt) => {
            if (!dragging) return;
            const [h, s] = pointerToHS(evt);
            this.h = h; this.s = s;
            this.updateCursor();
            this.emit();
            evt.preventDefault();
        };
        const end = () => { dragging = false; };

        this.canvas.addEventListener("mousedown", start);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", end);
        this.canvas.addEventListener("touchstart", start, { passive: false });
        window.addEventListener("touchmove", move, { passive: false });
        window.addEventListener("touchend", end);
    }

    render() {
        const { ctx, size, radius } = this;
        const imgData = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - radius;
                const dy = y - radius;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const idx = (y * size + x) * 4;
                if (dist > radius) {
                    imgData.data[idx + 3] = 0;
                    continue;
                }
                let h = Math.atan2(dy, dx) * (180 / Math.PI);
                if (h < 0) h += 360;
                const s = Math.min(dist / radius, 1);
                const [r, g, b] = hsvToRgb(h, s, this.v);
                imgData.data[idx] = r;
                imgData.data[idx + 1] = g;
                imgData.data[idx + 2] = b;
                imgData.data[idx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        this.updateCursor();
    }

    updateCursor() {
        const angle = this.h * (Math.PI / 180);
        const dist = this.s * this.radius;
        const cx = this.radius + Math.cos(angle) * dist;
        const cy = this.radius + Math.sin(angle) * dist;
        const pct = 100 / this.size;
        this.cursorEl.style.left = (cx * pct) + "%";
        this.cursorEl.style.top = (cy * pct) + "%";
        const [r, g, b] = hsvToRgb(this.h, this.s, this.v);
        this.previewEl.style.background = rgbToHex(r, g, b);
    }

    setValue(v) {
        this.v = v;
        this.render();
    }

    setHSV(h, s, v) {
        this.h = h; this.s = s; this.v = v;
        this.render();
    }

    setHex(hex) {
        const [r, g, b] = hexToRgb(hex);
        const [h, s, v] = rgbToHsv(r, g, b);
        this.setHSV(h, s, v);
    }

    getRgb() {
        return hsvToRgb(this.h, this.s, this.v);
    }

    getHex() {
        const [r, g, b] = this.getRgb();
        return rgbToHex(r, g, b);
    }

    emit() {
        const [r, g, b] = this.getRgb();
        this.onChange({ h: this.h, s: this.s, v: this.v, r, g, b, hex: rgbToHex(r, g, b) });
    }
}
