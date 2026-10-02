# DVs4F zugzwang proof and runtime boundary

The public development position DVs4F is a genuine root zugzwang after **...Kb6**: Black wins against every legal White reply, while White could avoid losing if allowed to pass. This is an independently checked composition of exact small endings and a closed defensive strategy, not a conclusion from the source puzzle tag or an engine score. The app still abstains because its existing exact root probes support KPK or at most seven pieces; this root has eight. No production limits or classifier code were changed for this adjudication.

The source is [public game fu4ZkxrA](https://lichess.org/fu4ZkxrA#99), also presented as [puzzle DVs4F](https://lichess.org/training/DVs4F). Starting FEN: `8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 1 50`. The supplied legal line is `a6b6 a4b5 b6b5`; the proof also covers all alternatives, not just this line.

## Actual position

After ...Kb6 the FEN is `8/8/1k1p4/pp1P4/P2K4/1P6/8/8 w - - 2 51`. These are all six legal White moves. Every row reaches an exact Black win in the retained Lichess Syzygy record; categories are always from the side to move.

| White reply | Black continuation if needed | Exact leaf category | DTZ |
| --- | --- | --- | --- |
| Ke4 | ...bxa4 | White loss | -2 |
| Ke3 | ...bxa4 | White loss | -2 |
| Kd3 | ...bxa4 | White loss | -2 |
| Kc3 | ...bxa4 | White loss | -2 |
| axb5 | Already a seven-piece leaf | Black win | 1 |
| b4 | ...axb4 | White loss | -2 |

All leaves have draw clock zero. DTZ is the provider's signed distance to the next zeroing move, not a mate distance or evaluation in pawns. Complete provider reply lists, exact FENs and request URLs are retained. Original ...Ka7 and ...Kb7 are contrary controls: White axb5 reaches an exact draw, so neither can inherit this winning proof.

## Hypothetical pass position

Change only the side to move after ...Kb6: `8/8/1k1p4/pp1P4/P2K4/1P6/8/8 b - - 2 51`. Passing is **not a legal move**; this board is a labelled counterfactual used to test whether the obligation to move causes the loss.

All six Black choices are covered by a White nonlosing strategy:

- ...Kc7, ...Kb7 or ...Ka7: axb5 reaches an exact draw.
- ...bxa4: bxa4 reaches an exact Black loss.
- ...b4: White enters the verified locked-pawn fortress.
- ...Ka6: Kc3. Black then has exactly five legal moves. ...Kb7/...Ka7 allow axb5 with an exact draw; ...bxa4 allows bxa4 with an exact Black loss; ...b4+ reaches the second fortress entry; ...Kb6 Kd4 returns to the original pass board and turn after four quiet plies.

The fortress fixes White pawns on a4, b3, d5 and Black pawns on a5, b4, d6. A conservative python-chess safety search generated a strategy in which White chooses a legal noncapturing king move and **every** legal Black move remains a noncapturing king move inside the strategy. An independent chessops checker verifies both entry boards and all edges of the retained 230-node graph, including every Black reply. No pawn moves, captures or losing terminal positions occur. Continuing within this finite graph must repeat positions and advances the quiet-move clock, so White can obtain a draw. This proves pass **nonloss**, which is sufficient for zugzwang; it does not claim an independently solved exact eight-piece draw value.

## Draw clocks and scope

With original halfmove clock 97, ...Kb6 reaches 98. A White king move reaches 99 and the chosen Black capture resets the clock before White has a claim. With original clock 98, ...Kb6 reaches 99 and White can announce a legal king move completing 100 halfmoves; Black's later resetting capture cannot revoke that claim. Clock 99 already permits a current claim after ...Kb6. Both colours and these boundaries are checked. As with other FEN-only proofs, prior repetition history is not supplied.

The 13 public API calls were only for six- or seven-piece capture leaves, with no tablebase downloads, private games or full corpus. All 13 records pass the production exact-FEN and complete-legal-reply validator. Reflected proofs are checked through colour/rank symmetry, not misrepresented as additional provider queries. Bounded Stockfish searches helped nominate branches but are not part of the proof or its retained truth labels.

## Evidence and replay

`dvs4f-zugzwang-evidence.json` uses schema version 1: root/source identity; 13 raw provider records with exact FEN, URL, timestamp and response; legal move inventories; the closed fortress graph and entry nodes; and the initial independent check details. Fortress nodes store board, turn, castling and en-passant state without clocks. The checker verifies legal quiet transitions; increasing clocks and repetition justify nonloss, never a winning cycle.

Run from the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/dvs4f-zugzwang.vitest.ts
```

The retained checker passes **9 of 9 tests**, with no failures or skips. `dvs4f-zugzwang-verification.json` records exact test names and evidence/checker hashes. Root-only and full-line runtime calls still return no root tactic in both colours; this is an explicit coverage gap, not a positional negative. The repeatable check is local and makes no network calls.

## Minimal safe implementation direction

Do not raise the provider's seven-piece limit or convert engine scores into zugzwang. A separate bounded composition verifier could accept exact root identity, all opponent branches, chosen replies, validated existing tablebase/KPK leaves, and a closed nonloss strategy. Winning branches must terminate in exact wins; a cycle cannot prove a win. Nonloss cycles need complete opposing-move coverage, legal position identity and explicit draw-rule handling. Missing branches, illegal moves, altered FENs, insufficient budgets and claimable draws must make the result unknown. Preparing such certificates and integrating them into normal review remain future work; this small benchmark does not authorize automatic provider requests or a generic eight-piece solver.
