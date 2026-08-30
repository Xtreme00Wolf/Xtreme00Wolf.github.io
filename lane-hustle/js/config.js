/* Lane Hustle — balance, level curve, and upgrade data.
   All tuning numbers live here so game design changes never touch engine code. */

/* Build flags.
   __DEV is true in a plain browser (no Capacitor shell) and in the test
   harness — there the debug menu works and ads are simulated.
   On phones (Capacitor present) these rule:
     PROD_ADS   true = REAL AdMob units — NEVER watch/click ads in that build.
                TESTING builds: `const PROD_ADS = false;` (Google's safe test units).
                PRODUCTION build only: `const PROD_ADS = __DEV ? false : true;`
     DEBUG_MENU never true on a distributed build — testers must not cheat. */
const __DEV = typeof window !== 'undefined' && (!!window.__DEV__ || !window.Capacitor);
const PROD_ADS = false;
const DEBUG_MENU = __DEV;

const CONFIG = {
  version: '1.1.7',     // keep in sync with android/app/build.gradle versionName
  W: 420,               // logical canvas width (fixed design width)
  H: 740,               // logical height — Game.resize() extends this up to 960
                        // on tall screens so they see more road, never black bars
  laneCount: 3,
  roadX: 48,
  roadW: 324,           // 3 lanes x 108px
  pxPerMeter: 12,
  playerY: 600,
  carW: 46,
  carH: 80,
  hitboxScale: 0.76,    // forgiving collisions feel fair in hyper-casual games
  levelCount: 50,
  baseLaneTime: 0.24,   // seconds per lane change at Handling tier 0
  minLaneTime: 0.10,    // at max Handling tier
  nearMissBonus: 2,
  nearMissWindow: 1.5,  // seconds after leaving a lane that a pass still counts
                        // as the dodge of that car (HH-82)
  reviveInvincible: 2.2,
  shieldInvincible: 1.4,
  startCoins: 150,

  // --- stages (worlds) ---
  stageCount: 5,
  stageUnlockLevel: 40,  // reaching this level opens the next stage; ALL 50
                         // are still needed to automate the stage (idle income)
  stageCostFactor: 2.5, // upgrade prices multiply by this each stage
  stageWelcome: 100,    // starter coins when a new stage opens
  convertRate: 10,      // 10 coins of stage N -> 1 coin of stage N+1
  idleCapHours: 8,      // automated stages accrue at most this many hours
  welcomeMin: 20,       // idle coins waiting before the welcome-back popup fires
  welcomeAwayMin: 10,   // minutes away before a foreground return may show it
};

/* Idle income of an AUTOMATED (fully completed) stage, in that stage's own
   coins per hour. More stars earned in the stage -> faster automation. */
function idleRatePerHour(totalStars) {
  return Math.round(10 + totalStars * 1.5);
}

/* Daily missions (HH-40): one mission of each type per day so the set is
   always achievable, variant picked deterministically from the date.
   Rewards pay in the ACTIVE stage's coins, like the daily login reward. */
const MISSION_POOL = {
  clear: [
    { type: 'clear', target: 3, label: 'Clear 3 levels', reward: 200 },
    { type: 'clear', target: 5, label: 'Clear 5 levels', reward: 350 },
    { type: 'clear', target: 7, label: 'Clear 7 levels', reward: 550 },
  ],
  coins: [
    { type: 'coins', target: 150, label: 'Pick up 150 coins', reward: 200 },
    { type: 'coins', target: 300, label: 'Pick up 300 coins', reward: 400 },
    { type: 'coins', target: 500, label: 'Pick up 500 coins', reward: 650 },
  ],
  near: [
    { type: 'near', target: 5, label: 'Pull off 5 near-misses', reward: 250 },
    { type: 'near', target: 10, label: 'Pull off 10 near-misses', reward: 400 },
    { type: 'near', target: 15, label: 'Pull off 15 near-misses', reward: 600 },
  ],
  stars: [
    { type: 'stars', target: 6, label: 'Earn 6 stars', reward: 250 },
    { type: 'stars', target: 9, label: 'Earn 9 stars', reward: 400 },
    { type: 'stars', target: 12, label: 'Earn 12 stars', reward: 600 },
  ],
  clean: [
    { type: 'clean', target: 1, label: 'Finish a level without a scratch', reward: 300 },
    { type: 'clean', target: 2, label: 'Finish 2 levels without a scratch', reward: 500 },
    { type: 'clean', target: 3, label: 'Finish 3 levels without a scratch', reward: 700 },
  ],
};

/* One visual world per stage: ground/road palette, roadside scenery types,
   and an optional ambient weather effect. Rendering lives in game.js. */
const STAGE_THEMES = [
  { name: 'Sunny Highway', icon: '🌳',
    side: '#4fae5c', side2: '#46a052', road: '#4d525c', edge: '#f2f4ff', dash: '#e9ecf2',
    decor: ['tree', 'bush'], ambience: null },
  { name: 'Sunset Desert', icon: '🌵',
    side: '#dca85f', side2: '#d09a4e', road: '#5f5350', edge: '#ffd9a0', dash: '#f0e0c0',
    decor: ['cactus', 'rock'], ambience: null },
  { name: 'Neon City', icon: '🌃',
    side: '#151a28', side2: '#1a2030', road: '#252b3e', edge: '#38e1ff', dash: '#4a5165',
    decor: ['building', 'lamp'], ambience: 'fireflies' },
  { name: 'Snow Peaks', icon: '❄️',
    side: '#e9f1f7', side2: '#dde8f1', road: '#5e6878', edge: '#ffffff', dash: '#cfd8e0',
    decor: ['pine', 'snowrock'], ambience: 'snow' },
  { name: 'Lava Ridge', icon: '🌋',
    side: '#3c2222', side2: '#331b1b', road: '#3a282c', edge: '#ff6b35', dash: '#7d4c4c',
    decor: ['deadtree', 'lavarock'], ambience: 'embers' },
];

function stageTheme(stage) {
  return STAGE_THEMES[(stage - 1) % STAGE_THEMES.length];
}

/* Paint Shop: car colors. Bought once with the active stage's coins,
   owned forever, selected skin applies everywhere the player car is drawn. */
const SKINS = [
  { id: 'cyan',   name: 'Classic Cyan', color: '#38e1ff', cost: 0 },
  { id: 'red',    name: 'Racing Red',   color: '#ff5d73', cost: 500 },
  { id: 'purple', name: 'Violet Storm', color: '#c77bff', cost: 1000 },
  { id: 'lime',   name: 'Lime Rush',    color: '#7bff6b', cost: 1500 },
  { id: 'gold',   name: 'Solid Gold',   color: '#ffd23f', cost: 2500 },
  { id: 'night',  name: 'Midnight',     color: '#39414f', cost: 4000 },
];

/* Daily login rewards: a 7-day streak. Missing a day resets to day 1; after
   day 7 the cycle repeats. Paid into the ACTIVE stage's wallet. */
const DAILY_REWARDS = [100, 150, 200, 300, 400, 600, 1000];

function laneWidth() { return CONFIG.roadW / CONFIG.laneCount; }

function laneCenterX(lane) {
  return CONFIG.roadX + laneWidth() * lane + laneWidth() / 2;
}

/* Difficulty curve. Levels get faster and denser; double-lane blocks force
   quick reactions at high levels, which is what makes upgrades matter.
   Each stage replays the 50-level curve harder — and since upgrades reset per
   stage, the player rebuilds their car against tougher traffic. */
function levelConfig(n, stage = 1) {
  const t = (n - 1) / (CONFIG.levelCount - 1); // 0..1 across the campaign
  const s = stage - 1;
  return {
    n, stage,
    speed: Math.round((250 + 340 * t) * (1 + 0.12 * s)),
    targetM: 400 + n * 35,
    spawnEvery: Math.max(0.5, (1.35 - 0.016 * n) * Math.pow(0.94, s)),
    doubleBlockChance: Math.min(0.42, 0.05 + 0.011 * n + 0.04 * s),
    trafficFactor: Math.min(0.70, 0.40 + 0.12 * t + 0.03 * s),
    coinChance: 0.85,
    coinRun: 4 + Math.floor(t * 3),
    firstClearBonus: 40 + n * 12,
  };
}

const UPGRADES = {
  handling: {
    name: 'Handling', icon: '🕹️', maxTier: 5, baseCost: 120, costFactor: 1.55,
    blurb: 'Snappier lane changes',
  },
  armor: {
    name: 'Shield', icon: '🛡️', maxTier: 3, baseCost: 500, costFactor: 2.1,
    blurb: 'Survive extra hits each run',
  },
  magnet: {
    name: 'Coin Magnet', icon: '🧲', maxTier: 5, baseCost: 160, costFactor: 1.6,
    blurb: 'Pull nearby coins to you',
  },
  earnings: {
    name: 'Turbo Earnings', icon: '💰', maxTier: 5, baseCost: 220, costFactor: 1.6,
    blurb: 'Multiply every coin you bank',
  },
  nitro: {
    name: 'Nitro Start', icon: '🚀', maxTier: 3, baseCost: 350, costFactor: 1.9,
    blurb: 'Invincible speed boost at launch',
  },
};

function upgradeCost(key, tier, stage = 1) {
  const u = UPGRADES[key];
  const stageMult = Math.pow(CONFIG.stageCostFactor, stage - 1);
  return Math.round(u.baseCost * stageMult * Math.pow(u.costFactor, tier) / 10) * 10;
}

/* Resolve owned tiers into the numbers the engine actually uses. */
function upgradeEffects(tiers) {
  return {
    laneTime: CONFIG.baseLaneTime - (CONFIG.baseLaneTime - CONFIG.minLaneTime) * (tiers.handling / 5),
    shields: tiers.armor,
    magnetR: tiers.magnet ? 70 + tiers.magnet * 34 : 0,
    coinMult: 1 + 0.2 * tiers.earnings,
    nitroDur: tiers.nitro * 1.6,
  };
}
