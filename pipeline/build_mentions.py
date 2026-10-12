"""Who talks about whom: how often each speech names each other country.

For every speech, counts mentions of every country by name, including UN
formal names ("Syrian Arab Republic") and former names ("Zaire", "Kampuchea").
Writes one small file per mentioned country,
public/data/mentions/{iso3}.json: {year: {speaker iso3: count}}, so the site
only downloads the country someone asks about.

Deliberately simple and transparent:
- Names only, not adjectives ("Israel" counts, "Israeli" doesn't), because many
  adjectives are ambiguous ("American", "Indian Ocean").
- Longer names are matched first, so "Papua New Guinea" isn't also "Guinea".
- Names that could mean two countries ("Congo", "Korea") are skipped.
- A country mentioning itself isn't counted.

Run from the project root:  python3 pipeline/build_mentions.py
"""

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEECH_DIR = ROOT / "pipeline" / "cache" / "ungdc" / "TXT"
OUTPUT = ROOT / "public" / "data" / "mentions"
SPEECH_NAME = re.compile(r"(?P<code>[A-Z]{2,3})_\d+_(?P<year>\d{4})\.txt")

# Names to look for, beyond each country's everyday English name on the map.
# None means "recognise this name, but don't count it" — it's either ambiguous
# or would otherwise be misread as a shorter name inside it.
EXTRA_NAMES = {
    "United States": "USA", "United States of America": "USA", "USA": "USA",
    "United Kingdom": "GBR", "Britain": "GBR", "Great Britain": "GBR",
    "Russia": "RUS", "Russian Federation": "RUS", "Soviet Union": "RUS", "USSR": "RUS",
    "Union of Soviet Socialist Republics": "RUS",
    "China": "CHN", "People's Republic of China": "CHN", "Republic of China": "TWN", "Taiwan": "TWN", "Formosa": "TWN",
    "Republic of Korea": "KOR", "South Korea": "KOR",
    "Democratic People's Republic of Korea": "PRK", "North Korea": "PRK", "Korea": None,
    "Democratic Republic of the Congo": "COD", "Zaire": "COD",
    "Republic of the Congo": "COG", "Congo-Brazzaville": "COG", "Congo": None,
    "Syrian Arab Republic": "SYR", "Syria": "SYR",
    "Libyan Arab Jamahiriya": "LBY", "Libya": "LBY",
    "Iran": "IRN", "Islamic Republic of Iran": "IRN",
    "Viet Nam": "VNM", "Viet-Nam": "VNM", "Vietnam": "VNM",
    "Lao People's Democratic Republic": "LAO", "Laos": "LAO",
    "Kampuchea": "KHM", "Democratic Kampuchea": "KHM", "Cambodia": "KHM",
    "Burma": "MMR", "Myanmar": "MMR",
    "Ceylon": "LKA", "Sri Lanka": "LKA",
    "Rhodesia": "ZWE", "Southern Rhodesia": "ZWE", "Zimbabwe": "ZWE", "Northern Rhodesia": "ZMB",
    "South West Africa": "NAM", "Namibia": "NAM",
    "Dahomey": "BEN", "Upper Volta": "BFA", "Gold Coast": "GHA", "Tanganyika": "TZA",
    "East Pakistan": "BGD", "Siam": "THA",
    "Côte d'Ivoire": "CIV", "Cote d'Ivoire": "CIV", "Ivory Coast": "CIV",
    "Cabo Verde": "CPV", "Cape Verde": "CPV",
    "Timor-Leste": "TLS", "East Timor": "TLS",
    "Swaziland": "SWZ", "Eswatini": "SWZ",
    "Czechoslovakia": "CSK", "Czech Republic": "CZE", "Czechia": "CZE",
    "Yugoslavia": "YUG",
    "German Democratic Republic": "DDR", "East Germany": "DDR",
    "Federal Republic of Germany": "DEU", "West Germany": "DEU", "Germany": "DEU",
    "Democratic Yemen": "YMD", "South Yemen": "YMD", "Yemen": "YEM",
    "Palestine": "PSE", "State of Palestine": "PSE",
    "Holy See": "VAT", "Vatican": "VAT",
    "Netherlands": "NLD", "Holland": "NLD",
    "Bosnia and Herzegovina": "BIH", "Bosnia": "BIH",
    "The former Yugoslav Republic of Macedonia": "MKD", "North Macedonia": "MKD", "Macedonia": "MKD",
    "Micronesia": "FSM", "Bahamas": "BHS", "Gambia": "GMB",
    "Brunei Darussalam": "BRN", "Türkiye": "TUR",
    # Contain a shorter country name but aren't that country.
    "Northern Ireland": None, "American Samoa": None, "New Caledonia": None,
    "Guinea-Bissau": "GNB", "Equatorial Guinea": "GNQ", "Papua New Guinea": "PNG",
    "South Sudan": "SSD", "Dominican Republic": "DOM",
}


def build_names():
    topology = json.loads((ROOT / "public" / "data" / "countries.topo.json").read_text())
    names = {}
    for geometry in topology["objects"]["countries"]["geometries"]:
        props = geometry["properties"]
        names[props["name"]] = props["iso3"]
    names.update(EXTRA_NAMES)
    return names


def main():
    names = build_names()
    # Longest first, so the longest name at each position wins. Case-sensitive,
    # so "turkey" (the bird) or "china" (porcelain) aren't counted.
    alternatives = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    pattern = re.compile(rf"(?<![A-Za-z])(?:{alternatives})(?![A-Za-z])")

    counts = defaultdict(lambda: defaultdict(dict))  # target -> year -> speaker -> n
    speeches = 0
    for path in sorted(SPEECH_DIR.glob("*/*.txt")):
        match = SPEECH_NAME.fullmatch(path.name)
        if not match:
            continue
        speaker, year = match["code"], match["year"]
        text = " ".join(path.read_text(encoding="utf-8", errors="replace").split())
        speeches += 1
        for found in pattern.finditer(text):
            target = names[found.group(0)]
            if target and target != speaker:
                by_speaker = counts[target][year]
                by_speaker[speaker] = by_speaker.get(speaker, 0) + 1

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob("*.json"):
        old.unlink()
    for target, by_year in counts.items():
        (OUTPUT / f"{target}.json").write_text(json.dumps(by_year, separators=(",", ":"), sort_keys=True))
    total = sum(n for by_year in counts.values() for by_speaker in by_year.values() for n in by_speaker.values())
    print(f"Counted {total} mentions of {len(counts)} countries in {speeches} speeches -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
