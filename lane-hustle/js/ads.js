/* Ad layer.
   Every ad request in the game routes through AdManager, and AdManager talks to
   a swappable PROVIDER. During development the provider is SimAdProvider, which
   plays a fake full-screen ad with a countdown. To go live, implement the same
   two methods with the real AdMob SDK (via the @capacitor-community/admob
   plugin once the game is wrapped as an Android app) and switch one line:
       AdManager.provider = AdMobProvider;
   See PROCESS.md, step 5, for the exact AdMob setup.

   Placements used by the game:
     rewarded  "revive"      — crash screen, continue the run (once per run)
     rewarded  "double"      — results screen, 2x the coins earned
     rewarded  "freeCoins"   — garage, +250 free coins
     interstitial            — after every 3rd level end, min 60s apart,
                               and never right after a rewarded ad. */

const SimAdProvider = {
  _overlay: null,
  _timer: null,

  showRewarded(onClosed)     { this._show('rewarded', 5, onClosed); },
  showInterstitial(onClosed) { this._show('interstitial', 3, onClosed); },

  _show(kind, seconds, onClosed) {
    const ov = this._overlay || (this._overlay = document.getElementById('ad-overlay'));
    ov.classList.add('open');
    const label = ov.querySelector('.ad-kind');
    const count = ov.querySelector('.ad-count');
    const closeBtn = ov.querySelector('.ad-close');
    const bar = ov.querySelector('.ad-bar-fill');
    label.textContent = kind === 'rewarded' ? 'REWARDED TEST AD' : 'TEST AD';
    closeBtn.disabled = true;
    closeBtn.classList.remove('ready');

    let left = seconds;
    const total = seconds;
    const tick = () => {
      count.textContent = left > 0
        ? (kind === 'rewarded' ? `Reward in ${left}…` : `Ad · ${left}s`)
        : (kind === 'rewarded' ? 'Reward earned! ✔' : 'Thanks for watching');
      bar.style.width = `${(1 - left / total) * 100}%`;
      if (left <= 0) {
        closeBtn.disabled = false;
        closeBtn.classList.add('ready');
        closeBtn.focus();
        return;
      }
      left--;
      this._timer = setTimeout(tick, 1000);
    };
    tick();

    closeBtn.onclick = () => {
      clearTimeout(this._timer);
      ov.classList.remove('open');
      Sfx.click();
      // Simulated ads always complete; a real provider reports completion itself.
      onClosed(true);
    };
  },
};

/* Real AdMob via the @capacitor-community/admob plugin. Only active when the
   game runs inside the Capacitor Android shell — in a normal browser (and in
   npm test) the simulated provider stays in charge.

   ⚠ These are GOOGLE'S OFFICIAL TEST IDS. Keep them during ALL development —
   never load or click your own real ads. Before the Play Store release build,
   replace them with your real unit IDs from apps.admob.com, and replace the
   APPLICATION_ID in android/app/src/main/AndroidManifest.xml. */
/* Real ad units for Lane Hustle (AdMob app ca-app-pub-1645962263996146~9644287776).
   USE_PROD_ADS stays false during ALL testing — flip to true only for the final
   Play Store release build. Clicking/watching your own PROD ads gets the AdMob
   account banned; the TEST units below are Google's official safe ones. */
const ADMOB_PROD_IDS = {
  rewarded: 'ca-app-pub-1645962263996146/1542436478',
  interstitial: 'ca-app-pub-1645962263996146/3366704365',
};
const ADMOB_TEST_IDS = {
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
};
const USE_PROD_ADS = PROD_ADS;

const AdMobProvider = {
  ids: USE_PROD_ADS ? ADMOB_PROD_IDS : ADMOB_TEST_IDS,
  _plugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
  },
  async init() {
    const AdMob = this._plugin();
    if (!AdMob) return;
    // EU/UK consent (Google UMP). The form only appears once the GDPR message
    // is configured in AdMob -> Privacy & messaging; everywhere else this
    // resolves as not-required. Failures never block the game.
    try {
      const info = await AdMob.requestConsentInfo();
      if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') {
        await AdMob.showConsentForm();
      }
    } catch (e) { console.warn('[ads] consent flow skipped', e); }
    try { await AdMob.initialize({}); }
    catch (e) { console.warn('[ads] AdMob init failed', e); }
  },
  /* Load watchdog: if an ad never reaches the screen (app minimized during
     load, dead network), bail out so the loading overlay can never hang —
     15s absolute, or 4s after returning from background. Never fires once
     the ad is actually showing. */
  _armLoadWatchdog(isShown, isDone, bail) {
    const start = Date.now();
    let returned = false;
    const onVis = () => { if (!document.hidden) returned = true; };
    const cleanup = () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => {
      if (isShown() || isDone()) { cleanup(); return; }
      const elapsed = Date.now() - start;
      if (elapsed > 15000 || (returned && elapsed > 4000)) { cleanup(); bail(); }
    }, 1000);
  },

  async showRewarded(onClosed) {
    const AdMob = this._plugin();
    if (!AdMob) return SimAdProvider.showRewarded(onClosed);
    let rewarded = false, shown = false, done = false, subs = [];
    const finish = ok => {
      if (done) return;
      done = true;
      subs.forEach(s => { try { s.remove(); } catch (e) {} });
      subs = [];
      onClosed(ok);
    };
    this._armLoadWatchdog(() => shown, () => done, () => finish(false));
    try {
      subs.push(await AdMob.addListener('onRewardedVideoAdShowed', () => { shown = true; }));
      subs.push(await AdMob.addListener('onRewardedVideoAdFailedToShow', () => finish(false)));
      subs.push(await AdMob.addListener('onRewardedVideoAdReward', () => { rewarded = true; }));
      subs.push(await AdMob.addListener('onRewardedVideoAdDismissed', () => finish(rewarded)));
      await AdMob.prepareRewardVideoAd({ adId: this.ids.rewarded });
      const reward = await AdMob.showRewardVideoAd();
      if (reward) { shown = true; rewarded = true; }   // some versions resolve with the reward item
    } catch (e) {
      console.warn('[ads] rewarded ad failed', e);
      finish(false);
    }
  },
  async showInterstitial(onClosed) {
    const AdMob = this._plugin();
    if (!AdMob) return SimAdProvider.showInterstitial(onClosed);
    let done = false, shown = false;
    let subs = [];
    const finish = () => {
      if (done) return;
      done = true;
      subs.forEach(s => { try { s.remove(); } catch (e) {} });
      subs = [];
      onClosed(true);
    };
    this._armLoadWatchdog(() => shown, () => done, finish);
    try {
      subs.push(await AdMob.addListener('interstitialAdShowed', () => { shown = true; }));
      subs.push(await AdMob.addListener('interstitialAdDismissed', finish));
      subs.push(await AdMob.addListener('interstitialAdFailedToShow', finish));
      await AdMob.prepareInterstitial({ adId: this.ids.interstitial });
      await AdMob.showInterstitial();
      // fallback in case the dismiss event never arrives: once the webview
      // has actually gone hidden (ad on screen) and comes back visible,
      // treat the ad as closed
      let sawHidden = document.hidden;
      const onVis = () => {
        if (document.hidden) { sawHidden = true; return; }
        if (sawHidden) {
          document.removeEventListener('visibilitychange', onVis);
          setTimeout(finish, 300);
        }
      };
      document.addEventListener('visibilitychange', onVis);
      setTimeout(() => document.removeEventListener('visibilitychange', onVis), 120000);
    } catch (e) {
      // a missed interstitial should never block the game flow
      console.warn('[ads] interstitial failed', e);
      finish();
    }
  },
};

const AdManager = {
  provider: SimAdProvider,
  INTERSTITIAL_EVERY: 3,
  INTERSTITIAL_MIN_GAP_MS: 60000,
  _rewardedJustShown: false,

  _busy: false,

  /* Full-screen input blocker while an ad loads from the network — without it
     the player can navigate away (even start a race) before the ad appears. */
  _loading(show) {
    const el = document.getElementById('ad-loading');
    if (el) el.classList.toggle('open', !!show);
  },

  showRewarded(placement, onReward) {
    if (this._busy) return;                 // double-tap guard: one ad at a time
    this._busy = true;
    this._loading(true);
    Sfx.adChime();
    this._rewardedJustShown = true;
    this.provider.showRewarded(completed => {
      this._busy = false;
      this._loading(false);
      Game.idleDirty = true;   // native ad may have trashed the canvas surface (HH-69)
      if (completed) onReward();
      else if (typeof UI !== 'undefined') UI.toast('Ad not ready — check internet and try again');
    });
  },

  /* Interstitial pacing: capped by count AND time, and skipped entirely if the
     player just voluntarily watched a rewarded ad (don't punish generosity). */
  onLevelEnd(done, milestone = false) {
    const a = Save.data.ads;
    a.finishes++;
    Save.save();
    // milestone levels (every 10th — the bonus-run farm spots) are always
    // eligible; the 60s cooldown and rewarded-suppression still protect UX
    const countDue = a.finishes % this.INTERSTITIAL_EVERY === 0 || milestone;
    const timeDue = Date.now() - a.lastInterstitial > this.INTERSTITIAL_MIN_GAP_MS;
    if (countDue && timeDue && !this._rewardedJustShown) {
      a.lastInterstitial = Date.now();
      Save.save();
      this._loading(true);
      this.provider.showInterstitial(() => {
        this._loading(false);
        Game.idleDirty = true; // force a repaint after the ad covers us (HH-69)
        done();
      });
    } else {
      done();
    }
    this._rewardedJustShown = false;
  },
};

// On a real device (Capacitor shell) switch to live AdMob automatically.
if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
  AdManager.provider = AdMobProvider;
  AdMobProvider.init();
}
