# Saving rook checks: a useful resource is not automatically a perpetual

This follows `checking-opportunity-review.md` on the same unresolved owner-game
Re8+ position. Production **adapter 164 / pipeline 171** is unchanged by this
audit and is now in the clean desktop package. The current full-history owner
replay still has no root theme or mistake explanation here. This is a selected
development omission, not a new game, an accuracy sample or a solved case.

## Fresh chess review

The new depth-20 root searches give Re8+ approximately equality (-10 cp in the
unrestricted search, -9 held), versus -361 for the played Bf8. After Bf8, ...f4
starts the dangerous passed-pawn advance. After Re8+, all three independently
searched king replies preserve approximately equal estimates: ...Kd5 -8,
...Kf6 -4 and ...Kf7 +5 cp for White. These are separate finite-depth engine
estimates, not an exact draw proof or a local material bound.

The useful first-move explanation must connect the rook's activity with that
defensive purpose. Calling it an immediate fork, a won game or a guaranteed
perpetual would not explain the actual branches correctly.

### The king can leave the illustrated checking route

After Re8+ Kf6 Rf8+ Kg5 Rg8+ Kh5, the **only legal further check is Rg5+**.
The held depth-20 search gives -706 cp and answers Kxg5. The rook is not
protected on g5. By contrast, quiet Rd8 is the unrestricted choice at 0 cp;
the separately held Rg7 is -9. Rg7 attacks the seventh-rank pawns, but ...Re2+
followed by a queenside countercapture makes an immediate net-gain claim
incomplete. The earlier checking route therefore needs a quiet continuation;
it is not a certificate for Perpetual Check.

This is evidence about that reached route, not a proof that every possible
checking strategy from Re8+ fails. The other legal checks were examined too:

| Reached position | Legal check held fixed | White estimate, cp |
| --- | --- | ---: |
| After ...Kf6 | Be5+ | -53 |
| After ...Kf6 | Be7+ | -426 |
| After ...Kf6 | Re6+ | -735 |
| After ...Kf6 | Rf8+ | -7 |
| After ...Kg5 | Bf4+ | -503 |
| After ...Kg5 | Be7+ | -28 |
| After ...Kg5 | Rxf5+ | -686 |
| After ...Kg5 | Rg8+ | -8 |

Those are all four legal checks at each selected board. Near-equal bishop
alternatives also reach quieter play in the returned lines. The searches do
not independently certify every continuation or refute all longer strategies.

### The pawn branch needs more than one countercheck answer

After Re8+ Kd5 Re5+, every legal king evasion (Kc4, Kd4, Kc6) was examined,
including separately held Rxf5 and all immediate checking replies after it.
The local capture evaluator gives 90 cp rather than a whole pawn because of
bishop/knight compensation. The whole ending remains approximately equal in
the fresh searches; local capture arithmetic is not the full explanation.

The initially tempting Kc2 answer after Rxf5 Re2+ Kb3 Nd2+ does **not** end the
checks. ...Nc4+ vacates d2 and discovers the rook's e2-c2 check. Independent
legal replay confirms the rook, not the knight, is checking. The held Kc2
search gives -77 cp, whereas Kb4 is +1, Ka3 -8 and Ka4 -3. This corrects the
initial geometric hypothesis rather than weakening the safety gate to force
a positive result. All four legal evasions to each of the first two selected
counterchecks were searched, not just the best-looking king move.

The earlier ten-centipawn-threshold experiment was already withdrawn. This
audit supplies concrete reasons why that shortcut did not recover the root:
counterchecks and quiet defensive activity remain part of the mechanism.

## Evidence and limits

- **43 fresh searches**: 27 root/defence/frontier probes plus 16 complete
  checking/evasion alternatives at four selected boards, depths 18 or 20.
- Independent python-chess verification reconciles every exact request,
  depth, held move, legal history and SAN/UCI continuation: **80 lines / 1,707
  moves** and **eleven complete legal-move sets**. Unusable en-passant markers
  are normalized only for legal-position comparison; clocks are retained.
- Both opt-in engine audit invocations pass. The existing packaged worker and
  1,704-context source replay identify the still-empty root. Raw line-only
  diagnostic classifications of reached captures omit history and are not
  presented as the live app's contextual classifications.
- No production rule, runtime budget or UI state changed. The intermediate
  exchange implementation's complete verification and clean package delivery
  are recorded separately; this diagnostic does not certify new coverage.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:
`saving-rook164-probes-20260918.json`, `saving-rook164-engine-20260918.json`,
`saving-rook164-branches-probes-20260918.json`,
`saving-rook164-branches-engine-20260918.json` and
`saving-rook164-independent-20260918.json`. Plans record the preliminary
judgments, including the corrected Kc2 hypothesis; owner positions stay private.

The remaining task is to explain the genuine defensive opportunity through
its mixed checking/quiet continuations without asserting a forced draw from
an engine score alone. Longer defensive retention and primary-theme judgment
remain open. No owner-store rescan, app launch or phone deployment occurred.
