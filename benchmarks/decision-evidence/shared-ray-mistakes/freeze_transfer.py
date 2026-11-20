"""Freeze a transfer cohort before running the matched-reply classifier."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from freeze import collect, family, load_index, select, ticket


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("sources", "raw", "original", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    original = load_index(args.original)
    prior_groups = {family(source["slug"]) for source in original["sources"]}
    sources = [source for source in load_index(args.sources)
               if family(source["slug"]) not in prior_groups]
    prior = [row for cohort in ("development", "reserve", "enrichedDevelopment", "enrichedReserve")
             for row in original[cohort]]
    prior.extend(row for index in args.exclude for row in load_index(index))
    pool = collect(sources, args.raw, prior)
    groups = sorted({group for group, _ in pool}, key=lambda group: ticket("shared-ray-transfer", group))
    quotas = [("recordedCapture", 56), ("ray", 48), ("ordinary", 32)]
    sampled = select(pool, groups, quotas)
    counts = Counter(row["category"] for row in sampled)
    result = dict(
        design="one decision per game, independent event families, recorded capture / alignment / ordinary",
        reserve=sampled, sources=sources,
        inputHashes={path.name: sha256(path.read_bytes()).hexdigest()
                     for path in [args.original, args.sources, *args.exclude]},
        quotas=dict(quotas), counts=dict(counts), groupCount=len({row["group"] for row in sampled}),
    )
    with args.output.open("x", encoding="utf8", newline="\n") as stream:
        json.dump(result, stream, separators=(",", ":"))
        stream.write("\n")
    print(len(sampled), dict(counts), result["groupCount"], "families", flush=True)


if __name__ == "__main__":
    main()
