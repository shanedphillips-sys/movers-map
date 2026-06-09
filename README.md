# Where do movers come from?

Interactive map of U.S. metropolitan areas showing **where households came from** when they moved into housing. The app compares survey years (currently **2019 vs 2024**) and breaks results down by **housing vintage** — the age of the unit movers moved into, not the mover’s age.

**Data source:** ACS 1-year PUMS via [IPUMS](https://ipums.org/) (household-level, householder record, `HHWT` weights). This repository ships the **published output** of that analysis as static JSON/GeoJSON plus a browser frontend. The Python/R (or other) pipeline that builds `data/stats.json` is **not in this repo**.

---

## Quick start

The app loads data with `fetch()`, so it must be served over HTTP (opening `index.html` from disk will fail).

```bash
python -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/).

Deploy to any static host (GitHub Pages, Netlify, S3, etc.). Publish `index.html`, `data/`, and `src/` together.

---

## What the app does

| Layer | Role |
|-------|------|
| **Map** | Choropleth of metros colored by the selected measure (0–100%). Metros with fewer than 25 surveyed households in the current cohort/year are gray. |
| **Table / mobile cards** | For the selected metro (or pooled/filtered set), shows five migration measures across **New / Mid / Old** housing vintage for **both survey years**. Cells are shaded by 95% margin of error. |
| **Metro profile** | Sidebar (desktop) or Profile tab (mobile): ACS-derived population, housing, and affordability stats for individual metros. |
| **Filters** | Client-side metro explorer: combine filter chips (population, region, trends, data-quality flags, etc.) and optionally view a pooled summary of the filtered set. |
| **Compare** | Overlay another metro or the national pooled row against the current selection for the active measure/year. |
| **URL state** | `?metro=&measure=&cohort=&year=&compare=&filters=` — shareable links. |

---

## Repository layout

```
movers-map/
├── index.html              # Page shell; loads Leaflet, src/app.js, src/styles.css
├── data/                   # All precomputed data (see docs/DATA.md)
│   ├── stats.json          # Per-metro statistics + pooled "USA" row (~567 KB)
│   ├── metros.geojson      # CBSA boundaries for the map (~274 KB)
│   └── states.geojson      # State backdrop polygons (~124 KB)
├── src/
│   ├── app.js              # All application logic (~1,700 lines)
│   └── styles.css          # Layout and UI styles
├── scripts/
│   ├── extract_data.py     # Re-extract data/ from legacy monolithic HTML only
│   └── validate_data.py    # Check stats.json / metros.geojson against frontend contract
├── legacy/
│   └── index.monolith.html # Original single-file app (reference / backup)
└── docs/
    ├── DATA.md             # Data schema, programmatic access, adding years/metros
    └── FRONTEND.md         # Frontend architecture and extension points
```

---

## Data (summary)

| File | Contents |
|------|----------|
| `data/stats.json` | 283 entries: CBSA codes `10100`… plus `"USA"` national pooled row. Each metro has migration cells, profile `info`, optional `issues`, etc. |
| `data/metros.geojson` | 282 metro polygons; `properties.met` (CBSA code string), `properties.name`. |
| `data/states.geojson` | 52 state/DC polygons for map backdrop. |

**Cell keys** in `stats.json` use the pattern `{cohort}_{year}`: `all`, `new`, `mid`, `old` × `2019`, `2024` (e.g. `new_2024`).

**Measures** in each vintage cell: `out_mp`, `out_131`, `out_ring`, `out_50d`, `out_100d`, plus margins `*_e`, sample `n`, weight sum `W`, distance histogram `db`, median miles `med` / `med_e`.

Full schema, field definitions, pooling rules, and **how to add a new survey year** → **[docs/DATA.md](docs/DATA.md)**.

---

## Adding or refreshing data

### If you have an updated analysis pipeline (normal path)

1. Run your pipeline against new ACS PUMS extracts.
2. Emit `data/stats.json` matching the schema in [docs/DATA.md](docs/DATA.md).
3. If metros changed, update `data/metros.geojson` (CBSA boundaries aligned with `stats.json` keys).
4. Update hardcoded survey years in the frontend — see [docs/FRONTEND.md § Adding a survey year](docs/FRONTEND.md#adding-a-survey-year).
5. Validate the output: `python scripts/validate_data.py`
6. Serve locally and verify map, table, filters, and URL deep links.

### If you only have the legacy monolith HTML

```bash
python scripts/extract_data.py
```

This parses embedded `STATS`, `METROS`, and `STATES` from `legacy/index.monolith.html` and writes `data/*.json` / `data/*.geojson`. It does **not** run statistical analysis.

### Programmatic access (no browser)

```python
import json
from pathlib import Path

stats = json.loads(Path("data/stats.json").read_text(encoding="utf-8"))

# Share of movers into new housing (2024) from outside metro (MIGPUMA), Chicago
chicago = stats["16980"]["data"]["new_2024"]["out_mp"]

# National pooled row
usa_new_2024 = stats["USA"]["data"]["new_2024"]
```

```javascript
const stats = await fetch("/data/stats.json").then((r) => r.json());
const akron = stats["10420"];
```

More examples (filtering, pooling, GeoJSON joins) → **[docs/DATA.md](docs/DATA.md)**.

---

## Frontend (summary)

- **No build step** — vanilla JS, Leaflet 1.9.4 from CDN.
- **Entry:** `initApp()` in `src/app.js` → `loadData()` → populate UI → `initMap()`.
- **Constants** (`MEAS`, `COH`, `DBINS`, `FILTERS`) define measures, cohorts, distance bins, and filter logic. `DBINS` must match the analysis pipeline.
- **Client-side pooling:** `poolCell()` recomputes USA-style aggregates when filters are active (weighted by `W`).

Details, URL parameters, filter groups, and year-extension checklist → **[docs/FRONTEND.md](docs/FRONTEND.md)**.

---

## What is *not* in this repo

- ACS PUMS microdata or IPUMS extract scripts
- The statistical pipeline (weighting, MIGPUMA reconstruction, suppression flags, distance centroids, MOE calculation)
- Automated tests or CI

To reproduce or extend the analysis, treat [docs/DATA.md](docs/DATA.md) as the **contract** the pipeline must satisfy and infer methodology from the in-app “Method & definitions” copy in `initControls()` plus the issue descriptions in `KNOWN_ISSUES`.

---

## License / attribution

- Map: [Leaflet](https://leafletjs.com/) + Census CBSA boundaries (via published GeoJSON in `data/`).
- Data: U.S. Census Bureau ACS PUMS via IPUMS (research microdata; cite IPUMS and Census in derivative work).
