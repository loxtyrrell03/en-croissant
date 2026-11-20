# Prospective classical review

The scorecard asks three questions on each frozen board. Reviewers see
the game position, the exact moves and the Stockfish frames. They do not
see either classifier's output before the reference is sealed.

| Question | Tactical evidence | Positional evidence |
| --- | --- | --- |
| Position character | At least one plausible choice or defence requires calculating a concrete threat, payoff or failing alternative. | At least one persistent feature changes how the viable choices or opponent responses should be understood. |
| Move justification | The exact leading move from the common app-budget frame needs a verified tactical resource or avoids a concrete opposing tactic. | The same move enables or preserves an identifiable strategic aim after the opponent's reply. |
| Mistake mechanism | The exact recorded move creates a new tactical opportunity or misses one that was genuinely available. The compared remedy changes that opportunity. | The error gives up a demonstrably useful feature, exposes a durable weakness, or grants an opposing plan. A different later tactic alone does not establish this. |

Grade each axis independently as present, absent or unresolved.
Present needs a short explanation and a legal witness tied to the
actual move and its relevant alternatives. Resolve both axes before
marking a mixed example. An unresolved axis is valid when the material
gain is reversible, the alternative search disagrees, or a finite line
does not establish why one plan works. Reserve absent for a reviewed
counterexample to that kind of explanation. A solid move with closely
agreed scores can be a negative mistake example. It may still have
tactical or positional justification.

Checks, captures, a tactical geometry pattern and evaluation changes
are leads. A named motif needs the actual move, purpose and tactical
consequence. Record a motif as negative only when the proposed
mechanism was explicitly checked, and suppress geometry with no
function in the compared lines. Checks and quiet moves can support
either dimension. Attribute a positional benefit to a durable board
change, showing its use or preservation in a continuation and a
plausible alternative when possible.

Use the app-budget frame to nominate the exact candidate, and use
the deeper search to evaluate the leading ideas, the exact recorded
move and at least two replies to the reached positions. When the
reference root ordering changes, keep the original nominated move
and review that move against the deeper leader. Examine the same
attack in both branches or search a specific alternative with the
same budget if causation remains ambiguous. Distinguish score
agreement from agreement about why the move works. Record search
disagreement and unresolved labels explicitly.

## Frozen sample and scoring

There is one board and one recorded move per game. Each combination
of the three PGN rating bands and three ply windows has eight games.
The mover's PGN rating is a sampling field. Neither classifier
receives it. All broadcasts explicitly designate standard play with
initial controls of at least 60 minutes. No engine value or existing
classifier result determines selection. Source and root hashes,
colour-normalized board exclusions and game-prefix exclusions are in
the sample manifest.

Store one note per scope and axis with exact UCI moves and any
deliberately reviewed positive and negative motifs. Date the review,
record the reviewer's role and hash the two engine frame inputs and
the labels before replay. Record whether any labels received a second
assessment. A single engine-assisted assessment can estimate agreement
with that reference and cannot establish agreement between people.

Score the original and rebuilt classifier with the same app-budget
frames, using the original exact-root tactical motif as a position or
candidate proxy and its mistake category for the recorded move.
Report the original's unsupported axes as unavailable. Score the
rebuilt classifier's three scopes independently. Publish the
denominators, false negatives, false positives, predictive precision,
recall, mixed agreement, abstentions, and reviewed motifs separately.
Stratified ratings and ply windows make each group visible. They
should not be interpreted as a prevalence estimate. Group repeated
measurements and resampling by event. Report Stockfish nodes and
search time apart from classifier compute time. If this cohort informs
a later change, use new events for the next untouched evaluation.
