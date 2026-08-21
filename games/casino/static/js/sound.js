window.CasinoSound = (function () {
    let ctx = null;
    let master = null;

    function ensureCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = 0.3;
            master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function tone(freq, dur, opts) {
        opts = opts || {};
        const c = ensureCtx();
        const t0 = c.currentTime + (opts.delay || 0);
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
        const peak = opts.gain != null ? opts.gain : 0.35;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.008));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    function noiseBurst(dur, opts) {
        opts = opts || {};
        const c = ensureCtx();
        const t0 = c.currentTime + (opts.delay || 0);
        const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        src.buffer = buffer;
        const filter = c.createBiquadFilter();
        filter.type = opts.filterType || 'bandpass';
        filter.frequency.value = opts.filterFreq || 1200;
        filter.Q.value = opts.q || 0.9;
        const gain = c.createGain();
        const peak = opts.gain != null ? opts.gain : 0.3;
        gain.gain.setValueAtTime(peak, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
        return { stop: (when) => { try { src.stop(when || 0); } catch (e) {} } };
    }

    return {
        unlock() { ensureCtx(); },

        chip(count) {
            count = count || 1;
            for (let i = 0; i < Math.min(count, 4); i++) {
                tone(1800 + Math.random() * 400, 0.07, { type: 'square', gain: 0.14, delay: i * 0.045, attack: 0.002 });
            }
        },
        cardDeal() {
            noiseBurst(0.08, { filterFreq: 2200, gain: 0.18, q: 1.2 });
            tone(900, 0.05, { type: 'triangle', gain: 0.08, delay: 0.01 });
        },
        button() {
            tone(700, 0.045, { type: 'square', gain: 0.08 });
        },
        win(big) {
            const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
            notes.forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.22, delay: i * 0.09, slideTo: f * 1.01 }));
        },
        lose() {
            tone(300, 0.18, { type: 'sawtooth', gain: 0.14, slideTo: 160 });
            tone(220, 0.22, { type: 'sawtooth', gain: 0.1, delay: 0.08, slideTo: 120 });
        },
        spinWheel(durationSec) {
            const c = ensureCtx();
            const t0 = c.currentTime;
            const src = noiseBurst(durationSec, { filterFreq: 500, filterType: 'lowpass', gain: 0.1, q: 0.5 });
            tone(80, 0.5, { type: 'sine', gain: 0.12, delay: durationSec - 0.15, slideTo: 40 });
            return src;
        },
        reelStop(index) {
            tone(220 - index * 20, 0.09, { type: 'square', gain: 0.16, delay: 0 });
            noiseBurst(0.05, { filterFreq: 1500, gain: 0.1 });
        },
        diceRoll() {
            for (let i = 0; i < 6; i++) {
                noiseBurst(0.06, { filterFreq: 800 + Math.random() * 600, gain: 0.12, delay: i * 0.09, q: 1.5 });
            }
        },
        jackpot() {
            [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
                tone(f, 0.3, { type: 'triangle', gain: 0.25, delay: i * 0.07 }));
        },
    };
})();
