# AquaWatch — AI‑powered water intelligence (Frontend)

AquaWatch is an interactive web app for exploring USGS National Water Information System (NWIS) monitoring locations on a map and viewing the latest hydrologic measurements.

This repository contains the React + TypeScript frontend built with Vite and Leaflet/React‑Leaflet.

## Features

- Interactive map with NWIS sites loaded for the current map view
- Marker popups styled with quick site metadata and link to “Access Data”
- Site selector in the sidebar and details panel with latest values
- Side‑by‑side tiles for Discharge (ft³/s), Gage height (ft), Temperature (°C)
- Graceful fallbacks (N/A) when a parameter is not available
- Tiled site queries to avoid NWIS bounding‑box service limits

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

## Project structure

```
src/
  api/
    usgs.ts          # NWIS helpers: sites by bbox (tiled), site by id, IV values
  components/
    MapView.tsx      # Map layout, site fetching, selection, details panel
  App.tsx            # App shell
  main.tsx           # Client entry (mounts React), global CSS imports
  index.css          # Global styles (Leaflet popup tweaks, utility)
```

## Data sources

- NWIS Site Service (RDB): `https://waterservices.usgs.gov/nwis/site/`
- NWIS Instantaneous Values (JSON WaterML): `https://waterservices.usgs.gov/nwis/iv/`

We tile large bounding boxes into ≤1° squares to comply with NWIS service constraints and merge results client‑side.

## Environment and configuration

No secrets are required for public NWIS endpoints. If you add private APIs later, store keys in `.env` and do not commit them—`.gitignore` already excludes env files.

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
