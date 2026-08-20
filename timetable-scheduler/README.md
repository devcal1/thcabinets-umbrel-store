# TH Cabinets — Fortnightly Schedule Builder (prototype)

A working prototype for building colour-coded fortnightly timetables, based on the
`th_cabinets_schedule_v9_dark.pdf` mockup. Pure HTML/CSS/JS — no build step, no
dependencies.

## Running it

**Quick look (static):**
Open `index.html` directly in a browser. Good enough to see the layout, but some
browsers restrict `localStorage`/scripts for `file://` pages.

**Full interactive preview (recommended):**
```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```
Then open http://localhost:8791/ — this runs a tiny dependency-free static file
server (pure .NET `HttpListener` via PowerShell, since this machine has no
Python/Node on PATH).

## What it does

- 14-column grid: Monday–Sunday × Week A / Week B, sticky headers and sticky
  time gutter.
- 5:00am–10:00pm range in 30-minute slots (`app.js` → `START_HOUR`/`END_HOUR`
  constants — trivial to extend to midnight later).
- Task palette (top bar): click a task to arm it as the active "pen", then
  click-drag on any day column to paint a block in that colour.
- **Move** a block: drag its middle — including across to a different day
  column, not just up/down within the same day.
- **Resize** a block: drag its top or bottom edge.
- **Copy Week A → Week B**: one click replaces every Week B block with a
  copy of the matching Week A day (handy since fortnights are usually near-
  identical, with a few days tweaked).
- **Delete** a block: hover it and click the × in the corner, or select it
  (click) and press Delete/Backspace.
- Blocks can't overlap another block in the same day column — drags/resizes/
  new blocks are clamped to the free space around them automatically.
- **+ Add Task**: name + colour picker. Click the pencil on any chip to
  rename/recolour it, or delete it (cascades to remove blocks using it, with
  confirmation).
- **Export/Import JSON**: since data only lives in this browser's
  `localStorage`, use Export to back up a schedule or move it to another
  browser/machine, Import to load one back in.
- **Clear All**: wipes blocks (keeps your task list).

Data is saved to `localStorage` under the key `th_timetable_v1` after every
change — no server, no account, nothing to configure.

## Known limits / good next steps

- Single browser only (localStorage). A small backend (JSON file or SQLite,
  similar to `thcabinets-splash/app`) would let the schedule be reached from
  multiple devices.
- No undo — deletes and the "Copy Week A → B" overwrite are immediate (the
  copy button does confirm first). Export JSON periodically as a backup.
- No print/PNG export matching the original PDF mockup's layout — could be
  added with a print stylesheet or a canvas-based export.
- Touch support is untested (pointer events are used throughout, which should
  mostly work on tablets, but hover-only affordances like the delete × would
  need a tap-to-reveal treatment).
