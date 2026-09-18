# Conditional attraction without a false forced-win claim

Adapter **162 / live pipeline 169** gives a previously empty owner-game
opportunity an **Attraction Idea** explanation. This identifies a concrete
mechanism in the displayed continuation; the complete Bxa6 win and its causal
mistake comparison remain unproved. The earlier
`capture-attraction-recall-audit.md` documents those larger unresolved branches.

## What changed

The capture exchanges comparable pieces and attracts the recapturer to a
square where a checking entry and subsequent quiet attack become effective.
Every legal direct retreat of that piece is checked separately. It must allow
a safe connected capture of that piece, or block an actual legal guard of a
different attacked piece. The latter is an escape concession, not a claim that
the original piece has no escape. An actual non-retreating reply must also
leave the original capture available; a hypothetical pass alone is insufficient.

For the owner Bxa6 line, Qc6+ followed by b5 attacks the attracted bishop.
...Bxb5 permits Qxb5, including the lost pawn in the local accounting;
...Bb7 permits Qxb7; ...Bc8 saves the bishop but blocks its queen's rook guard,
allowing Qxa8. The receiver could legally capture a premature Qc6+, and its
departure opens the checking queen's rook ray. These relationships connect the
exchange to the later mechanism instead of borrowing an unrelated capture.

This is deliberately **not** an all-defence material or mate certificate.
Other replies, including the queen-exchange, king-safety and mating branches
from the preceding audit, still require further proof. The observation is
medium confidence, zero material value, engine-relevance gated, and a fallback
only when no existing immediate root lesson is established. It cannot establish
a missed/allowed mistake cause or finance generic later capture badges.
Review says **Idea in the better line** / **Idea after the move**, retaining
stronger established causes. The board shows only the initial capture and
possible recapture, not future checking/pawn/rook arrows.

The helper uses the existing liability-aware capture checks, including
counterchecks, under an 8,192-operation allowance. Exhaustion is unknown.
No search deadline or engine candidate-acquisition policy changes. The real
direct-retreat observation uses 98 counted proof operations; this excludes
general classifier work and is not an end-to-end latency claim.

## Chess judgment and contrary evidence

Forty-eight final fresh depth-18 searches inspect the actual owner root,
constructed layout, both colour reflections, premature entries, direct
retreats and their captures, plus contrary controls. The real held Bxa6 is
about +305 cp for the mover; the premature Qc6+ is about -514 cp. These are
finite-depth whole-position estimates, not the local capture bounds.

The first reduced constructed layout omitted the a7 blocker. ...Rxa6 then
answers Bxa6 and the held root is -340 cp, despite the attractive bishop
acceptance. This contrary example is retained; its actual score withholds the
observation. It is not silently counted as a successful tactic. A revised
layout restores that blocker and b6, which prevents Qc6 from already being a
direct king/bishop fork. Removing b6 retains the existing stronger verified
Fork Preparation instead of replacing it with the new conditional observation.

The constructed Bxa6 is sound in fresh analysis (+470), but Bb5+ is stronger
(+549). In its displayed bishop-exchange branch, the held Qxb5 is roughly equal
and Qxb7 is about -88 cp; stronger mating choices can exist instead. This is
important contrary evidence: the conditional local capture mechanism does not
promise a won resulting position or optimal continuation. The owner's actual
three selected capture branches remain winning in the fresh searches.

An extra recapturing rook defeats the escape concession. Removing the old
guard makes the rook already loose rather than newly undefended. A queen offer
is outside the comparable-exchange scope. Removing several blockers exposes
unsettled checking counterplay and withholds the observation; this is not a
claim that the entire altered position is non-tactical.

An independent python-chess audit verifies four legal conditional witnesses,
all twelve direct retreats, their guard relationships and the actual ignored
replies. Their reached positions contain 100 total legal replies; only the
direct-retreat subset is certified to concede the stated capture. Twelve
tampered witnesses are rejected. The engine requests reconcile exactly:
48 searches, 68 lines and 1,285 legal SAN/UCI moves.

## Replays and verification

The frozen 30-game / 1,551-context source replay changes two related rows:
the live Bxa6 opportunity and its preceding neutral review context. The missed
idea is also retained without an unsupported causal accusation. This is one
recovered mechanism, not two independently solved tactics. All other 1,549
full results, all 246 private course/generated-game results and twenty rare
results remain unchanged apart from versions/timing. Stability is not accuracy.

- Broad selection: 2,934 passes, 356 conditional skips across 211 files,
  retaining the expected coverage failure. The focused new observation,
  audit and existing result-renderer selection passes 65 tests.
- Generated shared review: 37 passes, one optional engine skip, including
  neutral observation persistence/reload in both colours.
- Whole-project/review types, scoped lint, review/frontend builds and two
  development-cache recovery checks pass. The main-worktree frontend includes
  unrelated edits and is not the clean desktop delivery source.
- All **2,367 compiled-controller inputs** pass: 808 public, 1,551 owner and
  eight additional positive/negative colour controls. The 808 public primary
  lists are unchanged; compute/transfer median/p95/max is 40/203/1,152 ms,
  excluding engine and native UI. Clean desktop delivery is recorded separately.
- The isolated cold HTTP run passes 201 cases: first/max startup is
  1,182/1,671 ms and server startup is separately 1,985 ms. This passing run
  does not resolve earlier load-sensitive startup failures or prove native UI.
- Twenty-four actual React/Chrome-worker groups cover positive, contrary,
  losing-candidate and stronger-primary states at 1100/760/360px and 100/200%
  text, including keyboard preview and the two current-board arrows.
  Screenshots/report: `tmp/tactical-attraction-observation-pipeline169/`.

Private evidence stays under `Documents/OnCrescent Tactical Benchmarks/`, with
the `attraction162-` prefix and `20260918` date: owner/private/rare replays,
verified witnesses/probes/engine, independent replay, validation, public/owner
workers, tests and cold HTTP. Earlier `draft`, `final` and unqualified `engine`
receipts preserve superseded constructed layouts; the `verified-*` engine and
witness records are authoritative for the final fixtures. Owner positions and
paid course content are not committed.

## Still open

The first-move forced-win explanation, other accepting/declining defences,
and the actual mistake cause are not solved by this observation. Longer quiet
and mixed material/mating combinations, wider recall/primary judgment and
native startup remain open. No owner stores were rescanned and no app/phone
service was restarted. Package delivery is separate in
`docs/TACTICAL_DESKTOP_DELIVERY.md`.
