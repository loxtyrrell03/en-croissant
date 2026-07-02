# Approved Owner-Delta Bundle

Date: 2026-07-02. Built from fork branch `codex/en-croissant-fork` at the current HEAD, diffed against upstream merge-base `14ae9478` (see `docs/extraction/PROVENANCE_MANIFEST.md` for the full provenance analysis).

## What this bundle is

This directory is the **only** approved channel for moving code from the GPL-derived fork into the proprietary rebuild repository. It contains **154 whole files that were newly created by the owner after the fork point** (verified absent from upstream, all 626 post-fork commits single-authored by the owner). It contains **zero** GPL base files, zero third-party assets, and zero generated-from-GPL outputs.

- `new-owner-files/<original relative path>` — the copied owner files, paths kept only as provenance notes. The proprietary repo must reorganize them under its own fresh structure.
- `manifest.csv` — row per file for all 194 added + 127 modified fork paths: path, class, included yes/no, note.

## Rules for the implementation repo

1. Only files under `new-owner-files/` may be copied. Everything in `manifest.csv` marked `Included = no` must be reimplemented from the behavior-only parity checklist or replaced with original assets.
2. Copied files import fork/GPL base modules (game-tree state, chess utils, generated bindings, UI kit). Those imports must be re-pointed at freshly written proprietary equivalents — never satisfy them by copying the old base modules.
3. Strip or replace: old product names, "En Croissant" strings, old storage keys where they are distinctive, and any UI copy you want to keep distinct. Owner-authored internal names may be kept where useful.
4. `public/manifest.webmanifest`, `public/web-sw.js`, and fork-specific scripts need naming/path adaptation before use.
5. Treat this bundle as read-only reviewed input. If more material is needed (e.g., an owner hunk from a modified GPL file), run a controlled extraction pass in the fork repo and append it here with a new manifest row of class `owner-hunk`, plus the commit/diff provenance in the note.

## Classes present

| Class | Count basis | Reuse |
| --- | --- | --- |
| owner-code-ts | new TS/TSX feature code under `src/`, `src/web/`, hooks, state, data | copy + adapt |
| owner-code-rust | new Rust files (coach bridge, local eval store, eval-db/export bins, lib.rs module decl) | copy + adapt; fresh storage formats/names where flagged in plan |
| owner-test | owner test files | copy + adapt to new module paths |
| owner-doc | agents.md, rebuild plan, opponent-prep guide | internal specs only, not public docs |
| owner-script | build/publish/report/dev scripts | copy + adapt names/paths |
| owner-web-asset-review | PWA manifest + service worker | copy after branding strip |
