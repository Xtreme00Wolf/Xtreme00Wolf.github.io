/* Google Play in-app review (HH-65). Asked at most once per install, only in
   distributed builds, and only right after a happy moment — a 2★+ level clear
   with 12+ levels done. Google itself decides whether the dialog appears, so
   this can never nag; it silently no-ops in dev and in plain browsers. */

const Review = {
  maybeAsk() {
    if (__DEV) return;
    if (Save.data.review && Save.data.review.asked) return;
    if (Save.clearedLevels() < 12) return;
    Save.data.review = { asked: true };
    Save.save();
    const plug = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.InAppReview;
    if (plug && plug.requestReview) {
      // let the results confetti land before the native dialog slides in
      setTimeout(() => { try { plug.requestReview(); } catch (e) {} }, 700);
    }
  },
};
