# Data reference

This document describes every data file in `data/`, the exact JSON schema the frontend expects, how pooling works, and how to add metros or new survey years.

---

## Overview

| File | Format | Size (approx.) | Records |
|------|--------|----------------|---------|
| `stats.json` | JSON object | 567 KB | 283 keys (282 CBSAs + `USA`) |
| `metros.geojson` | GeoJSON FeatureCollection | 274 KB | 282 polygon features |
| `states.geojson` | GeoJSON FeatureCollection | 124 KB | 52 polygon features |

All three are loaded at startup by `loadData()` in `src/app.js`:

```javascript
[STATS, METROS, STATES] = await Promise.all([
  fetch("data/stats.json").then((r) => r.json()),
  fetch("data/metros.geojson").then((r) => r.json()),
  fetch("data/states.geojson").then((r) => r.json()),
]);
```

---

## `stats.json` — top-level structure

The file is a single JSON **object** (not an array). Each key is a CBSA code string (e.g. `"10420"`) or `"USA"` for the precomputed national pooled row.

```json
{
  "10420": { /* metro record */ },
  "35620": { /* metro record */ },
  "USA": { /* pooled national row */ }
}
```

### Metro record fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name, e.g. `"Akron, OH"`. |
| `pop` | number | yes | Metro population (2024 ACS; used for filters and sorting). |
| `region` | string | yes | Census region code: `NE`, `MW`, `S`, `W`. |
| `data` | object | yes | Migration cells keyed `{cohort}_{year}` — see below. |
| `info` | object | yes* | Metro profile for sidebar / Profile tab. *Omitted or empty for `USA`. |
| `newmix` | object | no | Tenure/structure mix among **new-housing movers** (both years combined in pipeline). |
| `issues` | array | no | Data-quality flags for this metro — see below. |

Example metro (`10420`):

```json
{
  "name": "Akron, OH",
  "pop": 702209,
  "region": "MW",
  "data": {
    "all_2019": { "n": 264, "out_mp": 29.8, "out_131": 29.8, "out_50d": 15.3, "out_ring": 15.3, "out_100d": 13.9, "med": 4.0 },
    "new_2019": { "n": 10, "out_mp": 58.2, "out_mp_e": 30.6, "W": 1122, "db": [184, 285, ...], ... },
    "mid_2019": { ... },
    "old_2019": { ... },
    "all_2024": { ... },
    "new_2024": { ... },
    "mid_2024": { ... },
    "old_2024": { ... }
  },
  "info": { "pop": 702209, "medinc": 71364, ... },
  "newmix": { "own": 45.2, "rent": 54.8, "sf": 72.1, "mf": 27.9, "n": 42 },
  "issues": []
}
```

### `USA` row

The `"USA"` entry is a **pre-pooled** national summary across all identifiable metros in the dataset. It has the same `data` cell structure but typically no `info`. The map and table can select it like any metro (`?metro=USA`).

When users apply **filters**, the frontend recomputes pooled cells client-side via `poolCell()` instead of using `USA`.

---

## Migration cells (`data.{cohort}_{year}`)

### Cohort × year keys

| Cohort key | Meaning in UI | Housing vintage (2019 ACS) | Housing vintage (2024 ACS) |
|------------|---------------|----------------------------|----------------------------|
| `all` | “All vintages” (map coloring only) | All units | All units |
| `new` | New housing column | Built 2016 or later | Built 2021 or later |
| `mid` | Mid housing column | Built 2000–2015 | Built 2000–2020 |
| `old` | Old housing column | Built 1999 or earlier | Built 1999 or earlier |

| Year key | ACS 1-year PUMS survey year |
|----------|----------------------------|
| `2019` | 2019 ACS |
| `2024` | 2024 ACS |

**Required keys per metro** (8 keys):  
`all_2019`, `new_2019`, `mid_2019`, `old_2019`, `all_2024`, `new_2024`, `mid_2024`, `old_2024`.

A key may be present with value `null` when there are no surveyed households for that metro/cohort/year (the UI shows em dashes).

The **detail table** always shows `new`, `mid`, `old` for both years. The `all_*` cells are used for map coloring when “All vintages” is selected and for some filters; they do **not** include margin-of-error fields in the published data.

### Cell fields (vintage cells: `new`, `mid`, `old`)

| Field | Type | Description |
|-------|------|-------------|
| `n` | integer | Unweighted count of surveyed households in this metro/cohort/year. |
| `W` | number | Sum of `HHWT` survey weights for those households. Used for client-side pooling. |
| `out_mp` | number \| null | % whose home 1 year ago was **outside this metro** (MIGPUMA reconstruction, population-weighted). Primary measure. |
| `out_mp_e` | number \| null | 95% margin of error for `out_mp` (percentage points). |
| `out_131` | number \| null | Same concept using raw **MIGMET131** “metro 1 year ago” code. `null` when Census suppressed. |
| `out_131_e` | number \| null | MOE for `out_131`. |
| `out_ring` | number \| null | % from outside metro **and** outside any metro within 50 mi of this metro’s border. |
| `out_ring_e` | number \| null | MOE for `out_ring`. |
| `out_50d` | number \| null | % who moved **> 50 straight-line miles** (migration-PUMA centroid → destination PUMA centroid). |
| `out_50d_e` | number \| null | MOE for `out_50d`. |
| `out_100d` | number \| null | % who moved **> 100 miles**. |
| `out_100d_e` | number \| null | MOE for `out_100d`. |
| `med` | number \| null | Median miles moved (integer-ish). |
| `med_e` | number \| null | MOE for median miles. |
| `db` | array[12] | Histogram of **weighted** movers across distance bins — see `DBINS`. |

### `all_*` cells (simplified)

Same measure fields (`out_mp`, `out_131`, `out_ring`, `out_50d`, `out_100d`, `med`, `n`) but **without** `*_e`, `W`, or `db` in the published file. Sufficient for map display and coarse filters.

### Distance histogram (`db`)

`db` is a length-12 array of **weighted counts** in miles, using bin edges defined in `DBINS` in `src/app.js`:

```javascript
const DBINS = [0, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 250];
// must match Python
```

Bin `i` counts weight in `[DBINS[i], DBINS[i+1])`; the last bin is `[150, 250]` with an open upper bound handled in `binMedian()`.

**Critical:** If the analysis pipeline changes these edges, update `DBINS` in `src/app.js` to match.

### Measure definitions (analysis intent)

| Code | Label | Definition |
|------|-------|------------|
| `out_mp` | Outside metro (MIGPUMA) | Prior home not in destination CBSA; origin from migration PUMA (suppression-free). |
| `out_131` | Outside metro (MIGMET131) | Same using Census MIGMET131; blank when suppressed (shown as `n/a*` in UI). |
| `out_ring` | Outside + adjacent ring | Not in metro and not in any metro whose border is within 50 mi of destination CBSA. |
| `out_50d` | Moved > 50 mi | Straight-line miles between population-weighted migration-PUMA centroids. |
| `out_100d` | Moved > 100 mi | Same at 100 mi threshold. |

Population universe: **households** whose householder moved in the **last 12 months** into housing of the given vintage in the destination metro.

---

## `info` — metro profile

ACS 1-year derived context shown in the map infobox / mobile Profile tab. All fields are numbers unless noted.

| Field | UI label | Notes |
|-------|----------|-------|
| `pop` | Population | |
| `pop_chg` | Pop. change ’15–’24 (%) | |
| `medinc` | Median household income | Dollars |
| `poverty` | Poverty rate | Percent |
| `avghh` | Avg. household size | |
| `hu` | Housing units | |
| `hu_chg` | Housing change ’15–’24 (%) | |
| `sf_share` | Single-family detached | Percent of stock |
| `own_rate` | Homeownership rate | Percent |
| `medval` | Median home value | Dollars |
| `val_chg` | Value change, real ’15–’24 | Percent |
| `medrent` | Median rent | Dollars/month |
| `rent_chg` | Rent change, real ’15–’24 | Percent |
| `vti` | Value-to-income | Ratio |
| `rent_burden` | Rent as % of income | Percent |
| `own_vac` | For-sale vacancy | Percent |
| `rent_vac` | Rental vacancy | Percent |

`medage` may appear in data but is not displayed in the current UI.

---

## `newmix` — new-housing mover composition

Shares among movers into **new** vintage housing (pooled across survey years in the pipeline):

| Field | Meaning |
|-------|---------|
| `own` | % owner-occupied |
| `rent` | % renter-occupied |
| `sf` | % single-family structure |
| `mf` | % multifamily structure |
| `n` | Sample size for this mix |

Used by filters “Mostly owner-occupied”, “Mostly single-family”, etc.

---

## `issues` — per-metro data quality flags

Array of objects. Known `id` values:

| `id` | Meaning | Extra fields |
|------|---------|--------------|
| `supp` | MIGMET131 suppressed for this metro/year | `scope` e.g. `"in 2024"` or `"in 2019 and 2024"` |
| `dist` | Distance metrics overstated (large/rural metro) | `mi` — typical median miles |
| `div` | MIGPUMA vs MIGMET131 disagree substantially | `pp` — max point difference |

The UI shows amber banners under the table when `issues.length > 0`.

---

## `metros.geojson`

Standard GeoJSON `FeatureCollection`. Each feature:

```json
{
  "type": "Feature",
  "properties": {
    "met": "10420",
    "name": "Akron, OH"
  },
  "geometry": { "type": "Polygon" | "MultiPolygon", "coordinates": [...] }
}
```

**Join rule:** `properties.met` must equal the key in `stats.json` (string CBSA code).

**Count:** 282 features in the current file; 283 `stats.json` keys because `USA` has no polygon.

Metros without a map polygon cannot be clicked on the map but remain searchable if present in `stats.json`.

---

## `states.geojson`

State boundaries for visual context only. Not joined to `stats.json`. Features have typical GeoJSON properties (name, etc.); the frontend styles them uniformly.

---

## Client-side pooling (`poolCell`)

When filters are active, the app builds a synthetic pooled view:

1. Collects all metros in `activeFilter`.
2. For each measure, computes weighted mean: `sum(W * value) / sum(W)`.
3. Pooled MOE: `sqrt(sum((W * e)^2)) / sum(W)` (treats strata as independent).
4. Sums `db` arrays and recomputes `med` via `binMedian()`.

The precomputed `USA` row uses the same weighting logic across **all** metros in the dataset, not a filtered subset.

---

## Programmatic access

### Python — load everything

```python
import json
from pathlib import Path

ROOT = Path("data")
stats = json.loads((ROOT / "stats.json").read_text(encoding="utf-8"))
metros = json.loads((ROOT / "metros.geojson").read_text(encoding="utf-8"))
states = json.loads((ROOT / "states.geojson").read_text(encoding="utf-8"))

# List metros with reliable new-housing samples both years
reliable = [
    (code, stats[code]["name"])
    for code in stats
    if code != "USA"
    and stats[code]["data"].get("new_2019", {}).get("n", 0) >= 100
    and stats[code]["data"].get("new_2024", {}).get("n", 0) >= 100
]

# Join map geometry to stats
by_met = {f["properties"]["met"]: f for f in metros["features"]}
akron_geom = by_met["10420"]
akron_outside_2024 = stats["10420"]["data"]["all_2024"]["out_mp"]
```

### Python — build a simple CSV export

```python
import csv

rows = []
for code, rec in stats.items():
    if code == "USA":
        continue
    for year in ("2019", "2024"):
        cell = rec["data"].get(f"all_{year}", {})
        rows.append({
            "cbsa": code,
            "name": rec["name"],
            "year": year,
            "n": cell.get("n"),
            "out_mp": cell.get("out_mp"),
            "out_50d": cell.get("out_50d"),
        })

with open("migration_export.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys())
    w.writeheader()
    w.writerows(rows)
```

### JavaScript / Node

```javascript
import { readFileSync } from "fs";

const stats = JSON.parse(readFileSync("data/stats.json", "utf8"));

function valOf(met, cohort, year, key) {
  return stats[met]?.data?.[`${cohort}_${year}`]?.[key] ?? null;
}

// Metros where outside share rose ≥ 5 pp from 2019 to 2024
const trended = Object.entries(stats)
  .filter(([k]) => k !== "USA")
  .filter(([k, r]) => {
    const a = valOf(k, "all", "2019", "out_mp");
    const b = valOf(k, "all", "2024", "out_mp");
    return a != null && b != null && b - a >= 5;
  })
  .map(([k, r]) => ({ cbsa: k, name: r.name }));
```

### HTTP API pattern

If you host the static site at `https://example.com/`, data URLs are:

- `https://example.com/data/stats.json`
- `https://example.com/data/metros.geojson`
- `https://example.com/data/states.geojson`

No authentication or query parameters — full file download each time. For heavy programmatic use, mirror the JSON locally or ingest into a database.

---

## Adding a new survey year (e.g. 2025)

### 1. Analysis pipeline (external)

For each metro and each cohort (`all`, `new`, `mid`, `old`):

1. Extract ACS 1-year PUMS for the new survey year via IPUMS.
2. Apply the same housing-vintage cutpoints **for that ACS year** (update cutpoints if Census field definitions shift).
3. Compute all measures, MOEs, `db`, `med`, `W`, `n`.
4. Recompute `USA` pooled row and refresh `info` / `pop` if using latest ACS for profiles.
5. Re-evaluate `issues` flags.

Add keys like `new_2025`, `mid_2025`, `old_2025`, `all_2025` to every metro’s `data` object.

### 2. Frontend updates (this repo)

See the checklist in [FRONTEND.md § Adding a survey year](FRONTEND.md#adding-a-survey-year). At minimum:

- `index.html` — `<select id="yearSel">` options
- `src/app.js` — every `["2019", "2024"]` array, delta/compare logic, URL parsing, filter labels
- Copy in `index.html`, `COHORT_VINTAGE`, `KNOWN_ISSUES`, `initControls()` notes

**Recommendation for maintainers:** Introduce a single `SURVEY_YEARS = ["2019", "2024"]` constant and derive UI from it (future refactor).

### 3. Validation script

After generating new `stats.json`:

```bash
python scripts/validate_data.py
```

Update `YEARS` in `scripts/validate_data.py` when adding survey years. The script checks:

- Every non-`USA` metro has all cohort×year keys for each year in `SURVEY_YEARS`.
- Every `metros.geojson` `met` exists in `stats.json`.
- Vintage cells have `n`, `W`, and measure fields; `out_mp_e` present when `out_mp` present.
- `db` length is 12 when present.
- `USA` row exists and matches recomputed pool (optional spot-check).

---

## Adding a new metro

1. Add CBSA record to `stats.json` with full `data`, `info`, `pop`, `region`.
2. Add matching polygon to `metros.geojson` (`properties.met` = CBSA code).
3. Confirm the metro appears in `populateMetroList()` / search (automatic if in `STATS`).
4. Map click + table render use `n >= 25` rule for choropleth coloring.

Removing a metro: delete from both `stats.json` and `metros.geojson`; filters and search update automatically.

---

## Regenerating from legacy HTML only

```bash
python scripts/extract_data.py
# optional: python scripts/extract_data.py --source path/to/index.monolith.html
```

This **only** copies embedded JSON from `legacy/index.monolith.html`. It cannot create new years or recalculate statistics.

---

## Analysis pipeline contract (not shipped)

The repository expects a batch job that:

1. Downloads IPUMS ACS 1-year PUMS household records for each survey year.
2. Filters to recent movers into destination CBSAs, tagged by housing vintage cohort.
3. Builds MIGPUMA-based outside-metro indicator; parallel MIGMET131 with suppression handling.
4. Computes ring and distance measures using migration-PUMA centroids and `DBINS`.
5. Calculates replicate-weight or formula-based 95% MOEs → `*_e` fields.
6. Aggregates `info` and `newmix` from ACS summary fields.
7. Flags `issues` per rules for suppression, distance inflation, method disagreement.
8. Emits compact JSON (no pretty-print) to minimize file size.

Document and version-control that pipeline separately. This repo’s `docs/DATA.md` is the **output schema** that pipeline must target.
