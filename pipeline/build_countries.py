"""Build the country shapes the map draws.

Downloads Natural Earth's 1:50m country borders (public domain), keeps only
the fields the site needs, rounds coordinates to shrink the file, and writes
public/data/countries.geojson.

Run from the project root:  python3 pipeline/build_countries.py
"""

import json
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_0_countries.geojson"
)
OUTPUT = Path(__file__).resolve().parent.parent / "public" / "data" / "countries.geojson"

# 3 decimal places is roughly 100 m — far finer than the map ever needs.
PRECISION = 3


def country_code(props):
    # ISO_A3 is "-99" for France, Norway and a few others; ISO_A3_EH fixes
    # most of those, and ADM0_A3 covers disputed areas like Kosovo.
    for key in ("ISO_A3_EH", "ISO_A3", "ADM0_A3"):
        code = props.get(key)
        if code and code != "-99":
            return code
    return None


def round_coords(value):
    if isinstance(value, (int, float)):
        return round(value, PRECISION)
    return [round_coords(v) for v in value]


def main():
    with urllib.request.urlopen(SOURCE_URL) as response:
        source = json.load(response)

    features = []
    for feature in source["features"]:
        props = feature["properties"]
        features.append({
            "type": "Feature",
            "properties": {
                "iso3": country_code(props),
                "name": props["NAME"],
                "continent": props["CONTINENT"],
            },
            "geometry": {
                "type": feature["geometry"]["type"],
                "coordinates": round_coords(feature["geometry"]["coordinates"]),
            },
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

    print(f"Wrote {len(features)} countries to {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
