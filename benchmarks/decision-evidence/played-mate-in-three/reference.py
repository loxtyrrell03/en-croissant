"""Independently enumerate legal mates in up to three, including draw claims."""
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys

import chess


class SearchLimit(Exception):
    pass


class Referee:
    def __init__(self, fen, moves, visits=450_000):
        self.board = chess.Board(fen)
        self.history = Counter({self.board._transposition_key(): 1})
        self.visits = visits
        for uci in moves:
            self.board.push_uci(uci)
            self.history[self.board._transposition_key()] += 1

    def push(self, move):
        self.visits -= 1
        if self.visits < 0:
            raise SearchLimit
        self.board.push(move)
        self.history[self.board._transposition_key()] += 1

    def pop(self):
        self.history[self.board._transposition_key()] -= 1
        self.board.pop()

    def automatic_draw(self):
        return (self.board.halfmove_clock >= 150
                or self.history[self.board._transposition_key()] >= 5
                or self.board.is_insufficient_material())

    def can_claim(self):
        return self.board.halfmove_clock >= 100 or self.history[self.board._transposition_key()] >= 3

    def ranked(self, hints):
        return sorted(self.board.legal_moves,
                      key=lambda move: (-int(move.uci() in hints),
                                        -int(self.board.is_capture(move)),
                                        -int(self.board.gives_check(move)), move.uci()))

    def attack(self, remaining, hints=frozenset()):
        if self.automatic_draw():
            return None
        if remaining == 1:
            for move in self.board.legal_moves:
                if not self.board.gives_check(move):
                    continue
                self.push(move)
                terminal = self.board.is_checkmate()
                self.pop()
                if terminal:
                    return [move.uci()]
            return None
        for move in self.ranked(hints):
            self.push(move)
            win = self.defend(remaining - 1, hints)
            self.pop()
            if win is not None:
                return [move.uci(), *win]
        return None

    def defend(self, remaining, hints):
        if self.board.is_checkmate():
            return []
        if self.automatic_draw() or self.can_claim():
            return None
        replies = self.ranked(frozenset())
        if not replies:
            return None
        longest = []
        for move in replies:
            self.push(move)
            win = None if self.can_claim() else self.attack(remaining, hints)
            self.pop()
            if win is None:
                return None
            candidate = [move.uci(), *win]
            if len(candidate) > len(longest):
                longest = candidate
        return longest


def assess(row):
    leader = row["candidates"][0]
    played = row["playedMoveUci"]
    best = leader["pvUci"][0]
    values = {
        "id": row["id"], "event": row["event"], "stratum": row["stratum"],
        "bestMove": best, "playedMove": played, "bestScoreMate": leader["mate"],
    }
    if best == played:
        return dict(values, verdict="negative", reason="same-root-move")
    if leader["mate"] is not None:
        return dict(values, verdict="negative", reason="leading-score-is-mate")

    def analyse(move, lines):
        referee = Referee(row["history"]["fen"], row["history"]["moves"])
        if referee.board.fen() != row["fen"]:
            raise ValueError(f"Wrong board in history for {row['id']}")
        referee.push(referee.board.parse_uci(move))
        hints = {mov for line in lines for mov in line["pvUci"][::2]}
        try:
            for limit in (1, 2, 3):
                witness = referee.attack(limit, hints)
                if witness:
                    return {"mateIn": limit, "line": witness, "budgetRemaining": referee.visits}
        except SearchLimit:
            return {"mateIn": "unknown", "budgetRemaining": 0}
        return {"mateIn": None, "budgetRemaining": referee.visits}

    replies = {p["moveUci"]: p["lines"] for p in row.get("replyProbes", [])}
    actual = analyse(played, replies.get(played, []))
    if actual["mateIn"] == "unknown":
        return dict(values, verdict="unknown", reason="played-proof-budget", actual=actual)
    if actual["mateIn"] != 3:
        return dict(values, verdict="negative", reason="played-is-not-exactly-three", actual=actual)
    other = analyse(best, replies.get(best, []))
    if other["mateIn"] == "unknown":
        return dict(values, verdict="unknown", reason="alternative-proof-budget", actual=actual, alternative=other)
    if other["mateIn"] is not None:
        return dict(values, verdict="negative", reason="mate-remains-after-other-choice", actual=actual, alternative=other)
    return dict(values, verdict="positive", reason="legal-mate-in-three-is-avoidable", actual=actual, alternative=other)


if __name__ == "__main__":
    source, target = map(Path, sys.argv[1:])
    data = json.loads(source.read_bytes())
    outcomes = []
    with ProcessPoolExecutor(max_workers=7) as pool:
        for index, answer in enumerate(pool.map(assess, data), 1):
            outcomes.append(answer)
            if index % 16 == 0:
                print(index, Counter(x["verdict"] for x in outcomes), flush=True)
    with target.open("x", encoding="utf-8") as stream:
        json.dump(outcomes, stream, indent=2)
        stream.write("\n")
    print(Counter(x["verdict"] for x in outcomes), flush=True)
