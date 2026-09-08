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
| `thcabinets-splash/data/` | persistent runtime volumes ONLY — uploads, db, gemini key |
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
   appear in exports. This has caused a real bug before.

## Shipping a change

1. Edit under `thcabinets-splash/app/`.
2. Bump `version:` in `umbrel-app.yml`.
3. Push to `master` → CI builds, runs a real smoke test against a live container
   (photos + schedule APIs), then publishes multi-arch (amd64 + arm64) to GHCR.
4. Hit **Update** on the Umbrel dashboard.

**Verification:** lean on the CI smoke test rather than building local
mock-server rigs. Spot-check builds; go deep only for changes touching stored
schedule data or anything else with production-data risk.

## Current state (as of 2026-09-07)

- **Uncommitted WIP in the working tree** (predates the 1.7.x releases and was
  deliberately kept out of them): a `GET /api/tags` endpoint in `server.js`
  plus admin filter-bar work in `admin.html`/`admin.js`/`admin.css` and
  `search.css`. Unreviewed — never let it ride along in an unrelated commit;
  it ships as its own reviewed release or not at all.
- Manifest **1.7.3, pushed 2026-09-08** (frontend-only: schedule.js/css):
  dates now render Australian — week heading `7/9/26 – 11/9/26` (client
  `fmtAU`, d/m/yy no zero-pad, built from `week.start`; the server's
  `week.label` is now deliberately unused), day headers `MON 7/9`. Weeks are
  separated harder: `.week-section` gets a 4px accent `border-top` and doubled
  bottom margin, and `.week-head` is `position: sticky` at `top: var(--nav-h)`
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
  though the README and admin.html itself both claim it's unlinked. Since 1.7.1
  the Umbrel login properly gates admin at the proxy (the auth whitelist exempts
  only schedule routes), so unlinked-ness no longer carries any security weight —
  what remains is fixing the stale README/admin.html copy.
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
  with `npm install --package-lock-only` (needs npm; not available on the
  Windows dev machine), verify it pins `@img/sharp-linuxmusl-x64` **and**
  `-arm64`, switch the Dockerfile to `npm ci --omit=dev`.
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
