# Recall before classification: targeted candidate search prototype

The adapter-131 desktop package remains unchanged. This milestone establishes
and benchmarks a candidate-search approach; it is **not connected to the live
Tactics tab yet** and is not a claim that the reported omission is fixed there.

## Rejected wider-search draft

Twenty fresh depth-16 searches compare unrestricted MultiPV 3 and 6 across nine
existing public chess-judgement positions and the reviewed owner discovery/pin
position. Increasing the production width was tried and then withdrawn: the
owner search still returns six quiet alternatives, not the missing knight move.
Its process-start-plus-search time rises from 1,157 to 1,929 ms in this run.
Initial-position, Italian, Ruy Lopez and drawn pawn-ending controls remain free
of found themes in that draft. This is a small development sample, not evidence
that doubling the candidate count is generally noise-free or fast enough.

The private `candidate-width-six-initial-20260916.json` receipt preserves that
withdrawn six-line draft. Production remains three lines / pipeline 136. The
opt-in width harness records the full raw engine lists; its classifier output
uses the current production input limit, not an implicit width override.

## Targeted prototype and chess findings

`nominateTacticalCandidateMoves` proposes at most eight legal moves, using
profitable capture estimates, multi-target attacks, revealed slider attacks and
cut defenders. This is deliberately **nomination**, not proof of a tactic or
sound move. The output contains move identities and internal search priority,
not displayable tactical labels. Existing engine candidates can be excluded.

The opt-in harness searches only those nominated root moves with Stockfish,
retains up to two separately assessed options and applies the existing
whole-position score admission plus ordinary motif verification. It never
copies a later continuation's evaluation onto a synthetic starting move.

In the reviewed owner position, the unrestricted best move is +139 cp. The
targeted search returns **Nxc7** (+93), a compensation-aware rook fork, and
**Ng5** (+74), opening the bishop against the queen pinned to the king. Both
pass the existing close-score admission and independent motif checks. The
seven legal nominations take less than one measured millisecond; the separate
engine process/search takes 780 ms. These are two opportunities in one reused
game position, not two new games or an accuracy estimate. Full-position engine
estimates are not the 270/250-cp local material bounds.

The ordinary Italian's tempting Bxf7+ is nominated geometrically but rejected
at -256 cp versus +28 for the best move. Other inferior fork, queen and rook
offers in the public controls are rejected too. A generated position removing
both a-pawns exposes an important contrary detail: ...Ra1+ becomes available.
Its Nd8/Ng5 options retain only medium-confidence pin threats, explicitly
stating that checking replies remain; they are not verified guaranteed gains.
The mandatory receipt test preserves that qualification instead of changing
the expected result to a stronger positive.

There are **37 fresh engine searches** in this milestone: twenty width
comparisons, fifteen targeted-prototype searches (ten unrestricted roots and
five restricted searches), and two searches for the constructed control.
The public `targeted-candidate-stockfish-18.json` retains fifteen of them across
nine existing public boards and one constructed board. The two private
targeted receipts are `targeted-candidate-prototype-20260916.json` and
`targeted-candidate-constructed-20260916.json` under
`Documents/OnCrescent Tactical Benchmarks/`. Owner positions are not published.

## Verification and remaining integration

Twenty-one focused tests pass with 64 opt-in skips, plus TypeScript and scoped
lint. Five nomination/receipt tests cover legal bounded moves, exclusion,
colour reflection, hanging material, interference, terminal/invalid boards,
the exact fresh engine lines and the weaker constructed pin qualification.
An initial unbound `Chess.fromSetup` callback failed and was corrected before
verification. The shared engine harness now validates every requested root in
a restricted list, rejects empty/duplicate/oversized lists, normalizes castling
and rejects an engine which silently searches a different root.

The next implementation must carry this through the actual native engine and
panel lifecycle; simply passing a fourth line into the old three-line array
still discards it. Required work is:

- Native support for a bounded, legally validated `searchmoves` root list,
  including correct MultiPV completion when fewer than two roots are legal.
- A supplemental search owned by the same board request, without restarting
  the original six-second engine allowance. Failure/cancellation/late output
  must preserve or discard results according to the correct request, never
  replace a usable main result with an optional-probe failure.
- Separate provenance for supplemental candidates, fresh sufficient-depth
  scores and normal proof filtering; these are not unrestricted engine ranks.
- Worker, panel, cache and board-preview coverage of admitted alternatives,
  followed by broader owner/rare/quiet replays and desktop delivery.

The proposal cap can still omit tactics; geometric priority is not exhaustive
chess understanding. Positional compensation, unseen longer attacks, primary
specificity and native startup also remain open. No runtime, installed package,
owner data, browser or phone service was changed by this prototype milestone.
