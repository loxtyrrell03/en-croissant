"""Verify deterministic OTB importer coverage against known local prep fixtures.

This is intentionally a fast source-level verifier. It exercises the two live
identity sources that found the July 2026 regressions (Chess-Results and the
Lichess FIDE/broadcast pages), merges organizer PGNs needed by the Sameera
fixture, rejects obvious online records, and deduplicates by actual mainline
moves rather than unreliable source dates.
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import re
import sys
import time
from dataclasses import dataclass, field

import chess.pgn
import requests
from bs4 import BeautifulSoup


USER_AGENT = "Outpost OTB importer fixture verifier/0.1"
CHESS_RESULTS = "https://s1.chess-results.com/partiesuche.aspx?lan=1"


@dataclass(frozen=True)
class Fixture:
    name: str
    fide_id: str
    baseline: pathlib.Path
    expected_baseline: int
    expected_union: int
    live_urls: tuple[str, ...] = ()
    extra_urls: tuple[str, ...] = ()


@dataclass
class Collected:
    games: dict[str, chess.pgn.Game] = field(default_factory=dict)
    source_counts: dict[str, int] = field(default_factory=dict)
    duplicates: int = 0
    online_excluded: int = 0
    invalid_excluded: int = 0

    def add(self, game: chess.pgn.Game, fixture: Fixture, source: str) -> None:
        if game.errors:
            self.invalid_excluded += 1
        if not target_side(game, fixture):
            return
        if suspected_online(game):
            self.online_excluded += 1
            return
        key = game_key(game, fixture)
        if not key:
            return
        if key in self.games:
            self.duplicates += 1
            return
        self.games[key] = game
        self.source_counts[source] = self.source_counts.get(source, 0) + 1


def normalized_tokens(value: str) -> frozenset[str]:
    titles = {"gm", "im", "fm", "cm", "wgm", "wim", "wfm", "wcm", "nm"}
    tokens = re.findall(r"[^\W_]+", value.casefold(), flags=re.UNICODE)
    return frozenset(token for token in tokens if len(token) > 1 and token not in titles)


def normalized_name(value: str) -> str:
    return " ".join(sorted(normalized_tokens(value)))


def fide_header(game: chess.pgn.Game, side: str) -> str:
    for key, value in game.headers.items():
        if key.casefold() == f"{side}fideid".casefold():
            return "".join(character for character in value if character.isdigit())
    return ""


def target_side(game: chess.pgn.Game, fixture: Fixture) -> str | None:
    white_id = fide_header(game, "White")
    black_id = fide_header(game, "Black")
    if white_id == fixture.fide_id:
        return "White"
    if black_id == fixture.fide_id:
        return "Black"
    target = normalized_tokens(fixture.name)
    if normalized_tokens(game.headers.get("White", "")) == target and not white_id:
        return "White"
    if normalized_tokens(game.headers.get("Black", "")) == target and not black_id:
        return "Black"
    return None


def suspected_online(game: chess.pgn.Game) -> bool:
    event = game.headers.get("Event", "").casefold()
    site = game.headers.get("Site", "").casefold()
    broadcast = game.headers.get("BroadcastURL", "").casefold()
    is_lichess_broadcast = "lichess.org/broadcast/" in site or "lichess.org/broadcast/" in broadcast
    is_chess_com = (
        site == "chess.com"
        or site.startswith("https://chess.com")
        or site.startswith("http://chess.com")
        or "www.chess.com" in site
        or "chess.com" in event
    )
    if is_chess_com or ("lichess.org" in site and not is_lichess_broadcast):
        return True
    text = f"{event} {site}"
    return any(
        marker in text
        for marker in (
            "playchess",
            "online arena",
            "online chess",
            "internet chess",
            "live chess",
            "titled arena",
            "web chess",
        )
    )


def game_key(game: chess.pgn.Game, fixture: Fixture) -> str | None:
    moves = tuple(move.uci() for move in game.mainline_moves())
    if not moves:
        return None
    side = target_side(game, fixture)
    if not side:
        return None
    parts = [side, " ".join(moves)]
    if len(moves) < 12:
        parts.append(game.headers.get("Date", "????.??.??"))
    return "|".join(parts)


def read_games(text: str):
    stream = io.StringIO(text)
    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            return
        yield game


def load_baseline(path: pathlib.Path):
    if path.is_dir():
        for pgn_path in sorted(path.glob("*.pgn")):
            yield from read_games(pgn_path.read_text(encoding="utf-8", errors="replace"))
    else:
        yield from read_games(path.read_text(encoding="utf-8", errors="replace"))


def hidden_fields(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    return {
        element["name"]: element.get("value", "")
        for element in soup.select('input[type="hidden"][name]')
    }


def chess_results_pgn(session: requests.Session, fide_id: str) -> str:
    initial = session.get(CHESS_RESULTS, timeout=30)
    initial.raise_for_status()
    form = hidden_fields(initial.text)
    form.update(
        {
            "ctl00$P1$Txt_FideID": fide_id,
            "ctl00$P1$combo_anzahl_zeilen": "5",
            "ctl00$P1$cb_SuchenPartie": "Search",
        }
    )
    search = session.post(CHESS_RESULTS, data=form, timeout=30)
    search.raise_for_status()
    form = hidden_fields(search.text)
    form.update(
        {
            "ctl00$P1$Txt_FideID": fide_id,
            "ctl00$P1$combo_anzahl_zeilen": "5",
            "ctl00$P1$cb_DownLoadPGN": "Download as PGN-File",
        }
    )
    download = session.post(CHESS_RESULTS, data=form, timeout=30)
    download.raise_for_status()
    return download.content.decode("utf-8", errors="replace")


def lichess_tour_pgns(session: requests.Session, fixture: Fixture, since_year: int = 2026):
    tour_ids: set[str] = set()
    # Current/repaired regressions all sit on the first two recent-tournament
    # pages; the historical baseline is supplied locally and does not need a
    # network crawl through every old Lichess card.
    for page in range(1, 3):
        response = session.get(
            f"https://lichess.org/fide/{fixture.fide_id}/player",
            params={"page": page},
            timeout=30,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        links = []
        for element in soup.select('a[href^="/broadcast/"]'):
            href = element.get("href", "")
            time = element.select_one("time[datetime]")
            year = int(time.get("datetime", "0000")[:4]) if time else 0
            if len(href.strip("/").split("/")) == 4 and year >= since_year:
                links.append(href)
        if not links:
            break
        for path in links:
            detail = lichess_get(session, f"https://lichess.org/api{path}", timeout=30)
            tour_id = detail.json().get("tour", {}).get("id")
            if tour_id:
                tour_ids.add(tour_id)
        if not soup.select_one('a[rel="next"]'):
            break
    for tour_id in sorted(tour_ids):
        url = f"https://lichess.org/api/broadcast/{tour_id}.pgn"
        response = lichess_get(session, url, timeout=60)
        yield url, response.text


def lichess_get(session: requests.Session, url: str, timeout: int) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(3):
        time.sleep(0.3 if attempt == 0 else 2)
        try:
            response = session.get(url, timeout=timeout)
            if response.status_code == 429:
                time.sleep(max(1, int(response.headers.get("Retry-After", "60"))))
                continue
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last_error = error
    assert last_error is not None
    raise last_error


def verify_fixture(session: requests.Session, fixture: Fixture) -> dict[str, object]:
    baseline = Collected()
    baseline_raw = 0
    for game in load_baseline(fixture.baseline):
        baseline_raw += 1
        baseline.add(game, fixture, "baseline")

    union = Collected()
    for game in baseline.games.values():
        union.add(game, fixture, "baseline")

    chess_results_text = chess_results_pgn(session, fixture.fide_id)
    for game in read_games(chess_results_text):
        union.add(game, fixture, "Chess-Results")

    for url in fixture.live_urls:
        response = lichess_get(session, url, timeout=60)
        for game in read_games(response.text):
            union.add(game, fixture, "Lichess live FIDE tours")

    for url in fixture.extra_urls:
        response = session.get(url, timeout=60)
        response.raise_for_status()
        for game in read_games(response.text):
            union.add(game, fixture, "organizer PGN")

    dates = [
        game.headers.get("Date", "")
        for game in union.games.values()
        if game.headers.get("Date", "")[:4].isdigit()
    ]
    result = {
        "player": fixture.name,
        "fideId": fixture.fide_id,
        "baselineRaw": baseline_raw,
        "baselineUnique": len(baseline.games),
        "expectedBaseline": fixture.expected_baseline,
        "publicUnionUnique": len(union.games),
        "expectedUnion": fixture.expected_union,
        "newUnique": len(union.games) - len(baseline.games),
        "duplicatesRemoved": union.duplicates,
        "onlineExcluded": union.online_excluded,
        "invalidExcluded": union.invalid_excluded,
        "latestDate": max(dates, default=""),
        "sourceAdds": union.source_counts,
    }
    result["passed"] = (
        result["baselineUnique"] == fixture.expected_baseline
        and result["publicUnionUnique"] == fixture.expected_union
    )
    return result


def default_fixtures() -> tuple[Fixture, ...]:
    app_db = pathlib.Path.home() / "AppData/Roaming/org.encroissant.app/db"
    files_root = pathlib.Path.home() / "Documents/EnCroissant"
    return (
        Fixture(
            "Kodukula, Sameera",
            "343413994",
            app_db
            / "Sameera Kodukula Prep/00 Kodukula, Sameera/00 Kodukula, Sameera - OTB prep.pgn",
            33,
            38,
            (
                "https://lichess.org/api/broadcast/round/JAOwIFG7.pgn",
                "https://lichess.org/api/broadcast/round/VqWjin7h.pgn",
            ),
            (
                "https://www.4ncl.co.uk/pgn/2526/otb/4NCLotb2526all.pgn",
                "https://www.4ncl.co.uk/pgn/2526/congress/easter26/u2000.pgn",
            ),
        ),
        Fixture(
            "Lapidus, Alexey M.",
            "24276111",
            app_db
            / "Southall Congress 260620 U2400/03 Lapidus, Alexey M/03 Lapidus, Alexey M. - Southall U2400 OTB prep.pgn",
            112,
            121,
            (
                "https://lichess.org/api/broadcast/91xqHnuH.pgn",
                "https://lichess.org/api/broadcast/fBW60Iyo.pgn",
            ),
        ),
        Fixture(
            "Large, Peter G",
            "400866",
            files_root
            / "Oxford FIDE Congress U2300 player games/01 2183 - Large, Peter G [cc Plimsol high]/source-pgns",
            650,
            650,
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Emit compact JSON")
    args = parser.parse_args()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    results = [verify_fixture(session, fixture) for fixture in default_fixtures()]
    print(json.dumps(results, indent=None if args.json else 2))
    return 0 if all(result["passed"] for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
