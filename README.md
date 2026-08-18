# TH Cabinets Umbrel App Store

A personal Umbrel Community App Store containing one app, **TH Cabinets**,
currently a splash page that shows your company logo. Built as a base you can
extend with real functionality later.

## Structure

```
umbrel-app-store.yml          # store manifest (id + display name)
thcabinets-splash/
  umbrel-app.yml               # app listing (name, tagline, icon, etc.)
  docker-compose.yml           # runs nginx:alpine behind Umbrel's app_proxy
  icon.svg                     # app icon shown in the Umbrel dashboard
  data/www/
    index.html                 # the splash page
    logo.png                   # your logo (already added, from logo_vert.bmp)
```

## 1. Repo

This is pushed to [github.com/devcal1/thcabinets-umbrel-store](https://github.com/devcal1/thcabinets-umbrel-store).

## 2. Install on Umbrel

1. On your Umbrel, open the **App Store** → the "⋮" menu → **Community App Stores**.
2. Add: `https://github.com/devcal1/thcabinets-umbrel-store`.
3. The "TH Cabinets" store will appear; open it and install the **TH Cabinets** app.
4. Once installed, it shows up on your Umbrel dashboard like any other app —
   click its icon to open the splash page in your browser.

## Updating the logo later

Replace [thcabinets-splash/data/www/logo.png](thcabinets-splash/data/www/logo.png)
with a new file of the same name — no code changes needed. If you use a
different extension (e.g. `.svg`), update the `src="logo.png"` attribute in
[index.html](thcabinets-splash/data/www/index.html) to match. Push the change
and reinstall/restart the app on Umbrel to pick it up.

## How it works

- `web` runs the stock `nginx:1.27-alpine` image — no custom image to build or publish.
- `docker-compose.yml` mounts `${APP_DATA_DIR}/data/www` (populated from this
  repo's `thcabinets-splash/data/www/` on install) straight into nginx's web root.
- `app_proxy` is Umbrel's standard reverse-proxy service; it's what makes the
  app clickable from the dashboard with authentication handled for you.
- The page background color (`#0a0607`) is matched to the logo's own
  background so it blends in with no visible edge.

## Extending it later

Since it's just static files served by nginx, add more pages/assets directly
under `data/www/`. If you outgrow static HTML (e.g. need a backend), add another
service to `docker-compose.yml` and point `app_proxy`'s `APP_HOST`/`APP_PORT` at it.
