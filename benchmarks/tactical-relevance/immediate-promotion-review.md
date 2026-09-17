# Immediate promotion relevance — adapter 145 / live pipeline 152

The promotion itself now has a position-local material certificate, independent
of later engine captures. A certified immediate promotion precedes an unrelated
later discovery in the headline; the discovery remains at its actual ply. A
separately proved root fork or mate can still be the more useful explanation.
This improves explanation and priority, not overall tactical recall: one older
real promotion loses its certificate under the stronger safety checks, and is
explicitly retained as an expected coverage failure.

## Fresh owner-game audit

Three further June Chess.com games were selected by recorded end time after
excluding the previous three, without result, evaluation or motif filtering.
Initial chess judgements were written before engine/classifier output. The 181
new move contexts extend the frozen corpus to 1,181 contexts in 24 games. Full
games, owner identities and detailed receipts remain outside Git.

The audit finds that the obvious royal fork and two ignored/hanging queens are
already explained. The apparent free-queen Bg7+ combination is correctly a
small compensated gain after trading bishop and rook for queen. Routine
exchanges do not automatically acquire free-piece labels. My initial account
of another game's ...Qb1+ overlooked Nxb1 winning the queen; the classifier
correctly identifies that blunder. Initial human judgement is not ground truth.

Two late promotions expose the current changes:

- ...h1=Q had an 800-unit root-only value but a 1,730-unit full-line value,
  borrowing later captures. Both now report 800 locally.
- ...f1=Q+ was displaced by a ply-five Discovered Check in the full input.
  Promotion now explains the current move; the later discovery remains later.
- Ra6+ makes immediate queening illegal but may only postpone it. That fact
  alone no longer establishes that the preceding move allowed promotion.
- In the other comparison, the same promotion remains independently available
  after the better king move. Review explicitly says the promotion does not
  establish the difference between the two choices.

The exact 1,181-input comparison changes seven full rows, not seven new tactics.
Two live headline lists change: the later discovery becomes immediate Promotion,
and the older check-sequence promotion described below becomes empty. All other
1,179 principal headline lists are unchanged. One source-only promotion claim
allowing a longer forced mate is also withdrawn; its live result was already
empty. These are not accuracy percentages or a net-recall success.

## Certificate and causal boundaries

The root promotion uses the existing 4,096-operation material-retention budget:
promoted-piece value minus pawn value, any capture, legal recaptures, off-square
friendly losses, terminal refutations and countercheck answers. The stronger
connected-collection check settlement is required. Budgets and production
startup/computation deadlines do not increase. The value is a bounded local
material result, not a whole-position evaluation, proof of winning the game or
proof that an underpromotion is necessary.

Unproved promotions cannot borrow PV profits or a mate sentinel. Actual later
promotions remain observations in the timeline. In the public oSj8l example,
Fork remains primary; the secondary Under-Promotion is 220 locally rather than
duplicating the fork's 1,120-unit bound. Promoting to bishop/knight into a dead
ending is not a material-win headline, but the actual move is still described.

Missed-promotion review excludes an equally retained promotion choice and a
promotion still independently available after the actual move and supplied
best reply. This is not an assertion that the full positions are equivalent:
other separately proved tactical mistakes remain eligible. Opponent promotion
causes require more than temporary illegality under check. Capturing the actual
pawn supplies prevention evidence; equal retained promotion supplies persistence
evidence; unsupported comparisons remain neutral.

## Contrary evidence and open recall

The older owner ...d1=Q after Kxb2 is a real recovery of material. Fresh depth-20
Stockfish gives approximately +0.51 for Black, not a refuted promotion. Re7+
Kh6 Re6 maintains counterplay. The local verifier cannot settle every continuing
rook check, so it withholds the headline. This is a known regression in coverage,
not a correct negative or an accuracy improvement; an explicit `test.fails`
records the missing certificate. Broadening that proof without accepting king
hunts or perpetuals remains follow-up work.

Other reviewed omissions remain open: a pin attack needing ...Bb4+ and castling
before collection; a quiet knight-fork preparation; and a pawn push whose engine
line forces promotion/mate. One tempting ...Rh2+ pawn-win judgement was rejected
because Kb3 can defend the pawn; one PV does not certify every defence.

Constructed controls cover recapture, off-square queen loss, stalemate, dead
underpromotion, immediate mate, opposing promotion and capturable counterchecks,
in both colours. Two initial controls were corrected before final verification:
one illegal promotion started in rook check, and one supposedly harmless checking
rook could simply capture the new queen. A later diagnostic ...Ng4+ also made the
requested promotion illegal; the aborted six-search receipt is retained and the
final nine-search causal audit uses a legal nonchecking knight continuation.

## Verification and receipts

- 181 fresh game-context engine searches, seven selected game decisions, 152
  promotion/defence/answer searches, six older-gap searches and nine final causal
  searches. Full-position engine scores do not establish the local numerical
  gain or certify an exhaustive accuracy benchmark.
- 2,690 selected source/review/render tests pass, with 301 opt-in skips. This
  includes the explicitly expected promotion-retention coverage failure, not a
  solved case. The focused four-file run passes 107 checks with three skips.
- All 246 prior private course and twenty rare-theme full source/live results
  are unchanged from adapter 144, ignoring version only. This is stability,
  not correctness adjudication.
- Whole-project TypeScript, ten-file scoped lint, twenty generated-service
  tests (one optional engine skip), two development-cache/recovery checks and
  the 43-module review / 8,877-module main-worktree frontend builds pass. The
  first review build hit a Windows mapped-file lock; an unchanged retry succeeds.
  The main-worktree frontend includes unrelated dirty work and is not the
  desktop delivery source.
- The new renderer checks promotion text and actual-root arrows. The generated
  service test saves/reloads a missed promotion; its controlled scores test
  wiring, while separate Stockfish searches test that position's chess.
- All 2,009 production-controller inputs pass: 808 public cases, twenty new
  colour-reflected controls and all 1,181 owner contexts. Every owner scan
  matches source and its frozen final replay. Owner classification/transfer
  median/p95/max is 92/340/1,453 ms, excluding engine/native UI. Aggregate batch
  timeout is increased for the larger corpus; each worker retains the existing
  20-second startup and three-second computation deadlines. Worker
  `liveTactics.worker-BJ6W005o.js` is 587,626 bytes, SHA-256
  `1ab6ea8f383ac9f03f5319f098ba61c2687e4be1ff0f659fb753bb3db02db20d`.
  These controlled production-import checks do not resolve earlier cold
  development/native-load failures or demonstrate an overall speedup.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:
`chesscom-june-next-three-20260917.json`,
`chesscom-june-next-three-initial-judgement-20260917.md`,
`chesscom-june-next-three-adapter144-20260917.json`,
`june-next-decisions-engine-20260917.json`,
`immediate-promotion-engine145-20260917.json`,
`immediate-promotion-gap-engine145-20260917.json`,
`immediate-promotion-causality-engine145-final-20260917.json`,
`immediate-promotion-owner145-final-20260917.json`,
`immediate-promotion-private145-final-20260917.json`,
`immediate-promotion-rare145-final-20260917.json`, and
`immediate-promotion-tests145-release-20260917.json`,
`immediate-promotion-owner-worker145-final-20260917.json`, and
`immediate-promotion-public-worker145-final-20260917.json`.

Clean desktop delivery verification is recorded separately when complete.
No owner app, data or phone service was restarted or changed by
this audit. Broader recall, primary selection, longer counterplay and native
interaction/load-sensitive startup reliability remain unfinished.
