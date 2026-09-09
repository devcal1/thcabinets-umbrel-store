# TH Cabinets — Umbrel Community App Store

Personal Umbrel community app store containing one real app: **TH Cabinets**, a
self-hosted web app run on the owner's Umbrel for the day-to-day operations of a
joinery/cabinet-making business. Node/Express + `better-sqlite3`; plain
HTML/CSS/JS frontend with **no build step and no framework** (deliberate).

- **Repo**: https://github.com/devcal1/thcabinets-umbrel-store (branch `master`)
- **Image**: `ghcr.io/devcal1/thcabinets-web:latest` — [package](https://github.com/users/devcal1/packages/container/package/thcabinets-web)
- **CI**: [.github/workflows/publish.yml](.github/workflows/publish.yml)

## Layout

App code lives in [thcabinets-splash/](thcabinets-splash/); read files from there
directly rather than asking for uploads.

| Path | What |
|---|---|
| [umbrel-app.yml](thcabinets-splash/umbrel-app.yml) | manifest — name, tagline, **`version:`**, release notes |
| [docker-compose.yml](thcabinets-splash/docker-compose.yml) | `web` service (published image) + Umbrel `app_proxy` |
| [app/](thcabinets-splash/app/) | Docker build context — what CI publishes |
| [app/server.js](thcabinets-splash/app/server.js) | all API routes: photos + schedule, one file |
| [app/db.js](thcabinets-splash/app/db.js) | SQLite schema + first-run worker seed |
| [app/public/](thcabinets-splash/app/public/) | 5 pages: index, search, admin, schedule, workers |
| [app/public/shared.js](thcabinets-splash/app/public/shared.js) | `api()` / `toast()` / `guarded()` / `hueColors()` |
| [app/public/tokens.css](thcabinets-splash/app/public/tokens.css) | only genuinely-shared design tokens |
| `thcabinets-splash/data/` | persistent runtime volumes ONLY — uploads, db, gemini key; git-ignored except the `.gitkeep`s |
| [archive/timetable-scheduler/](archive/timetable-scheduler/) | superseded prototype, ignore |

`joinery-quoter/` at the repo root is an **empty untracked shell** — its files and
history were removed 2026-08-27. It is not part of this project.

## Non-negotiables

1. **Bump `version:` in [umbrel-app.yml](thcabinets-splash/umbrel-app.yml) on every
   app-code change.** Umbrel compares that field; without a bump the dashboard
   shows no Update button and the change never reaches the device.
2. **The backend ships as a published image, not bind-mounted source.** Umbrel
   never re-syncs `data/` after first install, so code must live in a versioned
   image. `data/` is persistent storage only.
3. **Never rename `photos.db`.** Despite the name it holds the *entire live
   schedule* (`workers`/`jobs`/`week_rows`/`assignments`/`day_flags`). A rename
   without migration orphans real production data, and the seed block silently
   recreates a blank 6-worker roster, masking the loss.
4. **`schedule.html` holds real production data** — it replaced a physical
   whiteboard and runs on a workshop TV. Frontend/CSS/JS iteration is fine.
   Anything touching stored data (schema, migrations, bulk/delete queries) needs
   explicit data-loss reasoning and owner confirmation first.
5. **Never uninstall/reinstall the app** without explicit confirmation. Normal
   Umbrel "Update" preserves photos and schedule; uninstall wipes everything.
6. **Don't introduce a build step, framework, or bundler.** Deliberate choice.
7. **Page-local CSS is deliberate, not drift.** `--color-bg` and the spacing /
   radius scales are redeclared per page on purpose — `schedule.css` runs ~1.2x
   for TV legibility, `admin.css` is intentionally darker/purpler as an internal
   tool. Those files carry "don't fix this" comments; honour them.
8. **The JPG export is hand-drawn to canvas**, not a DOM screenshot — see
   `exportJpg()` in [schedule.js](thcabinets-splash/app/public/schedule.js). Any
   new visual element on the board must be mirrored there or it silently won't
   appear in exports. This has caused a real bug before. Currently mirrored:
   shared line heights + the orange notes dot (1.7.2), AU dates + the per-week
   accent rule (1.7.3), and the **two-row column-major chip grid** (1.8.0) —
   chip layout lives in two places (`.sched-chips` / `rowEl` and `exportJpg`'s
   `CHIP_ROWS` block) and both must change together. `alignPanels()` is shared
   by `renderWeeks()` and `exportJpg()`; keep both callers on it.
9. **Prefer extending `PATCH /api/rows/:id/move` over adding a route.** The
   schedule board is ungated via `PROXY_AUTH_WHITELIST`, which matches paths
   (`/api/rows/*`) — a brand-new API path silently 302s the workshop TV to the
   login until it's whitelisted in `docker-compose.yml`. That endpoint already
   multiplexes three modes on the request body (`direction` / `toIndex` /
   `week`) for exactly this reason. Same trap class as rule 8.

## Shipping a change

1. Edit under `thcabinets-splash/app/`.
2. Bump `version:` in `umbrel-app.yml`.
3. Push to `master` → CI builds, runs a real smoke test against a live container
   (photos + schedule APIs), then publishes multi-arch (amd64 + arm64) to GHCR.
4. Hit **Update** on the Umbrel dashboard.

**Verification:** lean on the CI smoke test rather than building local
mock-server rigs. Spot-check builds; go deep only for changes touching stored
schedule data or anything else with production-data risk.

## Current state (as of 2026-09-09)

- **Uncommitted WIP in the working tree** (predates the 1.7.x releases and was
  deliberately kept out of them, and out of 1.8.0): a `GET /api/tags` endpoint
  in `server.js` plus admin filter-bar work in
  `admin.html`/`admin.js`/`admin.css` and `search.css` — 102 insertions / 12
  deletions across 5 files. Unreviewed — never let it ride along in an
  unrelated commit; it ships as its own reviewed release or not at all.
  **`server.js` is the collision point** — 1.8.0 also edits it, so that file
  needed a selective stage. `git add -p` is interactive and unavailable in the
  Claude Code Bash tool, so the working method is: `git diff -- <file>` to a
  patch, drop the WIP hunk, `git apply --cached --recount`. Two traps found
  doing it: MSYS rewrites an argument containing `/api/tags` into
  `C:/Program Files/Git/api/tags` (use a marker with no leading slash), and the
  staged blob must be syntax-checked via `git show :<path>` before committing,
  because CI builds the commit and not the working tree.
  Known gaps in the WIP itself, if it's ever picked up: the tag chips load once
  at boot and never refresh (counts go stale after an upload, delete or inline
  tag edit), and `appendTag` updates the DOM field but not the cached
  `allPhotos` entry, so filtering after an inline edit matches stale tags.
- Manifest **1.8.0, published 2026-09-09** (`6f2418b`; schedule.js/css +
  server.js + CI; multi-arch `sha256:bd07b8bc…` on GHCR, `:latest` verified
  pointing at it; owner Update on the device pending at hand-off). The board
  shows **one week at a time** — `loadSchedule` slices `data.weeks` to
  `[0]`; `/api/schedule` still returns the fortnight deliberately (it's on
  the ungated whitelist, and everything downstream loops over `state.weeks`,
  so restoring two weeks is that one line). `main` max-width 1416→1860px for
  the 1920x1080 laptop/TV. Worker chips are a **column-major 2-row grid**
  (`.sched-chips`, `grid-auto-flow: column`, `grid-auto-columns: minmax(0,1fr)`;
  the row count is set inline per cell in `rowEl` so a single-chip cell can't
  inherit an empty track's gap): 2nd under 1st, 3rd beside 1st, 4th under 3rd.
  Cells with 3+ chips get `.crowded` — tighter padding and the `×` absolutely
  positioned so it costs no width (at ~63px/column the chrome left 25px for a
  name needing 53px, so "Shooter" rendered as "S…"); 1–2 chip cells are
  untouched. Rows **drag to reorder** within their own panel via a grip handle
  (the up/down arrow buttons are gone); cross-panel drops are refused so an
  installing row's `day_flags` can never land on a manufacturing row. Two
  buttons **move a row a week** either way. `alignPanels` now anchors on
  **normalised job name**, not `jobId`, so the same job typed separately into
  each panel lines up (a strict superset of the old behaviour). Also fixed:
  `ph-flag-fill` drew an empty glyph — the vendored Phosphor build is regular
  weight only with **no fill variants** — so the active flag button had been
  blank on the live board. All mirrored in `exportJpg` (chip column grid,
  `dayW` 132→150). No new asset or API paths, so the auth whitelist is
  unchanged. **Two new invariants, same class as rule 8** — see the additions
  under Non-negotiables.
- Manifest **1.7.3, published 2026-09-08** (frontend-only: schedule.js/css;
  CI run #5 green, multi-arch on GHCR; **superseded on-device by 1.8.0**,
  which carries it — if the owner never ran the 1.7.3 Update, 1.8.0 delivers
  both):
  dates now render Australian — week heading `7/9/26 – 11/9/26` (client
  `fmtAU`, d/m/yy no zero-pad, built from `week.start`; the server's
  `week.label` is now deliberately unused), day headers `MON 7/9`. Weeks are
  separated harder: `.week-section` gets a 4px accent `border-top` and doubled
  bottom margin (the doubling was reverted in 1.8.0 — with one week on screen
  it was just dead space; the accent border and sticky head stayed), and
  `.week-head` is `position: sticky` at `top: var(--nav-h)`
  so the week's dates stay pinned while scrolling. `--nav-h` is measured
  (`nav.offsetHeight`) inside `syncRowHeights` (render/resize/fonts-ready) — a
  fixed-width TV gets the right value at boot. Print: week-head reverts to
  static and each week gets `break-before: page`. All mirrored in `exportJpg`
  (AU date strings + a 2px accent rule per week). Verified incl. Dec→Jan year
  rollover; no new assets/API paths so the auth whitelist is unchanged.
- Manifest **1.7.2, published & live 2026-09-07** (frontend-only:
  schedule.js/css; CI run #4 green, owner ran Update on the device): per
  week the manufacturing/installing panels align — a job in both sits on the
  same line (`alignPanels()` LCS on jobIds, blank `.row-blank` padding,
  `syncRowHeights()` measured pairing) — and the notes icon shows orange
  (`.has-notes`) when a job has notes. **New mirror invariant, same class as
  rule 8:** `alignPanels()` is shared by `renderWeeks()` and `exportJpg()` —
  any change to board line structure must keep both callers on it. The orange
  icon mirrors as an orange dot in the JPG and a print-only "● note" marker;
  a `@media print and (max-width: 900px)` guard stops the inline synced
  heights bleeding into portrait prints (page box < 900px stacks the panels).
  No new assets or API paths, so the 1.7.1 auth whitelist needed no change.
  Known accepted quirk: with alignment on, a move up/down can visually shift
  the partner panel's rows or re-anchor lines rather than moving one line —
  data-correct, inherent to alignment.
- Manifest **1.7.1, published & live 2026-09-07** (compose + manifest only, no
  app code; superseded on-device by the 1.7.2 update, which carries it):
  `PROXY_AUTH_WHITELIST`/`PROXY_AUTH_BLACKLIST` on the `app_proxy` service open
  the schedule board — view **and** edit, the whiteboard trust model — to the
  LAN with no Umbrel login; index/search/admin/workers and all photo APIs stay
  gated. Verified against Umbrel proxy source (0.5.x–2.0; honored via normal
  Update). Accepted leak: `POST /api/workers` is ungated (shares its exact path
  with the GET the board needs; rules match paths, not methods). **Maintenance
  trap:** any new asset or API path the schedule page starts using must be
  appended to the whitelist in docker-compose.yml or the TV silently breaks —
  same class as the exportJpg mirror rule. The TV must bookmark
  `/schedule.html` directly; the default landing page stays behind the login.
  Unauthenticated requests to gated routes get a 302 to the auth page (port
  2000), surfacing in the UI as a "Failed to fetch"-style toast, not a 401.
- Manifest **1.7.0, published.** CI went green on run #2 attempt 3
  (2026-08-28): `sha-992a169`/`:latest` are live on GHCR, multi-arch. Attempt 2
  of the same run stalled ~2h on the multi-arch step and had to be cancelled —
  the stall is real and recurring; if it keeps biting, the durable fix is
  building each arch natively (`ubuntu-24.04-arm` runners are free for public
  repos) instead of QEMU, as its own isolated change.
- Repo was deleted and recreated 2026-08-27 for a fresh start, with
  `joinery-quoter/` stripped from history via `git filter-repo`. **Commit hashes
  from before that date resolve to nothing** — don't cite them. Older GHCR tags
  (`sha-dd06108…` etc.) are orphaned but harmless.
- **GHCR write-access incident (resolved 2026-08-28), kept for its lessons:**
  after the repo recreation, the `thcabinets-web` package's Actions-access
  grant still pointed at the old repo, so every push failed with
  `denied: permission_denied: write_package` — first misdiagnosed as a
  cache-export flake. Owner re-granted Write and 1.7.0 published. Standing
  rules: **never delete/recreate the GHCR package** (the Umbrel pulls
  `:latest` from it), read the check-run annotations before theorising about
  a red run, and verify publishes against GHCR digests, not step ticks.

## Known issues / deferred

- `/admin.html` **is** linked from [index.html:121](thcabinets-splash/app/public/index.html:121),
  though [admin.html:12](thcabinets-splash/app/public/admin.html:12) still tells
  the reader "Not linked publicly — bookmark this page." Since 1.7.1 the Umbrel
  login gates admin at the proxy (the auth whitelist exempts only schedule
  routes), so unlinked-ness carries no security weight — this is purely stale
  copy. The README half was corrected 2026-09-09; the admin.html half is app
  code, so it needs a version bump to ship and is currently entangled with the
  uncommitted `/api/tags` WIP in that same file. Fold it into whatever release
  carries that WIP rather than spending a release on one sentence.
- Row dragging (1.8.0) uses **HTML5 drag-and-drop**, which needs a mouse — it
  does nothing on a touchscreen. Fine for the current setup (a laptop driving
  the TV), but if a touch panel ever goes in the workshop the drag needs
  redoing on pointer events. The server side is already generic: the endpoint
  takes an arbitrary `toIndex`, so only the DOM wiring would change.
- [tokens.css:6](thcabinets-splash/app/public/tokens.css:6) still `@import`s Inter
  from Google Fonts — render-blocking on a LAN with no internet, despite Phosphor
  and fuse.js having been vendored for exactly that reason. Vendoring Inter's
  woff2 files (like Phosphor) is the fix; needs the font files downloaded.
- Historical `day_flags` orphans from before 1.7.0 still sit in the production
  DB (the row-delete now cleans up after itself). The one-time sweep
  `DELETE FROM day_flags WHERE week_row_id NOT IN (SELECT id FROM week_rows)` is
  safe by the same unreachability reasoning but is a bulk delete on live data —
  owner sign-off required, run it only deliberately.
- No `package-lock.json` — every image build resolves deps fresh, so the tested
  amd64 image and the published arm64 image can silently differ. Generate one
  with `npm install --package-lock-only` (node v24 + npm 11 ARE installed on
  the Windows dev machine as of 2026-09-09 — this is unblocked), verify it
  pins `@img/sharp-linuxmusl-x64` **and** `-arm64`, switch the Dockerfile to
  `npm ci --omit=dev`.
- `GET /api/schedule` with no `?week=` computes "today" in UTC, so it returns
  last week as `weeks[0]` on Monday mornings AEST. Unreachable via the shipped
  frontend (it always sends `?week=`); fixing the default needs the owner to
  confirm the business timezone first.
- Bulk import groups files sitting loose in the picked folder's root under the
  root folder's own name, while the UI copy says each *sub*folder becomes a tag.
  Visible/editable in the review table, so left alone — fixing it naively breaks
  the pick-a-single-job-folder shortcut. Decide the intended behavior first.
- Splitting `server.js` into route modules — scoped, not done. The old
  extra risk (an enumerated `Dockerfile COPY` silently dropping a new file) is
  gone since the Dockerfile now copies the whole build context, but it should
  still be its own isolated, verified change.
- No app-level auth on `/admin.html` or `/workers.html` — intentional for now,
  and since 1.7.1 the Umbrel login gates them at the proxy anyway (only the
  schedule board is deliberately ungated and LAN-editable). A login design
  (bcrypt + `express-session`) was scoped but not built.
- AI tag suggestions need a free Gemini key at `data/config/gemini-api-key` on the
  Umbrel; degrades gracefully without one.
