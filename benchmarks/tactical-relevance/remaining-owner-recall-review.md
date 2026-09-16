# Remaining owner-game recall: quiet retention and mixed checking attacks

Adapter **120 / live pipeline 125** is unchanged by this audit and is now in
the standalone desktop package. This continues the same six-game owner sample,
not a replacement corpus or an accuracy benchmark. The two examples were chosen
after inspecting existing missing outputs; this is explicitly development work.

## A missing pawn capture is not just a missing exchange nomination

The first game's ply-42 Qxc6+ remains unexplained at the root. Its preferred
line contains Qa8+ rather than an immediate queen exchange. The initial
hypothesis was that the exchange-only nomination gate caused this omission.
Enumerating the legal equal interposition and supplying Qd7 Qxd7+ directly
still produces no certificate: the separate **Rd7** defence has no acceptable
immediate capture or protected checker retreat under the existing rule.

Nine fresh depth-16 searches include the root, every one of its five legal
checking replies, and unrestricted/held queen-exchange choices. Held Qxc6+
is -569 cp for White; the immediate exchange after Qd7 is -615 versus -555
for the unrestricted answer. Against Rd7 the engine chooses the quiet allied
**Rd1** (-444). Other replies allow taking the rook or further checking play.
These are finite-depth full-position estimates, not local retention bounds.
White is already losing; a pawn opportunity is not a claim of a winning game.

Simply removing the PV nomination gate therefore does not resolve the known
miss. Extending quiet allied retention and checking continuations needs separate
counterplay checks. The existing queen-hanging primary for the actual Qc8+
mistake remains correct as a material-loss explanation; this missing pawn idea
must not displace it.

## A more substantial missing combination after a pawn-shield move

The third game in the second sample, ply 29, has an unexplained response to
...b5. Moving the b7 pawn exposes the a6-b7-c8 checking diagonal. **Qa6+** is
the instructive start of a forcing attack, but the replies do not share one
simple rook-winning sequence:

- **Kc7** permits the illustrated Qxa7+, Qa8+, Qxd8+ route. Qxd8+ is a queen
  offer for the rook, not a free rook. After Kxd8, **fxg7+** discovers the
  bishop's check and attacks the bishop/rook with the promotion pawn;
  gxh8=Q follows in the fresh engine continuation.
- **Kd7** permits a mate in four in the fresh search, using Qb7+, Bf4+,
  Nc3+ and Qxa7#. This branch is not proof of forced mate from the root.
- **Kb8** leads with Bf4+ and, after Bd6, the quiet **Re7**. A later material
  capture alone does not explain that preparation.

The final nine-search receipt checks before/best, held ...b5, after/best,
held Qa6+, all three legal root defences, the actual queen offer and its
acceptance. Black's before/best estimate is -587 cp; held ...b5 is -1006.
White's held Qa6+ is +948. The held queen offer is +1054, and the accepted
position is +1163 with fxg7+ as the engine answer. The position was already
bad for Black: these are opportunities and worsening counterplay, not a claim
that ...b5 alone created the entire loss. Scores from distinct searches are
not a single consistent minimax bound.

The existing single-target checking verifier returns no certificate at its
default 16,384 operations and at diagnostic limits of 8,192 and 65,536. Merely
increasing that budget does not restore the lesson. Its one-target capture
endpoint does not extend a queen offer through the subsequent promotion
mechanism, and the separate mixed checking helper nominates capturable checking
offers; Qa6+ itself is not capturable. Quiet supporting moves are another
coverage requirement. These findings identify the next implementation work;
the engine lines are not yet an independently verified all-defence certificate.

## Reproduction and scope

`src/utils/tests/tacticalRecallGapAudit.test.ts` performs opt-in legal reply
enumeration, nomination comparison and budget trials, and emits requests for
the existing private Stockfish decision harness. It rejects report destinations
inside the checkout, resolves junctions through the shared private-path guard,
and never overwrites an existing receipt. No owner FEN or PGN is committed.

Authoritative private receipts under `Documents/OnCrescent Tactical Benchmarks/`:

- `checking-exchange-nomination-audit-final-20260916.json` and
  `checking-exchange-nomination-engine-20260916.json` (nine searches).
- `checking-attack-gap-audit-final-20260916.json` and
  `checking-attack-gap-engine2-20260916.json` (nine searches).

The final legal probes match the eighteen completed fresh engine requests.
An earlier seven-search checking-attack receipt is retained, not substituted
for the final queen-acceptance checks. The two opted-in audit runs pass; the
normal focused selection passes twenty checks with seven optional skips.
TypeScript and scoped lint pass. Production classifier source, budgets,
deadlines, generated service and worker remain unchanged. No app or phone
service is restarted, and no owner data is modified. Cold-start failures and
broader recall/primary-selection accuracy remain open.
