# Quiet-clearance development boundary: 2qDuS and 3LtAI

These are two previously selected public **development** puzzles, not a new random sample or a frozen holdout. Their source labels remain nominations. Exact adapter175 (`9fad2cd685d88d10e962bd80384eb9aaf117072e`) emits no motifs for both root-only and source-line inputs in either colour: eight observations, **not eight accuracy failures or positional negatives**. No production admission was added for these cases.

## 2qDuS: connected idea, incomplete root certificate

`Ng5` clears Re1–e8 and interposes on the Qb5–Qh5 ray. There are **38 legal Black replies**. The existing bounded mating-attack kernel nominates Re8+ but does not close `...Bd4+`: its two attempts stop after 3,501 and 6,864 visits (reflection 3,502 and 6,863), rather than exhausting its 8,192-node envelope. A countercheck cannot be silently omitted.

The source continuation `Ng5 Qf5 Re8+ Bxe8 Qxe8+` is **not mate**. Its sole legal reply is `...Qf8`. A fresh, bounded engine nomination continues `Qe4`, combining Qxh7 mate with an attack on Ra8. At that reached Qe4 position, the existing all-reply local kernel certifies **170** across all **26** replies in **3,672 visits per colour**. However, the prior rook-for-bishop exchange has already cost **170**, so this certificate does **not** prove a positive root material bound. That is a proof limitation, not a claim that the actual position is equal or drawn. A prior source-game pawn capture would require its own correctly bound debt accounting as well.

The most useful further direction is bounded composition of the connected mating threat and its actual later capture/recovery, preserving the original sacrifice debit and every countercheck. The new quiet setup cannot borrow an unrelated capture, and its local 170 cannot be promoted to a root 170. No budget or proof gate was relaxed. The idea is unresolved, not rejected as positional.

## 3LtAI: unpinning and castling, not a free queen

`O-O` unpins Ne5 and makes Re1 available; there are **30 legal Black replies**. In the supplied `O-O Qxe5 Re1` line, Black can legally continue `...Qxe1+ Qxe1+`. The ledger is queen900 minus knight320 minus rook500 = **80**, with **four** Black check evasions still legal. Calling this a full queen gain would ignore two real sacrifices.

The bounded engine's preferred defence instead starts `...Qf6 Re1 Be7 Ng4`, with no immediate material payoff in the returned prefix. Neither that search nor the source label establishes an all-reply root tactical mechanism. This case remains unresolved; it is not an ordinary-castling negative and its empty output must not become a gold expectation.

## Evidence and limits

- `quiet-clearance-boundary.test.ts` has **8 passing** legal/ledger and observation contracts, both colours. Its exact-revision loader reuses `rare-mechanism-precision-v1.vitest.ts`; it does not copy a checkout or data. `quiet-clearance-boundary-adapter175.json` retains the actual outputs, full legal reply inventories, and the reached Qe4 certificate. Report writes refuse overwrite.
- `quiet-clearance-legal-audit.py` independently replays **8 legal/ledger witnesses** with python-chess. The corresponding JSON verifies the 38/30 reply counts, real Qf8 defence, and 80-point conditional exchange. It does **not** independently certify the Qe4 strategy or either root strategy.
- `quiet-clearance-engine175.json` retains exactly **three** approved queries: both roots and the reached `...Bd4+` position. Stockfish18, executable SHA256 recorded, one thread,64MiB hash, depth16 with10-second cap per query, MultiPV3. Actual elapsed0.672seconds. Scores209/377/388centipawns are nomination/corroboration only, not mechanism labels or proof.

Reproduce the source observations with:

```powershell
$env:QUIET_CLEARANCE_BOUNDARY_REPORT = '<new receipt path>'
node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/quiet-clearance-boundary.vitest.ts --maxWorkers=2 --cache=false --update=none
```

No engine is run by that command. Leave the default pinned revision unchanged to reproduce adapter175. Future qualification requires complete bounded connected strategies and adversarial controls, not an expectation that these eight observations must turn nonempty.
