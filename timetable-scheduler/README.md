# TH Cabinets — Fortnightly Schedule Builder (prototype)

A working prototype for building colour-coded fortnightly timetables, based on the
`th_cabinets_schedule_v9_dark.pdf` mockup. Pure HTML/CSS/JS — no build step, no
dependencies.

## Team distribution (OneDrive)

This copy lives in the shared OneDrive folder (`Admin Docs/Fortnightly Scheduler`)
so the whole team can reach it. Each person keeps their **own** schedule:

- The app files (`index.html`, `style.css`, `app.js`) are shared/synced — everyone
  runs the same tool.
- Each person's actual timetable data lives only in **their own browser's
  `localStorage`**, keyed on their machine — it is *not* stored in these files and
  does not sync between people. That's intentional: 5 people opening the same
  `index.html` each get their own independent schedule.
- To back up or hand a schedule to someone else, use **Export JSON** → send the
  file → they use **Import JSON**.
- Because it's opened via `file://`, use Chrome or Edge (both support
  `localStorage` on local files). Right-click `index.html` → Open with → your
  browser, then bookmark the page for next time.

## Running it

**From OneDrive (how the team uses it):**
Double-click `index.html`, or open it from a browser (Ctrl+O). Everything
works from the file directly — no server needed for day-to-day use.

**Full local dev preview (only needed if you're changing the code):**
```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```
Then open http://localhost:8791/ — a tiny dependency-free static file server
(pure .NET `HttpListener` via PowerShell, since this machine has no
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
- **Export JPG**: renders the current schedule (grid, colours, legend) to a
  downloadable image — drawn straight from your data, not a screenshot, so
  it stays crisp at any size.
- **Export PDF**: opens the browser's print dialog with a print-friendly
  layout (chrome/buttons hidden, full grid shown) — choose "Save as PDF" as
  the destination. Works the same in Chrome/Edge.
- **Export/Import JSON**: the underlying data backup/transfer format — use
  Export to back up a schedule or hand it to a teammate, Import to load one
  back in.
- **Clear All**: wipes blocks (keeps your task list).

Data is saved to `localStorage` under the key `th_timetable_v1` after every
change.

## Known limits / good next steps

- Per-browser only (localStorage) by design for this team — see
  "Team distribution" above. If a real shared/synced board is ever wanted
  instead, that needs a small backend (JSON file or SQLite, similar to
  `thcabinets-splash/app`).
- No undo — deletes and the "Copy Week A → B" overwrite are immediate (the
  copy button does confirm first). Export JSON periodically as a backup.
- Touch support is untested (pointer events are used throughout, which should
  mostly work on tablets, but hover-only affordances like the delete × would
  need a tap-to-reveal treatment).
