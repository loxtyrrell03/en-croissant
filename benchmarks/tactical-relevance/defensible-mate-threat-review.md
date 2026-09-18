# Answerable mate threats without forced-win claims

Adapter **160 / live pipeline 167** separates a concrete new mating threat from
an independently established forced mate or material win. Requiring every
defence to lose material was suppressing useful threats in ordinary games.
The previous experimental extension to the mixed material proof was withdrawn:
it still could not establish the complete reached Qh5 combination.

## What the observation actually proves

A quiet, nonchecking move must create a new legal mate in one, absent before
the move. A hypothetical pass only nominates it: at least one **actual legal
reply** must still allow that exact mate. Every legal reply is enumerated and
at least one must prevent **all** immediate mates. A terminal position, a
claimable fifty-move draw, immediate capture of the preparer, an opposing
mate-in-one or exhausted 4,096-operation budget withholds this fallback.
Promotions are enumerated by the shared legal-move generator.

Engine scores nominate relevance (finite, side-to-move score at least -100 cp),
not the mating geometry or the outcome. No scoreless source line acquires this
observation. An existing independently established root lesson keeps priority.
`matingThreat` is distinct from the older all-defence `mateThreat`: value is
zero, it cannot establish a tactical mistake cause, and it cannot fund generic
capture badges in the continuation. This is a deliberately smaller claim, not
a relaxed forced-win proof. Capturing preparations and threats in strongly
losing candidates remain outside this fallback.

The board shows the preparation and mating route, not hypothetical defensive
moves. Copy prefers the independently checked defence in the supplied engine
line. Review says **Threat after the move** or **Threat in the better line**,
not that the observation proves why a move was worse. Independently established
queen losses retain priority. The generated review service preserves the
distinction after save/reload, including Black's ownership.

## Chess judgments and contrary evidence

The unchanged 27-game / 1,319-context owner corpus gains three root opportunities:

- Nf6 supports Qxd7#. The displayed ...Rbg8 both attacks the queen and vacates
  b8 for the king. The actual queen-for-rook loss remains the mistake cause.
- ...Qf6 and ...Qf5 threaten ...Qxf2#, supported by Ng4. Ne4 adds a recapturing
  defender; f4 blocks the alternate route. These are two options on one board,
  not two independent recovered positions. Playing ...Qf4 instead hangs the
  queen, which remains the primary lesson.
- ...Bc5 supplies support for ...Qxf2#. It remains a separate option behind
  the stronger immediate rook capture; the primary material headline is unchanged.

Exactly five full owner rows change: two principal scan headlines, their two
preceding neutral contexts and one alternative on the third board. The other
1,314 full results and all scoreless source-solution results remain unchanged
apart from versions/timing. This is neither five new tactics nor an accuracy rate.

The previously investigated reached Qh5 now explains Qxf7# without promising
that every defence loses material. That root is an owner-game **alternative**,
not a move actually played. The similar wrong move order still hangs the queen
to ...Nxh5 and is rejected, even with an injected favourable score.

One of 246 private course/generated-game results changes: the generated game's
Qg5 threatens Qd8#, supported by Ba5; ...f6 interrupts the route and attacks the
queen. The more positional Qc1/Qc2 choices remain available. The other 245 full
results and all twenty scoreless rare-theme results are unchanged.

One of 808 public compiled-worker primary lists changes: Lichess **snAK4** gains
Qd5's immediate ...Qxg2# threat, answered by f3. The longer ...Ra2 queen trap
still lacks a complete classifier proof. This is a useful partial explanation,
not certification that the trap's ideal primary theme has been recovered.

Twenty-four fresh depth-18 searches cover unrestricted/held roots and displayed
defences. They retain contrary evidence: the constructed Scholar's Mate Qh5
is only -46 cp versus +25 for the unrestricted choice, while the capturable
queen version is -704 cp. A real threat is not a claim to the best move or a win.
The original reached Qh5 also retains the earlier 44-search audit and eight
follow-up searches; these are reused evidence, not fresh searches this milestone.

An independent python-chess checker validates seven positive observations and
all **215** root reply edges, including the exact sets of immediate-mate
defences. Its initial castling-UCI mismatch was a representation discrepancy
(king-to-rook versus king destination), resolved through legal SAN identity.
This checks immediate threat geometry, not long-term material or game outcomes.

## Verification and limitations

- The broad 205-file selection passes 2,911 tests, with one retained expected
  coverage failure and 349 conditional skips; a later 164-pass focused run
  includes the additional real rare-root regression. Counts overlap.
- Types and scoped lint pass. The generated service passes 35 tests with one
  optional engine skip. Review/frontend builds pass; the primary frontend
  includes unrelated work and is not the delivery source.
- Eighteen real React/Chrome worker groups verify positive/negative states,
  keyboard previews, two exact arrows and 1100/760/360px at 100/200% text.
  Screenshots/report: `tmp/tactical-mate-observation-pipeline167/`.
- All 808 public compiled-controller cases pass. Public computation/transfer
  median/p95/max is 40/185/984 ms, excluding engine/native UI. The worker also
  passes ten new positive/negative colour controls and all 1,319 owner contexts:
  **2,137 compiled-controller inputs** in total, retaining the production 20/3
  second startup/computation deadlines. Clean desktop delivery is recorded
  separately once complete.

Private authoritative receipts are prefixed `defensible-threat160-` and dated
`20260918` under `Documents/OnCrescent Tactical Benchmarks/`: `owner-final`,
`private-final`, `rare`, `engine`, `rare-engine`, `validation`, `independent`,
`tests`, `public-worker` and `owner-worker`. Paid inputs and owner positions
remain outside Git. Source/proof tests, browser rendering and package linkage
do not establish native startup reliability or broad precision/recall.

Remaining work includes longer quiet combinations, completing the Qh5 payoff
and snAK4 trap, broader material opportunities, causal comparisons, primary
selection and native/load-sensitive reliability. Existing owner stores are not
automatically rescanned; app sessions and phone services are not restarted.
