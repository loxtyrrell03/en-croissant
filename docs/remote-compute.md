# Gaming PC compute

The normal En Croissant launchers automatically use the SSH alias
`gaming-pc-compute` when it is reachable. No database or settings directory is
mirrored to the gaming PC.

The installed desktop shortcut is `En Croissant Fork`. It runs
`scripts/launch-fork.ps1`; `npm run dev` reaches the same remote-aware path
through `scripts/safe-dev.ps1`.

The remote worker handles:

- incremental Rust compilation when native source is newer than the local app;
- Stockfish UCI processes used by live analysis, whole-game analysis, coach
  requests, and engine play.

The frontend dev server, Tauri window, database queries, imports, and all app
data remain on the laptop. Keeping database work local avoids copying large,
mutable SQLite libraries over Wi-Fi.

Remote build state and the provisioned Stockfish executable live only under
`C:\Users\loxty\AppData\Local\EnCroissantRemoteCompute` on the gaming PC.
The laptop receives the finished executable in its configured Cargo target
directory (currently `C:\Users\loxty\.cargo\shared-target`).

If SSH cannot connect, the launcher automatically uses the existing local
Tauri build and local engine paths. To deliberately force a local development
run, use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/safe-dev.ps1 -SkipBackup -LocalOnly
```
