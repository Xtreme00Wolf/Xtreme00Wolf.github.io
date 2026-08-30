/* Procedural sound effects with the Web Audio API — zero audio assets needed.
   Every game event gets a distinct, short, layered sound. */

const Sfx = {
  ctx: null,
  master: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
    }
    // browsers suspend audio until a user gesture; resume lazily
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  },

  applyVolume() {
    if (this.master) this.master.gain.value = 0.6 * (Save.data.settings.sfxVol ?? 0.7);
  },

  get on() { return Save.data && Save.data.settings.sound; },

  tone({ freq = 440, dur = 0.1, type = 'sine', vol = 0.25, slideTo = null, delay = 0 }) {
    if (!this.on || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  noise({ dur = 0.2, vol = 0.3, filterFreq = 1000, delay = 0 }) {
    if (!this.on || !this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  },

  click()  { this.tone({ freq: 620, dur: 0.05, type: 'square', vol: 0.12 }); },

  /* Coin pitch rises with the pickup combo — classic escalating reward feel. */
  coin(combo = 0) {
    const step = Math.min(combo, 12);
    const f = 660 * Math.pow(2, step / 12);
    this.tone({ freq: f, dur: 0.07, type: 'square', vol: 0.16 });
    this.tone({ freq: f * 1.5, dur: 0.09, type: 'square', vol: 0.12, delay: 0.05 });
  },

  whoosh() { this.noise({ dur: 0.12, vol: 0.10, filterFreq: 2200 }); },

  nearMiss() {
    this.noise({ dur: 0.15, vol: 0.14, filterFreq: 3200 });
    this.tone({ freq: 880, dur: 0.1, type: 'triangle', vol: 0.1, delay: 0.04 });
  },

  crash() {
    this.noise({ dur: 0.4, vol: 0.5, filterFreq: 700 });
    this.tone({ freq: 190, dur: 0.5, type: 'sawtooth', vol: 0.35, slideTo: 38 });
  },

  shield() {
    this.tone({ freq: 900, dur: 0.18, type: 'triangle', vol: 0.3, slideTo: 300 });
    this.noise({ dur: 0.12, vol: 0.15, filterFreq: 1600 });
  },

  buy() {
    this.tone({ freq: 520, dur: 0.08, type: 'square', vol: 0.18 });
    this.tone({ freq: 780, dur: 0.12, type: 'square', vol: 0.18, delay: 0.08 });
  },

  denied() { this.tone({ freq: 140, dur: 0.18, type: 'sawtooth', vol: 0.2 }); },

  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.22, delay: i * 0.09 }));
  },

  lose() {
    [392, 330, 262].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.2, delay: i * 0.14 }));
  },

  nitro() {
    this.noise({ dur: 0.5, vol: 0.2, filterFreq: 500 });
    this.tone({ freq: 120, dur: 0.5, type: 'sawtooth', vol: 0.2, slideTo: 480 });
  },

  adChime() {
    this.tone({ freq: 784, dur: 0.1, type: 'sine', vol: 0.2 });
    this.tone({ freq: 1047, dur: 0.16, type: 'sine', vol: 0.2, delay: 0.1 });
  },
};
