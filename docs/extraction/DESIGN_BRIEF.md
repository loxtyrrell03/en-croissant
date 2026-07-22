# Design Direction Brief — Proprietary Chess Workstation

Working codename: **Outpost** (a chess term: a protected advanced square). Owner may rename before release; all naming below is placeholder-original and safe to ship or replace.

## Feel target

Inspired by the fork's usability taste, expressed with an original identity:

- **Board-first**: the board is the largest, most stable element on every analysis surface; tools orbit it, never crowd it.
- **Calm density**: compact rows and evidence chips, generous line-height, no ornamental chrome, one accent color doing real work.
- **Task-led navigation**: home surface answers "what do you want to do" (analyze, prep, review, train, browse), not "which module am I in".
- **Compact evidence**: WDL bars, counts, recency, strength and confidence labels rendered as small inline chips/bars beside moves — evidence next to the decision, not in a separate report.
- **Restrained controls**: defaults do the right thing; advanced controls fold behind small affordances; destructive actions confirm.

## Visual tokens (original, not derived from the fork's theme files)

- Typeface: Inter or IBM Plex Sans (OFL) for UI; JetBrains Mono (OFL) for FEN/PGN/engine lines.
- Base surfaces: near-black warm charcoal dark theme first (`#141416` family), light theme later.
- Accent: **teal/cyan family** (e.g. `#2DD4BF` range) for primary actions and selection — deliberately different hue family from the fork.
- Evidence colors: win/draw/loss bars use muted green/gray/red with color-blind-safe contrast; strength labels use filled chips, not colored text.
- Radius: 8px cards, 6px controls. Spacing scale 4/8/12/16/24. Elevation via 1px borders + subtle shadow, not heavy blur.

## Board, pieces, sounds

- Board: original two-tone palette (deep slate + warm sand as default), designed in-app as CSS/SVG, plus 2–3 original alternates.
- Pieces: permissively licensed set verified at import time (candidates: publicly licensed SVG sets under OFL/CC-BY with attribution recorded in a LICENSES file) or commissioned original set before commercial release. **Never** chess.com/lichess/En Croissant piece art.
- Sounds: original or CC0 move/capture/check/notify sounds; record provenance per file.

## Copy voice

- Short, direct, sentence case, no exclamation points. Empty states say what to do next in one line.
- All UI strings written fresh; no reuse of fork/En Croissant strings, tooltips, or error text.

## Naming

- Modules and APIs use plain domain language: `board`, `gametree`, `engines`, `sources`, `prep`, `review`, `training`, `library`, `companion`.
- No reuse of distinctive fork-internal names for base modules; owner-authored feature names (e.g. "After prep", "Smart strength", "Plan Explorer") are owner-created product vocabulary and are kept.
