"""Build the country shapes the map draws.

Downloads Natural Earth's 1:50m country borders (public domain), keeps only
the fields the site needs, rounds coordinates to shrink the file, and writes
pipeline/build/countries.geojson. pipeline/build_topology.mjs then packs that
into the compact file the site loads.

Run from the project root:  npm run build:map
"""

import json
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_0_countries.geojson"
)
OUTPUT = Path(__file__).resolve().parent / "build" / "countries.geojson"

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


# Natural Earth's English names are mostly the familiar short forms; these are
# the exceptions, swapped for the plainer everyday name.
NAME_FIXES = {
    "People's Republic of China": "China",
    "Turkish Republic of Northern Cyprus": "Northern Cyprus",
}


def round_coords(value):
    if isinstance(value, (int, float)):
        return round(value, PRECISION)
    return [round_coords(v) for v in value]


def main():
    with urllib.request.urlopen(SOURCE_URL) as response:
        source = json.load(response)

    # A few territories share their country's ISO code (Ashmore and Cartier
    # Islands use Australia's). Codes must be unique, or the map mixes up names
    # and shapes, so the country itself keeps the code and territories use
    # their own Natural Earth code instead.
    codes = [country_code(f["properties"]) for f in source["features"]]
    shared = {c for c in codes if codes.count(c) > 1}

    features = []
    for feature, code in zip(source["features"], codes):
        props = feature["properties"]
        if code in shared and props["ADM0_A3"] != code:
            code = props["ADM0_A3"]
        features.append({
            "type": "Feature",
            "properties": {
                "iso3": code,
                "name": NAME_FIXES.get(props["NAME_EN"], props["NAME_EN"] or props["NAME"]),
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
