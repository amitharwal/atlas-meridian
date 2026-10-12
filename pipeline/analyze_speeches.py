"""Turn the UN General Debate speeches into the data files the map uses.

What it does, in plain terms:
  1. Cuts every speech into short passages of a few sentences.
  2. Uses a small language model (bge-small-en-v1.5) to turn each passage into
     numbers that capture its meaning ("embeddings"). This is the slow part, so
     results are saved in pipeline/cache/embeddings/ and reused next time.
  3. Trains a simple classifier on hand-labelled passages
     (training/labelled_passages.jsonl) plus the examples in topics.py, then
     uses it to file every passage under a topic — or under none, for
     ceremonial passages like "I congratulate the President on his election".
  4. Works out how similar each country's speech is to every other country's
     speech in the same year ("rhetorical allies").
  5. Writes small JSON files into public/data/ for the website.

Setup: download UNGDC_1946-2025.tar.gz from Harvard Dataverse
(doi:10.7910/DVN/0TJX8Y — it asks you to fill in a short guestbook) and unpack
it into pipeline/cache/ungdc/ so the speeches are in pipeline/cache/ungdc/TXT/.

Run from the project root:
  .venv/bin/python pipeline/analyze_speeches.py              # everything
  .venv/bin/python pipeline/analyze_speeches.py --evaluate   # accuracy check only
  .venv/bin/python pipeline/analyze_speeches.py --years 1985 2021 --report --no-write
"""

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from topics import NONE_EXAMPLES, TOPICS

ROOT = Path(__file__).resolve().parent.parent
SPEECH_DIR = ROOT / "pipeline" / "cache" / "ungdc" / "TXT"
EMBED_DIR = ROOT / "pipeline" / "cache" / "embeddings"
TRAINING_FILE = ROOT / "pipeline" / "training" / "labelled_passages.jsonl"
OUT_DIR = ROOT / "public" / "data"

MODEL_NAME = "BAAI/bge-small-en-v1.5"
# Bump this whenever the way speeches are cut into passages changes, so old
# cached embeddings are recomputed instead of silently reused.
CHUNK_VERSION = 1

MIN_WORDS, TARGET_WORDS, MAX_WORDS = 15, 60, 150

# Classifier strength. Chosen by cross-validation on the labelled passages:
# 4, 8 and 16 all scored within a point of each other.
CLASSIFIER_C = 8

ALLIES_PER_YEAR = 5
QUOTES_PER_YEAR = 3
QUOTE_MAX_CHARS = 320

SPEECH_NAME = re.compile(r"(?P<code>[A-Z]+)_\d+_(?P<year>\d{4})\.txt")
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"“(])")
TOPIC_IDS = [t["id"] for t in TOPICS]


# ---------------------------------------------------------------- reading ---

def find_speeches(years=None):
    """Yield (year, country_code, path) for every speech file."""
    for path in sorted(SPEECH_DIR.glob("*/*.txt")):
        # Speech files are named like USA_75_2020.txt; the archive also
        # contains a stray Mac system file, which this skips.
        match = SPEECH_NAME.fullmatch(path.name)
        if match and (years is None or int(match["year"]) in years):
            yield int(match["year"]), match["code"], path


def split_into_passages(text):
    """Cut a speech into passages of roughly TARGET_WORDS words.

    Passages end on sentence boundaries, because the 2025 transcripts have no
    paragraph breaks at all, so paragraphs can't be relied on.
    """
    passages, current = [], []
    for sentence in SENTENCE_END.split(" ".join(text.split())):
        words = sentence.split()
        # Very long "sentences" are usually OCR run-ons; cut them up.
        while len(words) > MAX_WORDS:
            passages.append(" ".join(words[:MAX_WORDS]))
            words = words[MAX_WORDS:]
        current.extend(words)
        if len(current) >= TARGET_WORDS:
            passages.append(" ".join(current))
            current = []
    if current:
        passages.append(" ".join(current))
    return [p for p in passages if len(p.split()) >= MIN_WORDS]


# -------------------------------------------------------------- embedding ---

_model = None


def model():
    global _model
    if _model is None:
        import torch
        from sentence_transformers import SentenceTransformer

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _model = SentenceTransformer(MODEL_NAME, device=device)
    return _model


def embed(texts):
    return model().encode(texts, batch_size=128, normalize_embeddings=True, show_progress_bar=False)


def load_year(year, speeches):
    """Return passages + embeddings for one year, computing them if not cached."""
    cache = EMBED_DIR / f"{year}.npz"
    if cache.exists():
        data = np.load(cache, allow_pickle=False)
        if int(data["chunk_version"]) == CHUNK_VERSION and str(data["model"]) == MODEL_NAME:
            meta = json.loads(str(data["meta"]))
            return meta["codes"], meta["passages"], data["speech_of"], data["embeddings"].astype(np.float32)

    codes, passages, speech_of = [], [], []
    for code, path in speeches:
        parts = split_into_passages(path.read_text(encoding="utf-8", errors="replace"))
        speech_of.extend([len(codes)] * len(parts))
        passages.extend(parts)
        codes.append(code)

    embeddings = embed(passages)
    speech_of = np.array(speech_of, dtype=np.int32)

    EMBED_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache,
        embeddings=embeddings.astype(np.float16),
        speech_of=speech_of,
        meta=json.dumps({"codes": codes, "passages": passages}),
        chunk_version=CHUNK_VERSION,
        model=MODEL_NAME,
    )
    return codes, passages, speech_of, embeddings


# ------------------------------------------------------------- classifier ---

def load_training():
    """Hand-labelled passages. Where a passage fits several topics, the first
    label is the main one (used for training); any of them counts as correct
    when measuring accuracy."""
    rows = [json.loads(line) for line in TRAINING_FILE.read_text().splitlines() if line.strip()]
    return rows, embed([r["text"] for r in rows])


def example_rows():
    texts = [ex for t in TOPICS for ex in t["examples"]] + NONE_EXAMPLES
    labels = [t["id"] for t in TOPICS for _ in t["examples"]] + ["none"] * len(NONE_EXAMPLES)
    return embed(texts), labels


def fit_classifier(X, y):
    from sklearn.linear_model import LogisticRegression

    # class_weight="balanced" stops common topics (Peace) from drowning out rare ones.
    return LogisticRegression(C=CLASSIFIER_C, max_iter=5000, class_weight="balanced").fit(X, y)


def train_classifier():
    rows, X = load_training()
    E, e_labels = example_rows()
    return fit_classifier(np.vstack([X, E]), [r["labels"][0] for r in rows] + e_labels)


def evaluate():
    """Honest accuracy estimate: 5-fold cross-validation over the randomly
    sampled labelled passages, so every passage is judged by a model that
    never saw it. Keyword-sampled passages are only ever used for training,
    because they aren't a fair sample of what speeches contain."""
    from sklearn.model_selection import StratifiedKFold

    rows, X = load_training()
    E, e_labels = example_rows()
    rand = [i for i, r in enumerate(rows) if r["sampling"] == "random"]
    kw = [i for i, r in enumerate(rows) if r["sampling"] != "random"]
    main = [rows[i]["labels"][0] for i in rand]
    counts = Counter(main)
    strata = [m if counts[m] >= 5 else "rare" for m in main]

    preds = np.empty(len(rand), dtype=object)
    for train, test in StratifiedKFold(5, shuffle=True, random_state=0).split(np.zeros(len(rand)), strata):
        train_rows = [rand[i] for i in train] + kw
        clf = fit_classifier(
            np.vstack([X[train_rows], E]), [rows[i]["labels"][0] for i in train_rows] + e_labels
        )
        preds[test] = clf.predict(X[[rand[i] for i in test]])

    correct = [p in rows[i]["labels"] for p, i in zip(preds, rand)]
    print(f"Cross-validated accuracy: {np.mean(correct):.1%} of {len(rand)} randomly sampled passages")
    print("Per topic — of the passages the model put in each topic, how many were right:")
    for t in TOPIC_IDS + ["none"]:
        hits = [c for p, c in zip(preds, correct) if p == t]
        if hits:
            print(f"  {t:15} {np.mean(hits):5.0%}  ({len(hits)} passages)")


# ---------------------------------------------------------------- scoring ---

def trim_quote(text):
    if len(text) <= QUOTE_MAX_CHARS:
        return text
    cut = text[:QUOTE_MAX_CHARS]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    return cut[: end + 1] if end > QUOTE_MAX_CHARS // 2 else cut.rsplit(" ", 1)[0] + "…"


def analyse_year(classifier, codes, passages, speech_of, embeddings):
    probs = classifier.predict_proba(embeddings)
    classes = list(classifier.classes_)
    # Columns in topics.py order, so output files line up with topics.json.
    topic_probs = probs[:, [classes.index(t) for t in TOPIC_IDS]]
    predicted = [classes[i] for i in probs.argmax(axis=1)]
    topic_of = np.array([TOPIC_IDS.index(p) if p != "none" else -1 for p in predicted])

    shares, quotes = {}, {}
    speech_vectors = np.zeros((len(codes), embeddings.shape[1]), dtype=np.float32)
    for s, code in enumerate(codes):
        mine = speech_of == s
        counts = np.bincount(topic_of[mine & (topic_of >= 0)], minlength=len(TOPICS))
        # Share of the speech spent on each topic, in tenths of a percent.
        shares[code] = [int(round(1000 * c / mine.sum())) for c in counts]
        speech_vectors[s] = embeddings[mine].mean(axis=0)

        top = [t for t in np.argsort(-counts)[:QUOTES_PER_YEAR] if counts[t] > 0]
        idx = np.flatnonzero(mine)
        quotes[code] = [
            {"topic": TOPIC_IDS[t], "text": trim_quote(passages[idx[topic_probs[idx, t].argmax()]])}
            for t in top
        ]

    # Every UN speech shares a lot of boilerplate, so all speeches look ~95%
    # alike. Subtracting the year's average speech leaves what makes each one
    # distinctive, which gives far more meaningful "allies".
    centred = speech_vectors - speech_vectors.mean(axis=0)
    centred /= np.linalg.norm(centred, axis=1, keepdims=True)
    similarity = centred @ centred.T
    np.fill_diagonal(similarity, -np.inf)
    allies = {
        code: [[codes[j], round(float(similarity[s, j]), 3)] for j in np.argsort(-similarity[s])[:ALLIES_PER_YEAR]]
        for s, code in enumerate(codes)
    }
    return shares, quotes, allies, topic_of, topic_probs


# ------------------------------------------------------------------ main ---

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--years", type=int, nargs="+", help="only these years (for testing)")
    parser.add_argument("--report", action="store_true", help="print sample passages per topic to check quality")
    parser.add_argument("--no-write", action="store_true", help="don't write files into public/data")
    parser.add_argument("--evaluate", action="store_true", help="only measure accuracy on the labelled passages")
    args = parser.parse_args()

    if args.evaluate:
        evaluate()
        return

    if not SPEECH_DIR.exists():
        raise SystemExit(f"Speeches not found in {SPEECH_DIR} — see the setup note at the top of this file.")

    by_year = defaultdict(list)
    for year, code, path in find_speeches(set(args.years) if args.years else None):
        by_year[year].append((code, path))

    classifier = train_classifier()
    shares = defaultdict(dict)
    country_years = defaultdict(dict)
    rng = np.random.default_rng(0)

    for year in sorted(by_year):
        codes, passages, speech_of, embeddings = load_year(year, by_year[year])
        year_shares, quotes, allies, topic_of, topic_probs = analyse_year(
            classifier, codes, passages, speech_of, embeddings
        )
        for code in codes:
            shares[code][year] = year_shares[code]
            country_years[code][year] = {"allies": allies[code], "quotes": quotes[code]}

        world = np.mean([year_shares[c] for c in codes], axis=0) / 10
        top3 = ", ".join(f"{TOPICS[t]['label']} {world[t]:.1f}%" for t in np.argsort(-world)[:3])
        print(f"{year}: {len(codes)} speeches, {len(passages)} passages, "
              f"{100 * (topic_of < 0).mean():.0f}% no topic | top: {top3}", flush=True)

        if args.report:
            for t, topic in enumerate(TOPICS):
                hits = np.flatnonzero(topic_of == t)
                print(f"\n  [{topic['label']}] {len(hits)} passages")
                for i in rng.choice(hits, size=min(2, len(hits)), replace=False):
                    print(f"    {topic_probs[i, t]:.2f}  {passages[i][:200]}")

    if args.no_write:
        return

    (OUT_DIR / "countries").mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "topics.json").open("w") as f:
        json.dump([{"id": t["id"], "label": t["label"]} for t in TOPICS], f, indent=1)
    with (OUT_DIR / "speeches.json").open("w") as f:
        json.dump({
            "topics": TOPIC_IDS,
            "years": [min(by_year), max(by_year)],
            "shares": shares,
        }, f, separators=(",", ":"))
    for code, years in country_years.items():
        with (OUT_DIR / "countries" / f"{code}.json").open("w") as f:
            json.dump({"iso3": code, "years": years}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"\nWrote topics.json, speeches.json and {len(country_years)} country files to {OUT_DIR}")


if __name__ == "__main__":
    main()
