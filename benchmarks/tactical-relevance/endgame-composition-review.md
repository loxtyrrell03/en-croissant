# Bounded pawn ending composition feasibility

The benchmark prototype reconstructs the previously adjudicated DVs4F zugzwang from its starting position, candidate move and 13 retained exact Syzygy records. It does not read the stored solution line or fortress strategy. It also handles an independent KPK example in both colours using the existing local solver alone. This establishes a small, general composition mechanism as feasible **given sufficient trusted exact leaves**; it does not establish an automatic endgame solver or improved runtime accuracy.

DVs4F remains unsupported by the live classifier at its eight-piece root. No production code, runtime schema, provider limit or service was changed. The provider still accepts at most seven pieces. There were no new provider requests, downloads or owner-data reads.

## Certificate and proof obligations

The benchmark schema binds an exact root FEN and UCI move to two graphs. Nodes contain a FEN, legal UCI edges and optional references to separately supplied exact leaves. A leaf is independently checked terminal geometry, an existing local KPK result, or a specified record with an explicit colour and rank reflection. Fullmove numbers are irrelevant only to exact leaf outcome lookup; side to move, board, rights, en passant and the halfmove clock remain binding.

The actual-position graph proves a finite win: the beneficiary selects one legal move, and every legal opposing reply must succeed. The checker rejects cycles, missing replies, illegal moves, unreachable nodes and draw claims. Actual edges preserve full FEN identity and clocks. A position already automatically drawn cannot be revived by a later resetting pawn move.

The pass graph proves only nonloss for the other side. Passing changes the side to move of the actual position without playing a legal move or advancing the clock. Every opposing reply is covered; the defending strategy selects one move. Nonterminal exact leaves may be entered only after a capture or pawn move resets the clock. Quiet edges cannot borrow a clock-zero leaf, even where the same board has a drawing KPK result.

The remaining closed graph contains kings and pawns. Captures decrease pawn count; other pawn moves decrease total distance to promotion. Promotions cannot enter another graph state. Thus a cycle can contain only quiet moves, while irreversible progress is finite. A closed legal strategy either reaches a validated nonloss leaf or eventually draws through repetition or the move-count rule. Cyclic evidence never establishes a win. The verifier recomputes legality and graph coverage; it does not trust the generator's safe-state labels.

## Bounds and observed results

Generation is capped at 16,384 visited positions, 200,000 charged operations and a four-ply actual-win search. Each certificate graph is limited to 1,024 nodes, each node to 32 edges, and the registry to 32 records. Verification is capped at 8,192 charged operations. Caller overrides can only reduce limits. Exhaustion, missing evidence or an unsupported branch returns unknown.

The frozen DVs4F run visited 10,431 positions and charged 180,795 operations. Its certificate retained 12 actual nodes and 248 pass nodes, occupying 28,175 bytes in compact JSON. Generation took about 1.61 seconds and independent verification about 9.12 milliseconds, charging 2,081 operations. These are single-machine observations, not latency percentiles. Charged operations are algorithm work units, not every instruction; parsing and initial construction of the existing fixed KPK solver have separate costs. Generation does not belong in a synchronous per-move scanner.

All 52 prototype contracts passed, including both colours, source clocks 97 and 98, contrary Ka7 and Kb7, independent KPK positives, and a KPK position winning with either side to move. Tamper controls cover omitted or forged records, reflection, changed clocks, quiet leaf entry, graph limits, malformed edges, illegal cycles and fake terminals. The retained independent DVs4F proof also remains 9/9. Focused TypeScript and lint checks pass. Exact counts, source hashes and test names are in [the receipt](endgame-composition-verification.json).

## Boundaries before any runtime integration

The 13 leaves were selected during the earlier independent adjudication. This prototype discovers a strategy from those leaves; it does not discover or fetch a sufficient registry automatically. Incompleteness is intentional: an unrecognised capture, promotion, larger frontier or exhausted bound may prevent a certificate for a genuine zugzwang.

Record validation checks identity, legal replies, terminal facts and minimax consistency. It does not authenticate a provider or reconstruct Syzygy. A coherently forged registry remains outside this trust boundary. Future integration must keep registry acquisition separate and bind the certificate to an immutable trusted evidence identity.

FEN also omits prior repetition history. The finite winning tree rules out a newly created cycle, but not an existing claim inherited from the game. Before granting any live proof credit, history-aware validation must cover the actual tree and exact-leaf contract; missing history cannot silently mean no repetition. The checkmate-at-clock-150 control tests the existing exact-record validator, not a new composer ability to explain a terminal root.

A possible later integration is explicit, cancellable preparation off the main thread, followed by bounded verification against the exact position, game history, schema and evidence versions. Invalid or stale certificates must produce no motif. This requires a separate reviewed change; this milestone deliberately leaves runtime behaviour unchanged.

## Reproduction

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/endgame-composition.vitest.ts` for the prototype contracts. Optional `ENDGAME_COMPOSITION_REPORT` and `ENDGAME_COMPOSITION_CERTIFICATE` destinations write fresh files exclusively and never overwrite previous evidence. The existing `dvs4f-zugzwang.vitest.ts` config runs the separate nine-contract adjudication proof.
