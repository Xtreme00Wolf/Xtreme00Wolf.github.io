/* Boot + input. Keyboard (arrows / A-D), tap left/right half, and swipe. */

window.addEventListener('DOMContentLoaded', () => {
  Save.load();
  Game.init(document.getElementById('game-canvas'));
  UI.init();

  // arrival popups on app open (skipped for brand-new players mid-FTUE):
  // welcome-back idle earnings if any are waiting, else the daily reward
  UI.arrive();

  // PLS Studios card covers the first paint, then leaves the DOM for good
  const brand = document.getElementById('brand-splash');
  setTimeout(() => brand.classList.add('gone'), 1500);
  setTimeout(() => { if (brand.parentNode) brand.remove(); }, 2200);

  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': Game.steer(-1); break;
      case 'ArrowRight': case 'd': case 'D': Game.steer(1); break;
      case 'Escape': case 'p': case 'P':
        if (Game.state === 'running' || Game.state === 'paused') {
          e.preventDefault();
          UI.pauseToggle();
        }
        break;
    }
  });

  // touch: tap left/right half of the screen, or swipe
  const wrap = document.getElementById('game-wrap');
  let touchX = null, lastMoveX = null;
  wrap.addEventListener('pointerdown', e => {
    if (Game.state !== 'running') return;
    // taps on HUD controls (pause button etc.) are UI, never steering (HH-68)
    if (e.target.closest && e.target.closest('#hud')) return;
    touchX = e.clientX;
    lastMoveX = e.clientX;
  });
  wrap.addEventListener('pointermove', e => {
    if (touchX !== null) lastMoveX = e.clientX;
  });
  wrap.addEventListener('pointerup', e => {
    if (Game.state !== 'running' || touchX === null) return;
    const dx = e.clientX - touchX;
    if (Math.abs(dx) > 24) Game.steer(dx > 0 ? 1 : -1);          // swipe
    else Game.steer(e.clientX < window.innerWidth / 2 ? -1 : 1); // tap a side
    touchX = null;
  });
  // Android's edge back-gesture zone CANCELS touches — still honor the swipe
  // using the last position the finger reached before the system stole it
  wrap.addEventListener('pointercancel', () => {
    if (touchX !== null && lastMoveX !== null && Game.state === 'running') {
      const dx = lastMoveX - touchX;
      if (Math.abs(dx) > 24) Game.steer(dx > 0 ? 1 : -1);
    }
    touchX = null;
  });

  // first user gesture unlocks the audio context on mobile browsers,
  // and that's the earliest moment the background music may begin
  const unlockAudio = () => { if (Sfx.ensure()) Music.start(); };
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  // input-modality tracking: focus rings only for keyboard players
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter') {
      document.body.classList.add('kb-nav');
    }
  });
  document.addEventListener('pointerdown', () => document.body.classList.remove('kb-nav'));

  // Android lifecycle: minimizing must pause gameplay AND silence all audio.
  // (Suspending the AudioContext freezes music + sfx; gameplay shows the
  // pause menu so the player resumes on their own terms.)
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (Game.state === 'running') UI.pauseToggle();
      if (Sfx.ctx && Sfx.ctx.state === 'running') Sfx.ctx.suspend();
    } else {
      if (Sfx.ctx && Sfx.ctx.state === 'suspended') Sfx.ctx.resume();
      // Android may discard the rendered surface while backgrounded — force
      // one repaint so returning never shows a blank canvas
      Game.idleDirty = true;
      // long absence -> idle earnings popup; crossed midnight -> daily reward
      if (Game.state === 'idle' && UI.stack[UI.stack.length - 1] === 'menu') {
        UI.arrive(Date.now() - hiddenAt);
      }
    }
  });

  // Android hardware back button: pause -> navigate back -> exit, never trap.
  const Cap = window.Capacitor;
  const AppPlugin = Cap && Cap.Plugins && Cap.Plugins.App;
  if (AppPlugin && AppPlugin.addListener) {
    AppPlugin.addListener('backButton', () => {
      const top = UI.stack[UI.stack.length - 1];
      if (Game.state === 'running') UI.pauseToggle();          // playing -> pause
      else if (top === 'pause') UI.resume();                    // paused -> resume
      else if (top === 'crash' || top === 'results') { /* must pick a button */ }
      else if (top === 'exit') UI.go('menu');                   // back on confirm -> stay
      else if (UI.stack.length > 1) UI.pop();                   // nested screen -> back one
      else if (top && top !== 'menu') UI.go('menu');            // sub-screen -> menu
      else UI.push('exit');                                     // menu -> ask before exit
    });
  }

  // Hold the native splash until the UI is actually painted — but hide it
  // from THREE redundant triggers so it can never hang: first paint, the
  // app 'resume' event (warm relaunches don't reload the page), and a
  // hard safety timeout.
  const Splash = Cap && Cap.Plugins && Cap.Plugins.SplashScreen;
  if (Splash && Splash.hide) {
    const hideSplash = () => {
      try { Splash.hide({ fadeOutDuration: 200 }); } catch (e) {}
      Game.idleDirty = true;                 // repaint after any resume
    };
    requestAnimationFrame(() => setTimeout(hideSplash, 80));
    setTimeout(hideSplash, 2500);
    if (AppPlugin && AppPlugin.addListener) AppPlugin.addListener('resume', hideSplash);
  }
});
