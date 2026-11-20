"""Cache a bounded set of classical Lichess broadcasts for the transfer."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
from time import sleep
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

MAX_PGN_BYTES = 800_000
MIN_MINUTES = 60
MAX_EVENTS = 20


def read(url, limit, content_type):
    request = Request(url, headers={"Accept": content_type, "User-Agent": "En-Croissant-classifier-benchmark/1"})
    for attempt in range(2):
        try:
            with urlopen(request, timeout=20) as response:
                content = response.read(limit + 1)
            if len(content) > limit:
                raise ValueError(f"Payload exceeds the {limit}-byte limit")
            return content
        except HTTPError as error:
            if error.code != 429 or attempt:
                raise
            sleep(61)
    raise AssertionError("Unreachable")


def download(rounds, target):
    target.mkdir(parents=True, exist_ok=True)
    sources = {}
    for round_url in rounds:
        parsed = urlsplit(round_url)
        if not re.fullmatch(r"/broadcast/[^/]+/[^/]+/[a-zA-Z0-9]{8}", parsed.path) or (
            parsed.scheme, parsed.netloc
        ) != ("https", "lichess.org"):
            raise ValueError(f"Invalid public broadcast round {round_url}")
        try:
            tour = json.loads(read("https://lichess.org/api" + parsed.path, 300_000, "application/json"))["tour"]
            info = tour["info"]
            clock = info.get("tc", "")
            duration = re.search(r"^\D{0,32}(\d{2,3})(?:\s*[- ]?\s*(?:min(?:ute)?s?\b|m\b)|\s*[+'])", clock.lower())
            if info.get("fideTC") != "standard" or not duration or int(duration[1]) < MIN_MINUTES:
                print(f"Skipped {tour['slug']}: {clock}", flush=True)
                continue
            if not re.fullmatch(r"[a-zA-Z0-9]{8}", tour["id"]):
                raise ValueError("Unexpected tournament identity")
            url = f"https://lichess.org/api/broadcast/{tour['id']}.pgn?clocks=false&comments=false"
            pgn = read(url, MAX_PGN_BYTES, "application/x-chess-pgn")
            if not pgn.lstrip().startswith(b"["):
                raise ValueError("Response is not a PGN")
            name = f"{tour['slug']}-{tour['id']}.pgn"
            (target / name).write_bytes(pgn)
            sources[name] = {
                "event": tour["slug"], "pgn": url, "round": round_url, "timeControl": clock,
                "bytes": len(pgn), "sha256": sha256(pgn).hexdigest(),
            }
            print(f"{len(sources)} {tour['slug']} ({len(pgn)} bytes)", flush=True)
        except (HTTPError, TimeoutError, ValueError, KeyError) as error:
            print(f"Unavailable {parsed.path}: {error}", flush=True)
        if len(sources) >= MAX_EVENTS:
            break
    (target / "sources.json").write_text(json.dumps(sources, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rounds", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    download(json.loads(args.rounds.read_bytes()), args.target)
