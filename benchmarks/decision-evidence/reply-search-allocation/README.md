# Choosing which tactical reply to search

This compares three uses of the same 1M-node Stockfish budget after a
leading alternative. The ordinary route asks for three replies and
requires the first to match the refutation seen at the root. The
single-reply control asks for one unrestricted reply. The focused
arm spends the whole budget on the reply nominated by the root PV.
A fourth arm uses the ordinary three-reply result and inspects a
matching reply within 35 centipawns of the leader. Every arm uses
the same legal continuation verifier and the same initial nomination.
[Stockfish UCI options](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands)

| Cohort and measure | Three replies | One unrestricted reply | One focused reply | Three replies, close reply eligible |
| --- | ---: | ---: | ---: | ---: |
| 53 archived boards, verified branch findings | 28 | 31 | 34 | 32 |
| Archived boards newly receiving tactical support | 15 | 22 | 24 | 19 |
| Archived boards newly receiving mixed support | 5 | 4 | 3 | 6 |
| 7 eligible boards from existing public reserves, verified branch findings | 2 | 2 | 2 | 2 |
| 4 eligible boards in the prospective sample, reviewed supported findings | 2 | 1 | 2 | 2 |
| Prospective uncertain findings | 1 | 1 | 1 | 1 |

The archived rows count verifier output. They do not have a uniform
independent review and provide a development comparison. The 300-game
prospective set was selected before opening the search comparisons
and was disjoint from the earlier selected boards, normalizing for
colour. Prior referenced games and their encountered positions were
also excluded. Some event families recur. Four prospective boards
qualified for a refutation search and each had one eligible alternative.
One reviewer labelled the four from separate deeper searches before
looking at the compared results. There were no definite negatives in
these four. The table cannot estimate general precision or recall.
[Sampling and engine protocol](protocol.json) and [case judgments](classical-reference.json)

The focused search reached a median completed depth of 22 rather than
19 in the archive. In the European Youth example it retained the pawn
capture missed by the unrestricted one-line search. Ordinary three-line
analysis already found it. In the older Groningen example, changing
the budget allocation found the same initial Nxa5 but changed Black's
next move from Ra8 to Rb8, removing the proposed Rxb4 follow-up. The
ordinary search can miss one specific proof and still retain another.
The mixed counts therefore matter alongside the total number of
findings.

Scanning close replies inside the ordinary result added no work for
Stockfish. It recovered known examples in the archive, including
Bxb6 in a slower king move from the North American Youth Championship.
A deeper search also showed why close-reply reuse needs caution.
In one Badalona game Bxb3 was 17 centipawns off the leader at the app
budget and 127 behind in the deeper unrestricted result. The move and
its payoff are legal. Its importance to the root decision is less
certain. The fresh test supports keeping the existing search policy.
All compared arms together recovered the same two reviewed supported
examples. A model choosing among exact alternative moves would have
had the same single nomination on each board. [Full counts](result.json)

## Reporting the defensive recapture

The review did reveal an explanation error. After 48...Ba4, 49.Rxa2
takes a passed pawn. The old report described it as “wins an exchange
on a2” and did not show the defence. The report now explains that
48...Bd5 protects a2 because 49.Rxa2 can be answered by 49...Bxa2.
It calculates the recapture using the same legal static exchange
analysis that established the original material comparison. If an
exact reply does not reproduce that calculation, it describes the
material difference without naming a specific recapture. If the
capture is unavailable, the reason says so. The report still shows
both searched continuations.
[European Youth round 6](https://lichess.org/broadcast/european-youth-chess-championship-2026-o18/round-6/B7IXGP6j/PruOHT7N)

The source change affects explanations only. Across 1,050 valid
archived reports three reports gain revised explanations. Two of the
11 public replay reports change wording. Categories, motifs, scores
and PVs match. The existing panel shows the recapture in a source-built
browser test at widths of 320, 390 and 900 pixels. A pinned stockfish
replay uses saved analysis. There are zero new engine requests.

## Reproduce

Run commands from the En Croissant repository root. Python uses
python-chess. Set the Stockfish path to the Stockfish 19 executable
matched by the SHA-256 in the protocol.

```powershell
$suite = 'benchmarks/decision-evidence/reply-search-allocation'
$env:REPLY_BUDGET_INPUT = "$suite/classical-nominations.json"
$env:REPLY_BUDGET_SEARCH = "$suite/search.jsonl"
$env:REPLY_BUDGET_OUTPUT = Join-Path $env:TEMP "reply-check-$PID.json"
node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs"
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalMistakeEpisode.test.ts
```

- `classical-sample.json` contains the frozen 300 public board inputs.
  `gather.py INPUT OUTPUT ENGINE` captures adaptive root frames. Set
  `REPLY_BUDGET_INPUT` to that output, clear `REPLY_BUDGET_SEARCH`
  and rerun the benchmark to obtain the shortlist. Run `gather.py`
  on the shortlist with `--best-reply`. Re-run the benchmark on those
  frames to obtain the nominations with the ordinary best-move reply.
  The prospective replay does not simulate the desktop's live deadlines
  or its additional captures after the best move.
- `search.py NOMINATIONS OUTPUT ENGINE` runs all three equal-budget
  searches. Add `--reference` for independent deeper analysis.
  Saved exact frames show legal continuations. Timing in freshly
  generated receipts depends on hardware and concurrent load.
- For a report replay, clear `REPLY_BUDGET_SEARCH` and set
  `REPLY_BUDGET_INPUT` to `public-worker-input.json`. Run with
  `REPLY_CAPTURE_ARM=baseline` and `REPLY_CAPTURE_ARM=candidate`,
  using separate output paths. The runner pins the other classifier
  files to the protocol revision. Set `REPLY_CAPTURE_REVISION` to the
  commit that introduced the fixture to pin the explanation code.
- For the archive and retained transfer replays, use `merge.py` with
  the En Croissant checkout, the local classifier research directory
  and a new output directory. Source positions from privately supplied
  games and courses stay in that research directory.
