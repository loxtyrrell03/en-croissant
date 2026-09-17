# Empty capture results: history and opening move-order review

Production remains **adapter 159 / live pipeline 166**, now packaged in the
standalone desktop app. This audit reviews seven previously selected owner-game
contexts; it does not count seven missing tactics, loosen admission, or change
owner stores. Selection came from an earlier development diagnostic, not an
independent holdout. Owner positions and detailed receipts remain private.

## Review of the actual game context

The complete 1,319-context frozen replay contains 144 empty principal capture
roots. The existing capture/history diagnostic examines them, finding twenty
with a positive current local pawn bound. None passes the current full-history
admission. That is neither twenty misses nor twenty correct negatives: the set
includes recaptures, gambit recovery, compensation and unresolved relevance.

The seven specifically reviewed contexts include:

- **Qxf4:** the pawn had previously captured on f4, and Black can countercapture
  on c2. A same-square pawn count does not establish a new retained gain. The
  owner played the capture, so it must not become a missed-move accusation.
- **Rxd6:** recovery of the pawn which took the advanced d-pawn. Keep this
  separate from the actual bishop loss after Bxg4. Existing review retains the
  prevented winning recapture; it does not invent a newly won pawn on d6.
- **Rxd4 / Nxb5:** the victims just captured the queen / bishop respectively.
  These are important recaptures, not newly hanging pieces. Both were played.
- **Qxh3 / Qxh5:** current safe pawn captures, but the history includes an
  earlier pawn loss; the latter also has unrelated piece losses. Whether a
  delayed compensation deserves a qualified current opportunity remains a
  relevance question. They are not certified negatives merely because the
  current history filter suppresses them. Qxh5 remains in the supplied played
  continuation; the actual queen relocation in the Qxh3 example does not leave
  that capture immediately legal.
- **Opening Nxe5:** the initial material-retention assessment needed correction,
  as described below. A favourable engine score alone cannot decide the theme.

Twenty-five fresh depth-18 Stockfish searches cover unrestricted and held roots,
best replies to those captures, and four distinct actually played alternatives.
Qxh3 scores +500 cp held versus +513 for the independently searched e5; played
Qe1 scores +480. Qxh5 scores -704 held, while played a4 scores -741 and retains
Qxh5 later. These are whole-position estimates, not pawn-profit bounds or exact
comparisons. The older frozen engine evidence is not overwritten.

## Opening hypothesis corrected by the defence tree

The initial fresh Nxe5 analysis suggested a missing pawn-winning combination:
...Nxe4 allows Qh5, while ...Bb4 permits Nxc6 followed by e5. All 36 legal replies
to Nxe5 were then independently searched at depth 18, plus six contrasting
move-order decisions. Their best-response estimates are positive, but this does
not prove that every branch wins a pawn.

In particular, **...Nxe5 dxe5 Nxe4 Nxe4 dxe4 Qxd8+ Kxd8** reaches equal material.
Fresh held dxe5 is +131 cp, consistent with a positional advantage, not a
certificate of an extra pawn. The tempting **Qh5 after ...Nxe5 loses the queen
to Nxh5** (-671 cp in the held search). The first blanket pawn-win hypothesis
is rejected, rather than converted into a positive test expectation.

After **...Nxe4**, however, **Qh5** has a real Qxf7 mate threat: the legal ...a6
control permits Qxf7#. Fresh held Qh5 scores +101 cp and its line uses ...Nxe5
Qxe5+ Be6 followed by exchanges. The reached Qh5 position remains unclassified.
This identifies a specific quiet-threat/connected-payoff investigation; one
ignored-threat mate and a winning engine line do not yet establish its complete
all-defence tactical certificate. That secondary branch must not be borrowed
as the original Nxe5 move's universal explanation.

## Evidence and next action

All **67** fresh search requests completed. A separate reconciliation matches
request identity, reached FEN, held move and depth, and legally replays all
**169 returned lines / 3,186 moves**. It verifies the equal-material exchange,
the ignored Qh5 mate and the queen loss in the wrong move order. These checks
are not an independent all-defence material solver or an accuracy percentage.

Private receipts in `Documents/OnCrescent Tactical Benchmarks/`, dated `20260917`:

- `empty-capture-history159` — current complete-history diagnostic.
- `capture-history159-probes`, `capture-history159-engine` — seven-position
  judgements and 25 fresh decisions.
- `opening-capture159-probes`, `opening-capture159-engine` — complete 36-reply
  enumeration and six move-order contrasts.
- `capture-history159-reconciled` — final identity/legality/material checks.

The existing opt-in history and engine audit tests pass. No runtime logic,
deadline, cache or generated worker changes in this audit. The next useful
work is the reached Qh5 threat and its actual defensive branches, alongside
the two delayed-compensation relevance questions; do not treat empty counts
or local pawn values as adjudicated mistakes. Wider recall, primary selection
and native/load-sensitive verification remain open.
