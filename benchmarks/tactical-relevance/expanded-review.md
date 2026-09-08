# Tag-blind development expansion: first relevance audit

This adds 32 distinct source games, selected by a fixed salted SHA-256 ordering
from development rows, excluding the original twelve diagnostic IDs. Selection
did not use themes, rating, line length or classifier output. The fixture omits
source theme labels so they cannot silently become expected answers. The parent
fixture is itself theme-balanced and unusually mate-heavy: this is **not** a
random sample of ordinary game mistakes or a general accuracy benchmark.

`expanded-development.json` records the selection and source hash;
`expanded-judgement.json` records all legal source lines and classifications.
`expanded-stockfish-18.json` independently evaluates seven investigated positions
with fresh unrestricted MultiPV3 and root-restricted searches. A passing report
test proves legal replay/crash freedom, not 32 correct lessons. The notes below
separate inspected chess relationships from unresolved classification questions.

## Findings and decisions

- **Crash:** fVRuW's legal en-passant capture removed a pawn that a pre-move
  defensive ray still referenced. The interference audit dereferenced that
  now-empty square. It now requires a surviving enemy target. Classification
  completes, but the longer tactic remains unexplained.
- **Wrong primary:** GIB50's `Rxd8#` was primarily labelled Hanging Piece and
  assigned a mating value. Checkmate must supersede material captured on the
  same move; an earlier genuinely free capture before a later mate is different.
- **Duplicate generic mates:** GIB50, vztmO and wh6Ac now have one factual
  Checkmate entry with legal SAN and high confidence, not both Mate and Mate in 1.
  A legal immediate mate is reconstructed even without a legacy detector tag.
- **Post-game ghost:** ouIHI's `Ra1#` also had a skewer supposedly winning the
  rook behind the king. The king has no legal move and the game is over, so that
  future material payoff is irrelevant. Terminal material forks, skewers,
  loose-piece and undefended-piece labels are suppressed; check/pin mechanisms
  that explain the mate are not indiscriminately erased.
- **Same-cause duplicates:** JaKHo's deflection and Intermediate Check described
  the same named target and gain. The specific deflection is retained. erSYy's
  knight-promotion fork retains Underpromotion, not a second generic Promotion
  badge for the same ply.

## Position-by-position notes

“Core sound” means the displayed principal chess relationship matches this
inspection. It is not a complete proof of every named-pattern definition or
every possible defensive continuation. “Open” is not a successful empty result.

| ID | Inspection and remaining issue |
| --- | --- |
| DVSJh | Core sound: Rh6#; Ne4 controls g3/g5 while the king's own rook blocks g4, matching the Anastasia mechanism. |
| 007c6 | Core sound: Ba6# with the other bishop covering the king's remaining diagonals; Boden is meaningful. |
| fVRuW | Crash fixed, tactic still open. En passant gives check and opens lines; the fresh engine retains exf3+ Qxf3 Rd2+ and later f5, ending in a rook-winning attack. The bounded source audit still returns no theme. |
| K56tk | Core sound: Qg6# is protected by h5; the king's own pieces obstruct its rear escapes, fitting the dovetail geometry. |
| NKnZo | Rh8# is real and queen-supported. Exact Kill Box taxonomy has not been independently adjudicated. |
| 5hjz7 | Core sound: Bc3# uses crossing bishops and the king's own blockers; Boden is meaningful. |
| GIB50 | Fixed wrong primary: Rxd8# ends the game. Winning the rook is not the principal lesson. |
| REAdh | Core sound: Re6# is knight-supported, and the knight is pawn-supported; the hook relationship is present. |
| NGZzo | Open quiet-move miss. Nd7 attacks Rb6, but why a satisfactory rook escape is unavailable needs branch-level work. Do not assume a fork merely from the knight move. |
| 4Osgg | The source line ends in Bf2# after a checking queen drive. Balestra and Morphy labels overlap; choose/adjudicate a single useful pattern rather than count both as two tactics. Still open. |
| UCiYo | Core immediate lesson is Kxc5 winning the bishop. The subsequent two-sided promotion race is separate and not certified by this material label. |
| CSh8J | Important partial result: Nd5+ attacks king and Nb6, which guards c8. Taking the checking knight permits promotion. The engine confirms the source route, but the classifier only names the later promotion, missing the root's fork/deflection mechanism. |
| opGD7 | Open: Qf1+ Kd2 Bf4+ stops before the payoff. The checks appear to displace the king's defence of Re2, but this needs a complete legal branch audit. |
| fJrhT | The later Nd3+ king/rook fork is real. The explanation should also establish why Rb1+ must precede it, including blocking alternatives; current root explanation is incomplete. |
| MJZcU | Open promotion combination. Rxe4, fxe4 and c2 convert an exchange sacrifice into a promotion threat. The reason the immediate pawn advance is inferior still needs adjudication. |
| 0RleZ | Core sound: Re7# is supported by Nd5, itself supported by e4; hook geometry is present. |
| Z5arb | Open root miss: Nf3+ geometrically attacks king and queen while uncovering Bf6 against Nc3. The gxf3 Bxc3 branch has further recapture/passed-pawn complications; neither an empty result nor a geometry-only win claim is satisfactory. |
| iUj3e | Core sound: Qe5+ aligns king f6 and rook h8, explaining the skewer and Qxh8 payoff. |
| Kvpvi | Core sound: Bb4+ c3 Bxc3# uses the same crossing-bishop mating structure. The supplied checkmate, not a later material target, is the payoff. |
| hz3ed | Qe3# and the supporting e-file rook are real. Exact Triangle naming remains a separate taxonomy check. |
| o8K8i | En passant is factually present. Whether that special capture, rather than the queen-exchange/ending mechanism, is the most valuable lesson remains open. |
| w1lKu | Open combination: Bh7+ drives the king to f8; Qf3 pins f7, enabling Nxe6+ to fork king and queen without fxe6. The quiet pinning step is currently missed. |
| rqXvZ | Clearance of f1 for the other rook is a real line relationship, but the forcing/mating-threat reason behind the exchange and Rf1 deserves a stronger causal proof. Current label is only partial. |
| ouIHI | A revealed pin of b3 prevents bxa4 and supports the mating rook manoeuvre. The mechanism is meaningful, though “Discovered Pin” would explain it better than overlapping generic discovery/pin wording. The impossible post-mate skewer is fixed. |
| eOCp9 | Open quiet queen manoeuvre. Qf4/Qe5 has no accepted forcing proof here; its exact tactical point requires further engine-supported inspection. |
| erSYy | Core sound: e8=N+ forks king g7 and queen f6. Keep Fork plus the specific Underpromotion; the duplicate Promotion label is removed. |
| vztmO | Fixed duplicate generic mate labels. Rxh2# is supported by g3; the king cannot take the rook. |
| G8wdr | Open double-attack miss: Ne5 attacks Qd3 and Bc4; Qc3 protects the bishop, but Qxc3 bxc3 removes that defence before Nxc4. The intervening queen exchange defeats the current immediate-target proof. |
| 4GiqO | Open pawn-ending judgement. Kb4/Ka3 is not enough by itself to certify zugzwang; do not add that label merely from a winning endpoint. |
| wh6Ac | Fixed duplicate generic mate labels. Qg2# is pawn-supported; one Checkmate lesson is sufficient. |
| NOaM1 | Core sound: Bb1+ aligns king e4 and bishop f5, enabling Bxf5 after the king moves. |
| JaKHo | Core sound: Rxd1+ deflects Bc2 from Ne4. The same-target move-order badge is redundant and is now suppressed. |

## Next work

Prioritize CSh8J's promotion-backed fork, G8wdr's queen-exchange branch and the
quiet pin in w1lKu. Audit named-mate overlap separately from legal checkmate.
Retain the unresolved en-passant attack and endgame cases; do not turn them into
empty-result acceptance assertions. These findings expand the original tuning
goal rather than replace it with crash-free report generation.
