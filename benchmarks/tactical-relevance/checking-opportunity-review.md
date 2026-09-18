# Empty checking moves: opportunity versus conditional punishment

The later [saving-rook audit](saving-rook-recall-audit.md) examines Re8+'s
checking alternatives, quiet frontier and repeated counterchecks with 43 fresh
searches. It retains the explanation gap rather than claiming a perpetual.

Adapter **160 / pipeline 167** remains unchanged and is now packaged in the
standalone desktop executable. This development audit examines four deliberately
selected empty principal checks from the same 27-game / 1,319-context owner
corpus. These are not new games, a representative holdout, or four certified
missing tactics. Detailed owner positions remain private.

## Chess judgments

- **...Rh2+** checks while attacking b2. However, Kb1 and Kb3 keep that pawn
  protected by the king. The existing complete-branch material proof stops at
  Kb3. Fresh searches prefer quiet ...f4 or ...Ke6 preparations in several
  branches, not the apparently free pawn. Held ...Rh2+ scores +325 cp for Black,
  compared with +336 for the independently searched ...Ke6 and +191 for the
  actual ...Re1. That supports a useful move, not a universal checking fork or
  proof that the actual move's entire loss is caused by missing b2.
- **Re8+** is a more important unresolved defensive resource. Fresh held
  analysis is -11 cp for White, while the played Bf8 is -372. Against ...Kd5,
  Re5+ prepares Rxf5; ...Kf6 permits further checks, and ...Kf7 has Re7+ followed
  by Rxd7. Each separately searched root defence evaluates around equality
  (-10, -4 and +11). The current bounded perpetual and material proofs remain
  incomplete. The lesson should not be reduced to a supposedly won game or an
  immediate root fork: preserving drawing chances is the important hypothesis.
- **Bd7+** has heterogeneous replies. ...Kf8 permits Qxd8#, but ...Ke7 needs a
  quiet bishop retreat; accepting with ...Kxd7 permits a much longer mating
  attack. Fresh held Bd7+ is +1153, while the actual Nxd5 remains +988. The
  mating branch is not proof of root forced mate, and a later pawn capture
  cannot alone explain the offered bishop. Its root explanation remains open.
- **...Bb4+** in the opening has concrete punishments for inferior replies:
  Nc3 permits a bishop fork later, Qd2 hangs the queen, and Ke2 allows ...Nd4#.
  But Nd2 and Bd2 lead to normal development/pressure rather than those
  punishments. The useful initial move must not acquire their branch-specific
  fork, queen-win or mate headlines. Fresh held ...Bb4+ is +143 for Black and
  the played ...Nde7 is +62; no universal tactical cause is established.

These are full-position finite-depth estimates from separate searches, not
exact minimax comparisons or local material bounds. Empty outputs are not
automatically correct negatives; the Re8+ resource is a substantive unresolved
recall/explanation gap.

## Diagnostic result and rejected shortcut

Re5+'s illustrated pawn capture retains only 90 cp after bishop/knight
compensation. A trial changed the checking-combination pawn threshold from
100 to the existing generic 90-cp capture threshold. It recovered none of the
four roots or their inspected branches. The Re5+ proof still fails against
...Kd4; the longer ...Kf6 line fails against ...Kg5. This is not merely a
ten-centipawn threshold omission. The trial was fully withdrawn; production
proofs, budgets, versions and deadlines are unchanged.

The next investigation should examine the actual saving-check alternatives
and their king escapes, with exact branch accounting. A favourable drawing
engine score alone must not become a perpetual-check certificate. For the
bishop offer, the quiet-retreat and longer mating alternatives need a connected
root explanation rather than borrowing one cooperative continuation.

## Verification and receipts

All **28 fresh depth-18 searches** completed. The opt-in
`checkingOpportunityAudit.test.ts` reconciles exact requests, depth and held
moves, legally replays **68 lines / 1,288 moves**, verifies complete root-defence
sets including promotions, and checks the selected positions against their
complete game histories. It records original/fresh-line proof failures and
actual-ply capture bounds. The final focused selection passes seventeen tests;
TypeScript and scoped lint pass.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`, all dated
`20260918`: `checking-opportunities160-probes`, `checking-opportunities160-engine`,
`checking-opportunities160-diagnostic`, `checking-opportunities160-threshold-trial`
and the authoritative reconciled `checking-opportunities160-final`.

This audit adds no production classification or runtime change. Desktop source
`f70e3ac4` delivery is separately verified in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
No owner data, saved reviews, app session, shortcut or phone service changed.
Broad recall, primary-theme judgment and native/load-sensitive verification
remain incomplete.
