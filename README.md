# AquaWatch — AI‑powered water intelligence (Frontend)

AquaWatch is an interactive web app for exploring USGS National Water Information System (NWIS) monitoring locations on a map and viewing the latest hydrologic measurements.

This repository contains the React + TypeScript frontend built with Vite and Leaflet/React‑Leaflet.

## Features

- Interactive map with NWIS sites loaded for the current map view (tile‑based bbox fetch to respect NWIS limits)
- Marker popups with site metadata and quick link to “Access Data”
- Sites in view selector and details panel with latest values (discharge, gage height, temperature)
- Timeseries chart (last 7 days) with selectable metric; overlays Real vs Predicted and allows toggle per series
- Anomaly prediction for all visible sites, with red pin markers for anomalous results and optional PDF report (map snapshot + details)
- Alerts tab showing recent alerts (top 5 in panel, “View all” modal), plus inline email subscription with error display
- Training tab to bulk train models for all visible sites and a Recent training list (expand to see sites)
- OTP login (optional feature flag) with Vonage Verify via backend; session token is injected into requests via Axios interceptor
- Polished UX: compact Leaflet popups, disabled states with inline spinners, accessible labels, empty‑state UI

### Anomaly prediction (backend integration)

- “Predict Anomaly” triggers anomaly processing for all sites currently visible on the map.
- The frontend uses a service layer to call your backend:
  - Trigger (bulk): `POST http://localhost:8080/anomaly/check` with body `{ "sites": ["<siteid>"...], "threshold_percent": 10 }`
  - Status: `GET http://localhost:8080/prediction/status?site=<siteid>` – used to avoid rapid re‑triggers (cool‑down + status check).
- After a run, the UI colors anomalous sites red, and can generate a PDF report (map snapshot + details) via `POST /report/pdf`.

### Training models (backend integration)

- “Train Model” triggers bulk training for all visible stations in the Training tab.
- The frontend uses a service layer to call your backend:
  - Trigger (bulk): `GET http://localhost:8080/ingest?station=<id>&station=<id>&train=true`
  - Recent models: `GET http://localhost:8080/train/models?minutes=10080`
- The UI shows a success/error message inline under the button and lists recent training runs. Each run shows Run #, Sites count, and timestamp; expanding a run reveals the full set of sites.

### Alerts & Notifications

- Subscribe to email notifications in the Alerts tab.
- Backend endpoints used:
  - Subscribe: `POST http://localhost:8080/alerts/subscribe` with `{ "email": "you@example.com" }` (user must confirm SNS email).
  - Recent alerts: `GET http://localhost:8080/alerts?minutes=10` (UI shows up to 5 recent items and a modal for all).

## Screenshots

Add screenshots or a short screen recording here to illustrate the UX.

## Tech stack

- React 19 + TypeScript
- Vite 5 (dev/build tooling)
- Leaflet + React‑Leaflet
- Axios for HTTP

## Local development

Prerequisites: Node.js 18 LTS.

```
npm install
npm run dev
```

The app serves at http://localhost:5173 (or the next available port printed by Vite).

If you see an error like `TypeError: crypto.hash is not a function` with Vite 7 on Node 18, ensure the project is pinned to Vite 5 (this repo uses Vite 5.4.x) or upgrade Node.

## Project structure

```
src/
  api/
    usgs.ts          # NWIS helpers: sites by bbox (tiled), site by id, IV values
    anomaly.ts       # Anomaly & training service calls
    alerts.ts        # Alerts subscribe and recent alerts
    report.ts        # Create PDF map report
    http.ts          # Axios instance; injects X-Session-Token when present
  components/
    MapView.tsx      # Map layout, site fetching, selection, details panel
    Login.tsx        # OTP login (optional, feature-flagged)
    Sparkline.tsx    # Lightweight chart (real vs predicted overlay)
  App.tsx            # App shell
  main.tsx           # Client entry (mounts React), global CSS imports
  index.css          # Global styles (Leaflet popup tweaks, utility)
```

## Data sources

- NWIS Site Service (RDB): `https://waterservices.usgs.gov/nwis/site/`
- NWIS Instantaneous Values (JSON WaterML): `https://waterservices.usgs.gov/nwis/iv/`

We tile large bounding boxes into ≤1° squares to comply with NWIS service constraints and merge results client‑side.

The anomaly, alerts, SMS (OTP), report and training features depend on your backend running at `http://localhost:8080`. You can adjust base URLs in the small service modules under `src/api/`.

### Training

- Train multiple models for all visible stations from the Training tab.
- Endpoints used:
  - Trigger (bulk): `GET http://localhost:8080/ingest?station=<id>&station=<id>&train=true`
  - Recent models: `GET http://localhost:8080/train/models?minutes=10080`
- The Training tab shows recent runs (Run #, Sites count, timestamp). Expanding a run reveals the list of sites.

## Environment and configuration

No secrets are required for public NWIS endpoints. If you add private APIs later, store keys in `.env` and do not commit them—`.gitignore` already excludes env files.

Optional feature flag:
- `VITE_ENABLE_LOGIN=true` – enables OTP Login UI (Vonage Verify backend assumed). When disabled or token expired, the app bypasses login and loads the map directly.

## Accessibility & UX

- Keyboard and mouse interactions for map and sidebar
- Clear units and descriptive labels; tooltips or descriptions can be added to tiles

## Roadmap

- Marker clustering for dense regions
- Filters (site type, parameter)
- URL state (selected site, map position)
- Unit toggles (metric/imperial) for temperature and stage

## License

MIT. See `LICENSE`.
