# Damp Tracker

A phone app (PWA) for logging moisture meter readings while you hunt for a leak.
Everything is stored **on the phone** (IndexedDB). There is no server, account or sync.

## How it works

- **Area** (e.g. Stairwell) → numbered **markers**, each with an optional photo. Several markers can share one photo.
- **New round**: pick the date/time and what you're testing ("pipe hose test"), then enter each marker's value on the big keypad.
  **Swipe left/right** (or Save / Skip / Back) to move between markers. A swipe also saves what you typed.
- **▲ wetter / ▼ drier** compares each value with that marker's previous reading.
- **Area page = trend table**: one row per marker, one column per round (oldest left, newest right), coloured, with arrows and a ▲/▼ count per round,
  so you can see what each experiment did.
- **Marker page**: chart over time with experiment notes marked, plus history. Swipe to the next marker.
  Tap a photo for full screen: pinch or double-tap to zoom, swipe between photos.
- Colours (meter in WALL mode): green under 8%, yellow 8–11.9%, red 12%+. You can change these in ⚙ Settings.

## Backups

Data lives only in the phone's browser, so use **⚙ → Save backup to Drive…** now and then and pick **Drive** in the share menu.
The backup is a `.txt` file (JSON inside), because Chrome on Android won't share `.json` files.
**Restore from backup file** (pick it from Drive in the file picker) puts everything back, photos included, on this phone or a new one.
**Export readings as CSV** gives a spreadsheet.

Add the app to your home screen. That also tells the browser to keep its data.

## Files

`docs/` is the whole app (plain HTML/CSS/JS, no build step), ready for GitHub Pages ("Deploy from branch → /docs").

```bash
node scripts/serve.mjs   # try it locally on http://localhost:8080
```

`Source images/` (your house photos) is git-ignored so it never gets published.

## Releasing a change

1. Bump `const VERSION = 'vX.Y'` at the top of `docs/app.js` (it shows at the bottom of the home screen).
2. Push to `main`. GitHub Pages republishes in about a minute.
3. The app checks the live version whenever it opens or comes back to the front, skipping all caches, and reloads itself.
   If you're mid-round or editing, it shows a "New version ready" bar instead, so nothing typed is lost.
   Tap the version number to check by hand.
