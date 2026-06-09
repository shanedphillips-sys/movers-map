#!/usr/bin/env python3
"""Validate data/stats.json and metros.geojson against the frontend contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

COHORTS = ("all", "new", "mid", "old")
YEARS = ("2019", "2024")  # keep in sync with src/app.js when adding survey years
MEASURES = ("out_mp", "out_131", "out_ring", "out_50d", "out_100d")
MOE_MEASURES = MEASURES
VINTAGE_COHORTS = ("new", "mid", "old")
DBINS_LEN = 12


def main() -> int:
    stats_path = DATA / "stats.json"
    metros_path = DATA / "metros.geojson"

    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    metros = json.loads(metros_path.read_text(encoding="utf-8"))

    errors: list[str] = []
    warnings: list[str] = []

    if "USA" not in stats:
        errors.append('Missing top-level "USA" pooled row')

    metro_codes = [k for k in stats if k != "USA"]
    geo_codes = {str(f["properties"]["met"]) for f in metros["features"]}

    for code in sorted(metro_codes):
        rec = stats[code]
        for field in ("name", "pop", "region", "data"):
            if field not in rec:
                errors.append(f"{code}: missing field '{field}'")

        data = rec.get("data", {})
        for cohort in COHORTS:
            for year in YEARS:
                key = f"{cohort}_{year}"
                if key not in data:
                    errors.append(f"{code}: missing data cell '{key}'")
                    continue
                cell = data[key]
                if cell is None:
                    warnings.append(f"{code}.{key}: null cell (no surveyed households)")
                    continue
                if not isinstance(cell, dict):
                    errors.append(f"{code}.{key}: cell is not an object")
                    continue
                if "n" not in cell:
                    errors.append(f"{code}.{key}: missing 'n'")

                if cohort in VINTAGE_COHORTS:
                    if "W" not in cell:
                        warnings.append(f"{code}.{key}: missing 'W' (pooling may fail)")
                    for m in MOE_MEASURES:
                        if m in cell and cell[m] is not None and f"{m}_e" not in cell:
                            warnings.append(f"{code}.{key}: '{m}' without '{m}_e'")
                    db = cell.get("db")
                    if db is not None and len(db) != DBINS_LEN:
                        errors.append(
                            f"{code}.{key}: db length {len(db)} != {DBINS_LEN}"
                        )

        if code not in geo_codes:
            warnings.append(f"{code}: in stats.json but not metros.geojson")

    for code in sorted(geo_codes):
        if code not in stats:
            errors.append(f"{code}: in metros.geojson but not stats.json")

    print(f"Metros in stats: {len(metro_codes)}")
    print(f"Features in metros.geojson: {len(geo_codes)}")
    print(f"Survey years checked: {', '.join(YEARS)}")

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings[:20]:
            print(f"  - {w}")
        if len(warnings) > 20:
            print(f"  ... and {len(warnings) - 20} more")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors[:30]:
            print(f"  - {e}")
        if len(errors) > 30:
            print(f"  ... and {len(errors) - 30} more")
        return 1

    print("\nValidation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
