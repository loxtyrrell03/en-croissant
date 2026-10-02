# Material proof draw claim boundary

An independent audit of the public sGGZN deflection found an existing shared material-proof loophole: a defender's legal fifty-move draw claim did not prevent a claimed skewer or deflection gain. The unchanged 28-contract regression improves from **12 passing before to 28 passing after** the shared-kernel correction. These are deliberately selected boundary contracts, not a population accuracy estimate.

## Reproduction and precise rule

Use `3R4/4r2k/N4ppq/1B3b2/5pP1/7Q/PPr4P/6K1 w - - 98 34`, with root `d8h8` or the legal full line `d8h8 h7h8 h3h6`. After Rh8+ there are exactly two legal replies: Kg7 and Kxh8. At clock 99, Black can announce Kg7 as the 100th quiet halfmove and claim a draw. The alternative Kxh8 resets the clock but cannot revoke that earlier choice. Nevertheless, the old root-only result certified skewer 400; the full line added deflection 400. Original clocks 99 and 100 also incorrectly retained these labels despite a current claim.

The correction reuses the existing legal-claim helper at the shared material-proof root. It therefore closes both the accepted-deflection fallback and the skewer path, instead of fixing only one visible badge. The recursive mate-answer search also refuses a nonterminal checking continuation when the defender can claim. Immediate checkmate is tested first and still takes precedence.

## Opposite controls and limits

Original clock 97 remains positive in both colours and both root-only/full inputs. Replacing Black Bf5 with White Nf5 makes Kg7 illegal: when the defender's clock is 99, the sole Kxh8 reply resets it and the genuine skewer remains. At defender clock 100, even that board allows a current claim. Immediate mate at halfmove 150 remains mate, using the already established public synthetic control.

All 28 contracts verify legal prefixes; both root motifs and root timeline motifs are checked. The suite was frozen before the core change. Its SHA-256 is `abf7e27ce9709b328982812d93a1cc91dde27e08ff716be92c703698daacfe0c`. The paired JSON receipts retain identical case IDs, FENs, lines and expectations, with normalized core hashes and classifier versions. The optional output uses `TACTICAL_MATERIAL_CLAIM_REPORT` and refuses to overwrite an existing receipt.

The recursive descendant claim gate was reviewed, but this new suite does not isolate a failing-before descendant-only mate fixture. Existing public mate-backed fork witnesses reset their clocks through captures, so they cannot honestly provide that negative simply by changing the starting clock. Keep that isolated regression gap explicit; do not count it among the 16 repaired failures.

The related deflection outcome/payoff audit found no new all-reply or material-accounting error: a fully mating deflection stays supporting context without a duplicated material value, and exact accepted-guard payoff history retains the sacrificed rook's cost. Six focused public suites passed 80 tests with four existing conditional skips before this final claim correction; broader final verification is recorded by the milestone owner. No owner data, installed app or phone runtime was touched by this audit.

## Repeatable checks

```sh
node node_modules/vitest/vitest.mjs run src/utils/tests/materialThreatDrawClaim.test.ts
```

The retained `material-threat-draw-claim-before.json` and `material-threat-draw-claim-after.json` contain the exact paired results. The new test passes targeted lint with zero warnings or errors. No private corpus, network request or engine search is needed to replay it.
