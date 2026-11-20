"""Freeze one capture-prone annotated mistake per public game before worker replay."""
from collections import Counter
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re
import sys
import chess
import chess.pgn



def main(output, exclusions, folder, limit):
    audit_path = Path(__file__).parent.parent / "current-classifier-audit" / "freeze.py"
    spec = importlib.util.spec_from_file_location("audit_freeze", audit_path)
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    games, boards = set(), set()
    for path in exclusions:
        for row in audit.read(path):
            history = row.get("history")
            if history and isinstance(history, dict) and len(history.get("moves", ())) >= 24:
                games.add(audit.identity(history["fen"], history["moves"]))
            boards.add(audit.board_key(chess.Board(row["fen"])))
    selected, seen_files, manifest = [], set(), {}
    paths = sorted(folder.rglob("*.pgn"), key=lambda path: sha256(("capture-pgn-v1:" + str(path.relative_to(folder))).encode()).hexdigest())
    for path in paths:
        if path.stat().st_size > 5_000_000 or path.stat().st_size < 3000:
            continue
        raw = path.read_bytes()
        digest = sha256(raw).hexdigest()
        text = raw[:4096].decode("utf-8", errors="ignore")
        if digest in seen_files or re.search(r'(?i)\[Event ".*(?:blitz|rapid|bullet|armageddon)', text):
            continue
        seen_files.add(digest)
        population = []
        with path.open(encoding="utf-8-sig", errors="replace") as file:
            while (game := chess.pgn.read_game(file, Visitor=audit.Broadcast)) is not None:
                if game.errors or not game.headers.get("Site","").startswith("https://lichess.org/broadcast/"):
                    continue
                if game.headers.get("Result") not in ("1-0","0-1","1/2-1/2"):
                    continue
                control = game.headers.get("TimeControl", "")
                if control and control.split("+")[0].isdigit() and int(control.split("+")[0]) < 3600:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                sequence = list(game.mainline())
                history = [node.move.uci() for node in sequence]
                start = board.fen()
                fingerprint = audit.identity(start, history)
                if fingerprint in games:
                    continue
                for ply, node in enumerate(sequence):
                    try:
                        if not 24 <= ply <= min(len(sequence)-7, 95):
                            continue
                        before, after = node.parent.eval(), node.eval()
                        if before is None or after is None or before.is_mate() or after.is_mate():
                            continue
                        drop = before.pov(board.turn).score()-after.pov(board.turn).score()
                        if not 60 <= drop <= 350 or board.is_check() or audit.board_key(board) in boards:
                            continue
                        reached = board.copy(stack=False)
                        reached.push(node.move)
                        captures = [m for m in reached.legal_moves if reached.is_capture(m) and not m.promotion]
                        if len(captures) < 2:
                            continue
                        recapturable = 0
                        for capture in captures:
                            reply = reached.copy(stack=False)
                            reply.push(capture)
                            if any(m.to_square == capture.to_square and reply.is_capture(m) for m in reply.legal_moves):
                                recapturable += 1
                        if not recapturable:
                            continue
                        token = sha256(f"alternate-capture-v1:{fingerprint}:{ply}".encode()).hexdigest()[:16]
                        population.append(dict(id=token,fen=board.fen(),game=fingerprint,
                            history=dict(fen=start,moves=history[:ply]),playedMoveUci=node.move.uci(),
                            site=game.headers.get("Site"),drop=drop,event=path.stem))
                    finally:
                        board.push(node.move)
        counts = Counter()
        for row in sorted(population, key=lambda value: value["id"]):
            board_id = audit.board_key(chess.Board(row["fen"]))
            if row["game"] in games or board_id in boards:
                continue
            selected.append(row)
            counts[path.stem] += 1
            games.add(row["game"])
            boards.add(board_id)
            if counts[path.stem] >= 5 or len(selected) >= limit:
                break
        if counts:
            manifest[str(path.relative_to(folder))] = {"sha256":digest,"count":sum(counts.values())}
        if len(selected) == limit:
            break
    for suffix, value in (("", selected),("-manifest", manifest)):
        path=output.with_stem(output.stem+suffix)
        with path.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2 if suffix else None)
    print(len(selected),len(manifest),flush=True)


if __name__ == "__main__":
    output, folder, limit, *previous = sys.argv[1:]
    main(Path(output), list(map(Path,previous)), Path(folder), int(limit))
