# Quiet intermediate capture development contrasts

Two additional public nominations test whether a quiet exchange must precede another capture. They expose different boundaries: one supports a bounded move-order lesson but requires prior-pawn debt and payoff deduplication; the other rejects a nominal queen recovery that is immediately recaptured. Neither source labels nor these two cases establish population accuracy.

## Frozen selection and hypotheses

`quiet-intermediate-development-select.mjs` reads the existing small public fixture without copying it. The seed, source checksum, earlier public-review exclusions, selected source games and per-board hypotheses were retained before classifier or proof-kernel output. There were only two eligible development nominations with a legal nonchecking capture and the source intermezzo tag: Qq0JW and EpYOT. They are fresh relative to recorded prior public development review only, not a clean unseen corpus or holdout. Both were retained without replacement. No holdout, owner data, new downloads or engine searches were used.

`quiet-intermediate-development-adapter173.json` records exact commit `9756fd271f0e293b3d2b4a2bbffadc51c85588f3`, using the existing read-only module loader. Each case is checked in both colours, with root-only and full-line inputs. A separate synthetic free-capture board checks that move ordering does not automatically create an extra tactic. These are paired variants, not independent samples.

## Qq0JW and retained recovery

The root is `r4rk1/pp3pp1/2nb1n1p/3N4/3P2q1/3BBQ2/PP3PPP/R3R1K1 b - - 0 15`, with Qxf3 gxf3 Nxd5. Qf3 both defends Nd5 and attacks Qg4. Playing Nxd5 first vacates Nf6's defence of g4 and allows Qxg4. This is a concrete connected reversed-order resource, not an unrelated future capture.

Qxf3 has 42 legal replies, including Bh7+, Nxf6+ and Ne7+. Independent legal enumeration and replay cover the shared kernel's complete first-reply sets. A low requested bound returns only 100 in each direction; that first-found result is not the best available bound. Separate stronger requests establish forward 320 in 929 visits and reversed recovery 570 in 1,821 visits. A request for the nominal queen value 900 fails without exhaustion. Thus an unrecaptured queen on the next ply alone does not justify crediting 900 forever. The stronger searches are benchmark diagnostics with separate budgets, not the production admission budget or a complete game-result proof.

The source line gains 320 from the root, but the exact preceding Nxd5 captured Black's pawn. Including that loss gives 220. The initial adapter 174 integration incorrectly kept 320 in the history-aware result and called the later Nxd5 another free knight gain. These were reported for correction: the named deferred receiver must bind the earlier debt, and its already-certified collection belongs on the timeline without another positive material amount. The final paired receipt, not the initial checkpoint, records the corrected implementation.

## EpYOT and a recaptured queen

The root is `r1b2r2/pp4bk/1q1Qp2p/4Npp1/8/2P3P1/PP2PPBP/1R1R2K1 b - - 0 19`, with Qxd6 Rxd6 Bxe5. Qd6 defends Ne5 and attacks Qb6. There are 40 legal replies to Qxd6, none checking. The bounded connected collection is 320; the preceding Nxe5 pawn capture reduces history-inclusive retention to 220.

Reversing Bxe5 and then Qxb6 does **not** prove a queen recovery: ...axb6 is legal and returns the queen immediately. The reverse proof abstains in 104 visits, without exhaustion. The alternative Qxe5 may support a different defender-removal explanation, but that route has not been closed here. The new intermediate label must not be preferred merely because it is available for the other case.

Adapter 173 instead headlines two 100-point skewer explanations ahead of the larger connected material collection. Removing Pc3 or Pg3, or both, preserves the 320 bound in both colours, but the rays then reach Pb2 and Ph2. Removing all four rear pawns removes the skewers and leaves a 220 material result; the 320 request fails on Rxd6. This experiment is confounded because removing Pb2 opens Rb1's capture of b7. Consequently the audit does not certify those skewers as wholly irrelevant or authorize their suppression. Primary competition remains unresolved and is retained as such.

## Adverse controls and causal requirements

The synthetic board `7k/8/4b3/3B4/8/8/2Q5/2b3K1 w - - 0 1` has a genuinely loose Be6. Bxe6 gains 330 directly. It remains a hanging-piece lesson in both colours; the reversed-recovery proof does not close. Near-equal nominal piece values therefore cannot replace a legal exchange-safety check when admitting an intermediate capture.

The earlier Ltbye controls remain distinct: removing Rc8 still permits safe retention, while the off-square queen-liability example exhausts its budget and is unknown. A safe general rule must charge root capture debt and deferred capture exactly once, measure the opponent's recovery from its own pre-capture board, retain all legal counterchecks and declines, bind the actual removed piece and deferred receiver, and prevent an already-valued later payoff from becoming a second win. Exact preceding capture debt includes pawns, not only larger pieces.

The production rule and its dedicated regressions are owned separately. This audit only adds retained evidence and tests. The final verification receipt distinguishes the immutable adapter 173 observations, final adapter 174 output, and unresolved judgments; no agreement percentage or broad tactical accuracy claim is made.
