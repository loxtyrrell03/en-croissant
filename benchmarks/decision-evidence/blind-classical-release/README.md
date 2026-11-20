# Blind classical release comparison

This reserve is separate from the 72-game classical cohort used during
development. It contains 36 finished games from six previously unused
public events. There is one position per game and twelve per ply
window. The PGN rating bands contain 6 games below 1800, 14 at
1800–2199 and 16 at 2200 or above. Every selected event specifies
90 minutes and 30 seconds of increment from the start.

The selection script uses played game data alone. It excludes prior
game prefixes, exact broadcast game URLs and colour-normalized
boards, and caps each event at six games. The source manifest records
the original PGN hashes and the hash of each supplied prior sample.
Raw downloads remain outside this checkout.

The product version under test is fixed at `dde59f6f`. The
[classical review protocol](../current-classifier-audit/classical-review-protocol.md)
defines the six axes and the exact-move requirement. Its 72-game
stratification does not apply to this smaller reserve. A single
engine-assisted reviewer sees the common Stockfish frame, the deeper
comparison and match-relevant replies before either classifier is run.
The retained reference records actual moves and supports unresolved
labels where the checked lines do not settle the question. The
original and frozen product then receive the same offline app-budget
frame. The separate [live Windows run](../native-desktop/README.md)
measures the adaptive workflow.
