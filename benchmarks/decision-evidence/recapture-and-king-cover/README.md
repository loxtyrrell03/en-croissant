# Which pawn recaptures beside the king?

In Prague, `33...fxg6 34.Qxe6+ Qxe6 35.Bxe6+` gives White a
viable simplifying sequence. After `33...hxg6`, the same
`34.Qxe6` gives no check, and `...fxe6` takes the queen.
Restricted Stockfish gives White −15.28 for that capture after
`...hxg6` and +0.05 after `...fxg6`. The actual leading reply
to `...hxg6` gives White −0.92. This supports both the tactical
resource and the lasting difference in which pawn stays beside
the king. The main `...fxg6` search also has other viable choices.

The offline candidate looks for two leading captures of the same
pawn, different checking status in the same opponent capture,
a concrete legal countercapture by the preserved pawn, and two
searched continuations in which the king's pawn structure persists.
It verifies the queen trade in the weaker branch separately from
the positional interpretation.

The selector scanned 5,268 completed classical games and found
112 matching geometries. It used a 60k-node MultiPV preview and an
80k-node paired preview, then selected one board per game. It checked
80 distinct games at the deeper engine settings. Seventy had
both captures available among the leading choices. All seventy
were negative for the exact tested mechanism and the other ten
were outside the comparison's coverage. The candidate found
zero new confirmations. The Guernsey and Uruguay examples show
why geometry alone cannot support the motif. The respective
queen captures are objectively losing after either recapture.

`prague.json` retains the root and reply frames, the direct
counterfactual and the resulting evidence. `counterchecks.json`
contains the separately searched controls. `reserve-annotations.json`
records the covered and uncovered cases. The candidate patch
applies as an offline experiment. It is not in the app.
