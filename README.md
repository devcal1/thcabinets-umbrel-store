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
    server.js                    Express app: static hosting + /api/photos + /api/schedule etc.
    db.js                        better-sqlite3 schema (photos + schedule tables)
    public/
      index.html                 splash page (links to search / admin / schedule)
      logo.png
      search.html / search.css / search.js   customer-facing photo search
      admin.html / admin.css / admin.js       upload + tag management
      schedule.html / schedule.css / schedule.js   live manufacturing/installing schedule board
      workers.html / workers.js               worker roster + chip colour management
      assets/th-header-banner.png
  data/                          persistent runtime storage only (not code)
    uploads/                      uploaded photo originals + generated thumbnails
    db/                           photos.db + schedule tables (SQLite, one file)
    config/                       gemini-api-key (optional, see "AI tag suggestions" below)
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
  search over photo tags, click a photo to see it larger. Deliberately
  read-only and chrome-free (no edit controls), per the original design brief.
- **`/admin.html`** — staff-facing. It *is* linked from the landing page, and
  is gated by the Umbrel login at the app proxy (only the schedule board is
  deliberately exempt — see the auth whitelist in `docker-compose.yml`). There
  is no *app-level* login on it (a deliberate, revisitable
  choice, not an oversight) — if that stops being okay, the multi-user login
  approach already scoped for this app (Node + `better-sqlite3` + `bcrypt` +
  `express-session`) slots in as middleware in front of the admin routes
  without needing to re-architect anything. It has three parts:
  - **Upload** — pick one or more photos (shows thumbnail previews of what
    you selected so you can see them while typing tags) and one shared,
    comma-separated tag string applied to the whole batch. **Suggest tags
    from photos** sends the selected photo(s) to Gemini and offers the result
    as clickable chips — click one to add it to the tag field, nothing is
    added automatically. Only works once a Gemini API key is set up (see
    below); without one it just tells you it's not configured yet, everything
    else keeps working.
  - **Bulk import from a folder** — pick a folder containing one subfolder
    per category (matching how job photos are actually organized on disk,
    e.g. `Hamptons Kitchen/`, `Laundry/`). Each subfolder is auto-detected as
    a tag group (folder name → tag, lowercased) with a review step — tick
    which folders to import, edit any tag text, before anything uploads.
    Unsupported files (videos, etc.) and anything over the size limit are
    skipped with a reason shown. Reusable for every future finished job, not
    just a one-off import.
  - **Manage** — the table below lists every uploaded photo. The tags field
    replaces the whole tag string on edit; the small "add a tag" box next to
    it appends one or more tags without touching what's already there
    (skips exact duplicates, case-insensitive). Each row also has its own
    **Suggest tags** button — same Gemini flow as the upload form, but for a
    photo that's already been uploaded, so you can go back and fill in tags
    on older photos without re-uploading them.

- **`/schedule.html`** — staff-facing live schedule, replacing the whiteboard.
  One week is shown at a time, filling the width of the screen (browse to any
  past/future week with the arrows or the date picker — it always snaps to the
  Monday of whichever date you pick). The week has a Manufacturing and an
  Installing panel, jobs as rows, Mon–Fri as columns. A job that appears in
  both panels sits on the same line whenever the two rows share a name:
  - **Add a job** — type a name in the box under either panel and hit
    **+ Add**. Typing a name that already exists (autocomplete suggests it)
    reuses that job, so the same job can have rows in both Manufacturing and
    Installing, or across different weeks, while sharing one name/notes.
  - **Assign a worker to a day** — click the dashed **+** in that day's
    cell and pick a name; click the **×** on a chip to remove it. Chips stack
    two deep and then start a new column, so a third and fourth worker sit
    beside the first and second rather than making the row twice as tall. In
    those crowded cells the **×** appears when you hover the chip.
  - **Rename a job** — click its name and type; saves on Enter/blur.
  - **Notes** — the pencil icon expands a per-job notes field.
  - **Reorder** — drag a row by its grip handle (⠿) to move it up or down
    within its own panel. Dragging is confined to one panel: a job can't be
    dragged between Manufacturing and Installing.
  - **Move / copy to another week** — the left and right arrow icons move the
    row, along with everyone assigned to it, to the previous or next week.
    The copy icon duplicates it (and its assignments) onto the next week
    instead, leaving the original where it is.
  - **Remove** — the trash icon removes the row from that week (the job
    itself, and its other rows, are untouched).
  - **Export PDF** — opens the browser print dialog (choose "Save as PDF").
    **Export JPG** — renders the current week to a downloadable image,
    drawn from the live data (not a screenshot).
  - No login — anyone on the LAN who opens the page can view and edit, the
    whiteboard trust model it replaced. This board is the **exception**: every
    other page (landing, search, admin, workers) sits behind the Umbrel login,
    so the TV must bookmark `/schedule.html` directly rather than the app's
    default landing page.
- **`/workers.html`** — manage the crew roster shown on the schedule: add a
  worker, rename them, drag the hue slider to change their chip colour, or
  **Archive** someone who's left (keeps their name/colour on past weeks'
  history but hides them from new assignments — there's no hard delete, by
  design, so old weeks stay accurate).

## AI tag suggestions (optional)

The "Suggest tags from photos" button in `/admin.html` calls Google's Gemini
API (free tier — no card required, and the daily limit is far more than a
small showroom would ever hit uploading photos in batches). Nothing is sent
anywhere until you click that button — it's opt-in per upload.

Setup (one-time):

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. SSH into your Umbrel and create the key file:
   ```bash
   mkdir -p ~/umbrel/app-data/thcabinets-splash/data/config
   echo "YOUR_KEY_HERE" > ~/umbrel/app-data/thcabinets-splash/data/config/gemini-api-key
   ```
3. That's it — no restart needed, the file is read fresh on each request.

This file lives under `data/`, so it's untouched by future app updates (see
"How it works" above) — set it once and it stays.

## Updating the logo

Replace [thcabinets-splash/app/public/logo.png](thcabinets-splash/app/public/logo.png)
with a new file of the same name, then ship a code update (see above). If you
use a different extension, update the `src="logo.png"` references in
`index.html` and `search.html` to match.
