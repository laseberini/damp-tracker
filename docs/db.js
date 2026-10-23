// All data lives on this device, in IndexedDB. Nothing is sent anywhere.
//   store 'kv'     → key 'state': { areas, markers, rounds, settings }
//   store 'photos' → image Blobs keyed by photo id
//
// area   { id, name }
// marker { id, areaId, num, name, photoId }
// round  { id, areaId, at: 'YYYY-MM-DDTHH:MM' (local), note, values: { [markerId]: number } }

export const DEFAULT_NOTES = ['after 2 days rain', 'pipe hose test', 'window hose test', 'dry day'];

export const S = {
  areas: [],
  markers: [],
  rounds: [],
  settings: { yellow: 8, red: 12, notes: [...DEFAULT_NOTES], lastBackup: null },
};

const photoUrls = new Map(); // photo id → object URL

export const uid = () =>
  crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- IndexedDB ----------

let dbp;
function idb() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('damp-tracker', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('photos');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export async function load() {
  const saved = await tx('kv', 'readonly', (s) => s.get('state'));
  if (saved) Object.assign(S, saved, { settings: { ...S.settings, ...saved.settings } });
  const [keys, blobs] = await Promise.all([
    tx('photos', 'readonly', (s) => s.getAllKeys()),
    tx('photos', 'readonly', (s) => s.getAll()),
  ]);
  const used = new Set(S.markers.map((m) => m.photoId));
  for (let i = 0; i < keys.length; i++) {
    // Drop photos added on an edit screen that was never saved.
    if (!used.has(keys[i])) await tx('photos', 'readwrite', (s) => s.delete(keys[i]));
    else photoUrls.set(keys[i], URL.createObjectURL(blobs[i]));
  }
}

export const save = () => tx('kv', 'readwrite', (s) => s.put(S, 'state'));

// Ask the browser not to clear our storage when space runs low.
export async function persist() {
  try {
    return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

// ---------- Photos ----------

export async function addPhoto(blob) {
  const id = uid();
  await tx('photos', 'readwrite', (s) => s.put(blob, id));
  photoUrls.set(id, URL.createObjectURL(blob));
  return id;
}

export const photoSrc = (id) => (id && photoUrls.get(id)) || '';

export async function dropPhotoIfUnused(id) {
  if (!id || S.markers.some((m) => m.photoId === id)) return;
  await tx('photos', 'readwrite', (s) => s.delete(id));
  URL.revokeObjectURL(photoUrls.get(id));
  photoUrls.delete(id);
}

// ---------- Lookups ----------

export const area = (id) => S.areas.find((a) => a.id === id);
export const marker = (id) => S.markers.find((m) => m.id === id);
export const markersOf = (areaId) => S.markers.filter((m) => m.areaId === areaId).sort((a, b) => a.num - b.num);
export const roundsOf = (areaId) => S.rounds.filter((r) => r.areaId === areaId).sort((a, b) => a.at.localeCompare(b.at));

// Every value recorded for a marker, oldest first.
export function history(markerId) {
  const m = marker(markerId);
  if (!m) return [];
  return roundsOf(m.areaId)
    .filter((r) => r.values[markerId] != null)
    .map((r) => ({ round: r, value: r.values[markerId] }));
}

// The marker's value from the round before `round` (by date).
export function previous(markerId, round) {
  let prev = null;
  for (const r of roundsOf(round.areaId)) {
    if (r.id === round.id || r.at > round.at) continue;
    if (r.values[markerId] != null) prev = { round: r, value: r.values[markerId] };
  }
  return prev;
}

export function level(v) {
  if (v == null || Number.isNaN(v)) return null;
  return v >= S.settings.red ? 'wet' : v >= S.settings.yellow ? 'damp' : 'dry';
}

// Notes to offer as chips: saved ones first, then any used on past rounds.
export function allNotes() {
  const notes = [...S.settings.notes];
  for (const r of [...S.rounds].reverse()) if (r.note && !notes.includes(r.note)) notes.push(r.note);
  return notes;
}

// ---------- Deletes ----------

export async function deleteMarker(id) {
  const m = marker(id);
  S.markers = S.markers.filter((x) => x.id !== id);
  for (const r of S.rounds) delete r.values[id];
  await save();
  await dropPhotoIfUnused(m?.photoId);
}

export async function deleteArea(id) {
  const photos = S.markers.filter((m) => m.areaId === id).map((m) => m.photoId);
  S.markers = S.markers.filter((m) => m.areaId !== id);
  S.rounds = S.rounds.filter((r) => r.areaId !== id);
  S.areas = S.areas.filter((a) => a.id !== id);
  await save();
  for (const p of photos) await dropPhotoIfUnused(p);
}

// ---------- Backup ----------

const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

export async function backupFile() {
  const [keys, blobs] = await Promise.all([
    tx('photos', 'readonly', (s) => s.getAllKeys()),
    tx('photos', 'readonly', (s) => s.getAll()),
  ]);
  const photos = {};
  for (let i = 0; i < keys.length; i++) photos[keys[i]] = await toDataUrl(blobs[i]);
  const data = { app: 'damp-tracker', version: 1, exportedAt: new Date().toISOString(), state: S, photos };
  const day = new Date().toISOString().slice(0, 10);
  return new File([JSON.stringify(data)], `damp-tracker-backup-${day}.json`, { type: 'application/json' });
}

// Replaces everything on this device with the contents of a backup file.
export async function restore(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'damp-tracker' || !data.state) throw new Error('That is not a Damp Tracker backup file.');
  await tx('photos', 'readwrite', (s) => s.clear());
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
  for (const [id, dataUrl] of Object.entries(data.photos || {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await tx('photos', 'readwrite', (s) => s.put(blob, id));
    photoUrls.set(id, URL.createObjectURL(blob));
  }
  S.areas = data.state.areas || [];
  S.markers = data.state.markers || [];
  S.rounds = data.state.rounds || [];
  S.settings = { ...S.settings, ...data.state.settings };
  await save();
}
