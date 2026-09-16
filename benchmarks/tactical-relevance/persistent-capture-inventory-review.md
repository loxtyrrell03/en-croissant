# Complete-game capture inventory and history-policy audit

Production remains **adapter 127 / live pipeline 132**. This milestone adds a
complete capture inventory, fresh independent engine decisions and an explicitly
experimental history policy. It does not change the classifier, generated
service, worker, desktop executable or owner data.

## What was actually inspected

All eight previously frozen owner games are retained: 420 pre-move contexts,
both colours and all phases. This is the existing development sample, not eight
new games or a held-out accuracy benchmark. Every legal ordinary capture is
examined; promotions are outside this particular audit. Full games are replayed
and matched to the frozen position, played move and engine-report identity.

| Inventory category | Count and scope |
| --- | --- |
| Legal captures examined | 779 move decisions across 420 contexts |
| Captures with a positive bounded local gain of at least 90 cp | 139 |
| Included in the stored engine's top candidates | 105 of those 139 |
| No immediate theme among those engine candidates | 41 |
| Actually retained as live candidates, but with no immediate theme | 34 of those 41 |
| Rejected by existing live candidate selection | 7 of those 41 |
| Positive local captures outside the stored top candidates | 34 |

The 41 candidate omissions comprise 24 nonchecking pawn captures, four checking
pawn captures and thirteen piece captures. After accounting for live selection,
the 34 retained omissions comprise twenty nonchecking pawns, three checking
pawns and eleven piece captures. These are **not counts of missed tactics**.

The first inventory did not explicitly distinguish an engine nomination from
an actually retained live variation. Inspection corrected that omission before
the final report. In particular, the losing Rxh7 is excluded while the saving
Rg7+ perpetual stays available; that is not a missing hanging-knight lesson.
The same distinction matters for Bxg7 versus the much stronger b4 and for Nxg4
versus dxe4. No live score filter was relaxed.

## Chess findings, including a corrected earlier judgement

- **Qxg7 and Nxf2 remain genuine available pawn captures.** They were available
  before the preceding move, so they fail the existing new-exposure test. Fresh
  held searches give +166 and +861 cp respectively. Those whole-position scores
  are not their 100-cp local bounds. Both moves were actually played in these
  contexts; recovering their live lessons must not invent missed-move accusations.
- **An opening Qxd4 is not merely a routine exchange.** Qxd4 Qxd4 exd4 exchanges
  queens *after* taking the initially loose pawn. Fresh held/best estimates are
  +84/+85 cp. An earlier bishop-for-knight exchange cost Black ten conventional
  material points, leaving a 90-cp historical residual when combined with this
  pawn. The older informal dismissal as just a pawn/queen exchange was too broad.
- **A separate dxe4 after Bxc3+ bxc3 likewise gains a pawn.** Trading a bishop
  for a knight elsewhere does not make the e-pawn capture disappear. Fresh held
  and best estimates are +60/+69 cp. This remains an available material lesson,
  not a claim of a won game or a mistake made on this already-played capture.
- **Ordinary piece recaptures are not eleven missing free pieces.** The retained
  piece-capture group includes restoring a knight after Bxf3, queen exchanges,
  bishop-for-knight exchanges and recovering a knight after losing a rook.
  Compensation must remain part of the interpretation.
- **Qxd4 in the second sample is a useful alternative to losing the queen.**
  Its held score is +150 cp, but the existing queen-loss explanation must remain
  primary; a pawn alternative cannot displace that larger cause.
- **A local pawn bound does not establish the best teaching headline.** Rxc3's
  fresh search still reports a longer mate, not a generic pawn-winning plan.
  Nxf5's fresh line includes returning material after a central pawn break and
  queen activity; Nxe4's opening line also permits a later pawn recovery through
  exchanges. These need contextual judgement, not automatic certification from
  the material count or the supplied PV alone.

Seventy-five new depth-16 Stockfish 18 searches cover all 41 held candidates
and the unrestricted best move at their 34 distinct boards. Every final request
identity, FEN, held move, depth and legal returned line is reconciled with the
receipt. Separate held/best searches are not a consistent exact minimax bound.
Repeated boards, alternative captures and the same theme across adjacent moves
are not counted as independent tactical discoveries.

## Experimental policy, deliberately not enabled

`persistentPawnHistory.ts` lives under test fixtures, not production. It traces
the same capturing piece and target pawn backwards through exact move history,
accounts for captures around the opportunity, and caps the result at the current
independently checked local capture bound. Earlier material cannot inflate that
bound. Constructed tests cover both colours, unsettled pawn loss, a settled
bishop exchange, invalid/mismatched history and Petroff/Catalan recovery.

The first draft missed the Catalan debt when Qa4+ established the queen's attack
*after* ...dxc4. Following the target pawn's earlier capture fixes that example,
including a further delayed Bg2/Nc6/Qa4/Bd7 sequence. One initial positive fixture
also accidentally gave check with Nxe5+; its king placement was corrected to
exercise the intended nonchecking rule rather than weakening that restriction.

More importantly, a valid truncated history beginning after ...dxc4 still falsely
admits Qxc4, despite a seemingly complete local availability boundary. The
regression explicitly records this **known failure of the experiment**, not a
desired classifier result. A sixteen-ply window cannot certify that an older
gambit debt was included. Production admission must not be wired to this helper.

The experiment nominates twelve currently retained, unlabelled live candidates;
these are not twelve verified recoveries. One has the longer mating evaluation,
others are alternatives, and the opening/primary-relevance questions remain.
The next implementation needs a reliable exchange-history contract shared by
live scanning and mistake review, including cache identity and stored-card
handling, or another independently validated way to establish that context.
One previous move, a positive engine score, or a hard-coded home-rank-pawn
exception does not solve the underlying issue. It must also keep genuine pawn
opportunities in worse positions and preserve neutral/comparable-capture review.

## Reproduction, privacy and delivery

Run `persistentCaptureAudit.test.ts` and `persistentCapturePolicyAudit.test.ts`.
The inventory accepts `TACTICAL_CAPTURE_AUDIT_INPUTS` as a JSON array of private
`{sample, replay}` pairs, plus `TACTICAL_CAPTURE_AUDIT_REPORT` and optional
`TACTICAL_CAPTURE_AUDIT_PROBES` output paths. All outputs resolve through the
existing private-path/junction guard and refuse replacement. The policy audit
uses `TACTICAL_PERSISTENT_HISTORY_REPORT`. Reconcile engine receipts with
`TACTICAL_CAPTURE_ENGINE_REPORT` and the probes path. Fresh searches use the
existing `tacticalJudgement` private-decision harness.

Final private receipts under `Documents/OnCrescent Tactical Benchmarks/`:

- `persistent-capture-inventory-verified-20260916.json`;
- `persistent-capture-probes-verified-20260916.json`;
- `persistent-capture-engine-20260916.json` (75 completed searches);
- `persistent-history-candidates-verified-20260916.json`.

Eight opted-in audit/policy checks pass; the final seven-file selection passes
93 checks with nine optional skips, including the engine-receipt reconciliation.
Whole-project TypeScript and scoped lint pass without errors or lint warnings.
Production classifier source is unchanged; no new package, restart, phone
deployment or native-window validation is claimed. The broader recall,
quiet-preparation, causal-primary and startup gaps remain open. Paid course and
owner position data stay outside Git.
