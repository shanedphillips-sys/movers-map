#!/usr/bin/env python3
"""Extract embedded data from the legacy monolithic index.html into data/."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "legacy" / "index.monolith.html"


def extract(source: Path) -> tuple[dict, dict, dict, str]:
    html = source.read_text(encoding="utf-8")
    data_start = html.index("const STATS=")
    data_end = html.index(";\nconst MEAS=")
    chunk = html[data_start + len("const ") : data_end]
    match = re.match(
        r"STATS=(\{.*\}), METROS=(\{.*\}), STATES=(\{.*\})$",
        chunk,
        re.DOTALL,
    )
    if not match:
        raise ValueError("Could not parse STATS / METROS / STATES from source HTML")

    stats = json.loads(match.group(1))
    metros = json.loads(match.group(2))
    states = json.loads(match.group(3))

    css_match = re.search(r"<style>(.*?)</style>", html, re.DOTALL)
    css = css_match.group(1).strip() if css_match else ""

    return stats, metros, states, css


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Monolithic HTML file (default: {DEFAULT_SOURCE})",
    )
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit(f"Source not found: {args.source}")

    stats, metros, states, css = extract(args.source)
    data_dir = ROOT / "data"
    src_dir = ROOT / "src"
    data_dir.mkdir(exist_ok=True)
    src_dir.mkdir(exist_ok=True)

    (data_dir / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (data_dir / "metros.geojson").write_text(
        json.dumps(metros, ensure_ascii=False),
        encoding="utf-8",
    )
    (data_dir / "states.geojson").write_text(
        json.dumps(states, ensure_ascii=False),
        encoding="utf-8",
    )

    css_path = src_dir / "styles.css"
    if css:
        css_path.write_text(css + "\n", encoding="utf-8")

    print(f"Wrote {data_dir / 'stats.json'} ({len(stats)} metros)")
    print(f"Wrote {data_dir / 'metros.geojson'} ({len(metros['features'])} features)")
    print(f"Wrote {data_dir / 'states.geojson'} ({len(states['features'])} features)")
    if css:
        print(f"Wrote {css_path}")


if __name__ == "__main__":
    main()
