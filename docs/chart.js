// Small SVG line chart of one marker's readings over time: dry/damp/wet bands shaded
// behind, experiment notes marked as dashed verticals, tap/hover for details.

import { esc, badge } from './ui.js';

const DAY = 864e5;
const dFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * pts:     [{ t: ms, v, info }]
 * notes:   [{ t: ms, label }]
 * thr:     { yellow, red }
 */
export function drawChart(el, opts) {
  paint(el, opts);
  el._ro?.disconnect();
  let w = el.clientWidth;
  el._ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - w) > 4) {
      w = el.clientWidth;
      paint(el, opts);
    }
  });
  el._ro.observe(el);
}

function paint(el, { pts, notes = [], thr, label = 'Readings', height = 230 }) {
  if (!pts.length) {
    el.innerHTML = '<p class="empty">No readings yet.</p>';
    return;
  }
  pts = [...pts].sort((a, b) => a.t - b.t);
  const W = Math.max(280, el.clientWidth || 320);
  const H = height;
  const m = { l: 34, r: 14, t: 24, b: 26 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const dataLo = pts[0].t, dataHi = pts.at(-1).t;
  let lo = dataLo, hi = dataHi;
  if (hi - lo < DAY / 4) {
    lo -= DAY / 2;
    hi += DAY / 2;
  } else {
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
  }
  const top = Math.ceil(Math.max(...pts.map((p) => p.v), thr.red + 3) / 5) * 5;
  const x = (t) => Math.round((m.l + ((t - lo) / (hi - lo)) * pw) * 10) / 10;
  const y = (v) => Math.round((m.t + (1 - v / top) * ph) * 10) / 10;

  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)} over time">`;
  s += `<rect class="band wet" x="${m.l}" y="${y(top)}" width="${pw}" height="${y(thr.red) - y(top)}"/>`;
  s += `<rect class="band damp" x="${m.l}" y="${y(thr.red)}" width="${pw}" height="${y(thr.yellow) - y(thr.red)}"/>`;
  s += `<rect class="band dry" x="${m.l}" y="${y(thr.yellow)}" width="${pw}" height="${y(0) - y(thr.yellow)}"/>`;

  const step = top > 40 ? 10 : 5;
  for (let v = 0; v <= top; v += step) {
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="axis" x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
  }
  s += `<text class="axis" x="${m.l - 6}" y="${m.t - 10}" text-anchor="end">%</text>`;

  const n = dataHi === dataLo ? 1 : W < 420 ? 3 : 5;
  const short = dataHi - dataLo < 2 * DAY;
  let prevLbl = '';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? dataLo : dataLo + ((dataHi - dataLo) * i) / (n - 1);
    const lbl = short && n > 1 ? tFmt.format(t) : dFmt.format(t);
    if (lbl === prevLbl) continue;
    prevLbl = lbl;
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    s += `<text class="axis" x="${x(t)}" y="${H - 8}" text-anchor="${anchor}">${esc(lbl)}</text>`;
  }

  let labelEnd = -Infinity;
  for (const nt of notes) {
    const nx = x(nt.t);
    s += `<line class="marker" x1="${nx}" x2="${nx}" y1="${m.t - 4}" y2="${H - m.b}"/>`;
    const txt = nt.label.length > 18 ? nt.label.slice(0, 17) + '…' : nt.label;
    const w = txt.length * 5.6 + 8;
    let tx = nx + 3;
    if (tx + w > W) tx = nx - w;
    if (tx > labelEnd) {
      s += `<text class="marker-label" x="${tx}" y="${m.t - 8}">${esc(txt)}</text>`;
      labelEnd = tx + w;
    }
  }

  if (pts.length > 1) s += `<path class="line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.v)}`).join('')}"/>`;
  for (const p of pts) s += `<circle class="dot" cx="${x(p.t)}" cy="${y(p.v)}" r="4.5"/>`;
  s += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  s += `<circle class="focus" r="7" visibility="hidden"/>`;
  s += `<rect class="hit" x="0" y="0" width="${W}" height="${H}"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = s;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  const cross = svg.querySelector('.crosshair');
  const focus = svg.querySelector('.focus');
  const hits = pts.map((p) => ({ px: x(p.t), py: y(p.v), p }));

  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    let best = hits[0];
    for (const h of hits) if (Math.abs(h.px - mx) < Math.abs(best.px - mx)) best = h;
    cross.setAttribute('x1', best.px);
    cross.setAttribute('x2', best.px);
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', best.px);
    focus.setAttribute('cy', best.py);
    focus.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="tip-head">${badge(best.p.v)}</div>${best.p.info || ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, (best.px / W) * r.width - tw / 2), r.width - tw)}px`;
    tip.style.top = `${Math.max(0, (best.py / H) * r.height - tip.offsetHeight - 14)}px`;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
  });
}
