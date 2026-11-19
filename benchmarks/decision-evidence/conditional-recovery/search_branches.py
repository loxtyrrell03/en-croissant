from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import chess
import chess.engine
import json
import sys



def payload(root, info):
    return {
        "fen": root.fen(), "cp": info["score"].pov(root.turn).score(),
        "mate": info["score"].pov(root.turn).mate(), "depth": info["depth"],
        "pvUci": [move.uci() for move in info.get("pv",[])], "nodes": info["nodes"],
    }


def search(engine, board, nodes, roots=None):
    engine.configure({"Clear Hash": None})
    return payload(board, engine.analyse(board, chess.engine.Limit(nodes=nodes), root_moves=roots))


def analyse(task):
    row, exe, deep = task
    board = chess.Board(row["fen"])
    history = row.get("history")
    if history:
        board=chess.Board(history["fen"])
        for move in history["moves"]:
            board.push_uci(move)
        assert board.fen() == row["fen"]
    assert board.fen() == row["fen"]
    control = board.copy()
    control.push_uci(row["better"])
    weaker = board.copy()
    weaker.push_uci(row["weaker"])
    reply = chess.Move.from_uci(row["sameReply"])
    assert reply in control.legal_moves and reply in weaker.legal_moves
    resolved = control.copy()
    resolved.push(reply)
    with chess.engine.SimpleEngine.popen_uci(exe) as engine:
        engine.configure({"Threads":1,"Hash":64})
        result={}
        if not resolved.is_game_over():
            result["forced"] = search(engine, control, 1_000_000, [reply])
            result["followup"] = search(engine, resolved, 1_000_000)
            if deep:
                result["deepForced"] = search(engine, control, 4_000_000, [reply])
                result["deepFollowup"] = search(engine, resolved, 4_000_000)
        if len(row["playedReplies"])==0:
            result["verifyWeaker"] = search(engine, weaker, 1_000_000)
    return row | result


if __name__ == "__main__":
    engine_path, candidates_path, output = sys.argv[1:]
    candidates = json.loads(Path(candidates_path).read_bytes())
    with Path(output).open("x", encoding="utf8") as stream:
        with ThreadPoolExecutor(max_workers=5) as pool:
            for result in pool.map(analyse, ((row, engine_path, True) for row in candidates)):
                stream.write(json.dumps(result) + "\n")
