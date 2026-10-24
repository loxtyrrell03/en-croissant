# Quiet intermediate capture audit

The retained public Ltbye position has a real move-order mechanism: Bxe6 removes the bishop that could otherwise answer Qxc1 with ...Bxd5. A bounded material proof supports investigating a quiet intermediate-capture rule. The current classifier still abstains, and this benchmark does not change admission or claim an accuracy improvement.

## Position and evidence

The frozen input is in `rare-causal-cohort-v2-inputs.json`. After ...Bxc1 captured White's rook, the root is `r1r3k1/4pp1p/p1p1b1p1/qp1BP3/3P4/2P2N1P/P1Q2PPB/2b1K2R w K - 0 20`. The source line is `d5e6 f7e6 c2c1`, or Bxe6 fxe6 Qxc1. This audit uses only the retained public fixture, its colour reflection and small synthetic controls. It makes no new network or engine requests.

Bxe6 is not check. There are exactly 31 legal Black replies, including Bd2+ and Qxc3+. The unchanged shared material kernel certifies a local lower bound of 230 for the forward order and a recovery of 330 after the reversed Qxc1 Bxd5. Both searches share a fixed 16,384-node allowance and use 2,647 visits: 1,548 forward and 1,099 reversed. Each certificate covers all 31 first replies in its respective position. Both colours give identical counts and bounds.

The separate chessops checker verifies exact reply-set equality, every selected path and its material balance, and legality of recorded recovery moves. It additionally enumerates all 861 next legal defences across the forward answers and all 873 across the reversed answers. The forward finite frontier remains at least 230. Some reversed-frontier pawn captures temporarily reduce the balance to 230; each has a legal immediate material repair. These are independent finite legality and material checks, not an independent complete strategic proof. The shared kernel still supplies its bounded exchange and countercheck judgments; neither layer establishes the game's eventual result.

## Material accounting and contrary lines

Values use pawn 100, knight 320, bishop 330, rook 500 and queen 900, not engine evaluation. The source Bxe6 fxe6 Qxc1 sequence gains 330 from the current root, but ...Qxa2 reduces the guaranteed local amount to 230. Immediate Qxc1 permits ...Bxd5, leaving zero net material from that root. The resulting move-order improvement is at least 230 within the bounded proof. Including the preceding rook loss of 500 gives -270 versus at most -500 from before ...Bxc1; this is improved recovery, not a new free-material windfall.

Qxc1 is not the right answer to every defence. Bxe6 Qa3 Qxc1 Qxc1+ is legal and loses 240 from the root. After Bxe6 Bd2+, Qxc1 is illegal because it leaves the king in check; Nxd2 is legal. These controls prevent treating the cooperative source line as an all-reply proof.

Removing Rc8 retains the 230 proof in both colours. The rook is therefore not a necessary causal target: when Black declines to recapture, retaining the bishop already taken on e6 can also preserve the material benefit. Removing Bc1 or Be6 makes this particular bound fail within budget; these are local proof contrasts, not global negative tactical labels. The added off-square queen liability exhausts the budget and remains **unknown**, not a proven losing move. Budgets of 0, 1 and 20 all abstain.

## Current admission and next safe boundary

Exact commit `80155c616cf2dd0d45cb764c060d7e60b7df5ede` loads adapter 172 through the read-only module loader. The separate current-source receipt records adapter 173. Both return no root-only or full-line motifs in either colour, and `intermediateCaptureProof` returns null. Each receipt preserves the core and adapter source hashes and verifies they remain unchanged during its run.

Both existing intermediate-capture admission paths require a checking root. The preventive fallback also requires a deferred rook or queen, excluding Bc1. A future general rule would need a separate quiet, near-equal capture path that binds the deferred capture and the opponent's concrete reversed-order recovery, proves both orders under one budget, and allows safe retention of material when the opponent declines. It must retain countercheck, off-square liability, draw/history, prior-debt and duplicate-payoff safeguards. Merely removing the check gate or adding Rc8 as a required target would be unsound reasoning.

The supported explanatory candidate is an intermediate capture preserving material through move order, not a forced pin: ...fxe6 legally captures the supposed pinner. General causal admission and competition with other primary explanations remain unimplemented. The earlier frozen depth-16 engine results corroborate the ordering but are not used as proof here.

## Reproduction and scope

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/tactical-relevance/ltbye-intermediate-audit.vitest.ts` from the repository. `RARE_CAUSAL_COHORT_V2_REF` selects the exact baseline commit; omit it for current source. Optional `LTBYE_AUDIT_REPORT` must name a new file, because receipts refuse overwrites. The standalone `.mjs` prints the legal root enumeration without classifying it.

Eight tests pass against each source checkpoint, including both-colour contracts and controls. Targeted types, lint and formatting pass. This is one already reviewed development puzzle, not a new cohort, a holdout result or a population accuracy estimate. No production source, runtime, owner data or Git state was changed by this audit.
