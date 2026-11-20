"""Compare cached replies, one targeted reply, and independent reply verification."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

from freeze_sample import read, write
from quiet_screen import legal_next, outcome, quiet_roles, threat_targets

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defence-after-attack"))
from gather import initial, searched

APP_ROOT = 2_400_000
APP_REPLY = 1_400_000
REF_ROOT = 5_400_000
REF_REPLY = 3_200_000
RELEVANCE = 100


def finite(line):
    return line and line["cp"] is not None and line["mate"] is None and line["depth"] >= 16


def opened_checks(after, reply, root):
    reached = after.copy(stack=True)
    reached.push(reply)
    return {
        move.uci() for move in reached.generate_legal_moves()
        if move.from_square != root.to_square and reached.gives_check(move)
        and reply.from_square in chess.SquareSet(chess.between(move.from_square, move.to_square))
        and not legal_next(after, move, reached.turn)
    }


def reply_shapes(board, root, reply):
    after = board.copy(stack=True)
    after.push(root)
    for target in threat_targets(board, root):
        role = quiet_roles(after, root, reply, target)
        if role == "interpose" and opened_checks(after, reply, root):
            yield target, role
        elif role == "switch":
            yield target, role


def nominate(board, root_line, replies):
    if not finite(root_line) or len(replies) < 2 or not finite(replies[0]):
        return None
    best = replies[0]
    if abs(root_line["cp"] + best["cp"]) > 90:
        return None
    root = board.parse_uci(root_line["pvUci"][0])
    after = board.copy(stack=True)
    after.push(root)
    for line in replies[1:]:
        if (not finite(line) or line["depth"] != best["depth"]
                or best["cp"] - line["cp"] < RELEVANCE or len(line["pvUci"]) < 5):
            continue
        reply = after.parse_uci(line["pvUci"][0])
        for target, role in reply_shapes(board, root, reply):
            effect = outcome(after, reply, line["pvUci"][1:], root, target, role)
            if effect:
                return dict(root=root.uci(), reply=reply.uci(), target=chess.square_name(target),
                            role=role, effect=effect, replyFrame=line, saferReply=best,
                            gap=best["cp"] - line["cp"])
    return None


def next_candidate(board, root_line, replies):
    if not finite(root_line) or not replies or not finite(replies[0]):
        return None
    if abs(root_line["cp"] + replies[0]["cp"]) > 90:
        return None
    root = board.parse_uci(root_line["pvUci"][0])
    if not threat_targets(board, root):
        return None
    after = board.copy(stack=True)
    after.push(root)
    existing = {line["pvUci"][0] for line in replies}
    candidates = []
    for reply in after.legal_moves:
        if reply.uci() in existing:
            continue
        for square, role in reply_shapes(board, root, reply):
            # Prefer a defence that opens an already verified legal checking
            # route. A material proposal still needs independent retention.
            candidates.append((role != "interpose", reply.uci()))
    return min(candidates)[1] if candidates else None


def point(board, proposal):
    root = board.parse_uci(proposal["root"])
    reached = board.copy(stack=True)
    reached.push(root)
    reply = reached.parse_uci(proposal["reply"])
    checkpoint = reached.copy(stack=True)
    checkpoint.push(reply)
    return root,reached,reply,checkpoint


def confirm(board, proposal, lines):
    root, reached, reply, _ = point(board,proposal)
    if len(lines) < 2 or not finite(lines[0]):
        return False
    score = lines[0]["cp"]
    if abs(score + proposal["replyFrame"]["cp"]) > 110:
        return False
    target = chess.parse_square(proposal["target"])
    if proposal["effect"] == "opened-check":
        eligible = opened_checks(reached, reply, root)
        if lines[0]["pvUci"][0] not in eligible:
            return False
        control = next((x for x in lines[1:] if x["pvUci"][0] not in eligible and finite(x)),None)
        return bool(control and score - control["cp"] >= 40)
    return any(
        finite(line) and score - line["cp"] <= 35
        and outcome(reached,reply,line["pvUci"],root,target,proposal["role"]) == "material"
        for line in lines
    )


def classify_case(case, binary, mode):
    board = initial(case)
    timings = []
    start = perf_counter()
    with chess.engine.SimpleEngine.popen_uci(binary) as engine:
        engine.configure({"Threads":1,"Hash":64})

        def search(position, nodes, width, roots=None, reason="frame"):
            lines = searched(engine,position,nodes,width,roots)
            timings.append(dict(nodes=nodes, complete=max((line["nodes"] for line in lines),default=0),reason=reason))
            return [dict(line,fen=position.fen()) for line in lines]

        config = (APP_ROOT,APP_REPLY) if mode == "app" else (REF_ROOT,REF_REPLY)
        if mode == "ref":
            root = case["recordedRoot"]
            reply = case["recordedReply"]
            if not case["roles"]:
                return {"id":case["id"],"label":"ordinary-unreviewed"}
            leading = search(board,config[0],1)
            if not leading or not finite(leading[0]):
                return {"id":case["id"],"label":"unresolved"}
            candidate = leading[0]
            if candidate["pvUci"][0] != root:
                paired = search(board,config[0],2,[root,candidate["pvUci"][0]])
                actual = next((line for line in paired if line["pvUci"][0]==root),None)
                if not finite(actual) or not finite(paired[0]):
                    return {"id":case["id"],"label":"unresolved"}
                if paired[0]["cp"] - actual["cp"] > 50:
                    return dict(id=case["id"],label="root-not-competitive",paired=paired)
                candidate = actual
            reached = board.copy(stack=True)
            reached.push_uci(root)
            replies = search(reached,config[1],2)
            if not replies or not finite(replies[0]):
                return {"id":case["id"],"label":"unresolved"}
            if replies[0]["pvUci"][0] == reply:
                return dict(id=case["id"],label="reply-competitive",replies=replies,candidate=candidate)
            exact = search(reached,config[1],2,[replies[0]["pvUci"][0],reply])
            exact_reply = next((line for line in exact if line["pvUci"][0]==reply),None)
            if not finite(exact_reply) or not finite(exact[0]):
                return {"id":case["id"],"label":"unresolved"}
            if exact[0]["cp"] - exact_reply["cp"] < RELEVANCE:
                return dict(id=case["id"],label="reply-competitive",replies=exact,candidate=candidate)
            proposal = nominate(board,candidate,exact)
            if not proposal:
                return dict(id=case["id"],label="needs-review",replies=exact,candidate=candidate)
            independent = search(point(board,proposal)[3],4_800_000,4,reason="confirm")
            return dict(id=case["id"],label="positive" if confirm(board,proposal,independent) else "needs-review",
                        proposal=proposal,replies=exact,independent=independent,candidate=candidate)

        candidates = search(board,config[0],3)
        if not candidates:
            return dict(id=case["id"],scopeUnavailable=True)
        probes, tries = [], []
        # Position and exact candidate replay. Examine the leading move
        # and a recorded near-leading alternative when it is in the frame.
        selected = [candidates[0]]
        if case["roles"] and finite(candidates[0]):
            selected += [
                line for line in candidates[1:] if line["pvUci"][0] == case["recordedRoot"]
                and finite(line) and candidates[0]["cp"] - line["cp"] <= 50
            ]
        for candidate in selected:
            root = board.parse_uci(candidate["pvUci"][0])
            if not threat_targets(board,root):
                continue
            reached = board.copy(stack=True)
            reached.push(root)
            replies = search(reached,config[1],3)
            probes.append(dict(moveUci=root.uci(),lines=replies))
            if cached := nominate(board,candidate,replies):
                independent = search(point(board,cached)[3],1_400_000,3,reason="confirm")
                tries.append(dict(nomination=cached,arm="cached",independent=independent,
                                  confirmed=confirm(board,cached,independent)))
            elif extra := next_candidate(board,candidate,replies):
                exact = search(reached,1_400_000,2,[replies[0]["pvUci"][0],extra],reason="target")
                chosen = nominate(board,candidate,exact)
                if chosen:
                    independent = search(point(board,chosen)[3],1_400_000,3,reason="confirm")
                    tries.append(dict(nomination=chosen,arm="targeted",independent=independent,
                                      confirmed=confirm(board,chosen,independent)))
                else:
                    tries.append(dict(extra=extra,arm="targeted",confirmed=False))
    return dict(case,candidates=candidates,replyProbes=probes,attempts=tries,
                searches=timings,elapsedMs=round(1000*(perf_counter()-start)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode",choices=("app","ref"))
    parser.add_argument("sample",type=Path)
    parser.add_argument("exe")
    parser.add_argument("output",type=Path)
    parser.add_argument("--workers",type=int,default=7)
    args = parser.parse_args()
    rows = read(args.sample)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = []
        for result in pool.map(lambda row:classify_case(row,args.exe,args.mode),rows):
            results.append(result)
            if len(results)%12==0:
                print(args.mode,len(results),flush=True)
    write(args.output,results)
    if args.mode=="ref":
        print(Counter(r["label"] for r in results),flush=True)
    else:
        print(Counter((a["arm"],a["confirmed"]) for r in results for a in r.get("attempts", [])),flush=True)


if __name__ == "__main__":
    main()
