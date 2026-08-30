/* Procedural background music — a looping A-minor synthwave track generated
   entirely with the Web Audio API (no audio files).
   Two intensities: 'menu' (calm arp + pad) and 'game' (adds bass, kick, hats,
   faster tempo). Uses a lookahead scheduler so timing stays tight even when
   the tab stutters. */

/* One musical identity per stage: chord progression (MIDI roots, one per bar),
   lead waveform, tempo, and a 16-step arpeggio figure. The scheduler reads the
   ACTIVE stage live, so the soundtrack changes the moment the player switches
   worlds. */
const MUSIC_THEMES = [
  { // Sunny Highway — bright and easy (Am F C G)
    chords: [45, 41, 48, 43], lead: 'triangle', bpmGame: 128, bpmMenu: 104, leadVol: 0.07,
    arp: [0, 7, 12, 7, 0, 7, 12, 16, 0, 7, 12, 7, 0, 7, 12, 19] },
  { // Sunset Desert — loping, dusty (Dm Bb F C)
    chords: [50, 46, 41, 48], lead: 'sawtooth', bpmGame: 120, bpmMenu: 98, leadVol: 0.05,
    arp: [0, 12, 7, 10, 0, 12, 7, 10, 0, 12, 7, 10, 0, 10, 7, 3] },
  { // Neon City — punchy synth (Em C G D)
    chords: [52, 48, 43, 50], lead: 'square', bpmGame: 132, bpmMenu: 106, leadVol: 0.055,
    arp: [0, 7, 12, 15, 12, 7, 0, 7, 0, 7, 12, 15, 12, 15, 19, 15] },
  { // Snow Peaks — glassy bells (C Am F G)
    chords: [48, 45, 41, 43], lead: 'sine', bpmGame: 116, bpmMenu: 96, leadVol: 0.09, bell: true,
    arp: [0, 7, 12, 19, 12, 7, 0, 7, 0, 7, 12, 19, 24, 19, 12, 7] },
  { // Lava Ridge — urgent and dark (Am Am F E)
    chords: [45, 45, 41, 44], lead: 'sawtooth', bpmGame: 140, bpmMenu: 104, leadVol: 0.06,
    arp: [0, 12, 0, 12, 7, 19, 7, 19, 0, 12, 0, 12, 10, 22, 10, 19] },
];

const Music = {
  playing: false,
  mode: 'menu',
  _step: 0,
  _nextTime: 0,
  _timer: null,
  _gain: null,

  get enabled() { return Save.data && Save.data.settings.music; },

  _profile() {
    const s = Save.data ? Save.activeStage : 1;
    return MUSIC_THEMES[(s - 1) % MUSIC_THEMES.length];
  },

  _ensure() {
    if (!Sfx.ensure()) return false;
    if (!this._gain) {
      this._gain = Sfx.ctx.createGain();
      this._gain.connect(Sfx.ctx.destination);   // own bus: SFX volume doesn't affect music
    }
    this.applyVolume();
    return true;
  },

  applyVolume() {
    if (this._gain) this._gain.gain.value = 0.35 * (Save.data.settings.musicVol ?? 0.6);
  },

  start() {
    if (this.playing || !this.enabled || !this._ensure()) return;
    this.playing = true;
    this._step = 0;
    this._nextTime = Sfx.ctx.currentTime + 0.05;
    this._timer = setInterval(() => this._tick(), 25);
  },

  stop() {
    clearInterval(this._timer);
    this.playing = false;
  },

  setMode(mode) { this.mode = mode; },

  _tick() {
    const ctx = Sfx.ctx;
    while (this._nextTime < ctx.currentTime + 0.12) {
      this._schedule(this._step, this._nextTime);
      const p = this._profile();
      const bpm = this.mode === 'game' ? p.bpmGame : p.bpmMenu;
      this._nextTime += 60 / bpm / 4;            // 16th-note grid
      this._step = (this._step + 1) % 64;        // 4 bars x 16 steps
    }
  },

  _note(midi) { return 440 * Math.pow(2, (midi - 69) / 12); },

  _osc(type, freq, t, dur, vol, filterFreq) {
    const ctx = Sfx.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = o;
    if (filterFreq) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(this._gain);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  _schedule(step, t) {
    const p = this._profile();
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const root = p.chords[bar];
    const game = this.mode === 'game';

    // lead arpeggio: this stage's figure over the bar's chord
    if (game || s % 2 === 0) {
      const vol = game ? p.leadVol : p.leadVol * 0.7;
      const freq = this._note(root + 24 + p.arp[s]);
      this._osc(p.lead, freq, t, 0.14, vol);
      if (p.bell) this._osc('sine', freq * 2, t, 0.22, vol * 0.4);   // glassy octave shimmer
    }

    // soft detuned pad, one dyad per bar (the "calm" layer)
    if (s === 0) {
      this._osc('sawtooth', this._note(root + 12), t, 1.6, game ? 0.014 : 0.03, 900);
      this._osc('sawtooth', this._note(root + 19) * 1.004, t, 1.6, game ? 0.014 : 0.03, 900);
    }

    if (game) {
      if (s % 2 === 0) this._osc('square', this._note(root), t, 0.16, 0.07, 700);  // driving bass
      if (s % 4 === 0) this._kick(t);                                             // kick on quarters
      if (s % 4 === 2) this._hat(t);                                              // hats on offbeats
    }
  },

  _kick(t) {
    const ctx = Sfx.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this._gain);
    o.start(t);
    o.stop(t + 0.15);
  },

  _hat(t) {
    const ctx = Sfx.ctx;
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(f).connect(g).connect(this._gain);
    src.start(t);
  },
};
