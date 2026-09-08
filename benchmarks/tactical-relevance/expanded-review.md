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
| NGZzo | Open quiet double threat. Fresh engine analysis confirms Nd7 attacks Rb6 while threatening Nf6+, forking Kg8 and Qh5: Rb7 Nf6+ Kf8 Nxh5 wins the queen; Kg7 instead permits Nxb6. The root move is not itself a fork. These branches need a combined all-defences proof before choosing a primary label. |
| 4Osgg | Fixed in adapter 22: the root lesson is Qf1+'s certified checking mate within four moves, not two overlapping final-pattern names. After Qg1+, both Kh3 and Kg3 are covered; Kg3 leads to Bf2+ Kh3 Qh1#, whereas the source ends Bf2#. One factual Checkmate payoff is retained at ply 7, with naming ambiguity withheld. A White Rc1 control keeps the cooperative source mate legal but permits Rxf1; the former unproved mating claim is rejected and fresh Stockfish finds Black losing. Exact named-pattern taxonomy remains unadjudicated. |
| UCiYo | Core immediate lesson is Kxc5 winning the bishop. The subsequent two-sided promotion race is separate and not certified by this material label. |
| CSh8J | Fixed in adapter 19: Nd5+ is the primary Fork, with a verified 320 cp local minimum. Nb6 also guards c8, so Nxd5 permits c8=Q; king moves instead lose the knight. Every legal reply is checked on these targets or this same pawn, including promotion recaptures. Promotion remains the actual ply-3 payoff. A truncated one-move input and the alternative king-move line retain the same root explanation. Fresh before/after searches verify Kxg3 misses this fork and Kf6 allows it; Nc8 avoids the immediate fork. |
| opGD7 | Open: the source Qf1+ Kd2 Bf4+ stops before the payoff. Fresh Stockfish continues Re3 Qf2+ Kd1 Bxe3; the classifier's later pin still does not explain the initiating king drive. This needs a complete legal branch audit. |
| fJrhT | Fixed in adapter 23: Rb1+ is the primary Fork Preparation, with the actual Nd3+ fork at ply 3. All replies are checked independently of the supplied PV: Kf2 permits Nd3+, while Rc1 loses to Rxc1+. Fresh Stockfish confirms Rb1+ wins and immediate Nd3 only draws. If the rook is on e5 instead, Re1 is a protected block and Rxe1+ Kxe1 does not win material; this and checker/forker-capture controls reject the preparation proof. Fresh before/after searches verify the actual Rc5 mistake (Ra5 holds the draw) and the missed Rb1+ when Nd3 is played prematurely. |
| MJZcU | Open promotion combination. Rxe4, fxe4 and c2 convert an exchange sacrifice into a promotion threat. The reason the immediate pawn advance is inferior still needs adjudication. |
| 0RleZ | Core sound: Re7# is supported by Nd5, itself supported by e4; hook geometry is present. |
| Z5arb | Open root miss: Nf3+ geometrically attacks king and queen while uncovering Bf6 against Nc3. The gxf3 Bxc3 branch has further recapture/passed-pawn complications; neither an empty result nor a geometry-only win claim is satisfactory. |
| iUj3e | Core sound: Qe5+ aligns king f6 and rook h8, explaining the skewer and Qxh8 payoff. |
| Kvpvi | Core sound: Bb4+ c3 Bxc3# uses the same crossing-bishop mating structure. The supplied checkmate, not a later material target, is the payoff. |
| hz3ed | Qe3# and the supporting e-file rook are real. Exact Triangle naming remains a separate taxonomy check. |
| o8K8i | En passant is factually present. Whether that special capture, rather than the queen-exchange/ending mechanism, is the most valuable lesson remains open. |
| w1lKu | Fixed and refined in adapter 21: Bh7+ clears d3 for the queen, rather than compelling Kf8. Both legal king replies are checked: Kf8 permits Qf3's pin, while Kh8 permits Qh3's different forcing attack. The root lesson is Clearance; in the source branch, Pin is created at ply 3 and exploited by the fork at ply 5. Removing the pinner makes the otherwise-illegal f7xe6 recapture legal. The other king branch includes the Rxf7 defence, requiring four checking moves before the queen capture. All branches fit a shared bounded proof; a second bishop that captures the prepared queen rejects the cooperative line. Fresh searches verify the real preceding Qxd4 mistake and the missed Bh7+ opportunity after Bb1. |
| rqXvZ | Clearance of f1 for the other rook is a real line relationship, but the forcing/mating-threat reason behind the exchange and Rf1 deserves a stronger causal proof. Current label is only partial. |
| ouIHI | A revealed pin of b3 prevents bxa4 and supports the mating rook manoeuvre. The mechanism is meaningful, though “Discovered Pin” would explain it better than overlapping generic discovery/pin wording. The impossible post-mate skewer is fixed. |
| eOCp9 | Open quiet queen manoeuvre. Qf4/Qe5 has no accepted forcing proof here; its exact tactical point requires further engine-supported inspection. |
| erSYy | Core sound: e8=N+ forks king g7 and queen f6. Keep Fork plus the specific Underpromotion; the duplicate Promotion label is removed. |
| vztmO | Fixed duplicate generic mate labels. Rxh2# is supported by g3; the king cannot take the rook. |
| G8wdr | Corrected judgement and fixed in adapter 20: the earlier fork description omitted Rd8's newly uncovered attack on Nd4. Ne5 attacks Qd3/Bc4 while the rook attacks Nd4, overloading the queen's shared defence. Qc3 allows Qxc3; Qf1 instead loses Nd4. Discovered Attack is therefore the root lesson, with the defender exchange as a branch mechanism. The bounded all-replies proof includes declined recaptures and two checking sacrifices, retaining earned material when the next target escapes. Its local minimum is 150 cp, not the engine's whole-position score. Removing either Rd8 or Qa5 invalidates this proof. Fresh searches verify both the actual preceding Nxd4 mistake and the missed Ne5 opportunity after Be7. |
| 4GiqO | Open pawn-ending judgement. Kb4/Ka3 is not enough by itself to certify zugzwang; do not add that label merely from a winning endpoint. |
| wh6Ac | Fixed duplicate generic mate labels. Qg2# is pawn-supported; one Checkmate lesson is sufficient. |
| NOaM1 | Core sound: Bb1+ aligns king e4 and bishop f5, enabling Bxf5 after the king moves. |
| JaKHo | Core sound: Rxd1+ deflects Bc2 from Ne4. The same-target move-order badge is redundant and is now suppressed. |

## Next work

Prioritize the unresolved en-passant attack and other long combinations. CSh8J's
promotion-backed fork now has a local all-replies proof, not a full ending solve.
Audit named-mate overlap separately from legal checkmate.
The adapter-22 checking-mate family audit adds 32 development positions (27
bounded proofs, five unresolved), with terminal anchors and repeated mate-count
noise corrected; its coverage is not an overall accuracy estimate.
Retain the unresolved en-passant attack and endgame cases; do not turn them into
empty-result acceptance assertions. These findings expand the original tuning
goal rather than replace it with crash-free report generation.
