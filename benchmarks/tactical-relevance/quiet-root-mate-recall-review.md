# Nonchecking first moves of longer mates

Adapter **126 / live pipeline 131** removes a checking-first-move restriction
from the existing bounded mating verifier. Quiet moves, check evasions and
nonchecking captures can now explain a longer forced mate when every legal
defence has a verified answer. This continues the same eight owner games and
420 pre-move contexts; it is not a new game sample or an accuracy estimate.

## Chess findings and visible changes

In the third owner sample, **Qxh8** at ply 34 previously led with Hanging Piece.
It now leads with an independently verified **Forcing Mate within six moves**.
The rook capture is not the most important lesson. Because Qxh8 was played, it
does not become a missed opportunity.

At ply 48, **Kd2** answers check and preserves a mate within four. The former
headline borrowed a later discovered check; the new headline explains the
actual first move, with **d6+** remaining a secondary Discovered Check at ply 3.
The played Ke2 receives the immediate missed-mate lesson. The preceding Nxc2+
was also the analysed best move, so its comparison remains **existing danger**,
not a new accusation that it caused the loss. An alternative Ne6 at ply 42
also receives a certificate, but the already-supported faster Qf7+ mate in two
retains priority. Alternative Kd1/Kf1 continuations have longer bounds.

Eight full owner rows change, including adjacent review contexts and source
continuations. Only two principal live headlines change; eight rows are not
eight independent recovered tactics. The other 412 full results are unchanged
apart from version/timing metadata, not certified correct. The first two
samples (217 and 122 contexts) remain fully unchanged.

Public Lichess **0rcU4, Qh4** now receives a complete mate-within-four lesson
instead of a mixed material-or-mate attack. Root-only input retains the earlier
Mating Attack, not an invented longer mate distance. Two other public longer
quiet mates, **0z5nl** and **0QPvf**, remain unproved. One private course live
root, **Qxc4**, gains mate within six; its supplied course-solution root is
still unclassified. All 246 private source results and the other 245 live
results remain unchanged, as do the twenty rare-theme results.

## What is proved, and what is not

- The supplied legal PV must end in mate within seven attacking moves. It only
  nominates the search: every legal defending reply must have a legal answer.
- The unchanged 65,536-operation budget covers the full search. At most two
  PV-nominated nonchecking attacking continuations are allowed. Exhaustion,
  stalemate, insufficient material and supported fifty-move claims cannot
  certify the line. Existing short quiet-mate handling/wording stays separate.
  This change does not broaden the separate short nonchecking-capture handling.
- Newly admitted nonchecking roots use colour-stable ordering. The original
  ordering exhausted the budget on a reflected course case; deterministic
  rank-reflected tie breaking restores the same certificate in both colours.
  Existing checking-root ordering is unchanged.
- Nonchecking Forcing Mate roots draw only their first move on the starting
  board. A later mate, discovery or deflection stays at its actual ply; the
  selected PV's arbitrary defensive moves are not starting-board arrows.
- No engine or worker deadline increases, new automatic network requests,
  game mutations or engine-setting changes were introduced.

These are upper bounds on a verified mating strategy, not proofs of the
shortest possible mate. Longer mates, missing/truncated nominations and quiet
attacking moves outside the nominated set remain coverage gaps. A standalone
FEN cannot supply the game's earlier repetition history. The production
verifier is not a general repetition-aware minimax solver.

## Independent verification and contrary evidence

An optional diagnostic exports the complete defence/answer tree; production
messages do not contain that tree. A separate chessops replay and the new
`scripts/benchmarks/verify-mating-strategy.py` independently check legal moves,
complete replies (including all promotions), positions, terminal mates and
the claimed distance. The Python checker uses python-chess, checks fifty-move
and within-tree repetition claims, and rejects missing defences, fabricated
terminal nodes, illegal answers and falsely shortened distances. Diagnostic
and ordinary production proof results are compared as well.

The final owner trees contain 259/109/45/102/80 defensive nodes and
120/69/22/57/38 mating leaves for the five certified choices. The course root
and its reflection each contain 2,169 defensive nodes and 1,248 mating leaves.
The eight positive public entries each contain 126 nodes/68 leaves; these
include colour reflections and duplicate Qh4 inputs, not eight real games.
Both rules libraries verify all these final trees.

There are **850 fresh engine searches** across the public, owner, course and
contrary checks, including repeated decisions and earlier diagnostic ordering.
All strategy-decision searches report a positive mate, but some finite-depth
mate distances disagree with the complete tree. In an owner Qf6+/Qh8+ branch,
Stockfish depth 16 reports seven while the respective certificates show five
and four; depth-22 follow-ups still report six and seven. Three course answers
also have longer engine distances than their certificates. These contrary
receipts remain intact. Full legal trees, not agreement with a finite-depth
engine distance, establish the reported upper bounds.

The first resume harness used non-unique diagnostic IDs and omitted one held
decision. IDs are now assigned after deduplication, and resumption matches
the actual FEN/held-move pair. The missing decision was searched separately
and supports mate in two. All 555 owner nominations are covered by the three
receipts; this is not 555 independent positions.

The public [16-search receipt](quiet-root-mate-stockfish-18.json) checks the
real root and constructed controls in both colours. Adding a knight able to
take the queen refutes both Qh4 and Qxh4 despite a cooperative mating PV.
Those held roots evaluate roughly -9.6 to -11 pawns, not mate. A quiet move at
halfmove 99 allows a draw claim; a capture resets the clock and preserves mate.
Initial pawn/bishop controls accidentally blocked the supplied moves and were
replaced with legal knight controls before certification.

## The nearby quiet-fork audit remains a gap

Eighteen additional fresh searches inspect owner **Nb5** and all sixteen legal
queen retreats. Nb5 attacks Qd6, but Qd6 already guards c7: simply pretending
Black passes does not establish Nxc7+, since Qxc7 answers it. Qd7, Qb6 and Qc6
retain that guard; fresh best play includes Qg5, Nxe5 and other preparations.
The tactical point is not a forced queen win or immediate checking fork merely
because one engine line later contains one. No speculative fork label was
added. Its quiet tempo/preparation, the separate earlier Nb5, and Bc4+ remain
recall targets, not correct-negative classifications.

## Reproduction and verification

Run the focused `quietRootMateRecall`, `quietMateConsistency`, `tacticalScanResult`
and `tacticalBuiltWorker` tests. The Python cross-check is opt-in with
`TACTICAL_MATE_STRATEGY_PYTHON=python`; it needs python-chess. Private audit and
resume inputs use the environment variables documented in those tests and
refuse to overwrite receipts. No paid/owner board or PGN is committed.

The final broad selection passes **2,436 tests**, with 191 optional skips; an
additional 18 focused checks include the opted-in owner assertions and Python
verification. Whole-project types,
scoped lint, 42-module shared review and 8,875-module frontend builds pass.
Ten built-service checks, including the real background engine, and two
development-cache recovery checks pass. The compiled controller passes 25
groups, including the recovered course root in both colours and twelve new
public/reflected controls.

All **420 owner scans** match source through the compiled controller. Across
**1,043 prior public inputs**, only three Qh4 full-line/reflected/engine headline
lists change from Mating Attack to Forcing Mate; IDs and source/best/response
lanes are compared together. Public computation/transfer median/p95/max is
**39/198/1,114 ms**, excluding engine, startup and native UI. All **169 cold HTTP
cases** pass: first/max startup **1,205/2,333 ms**, maximum computation 1,423 ms,
with server startup separately 1,865 ms. These do not resolve prior failures.

**132 actual React/browser-worker groups** pass: 24 new quiet/capturing-root
and contrary-control groups, plus 108 earlier quiet-mate groups, at
1100/760/360 px and 100/200% scale. They exercise keyboard previews,
root-only arrows, actual-ply mates and overflow. The older harness's stale
root-only Qh4 empty/arrow expectations were corrected to its already-supported
Mating Attack and concrete queen threat; no production suppression was added
to satisfy those expectations. Positive/negative narrow screenshots were
inspected. These are isolated browser checks, not native-window interaction.

The immutable worker is `liveTactics.worker-DHYTdyl-.js`, SHA-256
`a8a24cd1c1e7ba23b6c83611a2bb47736e2cc78879a3c40722165ea772d68a78`.
Private reports are under `Documents/OnCrescent Tactical Benchmarks/` with
`quiet-root-mate-*20260916.json`, `chesscom-*-adapter126-verified.json`, and
`adapter126-*-verified.json` names. Earlier failed/partial receipts remain.

Desktop packaging is separate, recorded in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
Source/worker/browser checks do not establish native-window behaviour or solve
historical load-sensitive startup failures. Broader recall, primary-theme
selection and a representative independently judged accuracy benchmark remain
open. Owner data and phone services are unchanged.

## Subsequent checking-pawn audit

Eighteen additional fresh searches inspect the next owner Bc4+/Nxe5+/Qxc7+
decision and all legal replies. Nxe5+ has only Ke6 (Qd5#) and Kg7, where a quiet
Nxc7 or a checking queen exchange preserves a strong engine evaluation but
still lacks a complete root pawn-retention explanation. Bc4+'s critical Kg7
branch instead needs a quiet queen move. Importantly, Qxc7+ is **already** a
Hanging Pawn alternative in the frozen live scan: checking only the principal
headline had hidden that distinction. No new capture recovery or missed
accusation is claimed; the played Nxc7 also captures a pawn. These findings
do not change adapter 126. Private initial/reviewed notes and the 18-search
receipt are `third-checking-pawn-*-20260916` under the private directory.
