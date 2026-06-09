# Frontend reference

How the browser app is structured, what each part does, and what to change when extending survey years or measures.

---

## Stack

| Piece | Technology |
|-------|------------|
| Markup | `index.html` — static shell, no templating |
| Logic | `src/app.js` — single module, no bundler |
| Styles | `src/styles.css` |
| Map | [Leaflet](https://leafletjs.com/) 1.9.4 (CDN) |
| Data | `fetch()` → `data/stats.json`, `metros.geojson`, `states.geojson` |

There is **no** npm, webpack, or TypeScript. Edit files and refresh the browser.

---

## Startup sequence

```
index.html loads
  → defer: leaflet.js, app.js
  → initApp()
       setLoading(true)
       loadData()           # STATS, METROS, STATES globals
       buildFilterControls()
       initControls()       # populate selects, wire onchange
       populateMetroList()
       readUrlState()       # ?metro= & friends
       applyStateToControls()
       initMetroSearch()
       initCompareSearch()
       initMobileTabs()
       initMap()            # Leaflet + geo layers + infobox control
       initCollapsibleSections()
       updateLegend()
       refreshFilter()
       select(...)          # initial metro / filtered state
       showApp()
```

On failure, `#loadError` shows the error and loading skeleton stays visible.

---

## Global state

| Variable | Purpose |
|----------|---------|
| `STATS` | Parsed `stats.json` |
| `METROS` | Parsed `metros.geojson` |
| `STATES` | Parsed `states.geojson` |
| `measure` | Active map/table measure code (`out_mp`, …) |
| `cohort` | Map filter: `all`, `new`, `mid`, `old` |
| `year` | Survey year for map + year-sensitive filters: `2019` or `2024` |
| `selected` | Current CBSA code, `USA`, `FILTERED`, or `FILTERED_EMPTY` |
| `compareTarget` | `""`, `USA`, or another CBSA for compare block |
| `activeFilter` | `null` (no filter) or `Set` of CBSA codes |
| `map`, `metroLayer` | Leaflet instances |

---

## UI regions

### Desktop (width > 768px)

```
┌─────────────────┬──────────────────┐
│ #side           │ #mapWrap         │
│  - controls     │  - #map          │
│  - #legend      │  - #legendMap    │
│  - #detail      │    (hidden)      │
│  - notes/issues │                  │
└─────────────────┴──────────────────┘
```

### Mobile (≤ 768px)

Three tabs — **Map**, **Data**, **Profile**:

| Tab | Visible |
|-----|---------|
| Map | Full-screen map + `#legendMap` under map |
| Data | Sticky mini-map + legend in `#side` + controls + `#detail` (mobile cards) |
| Profile | `#mobileProfileBody` metro profile card |

Map click on mobile switches to **Data** tab (`setMobileTab("data")`).

---

## Constants (must stay aligned with data pipeline)

### `MEAS` — map/table measures

```javascript
const MEAS = [
  ["out_mp", "From outside the metro (MIGPUMA)"],
  ["out_131", "From outside the metro (MIGMET131)"],
  ["out_ring", "Outside metro + adjacent (50-mi ring)"],
  ["out_50d", "Moved more than 50 miles (distance)"],
  ["out_100d", "Moved more than 100 miles (distance)"],
];
```

Adding a measure requires: pipeline output field, `ROWLAB`, `MEAS_EXPLAIN`, `poolCell` keys array, and optionally new filter logic.

### `COH` — housing vintage (map dropdown)

```javascript
["all", "All vintages"],
["new", "New vintage (2016+/2021+)"],
["mid", "Mid vintage (2000–15 / 2000–20)"],
["old", "Old vintage (≤1999)"],
```

`COHORT_VINTAGE` supplies table header labels and mobile card titles. Update year-specific build-year text when ACS cutpoints change.

### `DBINS` — distance histogram edges

```javascript
const DBINS = [0, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 250]; // must match Python
```

Used by `binMedian()` and `poolCell()`. **Must match the analysis pipeline.**

---

## Key functions

| Function | Role |
|----------|------|
| `cellOf(met, coh, yr)` | `STATS[met].data[coh + "_" + yr]` |
| `valOf(met, coh, yr, key)` | Single field from cell |
| `nOf(met, coh, yr)` | Sample size; `0` if missing |
| `styleMetro(f)` | Choropleth color; gray if `n < 25` |
| `renderDetail(subject)` | Builds table + mobile cards + MOE legend |
| `renderInfo(subject)` | Map infobox + mobile profile card |
| `poolCell(mets, coh, yr)` | Weighted pool across metro list |
| `subjectCells(subject)` | Cells for metro, `USA`, or filtered pool |
| `refreshFilter()` | Rebuilds `activeFilter` from checkboxes |
| `select(met)` | Change selection, re-render, update map bounds |
| `readUrlState()` / `writeUrlState()` | URL query sync |

### Table vs map cohort behavior

- **Map** colors metros using `cohort` + `year` from controls (`all` uses `all_{year}` cells).
- **Table** always shows three vintage columns per year: `new`, `mid`, `old` (not `all`).
- **Mobile cards** show the selected `measure` for each vintage × year.

### Margin-of-error shading

`moeClass(e, kind)` assigns CSS classes `moe-0` … `moe-4` from MOE width. Table cells and mobile card values share the same scale. `deltaBadge()` adds ↑/↓ when 2024 vs 2019 differs by ≥ 5 pp.

---

## URL query parameters

| Param | Values | Default |
|-------|--------|---------|
| `metro` | CBSA code or `USA` | `USA` |
| `measure` | `out_mp`, `out_131`, `out_ring`, `out_50d`, `out_100d` | `out_mp` |
| `cohort` | `all`, `new`, `mid`, `old` | `all` |
| `year` | `2019`, `2024` | `2024` |
| `compare` | `USA` or CBSA code | (none) |
| `filters` | Comma-separated filter option ids, e.g. `pop_l,r_W` | (none) |

Example:

```
/?metro=16980&measure=out_mp&cohort=new&year=2024&compare=USA&filters=pop_l,trend_less
```

Filter ids match `FILTERS.*.opts[].id` (e.g. `pop_s`, `hg_hi`, `q_supp`).

---

## Filter groups (`FILTERS`)

Defined in `src/app.js` starting ~line 195. Each group has `label` and `opts[]` with `{ id, label, test(met) }` or `test(met, year)`.

| Group key | Topic |
|-----------|-------|
| `pop` | Metro population tiers |
| `hgrowth` | Housing unit growth ’15–’24 |
| `rentchg` | Real median rent change |
| `valchg` | Real median value change |
| `outs` | Outside-metro share (uses `year`) |
| `gap` | New vs older vintage gap (uses `year`) |
| `dist` | Long-distance move shares (uses `year`) |
| `own` / `struct` | New-housing tenure/structure (`newmix`) |
| `trend` | 2019→2024 change in `out_mp` (hardcoded years) |
| `region` | Census region |
| `qual` | Data-quality flags |

Logic: **OR** within a group, **AND** across groups. Empty result → `FILTERED_EMPTY` state.

---

## Adding a survey year

When a new ACS year (e.g. `2025`) is added to `stats.json`, update **all** of the following:

### Data

- [ ] Every metro: `all_2025`, `new_2025`, `mid_2025`, `old_2025` cells in `data/stats.json`
- [ ] `USA` row updated
- [ ] `COHORT_VINTAGE` build-year strings if ACS vintage cutpoints change for that year

### `index.html`

- [ ] `<option>` in `#yearSel`
- [ ] Subtitle copy (`2019 vs 2024` → include new year)

### `src/app.js`

Search for `2019` and `2024` and update each site:

| Location | What to change |
|----------|----------------|
| `COHORT_VINTAGE.*.title` | Year-specific build-year ranges |
| `let year = "2024"` | Default year if desired |
| `KNOWN_ISSUES` copy | Suppression counts by year |
| `FILTERS.pop.label` | If `pop` should reference latest ACS |
| `FILTERS.trend` | Label and both year literals in tests |
| `FILTERS.qual` `q_rel` | Both years in reliability test |
| `profileRowsHtml` / `ibsrc` | Profile ACS year footnote |
| `deltaBadge` title | “Change vs {baseline year}” |
| `renderDetail` / `renderMobileCards` / `subjectCells` | `const yrs = [...]` |
| Delta logic (`y === "2024"`, `cPrev`, etc.) | Generalize: compare each year to prior survey year in array |
| `readUrlState()` | Allow new year in URL |
| `initControls()` notes | Method paragraph |

### Recommended refactor (optional)

```javascript
const SURVEY_YEARS = ["2019", "2024"]; // add "2025" here
const BASELINE_YEAR = SURVEY_YEARS[0];
const LATEST_YEAR = SURVEY_YEARS[SURVEY_YEARS.length - 1];
```

Then replace hardcoded arrays and drive `#yearSel` from `SURVEY_YEARS`.

### Compare / trend behavior

Today the UI assumes **two** survey years with deltas on the later year vs 2019. Adding a third year requires design choices:

- Show all years as columns in the table?
- Which year pair gets ↑/↓ badges?
- Does `trend` filter compare first vs last year only?

Document the chosen behavior when extending beyond two years.

---

## Adding a new measure

1. Pipeline emits `new_field` and `new_field_e` on each vintage cell.
2. Add to `MEAS`, `ROWLAB`, `MEAS_EXPLAIN`.
3. Add to `poolCell`’s `keys` array.
4. Map coloring and table rows pick it up automatically via `MEAS.forEach`.

---

## Mobile / desktop CSS

Breakpoints in `src/styles.css`:

| Breakpoint | Behavior |
|------------|----------|
| `> 960px` | Desktop side-by-side layout |
| `769–960px` | Wider sidebar, narrower map |
| `≤ 768px` | Tabbed mobile layout |
| `≤ 400px` | Smaller mini-map height |

`#legend` (sidebar) hidden on mobile; `#legendMap` shown on Map tab only (`syncMapLegendVisibility()`).

---

## Legacy monolith

`legacy/index.monolith.html` embeds `STATS`, `METROS`, `STATES` inline (~1.1 MB). `scripts/extract_data.py` can split it into `data/` for this multi-file layout. Do not edit the monolith for day-to-day work — edit `data/` and `src/` directly.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `?` | Open shortcuts modal |
| `/` | Focus metro search |
| `Esc` | Close modals/dropdowns |

---

## Files *not* to confuse with source of truth

| File | Role |
|------|------|
| `data/stats.json` | **Source of truth** for numbers |
| `src/app.js` | **Source of truth** for UI behavior |
| `legacy/index.monolith.html` | Archive; extract only |
| `scripts/extract_data.py` | One-way extract from legacy HTML |
