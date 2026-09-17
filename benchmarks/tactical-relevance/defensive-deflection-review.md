# Defensive deflection: removing a perpetual-check resource

Adapter **155 / live pipeline 162** recovers a real defensive purpose which a
material-profit filter could not explain. It also fixes a Black-score orientation
error in newly computed shared review cards. These are distinct improvements;
this milestone does not complete broad tactical recall.

## Real-game judgment

In the retained owner game, **Rf6+** drives the king away from guarding Rh7.
Both legal replies, Kg5 and Kxf6, permit Kxh7. White otherwise has the forced
Rg7+/Rh7+ checking cycle. The accepting branch trades rooks rather than winning
one; an additional pawn can be lost, but Black retains a material advantage.
The old root was empty despite this important defensive mechanism.

Fresh depth-16 searches prefer Rf6+ (+1088 cp Black); its held search scores
+938. Both selected Kxh7 answers remain winning in their separate held searches
(+1123 and +784). Passing and the actual d4 permit a draw; Ra8 is another winning
defence (+573), so merely choosing a different move cannot establish a missed
deflection. These full-position estimates are not the local material bounds or
an exact endgame solution. The before-root pass is explicitly hypothetical.

The same **27 games / 1,319 contexts** change in exactly two adjacent rows. One
empty live principal result gains Defensive Deflection. Its mistake review keeps
Perpetual Check primary, strengthens the defensive explanation, and adds the
missed deflection as the secondary lesson. The preceding row gains the neutral
opponent-position theme without replacing its existing missed perpetual primary.
All 1,317 other full results and every scoreless source-solution result remain
unchanged, ignoring versions/timings. This is one recovered tactical mechanism,
not two newly solved tactics or an accuracy rate.

## Proof, relevance and continuation boundaries

- A noncapturing checking offer must deflect the king guarding the opponent's
  last non-pawn piece (rook or queen). At least one legal reply accepts the offer.
- On the unchanged board with the opponent to move, that same piece must
  independently force a checking cycle against every legal defence. The normal
  perpetual verifier now optionally restricts the checker and shares the caller's
  budget; default behavior and caching remain unchanged.
- Every actual evasion must move the king off its guard and permit capture of
  that exact piece. Entry sacrifice, legal recaptures and all immediate friendly
  liabilities count. The local material advantage must remain; immediate pawn
  checks/promotions and a claimable fifty-move draw reject this certificate.
- Live admission additionally requires a finite winning candidate score of at
  least 200 cp and no already established immediate root lesson. The score
  nominates a worthwhile defensive candidate, not its mechanism or a proven win.
  Scoreless source inputs deliberately do not acquire this outcome-dependent
  headline. The 8,192 shared operations plus bounded exchange probes and existing
  worker deadlines remain bounded; no new engine or network work is added.
- The label has value zero, not invented profit. Current arrows show the offer,
  its attack on the king and the guarding relationship. They do not show Kxh7
  before the guard moves. Matching later capture says **Defensive Trade**, without
  an independent free-rook value. Other branches cannot borrow this payoff.
- A missed lesson additionally requires the actual reply to prove the same
  piece's perpetual. Equivalent defences and playing the best move are not
  accused. An opponent's defensive deflection stays neutral without a separately
  established comparison.

## Contrary evidence and corrected assumptions

The constructed rook ending and its colour reflection support the same mechanism.
The actual held Rf6+ is winning (+478/+470), though other moves mate faster in
these constructions. This is not a claim that the illustrative move is optimal.

The initially proposed queen-offer control was misjudged: Qf6+ is sound with
another rook remaining, but Qxg7 already answers the alleged perpetual. It is
correctly **not** this motif. Without the spare rook the offer loses. Neither
control should be described as a positive defensive-deflection example.

Moving the spare rook onto a capturable square defeats immediate Kxh7's local
retention. Nevertheless Rf6+ still wins through an intervening Rb6+; the direct
capture rule abstains, not declares the whole position non-tactical. Other
controls cover a king escape from the checking cycle, an immediate promotion,
continued king protection, scoreless/drawn/losing candidate input and late
fifty-move claims. These are specific certificate controls, not universally
correct negative positions.

## Shared review integration correction

The saved-review test exposed a real caller mismatch: `createPhoneReviewCard`
passed player-relative centipawns into the adapter's White-relative fields.
For Black this inverted score-gated motif eligibility. The caller now passes
absolute White scores for classification while preserving player-relative chance
estimates and loss. Both colours, actual generated service cards, deck export and
reload are covered. This changes newly computed review; no owner store was
rewritten and no automatic rescan of previously saved cards is claimed.

## Verification and scope

- 93 fresh searches: 84 public constructed decisions in
  `defensive-deflection-stockfish-18.json`, plus nine private owner decisions.
  Searches overlap and include colour reflections; they are not 93 independent
  positions. Earlier 154-stage engine work is not recounted here.
- Python-chess independently verifies the owner's complete two-reply root set,
  legal target removals and five-ply single-reply checking cycle. An omitted
  branch is rejected. `verify-defensive-deflection.py` does not certify the
  TypeScript material bound or a winning ending.
- The selected source suite passes 2,822 tests with 334 conditional skips.
  Later focused checks cover the final claim guard, public engine inputs,
  current-ply rendering and both-colour review scores. Types, scoped lint,
  review/frontend builds, thirty generated-service checks (one optional skip)
  and two development-cache checks pass.
- All 246 private-course full results and twenty rare-theme full results are
  unchanged from adapter 154. Regression stability is not certified correctness.
- Compiled controller passes 822 inputs: 808 existing public cases and fourteen
  constructed/reflected offers. All prior public primary lists remain unchanged.
  Public computation/transfer median/p95/max is 43/208/1,101 ms; startup maximum
  is 37 ms (rounded up). Engine, development HTTP startup and native UI are not
  included, and these measurements do not resolve load-sensitive startup.
  Full owner-worker and clean desktop delivery are separate checks. The
  dirty-checkout frontend build is not a clean desktop package.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`, with
`defensive-deflection-` and `defensive-deflection155-` prefixes and `20260917`
suffixes. The `owner155-final` replay is authoritative; the earlier replay
predates defensive-payoff wording. Owner FENs and paid-course content stay private.

Broader defensive exchanges, quiet/long preparations, the known quiet pin and
queen-ending promotion, independent primary-theme accuracy and native/load-
sensitive reliability remain open. No owner runtime or phone service was restarted.
