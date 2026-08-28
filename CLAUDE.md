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

## Current state (as of 2026-08-28)

- Manifest **1.7.0** (bug-fix round across schedule board, photos, CI, and
  Dockerfile — not yet pushed/verified by CI at time of writing).
- Repo was deleted and recreated 2026-08-27 for a fresh start, with
  `joinery-quoter/` stripped from history via `git filter-repo`. **Commit hashes
  from before that date resolve to nothing** — don't cite them. Older GHCR tags
  (`sha-dd06108…` etc.) are orphaned but harmless.
- **CI red root cause found: GHCR write access, not caching.** Both runs on the
  recreated repo failed at "Build and push multi-arch image" with
  `denied: permission_denied: write_package` (visible in the check-run
  annotations). The `thcabinets-web` package survived the 2026-08-27 repo
  deletion, but its Actions-access grant pointed at the *old* repo, so the new
  repo's `GITHUB_TOKEN` can't push. **No run on the recreated repo has ever
  published** — `sha-1269d7a`/`sha-992a169` don't exist on GHCR; `:latest` is
  still the pre-recreation image (same app content by luck: 1269d7a was
  workflow-only). The earlier "publish succeeded, suspected cache-export
  failure" note was a misdiagnosis. Fix (owner, in browser): package settings →
  https://github.com/users/devcal1/packages/container/thcabinets-web/settings →
  Manage Actions access → add `devcal1/thcabinets-umbrel-store` with **Write**,
  then re-run the failed workflow. Don't delete/recreate the package instead —
  the Umbrel pulls `:latest` from it. The `ignore-error=true` on `cache-to:` is
  kept (harmless, and cache-service flakes remain possible). Build, version
  guard, and the extended smoke test all pass — 1.7.0 is ready to publish the
  moment access is granted.

## Known issues / deferred

- `/admin.html` **is** linked from [index.html:121](thcabinets-splash/app/public/index.html:121),
  though the README and admin.html itself both claim it's unlinked. Unlinked-ness
  is the only access control on admin — decide which is true.
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
- No auth on `/admin.html` or `/workers.html` — intentional for now. A login
  design (bcrypt + `express-session`) was scoped but not built.
- AI tag suggestions need a free Gemini key at `data/config/gemini-api-key` on the
  Umbrel; degrades gracefully without one.
