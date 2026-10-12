"""Download World Bank indicators and write one small file per indicator.

Each indicator is paired with a speech topic, so the site can show what a
country says next to what the numbers show. All of these are published by the
World Bank under CC BY 4.0. (Military spending is deliberately missing: its
source, SIPRI, doesn't allow republishing the full data set.)

Uses only the standard library, so GitHub Actions can run it without installing
anything. Run from the project root:  python3 pipeline/build_indicators.py
"""

import json
import math
import time
import urllib.request
from pathlib import Path

API = "https://api.worldbank.org/v2"
FIRST_YEAR = 1960
OUTPUT = Path(__file__).resolve().parent.parent / "public" / "data" / "indicators"

INDICATORS = [
    {"id": "gdp_pc", "code": "NY.GDP.PCAP.CD", "label": "GDP per person", "unit": "US$", "pairs": "development", "source": "national accounts data"},
    {"id": "co2_pc", "code": "EN.GHG.CO2.PC.CE.AR5", "label": "CO₂ emissions per person", "unit": "tonnes", "pairs": "climate", "source": "EDGAR, EU Joint Research Centre"},
    {"id": "life_exp", "code": "SP.DYN.LE00.IN", "label": "Life expectancy", "unit": "years", "pairs": "health", "source": "UN World Population Prospects"},
    {"id": "women_parl", "code": "SG.GEN.PARL.ZS", "label": "Women in parliament", "unit": "% of seats", "pairs": "gender", "source": "Inter-Parliamentary Union"},
    {"id": "internet", "code": "IT.NET.USER.ZS", "label": "Internet users", "unit": "% of people", "pairs": "technology", "source": "International Telecommunication Union"},
    {
        "id": "ext_debt", "code": "DT.DOD.DECT.GN.ZS", "label": "Foreign debt", "unit": "% of national income", "pairs": "debt",
        "source": "International Debt Statistics",
        "note": "Only covers low- and middle-income countries.",
    },
    {"id": "trade_gdp", "code": "NE.TRD.GNFS.ZS", "label": "Trade", "unit": "% of GDP", "pairs": "trade", "source": "national accounts data"},
    {"id": "hunger", "code": "SN.ITK.DEFC.ZS", "label": "Undernourishment", "unit": "% of people", "pairs": "food_water", "source": "UN Food and Agriculture Organization"},
]

# The World Bank's code for Kosovo differs from the one on our map.
CODE_FIXES = {"XKX": "KOS"}


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                return json.load(response)
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def real_countries():
    """World Bank codes for actual countries, leaving out groups like 'World' or 'Euro area'."""
    rows = get(f"{API}/country?format=json&per_page=500")[1]
    return {row["id"] for row in rows if row["region"]["value"] != "Aggregates"}


def round_sig(value, digits=3):
    if value == 0:
        return 0
    rounded = round(value, digits - 1 - math.floor(math.log10(abs(value))))
    return int(rounded) if rounded == int(rounded) and abs(rounded) >= 100 else rounded


def main():
    # The site keeps topics and indicators in one list, so their ids must differ.
    from topics import TOPICS
    clashes = {i["id"] for i in INDICATORS} & {t["id"] for t in TOPICS}
    if clashes:
        raise SystemExit(f"Indicator ids clash with topic ids: {clashes}")

    countries = real_countries()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    index = []

    for indicator in INDICATORS:
        last_year = time.gmtime().tm_year
        rows = get(
            f"{API}/country/all/indicator/{indicator['code']}"
            f"?format=json&per_page=30000&date={FIRST_YEAR}:{last_year}"
        )[1]
        values = {}
        for row in rows:
            code = row["countryiso3code"]
            if row["value"] is None or code not in countries:
                continue
            values.setdefault(CODE_FIXES.get(code, code), {})[row["date"]] = round_sig(row["value"])

        if len(values) < 100:
            raise SystemExit(f"{indicator['code']}: only {len(values)} countries came back — refusing to overwrite")

        years = sorted({int(y) for by_year in values.values() for y in by_year})
        with (OUTPUT / f"{indicator['id']}.json").open("w") as f:
            json.dump({"years": [years[0], years[-1]], "values": values}, f, separators=(",", ":"), sort_keys=True)

        index.append({**indicator, "years": [years[0], years[-1]]})
        print(f"{indicator['id']:11} {len(values):3} countries, {years[0]}–{years[-1]}")

    with (OUTPUT / "index.json").open("w") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
