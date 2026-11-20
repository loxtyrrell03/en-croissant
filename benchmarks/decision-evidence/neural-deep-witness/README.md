# A neural search shortlist for unresolved tactical mistakes

The model gets two short Stockfish replies after the played move and two
after the leading alternative. It reads up to eight legal plies per line.
A shared 24-unit recurrent encoder reads the four sequences. The final
layers compare the two candidate branches and include the same shallow
Stockfish scores available to the controls. Each network has 5,873
parameters. The three-seed ensemble ranks cases for further analysis.
All methods receive identical initial searches and the same shortlist budget.

## Target and split

The reference is a bounded engine witness. The paired root search and an
independent search after each choice must agree on the direction of the loss.
Both comparisons must show a new short mate against the player or at least
two material points of difference over the last four matched plies. The
matched window is eight to 14 plies after the root move. Already-visible
payoffs are excluded by a separate check on the two short replies. A
negative means no repeatable evaluation loss or no material contrast in
that comparison. Other cases remain uncertain. This target covers only one
kind of evidence and cannot assign overall tactical or positional labels.

The 394 training games come from archived public classical analysis.
After the shallow screen, 43 cases meet the target, 60 are negative under
its definition and 289 are uncertain. Only known outcomes are fitted.
The ordinary transfer contains 128 games across eight separate event
families. The second transfer uses 120 games from ten additional classical
events and samples broadcaster-annotated losses of at least 140 centipawns.
Broadcaster scores are used for sampling. Models and reference labels use
separate Stockfish runs. Games and colour-normalized boards are checked
for overlap along with event families. Training reuses stronger searches
with varying budgets. Each new transfer uses a fixed schedule. The
ordinary sample was chosen before comparing its target outcomes.
[Lichess broadcast data](https://database.lichess.org/#broadcasts)

The first, stricter development target required four full 16-ply lines
and found only five archived positives. The prespecified transfer ran
after the target was revised on archive development alone. The revised
match corroborates the root and reply searches and allows a shorter common
horizon. In an event-grouped development split, the network tied the
score regression at 11 witnesses in 35 slots, with two versus five scoped
negatives. That result justified the prospective check.

## Results

Each cell shows provisional witnesses, scoped negatives and uncertain cases.
Uncertainty uses a slot. The per-event budget is one quarter of eligible
positions, rounded up. The primary ordinary cohort has 86 eligible moves
and the enriched cohort has 113. The reference gate found just one witness
in the ordinary cohort. No method selected it, and a higher-budget replay
did not reproduce the settled material contrast.

| Ranking method | Ordinary, 25 slots | Enriched, 30 slots | Enriched average precision |
| --- | ---: | ---: | ---: |
| Shallow Stockfish loss | 0 / 5 / 20 | 6 / 8 / 16 | .689 |
| Shallow material contrast | 0 / 6 / 19 | 1 / 7 / 22 | .154 |
| Score logistic regression | 0 / 4 / 21 | 6 / 7 / 17 | .831 |
| Legal line logistic regression | 0 / 6 / 19 | 2 / 4 / 24 | .578 |
| Legal line boosted tree | 0 / 4 / 21 | 4 / 6 / 20 | .629 |
| Recurrent network ensemble | 0 / 5 / 20 | 5 / 6 / 19 | .559 |

Average precision excludes uncertain cases. Independently rerunning all
seven provisional positives at 3.6M nodes per search recovered one with
the same material requirement. All leading methods selected that example.
After Ra6 in the Asian Nations Cup, Rf1 and the exchanges on c3 leave the
player down material. The stronger Rc4 keeps the game close. The other
lines can contain real tactics even when their material trails diverge at
the fixed horizon. [Asian Nations Cup round 8](https://lichess.org/broadcast/asian-nations-chess-cup-2026-men/round-8/JEkJZZxe)

The committed En Croissant assessor was also replayed with the same root
and the short or deeper replies. This is an exploratory paired-frame
comparison. The assessor produced two additional tactical explanations in
the ordinary cohort and four in the enriched cohort when given deeper
replies. At the same shortlist budgets, the network and line regression
each selected two in each cohort. One independent rerun meets the strict
material target in this separate group. At Hoogeveen, Rc8 allows Nxc8
Kxc8 Rxc6+. The better b5 avoids that capture sequence.
[Hoogeveen round 7](https://lichess.org/broadcast/hoogeveen-open-2026/round-7/o4Nw35Ls/sD6OSDTk)

The screen required two additional witnesses with no increase in negatives
and gains in at least two event families. The frozen model fell short.
The initial input costs 104,000 requested nodes across the two reply
boards, beyond the root search. A further pair costs 2.4M nodes.
One network evaluated an entire 86- or 113-case batch in about 1.1 ms on
CPU, excluding feature extraction and fitting. Equal budgets mean the
network supplies neither a search saving nor a verified diagnostic gain
over the best simple controls. The benchmark remains offline.

## Reproduce

Run from the En Croissant root. Use the recorded Stockfish 19 binary,
Python 3.13 with python-chess 1.999, scikit-learn 1.9.1 and PyTorch 2.10.0
CPU. `frames.py select LAB TRAIN_INPUT PRIMARY_INPUT` uses the retained
classifier research directory and its upstream game frames. The two public
transfer inputs are included here. `reserve.py` can reconstruct the
enriched sample from the frozen event IDs and the broadcast responses.

1. Run `frames.py gather INPUT FRAMES STOCKFISH` for training and each
   transfer.
2. Run `rank.py TRAIN_FRAMES TRANSFER_FRAMES OUTPUT`. Elapsed times change
   across runs. The exact case scores, rankings and counts reproduced in two
   fits for each cohort.
3. Run `review.py TRANSFER_FRAMES OUTPUT STOCKFISH REVIEW` to separately
   recheck the provisional positives.
4. Set `DEEP_WITNESS_INPUT` to a transfer frame file and
   `DEEP_WITNESS_OUTPUT` to a fresh path. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/neural-deep-witness/vite.config.mjs`.
   Run `app_score.py OUTPUT DEEP_WITNESS_OUTPUT SUMMARY` for the matched
   ranking counts.
5. Run `test_rank.py` for the four model and data regression checks.

[Frozen split and scoring](protocol.json) |
[Results by method and event](results.json) |
[Confirmed deep continuations](proofs.json)
