# Capture choices, real-game context and mistake ownership

Adapter 105 / live pipeline 110. Source/build milestone, not a deployment or a
claim of complete classifier accuracy.

## Independent game-context audit

The [fixed sample](quiet-game-context-development.json) takes plies 7, 22, 41,
60, 81 and 100 from the first four already-frozen quiet-mate source games.
There are 21 available boards; three unavailable plies are recorded, not
replaced. This examines both colours, ordinary openings, middlegames, exchanges,
bishop endings, pawn endings and rook endings. The puzzle endpoints were
previously examined, but these fixed game boards were selected before their
fresh engine/classifier output. Puzzle-source games are not a representative
sample of all chess. Player headers, comments and clocks are omitted.

[Initial board-based judgements](quiet-game-context-initial-judgement.md) were
recorded before output. [63 fresh Stockfish 18 searches](quiet-game-context-stockfish-18.json)
cover each best move, actual move held fixed, and actual resulting position,
without filtering on move quality. All supplied PVs and the source histories
are legally replayed. These searches are 21 decisions, not 63 independent
accuracy examples. Evaluations are side-to-move whole-position estimates,
never certified local material values.

| Game context | Reviewed judgement and limit |
| --- | --- |
| [TRKE6TxS](https://lichess.org/TRKE6TxS), plies 7/22/41 | Petroff pawn recovery, rook development and king centralisation in a bishop ending remain unlabelled. A loose pawn in an opening exchange is not automatically a newly missed tactic. |
| TRKE6TxS, plies 60/81 | The checking advance and sharp pawn ending remain unresolved as broader tactical claims. Black is already losing at ply 81; White's b6 is stronger than the actual bxa6. Do not borrow the later king-mate puzzle or count empty output as an accurate negative. |
| [Gectvn7R](https://lichess.org/Gectvn7R), plies 7/22/41/60 | Development, a geometrical pin, saving a bishop and rook pressure are not independently established root tactics. The existing queen-versus-pieces imbalance does not count as a new gain. |
| Gectvn7R, plies 81/100 | A later rook pin depends on Qxd3, not the current ...Bf6. The immediate pawn recapture at ply 100 leads to an equal bishop ending; later mating play is not a root promotion or zugzwang. |
| [ZFgq8VzD](https://lichess.org/ZFgq8VzD), plies 7/22/41 | A developing pin, bishop/knight recapture and checking queen exchange remain free of root noise. The engine's White preference at ply 41 corrects a simplistic reading of Black's extra piece. Contextless recapture probes are not the live result. |
| ZFgq8VzD, ply 60 and actual response | Kf5 is the best check evasion. ...Ng6 then threatens ...Ng7 mate; every one of 18 legal replies is independently covered. White's e5 avoids mate but permits ...Nxh4+, so the local bound is one pawn even though the whole position is near equal. Mating Attack is relevant, but the best king move did not cause the pre-existing danger. |
| [C9q6jvtW](https://lichess.org/C9q6jvtW), plies 7/22/60/81/100 | Normal development, a recapture choice, rook activity, check evasion and passed-pawn technique do not acquire root tactical badges. The recapture choice at ply 22 costs evaluation; that alone is not proof of a tactical cause. |
| C9q6jvtW, ply 41 | The misleading missed-capture explanation described below is qualified. The connected extra-pawn mechanism is not yet independently proved. |

## Why a real capture was still a misleading main lesson

In C9q6jvtW, White has just played Nxg4. Black's actual ...fxg4 recaptures the
knight; the better ...Rxc6 captures a loose bishop. The old review advertised
"What you missed: Hanging Piece", with a nominal 330-centipawn capture, although
the played move captures a knight worth 320. A true available capture is not,
by itself, the reason one capture is substantially worse than another.

[64 additional fresh engine searches](capture-choice-stockfish-18.json) cover
the unrestricted root, both held-fixed captures, and **every immediate legal
reply after either choice**. ...Rxc6 activates the rook against c2 while the
knight is under attack. Ne3 can guard c2 but allows ...f4 to chase the knight;
after ...fxg4, Be4 saves the bishop while guarding c2. The engine prefers
...Rxc6 by roughly 2.7 pawns in whole-position evaluation. That is not a proof
of a 2.7-pawn local win, nor a justification for calling this purely positional.
The connected follow-up remains a coverage gap rather than a fabricated theme.

The new comparison applies only to an immediate, generic missed hanging-piece
capture. Both choices must be legal non-promotion captures with positive
bounded capture-square exchanges, and the played exchange must be less than
90 centipawns worse locally. It also handles different attackers capturing the
same victim, and a played capture with a larger local gain. En passant names
the actual captured pawn's square. The 90-centipawn cutoff is an explanatory
noise threshold, not a chess equivalence theorem.

Such a motif becomes **Capture choice / Capture in the better line**, retaining
its real capture evidence but not claiming an established missed-material
cause. An independently verified opponent root lesson takes priority; the
qualified capture cannot become an additional "you also missed" cause. Losing
or equal exchanges, promotions, later plies and independently verified forks,
pins, interference, zugzwang and other combinations are not qualified by this
path. It does not prove the moves equally good, compare off-square losses or
king safety, or use engine scores to certify causation.

## Consumer and import corrections

The qualification survives review persistence, both root and actual-ply
timelines, desktop reveal, phone/shared-card explanation and service reload.
The compact badge wraps at narrow widths and 200% text. Hidden answers remain
hidden. The unrelated tactical/positional **nature** classifier remains a
separate heuristic; this milestone does not certify or replace its categories.

The real shared-service test also exposed an input-ownership defect: imported
FEN-started games assigned move colour from their local ply index, incorrectly
calling the first Black move White. The shared PGN reader now uses the legal
position's actual turn, including variations, while retaining local ply indices.
Black-started imports at move numbers 1, 21 and 93, normal White-started games,
the correct player's real capture-choice review, and persisted service output
are covered. Existing stored imports are not rewritten by this source change.

## Verification and remaining work

- 2,092 selected tests pass (86 optional skips), including the existing 32 frozen
  priorities and rare-theme controls. The 17 new game-context checks also pass
  after explicitly matching the ...Ng6 proof to all 18 legal defences.
- The wider PGN-consumer run has 2,246 passes and one unrelated existing failure:
  `webCompanion.test.ts` expects `Engine best` but current unrelated stats code
  emits `Local eval best`. Replacing only the PGN reader with the retained HEAD
  version reproduces the identical failure. Unrelated stats changes are preserved.
- Retained adapter-104/PGN code fails 14 of the 35 initial new capture/ownership
  checks. Later added legal-exchange controls are additional tests, not part of
  that retained-baseline count. An initially proposed larger-capture control
  actually allowed the queen to recapture the rook; it is retained as a negative,
  and a legally separated queen supplies the intended positive control.
- All 246 private source/live full results and all twenty rare results are
  unchanged apart from classifier version. In the 21 new contexts, only the
  identified review/explanation changes; every source/best/actual-response scan
  remains unchanged. Stability is not accuracy certification.
- Type checking, twenty-file scoped lint, the shared-review build and
  8,874-module app/worker build pass. Four service checks and two development
  cache/recovery checks pass. Twelve real existing React game-info groups pass
  at 1100/760/360 pixels and 100/200% text, including reveal, timeline, details
  and save/reload. Chrome is isolated; OS metadata is an explicit fixture, not
  native-app verification. The harness drives the existing panel's reveal
  prop; it does not certify whole-workspace or native reveal-button wiring.

- All 17 production-controller groups pass: 1,379 inputs, comprising 808 prior
  public inputs, 63 new game-context inputs, 20 additional public rare inputs,
  485 existing private inputs, two private mechanism inputs and one additional
  public promotion input. The [871-input public timing receipt](built-worker-adapter105.json)
  has median/p95/maximum 65/210/878 ms and maximum computation/transfer 848 ms,
  excluding engine and rendered UI. All 808 prior headline lists are unchanged.
  The final artifact is `dist/assets/liveTactics.worker-zpQY53kY.js`, SHA256
  `5d8e4563cba855768b89ebfd5128a02744ce00641506b574d57b297b84f0e523`.
  All 1,379 inputs were repeated after the import-order cleanup, not merely
  assumed equivalent to the earlier build.
- All 81 cold-HTTP cases pass with the unchanged 20-second startup and
  3-second classification deadlines. First/next startup is 1,137/1,213 ms;
  another startup reaches 3,941 ms. Maximum computation/transfer is 1,316 ms;
  the separate Vite server starts in 2,402 ms. This remains variable startup,
  not a native-WebView or installed-engine reliability guarantee.
  A second complete 81-case run after an import-order cleanup also passes;
  the earlier variable-startup measurements are retained rather than hidden.
  Its first/next/maximum startup is 1,212/81/2,210 ms, maximum computation/transfer
  1,361 ms, and separate server startup 2,007 ms. Both complete runs exclude
  owner/native runtime and engine-search latency.

Private comparison receipts are under the existing local Tactical Benchmarks
directory: `adapter105-final-qualified-replay.json`,
`rare-theme-adapter105-final-qualified.json` and
`adapter105-game-context-final-qualified.json`. Paid source material stays
private. The original game decisions, legal probes and public engine receipts
are reproducible with the scoped `scripts/benchmarks/*game-context*` and
`capture-choice-probes.mjs` scripts.

No owner application, installed package, phone service or shared-review service
has been restarted or deployed. The three longer quiet mates from adapter 104,
the connected capture-choice mechanism, broader causal/nature disagreements,
and native runtime reliability remain open. This milestone is not completion
of the broad accuracy goal.

Previously stored shared-service cards are not automatically reanalysed by this
source milestone; the service regression verifies newly created cards and
their reload. Desktop motif-version migration remains its existing reveal-time
path. Saved imports and owner data are not rewritten.
