import { level } from './db.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Dates (rounds store local 'YYYY-MM-DDTHH:MM') ----------

const pad = (n) => String(n).padStart(2, '0');
export function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const dFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (at) => dFmt.format(new Date(at));
export const fmtDateTime = (at) => `${dFmt.format(new Date(at))}, ${tFmt.format(new Date(at))}`;
export const fmtVal = (v) => (v == null ? '–' : Number(v).toFixed(1));

// ---------- Value badge and trend arrow ----------

const WORD = { dry: 'Dry', damp: 'Damp', wet: 'Wet' };
export const levelWord = (v) => WORD[level(v)] || '';

// Colour plus a word, so the level never relies on colour alone.
export function badge(v) {
  const l = level(v);
  if (!l) return '<span class="badge none">–</span>';
  return `<span class="badge ${l}"><b>${fmtVal(v)}%</b><i>${WORD[l]}</i></span>`;
}

// ▲ wetter / ▼ drier than the previous reading.
export function trend(v, prev) {
  if (v == null || prev == null) return '<span class="trend none">new</span>';
  const d = Math.round((v - prev) * 10) / 10;
  if (d === 0) return '<span class="trend same">= 0.0</span>';
  return d > 0 ? `<span class="trend up">▲ +${d.toFixed(1)}</span>` : `<span class="trend down">▼ ${d.toFixed(1)}</span>`;
}

let toastTimer;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3000);
}

// ---------- Horizontal swipe ----------

// Drag `el` sideways with a finger; past 70px calls next() (swipe left) or prev() (swipe right).
export function swipe(el, { next, prev }) {
  let x0 = 0, y0 = 0, dx = 0, horiz = null, active = false;
  const reset = () => {
    el.style.transition = 'transform .18s ease-out';
    el.style.transform = '';
  };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return (active = false);
    active = true;
    horiz = null;
    dx = 0;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    el.style.transition = 'none';
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!active) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (horiz === null && Math.hypot(dx, dy) > 10) horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (horiz) el.style.transform = `translateX(${(dx < 0 ? next : prev) ? dx : dx / 4}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (!active) return;
    active = false;
    const go = horiz && Math.abs(dx) > 70 ? (dx < 0 ? next : prev) : null;
    if (!go) return reset();
    el.style.transition = 'transform .15s ease-in';
    el.style.transform = `translateX(${dx < 0 ? '-110%' : '110%'})`;
    setTimeout(go, 140);
  });
  el.addEventListener('touchcancel', () => {
    active = false;
    reset();
  });
}

// ---------- Full-screen photo viewer: pinch / double-tap zoom, swipe between photos ----------

export function openViewer(items, start = 0) {
  const v = document.getElementById('viewer');
  let i = start;
  v.innerHTML = `
    <div class="viewer-stage"><img alt="" draggable="false"></div>
    <div class="viewer-cap"></div>
    <button class="viewer-close" aria-label="Close photo">✕</button>
    ${items.length > 1 ? '<button class="viewer-nav prev" aria-label="Previous photo">‹</button><button class="viewer-nav next" aria-label="Next photo">›</button>' : ''}`;
  v.hidden = false;
  const stage = v.querySelector('.viewer-stage');
  const img = v.querySelector('img');
  const cap = v.querySelector('.viewer-cap');
  let scale = 1, tx = 0, ty = 0, lastTap = 0, g = null;
  const ptrs = new Map();

  const apply = () => (img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`);
  const show = (n) => {
    i = (n + items.length) % items.length;
    scale = 1;
    tx = ty = 0;
    apply();
    img.src = items[i].src;
    cap.textContent = `${items[i].caption || ''}${items.length > 1 ? `   ·   ${i + 1} of ${items.length}` : ''}`;
  };
  const zoomAt = (s, cx, cy) => {
    const r = stage.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
    s = Math.min(6, Math.max(1, s));
    tx = ox - ((ox - tx) * s) / scale;
    ty = oy - ((oy - ty) * s) / scale;
    scale = s;
    if (scale === 1) tx = ty = 0;
    apply();
  };
  const begin = () => {
    const [a, b] = [...ptrs.values()];
    g = b
      ? { dist: Math.hypot(a.x - b.x, a.y - b.y), scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx, ty, pinch: true }
      : { x: a.x, y: a.y, tx, ty, dx: 0 };
  };

  stage.onpointerdown = (e) => {
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin();
    if (ptrs.size === 1) {
      const t = Date.now();
      if (t - lastTap < 300) zoomAt(scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
      lastTap = t;
    }
  };
  stage.onpointermove = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...ptrs.values()];
    if (b && g.pinch) {
      scale = g.scale;
      tx = g.tx;
      ty = g.ty;
      zoomAt(g.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist), g.mx, g.my);
      tx += (a.x + b.x) / 2 - g.mx;
      ty += (a.y + b.y) / 2 - g.my;
      apply();
    } else if (!b && !g.pinch) {
      g.dx = a.x - g.x;
      if (scale > 1) {
        tx = g.tx + a.x - g.x;
        ty = g.ty + a.y - g.y;
      } else {
        tx = g.dx; // drag the photo sideways to hint at the swipe
      }
      apply();
    }
  };
  stage.onpointerup = stage.onpointercancel = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size) return begin();
    if (scale === 1 && g && !g.pinch) {
      if (Math.abs(g.dx) > 70 && items.length > 1) show(i + (g.dx < 0 ? 1 : -1));
      else {
        tx = 0;
        apply();
      }
    }
  };
  stage.onwheel = (e) => {
    e.preventDefault();
    zoomAt(scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
  };

  const close = () => {
    v.hidden = true;
    v.innerHTML = '';
    removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
    else return;
    e.stopPropagation();
    e.preventDefault();
  };
  addEventListener('keydown', onKey, true);
  v.querySelector('.viewer-close').onclick = close;
  v.querySelector('.viewer-nav.prev')?.addEventListener('click', () => show(i - 1));
  v.querySelector('.viewer-nav.next')?.addEventListener('click', () => show(i + 1));
  show(i);
}

// ---------- Images ----------

// Shrink phone photos before saving so storage doesn't fill up.
export async function resizeImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))) || file;
  } catch {
    return file;
  }
}
