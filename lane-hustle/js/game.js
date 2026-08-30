/* Lane Hustle — core gameplay engine (canvas).
   States: idle -> running -> (paused | crashed | finished)
   The engine emits Bus events; it never touches screen DOM directly. */

const CAR_COLORS = ['#ff5d73', '#c77bff', '#7bff6b', '#ffb340', '#5d9dff', '#ff7bd5'];

const Game = {
  canvas: null, ctx: null,
  dpr: 1, scale: 1,
  state: 'idle',
  timeScale: 1,

  level: 1, cfg: null, eff: null,
  distM: 0, scroll: 0, runCoins: 0, coinsCollected: 0, spawnedValue: 0,
  combo: 0, comboTimer: 0,
  shields: 0, invincible: 0, nitroLeft: 0, reviveUsed: false,
  time: 0, spawnT: 0,

  player: { lane: 1, x: laneCenterX(1), fromX: laneCenterX(1), targetLane: 1, t: 1 },
  traffic: [],
  coins: [],
  bonusMode: false, bonusTime: 0, _bonusT: 0, _bonusStep: 0,
  decor: [],       // roadside scenery (trees, cacti, buildings...)
  ambient: [],     // weather particles (snow, embers, fireflies)
  decorT: 0,
  theme: null,

  _lastTs: 0,
  _lastShownDist: -1,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(ts => this._loop(ts));
  },

  resize() {
    const wrap = document.getElementById('game-wrap');
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    // adaptive height: tall phones get MORE ROAD instead of black bars.
    // Capped at 420x960 (covers 20:9) so extreme screens don't gain unfair
    // reaction time; the player car stays anchored near the bottom, and all
    // spawn/star math derives from playerY so it adapts automatically.
    CONFIG.H = Math.max(740, Math.min(960, Math.round(availH * CONFIG.W / availW)));
    CONFIG.playerY = CONFIG.H - 140;
    this.scale = Math.min(availW / CONFIG.W, availH / CONFIG.H);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.floor(CONFIG.W * this.scale);
    const cssH = Math.floor(CONFIG.H * this.scale);
    wrap.style.width = cssW + 'px';
    wrap.style.height = cssH + 'px';
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.idleDirty = true;
  },

  start(level) {
    this.bonusMode = false;
    this.level = level;
    this.stage = Save.activeStage;
    this.cfg = levelConfig(level, this.stage);
    this.theme = stageTheme(this.stage);
    this.eff = Save.effects();
    this.state = 'running';
    this.timeScale = 1;
    this.distM = 0; this.scroll = 0;
    this.runCoins = 0; this.coinsCollected = 0; this.spawnedValue = 0;
    this.combo = 0; this.comboTimer = 0;
    this.shields = this.eff.shields;
    this.invincible = 0;
    this.nitroLeft = this.eff.nitroDur;
    this.reviveUsed = false;
    this.hitsTaken = 0;
    this.time = 0;
    // brand-new players get a grace period to read the steering tutorial;
    // a first visit to a new world holds traffic while its splash plays,
    // and steering locks for the ceremony (introT, see steer/pauseToggle)
    const newWorld = this.stage > 1 && !Save.data.seenStages.includes(this.stage);
    this.spawnT = newWorld ? 2.8 : (Save.data.ftue.steered ? 0.4 : 2.2);
    this.introT = newWorld ? 2.4 : 0;
    this._safeLane = 1;
    this._prevBlocked = [];
    this._lastSteerAt = -10;
    this._prevLane = -1;
    this._prevLaneAt = -10;
    this.traffic = [];
    this.coins = [];
    this.decor = [];
    this.ambient = [];
    this.decorT = 0;
    this._lastShownDist = -1;
    this.player = { lane: 1, x: laneCenterX(1), fromX: laneCenterX(1), targetLane: 1, t: 1 };
    Juice.particles = [];
    Juice.floaters = [];
    if (this.nitroLeft > 0) Sfx.nitro();
    Bus.emit('run:start', { level, stage: this.stage, targetM: this.cfg.targetM, shields: this.shields });
    Bus.emit('hud:coins', 0);
  },

  /* BONUS RUN: 20s coin frenzy after milestone levels — no traffic, no
     crashing, dense coin patterns. Banked through the normal pipeline. */
  startBonus() {
    const lvl = this.level;
    this.start(lvl);
    this.bonusMode = true;
    this.bonusTime = 20;
    this._bonusT = 0.3;
    this._bonusStep = 0;
    this.spawnT = 99999;            // no traffic waves
    Sfx.nitro();
    Bus.emit('run:bonus');
  },

  _spawnBonus(dt) {
    this._bonusT -= dt;
    if (this._bonusT > 0) return;
    this._bonusT = 0.26;
    const phase = Math.floor(this._bonusStep / 8) % 3;
    const s = this._bonusStep++;
    if (phase === 0) {                       // coin walls across all lanes
      for (let l = 0; l < CONFIG.laneCount; l++) {
        this.coins.push({ x: laneCenterX(l), y: -150, spin: Math.random() * 6 });
      }
    } else if (phase === 1) {                // zigzag
      const seq = [0, 1, 2, 1];
      this.coins.push({ x: laneCenterX(seq[s % 4]), y: -150, spin: Math.random() * 6 });
      this.coins.push({ x: laneCenterX(seq[(s + 1) % 4]), y: -204, spin: Math.random() * 6 });
    } else {                                 // double columns
      const l = s % 2 === 0 ? 0 : 2;
      this.coins.push({ x: laneCenterX(l), y: -150, spin: Math.random() * 6 });
      this.coins.push({ x: laneCenterX(1), y: -150, spin: Math.random() * 6 });
    }
  },

  _finishBonus() {
    this.state = 'finished';
    Sfx.win();
    Juice.confetti();
    setTimeout(() => Bus.emit('run:finished', { stars: 0, bonus: true }), 1100);
  },

  steer(dir) {
    if (this.state !== 'running') return;
    if (this.introT > 0) return;           // hands off during the world reveal
    const target = Math.max(0, Math.min(CONFIG.laneCount - 1, this.player.targetLane + dir));
    if (target === this.player.targetLane) return;
    // remember the lane being vacated — a near miss is judged on the dodge
    // that actually happened, not on how late it was (HH-82)
    this._prevLane = this.player.targetLane;
    this._prevLaneAt = this.time;
    this.player.fromX = this.player.x;
    this.player.targetLane = target;
    this.player.t = 0;
    this._lastSteerAt = this.time;
    Sfx.whoosh();
    // FTUE: the first ever lane change dismisses the steering tutorial
    if (!Save.data.ftue.steered) {
      Save.data.ftue.steered = true;
      Save.save();
      Bus.emit('ftue:steered');
    }
  },

  update(dt) {
    const p = this.player;
    this.time += dt;
    if (this.introT > 0) this.introT = Math.max(0, this.introT - dt);
    const nitroActive = this.nitroLeft > 0;
    const speed = this.cfg.speed * (nitroActive ? 1.9 : 1);

    this.distM += speed * dt / CONFIG.pxPerMeter;
    this.scroll += speed * dt;
    this.nitroLeft -= dt;
    this.invincible -= dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    // eased lane-change tween (never linear — linear feels robotic)
    if (p.t < 1) {
      p.t = Math.min(1, p.t + dt / this.eff.laneTime);
      p.x = p.fromX + (laneCenterX(p.targetLane) - p.fromX) * Ease.outCubic(p.t);
    }
    if (p.t >= 1) p.lane = p.targetLane;

    // bonus mode: timed coin frenzy instead of traffic/distance
    if (this.bonusMode) {
      this.bonusTime -= dt;
      this._spawnBonus(dt);
      const shown = Math.max(0, Math.ceil(this.bonusTime));
      if (shown !== this._bonusShown) {
        this._bonusShown = shown;
        Bus.emit('hud:time', this.bonusTime, 20);
      }
      if (this.bonusTime <= 0) { this._finishBonus(); return; }
    }

    // spawn traffic waves + coin runs
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this._spawnWave();
      this.spawnT = this.cfg.spawnEvery;
    }

    // roadside scenery scrolls with the road
    this.decorT -= dt;
    if (this.decorT <= 0) {
      this._spawnDecor();
      this.decorT = 0.22 + Math.random() * 0.25;
    }
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      d.y += speed * dt;
      if (d.y > CONFIG.H + 120) this.decor.splice(i, 1);
    }
    this._updateAmbient(dt);

    // traffic drifts down (it drives slower than the road scrolls)
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const c = this.traffic[i];
      c.y += speed * (1 - c.f) * dt;
      if (!c.passed && c.y > CONFIG.playerY + CONFIG.carH * 0.5) {
        c.passed = true;
        // a near miss is a real DODGE: this car was in the lane the player
        // just vacated, they got out in time, and it swept past close by.
        // (The old rule needed the player still mid-tween, so clean early
        // dodges paid nothing and sloppy late ones paid — HH-82.)
        const dx = Math.abs(c.x - p.x);
        const dodgedThisCar = c.lane === this._prevLane
          && this.time - this._prevLaneAt < CONFIG.nearMissWindow
          && p.targetLane !== c.lane;
        if (dodgedThisCar && dx < laneWidth() * 1.35) this._nearMiss(c);
      }
      if (c.y > CONFIG.H + 140) this.traffic.splice(i, 1);
    }

    // coins scroll with the road; magnet pulls the close ones
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.y += speed * dt;
      c.spin += dt * 6;
      const dx = p.x - c.x, dy = CONFIG.playerY - c.y;
      const d = Math.hypot(dx, dy);
      if (this.eff.magnetR > 0 && d < this.eff.magnetR) {
        c.x += dx / d * 420 * dt;
        c.y += dy / d * 420 * dt;
      }
      if (d < 36) {
        this.coins.splice(i, 1);
        this._collect(c);
        continue;
      }
      if (c.y > CONFIG.H + 60) this.coins.splice(i, 1);
    }

    // collisions (skipped while invincible or during the nitro launch)
    if (this.invincible <= 0 && !nitroActive) {
      const hw = CONFIG.carW * CONFIG.hitboxScale / 2;
      const hh = CONFIG.carH * CONFIG.hitboxScale / 2;
      for (const c of this.traffic) {
        if (Math.abs(c.x - p.x) < hw * 2 && Math.abs(c.y - CONFIG.playerY) < hh * 2) {
          this._hit(c);
          break;
        }
      }
    }

    // nitro exhaust (kept light: heavy emission dropped fps on older GPUs)
    if (nitroActive && Math.random() < 0.3) {
      Juice.burst(p.x + (Math.random() - 0.5) * 20, CONFIG.playerY + CONFIG.carH / 2, {
        n: 2, colors: ['#38e1ff', '#7bff6b', '#ffffff'], speed: 90, life: 0.25, size: 4, gravity: 0,
      });
    }

    if (Math.floor(this.distM) !== this._lastShownDist) {
      this._lastShownDist = Math.floor(this.distM);
      Bus.emit('hud:dist', this.distM, this.cfg.targetM);
    }

    if (!this.bonusMode && this.distM >= this.cfg.targetM) this._finish();
  },

  /* Fairness rule: the safe lane of one wave is always within ONE lane change
     of the previous wave's safe lane, so no wave chain is physically
     impossible at any speed. */
  _spawnWave() {
    const lanes = [0, 1, 2];
    let blocked;
    if (Math.random() < this.cfg.doubleBlockChance) {
      const options = lanes.filter(l => Math.abs(l - this._safeLane) <= 1);
      const safe = options[Math.floor(Math.random() * options.length)];
      blocked = lanes.filter(l => l !== safe);
      this._safeLane = safe;
    } else {
      const b = lanes[Math.floor(Math.random() * lanes.length)];
      blocked = [b];
      if (b === this._safeLane) {
        const near = lanes.filter(l => l !== b && Math.abs(l - b) <= 1);
        this._safeLane = near[Math.floor(Math.random() * near.length)];
      }
    }
    for (const lane of blocked) {
      this.traffic.push({
        lane, x: laneCenterX(lane), y: -130 - Math.random() * 50,
        f: this.cfg.trafficFactor + Math.random() * 0.06,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
        passed: false,
      });
    }
    // FAIRNESS: only spawn coins that can still reach the player before the
    // finish line — otherwise they'd inflate the 3-star denominator while
    // being physically uncollectable.
    const reachM = (CONFIG.playerY + 150 + this.cfg.coinRun * 54) / CONFIG.pxPerMeter + 5;
    if (this.distM + reachM < this.cfg.targetM && Math.random() < this.cfg.coinChance) {
      // coins overtake traffic and arrive alongside the PREVIOUS wave's cars,
      // so the coin lane must be free in BOTH waves — else skip this wave
      const prevBlocked = this._prevBlocked || [];
      const free = lanes.filter(l => !blocked.includes(l) && !prevBlocked.includes(l));
      if (free.length) {
        const lane = free[Math.floor(Math.random() * free.length)];
        for (let i = 0; i < this.cfg.coinRun; i++) {
          this.coins.push({ x: laneCenterX(lane), y: -150 - i * 54, spin: Math.random() * 6 });
        }
        this.spawnedValue += this.cfg.coinRun;
      }
    }
    this._prevBlocked = blocked;
  },

  /* Menu attract mode: scroll the road, stream the scenery and let a little
     ambient traffic drift by. Deliberately lighter than gameplay — no coins,
     no spawner, no collisions — so the menu stays cheap to paint. */
  _attract(dt) {
    if (!this.theme) {
      this.theme = stageTheme(Save.data ? Save.activeStage : 1);
      this.cfg = this.cfg || levelConfig(1, 1);
      this.eff = this.eff || Save.effects();
      this.player = this.player || { lane: 1, x: laneCenterX(1), fromX: laneCenterX(1), targetLane: 1, t: 1 };
    }
    const speed = 210;
    this.time += dt;
    this.scroll += speed * dt;

    this.decorT -= dt;
    if (this.decorT <= 0) {
      this._spawnDecor();
      this.decorT = 0.3 + Math.random() * 0.3;
    }
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      d.y += speed * dt;
      if (d.y > CONFIG.H + 120) this.decor.splice(i, 1);
    }
    this._updateAmbient(dt);

    this._attractT = (this._attractT || 0) - dt;
    if (this._attractT <= 0 && this.traffic.length < 3) {
      this._attractT = 0.9 + Math.random() * 1.1;
      const lane = Math.floor(Math.random() * CONFIG.laneCount);
      this.traffic.push({
        lane, x: laneCenterX(lane), y: -CONFIG.carH - 20,
        f: 0.35 + Math.random() * 0.3,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
        passed: true,
      });
    }
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const c = this.traffic[i];
      c.y += speed * (1 - c.f) * dt;
      if (c.y > CONFIG.H + 140) this.traffic.splice(i, 1);
    }
  },

  _spawnDecor() {
    const th = this.theme;
    if (!th) return;
    const left = Math.random() < 0.5;
    const margin = left
      ? 6 + Math.random() * (CONFIG.roadX - 52)
      : CONFIG.roadX + CONFIG.roadW + 10 + Math.random() * (CONFIG.W - CONFIG.roadX - CONFIG.roadW - 48);
    this.decor.push({
      type: th.decor[Math.floor(Math.random() * th.decor.length)],
      x: margin, y: -120,
      s: 0.7 + Math.random() * 0.6,          // size variation
      seed: Math.floor(Math.random() * 1000),
    });
  },

  _updateAmbient(dt) {
    const kind = this.theme && this.theme.ambience;
    if (!kind) { this.ambient.length = 0; return; }
    if (this.ambient.length < 26 && Math.random() < 0.3) {
      this.ambient.push({
        x: Math.random() * CONFIG.W,
        y: kind === 'embers' ? CONFIG.H + 10 : -10,
        v: 30 + Math.random() * 60,
        drift: Math.random() * Math.PI * 2,
        r: kind === 'snow' ? 1.5 + Math.random() * 2.5 : 1 + Math.random() * 1.8,
      });
    }
    for (let i = this.ambient.length - 1; i >= 0; i--) {
      const a = this.ambient[i];
      a.drift += dt * 2;
      if (kind === 'snow') { a.y += a.v * dt; a.x += Math.sin(a.drift) * 18 * dt; }
      else if (kind === 'embers') { a.y -= a.v * dt; a.x += Math.sin(a.drift) * 24 * dt; }
      else { a.x += Math.sin(a.drift) * 12 * dt; a.y += Math.cos(a.drift * 0.7) * 10 * dt; }
      if (a.y > CONFIG.H + 20 || a.y < -20) this.ambient.splice(i, 1);
    }
  },

  /* Layered pickup feedback: sound + sparkle + floater + HUD pop (via event). */
  _collect(c) {
    this.runCoins++;
    this.coinsCollected++;
    this.combo++;
    this.comboTimer = 1.2;
    Sfx.coin(this.combo);
    Juice.burst(c.x, c.y, { n: 5, colors: ['#ffd23f', '#fff3b0'], speed: 130, life: 0.35, size: 4, gravity: 150 });
    Juice.floater(c.x, c.y - 14, '+1');
    Bus.emit('hud:coins', this.runCoins);
    if (!Save.data.ftue.coinHint) {
      Save.data.ftue.coinHint = true;
      Save.save();
      Bus.emit('ftue:hint', 'Coins buy upgrades in the Garage');
    }
  },

  _nearMiss(c) {
    this.runCoins += CONFIG.nearMissBonus;
    Sfx.nearMiss();
    Haptics.nearMiss();
    Save.missionEvent('near', 1);
    Juice.addTrauma(0.1);
    Juice.floater(c.x, CONFIG.playerY - 60, `NEAR MISS +${CONFIG.nearMissBonus}`, '#38e1ff');
    Bus.emit('hud:coins', this.runCoins);
  },

  _hit(c) {
    this.hitsTaken++;                       // shielded or not, it wasn't clean
    if (this.shields > 0) {
      this.shields--;
      this.invincible = CONFIG.shieldInvincible;
      Sfx.shield();
      Juice.addTrauma(0.35);
      Juice.hitStop(0.06, 0.15);
      Juice.burst(this.player.x, CONFIG.playerY, { n: 16, colors: ['#38e1ff', '#bfefff'], speed: 260, life: 0.5, size: 5 });
      Juice.floater(this.player.x, CONFIG.playerY - 70, 'SHIELD!', '#38e1ff', true);
      Bus.emit('hud:shield', this.shields);
      return;
    }
    this._crash();
  },

  /* Big-impact feedback bundle: sound + shake + hit-stop + flash + debris. */
  _crash() {
    this.state = 'crashed';
    Sfx.crash();
    Haptics.crash();
    Juice.addTrauma(0.85);
    Juice.hitStop(0.1, 0.05);
    Juice.flash(0.5);
    Juice.burst(this.player.x, CONFIG.playerY, {
      n: 26, colors: ['#ffb340', '#ff5d73', '#8a8f9c', '#3a3f4c'], speed: 320, life: 0.7, size: 6,
    });
    setTimeout(() => Bus.emit('run:crashed', { canRevive: !this.reviveUsed }), 900);
  },

  revive() {
    // clear the road ahead so the player isn't instantly re-killed
    this.traffic = this.traffic.filter(c => c.y > CONFIG.playerY + 60);
    this.invincible = CONFIG.reviveInvincible;
    this.reviveUsed = true;
    this.state = 'running';
    Sfx.nitro();
    Juice.flash(0.3, '#38e1ff');
  },

  _finish() {
    this.state = 'finished';
    Sfx.win();
    Juice.confetti();
    Juice.addTrauma(0.25);
    const ratio = this.spawnedValue > 0 ? this.coinsCollected / this.spawnedValue : 1;
    const stars = ratio >= 0.85 ? 3 : ratio >= 0.5 ? 2 : 1;
    setTimeout(() => Bus.emit('run:finished', { stars }), 1100);
  },

  _loop(ts) {
    const dtReal = Math.min(1 / 30, (ts - this._lastTs) / 1000 || 0);
    this._lastTs = ts;
    Juice.update(dtReal);                    // juice runs on real time so shake decays during hit-stop
    if (this.state === 'running') this.update(dtReal * this.timeScale);
    // battery/perf saver: repaint only while something actually animates —
    // a static crash/results/menu backdrop must not redraw at 60fps (it
    // janks button taps on older GPUs)
    const animating = this.state === 'running'
      || Juice.particles.length > 0
      || Juice.floaters.length > 0
      || Juice.trauma > 0.01
      || this.idleDirty;
    if (animating) {
      this.draw();
      this.idleDirty = false;
    } else if (this.state !== 'running' && UI.stack[0] === 'menu') {
      // living menu backdrop (HH-81): the road keeps rolling behind the panel.
      // Only on the MENU stack — results/crash/pause keep a static backdrop so
      // the HH-37 tap-jank fix still protects the screens that matter mid-run.
      this._attract(dtReal);
      this.draw();
    }
    requestAnimationFrame(t => this._loop(t));
  },

  // ---------- rendering ----------

  draw() {
    const ctx = this.ctx;
    const k = this.scale * this.dpr;
    const shake = Juice.shakeOffset();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, CONFIG.W, CONFIG.H);
    ctx.save();
    ctx.translate(CONFIG.W / 2 + shake.x, CONFIG.H / 2 + shake.y);
    ctx.rotate(shake.rot);
    ctx.translate(-CONFIG.W / 2, -CONFIG.H / 2);

    this._drawRoad(ctx);
    this._drawDecor(ctx);
    for (const c of this.coins) this._drawCoin(ctx, c);
    for (const c of this.traffic) this._drawCar(ctx, c.x, c.y, c.color, 0);
    this._drawPlayer(ctx);
    Juice.draw(ctx);
    this._drawAmbient(ctx);

    ctx.restore();
  },

  _drawRoad(ctx) {
    const th = this.theme || stageTheme(Save.data ? Save.activeStage : 1);

    // ground with softly scrolling bands so the sides feel like they move too
    ctx.fillStyle = th.side;
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
    const bh = 95;
    const boff = this.scroll % (bh * 2);
    ctx.fillStyle = th.side2;
    for (let y = -bh * 2 + boff; y < CONFIG.H; y += bh * 2) ctx.fillRect(0, y, CONFIG.W, bh);

    ctx.fillStyle = th.road;
    ctx.fillRect(CONFIG.roadX, 0, CONFIG.roadW, CONFIG.H);

    // road edge lines
    ctx.fillStyle = th.edge;
    ctx.fillRect(CONFIG.roadX - 5, 0, 5, CONFIG.H);
    ctx.fillRect(CONFIG.roadX + CONFIG.roadW, 0, 5, CONFIG.H);

    // scrolling dashed lane dividers
    const dash = 34, gap = 30, seg = dash + gap;
    const off = this.scroll % seg;
    ctx.fillStyle = th.dash;
    for (let l = 1; l < CONFIG.laneCount; l++) {
      const x = CONFIG.roadX + laneWidth() * l - 3;
      for (let y = -seg + off; y < CONFIG.H; y += seg) ctx.fillRect(x, y, 6, dash);
    }

    // approaching checkered finish line
    if (this.cfg) {
      const fy = CONFIG.playerY - (this.cfg.targetM - this.distM) * CONFIG.pxPerMeter;
      if (fy > -40 && fy < CONFIG.H + 40) {
        const sq = 18;
        for (let i = 0; i < CONFIG.roadW / sq; i++) {
          for (let j = 0; j < 2; j++) {
            ctx.fillStyle = (i + j) % 2 === 0 ? '#f2f4ff' : '#171a26';
            ctx.fillRect(CONFIG.roadX + i * sq, fy + j * sq, sq, sq);
          }
        }
      }
    }
  },

  /* Roadside props, all drawn from primitives — no image assets. */
  _drawDecor(ctx) {
    for (const d of this.decor) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(d.s, d.s);
      switch (d.type) {
        case 'tree':
          ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-4, 6, 8, 16);
          ctx.fillStyle = '#2e7d3a'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.fill();
          ctx.fillStyle = '#3fa34d'; ctx.beginPath(); ctx.arc(-6, -6, 12, 0, 7); ctx.fill();
          break;
        case 'bush':
          ctx.fillStyle = '#2e7d3a';
          ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.arc(9, 3, 7, 0, 7); ctx.arc(-8, 3, 7, 0, 7); ctx.fill();
          break;
        case 'cactus':
          ctx.fillStyle = '#3d8b4f';
          ctx.fillRect(-5, -18, 10, 36);
          ctx.fillRect(-16, -10, 8, 14); ctx.fillRect(-16, -10, 12, 7);
          ctx.fillRect(8, -2, 8, 12); ctx.fillRect(4, -2, 12, 7);
          break;
        case 'rock':
          ctx.fillStyle = '#a8927a';
          ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0.3, 0, 7); ctx.fill();
          ctx.fillStyle = '#8f7b64';
          ctx.beginPath(); ctx.ellipse(6, 3, 7, 5, 0.3, 0, 7); ctx.fill();
          break;
        case 'building': {
          ctx.fillStyle = '#232a40'; ctx.fillRect(-16, -26, 32, 52);
          ctx.fillStyle = '#ffd23f';
          for (let wy = 0; wy < 5; wy++)
            for (let wx = 0; wx < 3; wx++)
              if ((d.seed >> (wy * 3 + wx)) & 1) ctx.fillRect(-11 + wx * 9, -20 + wy * 9, 5, 5);
          break;
        }
        case 'lamp':
          ctx.fillStyle = '#39415c'; ctx.fillRect(-2, -18, 4, 36);
          ctx.fillStyle = 'rgba(255,220,120,0.9)'; ctx.beginPath(); ctx.arc(0, -20, 5, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,220,120,0.18)'; ctx.beginPath(); ctx.arc(0, -20, 14, 0, 7); ctx.fill();
          break;
        case 'pine':
          ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-3, 12, 6, 10);
          ctx.fillStyle = '#2f6b46';
          ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(14, 2); ctx.lineTo(-14, 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(16, 14); ctx.lineTo(-16, 14); ctx.fill();
          ctx.fillStyle = '#f2f8fc';
          ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(8, -9); ctx.lineTo(-8, -9); ctx.fill();
          break;
        case 'snowrock':
          ctx.fillStyle = '#c9d6e2'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#f2f8fc'; ctx.beginPath(); ctx.ellipse(-2, -3, 9, 4, 0, 0, 7); ctx.fill();
          break;
        case 'deadtree':
          ctx.strokeStyle = '#4a3030'; ctx.lineWidth = 4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, -8);
          ctx.moveTo(0, -2); ctx.lineTo(-10, -14); ctx.moveTo(0, -8); ctx.lineTo(9, -18); ctx.stroke();
          break;
        case 'lavarock':
          ctx.fillStyle = '#241416'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 9, 0.2, 0, 7); ctx.fill();
          ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-2, -3); ctx.lineTo(3, 2); ctx.lineTo(9, -1); ctx.stroke();
          break;
      }
      ctx.restore();
    }
  },

  _drawAmbient(ctx) {
    const kind = this.theme && this.theme.ambience;
    if (!kind) return;
    for (const a of this.ambient) {
      ctx.save();
      if (kind === 'snow') { ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffffff'; }
      else if (kind === 'embers') { ctx.globalAlpha = 0.8; ctx.fillStyle = Math.sin(a.drift * 3) > 0 ? '#ff9f1c' : '#ff5d35'; }
      else { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(a.drift * 3); ctx.fillStyle = '#d8ff6b'; }
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill();
      ctx.restore();
    }
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  _drawCar(ctx, x, y, color, tilt) {
    const w = CONFIG.carW, h = CONFIG.carH;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this._roundRect(ctx, -w / 2 + 3, -h / 2 + 5, w, h, 10);
    ctx.fill();
    ctx.fillStyle = color;
    this._roundRect(ctx, -w / 2, -h / 2, w, h, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(10,14,26,0.55)';                       // windows
    this._roundRect(ctx, -w / 2 + 6, -h / 2 + 12, w - 12, 16, 5);
    ctx.fill();
    this._roundRect(ctx, -w / 2 + 6, h / 2 - 26, w - 12, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#fff8d6';                                   // headlights
    ctx.fillRect(-w / 2 + 5, -h / 2 + 2, 9, 4);
    ctx.fillRect(w / 2 - 14, -h / 2 + 2, 9, 4);
    ctx.restore();
  },

  _drawPlayer(ctx) {
    const p = this.player;
    // blink while invincible so the state is readable
    if (this.invincible > 0 && Math.floor(this.time * 12) % 2 === 0 && this.state === 'running') return;
    const dx = laneCenterX(p.targetLane) - p.x;
    const tilt = Math.max(-0.3, Math.min(0.3, dx / laneWidth() * 0.4));

    if (this.shields > 0) {
      ctx.save();
      ctx.globalAlpha = 0.28 + 0.1 * Math.sin(this.time * 6);
      ctx.fillStyle = '#38e1ff';
      ctx.beginPath();
      ctx.arc(p.x, CONFIG.playerY, 55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this._drawCar(ctx, p.x, CONFIG.playerY, Save.skinColor(), tilt);

    if (this.state === 'crashed') {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.font = '34px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('💥', p.x, CONFIG.playerY + 10);
      ctx.restore();
    }
  },

  _drawCoin(ctx, c) {
    const squish = Math.abs(Math.sin(c.spin));                   // fake 3D spin
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(0.4 + 0.6 * squish, 1);
    ctx.fillStyle = '#b8860b';
    ctx.beginPath(); ctx.arc(0, 2, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.font = '900 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
    ctx.restore();
  },
};
