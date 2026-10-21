// Screen navigation and the small shared UI helpers (loading overlay, toast, data-action buttons).
import { state } from './state.js';

export const $ = (sel) => document.querySelector(sel);

export function show(id, { push = true } = {}) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (push && state.history[state.history.length - 1] !== id) state.history.push(id);
}

export function back() {
  state.history.pop();
  show(state.history[state.history.length - 1] ?? 'menu', { push: false });
}

/** Jump to a screen and reset the back-stack to the given path. */
export function reset(path) {
  state.history = path;
  show(path[path.length - 1], { push: false });
}

export function loading(text) {
  $('#loading').hidden = !text;
  if (text) $('#loadingText').textContent = text;
}

let toastTimer;
export function toast(text, ms = 4000) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const actions = {};

/** Registers handlers for elements with data-action="name". */
export function registerActions(map) {
  Object.assign(actions, map);
}

document.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[data-action]'));
  if (el && actions[el.dataset.action]) actions[el.dataset.action]();
});
