/* Screens + HUD.
   Navigation is a SCREEN STACK (push/pop) rather than boolean flags, and the
   HUD updates only from Bus events — it never polls game state.
   Everything coin/upgrade/level related reads the ACTIVE STAGE via Save. */

const UI = {
  stack: [],
  els: {},
  pendingResult: null,

  init() {
    document.querySelectorAll('[data-screen]').forEach(el => {
      this.els[el.dataset.screen] = el;
    });
    this._buildLevelGrid();
    this._bind();
    this._subscribe();
    this.go('menu');
  },

  // ---------- screen stack ----------

  go(name)  { this.stack = [name]; this._apply(); },
  push(name){ if (this.stack[this.stack.length - 1] !== name) { this.stack.push(name); this._apply(); } },
  pop()     { this.stack.pop(); this._apply(); },

  _apply() {
    const top = this.stack[this.stack.length - 1];
    for (const [name, el] of Object.entries(this.els)) {
      el.classList.toggle('active', name === top);
    }
    document.body.classList.toggle('playing', this.stack.length === 0);
    Game.idleDirty = true;   // canvas repaints once after any screen change
    // music intensity follows where the player is: driving vs. menus
    Music.setMode(this.stack.length === 0 ? 'game' : 'menu');
    if (top === 'menu')   this._renderMenu();
    if (top === 'levels') this._renderLevels();
    if (top === 'garage') this._renderGarage();
    if (top === 'stages') this._renderStages();
    if (top === 'settings') this._renderSettings();
    if (top === 'daily')  this._renderDaily();
    if (top === 'welcome') this._renderWelcome();
    if (top === 'missions') this._renderMissions();
    // gamepad/keyboard rule: something is ALWAYS focused when a screen opens
    if (top) {
      const first = this.els[top].querySelector('[data-focus]');
      if (first) first.focus();
    }
  },

  // ---------- game flow ----------

  startLevel(n) {
    Sfx.click();
    this.stack = [];
    this._apply();
    Game.start(n);
  },

  pauseToggle() {
    if (Game.state === 'running') {
      // pausing mid-ceremony cancels the world splash rather than layering
      // the menu under it — pause must never be blocked (HH-73)
      if (Game.introT > 0) {
        Game.introT = 0;
        this._hideWorldSplash();
      }
      Game.state = 'paused';
      Sfx.click();
      this.push('pause');
    } else if (Game.state === 'paused') {
      this.resume();
    }
  },

  resume() {
    Sfx.click();
    this.pop();
    Game.state = 'running';
  },

  quitToMenu() {
    Sfx.click();
    Game.state = 'idle';
    this.go('menu');
  },

  _showCrash(canRevive) {
    Sfx.lose();
    document.getElementById('crash-revive').style.display = canRevive ? '' : 'none';
    this.stack = ['crash'];
    this._apply();
  },

  _showResults(success, stars, bonus) {
    const g = Game;
    const firstClear = !bonus && success && Save.isFirstClear(g.level);
    const clearBonus = firstClear ? g.cfg.firstClearBonus : 0;
    const total = Math.round(g.runCoins * g.eff.coinMult) + clearBonus;

    // bank immediately; the 2x rewarded ad simply banks the same amount again
    Save.addCoins(total);
    if (success && !bonus) Save.completeLevel(g.level, stars);   // bonus runs don't touch progress
    this.pendingResult = { success, total, doubled: false };
    Save.missionEvent('coins', g.runCoins);                      // coins picked up count, win or lose
    if (success && !bonus && g.hitsTaken === 0) Save.missionEvent('clean', 1);
    if (success) {
      Haptics.win();
      if (!bonus && stars >= 2) Review.maybeAsk();               // happy moment (prod builds only)
    }

    const lastLevel = g.level === CONFIG.levelCount;
    // note: no !bonus here — after a level-50 bonus run the Start Stage
    // shortcut must still be offered (the real clear already unlocked it)
    const stageJustDone = success && lastLevel && g.stage < CONFIG.stageCount;
    if (firstClear && lastLevel) {
      this.toast(g.stage < CONFIG.stageCount
        ? `Stage ${g.stage + 1} unlocked! Stage ${g.stage} now earns coins on its own.`
        : 'Every stage complete — you finished the game!');
    }

    if (success && !bonus && !Save.data.ftue.clearHint) {
      Save.data.ftue.clearHint = true;
      Save.save();
      this.toast('Tip: spend your coins in the Garage before the next level');
    }
    document.getElementById('res-title').textContent = bonus ? 'BONUS COMPLETE!' : (success ? 'LEVEL COMPLETE!' : 'RUN OVER');
    document.getElementById('res-title').className = success ? 'res-title win' : 'res-title fail';
    // stars pop in one by one; the third star slams in bigger (HH-64)
    const starsEl = document.getElementById('res-stars');
    starsEl.innerHTML = '';
    if (success && !bonus) {
      for (let i = 0; i < 3; i++) {
        const sp = document.createElement('span');
        const on = i < stars;
        sp.className = 'st' + (on ? ' on' : '') + (on && i === 2 ? ' slam' : '');
        if (on) sp.style.animationDelay = (0.15 + i * 0.22) + 's';
        sp.textContent = on ? '★' : '☆';
        starsEl.appendChild(sp);
      }
    }
    document.getElementById('res-picked').textContent = g.runCoins;
    document.getElementById('res-mult').textContent = '×' + g.eff.coinMult.toFixed(1);
    document.getElementById('res-bonus-row').style.display = clearBonus ? '' : 'none';
    document.getElementById('res-bonus').textContent = '+' + clearBonus;
    document.getElementById('res-total').textContent = total;
    document.getElementById('res-double').style.display = total > 0 ? '' : 'none';
    document.getElementById('res-double').disabled = false;

    // milestone celebration: every 10th level clear offers a bonus run —
    // and while it's offered, the bonus IS the way forward (Next hides;
    // the bonus results then show Next level / Start Stage)
    const offerBonus = success && !bonus && g.level % 10 === 0;
    document.getElementById('res-bonusrun').style.display = offerBonus ? '' : 'none';

    const nextBtn = document.getElementById('res-next');
    if (offerBonus) {
      nextBtn.style.display = 'none';
    } else if (success && !lastLevel) {
      nextBtn.style.display = '';
      nextBtn.textContent = 'Next level';
      nextBtn.dataset.action = 'next';
    } else if (stageJustDone) {
      nextBtn.style.display = '';
      nextBtn.textContent = `Start Stage ${g.stage + 1}`;
      nextBtn.dataset.action = 'nextstage';
    } else {
      nextBtn.style.display = 'none';
    }
    this.stack = ['results'];
    this._apply();
  },

  /* Runs fn only when the webview is actually visible — a native ad overlay
     (or any other cover) can therefore never have a race running behind it. */
  _whenVisible(fn) {
    if (!document.hidden) return fn();
    const onVis = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onVis);
        fn();
      }
    };
    document.addEventListener('visibilitychange', onVis);
  },

  _leaveResults(action) {
    Sfx.click();
    const milestone = !!(this.pendingResult && this.pendingResult.success && Game.level % 10 === 0);
    AdManager.onLevelEnd(() => this._whenVisible(() => {
      if (action === 'next') this.startLevel(Game.level + 1);
      else if (action === 'nextstage') {
        Save.setActiveStage(Game.stage + 1);
        this.startLevel(Save.unlockedLevel());
      }
      else if (action === 'retry') this.startLevel(Game.level);
      else this.go('menu');
    }), milestone);
  },

  // ---------- renderers ----------

  _stageTag(s = Save.activeStage) { return `S${s}`; },

  _renderMenu() {
    document.getElementById('menu-coins').textContent = Save.coins().toLocaleString();
    document.getElementById('menu-stage').textContent = this._stageTag();
    document.getElementById('btn-play').textContent =
      `PLAY  ·  ${this._stageTag()} LEVEL ${Save.unlockedLevel()}`;
    const th = stageTheme(Save.activeStage);
    document.getElementById('menu-progress').textContent =
      `${th.name} — ${Save.clearedLevels()} / ${CONFIG.levelCount} levels cleared`;

    // phones see touch instructions; only real keyboards see key hints
    const touch = ('ontouchstart' in window) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    document.getElementById('menu-hint').textContent = touch
      ? 'Swipe or tap the sides to steer'
      : '← → or A / D to steer · Esc to pause';

    // pull the player back when automated stages have idle coins waiting —
    // a gold notification dot, not an emoji (HH-72)
    let waiting = 0;
    for (let s = 1; s <= Save.data.stagesUnlocked; s++) {
      const info = Save.idleInfo(s);
      if (info) waiting += info.accrued;
    }
    document.getElementById('btn-stages').classList.toggle('notify', waiting > 0);

    // daily reward entry point (popup also fires on app open)
    document.getElementById('btn-daily').style.display =
      (Save.data.ftue.steered && Save.dailyState().claimable) ? '' : 'none';

    // daily missions entry — badge when a reward is waiting to be claimed
    const mb = document.getElementById('btn-missions');
    mb.style.display = Save.data.ftue.steered ? '' : 'none';
    const ms = Save.missionsState();
    const ready = Save.missionDefs().some((d, i) => !ms.claimed[i] && ms.progress[i] >= d.target);
    mb.textContent = ready ? 'Missions — reward ready!' : 'Daily missions';
    mb.classList.toggle('notify', ready);
  },

  _renderMissions() {
    const wrap = document.getElementById('mission-list');
    wrap.innerHTML = '';
    const m = Save.missionsState();
    Save.missionDefs().forEach((d, i) => {
      const done = m.claimed[i];
      const ready = !done && m.progress[i] >= d.target;
      const card = document.createElement('div');
      card.className = 'mission-card' + (done ? ' done' : '');
      card.innerHTML = `
        <div class="m-top">
          <span class="m-label">${d.label}</span>
          <span class="m-reward">+${d.reward}</span>
        </div>
        <div class="m-bar"><div class="m-fill" style="width:${Math.min(100, m.progress[i] / d.target * 100)}%"></div></div>
        <div class="m-foot">
          <span class="m-count">${Math.min(m.progress[i], d.target)} / ${d.target}</span>
          <button class="btn slim m-claim ${ready ? 'primary' : ''}" ${ready ? '' : 'disabled'}>${done ? 'Claimed' : 'Claim'}</button>
        </div>`;
      if (ready) {
        card.querySelector('.m-claim').addEventListener('click', () => {
          const got = Save.claimMission(i);
          if (got) {
            Sfx.buy();
            Haptics.win();
            this.toast(`Mission complete — +${got} coins!`);
          }
          this._renderMissions();
        });
      }
      wrap.appendChild(card);
    });
  },

  _buildLevelGrid() {
    const grid = document.getElementById('level-grid');
    for (let n = 1; n <= CONFIG.levelCount; n++) {
      const b = document.createElement('button');
      b.className = 'level-btn';
      b.dataset.level = n;
      b.addEventListener('click', () => {
        if (n > Save.unlockedLevel()) { Sfx.denied(); return; }
        this.startLevel(n);
      });
      grid.appendChild(b);
    }
  },

  _renderLevels() {
    const lth = stageTheme(Save.activeStage);
    document.getElementById('levels-title').textContent = lth.name;
    document.getElementById('levels-coins').textContent = Save.coins().toLocaleString();
    document.querySelectorAll('.level-btn').forEach(b => {
      const n = +b.dataset.level;
      const locked = n > Save.unlockedLevel();
      const stars = Save.stars(n);
      b.classList.toggle('locked', locked);
      // the frontier level gets a warm ring — an unplayed board of 50 needs
      // one obvious "you are here"
      b.classList.toggle('next', !locked && n === Save.unlockedLevel());
      b.innerHTML = locked
        ? '🔒'
        : `<span class="ln">${n}</span><span class="ls">`
          + '<i class="on">★</i>'.repeat(stars)
          + '<i>★</i>'.repeat(3 - stars)
          + '</span>';
    });
  },

  _renderGarage() {
    const stage = Save.activeStage;
    document.getElementById('garage-title').textContent = `GARAGE · S${stage}`;
    document.getElementById('garage-coins').textContent = Save.coins().toLocaleString();
    document.getElementById('garage-note').textContent = stage > 1
      ? `Stage ${stage} parts cost ×${Math.round(Math.pow(CONFIG.stageCostFactor, stage - 1))} more — upgrades don't carry over between stages.`
      : 'Upgrades apply to this stage only.';
    const wrap = document.getElementById('upgrade-list');
    wrap.innerHTML = '';
    for (const [key, u] of Object.entries(UPGRADES)) {
      const tier = Save.tier(key);
      const maxed = tier >= u.maxTier;
      const cost = maxed ? 0 : upgradeCost(key, tier, stage);
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="up-icon">${u.icon}</div>
        <div class="up-body">
          <div class="up-name">${u.name}</div>
          <div class="up-blurb">${u.blurb}</div>
          <div class="up-pips">${'<span class="pip on"></span>'.repeat(tier)}${'<span class="pip"></span>'.repeat(u.maxTier - tier)}</div>
        </div>
        <button class="btn buy-btn ${maxed ? 'maxed' : ''}" ${maxed ? 'disabled' : ''}>
          ${maxed ? 'MAX' : `🪙 ${cost.toLocaleString()}`}
        </button>`;
      if (!maxed) {
        card.querySelector('.buy-btn').addEventListener('click', () => {
          if (Save.buyUpgrade(key)) {
            Sfx.buy();
            this._renderGarage();
            this.toast(`${u.name} upgraded!`);
          } else {
            Sfx.denied();
            this.toast('Not enough coins — play, convert, or watch an ad!');
          }
        });
      }
      wrap.appendChild(card);
    }

    // paint shop
    const sl = document.getElementById('skin-list');
    sl.innerHTML = '';
    for (const sk of SKINS) {
      const owned = Save.data.skins.owned.includes(sk.id);
      const sel = Save.data.skins.selected === sk.id;
      const b = document.createElement('button');
      b.className = 'skin-swatch' + (sel ? ' selected' : '');
      b.style.background = sk.color;
      b.title = sk.name;
      b.setAttribute('aria-label', sk.name);
      b.innerHTML = owned ? (sel ? '✓' : '') : `<span class="skin-cost">${sk.cost.toLocaleString()}</span>`;
      b.addEventListener('click', () => {
        if (owned) {
          Save.selectSkin(sk.id);
          Sfx.click();
          this._renderGarage();
        } else if (Save.buySkin(sk.id)) {
          Sfx.buy();
          this._renderGarage();
          this.toast(`${sk.name} — nice ride!`);
        } else {
          Sfx.denied();
          this.toast('Not enough coins for this paint');
        }
      });
      sl.appendChild(b);
    }
  },

  _renderStages() {
    const wrap = document.getElementById('stage-list');
    wrap.innerHTML = '';
    for (let s = 1; s <= CONFIG.stageCount; s++) {
      const unlocked = s <= Save.data.stagesUnlocked;
      const complete = Save.isStageComplete(s);
      const active = s === Save.activeStage;
      const card = document.createElement('div');
      card.className = 'stage-card' + (unlocked ? '' : ' locked');

      const th = stageTheme(s);
      if (!unlocked) {
        card.innerHTML = `
          <div class="stage-head">
            <div class="stage-name">STAGE ${s} · ${th.name}</div>
            <span class="stage-chip locked">LOCKED</span>
          </div>
          <div class="stage-sub">Reach level ${CONFIG.stageUnlockLevel} in Stage ${s - 1} to unlock</div>`;
        wrap.appendChild(card);
        continue;
      }

      const status = complete
        ? '<span class="stage-chip auto">AUTOMATED</span>'
        : (active ? '<span class="stage-chip active">DRIVING</span>' : '<span class="stage-chip">OPEN</span>');
      card.innerHTML = `
        <div class="stage-head">
          <div class="stage-name">STAGE ${s} · ${th.name}</div>
          ${status}
        </div>
        <div class="stage-sub">
          ${Save.clearedLevels(s)} / ${CONFIG.levelCount} levels · ${Save.totalStars(s)}★
          &nbsp;·&nbsp; wallet <b class="gold">🪙 ${Save.coins(s).toLocaleString()} S${s}</b>
        </div>
        <div class="stage-actions"></div>`;
      const actions = card.querySelector('.stage-actions');

      if (!active) {
        const sel = document.createElement('button');
        sel.className = 'btn primary slim';
        sel.textContent = `Drive Stage ${s}`;
        sel.addEventListener('click', () => {
          Sfx.click();
          Save.setActiveStage(s);
          this.go('levels');
        });
        actions.appendChild(sel);
      }

      const idle = Save.idleInfo(s);
      if (idle) {
        const row = document.createElement('div');
        row.className = 'idle-row';
        row.innerHTML = `<span class="idle-info">Earning ${idle.rate} coins/h — <b>${idle.accrued}</b> ready</span>`;
        const collect = document.createElement('button');
        collect.className = 'btn slim';
        collect.textContent = 'Collect';
        collect.disabled = idle.accrued <= 0;
        collect.addEventListener('click', () => {
          const got = Save.collectIdle(s);
          Sfx.buy();
          this.toast(`+${got} S${s} coins collected!`);
          this._renderStages();
        });
        const dbl = document.createElement('button');
        dbl.className = 'btn ad-btn slim';
        dbl.textContent = 'Ad · 2×';
        dbl.disabled = idle.accrued <= 0;
        dbl.addEventListener('click', () => {
          AdManager.showRewarded('idleDouble', () => {
            const got = Save.collectIdle(s, 2);
            this.toast(`+${got} S${s} coins (doubled)!`);
            this._renderStages();
          });
        });
        row.appendChild(collect);
        row.appendChild(dbl);
        actions.appendChild(row);
      }

      const preview = Save.convertPreview(s);
      if (s < Save.data.stagesUnlocked) {
        const conv = document.createElement('button');
        conv.className = 'btn slim convert-btn';
        conv.disabled = !preview;
        conv.textContent = preview
          ? `Convert ${preview.take.toLocaleString()} S${s} → ${preview.give.toLocaleString()} S${s + 1}`
          : `Convert to S${s + 1} (need ${CONFIG.convertRate}+ coins)`;
        if (preview) {
          conv.addEventListener('click', () => {
            const p = Save.convertUp(s);
            if (p) {
              Sfx.buy();
              this.toast(`Converted: ${p.take} S${s} coins → ${p.give} S${s + 1} coins`);
              this._renderStages();
            }
          });
        }
        actions.appendChild(conv);
      }
      wrap.appendChild(card);
    }
    document.getElementById('convert-note').textContent =
      `Exchange rate: ${CONFIG.convertRate} coins → 1 coin of the next stage. Automated stages pay more per hour the more ★ you earned there — earnings pile up for up to ${CONFIG.idleCapHours} hours while you're away.`;
  },

  _renderDaily() {
    const st = Save.dailyState();
    const row = document.getElementById('daily-row');
    row.innerHTML = '';
    for (let i = 1; i <= DAILY_REWARDS.length; i++) {
      const chip = document.createElement('div');
      chip.className = 'daily-chip'
        + (i === st.day ? ' current' : (i < st.day ? ' past' : ''));
      chip.innerHTML = `<div class="dd">DAY ${i}</div><div class="da">${DAILY_REWARDS[i - 1]}</div>`;
      row.appendChild(chip);
    }
    const claim = document.getElementById('btn-daily-claim');
    const dbl = document.getElementById('btn-daily-2x');
    claim.disabled = !st.claimable;
    claim.textContent = st.claimable ? `Claim ${st.reward} coins` : 'Come back tomorrow!';
    dbl.style.display = st.claimable ? '' : 'none';
  },

  /* Arrival popups, in priority order: the welcome-back idle earnings first,
     otherwise the daily reward. The earnings popup fires ONLY when idle income
     actually exists — no automated stage means no automation started, so a
     player who hasn't finished Stage 1 never sees an empty "welcome back".
     awayMs guards foreground returns: quick app switches stay silent. */
  arrive(awayMs = Infinity) {
    if (!Save.data.ftue.steered) return;
    const awayEnough = awayMs >= CONFIG.welcomeAwayMin * 60000;
    if (awayEnough && Save.idleTotal() >= CONFIG.welcomeMin) this.push('welcome');
    else if (Save.dailyState().claimable) this.push('daily');
  },

  _closeWelcome() {
    this.go('menu');
    if (Save.dailyState().claimable) this.push('daily');   // daily chains after
  },

  _renderWelcome() {
    const list = document.getElementById('welcome-list');
    list.innerHTML = '';
    let total = 0;
    for (let s = 1; s <= Save.data.stagesUnlocked; s++) {
      const info = Save.idleInfo(s);
      if (!info || info.accrued <= 0) continue;
      total += info.accrued;
      const th = stageTheme(s);
      const row = document.createElement('div');
      row.className = 'welcome-row';
      row.innerHTML = `<span>${th.name}</span><b class="gold">+${info.accrued.toLocaleString()} S${s}</b>`;
      list.appendChild(row);
    }
    document.getElementById('welcome-total').textContent = total.toLocaleString();
  },

  /* One-time WELCOME TO <world> reveal when a stage is first driven.
     Stage 1 is excluded — the steering tutorial owns that moment. */
  _worldSplash(stage) {
    if (stage === 1 || Save.data.seenStages.includes(stage)) return;
    Save.data.seenStages.push(stage);
    Save.save();
    const th = stageTheme(stage);
    const el = document.getElementById('world-splash');
    el.querySelector('.ws-icon').textContent = th.icon;
    el.querySelector('.ws-name').textContent = th.name.toUpperCase();
    el.style.background = `linear-gradient(165deg, ${th.side}e6, ${th.side2}f2)`;
    // the world's edge color becomes a glow on the name — Neon City reads as
    // an actual neon sign; bright worlds get a soft warm halo
    el.style.setProperty('--ws-glow', th.edge);
    clearTimeout(this._wsTimer);
    el.classList.remove('hidden', 'show');
    void el.offsetWidth;                         // restart the CSS animation
    el.classList.add('show');
    Sfx.win();
    this._wsTimer = setTimeout(() => this._hideWorldSplash(), 2600);
  },

  _hideWorldSplash() {
    clearTimeout(this._wsTimer);
    const el = document.getElementById('world-splash');
    el.classList.add('hidden');
    el.classList.remove('show');
  },

  _renderSettings() {
    document.getElementById('settings-version').textContent = 'Lane Hustle v' + CONFIG.version;
    document.getElementById('set-music').checked = Save.data.settings.music;
    document.getElementById('set-music-vol').value = Math.round((Save.data.settings.musicVol ?? 0.6) * 100);
    document.getElementById('set-sound').checked = Save.data.settings.sound;
    document.getElementById('set-sfx-vol').value = Math.round((Save.data.settings.sfxVol ?? 0.7) * 100);
    document.getElementById('set-shake').checked = Save.data.settings.reduceShake;
    document.getElementById('set-vibe').checked = Save.data.settings.vibration !== false;
    const rb = document.getElementById('btn-reset');
    rb.textContent = 'Reset all progress';
    rb.dataset.armed = '';
  },

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;                          // restart the CSS animation
    t.classList.add('show');
  },

  // ---------- wiring ----------

  _bind() {
    const click = (id, fn) => document.getElementById(id).addEventListener('click', fn);

    click('btn-play', () => this.startLevel(Save.unlockedLevel()));
    click('btn-levels', () => { Sfx.click(); this.go('levels'); });
    click('btn-garage', () => { Sfx.click(); this.go('garage'); });
    click('btn-stages', () => { Sfx.click(); this.go('stages'); });
    click('btn-settings', () => { Sfx.click(); this.go('settings'); });
    document.querySelectorAll('[data-back]').forEach(b =>
      b.addEventListener('click', () => {
        Sfx.click();
        // nested screens (e.g. settings opened over pause) pop back one level
        if (this.stack.length > 1) this.pop(); else this.go('menu');
      }));

    click('btn-pause', () => this.pauseToggle());
    click('btn-resume', () => this.resume());
    click('btn-pause-retry', () => { this.stack = []; this.startLevel(Game.level); });
    click('btn-pause-settings', () => { Sfx.click(); this.push('settings'); });
    click('btn-pause-quit', () => this.quitToMenu());

    click('crash-revive', () => {
      // _whenVisible: the reward event can fire while the native ad still
      // covers the webview — reviving blind risks a stale/black canvas (HH-69)
      AdManager.showRewarded('revive', () => this._whenVisible(() => {
        this.stack = [];
        this._apply();
        Game.revive();
        this.toast('Back in the race!');
      }));
    });
    click('crash-giveup', () => { Sfx.click(); this._showResults(false, 0); });

    click('res-double', () => {
      AdManager.showRewarded('double', () => {
        const p = this.pendingResult;
        if (p && !p.doubled) {
          p.doubled = true;
          Save.addCoins(p.total);
          document.getElementById('res-total').textContent = p.total * 2;
          document.getElementById('res-double').style.display = 'none';
          this.toast(`+${p.total} bonus coins!`);
        }
      });
    });
    click('res-bonusrun', () => {
      Sfx.click();
      this.stack = [];
      this._apply();
      Game.startBonus();
    });
    click('res-next', e => this._leaveResults(e.currentTarget.dataset.action || 'next'));
    click('res-retry', () => this._leaveResults('retry'));
    click('res-menu', () => this._leaveResults('menu'));

    click('btn-free-coins', () => {
      AdManager.showRewarded('freeCoins', () => {
        Save.addCoins(250);
        this._renderGarage();
        this.toast('+250 free coins!');
      });
    });

    document.getElementById('set-music').addEventListener('change', e => {
      Save.data.settings.music = e.target.checked;
      Save.save();
      Sfx.click();
      if (e.target.checked) Music.start(); else Music.stop();
    });
    document.getElementById('set-music-vol').addEventListener('input', e => {
      Save.data.settings.musicVol = e.target.value / 100;
      Save.save();
      Music.applyVolume();
    });
    document.getElementById('set-sound').addEventListener('change', e => {
      Save.data.settings.sound = e.target.checked;
      Save.save();
      Sfx.click();
    });
    document.getElementById('set-sfx-vol').addEventListener('input', e => {
      Save.data.settings.sfxVol = e.target.value / 100;
      Save.save();
      Sfx.applyVolume();
      Sfx.click();                             // instant feedback at the new volume
    });
    document.getElementById('set-shake').addEventListener('change', e => {
      Save.data.settings.reduceShake = e.target.checked;
      Save.save();
      Sfx.click();
    });
    document.getElementById('set-vibe').addEventListener('change', e => {
      Save.data.settings.vibration = e.target.checked;
      Save.save();
      if (e.target.checked) Haptics.buzz(20);      // instant feedback
      Sfx.click();
    });
    // daily missions
    click('btn-missions', () => { Sfx.click(); this.push('missions'); });

    // daily login rewards
    click('btn-daily', () => { Sfx.click(); this.push('daily'); });
    click('btn-daily-later', () => { Sfx.click(); this.go('menu'); });
    click('btn-daily-claim', () => {
      const amt = Save.claimDaily(1);
      if (amt) {
        Sfx.buy();
        this.toast(`+${amt} coins — day ${Save.data.daily.streak} streak!`);
      }
      this.go('menu');
    });
    click('btn-daily-2x', () => {
      AdManager.showRewarded('daily', () => {
        const amt = Save.claimDaily(2);
        if (amt) this.toast(`+${amt} coins (doubled)!`);
        this.go('menu');
      });
    });

    // welcome-back idle earnings
    click('btn-welcome-later', () => { Sfx.click(); this._closeWelcome(); });
    click('btn-welcome-collect', () => {
      const got = Save.collectAllIdle(1);
      if (got) { Sfx.buy(); this.toast(`+${got.toLocaleString()} idle coins collected!`); }
      this._closeWelcome();
    });
    click('btn-welcome-2x', () => {
      AdManager.showRewarded('welcomeDouble', () => {
        const got = Save.collectAllIdle(2);
        if (got) this.toast(`+${got.toLocaleString()} idle coins (doubled)!`);
        this._closeWelcome();
      });
    });

    // exit confirmation (reached via the system back button on the main menu)
    click('btn-exit-no', () => { Sfx.click(); this.go('menu'); });
    click('btn-exit-yes', () => {
      const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (app && app.exitApp) app.exitApp();
      else this.go('menu');                  // browsers have nothing to exit
    });

    // legal pages read in-app (offline-friendly); online copies stay canonical
    const openLegal = kind => {
      Sfx.click();
      const doc = LEGAL_DOCS[kind];
      document.getElementById('legal-title').textContent = doc.title;
      document.getElementById('legal-body').innerHTML = doc.html;
      document.getElementById('legal-body').scrollTop = 0;
      document.getElementById('btn-legal-online').dataset.url = doc.online;
      this.push('legal');
    };
    click('btn-privacy', () => openLegal('privacy'));
    click('btn-terms', () => openLegal('terms'));
    click('btn-legal-online', e => {
      Sfx.click();
      window.open(e.currentTarget.dataset.url || LEGAL_URL, '_blank');
    });

    // hidden debug menu: 7 quick taps on the logo — DISABLED in prod builds
    let logoTaps = 0, logoTimer = null;
    document.getElementById('logo').addEventListener('click', () => {
      if (!DEBUG_MENU) return;
      logoTaps++;
      clearTimeout(logoTimer);
      logoTimer = setTimeout(() => { logoTaps = 0; }, 3000);
      if (logoTaps >= 7) {
        logoTaps = 0;
        Sfx.buy();
        this.go('debug');
      }
    });
    click('dbg-coins', () => {
      Save.addCoins(10000);
      Sfx.buy();
      this.toast(`+10,000 S${Save.activeStage} coins`);
    });
    click('dbg-levels', () => {
      Save.stageData().unlocked = CONFIG.levelCount;
      Save.save();
      Sfx.buy();
      this.toast(`All ${CONFIG.levelCount} levels of stage ${Save.activeStage} unlocked`);
    });
    click('dbg-stages', () => {
      Save.data.stagesUnlocked = CONFIG.stageCount;
      for (let s = 1; s <= CONFIG.stageCount; s++) Save.stageData(s);
      Save.save();
      Sfx.buy();
      this.toast('All stages unlocked');
    });
    click('dbg-complete', () => {
      const st = Save.stageData();
      for (let n = 1; n < CONFIG.levelCount; n++) st.stars[n] = Math.max(st.stars[n] || 0, 3);
      st.unlocked = CONFIG.levelCount;
      Save.completeLevel(CONFIG.levelCount, 3);   // triggers automation + next-stage unlock
      Sfx.buy();
      this.toast(`Stage ${Save.activeStage} fully completed`);
    });
    click('dbg-upgrades', () => {
      const tiers = Save.stageData().tiers;
      for (const key of Object.keys(UPGRADES)) tiers[key] = UPGRADES[key].maxTier;
      Save.save();
      Sfx.buy();
      this.toast(`All upgrades maxed for stage ${Save.activeStage}`);
    });
    click('dbg-idle', () => {
      const st = Save.stageData();
      st.lastIdle = (st.lastIdle || Date.now()) - 2 * 3600000;
      Save.save();
      Sfx.buy();
      this.toast(Save.isStageComplete(Save.activeStage)
        ? '+2h of idle time added — check the Stages screen'
        : 'Time added, but idle income needs the stage completed first');
    });

    click('dbg-day', () => {
      // one press = one day of life: the NEXT day's mission set (fresh
      // variants, zeroed progress) and the daily login claimable again
      const cur = Save.missionsState().date;
      const next = Save._dateStr(new Date(new Date(cur + 'T12:00:00').getTime() + 86400000));
      Save.data.missions = { date: next, progress: [0, 0, 0], claimed: [false, false, false] };
      Save.data.daily.last = Save._dateStr(new Date(Date.now() - 86400000));
      Save.save();
      Sfx.buy();
      this.toast(`Skipped to ${next} — fresh missions, daily reward ready`);
    });

    // destructive action -> two-tap confirm instead of a blocking dialog
    document.getElementById('btn-reset').addEventListener('click', e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = 'Tap again to confirm reset';
        Sfx.denied();
      } else {
        Save.reset();
        this._renderSettings();
        this.toast('Progress reset');
      }
    });
  },

  _subscribe() {
    Bus.on('ftue:steered', () => document.getElementById('ftue').classList.add('hidden'));
    Bus.on('ftue:hint', msg => this.toast(msg));
    Bus.on('run:start', ({ level, stage, targetM, shields }) => {
      document.getElementById('ftue').classList.toggle('hidden', Save.data.ftue.steered);
      if (!Save.data.ftue.steered) this._renderFtue();
      document.getElementById('hud-level').textContent = `S${stage} · LV ${level}`;
      document.getElementById('hud-coins').textContent = '0';
      this._renderShields(shields);
      document.getElementById('hud-bar-fill').style.width = '0%';
      document.getElementById('hud-dist').textContent = `0 / ${targetM}m`;
      this._worldSplash(stage);
    });
    Bus.on('hud:dist', (d, target) => {
      document.getElementById('hud-bar-fill').style.width = Math.min(100, d / target * 100) + '%';
      document.getElementById('hud-dist').textContent = `${Math.floor(d)} / ${target}m`;
    });
    Bus.on('hud:coins', n => {
      const el = document.getElementById('hud-coins');
      el.textContent = n;
      el.parentElement.classList.remove('pop');
      void el.parentElement.offsetWidth;
      el.parentElement.classList.add('pop');   // squash-and-stretch pop on the counter
    });
    Bus.on('hud:shield', n => this._renderShields(n));
    Bus.on('run:crashed', ({ canRevive }) => { document.getElementById('ftue').classList.add('hidden'); this._showCrash(canRevive); });
    Bus.on('run:finished', ({ stars, bonus }) => this._showResults(true, stars, bonus));
    Bus.on('run:bonus', () => {
      document.getElementById('hud-level').textContent = 'BONUS RUN';
      document.getElementById('hud-dist').textContent = '20s';
      document.getElementById('ftue').classList.add('hidden');
    });
    Bus.on('hud:time', (t, total) => {
      document.getElementById('hud-bar-fill').style.width = Math.max(0, t / total * 100) + '%';
      document.getElementById('hud-dist').textContent = Math.max(0, Math.ceil(t)) + 's';
    });
  },

  /* One clear primary instruction per input mode (HH-67): phones get the
     animated swipe demo, keyboards get the keys; tap-the-sides is a footnote. */
  _renderFtue() {
    const touch = ('ontouchstart' in window) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    document.getElementById('ftue-main').innerHTML = touch
      ? 'Swipe left or right<br>to change lanes'
      : 'Steer with the ← → keys';
    document.getElementById('ftue-sub').textContent = touch
      ? 'You can also tap the left / right side of the screen'
      : 'A / D work too';
    document.querySelector('.ftue-demo').style.display = touch ? '' : 'none';
  },

  _renderShields(n) {
    document.getElementById('hud-shields').textContent = n > 0 ? '🛡️'.repeat(n) : '';
  },
};
