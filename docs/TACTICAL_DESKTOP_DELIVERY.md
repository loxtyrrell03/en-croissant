# Tactical desktop delivery — 2026-09-14

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
