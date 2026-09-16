# Captures after an already settled exchange

Adapter **139 / live pipeline 145** fixes a second, downstream exchange-history
debit. The preceding persistent-pawn proof could establish a genuine gain,
then the final root filter subtracted the previous capture again and erased
it. This affects piece captures as well as pawns. It does not weaken the
current-board capture, compensation, checking or mating safeguards.

## Chess judgement and the real omissions

The initial owner example has Black's Nxd4 after ...exd4 exd4. Those first two
captures have exchanged equal pawns; taking the remaining d4 pawn is an extra
gain, not merely recovering the pawn already traded. Queen support makes the
capture work. The owner actually played Nxd4, so this is a recovered live
lesson, **not a newly discovered missed move**. The preceding White exd4 was
also the supplied best choice and keeps a neutral existing-danger explanation.

The complete 720-context replay changes nine full rows around five capture
opportunities, not nine independent tactics:

- Three previously empty principal lines gain a pawn capture, a compensated
  bishop recapture and a rook capture.
- One already present queen-capture lesson increases its local gain from
  5.8 to 9 pawns. Earlier equal knight trades cannot be charged again.
- One alternative Qxe5 gains a pawn lesson; Qb4/Qc6 and the default primary
  remain unchanged. A sound alternative is not silently made the best move.
- Four associated review contexts change: one added secondary opponent
  capture, the corrected queen-loss value, and two neutral existing dangers.

In the compensated bishop example, Black's Qxe5 takes a bishop after an equal
knight trade, but Black's bishop on h5 can be captured. The local proof retains
only one pawn after that compensation, not a free bishop. Fresh unrestricted
and held searches both prefer Qxe5. For the preceding White mistake, the
existing gxh5 material opportunity remains primary; the checked Qxe5 reply is
secondary. The better gxh5 leaves White's bishop off e5 and prevents this
specific recapture. This comparison does not claim that every Black attack
has vanished or that the local bound explains the entire engine evaluation.

## General rule and contrary controls

`settledRootCaptureExchange` replays complete-origin history to the exact root
FEN and verifies the exact previous position/move. Only an uninterrupted,
even-length chain of captures on the root capture square with **exactly zero
net material balance** qualifies. Quiet gaps, earlier surplus, promotions,
off-square en-passant captures and incomplete/mismatched histories do not
receive settlement credit. Existing capture proofs still decide whether the
current move actually gains anything. History itself is never a profit proof.

The final filter debits zero earlier material only for this verified settled
trade. The result uses the current-board liability-aware gain. Pawns retain
the bounded Hanging Pawn display/timeline rules; other pieces use Winning
Recapture. Missing history preserves the earlier conservative behavior. Both
position scans and actual-response mistake review carry the same history.

Six constructed cases and their colour reflections cover the extra pawn,
ordinary pawn exchange, an additional recapturing knight, missing queen support,
an extra queen after equal bishop trades, and a queen capture conceding a rook.
These are twelve inputs, not twelve independent games. Reduced/truncated
history, stale preceding context, a quiet gap and an unequal prior trade have
separate controls. The initial legal-fixture baseline had six failures and
seven passes: missing pawn/compensated-queen labels and understated queen values.
An earlier Qe7 control was illegal because it exposed its own king; an initial
queen placement accidentally defended the capturing rook. Both drafts were
corrected before using that baseline, not counted as successful negative cases.

## Independent engine evidence

There are **167 completed fresh depth-16 Stockfish searches**: 137 initial
root/defence checks and thirty follow-up checks of the changed owner contexts.
Exact FEN, held root, requested/completed identity, depth and legal PV replay
are checked against both request receipts. The public receipt retains 64
constructed-case searches; owner boards and detailed game history stay private.

- Owner Nxd4: +59 cp unrestricted / +61 held, with every legal immediate
  defence separately searched. This does not mean winning the whole game.
- Constructed extra-pawn pair: +60/+42 held. Removing queen support gives
  -388/-404; adding the recapturing knight gives -452/-438. These losing
  captures receive no generic gain label.
- Constructed queen pair: +720/+711 held. The rook-compensated pair is
  +609/+643 and retains only a four-pawn local material gain, not nine.
- Other changed owner roots: Qxe5 +403 held, dxe5 +496, Qxh4+ +622 and the
  alternative Qxe5 +401 against Qb4 +429 unrestricted.
- The two actual mistakes are independently inferior: Bxe5 -375 versus
  gxh5 -98; Qxe5 -530 versus Be6 +30. The neutral exd4 and Rxh4+ contexts
  remain the unrestricted best moves rather than new mistake accusations.

Engine scores are finite-depth whole-position estimates. Classifier values
are bounded local material gains; the two quantities are deliberately not
equated. The owner rows reuse an existing development sample, not a held-out
accuracy set. Private receipts under `Documents/OnCrescent Tactical Benchmarks/`
use the `settled-root-` prefix and retain draft and final replays separately.

## Verification and limits

The broad selected source suite passes **2,453 tests**, with 281 conditional
skips. The final four-file source/rendered/history selection passes 72 tests
with five optional skips, including the real owner pawn and causal cases. These selections
overlap and must not be added. Whole-project types and scoped lint pass. The
new generated-service test preserves the complete history, nine-pawn queen
loss, causal explanation and deck metadata across save/reload; all fifteen
service checks pass, with one optional real-engine check skipped. Its synthetic
nomination scores test wiring, not chess strength.

All 246 private course/game and twenty rare-theme full replay results remain
identical to adapter 138 apart from version metadata. This is regression
stability, not accuracy. Many of those inputs lack full game history and
therefore do not exercise the new branch. The owner corpus and explicit
contrary history controls provide that coverage.

The 43-module shared-review and 8,877-module primary frontend builds pass.
The compiled production controller passes all 720 owner contexts and twelve
constructed/reflected exchange controls. Owner classification/transfer
median/p95/max is **83/326/1,447 ms**; total including startup is
**111/357/1,477 ms**, with maximum startup 37 ms. These are Node-host worker
imports, not native-window or engine-inclusive latency. The three-second
computation and twenty-second startup bounds are unchanged.

The tested worker is `liveTactics.worker-CtpnimVe.js`, 572,655 bytes, SHA-256
`0a2472e653fc0244170377bae6e19852fde5fa9b1e37db4191d7ca1166a2afc8`.
The 808-input public-controller check also passes: **1,540 controller inputs**
across the three groups, not independent tactical judgements. Public
classification/transfer median/p95/max is **42/191/1,093 ms**, with total
**70/221/1,122 ms** and maximum startup 36 ms. Clean desktop delivery is recorded
separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`; the dirty primary frontend is
not a desktop release source.

A follow-up inventory still contains 81 empty principal capture roots. Those
are not 81 missed tactics. Two inspected queen-capture roots are appropriately
unlabelled equal exchanges: one trades queens to stop a rook loss (the actual
mistake already explains that rook loss), while another offers bishop/pawn
choices for completing a queen exchange. Their frozen engine continuations
and exact preceding moves do not justify adding free-queen lessons. This
limited inspection does not certify the other empty roots as correct negatives.

Remaining gaps include incomplete-history recaptures, unequal or interrupted
exchange episodes, longer counterplay, other quiet/endgame tactics, broader
candidate recall and primary specificity. No new engine or worker deadline
has been added. Native interaction and load-sensitive startup remain separate
unverified requirements, and this milestone does not complete the goal.
