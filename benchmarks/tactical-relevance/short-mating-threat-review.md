# Short mating threats and legal check evasions

Adapter **137 / live pipeline 143** recovers quiet attacking preparations
without accepting a hypothetical threat or a supplied engine continuation as
proof. This is another recall milestone, not completion of the accuracy goal.

## Chess findings

The owner's **Rg3** prepares **Rh3+**, mating on the following attacking move
if Black does nothing. The previous detector nominated only mate-in-one
threats. It also refused quiet king evasions inside an attacking continuation,
so a check such as ...Re8+ could hide the genuine attack.

The new root certificate covers all 21 legal replies, consumes 2,523 of the
unchanged 8,192 operations and retains a 130-cp local material bound. Some
branches mate; ...Bxg4 can instead be answered by Rxg4, while a checking rook
can concede other material. This is **Mating Attack**, not a claim that the
engine's long mate distance has been independently proved or that 130 cp is
the full-position evaluation. Root arrows are only Rg3 and the Rh3 threat.

Rg3 was actually played, so it is not a missed move. The preceding move gets
a neutral tactical-position explanation: the available comparison still does
not prove that the better defence prevents or reduces this attack. A newly
recognized motif must not manufacture a mistake cause.

The wider replay also recovers two previously empty public Lichess roots:

- **0z5nl, Kh3** prepares g4+ and a mating pawn sequence. The verified mixed
  material-or-mate bound is 100 cp, not a complete mate-in-four certificate.
- **0QPvf, Rb8** prepares Qxg8#. Legal quiet king evasions preserve the attack
  against the rook's counterchecks; the local bound is 500 cp.

These are reused CC0 development examples, not two new held-out games. Fresh
Stockfish searches find mate in four in both roots and colour reflections.
The classifier's weaker Mating Attack explanation is a recall improvement,
not ideal distance/outcome specificity. The old empty-result assertions were
retained until the changed proofs and independent engine decisions were checked.

## Scope and safeguards

A checking mate-in-two threat is independently established on the hypothetical
pass board before it can nominate a preparation. Every actual legal defence
must still permit the existing connected material-or-mate proof. A legal quiet
check evasion or the exact nominated threat can occupy one of the existing
three attacking continuation slots; neither creates extra depth or a free pass.
Material leaves retain all-friendly-piece liabilities and countercheck checks.

Existing mate-in-one nominations run first. Nested preparation probes keep
their previous scope under their parent's shared budget. An earlier draft
spent that budget on expanded quiet replies and lost the ...Rb6+ certificate;
the final implementation restores that result without raising the budget.
Longer or differently prepared threats and exhausted searches remain gaps.

The public constructed controls preserve contrary evidence:

- Moving the attacking king to f1 permits ...Rxf6+ and queen-for-rook
  liquidation. The first test incorrectly assumed this was another positive.
  Stockfish instead drops from +724 cp for the best move to +262 for Rg3;
  the absent new-gain/mate certificate is justified, even though White remains
  better. Reflected finite scores need not be identical.
- An added knight can take the queen; the held rook lift is losing.
- A pawn can obstruct the threat and take the rook. The position may still
  be winning, but this is not the claimed short mating mechanism.
- An already available short mate does not justify an unrelated pawn move.
- An announced fifty-move claim blocks the affected quiet attack.

## Whole-game, course and engine review

All 720 frozen owner contexts are replayed with their exact engine inputs and
complete histories. Eighteen full rows change, but only **one principal live
headline** is recovered. Adjacent contexts of the same Rg3 and other actual-ply
secondary attacks are not independent discoveries. The previous ...Rb6+
recovery remains intact. The version-final replay is behavior-identical to the
audited draft, excluding version and timing fields.

Of 246 private course/game inputs, only one full scan changes: an alternative
line gains Qh5's mating threat at ply 3. Its main theme and source result stay
unchanged. All twenty rare-theme full results stay unchanged. Stability and
empty results are not correctness or accuracy rates; paid data remains private.

The selected private audit covers every new displayed short-threat mechanism
on its actual reached board: four distinct owner boards and that one course
continuation. Its 472 fresh depth-16 searches cover roots, all first replies,
selected attacking decisions and explicitly hypothetical threats. The four
owner mechanisms have minimum finite attacking-side estimates of +831, +1045,
+860 and +1043 cp. The course continuation includes a weaker +49-cp exchange
witness despite its +604-cp root: local pawn retention is not preservation of
the best full-position evaluation, and strongest-witness selection remains a
limitation. No adverse selected estimate was hidden.

Public constructed decisions and controls add 490 fresh searches; the two
reused Lichess roots and their reflections add 256. Receipts distinguish real
positions, constructed variants, repeated roots and finite estimates. These
are 1,218 searches, not 1,218 independent puzzles or an accuracy score.

Public receipts: `short-mating-threat-stockfish-18.json` and
`short-mating-threat-recall-stockfish-18.json`. Private probe, engine, replay
and worker receipts are under `Documents/OnCrescent Tactical Benchmarks/`,
prefixed `short-threat-`; earlier `quiet-attack-` diagnostics preserve the
rejected nested-search draft and original nomination failure.

## Verification and delivery

The new regressions cover both colours, actual legal defence enumeration,
root-only versus full input, board geometry, played-best non-accusation,
budget/cache isolation and exact engine-receipt correspondence. Both real and
constructed positives fail to obtain the certificate in the committed
adapter-136 implementation. Rendered component checks retain qualified threat
wording instead of promising forced mate.

The broad 141-file source selection passes 2,070 checks with 254 conditional
skips; the separate new-proof/rendered selection passes 98 checks with five
optional skips. These selections overlap, so their counts are not added.
Thirteen generated-service checks pass with one optional engine skip,
including a missed short attack surviving storage and reload. Its synthetic
scores test wiring, not chess strength. TypeScript and scoped lint pass.
The 43-module shared-review and 8,877-module primary frontend builds pass;
that frontend includes unrelated local changes and is not the desktop source.

The production controller passes **1,540 inputs**: 720 owner contexts, twelve
constructed/reflected controls and 808 existing public inputs. All match the
source result. Owner computation/transfer median/p95/max is **86/379/1,622 ms**,
with maximum Node-bridge startup 187 ms. Engine search, HTTP loading and native
UI are excluded. No production deadline increased. The owner/control groups
take 179 seconds; the public group takes 112 seconds under its existing bound.
Worker `liveTactics.worker-D9o_-k7_.js` is 570,751 bytes, SHA-256
`7e665f1de25536dbe5833ac8f1c967f87103e9c00092a3244f46c58cfa900b5c`.

Clean desktop-package delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. Native-window interaction and historical
load-sensitive startup remain unverified. Broader recall, stronger witnesses,
exact longer-mate outcomes and primary-theme specificity remain incomplete.
No owner data, engine settings, shortcut or phone service changes here.

Source `eac63588` is now in the clean standalone desktop executable. The native
build passes, the worker hash matches the tested artifact, and embedded assets
and normalized dependencies identify the clean live/review UI. The previous
executable is backed up; no owner app was started or restarted. Exact identity
and recovery are in the linked desktop delivery record.
