# Checking pawn capture recall — adapter 118 / live pipeline 123

This continues the two frozen owner-game samples (217 and 122 pre-move
positions), rather than selecting new games after seeing classifier output.
Owner games, paid course inputs and detailed receipts remain private under
`Documents/OnCrescent Tactical Benchmarks/`.

## Chess finding and useful priority

In the first sample, Qxc6+ followed by Nxa3 is a useful alternative to the
played immediate Nxa3. The c6 pawn was already loose, so the previous exposure
rule suppressed its root lesson. Each of the three legal check evasions permits
the connected knight capture with a positive bounded local return. The result
now explains **Hanging Pawn** with check and retention, not an unproved
Intermediate Check or a claim that White wins the game.

The actual mistake still leads with the opponent's larger **Material Gain**
(230 cp local bound, involving the bishop), with the missed checking pawn
capture (100 cp) as the secondary lesson. The preceding opponent pawn capture
does not gain a new material-loss accusation merely for allowing another pawn
capture. The two choices are not thereby proved positionally equivalent.

Fresh held Qxc6+ scores -327 cp versus -585 for the immediate knight capture.
The chosen Nxa3 answers after Rd7, Ke7 and Kf8 score -430, -11 and -312 cp in
their respective searches. These finite-depth full-position estimates are
different from the proof's retained local material, not contradictory promises
of a winning position. Another already-detected Qxc3+ receives retention
wording, while its stronger Bxa3 alternative remains the teaching priority.

## General rule and limits

- Nomination requires a finite root engine estimate and a legal checking pawn
  capture whose supplied third ply captures a non-pawn piece. The line nominates
  an actual capture continuation; its material totals do not supply the proof.
- A shared 8,192-operation proof checks every legal check evasion. Each needs a
  profitable connected capture of an original available target, a moved original
  target, an interposer, or a capture by the checking piece. The nominated reply
  must retain its actual nominated capture rather than substitute a different
  convenient witness.
- Leaves account for immediate friendly-piece liabilities and the existing
  one-countercheck-evasion horizon. Neutral liquidation, quiet retreats,
  terminal/claim boundaries and incomplete searches cannot certify this rule.
- Both the direct gain and retained total must reach a pawn. The root lesson
  is capped at that pawn, not the extra material in a later continuation.
- The bounded cache includes the board, root and nominated reply/capture;
  custom operation budgets cannot borrow cached success.
- A bare pawn-for-pawn choice cannot by itself establish an opponent material
  loss cause. Larger exchanges retain their separate comparisons because a
  real combination may preserve both pieces instead of trading one away.
- Immediate Hanging Pawn annotations now show only the root capture, without
  borrowing unrelated reply/follow-up arrows from the engine line.

This is bounded material evidence, not full game-outcome verification or
root-only recognition. Missing scores, short lines and quiet continuations do
not activate this fallback. Older loose pawns requiring quiet retention,
longer counterplay and more instructive move-order explanations remain open.

## Rejected proposals and retained contrary evidence

An earlier quiet-retreat fallback recovered additional owner boards but chose
queen retreats materially worse than stronger replies. It was withdrawn; the
private rejected patch and exploratory engine report remain available.

The real Lichess hGEvH ...Rxg2+ attack exposed a different unsafe shortcut:
local queen liquidation could appear to retain material while destroying the
attack. Qxe3 after Kf1 scores -409 cp and after Kh1 -176; a proposed Qxh2 after
Kf1 scores -184, although it mates after Kh1. Requiring a positive connected
capture return and the actual non-pawn-capture nomination rejects these
certificates. The real supplied line continues Rg5 and remains an unexplained
king attack, **not a certified non-tactical position**.

A broader capture-credit guard also removed the owner's genuine bishop-loss
cause. It was narrowed to the bare pawn exchange. The public positive fixture
and its off-square bishop-liability control are constructed; both evaluate
roughly equal overall. Withholding the latter certificate does not prove a
lost or entirely non-tactical position. Synthetic renderer scores are only
nomination inputs, not engine findings.

## Verification

- Final selected source run: **2,370 passes**, zero failures, 165 optional
  skips. A subsequent focused recheck including the owner primary/secondary
  assertions passes 40 checks (two optional skips). TypeScript and scoped lint
  pass; frontend and generated shared-review builds pass.
- Twenty final fresh Stockfish searches check two owner roots and every chosen
  check-evasion answer, constructed/reflected positives and liability controls.
  Earlier exploratory searches preserve rejected witnesses; these are not
  additional independent positions or an accuracy estimate.
- Eight of 217 and one of 122 full owner result rows change, including wording,
  arrows and repeated move contexts. There is **one newly recovered live root
  opportunity**, not nine new tactics. The second sample's primary lists stay
  unchanged. The 246 prior private and twenty rare full source/live results
  also stay unchanged ignoring versions; stability does not certify accuracy.
  These comparisons use the final adapter-117 `*-recapture.json` source
  receipts, not the superseded `*-release.json`/`*-complete.json` source drafts.
- The immutable production worker passes the completed 17-group selection,
  including new constructed/reflected controls and the first owner sample.
  The second owner sample separately passes all 122 exact source/worker results.
  All **1,043 existing public report inputs** retain their ordered primary
  lists. Their computation/transfer median/p95/max is **37/181/861 ms**,
  excluding engine, startup and native UI.
- The existing real React/browser-worker harness passes twelve groups at three
  widths and 100/200% text: positive/contrary controls, keyboard preview, the
  root-only arrow and wrapping. This is not native desktop interaction proof.
- Ten generated-service checks (including real Stockfish) and two worker-cache
  checks pass. The final cold-HTTP run passes **117 cases**, with first/max
  startup **1,439/2,011 ms**, maximum computation/transfer **1,311 ms**, and
  separately measured server prebuild **2,961 ms**.

Two timing failures must not be hidden by those passes. Rebuilding dist during
an earlier worker test removed its in-use asset; final tests instead use an
immutable private artifact. Separately, a concurrent second-owner replay hit
the unchanged three-second computation deadline. Its earlier harness did not
save the failed row; it now records the exact failing identity and completed
timings. The isolated repeat passed, but that does not resolve load sensitivity.
Earlier twenty-second cold-start failures also remain unresolved. No deadlines
were increased and no timeout is converted into a successful empty result.

Authoritative private reports: `adapter118-tests-release.json`,
`chesscom-{recall,disjoint}-adapter118-release.json`,
`adapter118-{private,rare}-initial.json`,
`checking-pawn-final-engine-20260916.json`,
`adapter118-worker-{public,capture,discovery,drawing,game,preparation,recall}-release.json`,
`adapter118-worker-disjoint-verified.json` and `adapter118-dev-cold-release.json`.
The tested worker is `liveTactics.worker-BdohyW0V.js`, SHA-256
`5974b93fd233a35da77719de828583d27f6d7bff6c4d9747213c84e9117ed962`.

Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
No owner application or phone service was restarted during this source work.
Quiet fork repairs, broader recall/primary accuracy, a representative independent
benchmark, automatic larger-ending review and native reliability remain open.
