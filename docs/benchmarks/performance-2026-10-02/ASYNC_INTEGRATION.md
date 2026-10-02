# Responsive performance calculations

The accepted v4 numerical correction costs more than the previous history filter. The shared panel now runs its period and full-history estimates in independent module workers, with at most two active jobs per mounted panel. The final period point remains the sole source of its headline rating. The model and its statistical constants are unchanged by this integration.

Each worker belongs to one request and terminates on completion, failure, cancellation or a 120-second timeout. Changing an input hides the previous estimate during render, before effect cleanup, and terminates obsolete work. Request identity and an active-effect guard exclude late results. Changing only the selected period preserves the independent history job. Retry starts a new job; unmount cancels both. Worker creation or numerical failure produces an explicit unavailable state with diagnostics, without blocking the renderer with a synchronous fallback. Game results remain visible when estimates fail.

The default current-time snapshot is stable for a given games input, preventing completion or unrelated UI renders from repeatedly restarting calculations. Existing primary and feature panel layouts remain distinct. The established details area explains the repeated-opponent/session limitation and links the full emitted third-party licence asset.

## Verification

`final-product-verification.json` records all five source checkouts, their exact checked hashes, input receipt hashes and QA-script hashes. It also checks that every emitted licence asset matches the full source bytes. No unexpected browser errors or external requests occurred.

- Normal component checks cover 200 and 1,000 games at 1100px and 390px, plus 5,000 varied games at 1100px: headline/graph agreement, resolved history, comparison controls, graph switching and overflow checks.
- Four failure cases per checkout cover both estimates failing and history alone failing at both widths, preserving game results and independent valid estimates. Actual clicks on both Retry actions create one new worker each, leave the other attempt unchanged and recover on new inputs.
- Actual-worker checks replace an eight-game input with 5,000 games, verify immediate stale-value masking, interact while work is pending, change only the period, cancel by changing inputs, unmount and remount, and verify the omitted-time default remains stable. Every observed worker terminates.
- All five full TypeScript checks pass. Twelve worker/client tests cover success, cancellation, timeout, stale/mismatched responses, unavailable workers and isolated worker errors. Existing numerical tests and independent references remain separate evidence documented by the v4 milestone.

The control response timings in the receipt are diagnostics under synthetic PC-browser conditions, not a paired speed comparison or physical-phone benchmark. Controlled numerical cost remains in the three `latency-v4-*-result.json` receipts. The full final assessment and statistical trial are canonical in the Novelty repository's `docs/benchmarks/performance-2026-10-02/` directory; sibling copies of this integration record do not imply separate empirical fitting.

## Delivery boundary

This milestone preserves source in the Novelty and En Croissant feature branches and mirrors the corresponding source into the existing primary/companion checkouts. It does not publish an installer, deploy the hosted phone service, restart an installed app, or establish physical-device behavior. No hosting, session, profile database or provider cache is migrated. Existing unrelated changes remain outside these commits.
