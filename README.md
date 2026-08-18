# TH Cabinets Umbrel App Store

A personal Umbrel Community App Store containing one app, **TH Cabinets**: a
splash page, a showroom photo search tool, and an admin page for uploading and
tagging job photos.

## Structure

```
umbrel-app-store.yml          # store manifest (id + display name)
thcabinets-splash/
  umbrel-app.yml               # app listing (name, tagline, icon, etc.)
  docker-compose.yml           # web service (published image) + app_proxy
  icon.svg                     # app icon shown in the Umbrel dashboard
  app/                          # image build context — this is what CI publishes
    Dockerfile
    package.json
    server.js                    Express app: static hosting + /api/photos
    db.js                        better-sqlite3 schema
    public/
      index.html                 splash page (logo + link to /search.html)
      logo.png
      search.html / search.css / search.js   customer-facing photo search
      admin.html / admin.css / admin.js       upload + tag management (unlinked, direct URL only)
      assets/th-header-banner.png
  data/                          persistent runtime storage only (not code)
    uploads/                      uploaded photo originals + generated thumbnails
    db/                           photos.db (SQLite)
.github/workflows/publish.yml  builds + pushes the image to GHCR on every push to master
```

## How it works

- One Node/Express service (`web`) replaces the old bare-nginx setup — it serves
  the splash page, the search page, the admin page, uploaded photos, and the
  JSON API, all from one container.
- **The backend ships as a published image**, not bind-mounted source. Umbrel's
  update mechanism only re-copies `docker-compose.yml` and a small whitelist of
  files on update — it never re-syncs an app's `data/` folder after first
  install. So application code has to live in a versioned image (referenced by
  tag in `docker-compose.yml`) for updates to actually reach an installed app;
  `data/` is reserved for persistent runtime storage (photos, the database).
- The image is built and pushed to **GHCR** (`ghcr.io/devcal1/thcabinets-web`)
  by [`.github/workflows/publish.yml`](.github/workflows/publish.yml) on every
  push to master that touches `thcabinets-splash/app/**`, using the repo's
  built-in `GITHUB_TOKEN` — no extra accounts or secrets needed. It's built for
  both `linux/amd64` and `linux/arm64`, since we don't assume the Umbrel's
  hardware. The workflow also smoke-tests the built image (boots it, uploads a
  test photo through the real API, edits and deletes it) before publishing.
- `app_proxy` is Umbrel's standard reverse-proxy service — what makes the app
  clickable from the dashboard with authentication handled for you.

## One-time setup after the first push

GHCR packages default to **private**. After the workflow's first run, go to
the package page on GitHub (your profile → **Packages** → `thcabinets-web`) →
**Package settings** → change visibility to **Public**. Umbrel has no way to
authenticate a `docker pull`, so the image has to be public for the app to
install/update.

## Shipping a code update

1. Edit anything under `thcabinets-splash/app/`.
2. Push to master. GitHub Actions rebuilds, smoke-tests, and pushes
   `ghcr.io/devcal1/thcabinets-web:latest`.
3. On the Umbrel, hit **Update** on the TH Cabinets app (or wait for Umbrel's
   own update check) — this pulls the new image and restarts the container.
   Uploaded photos and tags are untouched (they live in `${APP_DATA_DIR}/data`,
   not in the image).

## Install on Umbrel

1. **App Store** → the "⋮" menu → **Community App Stores**.
2. Add: `https://github.com/devcal1/thcabinets-umbrel-store`.
3. Install **TH Cabinets** from the store that appears.
4. Open it from the dashboard — lands on the splash page, with a **View Job
   Photos** button through to the search page.

## Using it

- **`/search.html`** — customer/showroom-facing. Type a keyword, live fuzzy
  search over photo tags, click a photo to see it larger.
- **`/admin.html`** — staff-facing. Upload one or more photos with a shared
  set of comma-separated tags, or edit/delete existing photos in the table
  below. **Not linked from any public page** — bookmark the URL. There's no
  login on it yet (a deliberate, revisitable choice, not an oversight) — if
  that stops being okay, the multi-user login approach already scoped for
  this app (Node + `better-sqlite3` + `bcrypt` + `express-session`) slots in
  as middleware in front of the admin routes without needing to re-architect
  anything.

## Updating the logo

Replace [thcabinets-splash/app/public/logo.png](thcabinets-splash/app/public/logo.png)
with a new file of the same name, then ship a code update (see above). If you
use a different extension, update the `src="logo.png"` references in
`index.html` and `search.html` to match.
