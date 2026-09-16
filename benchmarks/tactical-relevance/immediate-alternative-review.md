# Show verified tactics already present in ordinary engine alternatives

Live pipeline **147** retains classifier adapter **140**. This fixes selection,
not detection: an empty first engine line no longer hides a verified immediate
tactic in a close-scoring second or third line. The original engine ranks,
individual classifications, timelines and mistake causes remain unchanged.

## Real-game findings and chess judgement

Three previously unreviewed July games added 52 complete-game contexts, with
53 fresh depth-16 searches and written initial judgements. The review found
Nxe5 and Qxb4 already correctly classified as Hanging Pawn in second lines,
while the initial live preview remained empty. Their frozen engine scores were
+155/+155 and +242/+233 cp respectively, from the moving side's perspective.
The former was actually played; the latter already had a separate missed
alternative explanation. Neither warrants inventing a new mistake cause.

Other observations remain important contrary evidence: the author's initial
notes missed a queen hanging to Bxg5 and a short queen mate which the classifier
found. A geometric knight check was correctly not a profitable fork. Equal
recaptures remained unthemed. Two Qxg7 opportunities in the new games are also
surfaced; they are adjacent contexts, not two independent games or mechanisms.

The complete 772-context replay changes **16 initial previews**, including a
rook fork, pawn captures, compensated material gains and a checking attack
against a promotion pawn. Every candidate's complete result and every source,
allowed/missed classification and mistake explanation is byte-identical to
its prior input-matched result. This is improved presentation/recall of existing
evidence, not sixteen newly discovered tactics or a general accuracy rate.

The first draft changed seventeen contexts. One promoted Qxc4, a zero-gain
Countercapture responding to an existing discovery. That is compensation, not
a new material opportunity; the final rule keeps it in its original explanatory
place. The same safeguard applies to ordinary and targeted alternatives.

One of 246 private course/generated-game results also gains a default Rxa2
Material Gain option: taking a bishop permits a pawn countercapture. The other
245 full results, all source results and twenty rare-theme results are unchanged.
The existing 92-context targeted-search replay is unchanged when compared with
the current adapter-140/pipeline-146 source, not the older pipeline-137 receipt.

## Admission and scope

- The first line must have no primary motif. Existing immediate, later and
  saving-resource headlines retain their selection rules.
- An ordinary alternative must have its own high-confidence first-move motif,
  name its actual root move, and carry a finite centipawn score within 80 cp of
  the first line. Both explicit depths must be at least 14, with the alternative
  at least as deep as the first line. Mate scores are not compared as cp.
- Generic capture evidence must retain a positive local gain; a zero-gain
  compensating response cannot become the new opportunity headline. Exact
  zero-material saving themes are not excluded by this capture-specific rule.
- Choose by original engine rank among qualifying ordinary alternatives, not
  by the number of badges or a borrowed future motif. Substantially weaker wins
  remain optional, not the new default. Existing targeted-search admission is
  otherwise unchanged.
- The UI explicitly calls this a close-scoring alternative, not the engine's
  best move or a separately searched additional option. The first choice remains
  accessible, and switching/restoring previews changes only that line's arrows.

Thirty-six fresh depth-16 searches independently rechecked the eighteen draft
root/selected pairs, including the rejected compensation and private Rxa2.
Finite engine scores are not local proof values or definitive move rankings.
In particular, Bxd8's held score moved from -969 in the frozen MultiPV to -1052,
versus the first choice's -947: a fresh scan with that evidence would not promote
it under the 80-cp rule. It remains a local material capture in an already lost
position, not a saving tactic or a claim of overall advantage.

The older ordinary-1:ply33 empty-headline assertion concerned Black's castling
line, not every move. The existing Bxd8 certificate takes an exposed bishop
while allowing pawn compensation. Its revised test preserves the empty castling
line, original engine ranks and qualified Material Gain wording; it does not
relax the material proof or fabricate a missed/allowed cause. The original
frozen engine report remains untouched.

Two of the 808 public worker headlines change. Besides that Bxd8 context, the
real `castle:zJqoVvf1:26:a` position now shows Nxb8 Rxb8 as a net exchange gain
of 180 cp, while retaining Bxd6 cxd6 as the original unthemed equal bishop trade.
Two additional fresh searches score the root and held capture at +234/+238 cp,
separate from the local 180cp gain. Both positions have dedicated assertions.

## Verification and limitations

The new selection controls first reproduced four baseline failures. Final
focused source, real-React interaction, lifecycle and ordinary-game tests pass
151 checks (three optional skips), with types and scoped lint. The actual Chrome
component and browser worker pass twelve groups at 1100/760/360px and 100/200%
text, including keyboard switches, restoration, initial selection and overflow.
This is isolated browser evidence, not a native owner-window test.

The whole utility run has 3,124 passes and two unrelated store-test failures: the existing audio
mock and `timestamp: undefined` mismatch, previously reproduced in clean source.
The changed ordinary-game assertion is separately reviewed above, not hidden as
an unrelated failure. The later explicit public exchange-selection test also
passes. Fifteen generated-review/service and two development-cache checks pass.

All **1,584 production-controller inputs** pass: 772 owner contexts, four
constructed selection controls and 808 public positions. The tested JS worker
is `liveTactics.worker-Gp_Nod6P.js`, 574,542 bytes, SHA-256
`307ffc747b436041e57a9315ef3b3f277a98a5fdc3cf756b09ca7a0b06f0e112`.
Owner classification/transfer median/p95/max is 83/320/1,479 ms; public is
45/216/1,252 ms. These Node-host timings exclude engine work and native UI and
do not establish a speed improvement. Startup and calculation deadlines are
unchanged. Primary frontend build passes; clean delivery is recorded separately.

Private reports use the `immediate-alternative-` prefix under the owner's
`Documents/OnCrescent Tactical Benchmarks/` directory. The draft and final owner
replays, fresh engine request/receipt, private/rare replays, old-source targeted
baseline and compiled-worker report are retained separately. The new game sample
and initial notes use `chesscom-july-next-three-`. Paid and owner boards stay out
of Git; no new game download or engine search is claimed for exact replays.

The fix cannot recover a tactic absent from supplied candidates, explain every
quiet/long combination, or prove the universally best teaching theme. It does
not resolve the previously recorded 20-second cold-development startup failure.
No owner app, shortcut, service or data is changed by these source checks.
Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
