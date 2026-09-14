# Preparation safety and choosing the stronger connected line

Adapter 106 / live pipeline 111. This is a verified source/build milestone,
not a deployment or a claim that primary-theme selection is universally correct.

## Real errors, not just agreement with puzzle tags

In [Lichess NGZzo](https://lichess.org/7lzGil6H/black#64), Nd7 attacks a rook
and threatens a checking queen fork. Double Threat is a useful root lesson;
the later Nf6+ belongs at its actual ply. But the old proof had unsafe answers:

- After ...Bd3, it selected Nxb6, allowing ...Qe2 mate.
- A fresh engine audit exposed another: ...Rc8 Nxb6 allows ...Rc2+ followed
  by ...Qe2 mate. Checking only immediate mate was insufficient.
- Against ...Rbb8 and ...Rab8, it accepted the first exchange it found.
  Fresh searches evaluated those selected continuations around equality,
  although the connected Nf6+ fork was stronger.
- After ...Qd1, Rxd1 captures the original queen victim with a different
  piece. The old restriction unnecessarily excluded that legal payoff.

The final proof selects Nf6+ against both mating preparations and both rook
retreats, and Rxd1 against ...Qd1. All 35 immediate legal defences remain
covered. The bounded local minimum changes from 180 to 250 centipawns of
material: ...Rbxa6, Nf6+ Kf8, Nxh5 gxh5 exchanges a bishop and knight for a
queen, a nominal 900 - 330 - 320 = 250. This is not the position's engine score.
The original root and actual-ply secondary fork remain; the starting board
does not acquire arrows from a future knight square.

The other retained real example,
[Lichess fJrhT](https://lichess.org/l8sSle4i#89), keeps Rb1+ as Fork Preparation:
king movement permits Nd3+, while Rc1 permits Rxc1+. Its two legal root
defences still have separate connected answers.

## General change and adversarial controls

Quiet double threats and checking preparations now debit losses of **all**
friendly pieces at their capture/fork payoffs, not only the attacker. Mate,
draw and immediate promotion resources are checked. A checking reply after
the payoff needs a legal material-retaining answer which does not allow
immediate mate or promotion. Both paths fail closed for invalid/exhausted
budgets, including NaN and Infinity; default budgets remain 8,192 and 4,096.
The newer capture-preparation path retains its separate recovery mechanism.

An ally may capture an original victim that has moved onto its capture square.
Unrelated captures elsewhere cannot fund the combination. Among verified
direct captures and connected checking forks, the double-threat proof now
selects the larger local bound rather than the first successful branch.

The [development sample](preparation-safety-development.json) contains two
retained real roots and five constructed variants, each also colour-reflected:

| Control | Reviewed outcome |
| --- | --- |
| Extra exposed queen | Withhold the old double-threat certificate; capturing the advertised rook can lose the queen elsewhere. |
| Extra rook | Preserve the genuine double threat through an allied Rxa6, instead of the old fork witness which overlooks Rxa1. The initially proposed ...Kg7 resource was illegal after Nxh5+; legal ...Kf8 is retained in the test. |
| Bishop counterattack | Bxe5 both attacks the queen and answers Nf6+. The old rook-taking witness loses material; the root preparation is withheld. |
| Advanced pawn | ...a2 creates a concrete promotion resource that the old certificate ignored. The bounded proof abstains. |
| Checking preparation with exposed queen | The advertised knight-fork payoff ignores Rxa7. Withhold that preparation certificate. The whole position still has other mating play. |

These are mechanism checks, **not five independently sampled accuracy cases**.
Several withheld positions remain winning, and the promotion can sometimes
be met by a capture. Withholding an unsound certificate is not proof that the
position has no tactic. In particular, the extra-queen checking example has
an engine mate with a different continuation; broader mating coverage is not
declared solved. The extra-rook example explicitly prevents over-filtering a
genuine combination. The retained adapter-105 implementation fails 20 of the
31 new ordinary checks; the final implementation passes them.

## Engine review and wider positions

[104 final fresh public Stockfish 18 searches](preparation-safety-stockfish-18.json)
include both unrestricted/held-fixed roots, all 72 selected root-defence
answers for the three positive examples, and contrary resources. Every PV
is legally replayed. Final selected public answers have positive engine
evaluations; this is corroboration, not a mathematical local-material proof.
Earlier 69- and 104-search development audits are retained privately as
contrary evidence, including the mating answer which triggered the refinement.

Another 23 fresh private searches check two changed continuation certificates,
including held-fixed payoff captures rather than just unrestricted engine moves:

- `private-easy:21` gains a source-line Fork Preparation at ply 7, not at
  the opening root. The actual ply-9 fork remains. The engine prefers a
  different continuation after that fork but also validates the nominated
  rook capture as winning; the engine PV is not the proof.
- `engine-game:6:ply32` retains its later preparation but reduces its bound
  from 320 to 220 because the opponent can capture a pawn elsewhere. Its
  whole-position evaluation can be near equality despite this local gain.

All 246 retained tactical/course/positional/game-phase primary lists are
unchanged. Exactly those two full results change; the other 244 remain
unchanged apart from version. All 20 rare-theme primary lists are unchanged;
only NGZzo's full result changes. Existing interference, deflection, trapped
pieces, promotion, exact endgame/zugzwang and ordinary-opening controls remain
in the selected suite. All 32 frozen primary-priority judgements match.
Stability is not an accuracy estimate; this pass is not a new representative
sample of all chess positions.

## Verification and delivery

- 2,123 selected tests pass; 88 optional/environment checks are skipped.
  The two explicit audit exporters and fresh-engine runs are checked separately.
- 18 production-controller groups pass with 1,407 inputs, including 28 new
  preparation inputs spanning both colours and root-only/full continuations.
- The [899-input public worker receipt](built-worker-adapter106.json) records
  65/212/821 ms median/p95/maximum, excluding engine and rendered UI. The
  maximum computation/transfer measurement is 797 ms. All 808 retained and
  63 prior game-context headline lists are unchanged.
- 81 cold HTTP cases pass. First/next worker startup is 1,507/66 ms; maximum
  startup is 2,014 ms, computation/transfer 1,371 ms. Separate server startup
  is 2,824 ms. The 20-second startup and 3-second classification deadlines
  are unchanged. Earlier cold-start variability remains relevant.
- Type checking, six-file lint, the 42-module shared-review build and
  8,874-module app build pass, as do four service and two development-cache
  tests. Existing bundle-size warnings remain.
- Twelve existing real React/Chrome capture-choice renderer groups pass
  across 1100/760/360px and 100/200% text, including save/reload. This is a
  regression smoke check, not a new full native Tactics interaction test.

Production artifact: `liveTactics.worker-xovwLfyQ.js`, SHA-256
`39642227b18e76f567d042e7495b3a08c01b1c6b41246db1a82200276a187710`.

Private receipts live in the existing local tactical-benchmark directory:
`adapter106-selected-replay.json`, `rare-theme-adapter106-selected.json`,
`adapter106-selected-preparation-stockfish.json`,
`adapter106-private-continuation-stockfish.json`,
`adapter106-private-payoff-stockfish.json`,
`built-worker-adapter106-selected-private.json`,
`adapter106-game-worker-selected.json`,
`adapter106-preparation-worker-selected.json`, and
`adapter106-cold-http-selected.json`. Paid positions remain private.

The capture safety horizon answers one countercheck and checks the resulting
immediate mate/promotion resources. It does **not** certify against arbitrary
longer king hunts, perpetual checks or non-checking strategic compensation.
A stricter multi-check experiment withheld the genuine root and was not
shipped as an accuracy improvement. Full-position scores cannot fill those
proof gaps. The earlier connected capture-choice mechanism, nature-classifier
disagreements, broader primary/rare/quiet coverage and native-runtime
verification remain open. No owner app/service restart, installation or
deployment was performed.
