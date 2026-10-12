"""Who delivered each speech, and how senior they were.

Reads Speakers_by_session.xlsx from the UN General Debate Corpus and writes
public/data/speakers.json: {iso3: {year: [name, title, rank]}}.

Rank sorts the hundreds of differently written job titles into four levels:
  3  head of state or government (president, king, prime minister...)
  2  deputy leader (vice-president, deputy prime minister, crown prince)
  1  foreign minister
  0  another minister, an ambassador or a delegation head
Titles are recorded for almost every speech from 1994 (under a quarter before), so earlier speeches
mostly have a name but no rank.

Run from the project root:  .venv/bin/python pipeline/build_speakers.py
"""

import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "pipeline" / "cache" / "ungdc" / "Speakers_by_session.xlsx"
OUTPUT = ROOT / "public" / "data" / "speakers.json"

# Typos in the spreadsheet's country codes.
CODE_FIXES = {"CZK": "CSK"}

# Checked in this order; the first match wins, so a "Prime Minister and
# Minister for Foreign Affairs" counts as a head of government.
RANKS = [
    # Titles that contain "president" but mean head of government or of a body.
    (3, r"^president of the (council of ministers|government)|^president of the presidency council|^president of the european council"),
    (2, r"^(first )?vice[- ]president|^deputy prime minister|^crown prince"),
    (3, r"^((constitutional|interim|acting|state) )?president|^(acting )?head of state|^king|^queen|^amir|^emir"
        r"|^sultan|^(sovereign )?prince|^co-prince|^c(h)?airman of the presidency|^member of the presidency|^pope|^sheikh"
        r"|^captain regent|^grand duke|^prime minister|^head of government|^chancellor|^premier|^taoiseach"
        r"|^chief (executive|adviser)|^chairman of the (state|supreme|revolutionary|presidential|transitional|military)"),
    # "foregn": a common misspelling in the source spreadsheet.
    (1, r"foreign|foregn|external affairs|^secretary of state|relations with states|international (relations|affairs)"),
    (0, r"minister|representative|ambassador|delegation|envoy|secretary|chargé|charge d"),
]


# Courtesy titles the spreadsheet sometimes includes in the name itself.
HONORIFICS = re.compile(
    r"^(?:(?:Dr\.? )?(?:The )?(?:Right )?Honou?rable|(?:(?:His|Her) )?(?:Serene |Royal )?(?:Excellency|Highness|Majesty)|H\.\s?E\.|"
    r"S\.?E\.)\s+|\s+(?:MP|M\.P\.)$",
    re.IGNORECASE,
)
ROMAN = re.compile(r"^(?:I{1,3}|IV|VI{0,3}|IX|X{1,3})$")


def tidy_name(name):
    """"Mr. PAZHWAK" -> "Mr. Pazhwak", "The Honorable Alexander DOWNER MP" -> "Alexander Downer"."""
    name = " ".join(str(name).split())
    previous = None
    while previous != name:  # titles can stack: "His Highness Sheikh..."
        previous = name
        name = HONORIFICS.sub("", name).strip()

    def fix(word):
        letters = re.sub(r"[^A-Za-z]", "", word)
        if len(letters) >= 3 and letters.isupper() and not ROMAN.match(letters):
            # Title-case each part of hyphenated or apostrophe names: AL-NAHYAN -> Al-Nahyan.
            return re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), word.lower())
        return word

    return " ".join(fix(w) for w in name.split())


def rank_of(title):
    if not title:
        return None
    t = title.strip().lower()
    for rank, pattern in RANKS:
        if re.search(pattern, t):
            return rank
    return None


def main():
    rows = openpyxl.load_workbook(SOURCE, read_only=True)["Sheet1"].iter_rows(values_only=True)
    next(rows)  # header
    speeches = json.loads((ROOT / "public" / "data" / "speeches.json").read_text())["shares"]

    out, unranked = {}, {}
    for year, _session, code, _country, name, title, *_ in rows:
        if not code or not year:
            continue
        code = CODE_FIXES.get(code.strip(), code.strip())
        if str(year) not in speeches.get(code, {}):
            continue  # a speaker row with no matching speech
        title = " ".join(title.split()) if title else None
        rank = rank_of(title)
        if title and rank is None:
            unranked[title] = unranked.get(title, 0) + 1
        out.setdefault(code, {})[str(year)] = [tidy_name(name) if name else None, title, rank]

    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    n = sum(len(v) for v in out.values())
    ranked = sum(1 for v in out.values() for s in v.values() if s[2] is not None)
    print(f"Wrote {n} speakers ({ranked} with a rank) to {OUTPUT.relative_to(ROOT)}")
    if unranked:
        print("Titles not ranked:", sorted(unranked.items(), key=lambda kv: -kv[1])[:15])


if __name__ == "__main__":
    main()
