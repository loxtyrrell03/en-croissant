# Exact endgame outcomes and concrete tactical defences

Decision Evidence now offers **Check endgame online** for eligible positions
with at most seven pieces, including after a local report fails. The app
validates the outcomes of every legal move and shows which choices hold the
draw or keep the win. It can verify a specific reply to the played move and
a separate reply to a deceptively similar option. The two answers have
different scopes. The first can explain the played mistake and the second can
explain why the position and its better moves require tactical calculation.

The comparison uses the actual board, move clock and provider outcomes from
the perspective of the side to move. It reuses the legal-move and tablebase
certificate validator. The position-level tactical explanation requires all
drawing moves to use the same quiet slider route, every drawing mover to be
safe from an immediate capture, and a nearby losing option on that route to
allow an exact winning capture without recapture. For a played mistake the
app can check an immediate mate, an unrecaptured capture of the moved piece
after a quiet move or pawn capture,
or a winning pawn check on the seventh enabled by the king vacating its
blocking square. A tablebase-confirmed reply may be shown by itself when the
cause remains unclear. Existing positional interpretations keep their
existing evidence labels. The provider's outcome categories and reply
ordering are documented here. [Lichess tablebase API](https://github.com/lichess-org/lila-tablebase#http-api)

The online action uses at most one root and two reached boards within a
single eight-second deadline. It sends FENs without game history, credentials
or referrers. A cancelled check stops, and a failed optional reply leaves the
validated root available. Known repeated or ended histories and immediate
fifty-move claim boundaries are excluded. The established online checks for
drawing captures and zugzwang continue to use their existing evidence.

## Comparison with the engine-only panel

| Case | Prior source panel | Exact check |
| --- | --- | --- |
| European Youth position and Rg7 candidate | Positional position, unclear candidate | Mixed position and a concrete tactical defence for Rg7 |
| Kf1 tried from that same board | No specific cause | Draw becomes a loss. The king vacates e2 and …e2+ wins |
| Rd4 tried from that same board | No exact comparison | Draw becomes a loss. The best reply is …Kg3. No tactical cause established by this verifier |
| Serbia recorded 66.g4 | Unclear mistake | Win becomes a draw. …Kc3 draws. No named tactical cause |

Only Rg6, Rg7 and Rg8 draw in the European example. The similar Rg5 gives
Black …Rxg5. Rg7 keeps the rook safe without giving up the blockade on e2.
Kf1 and Rd4 are counterfactual examples. [European Youth game](https://lichess.org/broadcast/european-youth-chess-championship-2026-o18/round-6/B7IXGP6j/OrZik0ID) ·
[Serbia game](https://lichess.org/broadcast/20-pojedinacno-prvenstvo-srbije-za-sahistkinje/round-2/22RJ28ho/VVDJIKjh)

A frozen selection covers 48 public classical games from 23 event families,
excluding the development example's event. The sampler screens matching
known game prefixes and mirrored positions in the archived inputs and
stratifies across marked losses, rook endings and other endings before any
tablebase lookups. One history contains a previously repeated position and
receives no verification. All others receive exact outcomes. Four of the
47 lacked a complete engine report. The actual move changes the outcome once.
The 46 moves that preserve the outcome get no new exact mistake label.

A second test takes one inferior legal choice per verified board when a worse
outcome is available. The choice uses a fixed hash of the game and move,
independent of the tactical reason. These are 30 hypothetical decisions on
the same boards, covering 17 event families. The app verifies 29 replies
and names nine tactical causes. Seven are unrecaptured captures and two are
mates in one. Five of the nine already had tactical support in the previous
engine-only mistake report. Four gain it through the exact check. For example,
the Olympiad test move Rc6 permits …Rxc6, and the Arad test move Bc5 permits
…Kxc5. The one unavailable reply still has a verified worse outcome. The
comparison checks every reported concrete reply with a separate python-chess
legal replay. These counts measure this verifier's scope and do not estimate
overall mixed or tactical recall.
[Recorded moves](recorded-results.json) · [Counterfactuals](counterfactual-results.json)

An exact constructed control confirms that Rxd1 Kxd1 trades rooks
and changes a draw into a loss. The remaining pawn changes the outcome.
The app gives the result and reply without reporting a dropped rook.
[Equal exchange certificate](equal-exchange.json)

## Verification and replay

Three focused source suites pass, including provider validation and the two
existing online checks. The 48-game recorded and 30-choice counterfactual
replays use captured provider records and run without network. The source
panel is exercised at 320, 390 and 900 px. It covers opt-in, keyboard help,
cancel, retry, independent scopes, and exact fallback when engine analysis is
unavailable. The installed desktop build has not been exercised.

- Use the Vitest configuration in this directory to run the recorded replay.
  For the counterfactual replay set [EXACT_ENDGAME_SAMPLE and EXACT_ENDGAME_RECORDS](challenge.test.ts)
  to the supplied counterfactual fixtures. Set EXACT_ENDGAME_RESULTS for a
  regenerated output file.
- To remake the public sample, pass the local research directory, a new output
  and the two prior archive inputs to [sample.py](sample.py). Their hashes and
  the input PGNs are in [sample.json](sample.json). [counterfactual.py](counterfactual.py)
  derives the second sample from the first plus its verified root records.
- The engine baseline at ef2448a0 used 2.4M nodes for the root and paired
  frame and 1.4M per reply, with the existing draw-aware search runner and
  settled-exchange worker harness. Use [compare.py](compare.py) for independent
  replay across each sample, exact records, outputs and baseline.
- Run [verify-panel.mjs](verify-panel.mjs) with the Playwright module path and
  Chrome executable to check the source panel against [witness.json](witness.json).
