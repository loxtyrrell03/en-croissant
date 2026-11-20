"""Select fresh classical games with an own pawn close to promotion."""
from collections import Counter, defaultdict
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.pgn

work, lab, previous = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location("prior_sample", previous / "sample.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
sources = prior.classical_sources(work)
previous_inputs = [work/"reply-budget-allocation"/f"{key}-input.json" for key in ("archive","reserve")]
previous_inputs.append(work/"reply-budget-allocation"/"prospective-sample.json")
rows = [row for file in previous_inputs for row in json.loads(file.read_bytes())]
excluded = {prior.board_key(chess.Board(row["fen"])) for row in rows}
excluded_sites = {row["site"] for row in rows if row.get("site")}
seed = "own-promotion-evidence-2c52c962"
filters = dict(promotion_legal=True, covered=True)

def rank(records):
    annotation = records["annotatedLossCp"]
    strata = records["stratum"]
    annotated = annotation is not None and annotation >= 80
    return (not annotated if strata != "played-promotion" else annotated, records["id"])

def rank_game(board, node, next_moves):
    last_rank = 6 if board.turn else 1
    pawns = board.pieces(chess.PAWN, board.turn) & chess.BB_RANKS[last_rank]
    if not pawns or board.is_check():
        return None
    found = bool(next_moves[0].promotion)
    if found:
        return "played-promotion"
    if any(move.promotion for move in board.legal_moves):
        return "deferred-promotion"
    return "covered-advance"

seen = set()
pool = defaultdict(list)
scanned = 0
for file, (event, site) in sorted(sources.items()):
    with file.open(encoding="utf-8-sig", errors="replace") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            if game.errors or game.headers.get("Result", "*") == "*" or not game.headers.get("White"):
                continue
            if game.headers.get("Site") in excluded_sites:
                continue
            nodes = list(game.mainline())
            moves = [node.move for node in nodes]
            token = sha256((event + " " + " ".join(m.uci() for m in moves[:34])).encode()).hexdigest()
            if token in seen or len(moves) < 41:
                continue
            seen.add(token)
            scanned += 1
            board = game.board()
            case_matches = []
            history = [m.uci() for m in moves]
            for i, node in enumerate(nodes):
                if i >= 30 and prior.board_key(board) in excluded:
                    break
                stratum = rank_game(board,node,moves[i:i+4]) if 37 <= i < len(moves)-4 else None
                if stratum:
                    old, new = node.parent.eval(), node.eval()
                    loss = old.pov(board.turn).score(mate_score=5000)-new.pov(board.turn).score(mate_score=5000) if old is not None and new is not None else None
                    game_link = game.headers.get("Site", "")
                    selected_site = game_link if game_link.startswith("https://lichess.org/broadcast/") else site
                    identity = sha256(f"{seed}:{token}:{i}".encode()).hexdigest()[:16]
                    case_matches.append(dict(id="own-promotion-"+identity, fen=board.fen(),
                        playedMoveUci=history[i], recorded=history[i:i+10], annotatedLossCp=loss,
                        game=token, event=event, site=selected_site, stratum=stratum, ply=i,
                        history={"fen":game.board().fen(),"moves":history[:i]}))
                board.push(node.move)
            else:
                for row in case_matches:
                    pool[row["stratum"]].append(row)

# Event-family grouping is frozen before opening scores or classifier results.
events = {row["event"] for cases in pool.values() for row in cases}
order = sorted(events, key=lambda event: sha256((seed+event).encode()).hexdigest())
split = {event: ("development" if i % 3 == 0 else "reserve") for i,event in enumerate(order)}
chosen = {}
for cohort, limits in (("development",(44,20,14)), ("reserve",(83,26,18))):
    rows = []
    used = set()
    counts = Counter()
    for stratum, limit in zip(("deferred-promotion","played-promotion","covered-advance"), limits, strict=True):
        candidates = [row for row in sorted(pool[stratum],key=rank) if split[row["event"]] == cohort]
        while len([r for r in rows if r["stratum"]==stratum]) < limit:
            eligible=[row for row in candidates if row["game"] not in used]
            if not eligible:break
            row=min(eligible,key=lambda row:(counts[row["event"]]//4,rank(row)))
            used.add(row["game"])
            counts[row["event"]] += 1
            rows.append(row)
    chosen[cohort] = rows
    out=lab/(cohort+"-sample.json")
    with out.open("x",encoding="utf-8") as f:json.dump(rows,f,separators=(",",":"))
    print(cohort,len(rows),len(counts),Counter(row["stratum"] for row in rows),flush=True)
(lab/"sampling.json").write_text(json.dumps(dict(seed=seed,scanned=scanned,sourceRounds=len(sources),
    groupedEvents=split,rawCounts={k:len(v) for k,v in pool.items()}),indent=2),encoding="utf-8")
