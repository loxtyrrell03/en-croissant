# Tactical desktop delivery — 2026-09-15

## Current package: adapter 111 / live pipeline 116

Source `6a330d56` is packaged in the standalone executable, including the prior
fork recovery and the two discovered queen-attack opportunities found in the
owner-game audit. The build uses detached clean checkout
`en-tactical-desktop-6a330d56`, with no unrelated primary-worktree changes.
The frontend passes with 8,861 modules; the native release build passes with
22 existing unused-code warnings. The generated route tree has no semantic diff.

- Executable: `src-tauri/target/release/en-croissant-fork.exe`, 48,145,408 bytes;
  SHA-256 `e43ea2ee6d7f41268e88c529fa43f08d22bc5a1bf118c991800d6e62382606c7`.
- Worker: `liveTactics.worker-1lM6yZng.js`; SHA-256
  `5c5513ce796a1c6aed3676f1d1993b1e69d21d65193b696229c3303a241c2ba5`.
  Clean-package bytes match the final tested artifact; the x64 PE contains its
  asset key, and the native dependency receipt identifies the clean frontend.
- Previous adapter-110 backup:
  `Documents/OnCrescent Tactical Benchmarks/desktop-before-adapter111/en-croissant-fork.exe`,
  SHA-256 `4bffd5a0bc9086c1282f344134db72804046cf430b42706ca03391ae04eab58a`.

The Dev App shortcut remains on its original primary live-source workflow.
No owner app was running, launched or restarted. No settings, games, engine
installation, owner data or phone service changed. This is package/linkage
verification, not native interaction or startup certification. See
`benchmarks/tactical-relevance/discovery-recall-review.md` for the 217-position
audit, 2,254 source checks, compiled-worker/browser receipts and remaining gaps.

## Previous package: adapter 110 / live pipeline 115

Source commit `0598d8ef` is now packaged in the standalone executable, including
the recovered quiet piece-piece fork and its allowed/missed mistake lessons.
The build uses detached clean checkout `en-tactical-desktop-0598d8ef`, excluding
the primary checkout's unrelated unfinished work and subsequent classifier drafts.
The frontend passes with 8,861 modules; the native release build passes with
22 existing unused-code warnings. No app was running or restarted.

- Executable: `src-tauri/target/release/en-croissant-fork.exe`, 48,141,312 bytes;
  SHA-256 `4bffd5a0bc9086c1282f344134db72804046cf430b42706ca03391ae04eab58a`.
- Worker: `liveTactics.worker-BUo7O0lE.js`; SHA-256
  `9be4e7e2fe6c4a1c08767e1d9bb6901260855f827d08a0a658194d6494a423bb`.
  Clean-package bytes match the production-controller-tested artifact. The x64
  PE executable contains its asset key and its native dependency receipt points
  at this clean frontend.
- Previous adapter-109 executable backup:
  `Documents/OnCrescent Tactical Benchmarks/desktop-before-adapter110/en-croissant-fork.exe`,
  SHA-256 `c564b5d336dbd1145b78adf63ff6957daeaee05f41affe863028900fe1aa42ab`.

The existing Dev App shortcut still uses the primary checkout's live-source
workflow; neither shortcut nor debug launch mode was replaced. No games,
settings, engines, owner data or phone service changed. These are build/linkage
checks, not native-window interaction or startup-latency proof. The latest cold
HTTP run reaches 19,719 ms startup under load, despite passing its bound; see
`benchmarks/tactical-relevance/chesscom-recall-review.md` for evidence and gaps.

## Previous package: adapter 109 / live pipeline 114

All committed classifier improvements through `d2e56e77` are present in the
normal En Croissant source checkout and the rebuilt standalone desktop binary:
adapter **109**, live pipeline **114**, desktop mistake nature **4**.

The existing **En Croissant (Dev App)** desktop shortcut resolves through
`.dev-tools/Start-DevApp.ps1 -App encroissant-native` to this repository's normal
`pnpm dev` workflow. It therefore uses the updated source on its next launch.
The shortcut and debug executable were not replaced or changed into a different
launch mode.

The standalone binary at `src-tauri/target/release/en-croissant-fork.exe` was
rebuilt with `cargo build --release --locked --bin en-croissant-fork`, using the
default custom-protocol feature and the existing target cache. Its frontend and
native source came from the detached `en-tactical-desktop-d2e56e77` checkout, not
the primary workspace's unfinished OTB/FIDE/phone work. The clean frontend build
passed with 8,861 modules; the native build passed with 22 existing unused-code
warnings. No unrelated native work was committed or packaged by this delivery.

Verified package identity:

- Native executable: 48,141,312 bytes; SHA-256
  `c564b5d336dbd1145b78adf63ff6957daeaee05f41affe863028900fe1aa42ab`.
- Worker: `liveTactics.worker-DLsMbXwe.js`; SHA-256
  `4ea79c3688c4da3e59207f21c628700e38f215d4d4990860bb09a14e9c623c1f`.
  Its clean-package bytes exactly match the artifact tested through 1,551
  actual application-controller inputs. The native executable contains its
  asset key and the native dependency receipt identifies the clean frontend.
- The executable has a valid x64 PE header. These are build/linkage checks,
  **not** a native WebView interaction or installed-runtime latency test.

No En Croissant process was running before replacement; none was launched or
restarted. Games, databases, settings, engine processes and phone services were
not touched. The previous standalone executable is recoverable from
`Documents/OnCrescent Tactical Benchmarks/desktop-before-adapter109/`; its SHA-256
is `6fdd7174f188316acc0490650fabc4c1fb21537a296b3e6526c16caeb7297c96`.

Classifier/renderer evidence and limitations are in
`benchmarks/tactical-relevance/drawing-capture-review.md`. Exact external
saving-capture and larger-ending zugzwang lessons still require the explicit
online verification action; normal scans do not silently upload positions.
The broader classifier is not certified correct for every position, and the
earlier load-sensitive startup concern remains a separate verification gap.
