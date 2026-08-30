/* Tiny pub/sub bus. The HUD and screens subscribe to game events instead of
   polling game state every frame (event-driven UI). */

const Bus = {
  _listeners: {},
  on(ev, fn) {
    (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    return fn;
  },
  off(ev, fn) {
    const l = this._listeners[ev];
    if (l) this._listeners[ev] = l.filter(f => f !== fn);
  },
  emit(ev, ...args) {
    (this._listeners[ev] || []).forEach(f => f(...args));
  },
};
