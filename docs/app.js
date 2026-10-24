import {
  S, load, save, persist, uid, area, marker, markersOf, roundsOf, history, previous, allNotes, level,
  addPhoto, photoSrc, dropPhotoIfUnused, deleteMarker, deleteArea, backupFile, restore,
} from './db.js';
import { esc, nowLocal, fmtDate, fmtDateTime, fmtVal, badge, trend, levelWord, toast, swipe, openViewer, resizeImage } from './ui.js';
import { drawChart } from './chart.js';

// Bump on every change you push. The app compares this with the live copy to update itself.
const VERSION = 'v1.5';

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
const settingsBtn = document.getElementById('settings');

const pending = new Map(); // new rounds with no values yet (saved on the first value)
const tableScroll = new Map(); // area id → table scroll position to come back to after a + add
let slide = ''; // 'left' | 'right': animate the next screen in from that side
let keyHandler = null;

const go = (path) => (location.hash = '#' + path);
const swap = (path, dir) => {
  slide = dir;
  location.replace('#' + path);
};
const markerName = (m) => (m.name ? esc(m.name) : `Marker ${m.num}`);

// ---------- Router ----------

const routes = [
  [/^\/$/, homeView],
  [/^\/settings$/, settingsView],
  [/^\/a\/new$/, () => areaEditView(null)],
  [/^\/a\/([^/]+)$/, areaView],
  [/^\/a\/([^/]+)\/edit$/, areaEditView],
  [/^\/a\/([^/]+)\/table$/, areaView], // old link: the table is the area page now
  [/^\/a\/([^/]+)\/m\/new$/, (areaId) => markerEditView(null, areaId)],
  [/^\/m\/([^/]+)$/, markerView],
  [/^\/m\/([^/]+)\/edit$/, (id) => markerEditView(id)],
  [/^\/r\/([^/]+)\/([^/]+)$/, roundView],
];

function render() {
  const path = decodeURI(location.hash.slice(1)) || '/';
  keyHandler = null;
  let out = null;
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      out = view(...m.slice(1));
      break;
    }
  }
  if (!out) return location.replace('#/');
  titleEl.textContent = out.title;
  document.title = out.title === 'Damp Tracker' ? out.title : `${out.title} · Damp Tracker`;
  backBtn.hidden = !out.back;
  backBtn.onclick = () => go(out.back);
  settingsBtn.hidden = path !== '/';
  app.innerHTML = out.html;
  app.classList.remove('slide-left', 'slide-right');
  if (slide) {
    void app.offsetWidth; // restart the animation
    app.classList.add(`slide-${slide}`);
    slide = '';
  }
  out.mount?.(app);
  scrollTo(0, 0);
}

addEventListener('hashchange', render);
settingsBtn.onclick = () => go('/settings');
document.addEventListener('keydown', (e) => {
  if (keyHandler && !e.target.closest('input, textarea, select') && !e.ctrlKey && !e.metaKey && !e.altKey) keyHandler(e);
});

// ---------- Home ----------

function homeView() {
  const cards = S.areas.map((a) => {
    const ms = markersOf(a.id);
    const last = roundsOf(a.id).at(-1);
    const counts = { wet: 0, damp: 0, dry: 0 };
    for (const m of ms) {
      const v = history(m.id).at(-1)?.value;
      if (v != null) counts[level(v)]++;
    }
    return `<a class="card" href="#/a/${a.id}">
      <div class="card-title">${esc(a.name)}</div>
      <div class="muted">${ms.length} marker${ms.length === 1 ? '' : 's'} · ${last ? `last round ${fmtDate(last.at)}${last.note ? ` · ${esc(last.note)}` : ''}` : 'no rounds yet'}</div>
      <div class="levels">
        ${counts.wet ? `<span class="pill wet">${counts.wet} wet</span>` : ''}
        ${counts.damp ? `<span class="pill damp">${counts.damp} damp</span>` : ''}
        ${counts.dry ? `<span class="pill dry">${counts.dry} dry</span>` : ''}
      </div>
    </a>`;
  });
  const days = S.settings.lastBackup ? (Date.now() - Date.parse(S.settings.lastBackup)) / 864e5 : Infinity;
  const nudge = S.rounds.length && days > 14
    ? `<a class="notice" href="#/settings">Your readings are only on this phone. ${S.settings.lastBackup ? `Last backup ${fmtDate(S.settings.lastBackup)}.` : 'No backup yet.'} <b>Back up now ›</b></a>`
    : '';
  return {
    title: 'Damp Tracker',
    html: `
      ${nudge}
      ${cards.join('') || '<div class="empty-state">Start by adding an area, e.g. <b>Stairwell</b>. Then add its numbered markers.</div>'}
      <a class="btn ${S.areas.length ? '' : 'primary big'}" href="#/a/new">+ Add area</a>
      ${versionButton()}`,
    mount: mountVersionButton,
  };
}

// ---------- Version & updates ----------

const versionButton = () => `<button class="version" data-act="version">Damp Tracker ${VERSION} · tap to check for updates</button>`;
function mountVersionButton(root) {
  root.querySelector('[data-act=version]').onclick = () => checkForUpdate(true);
}

// Screens where a surprise reload could lose something being typed.
const isBusy = () => /^\/(r\/|settings|a\/new|a\/[^/]+\/(edit|m\/new)|m\/[^/]+\/edit)/.test(decodeURI(location.hash.slice(1)));

// Installed apps have no refresh button, so on open and whenever the app comes back to the
// front, read VERSION from the live app.js (skipping every cache) and reload if it's newer.
async function checkForUpdate(manual = false) {
  let latest;
  try {
    const src = await (await fetch(`app.js?check=${Date.now()}`, { cache: 'no-store' })).text();
    latest = src.match(/const VERSION = '([^']+)'/)?.[1];
  } catch {
    if (manual) toast('No connection, so I can’t check for updates', 'error');
    return;
  }
  if (!latest || latest === VERSION) {
    if (manual) toast(`You have the latest version (${VERSION})`);
    return;
  }
  // Reload once per new version. If the old copy comes back anyway, offer a button instead of looping.
  if (manual || (!isBusy() && sessionStorage.getItem('updatedTo') !== latest)) {
    sessionStorage.setItem('updatedTo', latest);
    location.reload();
    return;
  }
  const bar = document.getElementById('update');
  bar.textContent = `New version ${latest} ready. Tap to update`;
  bar.hidden = false;
  bar.onclick = () => location.reload();
}
document.addEventListener('visibilitychange', () => document.hidden || checkForUpdate());

// ---------- Area: one row per marker, one column per round (oldest → newest) ----------

function areaView(id) {
  const a = area(id);
  if (!a) return null;
  const ms = markersOf(id);
  const rounds = roundsOf(id);
  const up = rounds.map(() => 0), down = rounds.map(() => 0);

  const rows = ms.map((m, mi) => {
    let prev = null; // this marker's value in the nearest column to the left
    const cells = rounds.map((r, k) => {
      const v = r.values[m.id];
      if (v == null) {
        return `<td><button class="add-cell" data-add="${r.id}" data-i="${mi}" aria-label="Add marker ${m.num} for ${fmtDate(r.at)}">+</button></td>`;
      }
      const d = prev == null ? null : Math.round((v - prev) * 10) / 10;
      prev = v;
      if (d > 0) up[k]++;
      if (d < 0) down[k]++;
      const arrow = d == null ? '' : d > 0 ? '▲' : d < 0 ? '▼' : '=';
      return `<td><span class="cell ${level(v)}">${fmtVal(v)}<small class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${arrow}</small></span></td>`;
    });
    return `<tr><th class="mk"><a href="#/m/${m.id}"><span class="num">${m.num}</span><span class="nm">${m.name ? esc(m.name) : ''}</span></a></th>${cells.join('')}</tr>`;
  });
  const heads = rounds.map(
    (r) => `<th class="rh" data-r="${r.id}"><div>${fmtDate(r.at)}</div><div class="muted">${r.at.slice(11, 16)}</div>${r.note ? `<span class="tag">${esc(r.note)}</span>` : ''}</th>`,
  );
  const sums = rounds.map((_, k) => (k === 0 ? '<td></td>' : `<td><span class="up">▲${up[k]}</span> <span class="down">▼${down[k]}</span></td>`));

  return {
    title: a.name,
    back: '/',
    html: ms.length
      ? `
      <div class="table-scroll" id="ts"><table class="matrix">
        <thead><tr><th class="mk">Marker</th>${heads.join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
        ${rounds.length > 1 ? `<tfoot><tr class="sumrow"><th class="mk">Change</th>${sums.join('')}</tr></tfoot>` : ''}
      </table></div>
      <p class="muted small">${rounds.length
        ? 'Each round adds a column on the right. <span class="trend up">▲</span> wetter / <span class="trend down">▼</span> drier than the round before. Tap a date to open that round, or a marker to see its chart.'
        : 'Tap <b>+ New round</b> to take your first readings. Each round adds a column here.'}</p>
      <a class="btn ghost" href="#/a/${id}/edit">Edit area &amp; markers</a>
      <div class="bottom-bar"><button class="btn primary big" data-act="new">+ New round</button></div>`
      : `
      <div class="empty-state">No markers yet. Add the numbered spots you measure.</div>
      <a class="btn ghost" href="#/a/${id}/edit">Edit area</a>
      <div class="bottom-bar"><a class="btn primary big" href="#/a/${id}/m/new">+ Add first marker</a></div>`,
    mount(root) {
      root.querySelectorAll('th[data-r]').forEach((th) => th.addEventListener('click', () => go(`/r/${th.dataset.r}/done`)));
      const ts = root.querySelector('#ts');
      if (ts) {
        // Open on the newest rounds, or where you were before tapping a +.
        ts.scrollLeft = tableScroll.get(id) ?? ts.scrollWidth;
        tableScroll.delete(id);
      }
      root.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', () => {
          tableScroll.set(id, ts.scrollLeft);
          go(`/r/${b.dataset.add}/add-${b.dataset.i}`);
        }),
      );
      root.querySelector('[data-act=new]')?.addEventListener('click', () => {
        const r = { id: uid(), areaId: id, at: nowLocal(), note: '', values: {} };
        pending.set(r.id, r);
        go(`/r/${r.id}/start`);
      });
    },
  };
}

// ---------- Marker (swipe between markers) ----------

function photoItems(areaId) {
  const byPhoto = new Map();
  for (const m of markersOf(areaId)) {
    if (!m.photoId) continue;
    if (!byPhoto.has(m.photoId)) byPhoto.set(m.photoId, []);
    byPhoto.get(m.photoId).push(m.num);
  }
  return [...byPhoto].map(([pid, nums]) => ({ pid, src: photoSrc(pid), caption: `Marker${nums.length > 1 ? 's' : ''} ${nums.join(', ')}` }));
}

function zoomPhoto(m) {
  const items = photoItems(m.areaId);
  openViewer(items, Math.max(0, items.findIndex((x) => x.pid === m.photoId)));
}

function markerView(id) {
  const m = marker(id);
  if (!m) return null;
  const a = area(m.areaId);
  const ms = markersOf(m.areaId);
  const i = ms.findIndex((x) => x.id === id);
  const prevM = ms[i - 1], nextM = ms[i + 1];
  const h = history(id);
  const last = h.at(-1), prev = h.at(-2);

  const rows = [...h].reverse().map((x, k, arr) => {
    const before = arr[k + 1]?.value;
    return `<a class="row" href="#/r/${x.round.id}/done">
      <span class="row-main"><span class="row-title">${fmtDateTime(x.round.at)}</span>
        <span class="row-sub">${x.round.note ? `<span class="tag">${esc(x.round.note)}</span>` : 'no note'}</span></span>
      <span class="row-end">${badge(x.value)}${trend(x.value, before)}</span></a>`;
  });

  return {
    title: `${a.name} · ${m.num}`,
    back: `/a/${a.id}`,
    html: `
      <div class="swipe-area" id="sw">
        <div class="pager">
          <button class="pg" data-go="prev" ${prevM ? '' : 'disabled'} aria-label="Previous marker">‹ ${prevM ? prevM.num : ''}</button>
          <span>${i + 1} of ${ms.length} <span class="muted small">· swipe</span></span>
          <button class="pg" data-go="next" ${nextM ? '' : 'disabled'} aria-label="Next marker">${nextM ? nextM.num : ''} ›</button>
        </div>
        <div class="marker-head">
          <span class="num big">${m.num}</span>
          <div class="row-main"><div class="row-title">${markerName(m)}</div>
            <div class="row-sub">${last ? `Latest ${fmtDate(last.round.at)}` : 'No readings yet'}</div></div>
          <div class="row-end">${badge(last?.value)}${last ? trend(last.value, prev?.value) : ''}</div>
        </div>
        ${m.photoId ? `<button class="photo" data-act="zoom"><img src="${photoSrc(m.photoId)}" alt="Marker ${m.num}"><span class="zoom-hint">Tap to zoom</span></button>` : ''}
        <h2>Trend</h2>
        <div class="chart" id="chart"></div>
        <h2>History</h2>
        <div class="list">${rows.join('') || '<div class="empty-state">No readings yet.</div>'}</div>
        <a class="btn ghost" href="#/m/${id}/edit">Edit marker</a>
      </div>`,
    mount(root) {
      const toNext = nextM && (() => swap(`/m/${nextM.id}`, 'left'));
      const toPrev = prevM && (() => swap(`/m/${prevM.id}`, 'right'));
      swipe(root.querySelector('#sw'), { next: toNext, prev: toPrev });
      root.querySelector('[data-go=next]').onclick = () => toNext?.();
      root.querySelector('[data-go=prev]').onclick = () => toPrev?.();
      root.querySelector('[data-act=zoom]')?.addEventListener('click', () => zoomPhoto(m));
      keyHandler = (e) => {
        if (e.key === 'ArrowRight') toNext?.();
        else if (e.key === 'ArrowLeft') toPrev?.();
      };
      drawChart(root.querySelector('#chart'), {
        label: `Marker ${m.num}`,
        pts: h.map((x) => ({
          t: Date.parse(x.round.at),
          v: x.value,
          info: `<div>${fmtDateTime(x.round.at)}</div>${x.round.note ? `<div class="muted">${esc(x.round.note)}</div>` : ''}`,
        })),
        notes: h.filter((x) => x.round.note).map((x) => ({ t: Date.parse(x.round.at), label: x.round.note })),
        thr: S.settings,
      });
    },
  };
}

// ---------- Round: start → one screen per marker → summary ----------

function roundView(rid, step) {
  const r = S.rounds.find((x) => x.id === rid) || pending.get(rid);
  if (!r || !area(r.areaId)) return null;
  const a = area(r.areaId);
  const ms = markersOf(a.id);
  if (step === 'start') return roundStart(r, a);
  if (step === 'done') return roundDone(r, a, ms);
  const single = step.startsWith('add-'); // filling in one missing value from the table
  const i = Number(single ? step.slice(4) : step);
  if (!(i >= 0 && i < ms.length)) return roundDone(r, a, ms);
  return roundEntry(r, a, ms, i, single);
}

const isSaved = (r) => S.rounds.includes(r);

function roundStart(r, a) {
  const notes = allNotes();
  return {
    title: isSaved(r) ? 'Edit round' : 'New round',
    back: isSaved(r) ? `/r/${r.id}/done` : `/a/${a.id}`,
    html: `
      <form id="f" class="form">
        <label>Date and time<input type="datetime-local" name="at" value="${esc(r.at)}" required></label>
        <div>
          <div class="label">What's happening? <span class="muted">(optional)</span></div>
          <div class="chips">${notes.map((n) => `<button type="button" class="chip${n === r.note ? ' on' : ''}" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>
          <input name="note" value="${esc(r.note)}" maxlength="120" placeholder="or type a note, e.g. hosed window 10 min" autocomplete="off">
        </div>
        <button class="btn primary big">${isSaved(r) ? 'Save' : 'Start ›'}</button>
      </form>
      ${isSaved(r) ? '<button class="btn danger" data-act="delete">Delete this round</button>' : ''}`,
    mount(root) {
      const f = root.querySelector('#f');
      root.querySelectorAll('[data-note]').forEach((b) =>
        b.addEventListener('click', () => {
          const on = f.note.value !== b.dataset.note;
          f.note.value = on ? b.dataset.note : '';
          root.querySelectorAll('[data-note]').forEach((x) => x.classList.toggle('on', on && x === b));
        }),
      );
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        r.at = f.at.value || nowLocal();
        r.note = f.note.value.trim();
        if (isSaved(r)) {
          await save();
          go(`/r/${r.id}/done`);
        } else swap(`/r/${r.id}/0`, 'left');
      });
      root.querySelector('[data-act=delete]')?.addEventListener('click', async () => {
        if (!confirm(`Delete the round from ${fmtDateTime(r.at)} and all its readings?`)) return;
        S.rounds = S.rounds.filter((x) => x !== r);
        await save();
        toast('Round deleted');
        go(`/a/${a.id}`);
      });
    },
  };
}

// single: adding one missing value from the table; Save goes straight back to it.
function roundEntry(r, a, ms, i, single = false) {
  const m = ms[i];
  const orig = r.values[m.id];
  const before = previous(m.id, r);
  let val = orig != null ? String(orig) : '';
  const nextStep = i + 1 < ms.length ? i + 1 : 'done';
  const prevStep = i > 0 ? i - 1 : 'start';
  const backToTable = () => (history.length > 1 ? history.back() : go(`/a/${a.id}`));

  return {
    title: a.name,
    back: `/a/${a.id}`,
    html: `
      <div class="entry-screen" id="sw">
        <div class="round-top">
          ${single
            ? `<span>Adding to <b>${fmtDateTime(r.at)}</b></span>`
            : `<span>Marker <b>${i + 1}</b> of ${ms.length} <span class="muted small">· swipe</span></span>`}
          ${r.note ? `<span class="tag">${esc(r.note)}</span>` : ''}
        </div>
        ${single ? '' : `<div class="progress">${ms.map((x, k) => `<span class="${k === i ? 'cur' : ''} ${r.values[x.id] != null ? 'done' : ''}"></span>`).join('')}</div>`}
        <button class="round-photo" ${m.photoId ? '' : 'disabled'} aria-label="Zoom photo">
          ${m.photoId ? `<img src="${photoSrc(m.photoId)}" alt=""><span class="zoom-hint">Tap to zoom</span>` : '<span class="muted">No photo</span>'}
        </button>
        <div class="round-point">
          <span class="num big">${m.num}</span>
          <div class="row-main">
            <div class="row-title">${markerName(m)}</div>
            <div class="row-sub">${before ? `Last ${badge(before.value)} <span class="muted">${fmtDate(before.round.at)}</span>` : '<span class="muted">First reading</span>'}</div>
          </div>
        </div>
        <div class="entry"><span class="entry-val" id="val"></span><span class="entry-unit">%</span><span id="lvl"></span></div>
        <div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>`).join('')}</div>
        ${single
          ? `<div class="round-actions two-btn">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="save">Save ✓</button>
        </div>`
          : `<div class="round-actions">
          <button class="btn" data-act="back">‹ Back</button>
          <button class="btn" data-act="skip">Skip</button>
          <button class="btn primary" data-act="save">Save ›</button>
        </div>`}
      </div>`,
    mount(root) {
      const valEl = root.querySelector('#val');
      const lvlEl = root.querySelector('#lvl');
      const show = () => {
        valEl.textContent = val || '–';
        valEl.classList.toggle('placeholder', !val);
        const v = parseFloat(val);
        lvlEl.innerHTML = val && !isNaN(v) ? `<span class="badge ${level(v)}"><i>${levelWord(v)}</i></span> ${before ? trend(v, before.value) : ''}` : '';
      };
      const press = (k) => {
        let next = val;
        if (k === '⌫') next = val.slice(0, -1);
        else if (k === '.') next = val.includes('.') ? val : (val || '0') + '.';
        else if (val === '0') next = k;
        else if (/\.\d$/.test(val)) return; // one decimal, like the meter
        else next = val + k;
        if (parseFloat(next) > 100 || next.length > 5) return;
        val = next;
        show();
      };
      // Store what's typed (or clear it if it was emptied). Returns false if nothing to store.
      const commit = async () => {
        const v = Math.round(parseFloat(val) * 10) / 10;
        if (!val || isNaN(v)) {
          if (orig == null) return false;
          delete r.values[m.id];
        } else {
          if (v === orig) return true;
          r.values[m.id] = v;
        }
        if (!isSaved(r)) {
          S.rounds.push(r);
          pending.delete(r.id);
        }
        await save();
        return true;
      };
      const toNext = async () => {
        await commit();
        swap(`/r/${r.id}/${nextStep}`, 'left');
      };
      const toPrev = async () => {
        await commit();
        swap(`/r/${r.id}/${prevStep}`, 'right');
      };
      const saveAndNext = async () => {
        if (!val && orig == null) return toast(single ? 'Type the reading, or tap Cancel' : 'Type the reading, or tap Skip');
        await commit();
        navigator.vibrate?.(15);
        if (single) {
          toast(`Marker ${m.num} added`);
          return backToTable();
        }
        swap(`/r/${r.id}/${nextStep}`, 'left');
      };

      root.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
      root.querySelector('[data-act=save]').onclick = saveAndNext;
      if (m.photoId) root.querySelector('.round-photo').onclick = () => zoomPhoto(m);
      if (single) {
        root.querySelector('[data-act=cancel]').onclick = backToTable;
      } else {
        root.querySelector('[data-act=skip]').onclick = () => swap(`/r/${r.id}/${nextStep}`, 'left');
        root.querySelector('[data-act=back]').onclick = toPrev;
        swipe(root.querySelector('#sw'), { next: toNext, prev: toPrev });
      }
      keyHandler = (e) => {
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === '.' || e.key === ',') press('.');
        else if (e.key === 'Backspace') press('⌫');
        else if (e.key === 'Enter') saveAndNext();
        else if (e.key === 'Escape' && single) backToTable();
        else if (e.key === 'ArrowRight' && !single) toNext();
        else if (e.key === 'ArrowLeft' && !single) toPrev();
        else return;
        e.preventDefault();
      };
      show();
    },
  };
}

function roundDone(r, a, ms) {
  let up = 0, down = 0, same = 0, n = 0;
  const rows = ms.map((m, i) => {
    const v = r.values[m.id];
    const p = previous(m.id, r);
    if (v != null) {
      n++;
      if (p) v > p.value ? up++ : v < p.value ? down++ : same++;
    }
    return `<button class="row" data-i="${i}">
      <span class="num">${m.num}</span>
      <span class="row-main"><span class="row-title">${markerName(m)}</span>
        <span class="row-sub">${p ? `was ${fmtVal(p.value)}% on ${fmtDate(p.round.at)}` : 'first reading'}</span></span>
      <span class="row-end">${v != null ? badge(v) + trend(v, p?.value) : '<span class="add-cell">+</span>'}</span>
    </button>`;
  });
  return {
    title: 'Round',
    back: `/a/${a.id}`,
    html: `
      <div class="round-head">
        <div class="row-title">${fmtDateTime(r.at)}</div>
        ${r.note ? `<span class="tag">${esc(r.note)}</span>` : ''}
        <div class="sum big">${n} of ${ms.length} read · <span class="up">▲ ${up} wetter</span> · <span class="down">▼ ${down} drier</span>${same ? ` · ${same} same` : ''}</div>
      </div>
      <div class="list">${rows.join('')}</div>
      <p class="muted small">Tap a marker to change its value.</p>
      <button class="btn ghost" data-act="edit">Change date / note</button>
      <div class="bottom-bar"><button class="btn primary big" data-act="done">Done</button></div>`,
    mount(root) {
      root.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => go(`/r/${r.id}/${b.dataset.i}`)));
      root.querySelector('[data-act=edit]').onclick = () => go(`/r/${r.id}/start`);
      root.querySelector('[data-act=done]').onclick = () => {
        pending.delete(r.id);
        go(`/a/${a.id}`);
      };
    },
  };
}

// ---------- Edit area & its markers ----------

function areaEditView(id) {
  const a = id ? area(id) : null;
  if (id && !a) return null;
  const ms = a ? markersOf(id) : [];
  const rows = ms.map((m, i) => `
    <div class="row">
      <span class="num">${m.num}</span>
      ${m.photoId ? `<img class="mini" src="${photoSrc(m.photoId)}" alt="">` : ''}
      <a class="row-main" href="#/m/${m.id}/edit"><span class="row-title">${markerName(m)}</span><span class="row-sub">${m.photoId ? 'photo' : 'no photo'} · tap to edit</span></a>
      <span class="reorder">
        <button class="icon-btn" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move marker ${m.num} up">▲</button>
        <button class="icon-btn" data-move="${i}" data-dir="1" ${i === ms.length - 1 ? 'disabled' : ''} aria-label="Move marker ${m.num} down">▼</button>
      </span>
    </div>`);

  return {
    title: a ? `Edit ${a.name}` : 'New area',
    back: a ? `/a/${id}` : '/',
    html: `
      <form id="f" class="form inline-form">
        <input name="name" required maxlength="60" value="${esc(a?.name || '')}" placeholder="Area name, e.g. Stairwell" aria-label="Area name">
        <button class="btn primary">${a ? 'Save' : 'Create'}</button>
      </form>
      ${a ? `
        <h2>Markers</h2>
        <div class="list">${rows.join('') || '<div class="empty-state">No markers yet.</div>'}</div>
        <a class="btn primary" href="#/a/${id}/m/new">+ Add marker</a>
        <p class="muted small">▲▼ swaps a marker's number with its neighbour.</p>
        <button class="btn danger" data-act="delete">Delete area</button>` : ''}`,
    mount(root) {
      root.querySelector('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return;
        if (a) {
          a.name = name;
          await save();
          toast('Saved');
          go(`/a/${id}`);
        } else {
          const na = { id: uid(), name };
          S.areas.push(na);
          await save();
          go(`/a/${na.id}/edit`);
          toast('Area added. Now add its markers.');
        }
      });
      root.querySelectorAll('[data-move]').forEach((b) =>
        b.addEventListener('click', async () => {
          const i = Number(b.dataset.move);
          const x = ms[i], y = ms[i + Number(b.dataset.dir)];
          [x.num, y.num] = [y.num, x.num];
          await save();
          render();
        }),
      );
      root.querySelector('[data-act=delete]')?.addEventListener('click', async () => {
        const n = roundsOf(id).length;
        if (prompt(`Delete ${a.name}, its ${ms.length} markers, photos and ${n} rounds? This can't be undone. Type the area name to confirm.`) !== a.name) return;
        await deleteArea(id);
        toast('Area deleted');
        go('/');
      });
    },
  };
}

function markerEditView(id, newAreaId) {
  const m = id ? marker(id) : null;
  if (id && !m) return null;
  const areaId = m ? m.areaId : newAreaId;
  const a = area(areaId);
  if (!a) return null;
  const ms = markersOf(areaId);
  let photoId = m?.photoId || null;
  const reuse = photoItems(areaId);

  return {
    title: m ? `Marker ${m.num}` : 'New marker',
    back: m ? `/m/${id}` : `/a/${areaId}/edit`,
    html: `
      <form id="f" class="form">
        <div class="two">
          <label>Number<input name="num" type="number" inputmode="numeric" min="1" step="1" required value="${m?.num ?? Math.max(0, ...ms.map((x) => x.num)) + 1}"></label>
          <label>Name <span class="muted">(optional)</span><input name="name" maxlength="80" value="${esc(m?.name || '')}" placeholder="e.g. by window"></label>
        </div>
        <div>
          <div class="label">Photo <span class="muted">(optional)</span></div>
          <div id="ph"></div>
          <div class="photo-btns">
            <label class="btn">📷 Camera<input type="file" accept="image/*" capture="environment" hidden data-file></label>
            <label class="btn">🖼 Gallery<input type="file" accept="image/*" hidden data-file></label>
          </div>
          ${reuse.length ? `<label class="small-label">or use a photo already in ${esc(a.name)}:</label>
            <div class="reuse">${reuse.map((p) => `<button type="button" class="reuse-pick" data-pid="${p.pid}"><img src="${p.src}" alt=""><span>${esc(p.caption)}</span></button>`).join('')}</div>` : ''}
        </div>
        <button class="btn primary big">Save marker</button>
        ${m ? '' : '<button type="button" class="btn" data-act="another">Save &amp; add another</button>'}
      </form>
      ${m ? '<button class="btn danger" data-act="delete">Delete marker</button>' : ''}`,
    mount(root) {
      const f = root.querySelector('#f');
      const drawPhoto = () => {
        root.querySelector('#ph').innerHTML = photoId
          ? `<div class="photo-current"><img src="${photoSrc(photoId)}" alt=""><button type="button" class="btn small" data-act="nophoto">Remove photo</button></div>`
          : '<p class="muted small">No photo.</p>';
        root.querySelector('[data-act=nophoto]')?.addEventListener('click', () => {
          photoId = null;
          drawPhoto();
        });
        root.querySelectorAll('[data-pid]').forEach((b) => b.classList.toggle('on', b.dataset.pid === photoId));
      };
      drawPhoto();
      root.querySelectorAll('[data-file]').forEach((inp) =>
        inp.addEventListener('change', async () => {
          const file = inp.files[0];
          inp.value = '';
          if (!file) return;
          toast('Adding photo…');
          // Hold Save until the photo is stored, or it would be lost.
          const btns = root.querySelectorAll('#f button');
          btns.forEach((b) => (b.disabled = true));
          try {
            photoId = await addPhoto(await resizeImage(file));
          } finally {
            btns.forEach((b) => (b.disabled = false));
          }
          drawPhoto();
        }),
      );
      root.querySelectorAll('[data-pid]').forEach((b) =>
        b.addEventListener('click', () => {
          photoId = b.dataset.pid;
          drawPhoto();
        }),
      );

      const submit = async (another) => {
        if (!f.reportValidity()) return;
        const num = Number(f.num.value);
        if (ms.some((x) => x.num === num && x.id !== id) && !confirm(`Marker ${num} already exists. Use this number anyway?`)) return;
        const old = m?.photoId;
        if (m) Object.assign(m, { num, name: f.name.value.trim(), photoId });
        else S.markers.push({ id: uid(), areaId, num, name: f.name.value.trim(), photoId });
        await save();
        if (old !== photoId) await dropPhotoIfUnused(old);
        toast(`Marker ${num} saved`);
        if (another) render();
        else go(m ? `/m/${id}` : `/a/${areaId}/edit`);
      };
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        submit(false);
      });
      root.querySelector('[data-act=another]')?.addEventListener('click', () => submit(true));
      root.querySelector('[data-act=delete]')?.addEventListener('click', async () => {
        const n = history(id).length;
        if (!confirm(`Delete marker ${m.num}${n ? ` and its ${n} reading${n === 1 ? '' : 's'}` : ''}?`)) return;
        await deleteMarker(id);
        toast('Marker deleted');
        go(`/a/${areaId}/edit`);
      });
    },
  };
}

// ---------- Settings, backup, export ----------

function settingsView() {
  const st = S.settings;
  return {
    title: 'Settings',
    back: '/',
    html: `
      <h2>Backup</h2>
      <p class="small">Your readings and photos are stored <b>only on this phone</b>. Save a backup now and then: tap <b>Save backup to Drive</b>, then pick <b>Drive</b> in the menu that opens. ${st.lastBackup ? `Last backup: <b>${fmtDateTime(st.lastBackup)}</b>.` : '<b>No backup yet.</b>'}</p>
      <div class="stack">
        <button class="btn primary" data-act="backup">Save backup to Drive…</button>
        <label class="btn">Restore from backup file<input type="file" accept=".txt,.json,text/plain,application/json" hidden data-act="restore"></label>
        <p class="muted small">To restore, pick the backup file from Drive in the file picker (tap ☰ → Drive). Restoring replaces everything on this phone.</p>
        <button class="btn" data-act="csv">Export readings as CSV</button>
      </div>
      <p class="muted small" id="storage"></p>

      <h2>Colours <span class="muted small">(meter in WALL mode)</span></h2>
      <form id="thr" class="form">
        <div class="two">
          <label>Yellow from<input name="yellow" type="number" inputmode="decimal" step="0.1" min="0.1" value="${st.yellow}" required></label>
          <label>Red from<input name="red" type="number" inputmode="decimal" step="0.1" min="0.2" value="${st.red}" required></label>
        </div>
        <p class="legend" id="legend"></p>
        <button class="btn">Save colours</button>
      </form>

      <h2>Quick notes for rounds</h2>
      <div class="chips">${st.notes.map((n, i) => `<span class="chip">${esc(n)}<button class="chip-x" data-rm="${i}" aria-label="Remove ${esc(n)}">✕</button></span>`).join('')}</div>
      <form id="addnote" class="inline-form">
        <input name="note" maxlength="80" placeholder="e.g. gutter cleared" required>
        <button class="btn">Add</button>
      </form>
      ${versionButton()}`,
    async mount(root) {
      mountVersionButton(root);
      const thr = root.querySelector('#thr');
      const legend = () => {
        const y = Number(thr.yellow.value), r = Number(thr.red.value);
        root.querySelector('#legend').innerHTML =
          `<span class="pill dry">Green under ${y}%</span> <span class="pill damp">Yellow ${y}–${(r - 0.1).toFixed(1)}%</span> <span class="pill wet">Red ${r}%+</span>`;
      };
      thr.addEventListener('input', legend);
      legend();
      thr.addEventListener('submit', async (e) => {
        e.preventDefault();
        const yellow = Number(thr.yellow.value), red = Number(thr.red.value);
        if (!(red > yellow)) return toast('Red must be higher than yellow', 'error');
        Object.assign(st, { yellow, red });
        await save();
        toast('Colours saved');
      });
      root.querySelectorAll('[data-rm]').forEach((b) =>
        b.addEventListener('click', async () => {
          st.notes.splice(Number(b.dataset.rm), 1);
          await save();
          render();
        }),
      );
      root.querySelector('#addnote').addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = e.target.note.value.trim();
        if (n && !st.notes.includes(n)) st.notes.push(n);
        await save();
        render();
      });
      const backupBtn = root.querySelector('[data-act=backup]');
      let ready = null; // built backup, kept in case the share needs a second tap
      backupBtn.onclick = async () => {
        if (!ready) {
          backupBtn.disabled = true;
          backupBtn.textContent = 'Preparing backup…';
          try {
            ready = await backupFile();
          } finally {
            backupBtn.disabled = false;
          }
        }
        const result = await shareOrDownload(ready);
        if (result === 'retry') {
          // Building it took too long for the phone to allow sharing from that tap.
          backupBtn.textContent = 'Backup ready. Tap to save to Drive';
          return;
        }
        backupBtn.textContent = 'Save backup to Drive…';
        ready = null;
        if (!result) return;
        st.lastBackup = new Date().toISOString();
        await save();
        render();
        toast(result === 'downloaded' ? 'Backup saved to Downloads' : 'Backup saved');
      };
      root.querySelector('[data-act=restore]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !confirm('Replace everything on this phone with this backup?')) return;
        try {
          await restore(file);
          toast('Backup restored');
          go('/');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      root.querySelector('[data-act=csv]').onclick = async () => {
        if ((await shareOrDownload(csvFile())) === 'downloaded') toast('CSV saved to Downloads');
      };

      const est = await navigator.storage?.estimate?.().catch(() => null);
      const kept = await persist();
      root.querySelector('#storage').textContent =
        `${est ? `Using ${(est.usage / 1048576).toFixed(1)} MB. ` : ''}${kept ? 'The browser will keep this data.' : 'Tip: add the app to your home screen so the browser keeps this data.'}`;
    },
  };
}

function csvFile() {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['area', 'marker', 'marker_name', 'date', 'time', 'note', 'value_pct', 'level', 'change'].join(',')];
  for (const a of S.areas) {
    for (const r of roundsOf(a.id)) {
      for (const m of markersOf(a.id)) {
        const v = r.values[m.id];
        if (v == null) continue;
        const p = previous(m.id, r)?.value;
        lines.push([a.name, m.num, m.name, r.at.slice(0, 10), r.at.slice(11, 16), r.note, v, levelWord(v), p == null ? '' : (Math.round((v - p) * 10) / 10).toFixed(1)].map(cell).join(','));
      }
    }
  }
  return new File(['﻿' + lines.join('\r\n')], `damp-readings-${nowLocal().slice(0, 10)}.csv`, { type: 'text/csv' });
}

// On a phone, open the share sheet (Drive, email…); otherwise download.
// Returns 'shared', 'downloaded', false (cancelled) or 'retry' (needs a fresh tap).
async function shareOrDownload(file) {
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return false;
      if (e.name === 'NotAllowedError') return 'retry';
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  return 'downloaded';
}

// ---------- Boot ----------

(async () => {
  try {
    await load();
  } catch (e) {
    app.innerHTML = `<div class="empty-state">This browser won't let the app store data (private browsing?).<br>${esc(e.message)}</div>`;
    return;
  }
  persist();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  checkForUpdate();
})();
