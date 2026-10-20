# Atlas Meridian

**The world in numbers: a free map of country statistics, and 80 years of what every country said at the UN.**

Pick any of 34 World Bank measures (population, the economy, poverty, health, education,
the environment, technology, safety) and see it on an interactive world map, year by year since 1960.

- **Map**: colour the world by any measure, grouped so it's easy to browse; slide or play
  through the years; click a country for its key facts, its trend against the median country,
  and related measures.
- **Countries** (`/country/`): a fact sheet for each of 221 countries and territories, with every
  figure, how it compares with the world, and the country's UN speeches.
- **Rankings** (`/rankings/`): every country ranked by any measure and year, filtered by region,
  income group or name.
- **Compare** (`/compare/`): any two countries side by side, with charts back to 1960.
- **Chart** (`/chart/`): any two measures against each other, one dot per country sized by
  population, playing through the years. Pick out a region or follow chosen countries' paths.
- **At the UN**: every September, each UN member gives a speech at the General Assembly's
  General Debate. Atlas Meridian reads all of them (over 11,000 from 1946 to 2025), sorts what
  each country talked about into 16 topics, and maps that too, along with who gave each speech
  and which countries name each other.
- **Guess the Country** (`/daily/`): a daily map game. One country is highlighted; name it in
  up to three guesses, with distance, direction and statistics as clues. Five rounds, easy to hard.

It's a free, open-source static website: no accounts, no tracking, no server.

## How it works

1. **Speeches → topics (offline).** `pipeline/analyze_speeches.py` splits each speech into
   passages of about 60 words, turns them into vectors with the small open model
   [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5), and sorts each passage
   into a topic (or "none" for ceremonial text) with a classifier trained on labelled
   passages in `pipeline/training/`. Topics are defined in `pipeline/topics.py`.
2. **"Speaks most like"** compares the average vectors of speeches given in the same year.
   It measures talking about the same things, not friendship.
3. **Statistics.** `pipeline/build_indicators.py` downloads 34 World Bank series (the list, their
   groups and labels are at the top of that file; adding one is one line). Money figures are in constant
   2015 US dollars, so years can be compared. The script refuses to save a download that
   looks broken (too few countries, or far fewer than last time). It writes one file per
   measure for the map, one per country for its card and pages, and the median country for each
   year. A GitHub Action refreshes them monthly and redeploys the site.
4. **Extra data** from the speeches: `pipeline/build_speakers.py` (who gave each speech) and
   `pipeline/build_mentions.py` (which countries each speech names).
   `pipeline/build_game.mjs` sorts the 193 UN members into five difficulty tiers for the daily
   game (by land area, population and economy, plus any hand moves listed in the file). It's run
   by hand with `npm run build:game`, so the game's schedule doesn't change when the data does.
5. **Country fact sheets** are static pages generated at build time by `pipeline/build_profiles.mjs`
   (`npm run build` runs it after Vite), along with `sitemap.xml` for search engines. Each gets its
   own picture for when the link is shared (`pipeline/preview_image.mjs`, drawn with resvg).
6. **The site** is plain JavaScript built with Vite: the map (`index.html`, `src/main.js`), with
   [MapLibre GL](https://maplibre.org/) drawing it; `rankings/`, `compare/`, `chart/` and `daily/`, each with
   its own script in `src/`. All data is pre-computed JSON in `public/data/`.

### Accuracy

Checked against hand-sorted passages, the topic classifier agrees about **71%** of the time
(5-fold cross-validation). It's strongest on peace, democracy, development and gender, and
weakest on terrorism, debt and food. The labelled passages were produced by an AI assistant,
not by human experts. Treat single numbers as rough; trends are more reliable.

## Data and credits

| What | Source | Licence |
|---|---|---|
| Speeches | [UN General Debate Corpus](https://doi.org/10.7910/DVN/0TJX8Y), Jankin, Baturo & Dasandi (2025), *Journal of Peace Research* 62(4); Baturo, Dasandi & Mikhaylov (2017), *Research & Politics* | CC0 |
| Statistics | [World Bank Open Data](https://data.worldbank.org/) (drawing on the UN, IMF, WHO, UNESCO, ILO, EDGAR, IPU, ITU, FAO and others) | CC BY 4.0 |
| Borders | [Natural Earth](https://www.naturalearthdata.com/) 1:50m | Public domain |
| Topic model | [BAAI bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) | MIT |

Notes: the 2024 speeches in the corpus were machine-translated and the 2025 speeches
machine-transcribed, so they may contain small errors. Military spending is not included
because its source (SIPRI) does not permit republishing the full data set. Borders are for
display only and imply no position on disputed territory.

## Running it yourself

```sh
npm install
npm run dev        # local preview at http://localhost:5173
npm test           # checks the code and the data in public/data
npm run build      # static site in dist/
```

The site's published address is set once, as `homepage` in `package.json`. Counts quoted in
the pages ("34 measures", "1946 to 2025") are filled in from the data when the site is built.
The fonts (Source Serif 4 and IBM Plex Sans) are bundled with the site, so no page loads
anything from another server.

Both GitHub Actions run `npm test` first: the site isn't published, and the monthly data
update isn't saved, if a check fails. The daily game's schedule is compared with a saved
copy in `tests/fixtures/`; if you change the game's tiers on purpose (`npm run build:game`),
delete `tests/fixtures/game-schedule.json` and run the tests again to save the new schedule.

Refreshing the data needs Python 3.11:

```sh
python3 pipeline/build_indicators.py           # World Bank figures (standard library only)
# (On a Mac, if this fails with CERTIFICATE_VERIFY_FAILED, run Python's
#  "Install Certificates.command", or set SSL_CERT_FILE to a CA bundle.)

python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
npm run build:map                              # map shapes (Natural Earth → TopoJSON)
.venv/bin/python pipeline/analyze_speeches.py  # speeches → topics (see below)
```

The speech corpus sits behind a short form on Harvard Dataverse, so it can't be downloaded
automatically. Download it by hand from the link above and extract it to
`pipeline/cache/ungdc/` before running `analyze_speeches.py`. This is done once a year,
when a new session's speeches are published.

## Licence

Code: [MIT](LICENSE). Data keeps its original licence (see the table above).
