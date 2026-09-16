# Capturing mating threats with material-concession defences

Adapter **140 / live pipeline 146** recovers a nonchecking capture which
threatens mate but permits the defender to give up material to remove a mating
guard. A mating attack need not win a whole minor piece against every defence.
The existing short, all-defence verification remains mandatory.

## Real-game judgement

In the reviewed owner ending, **...Rxc3** threatens **...Rh3#**. The knight on
h7 and pawns on f5/g4 help contain the king. **Rxh7 Kxh7** removes a mating
guard at the cost of the exchange; **Rg7+ Kh8 Rxh7+ Kxh7** also concedes it.
Some king-flight branches instead permit another pawn capture. The finite
certificate therefore establishes a minimum local gain of two pawns, not the
exchange on every branch and not the entire engine evaluation.

The old proof rejected Rxh7 because the king recapture did not recreate the
original mate threat. Its fixed three-pawn threshold also excluded the genuine
smaller concessions. The new primary is **Mating Attack**, with root arrows
c8-c3 and c3-h3. The rook-for-knight recapture remains a secondary explanation
at its actual later ply, not an arrow on the starting board.

The owner actually played Rxc3: this is a recovered position lesson, **not a
missed opportunity**. The preceding Kh4 now has an allowed-attack explanation.
Fresh Stockfish gives Rg7+ -747 cp held (-752 unrestricted) and Kh4 a forced
mate against White. White was already losing; this identifies the immediate
attack enabled by Kh4, not the first cause of the game's loss or a claim that
Rg7+ saves the game. The local bound cannot certify Stockfish's long mate.

## Rule and contrary evidence

All existing successful strategies are tried first. Only after their failure
does a nonchecking capturing mate-in-one threat try the additional concession
strategy. It uses the same remaining **8,192-operation budget**, legal defence
enumeration, liabilities, countercheck answers and draw/promotion safeguards.
Nested shared-budget preparations and mate-in-two threat nominations do not
receive this extra fallback. Worker and engine deadlines are unchanged.

The minimum gain must exceed every immediately available pre-move capture,
with at least a pawn retained. An actual first defence capturing an essential
mating guard may be answered by another allied piece, including the king.
Removing the exact guard must break the nominated mate, and the actual defence
must parry it. This geometric probe only connects the recapture to the threat;
the legal, complete defensive tree separately proves its material safety.
The exception is keyed to the exact first-defence position, not any later
enemy arriving on an old guard square.

Four constructed cases, reflected in both colours, check the mechanism:

- The ordinary mate-or-exchange-or-second-pawn case proves 200 cp locally.
- Removing the second pawn **does not refute the tactic**. Kh5 is answered by
  Rh3+ Kg6 Rf6#, and the surviving material bound is 280 cp. This corrected an
  initially wrong negative hypothesis, rather than weakening an expectation.
- A bishop protecting the rook on h7 makes Kxh7 illegal. The engine finds a
  drawing resource and the new mating-attack certificate is withheld.
- Removing the f5 guard opens a king flight. The nominated mate fails, although
  the overall position still evaluates favourably. This is not a negative
  judgement about every possible tactic in that position.

## Broader effects and engine checks

The exact **720-context** game replay changes five full rows, not five newly
solved tactics. Besides the root and preceding cause, two continuation captures
gain actual-ply mating-attack explanations: Qxd6 at ply 9 in a third candidate,
and Qxf7 at ply 2 after Rxf7. The latter appears in two adjacent review contexts.
The existing Fork Preparation and missed/allowed checkmate headlines remain
unchanged. Later attacks do not become starting-board arrows or new causes.
The other 715 full results, all 246 private course/game results and all twenty
rare-theme results are unchanged apart from versions. Stability is not accuracy.

There are **563 completed fresh depth-16 Stockfish searches** in three receipts:
72 initial decision checks, 439 root/defence/strategy checks, and 52 follow-ups.
Exact request identity, FEN, held move, depth and legal PV replay are checked.
Every one of the 194 selected attacker decisions across seven proved strategies
has a matching fresh positive engine result. These are finite-depth estimates,
not proofs that the selected answer is optimal or that all longer counterplay
has been excluded. Owner Rxc3 is mate in 16 in the final held search; the two
reached continuation roots score +608 and +1276 cp, separate from local bounds.

The public receipt contains 372 constructed searches only. Owner boards and
the complete private receipts remain under `Documents/OnCrescent Tactical
Benchmarks/`, with the `capture-threat-` prefix. The first incomplete request
format, draft hypotheses and final records are retained separately. Early engine
receipt classifier-version metadata predates the version bump; only its engine
lines are evidence, and current source/worker classifications are replayed anew.

## Verification

The complete utility selection has **3,100 passes and two failures** in the
unrelated store tests: jsdom's unimplemented audio play promise and an existing
`timestamp: undefined` strict-object mismatch. Both reproduce unchanged in the
previous clean shipped checkout `1daac633`; they are not silently called green.
The focused source/rendered selection passes 44 tests (four optional skips).
Types, scoped lint, 15 generated-service checks (one optional skip), two
development bundle/cache recovery tests, the 43-module review build and the
8,877-module primary frontend build pass. Private and public engine request
receipts are reconciled separately; overlapping test counts are not additive.

All **1,536 production-controller inputs** pass: 720 owner contexts, eight new
constructed/reflected cases and 808 public inputs. Classification/transfer
median/p95/max is 87/346/1,554 ms for owner contexts and 43/215/1,194 ms for the
public set. These Node-host measurements exclude engine work and native UI;
some checks overlapped other tests and are not a latency improvement claim.
The unchanged three-second calculation bound holds. The tested worker is
`liveTactics.worker-D8llfFHh.js`, 573,699 bytes, SHA-256
`1e52d239175bce1b520d96cd31769592f8016493a708e0a1bd5264047c83b616`.

The forced-cold HTTP audit **failed at the 20-second startup deadline** before
any result, with its sole bundled-module fetch still pending. This is not a
classifier computation failure and is not certified fixed. After the child
test exited and its listener closed, the owned test-server process remained
stuck in shutdown and was stopped by its verified process identity. No owner
app or phone service was stopped. The failed receipt is preserved as
`capture-threat-cold-http140-20260916.json`.

## Remaining limits

Longer mating outcomes, quiet preparations, incomplete or interrupted exchange
history and broader candidate recall remain open. This does not change the
persistent-pawn policy: two other inspected pawn captures remain unclassified
pending a sound separation of earlier unrelated losses from compensation.
No general accuracy percentage or native-window reliability is established.
Desktop package delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`; the overall goal remains active.
