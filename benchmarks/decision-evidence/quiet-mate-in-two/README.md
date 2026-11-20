# Quiet moves that threaten mate in two

Decision Evidence already recognized a quiet move that threatens mate on the next move. It also reported some immediate forced mates and conditional mates after checks. It could miss a quiet move that threatens a specific mate in two while the best reply holds. The proof in this iteration covers that decision in both the position and candidate-move reports.

A hypothetical change of turn nominates a checking move. The proof starts from an actual legal opponent reply. After the named check, every legal defence must admit mate on the next move. The root and separate reply searches must supply converging exact scores and show defences that stop short checking mates. The proof looks for an earlier immediate or checking mate and excludes near-term draw claims on the supplied history. The worker shows both the defence and an example legal mating line. It distinguishes whether Stockfish searched the example reply.

Two proposed checks use the same saved engine frames. One requires a Stockfish-scored mate in two after a nonleading reply. The other can verify a legal, unsearched opponent reply. Both need the full mate proof. The final decision worker uses the wider check only where the move's tactical explanation is still unsupported. The move must already have an exact reply probe. For position character it must also meet the existing comparison with the leading choice. The played-mistake mechanism stays separate.

## Results

The challenge labels concern the recorded root move and the exact new mate-in-two mechanism. They were independently enumerated with python-chess before opening candidate reports. Some controls contain genuine immediate threats. Their negative label is specific to this slower mechanism. The challenge is enriched and gives no estimate of prevalence or general tactical accuracy.

| Exact recorded move | Cases | Stockfish-scored reply only | Checked legal example |
|---|---:|---:|---:|
| Development positives | 14 | 1 | 14 |
| First independent positives | 16 | 0 | 15 |
| Second independent positives | 10 | 0 | 9 |
| First shared controls, cooperative mate lines and immediate threats | 32 | 0 | 0 |
| Second shared controls, cooperative mate lines and immediate threats | 20 | 0 | 0 |

Across the two independent groups, the legal-example method detects 24 of 26 scoped positives and produces zero calls among 52 scoped negatives. Both missed recorded moves failed the existing evaluation requirement because Stockfish put them below −1.00 for the mover. The engine could prefer a different move on the same board.

| Full worker position assessment | Tactical before | Tactical after | New candidate-move explanations |
|---|---:|---:|---:|
| Development positives | 3/14 | 10/14 | 9 |
| First independent positives | 3/16 | 8/16 | 8 |
| Second independent positives | 1/10 | 6/10 | 6 |
| All 52 challenge controls | 18/52 | 18/52 | 0 |
| Broad archive | 238/1,869 | 238/1,869 | 3 |

Every published new move explanation was independently replayed. The verifier enumerates all legal responses to the named check. It also confirms there was no mate in two at the root or after the reported defences, including a mate starting with a quiet move. The first independent set adds one mixed position by retaining the existing strategic evidence and adding the tactical proof. The independent experiment adjudicates the new tactical axis only. All played-move verdicts and availability statuses match in the 1,869 valid archive reports and the challenge sets.

The first 48-game holdout is concentrated in the Arco Open. The 30-game replication uses different games, colour-normalised boards and event sources, with up to four cases per stratum per source. The retained public PGNs exclude labelled speed games where applicable and some clock tags are missing. Engine searches use the same frames in every comparison.

## Position examples

- After `30.Qh4`, `...Qd2` prevents the mating attack. The example `30...a5 31.Qxh6+ Nh7 32.Qg7#` shows the threat. Both that branch and the earlier positional evidence are visible in the mixed report.
- After `23...Rg4`, White can take the rook with `24.Qxg4`. Ignoring it with `24.Rab1` allows `24...Qxg3+ 25.Kf1 Bd3#`. The exact proof also tests the other legal response to the check.
- After a different quiet rook move, `...Rdh8`, the two searches find `Nf1` and `Rf1`. Both prevent mate in two. An example with `Ra1` shows how the attack works.

No additional Stockfish calls are required. In the two independent sets, median full worker processing stays within roughly 48–52 ms with or without the change. Cached archive runs show about 72–76 ms, measured separately. These are observations on this PC and exclude engine analysis. The existing panel and built worker display the evidence at 320, 390 and 900 px with keyboard access to the expanded lines. Installed desktop verification is pending.

The proof covers checking mating starts. It can abstain when the forcing move itself is quiet, the available search data lack a comparable defence, or the local proof budget runs out.

## Reproduce

Use Python with python-chess, the existing Node dependencies, and the retained standard-chess PGNs listed with hashes in [results.json](results.json). Stockfish 19 SHA-256 is `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`. The experiments use one thread, 64 MiB hash, root searches of 600k or 2.4M nodes and replies of 1M or 4M nodes. The recorded move outside the normal leading choices is retained only for the exact-move comparison.

1. Run `sample.py DEVELOPMENT DEVELOPMENT_MANIFEST SOURCES... --exclude ARCHIVE`. For the holdout add `--controls --quota 16` and exclude development. For the replication use `--controls --quota 10 --per-event 4` and exclude the archive and both earlier selections. Use the matching event inputs for each group from the sampling section in the results.
2. Run `analyse.py INPUT OUTPUT STOCKFISH benchmarks/decision-evidence/defence-after-attack`. Files are `development-engine.json`, `holdout-engine.json` and `replication-engine.json`.
3. Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/quiet-mate-in-two/vite.config.mjs` from the repository root. Set `TWO_INPUT` and `TWO_OUTPUT`. With `TWO_MODE=worker`, leave `TWO_REVISION` unset for the baseline and set it to the commit containing this benchmark for the candidate. Set the corresponding `*-base.json` and `*-next.json` output names. Unset `TWO_MODE` to compare the two focused proofs into `*-proofs.json`.
4. Use the [earlier archive replay](../allowed-route-mistakes/README.md) for the 1,875 archived requests. Its `worker-v43.json` is the baseline. Save the current worker result as `archive-next.json`. Run `score.py RUN_DIRECTORY PREVIOUS_RUN_DIRECTORY results.json`. Run `verify.py INPUT REPORT` to independently replay a report.
5. Run `decisionQuietMateInTwo.test.ts` for the legal branches, crossing defences, cooperative line, immediate threat, wrong board and history regressions. Run `node benchmarks/decision-evidence/quiet-mate-in-two/verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` with `TWO_REVISION` set to the candidate.
