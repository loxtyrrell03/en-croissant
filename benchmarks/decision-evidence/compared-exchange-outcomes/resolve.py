"""Test exchange persistence at the first resolved continuation after set-up."""
from collections import Counter
import json
from pathlib import Path
import sys

import chess

from screen import sequence, route_changes


def compared_choice(root, good, bad, confirmed):
    if min(len(good), len(bad), len(confirmed)) < 7:
        return {}
    horizon = min(len(good), len(bad), len(confirmed))
    captures = []
    for branch in (bad, confirmed):
        captured = {}
        for index in range(1, min(horizon - 2, 10), 2):
            step = branch[index]
            if step.capture is None:
                continue
            if all(peer.check or peer.capture is not None for peer in branch[1:index:2]):
                captured.setdefault(step.capture, index)
        captures.append(captured)
    outputs = {}
    for victim, first in captures[0].items():
        corroboration = captures[1].get(victim)
        if corroboration is None:
            continue
        if min(first, corroboration) == 1:
            continue
        if victim not in good[horizon - 1].present:
            continue
        for common in range(max(first, corroboration) + 3, horizon + 1):
            branches = (good, bad, confirmed)
            if not all(all(step.quiet for step in branch[common - 2:common]) for branch in branches):
                continue
            # Both sides have had a quiet move after the exchange. Ignore a
            # later partial recoupment if the comparative material cost remains.
            remaining = [index for index in range(common - 1, horizon)
                         if index == horizon - 1 or all(branch[index].quiet for branch in branches)]
            if any(branch[index].material > -100
                   or good[index].material - branch[index].material < 100
                   for branch in (bad, confirmed) for index in remaining):
                continue
            gain = min(good[common - 1].material - branch[common - 1].material
                       for branch in (bad, confirmed))
            proof = {"victim": chess.square_name(victim), "plies": common,
                     "takenAt": [first + 1, corroboration + 1], "minimumMaterialDifference": gain,
                     "better": [step.san for step in good[:common]],
                     "worse": [step.san for step in bad[:common]],
                     "confirmation": [step.san for step in confirmed[:common]]}
            outputs.setdefault("resolved", proof)
            if route_changes(root, good, bad, first) and route_changes(root, good, confirmed, corroboration):
                outputs.setdefault("resolved-route", proof)
            break
    return outputs


def compare(row, roots, alt, reply, compare_lines=compared_choice):
    if not reply or not roots:
        return {}
    better = roots[0]
    played = next((line for line in roots[1:] if line["pvUci"][0] == alt), None)
    if (not played or better["depth"] != played["depth"] or min(better["depth"], reply["depth"]) < 16
            or any(line["cp"] is None or line.get("mate") is not None for line in (better, played, reply))):
        return {}
    if better["cp"] - played["cp"] < 100 or abs(played["cp"] + reply["cp"]) > 90:
        return {}
    root = chess.Board(row["fen"])
    reached = root.copy(stack=False)
    reached.push_uci(alt)
    if reached.fen() != chess.Board(reply["fen"]).fen():
        return {}
    return compare_lines(root, sequence(root, better["pvUci"], limit=17),
                         sequence(root, played["pvUci"], limit=17),
                         sequence(root, [alt, *reply["pvUci"]], limit=17))


def use_archive(inputs, replays):
    index = {row["id"]: row for row in inputs}
    for result in replays:
        row = index[result["id"]]
        roots = (row.get("comparisonCandidates") if result["scope"] == "mistake" else None) or row["candidates"]
        yield row["id"], result["scope"], result["label"]["tactical"], compare(
            row, roots, result["candidate"], result["probe"]["lines"][0])


def use_reserve(inputs, reference):
    labels = {row["id"]: row.get("tacticalExchange") for row in reference}
    for row in inputs:
        roots = row["comparisonCandidates"] or row["candidates"]
        actual = row["playedMoveUci"]
        reply = next((probe["lines"][0] for probe in row["replyProbes"] if probe["moveUci"] == actual), None)
        witnessed = (compare(row, roots, actual, reply)
                     if roots[0]["pvUci"][0] == row["candidates"][0]["pvUci"][0] else {})
        yield row["id"], "mistake", labels.get(row["id"]), witnessed


if __name__ == "__main__":
    mode, inputs, replays, output = sys.argv[1:]
    def load(path):
        return json.loads(Path(path).read_bytes())
    results = list((use_archive if mode == "archive" else use_reserve)(load(inputs), load(replays)))
    print(Counter((scope, label, arm) for _, scope, label, witnessed in results for arm in witnessed))
    for ident, scope, label, witnessed in results:
        if witnessed:
            print(ident, label, *witnessed)
    with Path(output).open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)
