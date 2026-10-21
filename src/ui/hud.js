// In-game heads-up display (score, multiplier, streak, star power), drawn with DOM elements.

const STREAK_MILESTONES = new Set([50, 100, 250, 500, 750, 1000]);

export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    const $ = (sel) => root.querySelector(sel);
    this.el = {
      score: $('[data-hud=score]'),
      mult: $('[data-hud=mult]'),
      multRing: $('[data-hud=mult-ring]'),
      streak: $('[data-hud=streak]'),
      spFill: $('[data-hud=sp-fill]'),
      spButton: $('[data-hud=sp-button]'),
      progress: $('[data-hud=progress]'),
      popup: $('[data-hud=popup]'),
      hint: $('[data-hud=hint]'),
    };
    this.onStarPower = null;
    this.el.spButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onStarPower?.();
    });
    this.shown = {};
  }

  reset(engine, mode) {
    this.shown = {};
    this.el.popup.className = 'popup';
    this.el.hint.textContent =
      mode === 'tap'
        ? 'Tap the frets as notes reach them. Tap the highway for purple open notes.'
        : 'Hold frets 1-5 / A-G and strum with Enter, Space or the arrow keys. Shift = Star Power.';
    this.el.hint.classList.add('visible');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.el.hint.classList.remove('visible'), 4500);
    this.update(engine, 0, 1);
  }

  #set(key, value, apply) {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    apply(value);
  }

  update(engine, t, duration) {
    const { el } = this;
    this.#set('score', Math.round(engine.score), (v) => (el.score.textContent = v.toLocaleString()));
    this.#set('mult', engine.multiplier, (v) => {
      el.mult.textContent = `${v}x`;
      el.mult.dataset.level = String(Math.min(v, 8));
    });
    this.#set('streak', engine.streak, (v) => {
      el.streak.textContent = v ? `${v} streak` : '';
      const base = Math.min(4, 1 + Math.floor(v / 10));
      const progress = base >= 4 ? 1 : (v % 10) / 10;
      el.multRing.style.setProperty('--p', String(progress));
    });
    this.#set('sp', Math.round(engine.spMeter * 100), (v) => el.spFill.style.setProperty('--sp', `${v}%`));
    this.#set('spReady', engine.spMeter >= 0.5 && !engine.spActive, (v) => el.spButton.classList.toggle('ready', v));
    this.#set('spActive', engine.spActive, (v) => document.body.classList.toggle('sp-active', v));
    const p = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0;
    this.#set('progress', Math.round(p * 400), () => el.progress.style.setProperty('--p', String(p)));
  }

  event(ev, engine) {
    if (ev.type === 'hit' && STREAK_MILESTONES.has(engine.streak)) this.popup(`${engine.streak} note streak!`);
    if (ev.type === 'spGain' && engine.spMeter >= 0.5 && !engine.spActive) this.popup('Star Power ready!', 'sp');
    if (ev.type === 'spActivate') this.popup('Star Power!', 'sp');
    if (ev.type === 'multiplier') this.el.mult.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], 250);
  }

  popup(text, kind = '') {
    const p = this.el.popup;
    p.textContent = text;
    p.className = `popup ${kind}`;
    void p.offsetWidth; // restart the CSS animation
    p.classList.add('show');
  }
}
