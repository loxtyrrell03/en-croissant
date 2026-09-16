# Capturable counterchecks must not erase a real checking attack

Adapter **136 / live pipeline 142** recovers a missing checking attack in the
owner-game corpus without increasing proof budgets, engine depth or runtime
deadlines. It changes the common bounded checking-attack verifier, used by live
themes and mistake explanations, not only a fixture-specific detector.

## Chess finding

The reviewed Re4 permits **...Rb6+**. Black can force a material concession
through different checking routes; one is ...Rb6+ Kc3 Rc6+ Rc4 Qc1+ Kd3 Qxc4+.
The old verifier rejected some other branches because White could check again,
even when the checking rook could simply be captured safely. That is not a
refutation of the material win. The former search exhausted its unchanged
32,768-operation limit; the recovered certificate uses 30,433 operations and
has a 500-cp local material bound.

The live position now leads with **Forcing Attack**. Its supplied principal line
retains **Skewer** at ply 5 and the capture payoff at ply 7, without future arrows
on the root board. **...Qd2+** is a separately proved alternative in the same
position, not a second independent game or discovery. Re4's review now explains
the allowed attack; Black's subsequent ...Rc6 receives the missed-opportunity
lesson. The better Re7+ interrupts this immediate attack.

Six fresh decision searches support those comparisons: White's before/best and
held Re7+ estimates are -65/-54 cp, held Re4 is -585; Black's best is +589,
held ...Rc6 is +55, and White's best after ...Rc6 is -51. These separate finite
searches are full-position estimates, not a single exact minimax tree or the
classifier's local 500-cp bound.

## Narrow relaxation, retained safety checks

After a material payoff and one answer to a countercheck, a further checking
reply is allowed only if a **legal capture of its actual checker** retains
the required material. The capture must leave no further immediate check or
promotion, and must account for legal recaptures and capture liabilities of
all friendly pieces. Non-mating terminal positions are rejected. Every such
checking reply needs its own capture witness; their moves remain in the proof
decision receipt. The smallest branch bound is retained, so an optional rook
sacrifice cannot inflate the original guaranteed gain.

This is a bounded tactical check, not full king-safety or quiet-counterplay
analysis. Longer attacks, further checking sequences and exhausted searches
still abstain. Search ordering and all existing operation limits remain.

## Independent engine review and contrary evidence

There are **382 fresh Stockfish 18 depth-16 searches**:

- 124 covering both recovered real roots, every first defence and all retained
  attacking decisions; the smallest non-mate estimate is +504 cp for Black.
- 38 covering the changed decisions in an existing discovered-check lesson
  and a later checking-pawn attack; every retained answer remains favourable.
- Six before/played/best comparisons described above.
- 214 constructed/reflected branch and control searches, recorded in
  `countercheck-capture-stockfish-18.json`. Public fixtures are constructed,
  not additional owner games or a held-out accuracy sample.

The old implementation fails to establish both constructed positive combination
certificates; the new one proves a rook bound in each colour. A knight able to
take the checking rook supplies a genuine contrary control: held ...Rb6+ is
-574 cp (reflected -455), and the certificate remains absent. Other protected-
checker, off-square-liability and promotion controls remain outside the bounded
proof, but their roots can still be winning. They are **not** correct-negative
accuracy successes. A cheaper existing single-target proof also gives only a
pawn bound in one constructed live result despite the stronger independent
combination; choosing the strongest available certificate remains a limitation.

## Whole-game and shared-consumer verification

The final **720-context** replay uses exactly the prior engine inputs and full
histories. Five report rows change: the recovered board and preceding mistake,
two adjacent contexts of an existing discovered check whose selected branch
changes, and one later conditional explanation. Only the recovered board gains
a new live primary; no other main theme changes. All 246 private course/game
and twenty rare-theme full results remain identical apart from version metadata.
These are development differentials, not representative accuracy estimates.

The 15-file focused selection passes 317 checks with eighteen optional skips;
the generated shared-review service passes twelve checks with one optional
engine skip. TypeScript and seven-file lint pass without errors or warnings.
The 43-module shared-review and 8,877-module primary frontend builds pass;
the latter includes unrelated work and is not the desktop package source.
The actual compiled controller passes **732 inputs**: all 720 owner contexts
and twelve constructed/reflected controls. Source and worker outputs match.
Owner computation/transfer median/p95/max is **82/317/1,286 ms**, with maximum
Node-bridge startup 37 ms; engine searches, HTTP loading and native UI are
excluded. The two groups complete in 168.79 seconds under unchanged production
deadlines. Worker `liveTactics.worker-C_l_V99-.js` has SHA-256
`2ff9ca9a1101fab5e7cd5ecc67535e44da3c16512c37db2de771bae8fcce59e8`.
Clean desktop delivery is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`;
this is not native-window interaction or load-sensitive startup certification.

Private receipts remain under `Documents/OnCrescent Tactical Benchmarks/`:
`checking-attack-recall-selected-{draft,probes,engine}-20260916.json`,
`checking-attack-{changed,cause}-{probes,engine}-20260916.json`,
`countercheck-{constructed,contrary}-{probes,engine}-20260916.json`,
`checking-attack-owner136-20260916.json`, `checking-attack-worker136-20260916.json`,
and the private/rare draft replays.
Long quiet mating attacks, other checking plans, endgame liquidation causes,
automatic extra review candidates and broad primary-theme accuracy remain open.
