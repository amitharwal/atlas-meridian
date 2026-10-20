"""Download World Bank indicators and write the files the site reads.

Writes, into public/data/:
  indicators/<id>.json   one per indicator, every country and year (for the map)
  indicators/index.json  the list of indicators, their groups and labels
  indicators/world.json  the median country for each indicator and year
  stats/<ISO3>.json      one per country, every indicator (for its card and page)
  regions.json           World Bank region and income group for each country
  indicators/updated.json  the date the figures last changed, shown on the site

Some indicators are paired with a UN speech topic, so the site can show what a
country says next to what the numbers show. All of these are published by the
World Bank under CC BY 4.0. (Military spending is deliberately missing: its
source, SIPRI, doesn't allow republishing the full data set.)

Uses only the standard library, so GitHub Actions can run it without installing
anything. Run from the project root:  python3 pipeline/build_indicators.py
"""

import json
import math
import statistics
import time
import urllib.request
from pathlib import Path

API = "https://api.worldbank.org/v2"
FIRST_YEAR = 1960
DATA = Path(__file__).resolve().parent.parent / "public" / "data"
OUTPUT = DATA / "indicators"
STATS = DATA / "stats"

# Groups, in the order the site lists them.
PEOPLE = "People"
ECONOMY = "Economy"
POVERTY = "Poverty & inequality"
HEALTH = "Health"
EDUCATION = "Education"
ENVIRONMENT = "Environment & energy"
TECHNOLOGY = "Technology"
SOCIETY = "Society & safety"

# Money figures are in constant dollars: the map's colours are fixed across all
# years, so in today's dollars inflation alone would make the past look poor.
REAL_TERMS = "Adjusted for inflation (2015 US dollars), so years can be compared."

# format: how a value is written. "usd" ($48.2K), "pct" (12.5%), or "number"
# (3 significant figures, then `suffix`). signed: can go below zero, so it's
# compared with the median by showing the median ("median 3.1%"), not a ratio. carry: how many years an old figure
# may stand in for a missing one; surveys like Gini are only run every few years.
INDICATORS = [
    {"id": "population", "code": "SP.POP.TOTL", "label": "Population", "unit": "people", "format": "number", "group": PEOPLE, "source": "UN World Population Prospects", "keywords": "people size inhabitants"},
    {"id": "density", "code": "EN.POP.DNST", "label": "Population density", "unit": "people per km² of land", "format": "number", "suffix": "/km²", "group": PEOPLE, "source": "UN World Population Prospects and FAO", "keywords": "crowded"},
    {"id": "fertility", "code": "SP.DYN.TFRT.IN", "label": "Births per woman", "unit": "births per woman", "format": "number", "group": PEOPLE, "source": "UN World Population Prospects", "keywords": "fertility children babies"},
    {"id": "over_65", "code": "SP.POP.65UP.TO.ZS", "label": "Aged 65 and over", "unit": "% of people", "format": "pct", "group": PEOPLE, "source": "UN World Population Prospects", "keywords": "old ageing elderly pensioners"},
    {"id": "urban", "code": "SP.URB.TOTL.IN.ZS", "label": "Living in cities", "unit": "% of people", "format": "pct", "group": PEOPLE, "source": "UN World Urbanization Prospects", "keywords": "urban towns rural"},
    {"id": "migrants", "code": "SM.POP.TOTL.ZS", "label": "Born abroad", "unit": "% of people", "format": "pct", "group": PEOPLE, "pairs": "migration", "carry": 5, "source": "UN Population Division", "keywords": "migrants immigrants foreign-born migration", "note": "Estimated every five years."},

    {"id": "gdp", "code": "NY.GDP.MKTP.KD", "label": "Size of the economy (GDP)", "unit": "US$ at 2015 prices", "format": "usd", "group": ECONOMY, "source": "national accounts data", "keywords": "gdp economy output total", "note": REAL_TERMS},
    {"id": "gdp_pc", "code": "NY.GDP.PCAP.KD", "label": "GDP per person", "unit": "US$ at 2015 prices", "format": "usd", "group": ECONOMY, "pairs": "development", "source": "national accounts data", "keywords": "economy wealth income rich poor money", "note": REAL_TERMS},
    {"id": "growth", "code": "NY.GDP.MKTP.KD.ZG", "label": "Economic growth", "unit": "% a year", "format": "pct", "signed": True, "group": ECONOMY, "source": "national accounts data", "keywords": "gdp growth recession"},
    {"id": "inflation", "code": "FP.CPI.TOTL.ZG", "label": "Inflation", "unit": "% a year, consumer prices", "format": "pct", "signed": True, "group": ECONOMY, "source": "IMF International Financial Statistics", "keywords": "prices cost of living"},
    {"id": "unemployment", "code": "SL.UEM.TOTL.ZS", "label": "Unemployment", "unit": "% of workforce", "format": "pct", "group": ECONOMY, "source": "International Labour Organization estimates", "keywords": "jobs work jobless"},
    {"id": "trade_gdp", "code": "NE.TRD.GNFS.ZS", "label": "Trade", "unit": "% of GDP", "format": "pct", "group": ECONOMY, "pairs": "trade", "source": "national accounts data", "keywords": "exports imports economy"},
    {"id": "gov_debt", "code": "GC.DOD.TOTL.GD.ZS", "label": "Government debt", "unit": "% of GDP", "format": "pct", "group": ECONOMY, "source": "IMF Government Finance Statistics", "keywords": "public debt borrowing", "note": "Many countries don't report this."},
    {"id": "ext_debt", "code": "DT.DOD.DECT.GN.ZS", "label": "Foreign debt", "unit": "% of national income", "format": "pct", "group": ECONOMY, "pairs": "debt", "source": "International Debt Statistics", "keywords": "debt loans borrowing external", "note": "Only covers low- and middle-income countries."},
    {"id": "remittances", "code": "BX.TRF.PWKR.DT.GD.ZS", "label": "Money sent home from abroad", "unit": "% of GDP", "format": "pct", "group": ECONOMY, "source": "IMF Balance of Payments", "keywords": "remittances diaspora"},
    {"id": "tourism", "code": "ST.INT.ARVL", "label": "Tourist arrivals", "unit": "visitors a year", "format": "number", "group": ECONOMY, "source": "UN Tourism", "keywords": "tourists travel visitors holiday"},

    {"id": "gini", "code": "SI.POV.GINI", "label": "Income inequality (Gini)", "unit": "0 = equal, 100 = unequal", "format": "number", "group": POVERTY, "carry": 5, "source": "World Bank Poverty and Inequality Platform", "keywords": "gini inequality gap rich poor", "note": "Based on household surveys, run every few years."},
    {"id": "poverty", "code": "SI.POV.DDAY", "label": "Extreme poverty", "unit": "% living on under $3 a day", "format": "pct", "group": POVERTY, "carry": 5, "source": "World Bank Poverty and Inequality Platform", "keywords": "poor poverty", "note": "Based on household surveys, run every few years. $3 a day at 2021 prices."},
    {"id": "hunger", "code": "SN.ITK.DEFC.ZS", "label": "Undernourishment", "unit": "% of people", "format": "pct", "group": POVERTY, "pairs": "food_water", "source": "UN Food and Agriculture Organization", "keywords": "food famine malnutrition hunger"},

    {"id": "life_exp", "code": "SP.DYN.LE00.IN", "label": "Life expectancy", "unit": "years at birth", "format": "number", "suffix": " yrs", "group": HEALTH, "pairs": "health", "source": "UN World Population Prospects", "keywords": "health lifespan age death"},
    {"id": "child_deaths", "code": "SH.DYN.MORT", "label": "Child deaths", "unit": "under-5 deaths per 1,000 births", "format": "number", "group": HEALTH, "source": "UN Inter-agency Group for Child Mortality Estimation", "keywords": "child mortality babies infant"},
    {"id": "health_spend", "code": "SH.XPD.CHEX.GD.ZS", "label": "Health spending", "unit": "% of GDP", "format": "pct", "group": HEALTH, "source": "World Health Organization", "keywords": "healthcare doctors hospitals"},
    {"id": "water", "code": "SH.H2O.SMDW.ZS", "label": "Safe drinking water", "unit": "% of people", "format": "pct", "group": HEALTH, "source": "WHO/UNICEF Joint Monitoring Programme", "keywords": "water sanitation"},

    {"id": "literacy", "code": "SE.ADT.LITR.ZS", "label": "Adult literacy", "unit": "% of people 15 and over", "format": "pct", "group": EDUCATION, "carry": 5, "source": "UNESCO Institute for Statistics", "keywords": "reading writing school", "note": "Many countries report this only occasionally."},
    {"id": "edu_spend", "code": "SE.XPD.TOTL.GD.ZS", "label": "Education spending", "unit": "% of GDP", "format": "pct", "group": EDUCATION, "carry": 3, "source": "UNESCO Institute for Statistics", "keywords": "schools teachers government"},

    {"id": "co2_pc", "code": "EN.GHG.CO2.PC.CE.AR5", "label": "CO₂ emissions per person", "unit": "tonnes", "format": "number", "suffix": " t", "group": ENVIRONMENT, "pairs": "climate", "source": "EDGAR, EU Joint Research Centre", "keywords": "carbon co2 emissions pollution greenhouse climate"},
    {"id": "renewables", "code": "EG.FEC.RNEW.ZS", "label": "Renewable energy", "unit": "% of energy used", "format": "pct", "group": ENVIRONMENT, "source": "IEA, IRENA, UN Statistics Division", "keywords": "solar wind hydro green clean energy"},
    {"id": "electricity", "code": "EG.ELC.ACCS.ZS", "label": "Access to electricity", "unit": "% of people", "format": "pct", "group": ENVIRONMENT, "source": "World Bank Global Electrification Database", "keywords": "power energy"},
    {"id": "forest", "code": "AG.LND.FRST.ZS", "label": "Forest", "unit": "% of land", "format": "pct", "group": ENVIRONMENT, "source": "UN Food and Agriculture Organization", "keywords": "trees deforestation woods"},
    {"id": "air", "code": "EN.ATM.PM25.MC.M3", "label": "Air pollution (PM2.5)", "unit": "µg per m³, yearly average", "format": "number", "suffix": " µg", "group": ENVIRONMENT, "source": "Global Burden of Disease study", "keywords": "air quality smog pm2.5 particles"},

    {"id": "internet", "code": "IT.NET.USER.ZS", "label": "Internet users", "unit": "% of people", "format": "pct", "group": TECHNOLOGY, "pairs": "technology", "source": "International Telecommunication Union", "keywords": "online digital web technology"},
    {"id": "mobile", "code": "IT.CEL.SETS.P2", "label": "Mobile phone subscriptions", "unit": "per 100 people", "format": "number", "group": TECHNOLOGY, "source": "International Telecommunication Union", "keywords": "cell phones mobiles smartphones"},

    {"id": "women_parl", "code": "SG.GEN.PARL.ZS", "label": "Women in parliament", "unit": "% of seats", "format": "pct", "group": SOCIETY, "pairs": "gender", "source": "Inter-Parliamentary Union", "keywords": "women gender parliament politics"},
    {"id": "homicides", "code": "VC.IHR.PSRC.P5", "label": "Murder rate", "unit": "homicides per 100,000 people", "format": "number", "group": SOCIETY, "source": "UN Office on Drugs and Crime", "keywords": "homicide murder crime violence safety"},
]

# The World Bank's code for Kosovo differs from the one on our map.
CODE_FIXES = {"XKX": "KOS"}


def get(url, attempts=5):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                return json.load(response)
        except (OSError, ValueError):  # ValueError: the API sometimes sends a half-empty reply
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def get_rows(url):
    """Every row of a World Bank API list, page by page.

    The API answers [page info, rows]. If something is wrong it sends a message
    instead, which must stop the update rather than look like an empty list.
    """
    rows, page, pages = [], 1, 1
    while page <= pages:
        reply = get(f"{url}&page={page}")
        if not isinstance(reply, list) or len(reply) < 2 or reply[1] is None:
            raise SystemExit(f"Unexpected reply from the World Bank for {url}: {str(reply)[:300]}")
        pages = reply[0]["pages"]
        rows += reply[1]
        page += 1
    return rows


def previous_count(indicator_id):
    """How many countries the last saved file for an indicator had, or 0."""
    try:
        with (OUTPUT / f"{indicator_id}.json").open() as f:
            return len(json.load(f)["values"])
    except (OSError, ValueError, KeyError):
        return 0


def real_countries():
    """Region and income group for actual countries, leaving out groups like 'World' or 'Euro area'."""
    rows = get_rows(f"{API}/country?format=json&per_page=500")
    return {
        CODE_FIXES.get(row["id"], row["id"]): [row["region"]["value"].strip(), row["incomeLevel"]["value"].strip()]
        for row in rows
        if row["region"]["value"] != "Aggregates"
    }


def write_json(path, data, **options):
    """Write a JSON file if its contents changed. Returns True if they did."""
    text = json.dumps(data, **options)
    if path.exists() and path.read_text() == text:
        return False
    path.write_text(text)
    return True


def round_sig(value, digits=3):
    if value == 0:
        return 0
    rounded = round(value, digits - 1 - math.floor(math.log10(abs(value))))
    return int(rounded) if rounded == int(rounded) and abs(rounded) >= 100 else rounded


def main():
    # The site keeps topics and indicators in one list, so their ids must differ.
    from topics import TOPICS
    topic_ids = {t["id"] for t in TOPICS}
    clashes = {i["id"] for i in INDICATORS} & topic_ids
    if clashes:
        raise SystemExit(f"Indicator ids clash with topic ids: {clashes}")
    paired = [i["pairs"] for i in INDICATORS if "pairs" in i]
    if len(paired) != len(set(paired)) or not set(paired) <= topic_ids:
        raise SystemExit(f"Each speech topic can be paired with at most one indicator: {paired}")

    regions = real_countries()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    STATS.mkdir(parents=True, exist_ok=True)
    index, world, by_country = [], {}, {}
    changed = False

    for indicator in INDICATORS:
        last_year = time.gmtime().tm_year
        rows = get_rows(
            f"{API}/country/all/indicator/{indicator['code']}"
            f"?format=json&per_page=20000&date={FIRST_YEAR}:{last_year}"
        )
        values = {}
        for row in rows:
            code = CODE_FIXES.get(row["countryiso3code"], row["countryiso3code"])
            if row["value"] is None or code not in regions:
                continue
            values.setdefault(code, {})[row["date"]] = round_sig(row["value"])

        if len(values) < 100:
            raise SystemExit(f"{indicator['code']}: only {len(values)} countries came back — refusing to overwrite")
        # A sudden drop usually means a broken download, not countries vanishing.
        before = previous_count(indicator["id"])
        if len(values) < 0.9 * before:
            raise SystemExit(f"{indicator['code']}: {len(values)} countries, down from {before} — refusing to overwrite")

        years = sorted({int(y) for by_year in values.values() for y in by_year})
        changed |= write_json(
            OUTPUT / f"{indicator['id']}.json",
            {"years": [years[0], years[-1]], "values": values},
            separators=(",", ":"),
            sort_keys=True,
        )

        # The median country each year, once enough countries report to make it meaningful.
        per_year = {}
        for series in values.values():
            for year, v in series.items():
                per_year.setdefault(year, []).append(v)
        world[indicator["id"]] = {y: round_sig(statistics.median(vs)) for y, vs in sorted(per_year.items()) if len(vs) >= 20}
        for code, series in values.items():
            by_country.setdefault(code, {})[indicator["id"]] = series

        index.append({**indicator, "years": [years[0], years[-1]]})
        print(f"{indicator['id']:13} {len(values):3} countries, {years[0]}–{years[-1]}")

    changed |= write_json(OUTPUT / "index.json", index, indent=1, ensure_ascii=False)
    changed |= write_json(OUTPUT / "world.json", world, separators=(",", ":"), sort_keys=True)
    for code, stats in by_country.items():
        changed |= write_json(STATS / f"{code}.json", stats, separators=(",", ":"), sort_keys=True)
    # Files from earlier runs that nothing produces any more: a country the
    # World Bank stopped covering, or an indicator taken off the list.
    keep = {f"{i['id']}.json" for i in INDICATORS} | {"index.json", "world.json", "updated.json"}
    stale = [p for p in STATS.glob("*.json") if p.stem not in by_country]
    stale += [p for p in OUTPUT.glob("*.json") if p.name not in keep]
    for path in stale:
        print(f"Removing {path.relative_to(DATA)}, which is no longer produced")
        path.unlink()
        changed = True
    changed |= write_json(DATA / "regions.json", {code: regions[code] for code in sorted(by_country)}, separators=(",", ":"), ensure_ascii=False)
    # The site says when the figures last changed (not just when they were checked).
    updated = OUTPUT / "updated.json"
    if changed or not updated.exists():
        write_json(updated, {"updated": time.strftime("%Y-%m-%d", time.gmtime())})
        print("Figures changed; updated.json set to today")
    print(f"Wrote {len(by_country)} country files")


if __name__ == "__main__":
    main()
