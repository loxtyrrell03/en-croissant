"""Screen and independently replay exact pairs of moves from one position."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

import chess


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pair_sample", HERE / "sample.py")
sampling = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sampling)
from assets import reached, relative_rank
from search import engines, search


PREVIEW = sampling.PROTOCOL["preview"]
REFERENCE = sampling.PROTOCOL["reference"]
HORIZON = REFERENCE["horizonPliesAfterRoot"]
RESTRAINTS = {"captured", "blocked"}


def trace(board, pawn, moves):
    """Track the same pawn or its promotion, without assigning a chess cause."""
    board = board.copy()
    color = board.color_at(pawn)
    if color is None or board.piece_type_at(pawn) != chess.PAWN:
        raise ValueError("Expected the original pawn on the reached board")
    advance = None
    last_blockades = []
    played = []
    for index, uci in enumerate(moves[:HORIZON], 1):
        if board.is_game_over():
            break
        move = board.parse_uci(uci)
        if not move:
            raise ValueError("A null move is not a legal continuation")
        if board.turn == color and advance is None:
            ahead = pawn + (8 if color else -8)
            last_blockades.append(pawn if board.color_at(ahead) == (not color) else None)
        victim = move.to_square - (8 if board.turn else -8) if board.is_en_passant(move) else move.to_square
        played.append(board.san(move))
        if victim == pawn and board.turn != color:
            return {"outcome": "captured", "advancePly": advance, "capturePly": index, "line": played}
        if move.from_square == pawn:
            pawn = move.to_square
            if advance is None and relative_rank(pawn, color) >= 6:
                advance = index
        board.push(move)
    outcome = None
    if len(played) >= HORIZON:
        if advance is not None and len(played) - advance >= REFERENCE["survivalAfterAdvancePlies"]:
            outcome = "advances"
        if advance is None and last_blockades[-2:] == [pawn, pawn]:
            if board.color_at(pawn + (8 if color else -8)) == (not color):
                outcome = "blocked"
    return {"outcome": outcome, "advancePly": advance, "capturePly": None, "line": played}


def pair_direction(outcomes):
    if outcomes[0] == "advances" and outcomes[1] in RESTRAINTS:
        return 0
    if outcomes[1] == "advances" and outcomes[0] in RESTRAINTS:
        return 1
    return None


def evaluate(trace_results):
    outcomes = {result["outcome"] for result in trace_results}
    if outcomes <= RESTRAINTS and outcomes:
        return "blocked" if "blocked" in outcomes else "captured"
    return outcomes.pop() if len(outcomes) == 1 else None


def preview(row, engine):
    board = reached(row)
    root = search(board, engine, PREVIEW["rootNodes"], min(4, board.legal_moves.count()))
    lines = root["lines"]
    if not lines or lines[0]["cp"] is None:
        return dict(row, status="no-preview-score")
    pawn = chess.parse_square(row["pawn"])
    alternative = next((
        line["pvUci"][0] for line in lines
        if line["pvUci"][0] != row["played"] and line["cp"] is not None
        and lines[0]["cp"] - line["cp"] <= 150
        and sampling.eligible_move(board, board.parse_uci(line["pvUci"][0]), pawn)
    ), None)
    if not alternative:
        return dict(row, status="no-pawn-preserving-alternative")
    arms = []
    for uci in (row["played"], alternative):
        child = board.copy()
        child.push_uci(uci)
        if not child.legal_moves.count():
            return dict(row, status="terminal-child")
        replies = search(child, engine, PREVIEW["replyNodes"], min(2, child.legal_moves.count()))
        traces = [trace(child, pawn, line["pvUci"]) for line in replies["lines"]]
        arms.append({"move": uci, "replies": replies, "traces": traces})
    hint = 0
    for own, other in ((arms[0], arms[1]), (arms[1], arms[0])):
        advance = sum(trace["advancePly"] is not None and trace["capturePly"] is None for trace in own["traces"])
        restraint = sum(trace["capturePly"] is not None or trace["outcome"] == "blocked"
                        for trace in other["traces"])
        quiet = sum(trace["advancePly"] is None for trace in other["traces"])
        if advance and (restraint or quiet):
            hint = max(hint, advance * 2 + restraint * 2 + quiet)
    return dict(row, status="paired", arms=arms, hint=hint, previewRoot=root)


def select_preview(rows, split):
    paired = [row for row in rows if row["status"] == "paired"]
    high = sorted((row for row in paired if row["hint"] > 0), key=lambda row: (-row["hint"], row["id"]))
    controls = sorted((row for row in paired if not row["hint"]), key=lambda row: row["id"])
    return (
        [dict(row, selection="nomination") for row in high[:PREVIEW["maxNominations"][split]]]
        + [dict(row, selection="control") for row in controls[:PREVIEW["matchedControlPerSplit"]]]
    )


def reference_for(row, engine, repeat):
    board = reached(row)
    pawn = chess.parse_square(row["pawn"])
    paired = [board.parse_uci(arm["move"]) for arm in row["arms"]]
    root_nodes = REFERENCE["repeatNodes" if repeat else "rootNodes"]
    reply_nodes = REFERENCE["repeatNodes" if repeat else "replyNodes"]
    root = search(board, engine, root_nodes, 2, paired)
    lines = {line["pvUci"][0]: line for line in root["lines"]}
    arms = []
    for move in paired:
        child = board.copy()
        child.push(move)
        moves = child.legal_moves.count()
        replies = search(child, engine, reply_nodes, min(2, moves))
        traces = []
        root_line = lines.get(move.uci())
        candidates = replies["lines"]
        if root_line and root_line["fen"] == board.fen() and root_line["cp"] is not None:
            if len(candidates) == min(2, moves) and all(line["fen"] == child.fen() for line in candidates):
                first = candidates[0]
                if first["cp"] is not None:
                    traces = [trace(child, pawn, root_line["pvUci"][1:]), trace(child, pawn, first["pvUci"])]
                    if len(candidates) == 2:
                        second = candidates[1]
                        if (second["depth"] == first["depth"] and second["cp"] is not None
                                and 0 <= first["cp"] - second["cp"] <= REFERENCE["closeReplyCp"]):
                            traces.append(trace(child, pawn, second["pvUci"]))
        arms.append({
            "move": move.uci(), "san": board.san(move), "rootCp": root_line["cp"] if root_line else None,
            "replies": replies, "traces": traces, "outcome": evaluate(traces),
        })
    direction = pair_direction([arm["outcome"] for arm in arms])
    return {"root": root, "compared": arms, "advancingBranch": direction}


def worth_repeating(row):
    first, second = [{item["outcome"] for item in arm["traces"]} for arm in row["reference"]["compared"]]
    return ("advances" in first and bool(second & RESTRAINTS)
            or "advances" in second and bool(first & RESTRAINTS))


def run(command, source, engine):
    output = {}
    with ThreadPoolExecutor(7) as pool:
        for split, rows in source.items():
            if command == "preview":
                result = list(pool.map(lambda row: preview(row, engine), rows))
                print(split, Counter(row["status"] for row in result),
                      sum(row.get("hint", 0) > 0 for row in result), "preview nominations", flush=True)
            elif command == "reference":
                result = list(pool.map(
                    lambda row: dict(row, reference=reference_for(row, engine, False)),
                    select_preview(rows, split),
                ))
            else:
                result = list(pool.map(
                    lambda row: dict(row, stronger=reference_for(row, engine, True)),
                    [row for row in rows if worth_repeating(row)],
                ))
            if command != "preview":
                field = "reference" if command == "reference" else "stronger"
                print(split, len(result), "studied",
                      Counter(row[field]["advancingBranch"] for row in result), flush=True)
            output[split] = result
    return output


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=("preview", "reference", "adjudicate"))
    p.add_argument("source", type=Path)
    p.add_argument("engine", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    raw = args.source.read_bytes()
    try:
        output = run(args.command, json.loads(raw), str(args.engine))
    finally:
        for process in engines:
            process.quit()
    receipt = {"inputSha256": sha256(raw).hexdigest(),
               "stockfishSha256": sha256(args.engine.read_bytes()).hexdigest()}
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(output, stream, separators=(",", ":"))
        stream.write("\n")
    print(receipt, flush=True)


if __name__ == "__main__":
    main()
