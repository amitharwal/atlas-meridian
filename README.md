# Atlas Meridian

**What the world says at the United Nations, and what the numbers show.**

Every September, each UN member gives a speech at the General Assembly's General Debate.
Atlas Meridian reads all of them, over 11,000 speeches from 1946 to 2025, sorts what each
country talked about into 16 topics, and puts it on an interactive globe next to World Bank
figures. You can see what a country *says* about climate, debt or gender equality alongside
its CO₂ emissions, foreign debt or women in parliament.

- Slide or play through 80 years and watch topics rise and fall (9/11, the Paris Agreement, COVID).
- See which countries talked about a topic most, including small island states that are
  hard to spot on a map.
- Click a country for quotes from its speech, the countries it "speaks most like", and how
  its words compare with the numbers.

It's a free, open-source static website: no accounts, no tracking, no server.

## How it works

1. **Speeches → topics (offline).** `pipeline/analyze_speeches.py` splits each speech into
   passages of about 60 words, turns them into vectors with the small open model
   [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5), and sorts each passage
   into a topic (or "none" for ceremonial text) with a classifier trained on labelled
   passages in `pipeline/training/`. Topics are defined in `pipeline/topics.py`.
2. **"Speaks most like"** compares the average vectors of speeches given in the same year.
   It measures talking about the same things, not friendship.
3. **Indicators.** `pipeline/build_indicators.py` downloads eight World Bank series. A GitHub
   Action refreshes them monthly and redeploys the site.
4. **The site** (`index.html`, `src/`) is plain JavaScript built with Vite, with the globe
   drawn by [MapLibre GL](https://maplibre.org/). All data is pre-computed JSON in `public/data/`.

### Accuracy

Checked against hand-sorted passages, the topic classifier agrees about **71%** of the time
(5-fold cross-validation). It's strongest on peace, democracy, development and gender, and
weakest on terrorism, debt and food. The labelled passages were produced by an AI assistant,
not by human experts. Treat single numbers as rough; trends are more reliable.

## Data and credits

| What | Source | Licence |
|---|---|---|
| Speeches | [UN General Debate Corpus](https://doi.org/10.7910/DVN/0TJX8Y), Jankin, Baturo & Dasandi (2025), *Journal of Peace Research* 62(4); Baturo, Dasandi & Mikhaylov (2017), *Research & Politics* | CC0 |
| Indicators | [World Bank Open Data](https://data.worldbank.org/) (drawing on the UN, EDGAR, IPU, ITU and FAO) | CC BY 4.0 |
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
npm run build      # static site in dist/
```

Refreshing the data needs Python 3.11:

```sh
python3 pipeline/build_indicators.py           # World Bank figures (standard library only)

python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
python3 pipeline/build_countries.py            # map shapes
.venv/bin/python pipeline/analyze_speeches.py  # speeches → topics (see below)
```

The speech corpus sits behind a short form on Harvard Dataverse, so it can't be downloaded
automatically. Download it by hand from the link above and extract it to
`pipeline/cache/ungdc/` before running `analyze_speeches.py`. This is done once a year,
when a new session's speeches are published.

## Licence

Code: [MIT](LICENSE). Data keeps its original licence (see the table above).
