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

## Current state (as of 2026-08-27)

- Manifest **1.6.1**, HEAD `1269d7a`.
- Repo was deleted and recreated 2026-08-27 for a fresh start, with
  `joinery-quoter/` stripped from history via `git filter-repo`. **Commit hashes
  from before that date resolve to nothing** — don't cite them. Older GHCR tags
  (`sha-dd06108…` etc.) are orphaned but harmless.
- **CI is red.** The only run on the new repo failed at step 8 "Build and push
  multi-arch image" — but the publish *succeeded* (`:latest` and
  `sha-1269d7a…` share digest `sha256:0c6e9fdc…`, multi-arch, public, pullable).
  Suspected GHA cache-export failure after the push; unconfirmed, reading the log
  needs repo admin. Likely one-line fix: `cache-to: type=gha,mode=max,ignore-error=true`.

## Known issues / deferred

- `/admin.html` **is** linked from [index.html:121](thcabinets-splash/app/public/index.html:121),
  though the README and admin.html itself both claim it's unlinked. Unlinked-ness
  is the only access control on admin — decide which is true.
- [tokens.css:6](thcabinets-splash/app/public/tokens.css:6) still `@import`s Inter
  from Google Fonts — render-blocking on a LAN with no internet, despite Phosphor
  and fuse.js having been vendored for exactly that reason.
- `DELETE /api/rows/:id` doesn't clean up `day_flags`; orphans accumulate.
  Harmless (`AUTOINCREMENT` prevents id reuse) but a real leak.
- Splitting `server.js` into route modules — scoped, not done. Flagged as the one
  refactor with real operational risk (a `Dockerfile COPY` mistake takes the live
  board down), so it should be its own isolated, verified change.
- No auth on `/admin.html` or `/workers.html` — intentional for now. A login
  design (bcrypt + `express-session`) was scoped but not built.
- AI tag suggestions need a free Gemini key at `data/config/gemini-api-key` on the
  Umbrel; degrades gracefully without one.
