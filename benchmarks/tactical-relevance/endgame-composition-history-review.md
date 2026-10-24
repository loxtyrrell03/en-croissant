# Repetition history in endgame composition proofs

The benchmark-only history layer closes a specific gap in the earlier composition prototype: a winning board evaluation does not necessarily remain a win after the moves already played. All 25 new contracts pass, and the original 52 composition contracts remain unchanged and passing. This is proof-boundary testing, not runtime accuracy credit. DVs4F remains unsupported at the live eight-piece root; the production provider limit and schemas are unchanged.

## Independently reproduced counterexamples

The tests use synthetic legal histories around the public [DVs4F position](https://lichess.org/training/DVs4F), not claims about the history of its [source game](https://lichess.org/fu4ZkxrA#99). They reuse the 13 already retained records in [the original evidence](dvs4f-zugzwang-evidence.json), with no new provider requests. Separate three-piece tests use the existing local KPK solver only.

Two different eight-ply histories reach exactly `8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 8 54`. Repeating `Ka7 Ke4 Ka6 Kd4` twice gives Black an optional claim; Black may decline it and play the winning `Kb6`. Repeating `Kb6 Kc3 Ka6 Kd4` twice instead lets White claim immediately after `Kb6`. The original position-only certificate accepts both; the history layer accepts the former and refutes the latter. Both colour reflections pass these contracts.

A third history gives White an announced `Kc3` threefold claim after `Kb6`, even though the current position has appeared only twice. A capture at the end of the proposed variation cannot erase that earlier option. Fivefold ends the game before a new root move, including when the proposed continuation would reset the clock with a pawn move. The verifier preserves optional claims for the attacking side. These distinctions follow Articles 9.2 and 9.6 of the [FIDE Laws](https://handbook.fide.com/chapter/E012023).

The deeper KPK contrast is not merely a root gate. From `8/8/8/4k3/8/4K3/5P2/8 b - - 0 69`, the legal prefix `Ke5-d5 Ke3-d3 Kd5-e5 Kd3-e3 Ke5-f5` reaches the candidate `Ke3-f3`. There is no current or announced claim at that root. An otherwise valid all-reply winning tree selects `...Ke5 Ke3` on one branch, however, restoring a third occurrence. The history layer rejects that descendant before accepting its exact KPK leaf. This refutes that certificate, not every possible strategy for the root move.

## Supported subset and binding

The caller supplies history separately as `{fen, moves}`. Legal replay must reach all six root FEN fields exactly. A second certificate envelope binds that history and the bounded validated registry semantics with SHA256; a different legal route to the same FEN cannot borrow the binding. This detects substitution, not authenticity. The caller must still provide trustworthy history and provider provenance.

A clock-zero origin establishes a fresh reversible segment under the trusted FEN contract. A later replayed pawn move or capture also clears earlier possible repetitions. A nonzero partial origin can prove an observed claim, but cannot prove that no earlier claim exists. Repetition identity uses side to move, pieces, castling rights and legally available en passant; clocks and fullmove numbers are excluded.

Every actual-tree branch carries its own occurrence counts. Current and announced claims are checked on every defending turn, with automatic draws checked for either side. Winning exact leaves are accepted only at a verified fresh pawn/capture reset, or as independently checked terminal facts. DVs4F's capture leaves therefore remain usable with complete history, provided no earlier claim interrupts the proof. The pass graph proves only nonloss: extra historical draw resources cannot turn nonloss into a loss.

## What remains unproved

A KPK or Syzygy win at an inherited-history leaf remains unknown even when the immediate position offers no claim. A later position in the oracle's winning continuation may already have appeared twice. FEN, WDL and a distance number alone do not verify all those history-sensitive choices.

Generalizing that case requires a bounded continuation certificate: every opposing reply must be covered and each selected winning move must avoid historical claims until a fresh irreversible leaf or mate is reached. The local KPK promotion ranks could guide such a generator, but that extension is not implemented here. Missing history, unavailable leaves and exhausted budgets remain unknown, never an accuracy success or a positional classification.

History replay is capped at 512 plies. The combined base verification, registry binding and history traversal share an 8,192-operation ceiling; existing graph and record limits remain. The fresh DVs4F check charges 2,277 operations. Inputs with illegal moves, altered bindings, continued play after automatic game end or unsupported limits receive no proof credit. Focused type checking and lint pass.

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/endgame-composition-history.vitest.ts`. The [retained receipt](endgame-composition-history-verification.json) contains source hashes, exact paired histories, outcomes and all 25 contract names. No production import, runtime change, owner-data read or new download was made by this benchmark work.
