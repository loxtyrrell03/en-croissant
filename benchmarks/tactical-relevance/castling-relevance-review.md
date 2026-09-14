# Castling, ordinary-game relevance and unresolved rare roots

Adapter 102 / live pipeline 107. This is a correctness and reliability milestone,
not a claim of comprehensive tactical accuracy or an installed-app release.

## What changed

A fresh all-defence search of public puzzle 4Ds65 crashed on the legal reply
O-O-O. Internal king-to-rook UCI (`e1a1`) emptied a1; a preparation helper then
dereferenced a nonexistent moving piece. A checking-castle control exposed the
same assumption in the exchange-deflection helper. Both regressions failed
before the fix and pass afterwards.

Legal replay now uses an equivalent legal king-landing action where unambiguous,
while preserving the caller's original UCI identity. Single-piece proof helpers
abstain on an unavailable mover. Illegal castling is rejected before conversion;
Chess960 cases with an ambiguous landing retain their original action. These
checks do not certify comprehensive Chess960 motif coverage.

Live annotations now use the legal replay, not raw UCI substrings. A castling
mate shows the king and rook's actual moves and puts its label on the king's
landing square. A lone rook check gets no invented fork/sacrifice label. Mate
remains the sole primary lesson, including a missed castling mate. Proof budgets
and worker deadlines are unchanged; no new generic theme-admission rule was added.

## Material selected independently of classifier output

[Initial judgements](castling-initial-judgement.md) preceded fresh castle outputs.
The [context sample](castling-context-development.json) enumerates all 71 legal
castling options in twelve frozen real-game histories, selecting up to six
SHA-ordered cases per side/flank. There are eighteen candidates: six White long,
six White short, six Black short. No Black long castle was eligible; constructed
colour-reflected controls cover behavior, not that real-game sampling gap.

The [engine receipt](castling-stockfish-18.json) includes 36 fresh depth-16 searches
for those eighteen positions (unrestricted three-line search plus fixed castle),
and sixty root/defence/reached-preparation searches for three rare puzzles.
The latter cover every immediate defence: 3 + 29 + 22. An earlier forty-search
partial audit stopped at the castling crash and remains in the private evidence.
Engine scores are full-position evaluations from each search's side to move,
not spendable local material bounds. After-castle worker checks replay the fixed
castle search's continuation; they are not eighteen extra fresh searches.

## Chess judgements, including contrary evidence

| Position | Important interpretation |
| --- | --- |
| zJqoVvf1, ply 24, long-castle option | The missed move is Nc6, forking Qd8 and Rb8. Review retains Missed Fork, with a separately proved 180-unit exchange gain. The fresh best/castle evaluations are +208/-220 cp; those scores are not the fork's proof value. |
| MHuRInPi, ply 10, short-castle option | Na5 already attacks the loose Bc4. Castling leaves it to Nxc4; Bd3 saves it. Both the actual after-castle scan and mistake review identify Hanging Piece, and review verifies that the better move prevents that capture. Best/castle scores are -33/-330 cp; the local bishop value is 330. |
| T675oRjx, ply 16; mD14jttw, ply 8; etolcQHz, ply 9 | Ordinary development and pre-existing pins do not become new root tactics. Distant exchanges in supplied engine lines remain outside the castle's lesson. |
| Other zJqoVvf1 and h5yHhpzr options | King safety, central exchanges and missed preparation can make a castle inferior without a verified immediate theme. Their empty outputs are not counted as correct negatives. |
| ZVq1J | Ne5+ interposes against Qd4's check, but Ne5 remains pinned to Kg7. Nxd7 is illegal after each of the three replies, so the apparent root fork is not a valid material explanation. The later Rd2/Qxd2 changes the geometry; the actual ply-5 discovered check remains later. Root preparation remains unproved. |
| snAK4 | Qd5 threatens Qxg2 mate; after f3, Ra2 traps the queen with Qd5's support. The reached Trapped Queen is independently retained, but the complete root certificate is still missing. Rxe7+ must be answered, followed by possible Qe2+. An experimental mating-trap extension still failed this defence and was withdrawn. |
| 4Ds65 | Bg4/Rae8 concern a pin and reinforcement. Legal castling must be included even though the source chooses Rh2. Fixing the crash does not establish the missing root preparation proof. |

The three rare root gaps are not relabelled as successes. The sixty-search
audit contains useful losing defences as well as best replies; an engine PV or
winning root score cannot alone certify an all-defence tactical mechanism.

## Verification and limits

- 1,992 selected source/review/render tests pass; 85 conditional skips remain.
  This includes 55 new castling checks plus the three-root audit in one test.
- All 246 private course/positional source and live results and all twenty rare
  results are structurally identical to adapter101, excluding version metadata
  only. The 32 frozen priority judgements remain satisfied. Stability is not accuracy.
- All 1,233 actual-controller production-worker inputs pass (727 public, 505
  private, one additional promotion regression), across fifteen tests. The 597
  prior public headline lists are unchanged. Public elapsed mean/median/p95/max
  is 92/66/202/848 ms; maximum classification/transfer time is 819 ms. Artifact:
  `dist/assets/liveTactics.worker-COt1lBad.js`. The final rebuild has the same
  artifact hash. No engine search, network time or native UI is included, and
  timings across differently loaded runs are not a performance-improvement claim.
- All 53 isolated cold-HTTP cases pass. First/next worker startup is 9,169/206 ms;
  separate server startup is 13,319 ms, and maximum computation/transfer is
  1,331 ms. Earlier startup variability remains unresolved, not certified fixed.
- Actual Chrome checks cover sixteen constructed/real castling inputs at
  1100/760/360px and 100/200% text: 96 groups. Keyboard activation verifies the
  real result component's board-preview callback and both arrow endpoints.
  Screenshots were inspected. This is not a physical board or owner-app test.
- Shared-review and app builds, TypeScript, fifteen-file lint, three service
  tests and two development-cache recovery scenarios pass. Existing build-size
  warnings remain. No owner app, service, package or installed runtime was restarted
  or deployed; unrelated work and private course material remain untouched.

## Receipts and reproduction

Public: [engine inputs and lines](castling-stockfish-18.json),
[production-worker receipt](built-worker-adapter102.json), the context sample and
initial judgements above. Reproduction scripts are
`castling-context-sample.mjs`, `castling-context-input.mjs`,
`rare-root-probes.mjs`, `castling-public-receipt.mjs`,
`castling-stability-audit.mjs` and `castling-worker-receipt.mjs` in
`scripts/benchmarks/`. Public exports validate identities and legal positions
against public inputs; they do not copy private course content.

Private authoritative evidence remains outside Git at
`C:/Users/Lox/Documents/OnCrescent Tactical Benchmarks/`:

- `adapter102-castling-input.json`, `adapter102-castling-engine.json`,
  `adapter102-castling-final-review.json`;
- `adapter102-rare-root-probes.json`, `adapter102-rare-root-engine.json`
  (partial crash), `adapter102-rare-root-fixed-engine.json` (all sixty),
  and `adapter102-mating-trap-prototype.json` (withdrawn experiment);
- `adapter102-final-exact-replay.json`, `rare-theme-adapter102-final.json`,
  `adapter102-final-stability.json`;
- `built-worker-adapter102-final-private.json` and
  `adapter102-final-cold-http-worker.json`.

Browser reproduction: `node scripts/qa-tactical-payoffs.mjs --castling`, with
`TACTICAL_QA_DEPENDENCIES` pointing to the installed Playwright dependency package.
Local artifacts: `tmp/tactical-castling-adapter102/`. Isolated HTTP reproduction:
`TACTICAL_DEV_COLD=1 node scripts/tests/run-tactical-dev-worker.mjs`.

Broader quiet/rare mechanisms, deeper causal comparisons, representative
out-of-sample accuracy and native reliability remain open. In particular this
milestone does not expand automatic larger-ending tablebase acquisition.
