# Capture attraction: a real missing root, not a simple trapped bishop

This audit retains **adapter 161 / live pipeline 168**. It investigates one
previously selected owner-game opportunity in the existing 30-game / 1,551-context
corpus. It neither adds a new game nor claims a recovered classifier result.
Owner positions, identities and full engine receipts remain private.

## What the chess establishes

The omitted **Bxa6** exchanges a bishop for a knight and draws the other bishop
onto a6. **Qc6+** then opens a rook attack; after the king moves, **b5** attacks
the attracted bishop. Calling this simply a trapped bishop is incomplete:

- **...Bc8** is a legal escape. It blocks the queen's defence of the rook,
  allowing **Qxa8** instead. The intended explanation must include this
  connected self-interference, not assert that the bishop has no escape.
- **...Bb7** permits Qxb7; **...Bxb5** permits Qxb5 but costs White the pawn.
  That compensation must be included in a root material value.
- After **...Qe8**, taking the bishop immediately loses the queen. Exchanging
  queens first keeps the bishop opportunity. The pawn collecting the bishop
  was also guarding the queen, so a pre-capture scan alone misses this liability.
- A checking **...Ba3+** needs a king evasion. After one king retreat and a
  subsequent queen move, the superficially obvious bishop capture allows
  **...Qb4+ followed by ...Qb2#**. The fresh engine instead finds a winning
  checking attack. A related supporting knight move supplies a later blocking
  defence; a different rook reply even permits immediate mate.

These branches require material **or mating** responses, defensive repairs and
correct move order. An overall winning score cannot certify the proposed
bishop capture on each reached board.

Premature Qc6+ before the exchange permits Bxc6 and evaluates -514 cp in a
fresh held search. The held Bxa6 root is +305 cp and the played b5 is -208 cp.
All three legal answers to Qc6+ were searched separately, including the king
flight omitted by the displayed principal line. Holding b5 after that other
king flight gives +351 cp. These are finite-depth, White-relative estimates
from separate searches, not one consistent minimax/material bound.

The declined-offer ...d4 branch also corrects an initial hypothesis: Qa3 is
sound in the fresh search (+329 cp), but Nxd4 is stronger (+656 cp). That
capture answers the actual pawn attack on the queen while leaving the offered
bishop and its delayed acceptance to be accounted for.

## Why the current proof stops

The opt-in diagnostic records complete legal replies and exact failures:

- The root capture-preparation routes reject the accepted exchange: they
  establish neither a direct checking fork nor their supported discovery.
- The reached b5 trap proof rejects **...Bc8**, correctly under a definition
  requiring the named bishop itself to be lost.
- Supplying the bishop and rook as named targets to the existing connected
  capture verifier still fails on a defensive queen move. Doubling its 4,096
  allowance to 8,192 does not fix it: this baseline failure uses only 211 visits.
- The Qc6+ capture verifier stops after 13 visits because a king flight requires
  another quiet preparation. This is a search-language/connection gap, not
  evidence that simply increasing node limits will restore the root.

An experimental extra exchange/defensive-repair route was withdrawn entirely.
It did not establish all replies, and the fresh mate-in-two counterexample
shows why accepting convenient material leaves would be wrong. Its private
patch and failed receipts are retained for investigation, not shipped code.
The final diagnostic reruns against unchanged production source.

The next implementation needs to connect the legal escape concession to the
original attack, include the actually required exchange/king/knight repairs,
allow independently established mating branches, and then prove the initiating
capture through both acceptance and all declines. A later b5 label alone would
not finish the missing Bxa6 explanation. No opponent mistake cause is established
merely by this audit's engine score difference.

## Verification and reproduction

- **81 fresh depth-18 searches:** 69 root/stage/legal-defence requests and twelve
  follow-ups checking move order, king choices and the contrary mating branch.
- Independent python-chess replay reconciles every exact request, held root,
  depth and SAN/UCI line: **214 lines / 3,769 moves**. It verifies the complete
  **30 / 3 / 31** legal-reply sets and the escape's rook-guard interference.
  Chessops king-to-rook castling is normalized through legal move parsing; an
  initial raw-UCI set comparison failed on this representation difference.
- Final selected tests: **19 passes, two conditional skips**, including the
  opted-in diagnostic and existing pin/perpetual checks. Whole-project types
  and scoped lint pass. This is not a broad replay or an accuracy percentage.
- Production classifier source is unchanged. The current clean standalone
  package remains source `9e99287a`; no app, service, owner store or saved review
  was changed. There is no new package or native-interaction claim.

Run `src/utils/tests/captureTrapRecallAudit.test.ts` with
`TACTICAL_CAPTURE_TRAP_INPUT` pointing at the private frozen owner report,
`TACTICAL_CAPTURE_TRAP_IDS` containing the selected row IDs, and a fresh private
`TACTICAL_CAPTURE_TRAP_REPORT` path. Optional `TACTICAL_CAPTURE_TRAP_TARGETS`
maps move UCIs to named target squares for bounded diagnostic trials. Full
promotion replies are retained. Report creation is exclusive and uses the
existing private-path guard.

Private receipts in `Documents/OnCrescent Tactical Benchmarks/`, dated
`20260918`, are `capture-trap161-baseline`, `capture-trap161-engine`,
`capture-trap161-followup-engine`, `capture-trap161-independent`, and
`capture-trap161-final-audit`. Intermediate `combination`, `exchanges`,
`deferred-liability`, `repairs-draft`, and `failed-captures` reports describe
unsuccessful experiments; `capture-trap161-withdrawn-repairs` stores the patch.
The source opt-in engine runner is the existing private-decisions test in
`tacticalJudgement.test.ts`. No paid course or owner FEN/PGN is committed.
