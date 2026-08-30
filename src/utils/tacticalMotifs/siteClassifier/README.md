# Vendored Chess Mistake Trainer tactical classifier

This directory is the DOM-free runtime snapshot used by En Croissant Mistake Review.

- `theme-detector.js` is copied from `public/js/services/theme-detector.js` in Chess Mistake Trainer.
- `mate-pattern-detector.js` is copied with the detector and supplies its conservative named-mate motifs.
- `chess-primitives.js` is copied from the adjacent site service.
- `analysis.js` contains only the site's `ChessLite` function. The original analysis service also owns browser UI, storage, and network behavior and must not be copied here.

The adapter in `../mistakeReviewAdapter.ts` records both the site detector version and its own adapter version in saved mistake cards. When the site classifier changes, replace the detector, named-mate detector, primitives, and any new DOM-free helper modules together. Update the minimal compatibility extraction only when `ChessLite` changes. Increment the adapter version as well if a source snapshot changes without bumping `THEME_DETECTOR_VERSION`, then run the focused adapter and Mistake Review tests. Never import files from the sibling site checkout at build or runtime.
