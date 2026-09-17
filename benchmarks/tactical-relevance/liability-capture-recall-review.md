# Captures retained through concrete counterattacks

Adapter **148 / live pipeline 155** recovers a missed pawn capture from a new
three-game owner sample. It also explains a countercapture alternative in an
older game without replacing the stronger main move. These are bounded local
material lessons, not claims that every apparently loose pawn is free.

## Chess review before and after classification

The new sample contains all 138 pre-move contexts in three June games, selected
in archive end-time order with previous game IDs excluded. Selection did not
filter by evaluation, tactical tags or classifier output. Initial notes remain
separate from corrected judgements and fresh engine analysis.

The review corrected several initial human omissions: moving a pawn had left
a knight undefended, a rook was relatively pinned to its queen, and a checking
queen capture actually lost that queen to a knight. The classifier already
found those mechanisms. A different apparent missing capture merely recovered
an earlier pawn loss; it was not counted as a new recall defect.

The genuine omission is **...Nxd4**, gaining a pawn while attacking a bishop.
The earlier verifier charged an off-square knight capture without considering
the counterattack. Its connected fallback then failed against Qh5: taking the
bishop allows Qxf7#, whereas ...Nxh5 removes that concrete mating threat.
Bishop retreats can instead require ...dxe4 to remove the pawn threatening an
off-square knight. Every admitted defence has a checked response; arbitrary
captures elsewhere cannot finance the claimed gain.

The recovered bound is 100 cp of local material. A fresh restricted Stockfish
search estimates +191 cp for Black for the whole position; those are different
quantities. The live lesson says Material Gain, shows the capture and bishop
counterattack, and mistake review explains the missed opportunity. It does not
claim a fork or blame the preceding move without a defensive comparison.
Later superficially similar ...Nxd4 positions remain unproved: a knight can
recapture on d4 and the resulting exchanges require other continuations.

An older root also gains an **Nxc6** alternative: after ...dxc6, bxa5 recovers
the attacked bishop. The alternative gets its own capture/counterattack and
actual-ply Countercapture Payoff. The stronger immediate bxa5 remains the main
lesson; the owner played it, so no missed-move blame is added.
Fifty-one additional fresh searches inspect this certificate's root and selected
answers: the root is +377 cp for White and the lowest selected finite-depth
estimate is +322 cp. Its separate local material bound is only 150 cp.

## Admission and contrary evidence

- Existing successful connected-capture proofs run first. Only failure may
  spend the remainder of the original shared 4,096-operation allowance on
  liability-removing captures. There is no extra search budget or deadline.
- A participant is nominated only when it has a legal profitable capture
  threat. An ally may collect an original counterattack target or remove that
  participant. All-friendly-piece liabilities and countercheck verification
  still apply. Incomplete work abstains.
- New-mode leaves record their exact legal paths. If a branch recovers the
  piece that just captured an ally, that earlier loss is debited before the
  branch can establish a new generic material gain.
- This accounting fixes a draft regression: Bxf6 after ...Bxc3 had incorrectly
  borrowed later Rxc3 recovery to label an ordinary exchange as a new win.
  Existing zero-valued Countercapture lessons are preserved.
- A proved same-ply Deflection suppresses only a duplicate, no-stronger generic
  material badge. Specific mechanisms and connected later payoffs remain.
- A diagnostic trial allowing unrelated captures is retained as diagnostic
  evidence, not production admission. An always-expanded draft also changed
  an older checking-flight case; production preserves established proofs and
  leaves that unresolved case withheld under the original budget.
- Constructed missing-bishop and missing-defensive-knight controls withhold
  the new certificate in both colours. This does not declare the whole
  positions non-tactical or losing.

## Verification scope

The final 177-search engine review covers the new owner certificate, an
explicitly constructed pawn-shifted variant, its colour reflection and the
older withheld root. Every selected checked move has a positive finite-depth
estimate or winning mate. These overlap in positions and are not 177 separate
puzzles. Earlier 11-decision, 55-diagnostic and 308-draft searches are retained
separately; the broad diagnostic is not a shipped certificate.

The complete source replay covers **1,319 contexts in 27 games**, including
the new 138 contexts. Exactly three full rows change: the older alternative,
the new missed capture and its preceding after-move classification. Only the
new capture changes a live principal headline. All 246 private course full
results and twenty rare-theme results remain unchanged in the final replay.
Neither unchanged nor empty outputs are counted as correct answers.

The selected source suite passes **2,722 tests**, with 309 conditional skips,
including the explicitly expected queen-ending promotion coverage failure.
The generated review service passes 23 checks with one optional engine skip;
the new check preserves the missed capture through saving, reloading and deck
explanation. The React regression checks one relevant label and starting-board
arrows only. Type checking, scoped lint and review/frontend builds pass.

All **2,139 compiled-controller inputs** pass: 808 public cases, the complete
1,319-context owner replay, two new reflected capture inputs and ten existing
connected-capture controls. Every owner scan matches source and its frozen final
replay; all 808 prior public primary lists remain unchanged. Public computation/
transfer median/p95/max is 43/211/1,099 ms; owner values are 94/387/2,157 ms.
These exclude engine search and rendered/native UI. The original twenty-second
startup and three-second classification deadlines are unchanged. Two development
cache/recovery scenarios also pass; the harness requires Node's
`--experimental-vm-modules` option. An initial invocation without that option
failed before exercising the worker and was corrected.

The tested artifact is `liveTactics.worker-KAHpOqsu.js`, 592,540 bytes, SHA-256
`d2a28e6f4424f2010a4dca3ce71240f2e0281440adb51bf9c97b7ca4321fc50d`.
Clean desktop delivery is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
Broader recall, quiet preparations, longer combinations, the known queen-ending
promotion and native interaction/load-sensitive startup remain unfinished.
No owner data or phone service is changed by this milestone.

## Private receipts

Reports under `Documents/OnCrescent Tactical Benchmarks/` use the
`liability-capture-` prefix and date `20260917`: `owner148-release`,
`tests148-release`, `private148-release`, `rare148-release`,
`probes148-final`, `engine148-final`, `alternative148`,
`alternative-probes148` and `alternative-engine148`. The `chesscom-june-third-three-`
sample/baseline and `june-third-reviewed-judgement-20260917.md` preserve the
selection, initial hypotheses and corrections. Earlier failing drafts remain
separate. Owner game records and paid-course content stay outside Git.
The compiled receipts are `public-worker148-final` and `owner-worker148-final`
with the same prefix/date. The final private/rare reports exactly match the
reviewed reports and preserve the complete adapter-147 chess outputs.
