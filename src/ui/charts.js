// Tiny inline-SVG charts for the results and profile screens.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/**
 * Histogram of hit offsets in ms, early on the left, late on the right.
 * @param {number[]} offsets seconds
 */
export function timingHistogram(offsets, { rangeMs = 100, bins = 20 } = {}) {
  const w = 300;
  const h = 80;
  const counts = new Array(bins).fill(0);
  for (const o of offsets) {
    const i = Math.floor(((o * 1000 + rangeMs) / (2 * rangeMs)) * bins);
    if (i >= 0 && i < bins) counts[i]++;
  }
  const max = Math.max(1, ...counts);
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart histogram', role: 'img' });
  svg.setAttribute('aria-label', 'Hit timing histogram');
  counts.forEach((c, i) => {
    const bh = (c / max) * (h - 16);
    const x = (i / bins) * w;
    const centre = Math.abs(i - (bins - 1) / 2) <= 1;
    svg.append(
      el('rect', {
        x: x + 1,
        y: h - 14 - bh,
        width: w / bins - 2,
        height: bh,
        class: centre ? 'perfect' : '',
      }),
    );
  });
  svg.append(el('line', { x1: w / 2, y1: 0, x2: w / 2, y2: h - 12, class: 'axis' }));
  const label = (x, text, anchor) => {
    const t = el('text', { x, y: h - 2, 'text-anchor': anchor, class: 'label' });
    t.textContent = text;
    svg.append(t);
  };
  label(2, `early −${rangeMs}ms`, 'start');
  label(w / 2, '0', 'middle');
  label(w - 2, `+${rangeMs}ms late`, 'end');
  return svg;
}

/** Sparkline of values in 0..1 (e.g. accuracy over recent plays). */
export function sparkline(values) {
  const w = 300;
  const h = 60;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart sparkline', role: 'img' });
  svg.setAttribute('aria-label', 'Accuracy over recent plays');
  if (values.length < 2) return svg;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 4 - v * (h - 8)}`);
  svg.append(el('polyline', { points: pts.join(' '), fill: 'none' }));
  const last = pts[pts.length - 1].split(',');
  svg.append(el('circle', { cx: last[0], cy: last[1], r: 3 }));
  return svg;
}
