# Performance input parity

The phone Stats adapter now retains Lichess's explicit opponent `provisional` flag as opponent uncertainty 150, matching the desktop adapter. False or absent flags retain the model's default 60; the focal player's provisional flag is not confused with the opponent's. Both player colours are covered.

For Chess.com, a valid integer opponent PGN Elo takes precedence over the API rating, whose timing is less explicit. Missing or malformed opponent PGN Elo falls back to a finite API rating. The focal player's prior uses only valid pre-game PGN Elo: it does not substitute a potentially post-game API rating. Zero is retained; missing, negative, fractional and scientific-notation PGN values are rejected consistently with desktop. The ordinary website-rating display still uses its existing provider field.

These are evidence-input corrections, not new model coefficients. In a synthetic three-win example against provisional 1700-rated opponents, the previous phone estimate was 1692.854665 (SD 124.855451), compared with desktop's 1678.304382 (SD 128.176963). The corrected adapter produces the exact same posterior as desktop for the same games.

Regression tests exercise both colours, explicit/absent provisional flags, malformed and missing PGN fields, finite fallback, and exact period-posterior parity through the public fetch adapters. The feature checkout passes all 90 tests in the Stats-adapter and shared-model files. The source and companion checkouts also pass their expanded adapter tests and full TypeScript checks. Existing range/format changes in those checkouts were preserved.

This adapter also supplies the phone overview and reports. Its fetched-game cache is component-local; there is no persistent normalized-game schema to migrate. The correction is mirrored in `en-croissant` and `en-croissant-current`. Novelty's desktop adapter already preserves these inputs and needs no equivalent product edit. Installed apps, the hosted phone service, profile data and sessions were not changed. Source parity is not deployed or physical-phone verification.
