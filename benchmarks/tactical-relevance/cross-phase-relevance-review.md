# Cross-phase relevance and promotion clearance — adapter 95 / live 100

## Sample and independent evidence

The [frozen development sample](cross-phase-development.json) contains twelve previously unused CC0 Lichess puzzle roots: two each from quiet moves, clearance, deflection, pawn endings, rook endings and openings. Selection uses fixed SHA order, source motifs and disjoint game identities, never classifier output. The original eighteen-position secondary profile is unchanged and reproduces its earlier selection with frozen exclusions. No holdout positions were used.

The [game-context sample](cross-phase-game-context.json) adds eleven boards at fixed plies 8, 24, 48 and 80 of the first three selected source games. One ply-80 board is omitted because the game ended earlier. Full legal move sequences verify both the nominated puzzle and each context position. Player headers, comments and clocks are omitted. These are contexts of puzzle-selected games, **not a representative sample of ordinary games**. Public game exports use the [Lichess API](https://lichess.org/api); exact export URLs and body hashes are retained.

[Provisional chess judgements](cross-phase-initial-judgement.json) were recorded before engine/classifier output. Source tags nominate ideas, not correct primary labels. The [engine receipt](cross-phase-stockfish-18.json) preserves the initial adapter-94 outputs and **104 completed depth-16 Stockfish 18 searches**: 26 initial searches for 23 boards, 34 root-defence/pass searches, and 44 final selected-witness/root/control searches. These are not 104 independent puzzles. Its exporter validates known inputs, previous-move identities, complete legal PVs and regenerated proof requests before exporting allowlisted public fields. Paid material stays private.

## A quiet pawn move that prepares a real combination

In [brn5j's source game](https://lichess.org/h5yHhpzr/black#120), **c7** threatens promotion and clears c6 for the rook's sixth-rank check. Black's principal resource **Rc2** prevents immediate queening, but then **Rh6+ Kg4 Ne3+** forks the king and rook. The important first-move lesson is the cleared route combined with the promotion threat, not a fork already on the board.

The independent verifier does not read a future PV to nominate the payoff. It covers all **20 legal root replies**. Nineteen permit a safe promotion of the same pawn; Rc2 requires the newly opened checking route. Rh6+ has one legal reply, and Ne3+ has four. After Kg5 Nxc2, all thirteen Black replies are covered by an actual promotion, including the compensation **Kxh6 c8=Q**. The selected tree has **38 White continuation witnesses**, uses **488 of 4,096 shared operations**, and has a minimum local material bound of **500 cp**. The bound includes captures, promotions and immediate liabilities of all friendly pieces; it is not five extra pawns on top of the later fork or promotion.

All 38 chosen continuation witnesses were separately fixed-move searched. Eleven produce positive mate estimates; the minimum finite White estimate is **+617 cp**. The final root search gives **+691 cp**, versus **-14 cp** for the legal missed move Rb8. These full-position finite-search estimates are not the classifier's 500-cp material calculation, nor a guarantee that every selected witness is globally best. For example, the selected safe promotion after Nc6 wins, although the engine prefers Rxc6.

The default board now shows one **Promotion Clearance** label on c6, the move c6–c7, and the rook's b6–c6 cleared route. It does not draw the future Rh6+, Ne3+ fork or promotion. Missed-opportunity review retains this root lesson. Unsupported opponent causal comparisons remain neutral: a legal comparison move is not automatically a certified best defence or proof that the mistake created the tactic.

For the full verified continuation, the actual-ply explanation is:

| Ply | Move | Explanation |
| --- | --- | --- |
| 1 | c7 | Promotion Clearance: the root mechanism |
| 5 | Ne3+ | Fork, with the connected compensated bound capped at 500 cp |
| 7 | Nxc2 | Fork Payoff, not another independent free-rook gain |
| 8 | Kxh6 | Countercapture: real compensation, not a separate winning tactic for Black |
| 9 | c8=Q | Promotion on the move where it actually occurs |

The first integrated candidate misleadingly added a small pawn skewer at Rh6+, an 800-cp fork and free-piece labels on both captures. The final normalization suppresses only that smaller, unused pawn-skewer payoff on the matched proof path, caps the fork's value and distinguishes payoff from compensation. A short supplied line may retain a smaller independently established secondary bound; it does not invent missing continuation moves. Alternative attacking moves stop the connected episode, and their independently verified motifs are not globally erased. The first-move label and bound survive root-only and truncated input, colour/file reflections and missed-opportunity review.

### Contrary positions and bounds

The four constructed controls alter real resources, not expected labels alone:

- Removing the cleared rook makes c7 lose; the fixed search finds mate in four for Black.
- Removing the forking knight exposes the immediate legal reply **Ra1#**.
- Adding a second black rook on a8 defeats the promotion-clearance claim; the fixed search finds mate in five for Black.
- Adding a black pawn on d2 changes the combination: Rc2 Rh6+ Kg4 now requires Nxd2, not the advertised fork. The c7 search is **-20 cp** for White, not an exact draw certificate and not proof that an immediate black promotion is compulsory.

The new certificate is withheld in all four controls. Invalid and exhausted budgets cannot reuse a successful default-budget cache entry. Every root defence and recursive reply shares the existing 4,096-operation bound; only the opened checking route, capture of the actual promotion guard, and promotion of the same pawn can justify this mechanism. Unrelated future captures and arbitrary improving moves cannot fund it. Runtime deadlines are unchanged.

## Judgements across the other fresh positions

The following records both correct priorities and outstanding gaps. Empty outputs in promising positions are **not** counted as correct negatives.

| Puzzle | Chess judgement and current result |
| --- | --- |
| 9cqKR | Bh7 is a strong quiet h-file attack (+381 cp, with the other two initial candidates drawing). The root mechanism remains unproved; no claimed accuracy gain. |
| hGEvH | Rxg2+ prepares Rg5 and the later Bg2+/Re5 pin. Both root king replies were searched: Kf1 retains a winning attack, Kh1 permits Qxh2#. The quiet preparation remains missing; a future pin must not become a starting-board pin. |
| kO37k | Qxf7+ Rxf7 Rd8+ Rf8 Rxf8# is mate in three. Forcing Mate correctly leads, with sacrifice/clearance support rather than a pawn-gain headline. |
| 49h84 | R1e6+ Kg5 Rxg7# is mate in two. Mate correctly leads and mating deflection is secondary. Kg5's self-interference is still missing; the existing guard test does not cover this check-evasion geometry. |
| qY3NM | Qxf6+ Rxf6 Rxe8+ Rf8 Rxf8# is mate in three. Mate leads, but the queen sacrifice's rook-deflection explanation remains incomplete; the old acceptance check expects a shorter mating payoff. |
| W2tIf | d5 is a pawn breakthrough, with e6 after exd5 and b5 after cxd5. Both the actual reply position and a hypothetical pass remain winning for White (+667 and +795 cp respectively). Calling it zugzwang would be wrong. The multi-plan breakthrough remains unproved. |
| EKWHC | Kf4 creates genuine six-piece zugzwang, independently confirmed below. The production classifier still lacks this larger-ending proof. |
| KRLot | Rf1# correctly leads with Back Rank Mate, not a generic rook-ending/material label. |
| SIVEv | Rd3 offers a favourable rook exchange into a pawn race. All eight root replies were independently searched, retaining White estimates of at least +447 cp. The prepared winning pawn ending remains unproved; its later promotion is not the root theme. |
| 30PgS | Bxh4# correctly leads with Double Bishop Mate instead of the incidental capturable knight. |
| I5Waq | Bxf7+ Ke7 Nd5# correctly leads with mate in two; Weak f7 supports the mechanism, not a competing pawn-gain or fork headline. |

The eleven fixed game-context outputs remain empty. Four explicit noise controls cover the three opening boards and a compensated recapture. The others remain provisional, not certified quiet positions:

| Game / ply | Final assessment |
| --- | --- |
| etolcQHz / 8 | Normal opening development and exchanges; Bg5's relative pin does not by itself establish material gain. Best initial estimate +32 cp. |
| etolcQHz / 24 | Ne4 or Qc2 builds pressure. Later sacrifices cannot be borrowed as the root cause; best initial estimate +146 cp. |
| etolcQHz / 48 | White is worse (-372 cp) despite checking and h-file resources. This is an unresolved forcing/defensive context, not a certified tactical absence. |
| etolcQHz / 80 | The engine's three displayed White choices all allow Qf2#. Black's mating mechanism is not White's own tactic, and this does not independently prove that every legal White move loses identically. |
| MHuRInPi / 8 | Declined Evans-gambit development. Later exchanges/forks in the played game are not evidence of a root combination; +39 cp. |
| MHuRInPi / 24 | Bg5's relative pin and structural pressure are strong (+247 cp). No independent forced-material proof is supplied; the empty output is not certified correct. |
| MHuRInPi / 48 | Ke2 escapes the king attack (+187 cp). A later black rook pin is not a White root tactic. |
| xwAZeVkB / 8 | Ordinary opening exchanges/development, including Bxf6; +53 cp. No root material combination is established by the supplied line. |
| xwAZeVkB / 24 | Rxc3 recaptures the bishop which just took a knight; +31 cp. Preserving previous-move context prevents a false hanging-bishop lesson. |
| xwAZeVkB / 48 | Approximately balanced heavy-piece activity (-37 cp). Back-rank geometry alone is insufficient for a tactical headline. |
| xwAZeVkB / 80 | Qf5+ followed by Rg6 is stronger (+204 cp) than the source's equal rook exchange. The potential root attack remains unproved, not a successful negative. |

### A real zugzwang that is still a coverage gap

The [six-piece Syzygy receipt](cross-phase-tablebase-verified.json) contains four successful queries and all **25 legal move records**, with query URLs and timestamps. Its categories are side-to-move outcomes; move categories belong to the resulting child position. At the EKWHC root, Kf4 is the only winning move and Kf3 draws. After Kf4, Black loses with all five legal replies; if Black could pass, the identical board with White to move draws. This is genuine outcome-changing zugzwang, not just opposition terminology or a high engine score. The independent after-Kf3 query also draws.

This is benchmark evidence, not a new runtime network dependency or general endgame implementation. Existing exact KPK coverage remains; this six-piece example stays explicitly unresolved. See the [public tablebase service](https://tablebase.lichess.ovh/) for the source; the receipt retains exact position-specific query links.

## Verification and delivery

- **1,748 selected source/review/render tests** pass, with 95 conditional skips (114 files, 112 passing). The 34 new ordinary tests include the proof, cross-phase comparisons and one rendered actual-ply explanation. A final focused rerun also passes 68 tests; conditional engine/export runs are separate.
- **867 actual-controller production-worker inputs** pass across fourteen tests. The [362-input public receipt](built-worker-adapter95.json) measures median/p95/max **78/209/639 ms**, maximum startup 34 ms and maximum classification/transfer 609 ms, excluding engine search and native UI. The common 310-input subset measures 83/217/639 ms; no speedup claim. All 310 earlier primary-ID lists are unchanged.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, sixteen-file targeted lint, three built-service tests and two development-cache/recovery scenarios pass. Artifact: `liveTactics.worker-Ccvd8f6k.js`.
- **Eighteen isolated cold HTTP cases** pass. First/next startup is **1,532/67 ms**, with KPK startup reaching 2,140 ms. New promotion-clearance startup/classification is 61/80 ms; the second-guard control 64/10 ms, and the compensated opening recapture 62/94 ms. Earlier multi-second startup variability remains contrary evidence, not a certified latency fix.

All **246 exact private course/generated-game source/live results**, all **20 earlier rare full results**, and all **32 frozen primary-priority judgements** are unchanged, ignoring classifier version fields where applicable. Among the 23 new inputs, only brn5j's source/live explanation changes; the other 22 full results are unchanged. The [final cross-phase replay](cross-phase-adapter95-review.json) preserves their complete outputs. Stability is not accuracy.

Private evidence is retained in the owner's benchmark directory: `adapter95-cross-phase-initial-engine.json`, `adapter95-cross-phase-defence-engine.json`, `adapter95-promotion-clearance-engine.json`, `adapter95-final-promotion-clearance.json`, `adapter95-candidate-exact-replay.json`, `rare-theme-adapter95-candidate.json` and `adapter95-cold-http-worker.json`. The initial `adapter95-promotion-clearance-timeline.json` remains contrary evidence of the misleading pre-normalization labels. Final proof/request identity matches all 44 witness/root/control searches exactly. No paid inputs or private paths are exported into the public evidence receipts.

No owner app/package/service was restarted or deployed; no native WebView or physical interaction verification is claimed. This milestone restores one independently proved quiet combination and removes its continuation noise. Five newly sampled puzzle roots, secondary self-interference/deflection details, broader prepared endgames, positional counterplay and causal comparisons remain open. It does **not** establish an always-correct primary classifier.
