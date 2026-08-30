/* Persistent progress in localStorage — v2, stage-aware.
   Coins, upgrade tiers, level progress, and stars are all PER STAGE:
   Stage 2 has its own wallet and its own (pricier) upgrades. A fully completed
   stage becomes AUTOMATED and accrues idle coins in its own currency, which
   can be converted up to the next stage at CONFIG.convertRate. */

const Save = {
  KEY: 'turboRush.v1',
  data: null,

  defaultStage(first) {
    return {
      coins: first ? CONFIG.startCoins : CONFIG.stageWelcome,
      unlocked: 1,
      stars: {},                       // levelN -> 1..3
      tiers: { handling: 0, armor: 0, magnet: 0, earnings: 0, nitro: 0 },
      lastIdle: 0,                     // ms timestamp of last idle collection
    };
  },

  defaults() {
    return {
      version: 2,
      activeStage: 1,
      stagesUnlocked: 1,
      stages: { 1: this.defaultStage(true) },
      settings: { sound: true, sfxVol: 0.7, music: true, musicVol: 0.6, reduceShake: false, vibration: true },
      ftue: { steered: false, coinHint: false, clearHint: false },
      daily: { last: '', streak: 0 },
      skins: { owned: ['cyan'], selected: 'cyan' },
      seenStages: [1],                 // stages whose world-entry splash has played
      missions: null,                  // regenerated lazily per calendar day
      review: { asked: false },        // Play in-app review asked once per install
      ads: { finishes: 0, lastInterstitial: 0 },
    };
  },

  load() {
    let d = this.defaults();
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.stages) {
          d = Object.assign(d, saved);
        } else {
          // migrate a v1 save: old flat progress becomes Stage 1
          d.stages[1] = Object.assign(this.defaultStage(true), {
            coins: saved.coins != null ? saved.coins : CONFIG.startCoins,
            unlocked: saved.unlocked || 1,
            stars: saved.stars || {},
            tiers: Object.assign(this.defaultStage(true).tiers, saved.tiers),
          });
        }
        d.settings = Object.assign(this.defaults().settings, saved.settings);
        d.ads = Object.assign(this.defaults().ads, saved.ads);
        d.ftue = Object.assign(this.defaults().ftue, saved.ftue);
        d.daily = Object.assign(this.defaults().daily, saved.daily);
        d.skins = Object.assign(this.defaults().skins, saved.skins);
        d.review = Object.assign(this.defaults().review, saved.review);
        if (!Array.isArray(d.seenStages) || !d.seenStages.length) d.seenStages = [1];
      }
    } catch (e) { /* corrupted save -> fresh start */ }
    this.data = d;
    this.save();
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) {}
  },

  // ---------- stages ----------

  get activeStage() { return this.data.activeStage; },

  stageData(s = this.data.activeStage) {
    if (!this.data.stages[s]) {
      this.data.stages[s] = this.defaultStage(false);
      this.save();
    }
    return this.data.stages[s];
  },

  setActiveStage(s) {
    if (s < 1 || s > this.data.stagesUnlocked) return false;
    this.data.activeStage = s;
    this.stageData(s);
    this.save();
    return true;
  },

  isStageComplete(s) {
    const st = this.data.stages[s];
    return !!(st && st.stars[CONFIG.levelCount]);
  },

  totalStars(s = this.data.activeStage) {
    const st = this.stageData(s);
    return Object.values(st.stars).reduce((a, b) => a + b, 0);
  },

  clearedLevels(s = this.data.activeStage) {
    return Object.keys(this.stageData(s).stars).length;
  },

  // ---------- coins (active stage unless told otherwise) ----------

  coins(s = this.data.activeStage) { return this.stageData(s).coins; },

  addCoins(n, s = this.data.activeStage) {
    const st = this.stageData(s);
    st.coins = Math.max(0, Math.round(st.coins + n));
    this.save();
    Bus.emit('coins', st.coins, s);
  },

  spend(n) {
    if (this.coins() < n) return false;
    this.addCoins(-n);
    return true;
  },

  // ---------- upgrades (per active stage) ----------

  tier(key) { return this.stageData().tiers[key] || 0; },

  buyUpgrade(key) {
    const t = this.tier(key);
    if (t >= UPGRADES[key].maxTier) return false;
    if (!this.spend(upgradeCost(key, t, this.data.activeStage))) return false;
    this.stageData().tiers[key] = t + 1;
    this.save();
    return true;
  },

  effects() { return upgradeEffects(this.stageData().tiers); },

  // ---------- level progress (per active stage) ----------

  unlockedLevel(s = this.data.activeStage) { return this.stageData(s).unlocked; },

  stars(n, s = this.data.activeStage) { return this.stageData(s).stars[n] || 0; },

  isFirstClear(n) { return !this.stageData().stars[n]; },

  completeLevel(n, stars) {
    const st = this.stageData();
    const wasComplete = this.isStageComplete(this.data.activeStage);
    st.stars[n] = Math.max(st.stars[n] || 0, stars);
    st.unlocked = Math.min(CONFIG.levelCount, Math.max(st.unlocked, n + 1));
    // the next stage opens at level 40; levels 41-50 are optional challenges
    if (n >= CONFIG.stageUnlockLevel) {
      this.data.stagesUnlocked = Math.min(CONFIG.stageCount,
        Math.max(this.data.stagesUnlocked, this.data.activeStage + 1));
    }
    // but AUTOMATION (idle income) still demands all 50 levels
    if (!wasComplete && this.isStageComplete(this.data.activeStage)) {
      st.lastIdle = Date.now();        // automation starts NOW, not from epoch
    }
    this.missionEvent('clear', 1);
    this.missionEvent('stars', stars);
    this.save();
  },

  // ---------- idle income (automated = fully completed stages) ----------

  idleInfo(s) {
    if (!this.isStageComplete(s)) return null;
    const st = this.stageData(s);
    const rate = idleRatePerHour(this.totalStars(s));
    const hours = Math.min(CONFIG.idleCapHours, (Date.now() - st.lastIdle) / 3600000);
    return { rate, accrued: Math.floor(rate * Math.max(0, hours)) };
  },

  collectIdle(s, mult = 1) {
    const info = this.idleInfo(s);
    if (!info || info.accrued <= 0) return 0;
    const amount = info.accrued * mult;
    this.stageData(s).lastIdle = Date.now();
    this.addCoins(amount, s);
    return amount;
  },

  // idle coins waiting across every automated stage (welcome-back popup);
  // a player who hasn't fully completed a stage has no automation -> always 0
  idleTotal() {
    let total = 0;
    for (let s = 1; s <= this.data.stagesUnlocked; s++) {
      const info = this.idleInfo(s);
      if (info) total += info.accrued;
    }
    return total;
  },

  collectAllIdle(mult = 1) {
    let total = 0;
    for (let s = 1; s <= this.data.stagesUnlocked; s++) total += this.collectIdle(s, mult);
    return total;
  },

  // ---------- daily login rewards ----------

  _dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  },

  /* Streak logic on LOCAL calendar days: claimed today -> nothing until
     tomorrow; claimed yesterday -> streak continues; otherwise reset to 1. */
  dailyState() {
    const today = this._dateStr(new Date());
    const dl = this.data.daily;
    if (dl.last === today) return { claimable: false, day: dl.streak || 1 };
    const yesterday = this._dateStr(new Date(Date.now() - 86400000));
    const day = dl.last === yesterday ? (dl.streak % DAILY_REWARDS.length) + 1 : 1;
    return { claimable: true, day, reward: DAILY_REWARDS[day - 1] };
  },

  claimDaily(mult = 1) {
    const st = this.dailyState();
    if (!st.claimable) return 0;
    this.data.daily = { last: this._dateStr(new Date()), streak: st.day };
    const amount = st.reward * mult;
    this.addCoins(amount);
    return amount;
  },

  // ---------- daily missions (HH-40) ----------

  missionsState() {
    const today = this._dateStr(new Date());
    // regenerate only when the stored set is from a PAST day (YYYY-MM-DD
    // compares as a string): the debug day-skip stamps future sets that must
    // survive, and a clock rolled backwards can't wipe+refarm today's claims
    if (!this.data.missions || !this.data.missions.date || this.data.missions.date < today) {
      this.data.missions = { date: today, progress: [0, 0, 0], claimed: [false, false, false] };
      this.save();
    }
    return this.data.missions;
  },

  /* Everyone gets the same three missions on a given date, and a fresh set at
     local midnight. FNV-1a hashing: consecutive dates avalanche into fully
     different bits (the old polynomial hash changed by ~1 per day and froze
     slots for weeks, HH-76). The hash shuffles the mission TYPES and picks
     three different ones, then a variant of each — so the very kinds of
     missions rotate daily, not just their numbers (HH-78). */
  missionDefs() {
    const date = this.missionsState().date;
    let h = 2166136261 >>> 0;
    for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const types = Object.keys(MISSION_POOL);
    for (let i = types.length - 1; i > 0; i--) {      // deterministic shuffle
      h = Math.imul(h ^ i, 16777619) >>> 0;
      const j = h % (i + 1);
      [types[i], types[j]] = [types[j], types[i]];
    }
    return types.slice(0, 3).map((t, i) => {
      const pool = MISSION_POOL[t];
      return pool[(h >>> (i * 8)) % pool.length];
    });
  },

  missionEvent(type, amount = 1) {
    const m = this.missionsState();
    let changed = false;
    this.missionDefs().forEach((d, i) => {
      if (d.type === type && !m.claimed[i] && m.progress[i] < d.target) {
        m.progress[i] = Math.min(d.target, m.progress[i] + amount);
        changed = true;
      }
    });
    if (changed) this.save();
  },

  claimMission(i) {
    const m = this.missionsState();
    const d = this.missionDefs()[i];
    if (!d || m.claimed[i] || m.progress[i] < d.target) return 0;
    m.claimed[i] = true;
    this.addCoins(d.reward);
    return d.reward;
  },

  // ---------- car skins (global, bought with the active stage's coins) ----------

  skinColor() {
    const sk = SKINS.find(s => s.id === this.data.skins.selected);
    return sk ? sk.color : '#38e1ff';
  },

  buySkin(id) {
    const sk = SKINS.find(s => s.id === id);
    if (!sk || this.data.skins.owned.includes(id)) return false;
    if (!this.spend(sk.cost)) return false;
    this.data.skins.owned.push(id);
    this.data.skins.selected = id;
    this.save();
    return true;
  },

  selectSkin(id) {
    if (!this.data.skins.owned.includes(id)) return false;
    this.data.skins.selected = id;
    this.save();
    return true;
  },

  // ---------- currency conversion (stage s -> stage s+1) ----------

  convertPreview(s) {
    if (s >= this.data.stagesUnlocked) return null;   // target stage must exist
    const give = Math.floor(this.coins(s) / CONFIG.convertRate);
    return give > 0 ? { take: give * CONFIG.convertRate, give } : null;
  },

  convertUp(s) {
    const p = this.convertPreview(s);
    if (!p) return null;
    this.addCoins(-p.take, s);
    this.addCoins(p.give, s + 1);
    return p;
  },

  reset() {
    // progress dies; device preferences (audio, shake) survive the reset
    const keepSettings = this.data ? this.data.settings : null;
    try { localStorage.removeItem(this.KEY); } catch (e) {}
    this.load();
    if (keepSettings) {
      this.data.settings = Object.assign(this.defaults().settings, keepSettings);
      this.save();
    }
    Bus.emit('coins', this.coins(), this.data.activeStage);
  },
};
