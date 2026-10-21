// Small DOM builders shared by the screens.

/** Renders a row of toggle chips into `box`; `get`/`set` read and write the selected value. */
export function renderChips(box, options, get, set) {
  box.replaceChildren();
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(get() === value));
    b.addEventListener('click', () => {
      set(value);
      box.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
    });
    box.append(b);
  }
}

/** Fills a <dl> with [label, value] rows, each wrapped in a <div>. */
export function renderStats(dl, rows) {
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    div.append(dt, dd);
    dl.append(div);
  }
}

/** Five star glyphs; `stars` >= 6 means gold (full combo). */
export function renderStars(el, stars) {
  el.replaceChildren();
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    if (stars >= 6) s.className = 'gold';
    else if (i >= stars) s.className = 'off';
    el.append(s);
  }
}
