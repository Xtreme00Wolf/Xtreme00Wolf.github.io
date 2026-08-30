/* Game feel ("juice") systems: trauma-based screen shake, hit-stop, particles,
   floating text, screen flash, and easing curves.
   Shake moves only the CAMERA (a draw transform), never the simulated car, and
   hit-stop restores via a real-time timer so the game can never stay frozen. */

const Ease = {
  outQuad:  t => 1 - (1 - t) * (1 - t),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  // overshoots past the target then settles — the classic "pop"
  outBack:  t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

const Juice = {
  trauma: 0,
  _t: 0,
  particles: [],
  floaters: [],
  _flashEl: null,
  _hitStopTimer: null,

  /* Hits ADD trauma (0..1); shake strength is trauma² so small bumps barely
     move the camera and big crashes punch. */
  addTrauma(a) {
    if (Save.data.settings.reduceShake) a *= 0.3;
    this.trauma = Math.min(1, this.trauma + a);
  },

  update(dtReal) {
    this.trauma = Math.max(0, this.trauma - 1.5 * dtReal);
    this._t += dtReal * 30;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtReal;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dtReal;
      p.y += p.vy * dtReal;
      p.vy += p.gravity * dtReal;
      p.rot += p.vrot * dtReal;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dtReal;
      if (f.life <= 0) { this.floaters.splice(i, 1); continue; }
      f.y -= 55 * dtReal;
    }
  },

  /* Smooth sampled-sine shake, not per-frame random (random buzzes like static). */
  shakeOffset() {
    const s = this.trauma * this.trauma;
    return {
      x: 11 * s * Math.sin(this._t * 1.7),
      y: 8 * s * Math.sin(this._t * 2.3),
      rot: 0.045 * s * Math.sin(this._t * 1.1),
    };
  },

  /* Briefly crush the game's time scale, restore on a REAL-time timer. */
  hitStop(duration = 0.08, scale = 0.05) {
    Game.timeScale = scale;
    clearTimeout(this._hitStopTimer);
    this._hitStopTimer = setTimeout(() => { Game.timeScale = 1; }, duration * 1000);
  },

  burst(x, y, { n = 10, colors = ['#ffd23f'], speed = 220, life = 0.5, size = 5, gravity = 300 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: life * (0.6 + Math.random() * 0.4), maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 10,
        gravity,
      });
    }
  },

  confetti() {
    this.burst(CONFIG.W / 2, CONFIG.H * 0.35, {
      n: 60, colors: ['#ffd23f', '#ff5d73', '#38e1ff', '#7bff6b', '#c77bff'],
      speed: 340, life: 1.4, size: 6, gravity: 420,
    });
  },

  floater(x, y, text, color = '#ffd23f', big = false) {
    this.floaters.push({ x, y, text, color, big, life: 0.9, maxLife: 0.9 });
  },

  draw(ctx) {
    // particles draw without per-particle save/rotate/restore — canvas state
    // changes are what kill frame rate on older GPUs; at 4-6px the lost
    // rotation is invisible
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const f of this.floaters) {
      const t = 1 - f.life / f.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = `800 ${f.big ? 26 : 18}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,12,24,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  },

  flash(alpha = 0.45, color = '#ffffff') {
    if (!this._flashEl) this._flashEl = document.getElementById('flash');
    const el = this._flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = alpha;
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.35s ease-out';
      el.style.opacity = 0;
    });
    // rAF is frozen while the webview is hidden (e.g. behind a native ad) —
    // a real-time failsafe guarantees the flash can never stay covering the
    // game no matter what happens to the frame loop (HH-69)
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      el.style.transition = 'opacity 0.35s ease-out';
      el.style.opacity = 0;
    }, 600);
  },
};

/* Vibration feedback (HH-63). navigator.vibrate needs no plugin — just the
   VIBRATE permission in the Android manifest. Silently no-ops on desktop and
   anywhere unsupported; the Settings "Vibration" toggle gates every buzz. */
const Haptics = {
  buzz(pattern) {
    if (Save.data && Save.data.settings.vibration === false) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  },
  crash()    { this.buzz(70); },
  nearMiss() { this.buzz(12); },
  win()      { this.buzz([15, 40, 30]); },
};
