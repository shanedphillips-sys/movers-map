/* Where do movers come from? — frontend logic (data loaded from data/) */

let STATS;
let METROS;
let STATES;
let map;
let metroLayer;

const MEAS = [
  ["out_mp", "From outside the metro (MIGPUMA)"],
  ["out_131", "From outside the metro (MIGMET131)"],
  ["out_ring", "Outside metro + adjacent (50-mi ring)"],
  ["out_50d", "Moved more than 50 miles (distance)"],
  ["out_100d", "Moved more than 100 miles (distance)"],
];
const COH = [
  ["all", "All vintages"],
  ["new", "New vintage (2016+/2021+)"],
  ["mid", "Mid vintage (2000–15 / 2000–20)"],
  ["old", "Old vintage (≤1999)"],
];
const COHORT_VINTAGE = {
  new: {
    label: "New",
    sub: "housing",
    full: "New housing",
    range: "2016+/2021+",
    title:
      "Housing vintage — units built 2016 or later (2019 ACS) or 2021 or later (2024 ACS)",
  },
  mid: {
    label: "Mid",
    sub: "housing",
    full: "Mid housing",
    range: "2000–15 / 2000–20",
    title:
      "Housing vintage — units built 2000–2015 (2019 ACS) or 2000–2020 (2024 ACS)",
  },
  old: {
    label: "Old",
    sub: "housing",
    full: "Old housing",
    range: "≤1999",
    title: "Housing vintage — units built 1999 or earlier",
  },
};

function cohortTh(key) {
  const v = COHORT_VINTAGE[key];
  return (
    `<th class="cohort-th" title="${escapeHtml(v.title)}">` +
    `<span class="cohort-label">${v.label}</span>` +
    `<span class="cohort-sub">${v.sub}</span></th>`
  );
}
const ROWLAB = {
  out_mp: "Outside metro — MIGPUMA",
  out_131: "Outside metro — MIGMET131",
  out_50d: "Moved >50 mi (distance)",
  out_ring: "Outside metro + adjacent (50mi)",
  out_100d: "Moved >100 mi (distance)",
};
const MEAS_EXPLAIN = {
  out_mp:
    "Share whose home a year earlier was outside this metro — origin reconstructed from the migration-PUMA (population-weighted, not affected by Census suppression).",
  out_131:
    "Same idea, but using the Census’s raw ‘metropolitan area a year ago’ code (blank where the Census suppressed it).",
  out_ring:
    "Share from beyond this metro AND beyond every other metro whose border lies within 50 miles of it. A move from the metro itself or a neighboring metro within 50 mi counts as local; this row is everyone who came from farther out.",
  out_50d:
    "Share who moved more than 50 straight-line miles (origin migration-PUMA population-weighted centroid to destination PUMA centroid).",
  out_100d: "Share who moved more than 100 straight-line miles.",
};
const REGION_LABEL = {
  NE: "Northeast",
  MW: "Midwest",
  S: "South",
  W: "West",
};

let measure = "out_mp";
let cohort = "all";
let year = "2024";
let selected = "USA";
let compareTarget = "";
let requestedMetroFromUrl = null;

const KNOWN_ISSUES = [
  {
    id: "supp",
    t: "Census suppression of the local-origin code (MIGMET131)",
    h: 'For confidentiality, the Census blanks a metro’s MIGMET131 “lived here a year ago” code when its migration zones don’t line up cleanly with the metro (≥15% error). In those metro-years the “Outside metro — MIGMET131” row is unavailable (shown <b>n/a*</b>); used raw it would wrongly count local movers as outsiders. The <b>MIGPUMA</b> row rebuilds the origin from the never-suppressed migration zone and is the one to use. Affects <b>30 metros</b> (18 in 2019, 21 in 2024).',
  },
  {
    id: "dist",
    t: "Overstated distance in a few large, rural metros",
    h: 'A mover’s origin is known only to a “migration PUMA” — a zone of 100,000+ people. We place the origin at that zone’s <b>population-weighted</b> center, which corrected the distance rows for ~15 metros where they were previously distorted (Riverside–San Bernardino, Tucson, Denver, Boise…). In a few metros built from enormous, thinly-populated counties — <b>Lake Havasu, Reno, Santa Barbara</b> — the population is still so spread out that even same-metro moves register a high median, so the <b>“Moved &gt;50 / &gt;100 mi”</b> and <b>“Median miles”</b> rows read somewhat high there. Those metros carry a banner; the metro-based rows are unaffected.',
  },
  {
    id: "div",
    t: "The two metro-based methods can disagree",
    h: 'The MIGPUMA reconstruction (population-weighted) and the raw MIGMET131 code usually agree within a point. In a few metros whose migration zones straddle the metro boundary they differ by 8–18 points, so the “outside the metro” share is better read as a range than a single number. Only 4 metros: Springfield MA, Scranton PA, Albuquerque NM, Myrtle Beach SC.',
  },
  {
    t: "Small samples & margins of error",
    h: 'A single metro — especially the <b>New</b> (recently built) column — often rests on a few dozen surveyed households (250 of 282 metros have under 50 new-housing households in at least one year). Every cell is shaded by its 95% margin of error (darker = wider); hover for the exact ±. Lean on the national row, the Old column, and lightly-shaded cells.',
  },
  {
    t: 'Moves from rural areas count as “outside”',
    h: 'Every measure treats an origin in a non-metro / rural area as “outside the metro” and beyond 50/100 miles, even when it was physically close, because such origins carry no metro code. This slightly overstates the “from outside” share, most for metros ringed by rural land.',
  },
  {
    t: "Recent movers, not first occupants",
    h: "These are people who moved in the 12 months before the survey, classified by the age of the housing they entered — a flow of recent movers, not a census of first occupants. For new housing it mixes first move-ins with early turnover.",
  },
];

const ISSUE_BANNER = {
  supp: (o) =>
    `<b>Census suppressed the local-origin code (MIGMET131) ${o.scope}.</b> The “Outside metro — MIGMET131” row is blank — use the MIGPUMA row, which isn’t affected.`,
  dist: (o) =>
    `<b>Distance is overstated here.</b> This metro spans a large, sparsely populated area, so even same-metro moves register as a median of ~${o.mi} mi. Treat the “Moved &gt;50 / &gt;100 mi” and “Median miles” rows as upper bounds and rely on the metro-based rows.`,
  div: (o) =>
    `<b>The two metro methods disagree by up to ${o.pp} pp here.</b> Migration zones straddle the metro boundary, so read “outside the metro” as a range, not a single number.`,
};

const ISSUE_DETAIL = KNOWN_ISSUES.reduce((acc, it) => {
  if (it.id && (it.id === "supp" || it.id === "dist" || it.id === "div")) {
    acc[it.id] = it.h;
  }
  return acc;
}, {});

function openFilter() {
  renderFilterResults();
  updateFilterStatus();
  document.getElementById("filterModal").style.display = "block";
}
function closeFilter() {
  document.getElementById("filterModal").style.display = "none";
}
function openShortcuts() {
  const modal = document.getElementById("shortcutsModal");
  if (!modal) return;
  modal.style.display = "block";
}
function closeShortcuts() {
  const modal = document.getElementById("shortcutsModal");
  if (!modal) return;
  modal.style.display = "none";
}

function isTypingTarget(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || el.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeFilter();
    closeShortcuts();
    closeMetroDropdown();
    closeCompareDropdown();
    return;
  }
  if (e.key === "?" && !isTypingTarget(e.target)) {
    e.preventDefault();
    openShortcuts();
    return;
  }
  if (e.key === "/" && !isTypingTarget(e.target)) {
    e.preventDefault();
    metroSel.focus();
    metroSel.select();
    openMetroDropdown(filterMetroOptions(metroSel.value));
  }
});

document.getElementById("issueList").innerHTML = KNOWN_ISSUES.map(
  (i) => `<div class="idoc"><h3>${i.t}</h3><p>${i.h}</p></div>`,
).join("");

const shortcutList = document.getElementById("shortcutList");
if (shortcutList) {
  shortcutList.innerHTML = [
    ["<kbd>?</kbd>", "Open keyboard shortcuts"],
    ["<kbd>/</kbd>", "Focus metro search"],
    ["<kbd>Esc</kbd>", "Close open dialogs/dropdowns"],
  ]
    .map(([k, d]) => `<dt>${k}</dt><dd>${d}</dd>`)
    .join("");
}

const FILTERS = {
  pop: {
    label: "Metro population (2024 ACS)",
    opts: [
      { id: "pop_s", label: "Under 250K", test: (m) => STATS[m].pop < 250000 },
      {
        id: "pop_m",
        label: "250K – 1M",
        test: (m) => STATS[m].pop >= 250000 && STATS[m].pop < 1000000,
      },
      { id: "pop_l", label: "Over 1M", test: (m) => STATS[m].pop >= 1000000 },
    ],
  },
  hgrowth: {
    label: "Housing supply growth (’15–’24)",
    opts: [
      {
        id: "hg_lo",
        label: "Low — under 6%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.hu_chg != null && x.hu_chg < 6;
        },
      },
      {
        id: "hg_mid",
        label: "Moderate — 6% to 12%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.hu_chg != null && x.hu_chg >= 6 && x.hu_chg < 12;
        },
      },
      {
        id: "hg_hi",
        label: "High — over 12%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.hu_chg != null && x.hu_chg >= 12;
        },
      },
    ],
  },
  rentchg: {
    label: "Median rent change, real (’15–’24)",
    opts: [
      {
        id: "rc_lo",
        label: "Stable or slight — under 7%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.rent_chg != null && x.rent_chg < 7;
        },
      },
      {
        id: "rc_mid",
        label: "Moderate — 7% to 18%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.rent_chg != null && x.rent_chg >= 7 && x.rent_chg < 18;
        },
      },
      {
        id: "rc_hi",
        label: "Large — over 18%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.rent_chg != null && x.rent_chg >= 18;
        },
      },
    ],
  },
  valchg: {
    label: "Median home value change, real (’15–’24)",
    opts: [
      {
        id: "vc_lo",
        label: "Slight — under 30%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.val_chg != null && x.val_chg < 30;
        },
      },
      {
        id: "vc_mid",
        label: "Moderate — 30% to 50%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.val_chg != null && x.val_chg >= 30 && x.val_chg < 50;
        },
      },
      {
        id: "vc_hi",
        label: "Large — over 50%",
        test: (m) => {
          const x = STATS[m].info;
          return !!x && x.val_chg != null && x.val_chg >= 50;
        },
      },
    ],
  },
  outs: {
    label: "From another metro (all housing, selected year)",
    opts: [
      {
        id: "o50",
        label: "≥50% from another metro",
        test: (m, y) => {
          const v = valOf(m, "all", y, "out_mp");
          return v != null && v >= 50;
        },
      },
      {
        id: "o30",
        label: "Highly local (≤30% from another metro)",
        test: (m, y) => {
          const v = valOf(m, "all", y, "out_mp");
          return v != null && v <= 30;
        },
      },
    ],
  },
  gap: {
    label: "New vs. older housing (selected year)",
    opts: [
      {
        id: "ng10",
        label: "New draws ≥10pp more from outside than Mid or Old",
        test: (m, y) => {
          const n = valOf(m, "new", y, "out_mp");
          const mid = valOf(m, "mid", y, "out_mp");
          const old = valOf(m, "old", y, "out_mp");
          return (
            n != null &&
            ((mid != null && n - mid >= 10) || (old != null && n - old >= 10))
          );
        },
      },
    ],
  },
  dist: {
    label: "Long-distance moves (all housing, selected year)",
    opts: [
      {
        id: "d50",
        label: "≥40% moved more than 50 miles",
        test: (m, y) => {
          const v = valOf(m, "all", y, "out_50d");
          return v != null && v >= 40;
        },
      },
      {
        id: "d100",
        label: "≥30% moved more than 100 miles",
        test: (m, y) => {
          const v = valOf(m, "all", y, "out_100d");
          return v != null && v >= 30;
        },
      },
    ],
  },
  own: {
    label: "New housing — tenure (both years, n≥25)",
    opts: [
      {
        id: "t_own",
        label: "Mostly owner-occupied (≥60%)",
        test: (m) => {
          const x = STATS[m].newmix;
          return !!x && x.n >= 25 && x.own >= 60;
        },
      },
      {
        id: "t_rent",
        label: "Mostly renter-occupied (≥60%)",
        test: (m) => {
          const x = STATS[m].newmix;
          return !!x && x.n >= 25 && x.rent >= 60;
        },
      },
    ],
  },
  struct: {
    label: "New housing — structure (both years, n≥25)",
    opts: [
      {
        id: "s_sf",
        label: "Mostly single-family (≥60%)",
        test: (m) => {
          const x = STATS[m].newmix;
          return !!x && x.n >= 25 && x.sf >= 60;
        },
      },
      {
        id: "s_mf",
        label: "Mostly multifamily (≥50%)",
        test: (m) => {
          const x = STATS[m].newmix;
          return !!x && x.n >= 25 && x.mf >= 50;
        },
      },
    ],
  },
  trend: {
    label: "Change 2019→2024 (all housing)",
    opts: [
      {
        id: "less",
        label: "Became less local (outside share rose ≥5pp)",
        test: (m) => {
          const a = valOf(m, "all", "2019", "out_mp");
          const b = valOf(m, "all", "2024", "out_mp");
          return a != null && b != null && b - a >= 5;
        },
      },
      {
        id: "more",
        label: "Became more local (outside share fell ≥5pp)",
        test: (m) => {
          const a = valOf(m, "all", "2019", "out_mp");
          const b = valOf(m, "all", "2024", "out_mp");
          return a != null && b != null && a - b >= 5;
        },
      },
    ],
  },
  region: {
    label: "Census region",
    opts: [
      { id: "r_NE", label: "Northeast", test: (m) => STATS[m].region === "NE" },
      { id: "r_MW", label: "Midwest", test: (m) => STATS[m].region === "MW" },
      { id: "r_S", label: "South", test: (m) => STATS[m].region === "S" },
      { id: "r_W", label: "West", test: (m) => STATS[m].region === "W" },
    ],
  },
  qual: {
    label: "Data quality",
    opts: [
      {
        id: "q_iss",
        label: "Has a flagged data issue",
        test: (m) => (STATS[m].issues || []).length > 0,
      },
      {
        id: "q_dist",
        label: "Distance-inflated (large/rural)",
        test: (m) => (STATS[m].issues || []).some((i) => i.id === "dist"),
      },
      {
        id: "q_supp",
        label: "MIGMET131 suppressed",
        test: (m) => (STATS[m].issues || []).some((i) => i.id === "supp"),
      },
      {
        id: "q_rel",
        label: "New-cohort sample reliable (n≥100 both years)",
        test: (m) => {
          const a = cellOf(m, "new", "2019");
          const b = cellOf(m, "new", "2024");
          return !!a && !!b && a.n >= 100 && b.n >= 100;
        },
      },
    ],
  },
};

let activeFilter = null; // null=no filters, Set=filtered (possibly empty)
const metroSel = document.getElementById("metroSel");
const metroDropdown = document.getElementById("metroDropdown");
const compareSel = document.getElementById("compareSel");
const comparePickWrap = document.getElementById("comparePickWrap");
const compareMetroSel = document.getElementById("compareMetroSel");
const compareDropdown = document.getElementById("compareDropdown");
const filterChips = document.getElementById("filterChips");
const METRO_OPTIONS = [];
let metroHighlight = -1;
let compareHighlight = -1;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPop(pop) {
  if (pop == null || isNaN(pop)) return "Population n/a";
  return `${Math.round(pop).toLocaleString()} people`;
}

function metroMeta(met) {
  const s = STATS[met];
  if (!s) return "";
  const reg = REGION_LABEL[s.region] || s.region || "Region n/a";
  return `${fmtPop(s.pop)} • ${reg}`;
}

function populateMetroList() {
  METRO_OPTIONS.length = 0;
  METRO_OPTIONS.push({ code: "USA", name: STATS.USA.name, meta: metroMeta("USA") });
  Object.keys(STATS)
    .filter((k) => k !== "USA")
    .map((k) => ({ code: k, name: STATS[k].name, meta: metroMeta(k) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((o) => METRO_OPTIONS.push(o));
}

function filterMetroOptions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return METRO_OPTIONS;
  return METRO_OPTIONS.filter(
    (o) => o.name.toLowerCase().includes(q) || (o.meta || "").toLowerCase().includes(q),
  );
}

function filterCompareOptions(query) {
  const q = query.trim().toLowerCase();
  return METRO_OPTIONS.filter((o) => {
    if (o.code === "USA" || o.code === selected) return false;
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) || (o.meta || "").toLowerCase().includes(q)
    );
  });
}

function syncMetroInputToSelection() {
  if (selected === "FILTERED" && activeFilter) {
    metroSel.value = `Filtered set — ${activeFilter.size} metros`;
    return;
  }
  if (selected === "FILTERED_EMPTY") {
    metroSel.value = "Filtered set — no matching metros";
    return;
  }
  if (STATS[selected]) metroSel.value = STATS[selected].name;
}

function syncCompareInput() {
  if (!compareMetroSel) return;
  if (compareTarget && compareTarget !== "USA" && STATS[compareTarget]) {
    compareMetroSel.value = STATS[compareTarget].name;
  } else {
    compareMetroSel.value = "";
  }
}

function closeMetroDropdown() {
  metroDropdown.hidden = true;
  metroSel.setAttribute("aria-expanded", "false");
  metroHighlight = -1;
}

function closeCompareDropdown() {
  if (!compareDropdown) return;
  compareDropdown.hidden = true;
  compareHighlight = -1;
}

function updateMetroHighlight(items, which) {
  const idx = which === "compare" ? compareHighlight : metroHighlight;
  items.forEach((li, i) => {
    li.classList.toggle("active", i === idx);
    if (i === idx) li.scrollIntoView({ block: "nearest" });
  });
}

function pickMetro(code) {
  closeMetroDropdown();
  select(code);
}

function pickCompareMetro(code) {
  compareTarget = code;
  if (compareSel) compareSel.value = "pick";
  if (comparePickWrap) comparePickWrap.hidden = false;
  syncCompareInput();
  closeCompareDropdown();
  renderDetail(selected);
  writeUrlState();
}

function openMetroDropdown(matches) {
  metroHighlight = -1;
  if (!matches.length) {
    metroDropdown.innerHTML =
      '<li class="metro-empty" role="presentation">No matching metros</li>';
    metroDropdown.hidden = false;
    metroSel.setAttribute("aria-expanded", "true");
    return;
  }
  metroDropdown.innerHTML = matches
    .map(
      (o, i) =>
        `<li role="option" data-code="${escapeHtml(o.code)}" data-idx="${i}"><div>${escapeHtml(o.name)}</div><div class="metro-sub">${escapeHtml(o.meta || "")}</div></li>`,
    )
    .join("");
  metroDropdown.hidden = false;
  metroSel.setAttribute("aria-expanded", "true");
  metroDropdown.querySelectorAll("li[data-code]").forEach((li) => {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickMetro(li.dataset.code);
    });
  });
}

function openCompareDropdown(matches) {
  if (!compareDropdown) return;
  compareHighlight = -1;
  if (!matches.length) {
    compareDropdown.innerHTML =
      '<li class="metro-empty" role="presentation">No matching metros</li>';
    compareDropdown.hidden = false;
    return;
  }
  compareDropdown.innerHTML = matches
    .map(
      (o, i) =>
        `<li role="option" data-code="${escapeHtml(o.code)}" data-idx="${i}"><div>${escapeHtml(o.name)}</div><div class="metro-sub">${escapeHtml(o.meta || "")}</div></li>`,
    )
    .join("");
  compareDropdown.hidden = false;
  compareDropdown.querySelectorAll("li[data-code]").forEach((li) => {
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickCompareMetro(li.dataset.code);
    });
  });
}

function onMetroInput() {
  openMetroDropdown(filterMetroOptions(metroSel.value));
}
function onMetroFocus() {
  if (selected !== "FILTERED" && selected !== "FILTERED_EMPTY") metroSel.select();
  openMetroDropdown(filterMetroOptions(metroSel.value));
}

function onMetroKeydown(e) {
  const items = metroDropdown.querySelectorAll("li[data-code]");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (metroDropdown.hidden) openMetroDropdown(filterMetroOptions(metroSel.value));
    const next = metroDropdown.querySelectorAll("li[data-code]");
    metroHighlight = Math.min(metroHighlight + 1, next.length - 1);
    updateMetroHighlight(next, "main");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    metroHighlight = Math.max(metroHighlight - 1, 0);
    updateMetroHighlight(items, "main");
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!metroDropdown.hidden && metroHighlight >= 0 && items[metroHighlight]) {
      pickMetro(items[metroHighlight].dataset.code);
      return;
    }
    const exact = METRO_OPTIONS.find(
      (o) => o.name.toLowerCase() === metroSel.value.trim().toLowerCase(),
    );
    if (exact) pickMetro(exact.code);
    else {
      closeMetroDropdown();
      syncMetroInputToSelection();
    }
  } else if (e.key === "Escape") {
    closeMetroDropdown();
    syncMetroInputToSelection();
  }
}

function onCompareInput() {
  openCompareDropdown(filterCompareOptions(compareMetroSel.value));
}
function onCompareFocus() {
  openCompareDropdown(filterCompareOptions(compareMetroSel.value));
}
function onCompareKeydown(e) {
  const items = compareDropdown.querySelectorAll("li[data-code]");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (compareDropdown.hidden) openCompareDropdown(filterCompareOptions(compareMetroSel.value));
    const next = compareDropdown.querySelectorAll("li[data-code]");
    compareHighlight = Math.min(compareHighlight + 1, next.length - 1);
    updateMetroHighlight(next, "compare");
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    compareHighlight = Math.max(compareHighlight - 1, 0);
    updateMetroHighlight(items, "compare");
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!compareDropdown.hidden && compareHighlight >= 0 && items[compareHighlight]) {
      pickCompareMetro(items[compareHighlight].dataset.code);
      return;
    }
    const exact = filterCompareOptions("").find(
      (o) => o.name.toLowerCase() === compareMetroSel.value.trim().toLowerCase(),
    );
    if (exact) pickCompareMetro(exact.code);
    else {
      closeCompareDropdown();
      syncCompareInput();
    }
  } else if (e.key === "Escape") {
    closeCompareDropdown();
    syncCompareInput();
  }
}

function onMetroClickOutside(e) {
  if (!document.getElementById("metroSearch").contains(e.target)) {
    closeMetroDropdown();
    syncMetroInputToSelection();
  }
  if (
    comparePickWrap &&
    !comparePickWrap.hidden &&
    compareDropdown &&
    !comparePickWrap.contains(e.target)
  ) {
    closeCompareDropdown();
    syncCompareInput();
  }
}

function initMetroSearch() {
  metroSel.addEventListener("input", onMetroInput);
  metroSel.addEventListener("focus", onMetroFocus);
  metroSel.addEventListener("keydown", onMetroKeydown);
  document.addEventListener("click", onMetroClickOutside);
}

function initCompareSearch() {
  if (!compareSel || !comparePickWrap || !compareMetroSel || !compareDropdown) return;
  compareSel.onchange = (e) => {
    const v = e.target.value;
    if (!v) {
      compareTarget = "";
      comparePickWrap.hidden = true;
      closeCompareDropdown();
    } else if (v === "USA") {
      compareTarget = "USA";
      comparePickWrap.hidden = true;
      closeCompareDropdown();
    } else {
      comparePickWrap.hidden = false;
      if (!compareTarget || compareTarget === "USA") compareTarget = "";
      compareMetroSel.focus();
      compareMetroSel.select();
      openCompareDropdown(filterCompareOptions(compareMetroSel.value));
    }
    renderDetail(selected);
    writeUrlState();
  };
  compareMetroSel.addEventListener("input", onCompareInput);
  compareMetroSel.addEventListener("focus", onCompareFocus);
  compareMetroSel.addEventListener("keydown", onCompareKeydown);
}

function buildFilterControls() {
  document.getElementById("filterControls").innerHTML = Object.values(FILTERS)
    .map(
      (g) =>
        `<div class="fgroup"><div class="ftitle">${g.label}</div>` +
        g.opts
          .map(
            (o) =>
              `<label class="fopt"><input type="checkbox" id="f_${o.id}" onchange="refreshFilter()">${o.label}</label>`,
          )
          .join("") +
        "</div>",
    )
    .join("");
}

function checkedFilterIds() {
  const ids = [];
  Object.values(FILTERS).forEach((g) =>
    g.opts.forEach((o) => {
      const el = document.getElementById("f_" + o.id);
      if (el && el.checked) ids.push(o.id);
    }),
  );
  return ids;
}

function computeMatches() {
  const groups = Object.values(FILTERS);
  const checked = groups.map((g) =>
    g.opts.filter((o) => document.getElementById("f_" + o.id).checked),
  );
  if (checked.every((c) => c.length === 0)) return null;
  const y = year;
  const out = new Set();
  Object.keys(STATS).forEach((m) => {
    if (m === "USA") return;
    let ok = true;
    checked.forEach((cs) => {
      if (
        cs.length &&
        !cs.some((o) => {
          try {
            return o.test(m, y);
          } catch {
            return false;
          }
        })
      ) {
        ok = false;
      }
    });
    if (ok) out.add(m);
  });
  return out;
}

function renderFilterResults() {
  const box = document.getElementById("filterResults");
  if (!activeFilter) {
    box.innerHTML = `<i>No filters selected — all ${Object.keys(STATS).length - 1} metros shown.</i>`;
    return;
  }
  if (activeFilter.size === 0) {
    box.innerHTML =
      '<b>No metros match this filter combination.</b><div style="margin-top:6px"><a onclick="clearFilters()">Clear filters</a> or loosen one filter.</div>';
    return;
  }
  const arr = [...activeFilter]
    .map((m) => [m, STATS[m].name])
    .sort((a, b) => a[1].localeCompare(b[1]));
  box.innerHTML =
    `<b>${arr.length} metro${arr.length === 1 ? "" : "s"} match</b> (click to view):<div class="reslist">` +
    arr.map(([m, nm]) => `<a onclick="select('${m}')">${nm}</a>`).join("") +
    "</div>";
}

function renderFilterChips() {
  if (!filterChips) return;
  const checked = [];
  Object.values(FILTERS).forEach((g) =>
    g.opts.forEach((o) => {
      const el = document.getElementById("f_" + o.id);
      if (el && el.checked) checked.push(o);
    }),
  );
  if (!checked.length) {
    filterChips.innerHTML = "";
    return;
  }
  filterChips.innerHTML = checked
    .map(
      (o) =>
        `<button type="button" class="chip" onclick="removeFilterChip('${o.id}')">${escapeHtml(o.label)} <span aria-hidden="true">×</span></button>`,
    )
    .join("");
}

function updateFilterStatus() {
  const count = activeFilter
    ? `${activeFilter.size} metro${activeFilter.size === 1 ? "" : "s"}`
    : "All metros";
  const done = document.getElementById("filterDone");
  if (done) {
    done.textContent = activeFilter
      ? `Done — view ${count} on the map`
      : "Close";
  }
  const badge = document.getElementById("filterBadge");
  if (badge) {
    const c = checkedFilterIds().length;
    badge.hidden = c === 0;
    badge.textContent = String(c);
  }
}

function removeFilterChip(id) {
  const el = document.getElementById("f_" + id);
  if (!el) return;
  el.checked = false;
  refreshFilter();
}

function refreshFilter() {
  activeFilter = computeMatches();
  closeMetroDropdown();

  if (activeFilter === null) {
    if (selected === "FILTERED" || selected === "FILTERED_EMPTY") selected = "USA";
  } else if (activeFilter.size === 0) {
    selected = "FILTERED_EMPTY";
  } else {
    const metroSelected =
      selected !== "USA" &&
      selected !== "FILTERED" &&
      selected !== "FILTERED_EMPTY" &&
      !!STATS[selected];
    if (!metroSelected || !activeFilter.has(selected)) selected = "FILTERED";
  }

  syncMetroInputToSelection();
  renderDetail(selected);
  if (metroLayer) metroLayer.setStyle(styleMetro);
  renderFilterResults();
  renderFilterChips();
  updateFilterStatus();
  writeUrlState();
}

function clearFilters() {
  Object.values(FILTERS).forEach((g) =>
    g.opts.forEach((o) => {
      const el = document.getElementById("f_" + o.id);
      if (el) el.checked = false;
    }),
  );
  refreshFilter();
}

function cellOf(met, coh, yr) {
  const s = STATS[met];
  return s ? s.data[coh + "_" + yr] : null;
}
function valOf(met, coh, yr, key) {
  const c = cellOf(met, coh, yr);
  return c ? c[key] : null;
}
function nOf(met, coh, yr) {
  const c = cellOf(met, coh, yr);
  return c ? c.n : 0;
}

function ramp(v) {
  if (v == null) return "#d9d9d9";
  const s = [
    [0, [255, 255, 204]],
    [25, [254, 217, 118]],
    [50, [253, 141, 60]],
    [75, [227, 26, 28]],
    [100, [150, 0, 60]],
  ];
  for (let i = 0; i < s.length - 1; i++) {
    if (v <= s[i + 1][0]) {
      const [a, b] = [s[i], s[i + 1]];
      const t = (v - a[0]) / (b[0] - a[0]);
      return (
        "rgb(" +
        a[1].map((c, j) => Math.round(c + t * (b[1][j] - c))).join(",") +
        ")"
      );
    }
  }
  return "rgb(150,0,60)";
}

function styleMetro(f) {
  const met = String(f.properties.met);
  const sel = met === selected;
  if (activeFilter && !activeFilter.has(met) && !sel) {
    return {
      fillColor: "#eceff2",
      fillOpacity: 0.3,
      color: "#d5d5d5",
      weight: 0.3,
    };
  }
  const n = nOf(met, cohort, year);
  const v = valOf(met, cohort, year, measure);
  return {
    fillColor: n >= 25 && v != null ? ramp(v) : "#dcdcdc",
    fillOpacity: 0.85,
    color: sel ? "#111" : "#7a7a7a",
    weight: sel ? 2.6 : 0.4,
  };
}

let infoMin = false;
function toggleInfo() {
  infoMin = !infoMin;
  const b = document.getElementById("infobox");
  if (!b) return;
  b.classList.toggle("min", infoMin);
  document.getElementById("ibtoggle").textContent = infoMin ? "+" : "—";
}
function inum(x) {
  return x == null || isNaN(x) ? "—" : Math.round(x).toLocaleString();
}
function imoney(x) {
  return x == null || isNaN(x) ? "—" : "$" + Math.round(x).toLocaleString();
}
function ipct(x) {
  return x == null || isNaN(x) ? "—" : x.toFixed(1) + "%";
}
function isign(x) {
  return x == null || isNaN(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
}

function infoRows(inf) {
  return [
    ["People", true],
    ["Population", inum(inf.pop)],
    ["Pop. change ’15–’24 (%)", isign(inf.pop_chg)],
    ["Median household income", imoney(inf.medinc)],
    ["Poverty rate", ipct(inf.poverty)],
    ["Avg. household size", inf.avghh == null ? "—" : inf.avghh.toFixed(2)],
    ["Housing stock", true],
    ["Housing units", inum(inf.hu)],
    ["Housing change ’15–’24 (%)", isign(inf.hu_chg)],
    ["Single-family detached", ipct(inf.sf_share)],
    ["Homeownership rate", ipct(inf.own_rate)],
    ["Prices & affordability", true],
    ["Median home value", imoney(inf.medval)],
    ["Value change, real ’15–’24", isign(inf.val_chg)],
    ["Median rent", imoney(inf.medrent)],
    ["Rent change, real ’15–’24", isign(inf.rent_chg)],
    ["Value-to-income", inf.vti == null ? "—" : inf.vti.toFixed(1) + "×"],
    ["Rent as % of income", ipct(inf.rent_burden)],
    ["Vacancy", true],
    ["For-sale vacancy", ipct(inf.own_vac)],
    ["Rental vacancy", ipct(inf.rent_vac)],
  ];
}

function profileRowsHtml(inf) {
  const rows = infoRows(inf);
  const row = (l, v) =>
    `<div class="irow"><span class="lbl">${l}</span><span class="val">${v}</span></div>`;
  const sec = (t) => `<div class="isect">${t}</div>`;
  return (
    rows
      .map((r) => (r[1] === true ? sec(r[0]) : row(r[0], r[1])))
      .join("") + `<div class="ibsrc">ACS 1-year: 2024 (2015 for ’15–’24 change)</div>`
  );
}

function profileCardHtml(title, bodyHtml) {
  return (
    `<div class="metro-profile-card">` +
    `<div class="metro-profile-head"><span class="metro-profile-title">${escapeHtml(title)}</span></div>` +
    `<div class="metro-profile-body">${bodyHtml}</div>` +
    `</div>`
  );
}

function renderInfo(subject) {
  const box = document.getElementById("infobox");
  const mobile = document.getElementById("mobileProfileBody");
  const inf =
    subject !== "USA" &&
    subject !== "FILTERED" &&
    subject !== "FILTERED_EMPTY" &&
    STATS[subject]
      ? STATS[subject].info
      : null;

  if (!inf) {
    if (box) box.style.display = "none";
    if (mobile) {
      mobile.innerHTML =
        '<div class="metro-profile-card metro-profile-empty">' +
        "<p>Select a metro on the map or in the search box to see housing and demographic profile data.</p></div>";
    }
    return;
  }

  const html = profileRowsHtml(inf);

  if (box) {
    document.getElementById("ibtitle").textContent = STATS[subject].name;
    document.getElementById("ibbody").innerHTML = html;
    box.classList.toggle("min", infoMin);
    document.getElementById("ibtoggle").textContent = infoMin ? "+" : "—";
    box.style.display = "block";
  }
  if (mobile) {
    mobile.innerHTML = profileCardHtml(STATS[subject].name, html);
  }
}

function isMobileView() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setMobileTab(tab) {
  const wrap = document.getElementById("mobileTabs");
  if (!wrap || !isMobileView()) return;
  const tabs = [...wrap.querySelectorAll("button[data-tab]")];
  tabs.forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.body.classList.remove("mobile-tab-map", "mobile-tab-data", "mobile-tab-profile");
  document.body.classList.add(`mobile-tab-${tab}`);
  if (tab === "data" || tab === "profile") {
    document.getElementById("side")?.scrollTo({ top: 0, behavior: "smooth" });
  }
  syncMapLegendVisibility();
  scheduleMapResize();
}

function moeClass(e, kind) {
  if (e == null) return "moe-0";
  const bins = kind === "mi" ? [3, 6, 10, 16] : [2, 4, 7, 12];
  let i = 0;
  while (i < bins.length && e > bins[i]) i++;
  return `moe-${i}`;
}

const DBINS = [0, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 250]; // must match Python

function binMedian(db) {
  let tot = 0;
  for (const x of db) tot += x;
  if (tot <= 0) return null;
  const half = tot / 2;
  let cum = 0;
  for (let i = 0; i < db.length; i++) {
    if (cum + db[i] >= half) {
      const lo = DBINS[i];
      const hi = i + 1 < DBINS.length ? DBINS[i + 1] : DBINS[i] * 1.6;
      return Math.round(lo + ((half - cum) / (db[i] || 1)) * (hi - lo));
    }
    cum += db[i];
  }
  return DBINS[DBINS.length - 1];
}

function poolCell(mets, coh, yr) {
  const keys = ["out_mp", "out_131", "out_ring", "out_50d", "out_100d"];
  const A = {};
  keys.forEach((k) => {
    A[k] = { W: 0, num: 0, vv: 0 };
  });
  const db = new Array(DBINS.length).fill(0);
  let n = 0;
  mets.forEach((m) => {
    const c = cellOf(m, coh, yr);
    if (!c) return;
    n += c.n || 0;
    const W = c.W || 0;
    keys.forEach((k) => {
      const v = c[k];
      const e = c[k + "_e"];
      if (v != null && W > 0) {
        A[k].W += W;
        A[k].num += W * v;
        A[k].vv += Math.pow(W * (e == null ? 0 : e), 2);
      }
    });
    if (c.db) for (let i = 0; i < db.length; i++) db[i] += c.db[i] || 0;
  });
  if (n === 0) return null;
  const o = { n };
  keys.forEach((k) => {
    if (A[k].W > 0) {
      o[k] = Math.round((A[k].num / A[k].W) * 10) / 10;
      o[k + "_e"] = Math.round((Math.sqrt(A[k].vv) / A[k].W) * 10) / 10;
    } else {
      o[k] = null;
      o[k + "_e"] = null;
    }
  });
  o.med = binMedian(db);
  o.med_e = null;
  return o;
}

function deltaBadge(v, prev) {
  if (v == null || prev == null) return "";
  const d = v - prev;
  if (Math.abs(d) < 5) return "";
  const up = d > 0;
  const arrow = up ? "↑" : "↓";
  const cls = up ? "up" : "down";
  return ` <span class="delta ${cls}" title="Change vs 2019: ${d > 0 ? "+" : ""}${d.toFixed(1)}pp">${arrow}</span>`;
}

function td(c, key, suf, kind, deltaFrom) {
  if (!c) return '<td class="na">—</td>';
  const v = c[key];
  const e = c[key + "_e"];
  const n = c.n;
  if (key === "out_131" && v == null) {
    return '<td class="na" title="MIGMET131 origin suppressed by Census this year — use the MIGPUMA row">n/a*</td>';
  }
  if (v == null) return '<td class="na">—</td>';
  const un = kind === "mi" ? " mi" : " pp";
  const tip =
    v + (suf || "") + (e == null ? "" : "  (±" + e + un + ", 95%)") + "   n=" + n;
  const wide = e != null && e > (kind === "mi" ? 16 : 12) ? " moe-wide" : "";
  return `<td class="${moeClass(e, kind)}${wide}" title="${tip}">${v}${suf || ""}${kind === "pp" ? deltaBadge(v, deltaFrom) : ""}</td>`;
}

const SHADELEG =
  '<div class="shade-leg">Cell shading = 95% margin of error (darker = less certain): ' +
  '<span class="moe-swatch moe-0">±≤2</span> ' +
  '<span class="moe-swatch moe-1">2–4</span> ' +
  '<span class="moe-swatch moe-2">4–7</span> ' +
  '<span class="moe-swatch moe-3">7–12</span> ' +
  '<span class="moe-swatch moe-4">&gt;12&nbsp;pp</span>. Hover any cell for the exact ±.</div>';

function subjectCells(subject) {
  const yrs = ["2019", "2024"];
  const cohs = ["new", "mid", "old"];
  if (subject === "FILTERED" && activeFilter) {
    const mets = [...activeFilter];
    const cells = {};
    cohs.forEach((c) =>
      yrs.forEach((y) => {
        cells[c + "_" + y] = poolCell(mets, c, y);
      }),
    );
    return { cells, pooled: true, count: mets.length };
  }
  if (!STATS[subject]) return { cells: {}, pooled: false, count: 0 };
  return { cells: STATS[subject].data, pooled: false, count: 0 };
}

function compareCell(subject, coh, yr, key) {
  if (subject === "USA") return valOf("USA", coh, yr, key);
  if (subject === "FILTERED" && activeFilter) {
    const c = poolCell([...activeFilter], coh, yr);
    return c ? c[key] : null;
  }
  if (STATS[subject]) return valOf(subject, coh, yr, key);
  return null;
}

function renderCompareBlock(subject) {
  if (!compareTarget) return "";
  if (compareTarget === subject) return "";
  const targetName = compareTarget === "USA" ? STATS.USA.name : STATS[compareTarget]?.name;
  if (!targetName) return "";

  const rows = ["new", "mid", "old"].map((c) => {
    const base = compareCell(subject, c, year, measure);
    const cmp = compareCell(compareTarget, c, year, measure);
    if (base == null || cmp == null) return null;
    const d = base - cmp;
    const label = COHORT_VINTAGE[c]?.full || c;
    return `<div class="cmp-row"><span>${escapeHtml(label)}</span><span>${base.toFixed(1)}% vs ${cmp.toFixed(1)}% (${d > 0 ? "+" : ""}${d.toFixed(1)}pp)</span></div>`;
  });
  const validRows = rows.filter(Boolean);
  if (!validRows.length) {
    return `<div class="compare-block"><b>Compare:</b> ${escapeHtml(targetName)}<div class="compare-empty">No comparable values for current measure/year.</div></div>`;
  }
  return `<div class="compare-block"><div class="compare-title"><b>Compare:</b> ${escapeHtml(targetName)} — ${escapeHtml(MEAS.find((m) => m[0] === measure)[1])}, ${year}</div>${validRows.join("")}</div>`;
}

function mobileMrow(y, cell, prev) {
  const v = cell ? cell[measure] : null;
  const e = cell ? cell[measure + "_e"] : null;
  const n = cell ? cell.n : null;
  if (v == null) {
    return `<div class="mrow"><span>${y}</span><span class="mrow-val na">—</span></div>`;
  }
  const cls = moeClass(e, "pp");
  const wide = e != null && e > 12 ? " moe-wide" : "";
  const tip =
    v.toFixed(1) +
    "%" +
    (e == null ? "" : ` (±${e} pp, 95%)`) +
    (n == null ? "" : `   n=${n}`);
  return (
    `<div class="mrow"><span>${y}</span>` +
    `<span class="mrow-val ${cls}${wide}" title="${tip}">${v.toFixed(1)}%${y === "2024" ? deltaBadge(v, prev) : ""}</span></div>`
  );
}

function renderMobileCards(cells) {
  const yrs = ["2019", "2024"];
  const cohs = ["new", "mid", "old"];
  return `<div class="mobile-cards">${cohs
    .map((c) => {
      const v = COHORT_VINTAGE[c];
      const a = cells[c + "_2019"];
      const b = cells[c + "_2024"];
      return `<div class="mcard"><div class="mcard-head" title="${escapeHtml(v.title)}">${v.label} <span class="mcard-vintage">${v.sub}</span><span class="mcard-range">${v.range}</span></div>${yrs
        .map((y) => {
          const cell = cells[c + "_" + y];
          const prev = y === "2024" && a ? a[measure] : null;
          return mobileMrow(y, cell, prev);
        })
        .join("")}<div class="mrow msub"><span>n (${year})</span><span>${(year === "2024" ? b : a)?.n?.toLocaleString() || "—"}</span></div></div>`;
    })
    .join("")}</div>`;
}

function renderEmptyFiltered() {
  const checked = checkedFilterIds().length;
  return `<div class="empty-state"><h2 class="detail-title">No metros match this filter set</h2><p>Try removing one filter chip or switch year. You currently have <b>${checked}</b> active filter${checked === 1 ? "" : "s"}.</p><p><button type="button" class="btnlite" onclick="clearFilters()">Clear filters</button></p></div>`;
}

function renderDetail(subject) {
  const yrs = ["2019", "2024"];
  const cohs = ["new", "mid", "old"];
  if (subject === "FILTERED_EMPTY") {
    document.getElementById("detail").innerHTML = renderEmptyFiltered();
    renderInfo(subject);
    return;
  }

  const bundle = subjectCells(subject);
  const cells = bundle.cells;
  const pooled = bundle.pooled;
  let head;
  if (pooled) {
    head = `Pooled summary — <b>${bundle.count}</b> filtered metro${bundle.count === 1 ? "" : "s"}`;
  } else {
    const s = STATS[subject];
    head = s.name + (subject === "USA" ? "" : ` <span class="pill">CBSA ${subject}</span>`);
  }

  let h = "";
  if (!pooled && activeFilter && activeFilter.size > 0) {
    h += `<div style="margin:0 0 6px"><a class="backlink" onclick="showFiltered()">↩ Back to pooled summary of ${activeFilter.size} filtered metros</a></div>`;
  }
  h += `<h2 class="detail-title">${head}</h2>`;
  h += renderCompareBlock(subject);
  if (pooled) {
    h +=
      '<p style="font-size:11.5px;color:#666;margin:0 0 8px">Population-weighted across the filtered metros. Shares are exact pooled values; the margins of error and median are pooled estimates.</p>';
  }
  h +=
    '<p class="vintage-hint">Table columns are <b>housing vintage</b> — the age of the unit movers moved into (not the mover’s age).</p>';
  h +=
    '<div class="table-wrap"><table><caption class="sr-only">Migration shares by housing vintage and survey year</caption>';
  h += '<tr><th class="metric" rowspan="2">Measure</th>';
  yrs.forEach((y) => {
    h += `<th class="grp" colspan="3">${y}</th>`;
  });
  h += "</tr><tr>";
  yrs.forEach(() => cohs.forEach((c) => (h += cohortTh(c))));
  h += "</tr>";
  MEAS.forEach((m) => {
    h += `<tr><td class="metric" title="${MEAS_EXPLAIN[m[0]]}">${ROWLAB[m[0]]}</td>`;
    yrs.forEach((y) =>
      cohs.forEach((c) => {
        const cNow = cells[c + "_" + y];
        const cPrev = y === "2024" ? cells[c + "_2019"] : null;
        const prevVal = cPrev ? cPrev[m[0]] : null;
        h += td(cNow, m[0], "%", "pp", prevVal);
      }),
    );
    h += "</tr>";
  });
  h += '<tr><td class="metric">Median miles moved</td>';
  yrs.forEach((y) =>
    cohs.forEach((c) => {
      h += td(cells[c + "_" + y], "med", " mi", "mi");
    }),
  );
  h += "</tr>";
  h += '<tr class="nrow"><td class="metric">n (households surveyed)</td>';
  yrs.forEach((y) =>
    cohs.forEach((c) => {
      const c2 = cells[c + "_" + y];
      h += `<td>${c2 && c2.n != null ? c2.n.toLocaleString() : "—"}</td>`;
    }),
  );
  h += "</tr></table></div>";
  h += renderMobileCards(cells);
  h += SHADELEG;

  if (!pooled && subject !== "USA") {
    const iss = STATS[subject].issues || [];
    if (iss.length) {
      h +=
        '<div style="margin-top:11px">' +
        iss
          .map((o, idx) => {
            const d = ISSUE_DETAIL[o.id] || "No additional details.";
            return `<div class="issue"><div class="issue-top">${ISSUE_BANNER[o.id](o)} <button type="button" class="btn-link issue-toggle" data-target="issue_${idx}" onclick="toggleIssueDetail(this)">Details</button></div><div id="issue_${idx}" class="issue-detail" hidden>${d}</div></div>`;
          })
          .join("") +
        "</div>";
    }
  } else if (pooled) {
    h +=
      '<div style="margin-top:10px;font-size:11.5px;color:#666">Per-metro issue flags (distance, suppression) aren’t shown when pooled — open an individual metro to see them.</div>';
  }

  document.getElementById("detail").innerHTML = h;
  renderInfo(subject);
}

function toggleIssueDetail(btn) {
  const issue = btn.closest(".issue");
  if (!issue) return;
  const det = issue.querySelector(".issue-detail");
  if (!det) return;
  const open = !det.hidden;
  det.hidden = open;
  btn.textContent = open ? "Details" : "Hide details";
}

function showFiltered() {
  if (!activeFilter) return;
  selected = activeFilter.size === 0 ? "FILTERED_EMPTY" : "FILTERED";
  syncMetroInputToSelection();
  renderDetail(selected);
  metroLayer.setStyle(styleMetro);
  writeUrlState();
}

function select(met) {
  closeMetroDropdown();
  selected = met;
  syncMetroInputToSelection();
  renderDetail(met);
  metroLayer.setStyle(styleMetro);
  if (met !== "USA" && met !== "FILTERED" && met !== "FILTERED_EMPTY") {
    const lyr = metroLayer
      .getLayers()
      .find((l) => String(l.feature.properties.met) === met);
    if (lyr) {
      map.fitBounds(lyr.getBounds(), { maxZoom: 7, padding: [40, 40] });
      scheduleMapResize();
    }
  }
  writeUrlState();
}

function recolor() {
  metroLayer.setStyle(styleMetro);
}

function updateLegend() {
  const lbl = MEAS.find((m) => m[0] === measure)?.[1] || "Measure";
  const text = `Map color — ${lbl} (0–100%):`;
  const el = document.getElementById("legendLabel");
  const mapEl = document.getElementById("legendMapLabel");
  if (el) el.textContent = text;
  if (mapEl) mapEl.textContent = text;
}

function syncMapLegendVisibility() {
  const legendMap = document.getElementById("legendMap");
  if (!legendMap) return;
  const showMapLegend =
    isMobileView() && document.body.classList.contains("mobile-tab-map");
  legendMap.hidden = !showMapLegend;
  legendMap.setAttribute("aria-hidden", showMapLegend ? "false" : "true");
}

function initMap() {
  map = L.map("map", { minZoom: 3, maxZoom: 9 }).setView([39, -96], 4);
  L.geoJSON(STATES, {
    style: {
      fillColor: "#eef2f6",
      fillOpacity: 1,
      color: "#fff",
      weight: 1,
    },
    interactive: false,
  }).addTo(map);

  metroLayer = L.geoJSON(METROS, {
    style: styleMetro,
    onEachFeature: (f, layer) => {
      layer.on("click", (evt) => {
        const met = String(f.properties.met);
        const n = nOf(met, cohort, year);
        if (n < 25) {
          layer
            .bindPopup(
              "Too few surveyed households (n&lt;25) for this metro/cohort/year. Try another cohort, year, or use pooled/national views.",
            )
            .openPopup(evt.latlng);
          return;
        }
        select(met);
        if (isMobileView()) setMobileTab("data");
      });
      layer.on("mouseover", function () {
        this.setStyle({ weight: 2, color: "#111" });
        const met = String(f.properties.met);
        const v = valOf(met, cohort, year, measure);
        const n = nOf(met, cohort, year);
        const txt =
          n < 25
            ? "Too few surveyed households (n<25)"
            : `${MEAS.find((m) => m[0] === measure)[1]}: ${v == null ? "n/a" : `${v}%`}`;
        this.bindTooltip(`${f.properties.name}<br>${txt} (n=${n})`, { sticky: true }).openTooltip();
      });
      layer.on("mouseout", function () {
        metroLayer.resetStyle(this);
      });
    },
  }).addTo(map);

  const infoCtl = L.control({ position: "topright" });
  infoCtl.onAdd = function () {
    const d = L.DomUtil.create("div");
    d.id = "infobox";
    d.innerHTML =
      '<div class="ibhead"><span class="ibtitle" id="ibtitle"></span><button class="ibmin" id="ibtoggle" onclick="toggleInfo()" title="Minimize">—</button></div><div class="ibbody" id="ibbody"></div>';
    d.style.display = "none";
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  };
  infoCtl.addTo(map);
  scheduleMapResize();
}

function scheduleMapResize() {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    requestAnimationFrame(() => map.invalidateSize());
  });
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    scheduleMapResize();
    syncMapLegendVisibility();
    initCollapsibleSections();
  }, 150);
});

function initControls() {
  const mSel = document.getElementById("measureSel");
  MEAS.forEach((m) => mSel.add(new Option(m[1], m[0])));
  const cSel = document.getElementById("cohortSel");
  COH.forEach((c) => cSel.add(new Option(c[1], c[0])));

  mSel.onchange = (e) => {
    measure = e.target.value;
    updateLegend();
    recolor();
    renderDetail(selected);
    writeUrlState();
  };
  cSel.onchange = (e) => {
    cohort = e.target.value;
    recolor();
    writeUrlState();
  };
  document.getElementById("yearSel").onchange = (e) => {
    year = e.target.value;
    refreshFilter();
    recolor();
  };

  document.getElementById("notes").innerHTML = [
    "Method: ACS 1-year PUMS (2019, 2024) via IPUMS, household-level (householder, HHWT).",
    "“From outside the metro” = home one year earlier not in the destination CBSA, via the MIGPUMA reconstruction (population-weighted, suppression-free) or the raw MIGMET131.",
    "“Outside metro + adjacent (50 mi)” treats a move as local if the prior home was in the destination metro <i>or</i> in any other metro whose border lies within 50 miles of it, so the row is the share who came from beyond that whole local cluster. Neighboring metros are identified from Census CBSA boundaries (border-to-border ≤ 50 mi). Hover any row label for its definition.",
    "Distance rows use straight-line distance from the origin migration-PUMA’s <i>population-weighted</i> centroid to the destination PUMA centroid.",
    "In a few metros built from enormous, thinly-populated counties (Lake Havasu, Reno, Santa Barbara) the origin zone is so spread out that the distance and median-mile rows still read somewhat high — those metros carry a banner; the metro-based rows are unaffected.",
    "<b>Cell shading = each estimate’s 95% margin of error</b> (darker = wider); heavily shaded cells — small metros, especially the New cohort — are uncertain, so lean on the national row and large metros.",
    "<b>n/a*</b> = MIGMET131 origin suppressed by Census that year (use the MIGPUMA row).",
  ]
    .map((s) => `<div style="margin-bottom:5px">${s}</div>`)
    .join("");
}

function initCollapsibleSections() {
  const openOnDesktop = window.innerWidth > 768;
  const notes = document.getElementById("notesCollapse");
  const issues = document.getElementById("issuesCollapse");
  if (notes) notes.open = openOnDesktop;
  if (issues) issues.open = false;
}

function initMobileTabs() {
  const wrap = document.getElementById("mobileTabs");
  if (!wrap) return;
  wrap.querySelectorAll("button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => setMobileTab(b.dataset.tab));
  });
  setMobileTab("map");
}

function setLoading(active, message) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.hidden = !active;
  if (message) {
    const p = el.querySelector("p");
    if (p) p.textContent = message;
  }
}

function showApp() {
  const loading = document.getElementById("loading");
  const app = document.getElementById("app");
  if (loading) loading.hidden = true;
  if (app) app.hidden = false;
  syncMapLegendVisibility();
}

function setLoadError(message) {
  const el = document.getElementById("loadError");
  if (el) {
    el.hidden = false;
    el.textContent = message;
  }
  setLoading(false);
}

function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  const metro = p.get("metro");
  const m = p.get("measure");
  const c = p.get("cohort");
  const y = p.get("year");
  const comp = p.get("compare");
  const filters = p.get("filters");

  if (m && MEAS.some((x) => x[0] === m)) measure = m;
  if (c && COH.some((x) => x[0] === c)) cohort = c;
  if (y === "2019" || y === "2024") year = y;
  if (metro && STATS[metro]) {
    selected = metro;
    requestedMetroFromUrl = metro;
  }

  if (comp) {
    if (comp === "USA") compareTarget = "USA";
    else if (STATS[comp] && comp !== "USA") compareTarget = comp;
  }

  if (filters) {
    const ids = new Set(
      filters
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    Object.values(FILTERS).forEach((g) =>
      g.opts.forEach((o) => {
        const el = document.getElementById("f_" + o.id);
        if (el) el.checked = ids.has(o.id);
      }),
    );
  }
}

function writeUrlState() {
  const params = new URLSearchParams();
  if (selected && selected !== "FILTERED" && selected !== "FILTERED_EMPTY") {
    params.set("metro", selected);
  }
  params.set("measure", measure);
  params.set("cohort", cohort);
  params.set("year", year);
  if (compareTarget) params.set("compare", compareTarget);
  const fids = checkedFilterIds();
  if (fids.length) params.set("filters", fids.join(","));

  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  history.replaceState({}, "", next);
}

function applyStateToControls() {
  const mSel = document.getElementById("measureSel");
  const cSel = document.getElementById("cohortSel");
  const ySel = document.getElementById("yearSel");
  mSel.value = measure;
  cSel.value = cohort;
  ySel.value = year;

  if (compareSel) {
    if (!compareTarget) {
      compareSel.value = "";
      comparePickWrap.hidden = true;
    } else if (compareTarget === "USA") {
      compareSel.value = "USA";
      comparePickWrap.hidden = true;
    } else {
      compareSel.value = "pick";
      comparePickWrap.hidden = false;
      syncCompareInput();
    }
  }
}

async function loadData() {
  const base = document.querySelector("base")?.href || "";
  const fetchJson = (path) =>
    fetch(base + path).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
      return r.json();
    });

  [STATS, METROS, STATES] = await Promise.all([
    fetchJson("data/stats.json"),
    fetchJson("data/metros.geojson"),
    fetchJson("data/states.geojson"),
  ]);
}

async function initApp() {
  try {
    setLoading(true, "Loading migration data…");
    await loadData();
    buildFilterControls();
    initControls();
    populateMetroList();
    readUrlState();
    applyStateToControls();
    initMetroSearch();
    initCompareSearch();
    initMobileTabs();
    initMap();
    initCollapsibleSections();
    updateLegend();
    refreshFilter();

    if (activeFilter && activeFilter.size > 0 && requestedMetroFromUrl && activeFilter.has(requestedMetroFromUrl)) {
      select(requestedMetroFromUrl);
    } else if (!activeFilter) {
      select(selected || "USA");
    } else if (activeFilter.size === 0) {
      selected = "FILTERED_EMPTY";
      syncMetroInputToSelection();
      renderDetail("FILTERED_EMPTY");
    } else {
      selected = "FILTERED";
      syncMetroInputToSelection();
      renderDetail("FILTERED");
    }

    showApp();
  } catch (err) {
    console.error(err);
    setLoadError(
      "Could not load data files. Serve this folder over HTTP (e.g. python -m http.server 8000), then open http://localhost:8000/. Opening index.html directly from disk will not work.",
    );
  }
}

initApp();

// Inline handlers in HTML call these on window.
window.openFilter = openFilter;
window.closeFilter = closeFilter;
window.refreshFilter = refreshFilter;
window.clearFilters = clearFilters;
window.select = select;
window.showFiltered = showFiltered;
window.toggleInfo = toggleInfo;
window.toggleIssueDetail = toggleIssueDetail;
window.removeFilterChip = removeFilterChip;
window.openShortcuts = openShortcuts;
window.closeShortcuts = closeShortcuts;
