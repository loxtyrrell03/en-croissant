# Moving PC-hosted analysis to another Windows PC

The repository contains the phone home server, Stockfish service, stored-evaluation reader, database index, installers, watchdog, and publish tooling. The large user-owned analysis stores stay outside Git and move in a migration bundle.

## Export from the old PC

Run PowerShell from the repository, choosing a destination on a migration drive with at least 40 GB free:

```powershell
.\scripts\migrate-pc-analysis-state.ps1 -Mode Export -BundlePath 'E:\EnCroissantAnalysisBackup'
```

This exports the local Lichess evaluation shards, En Croissant databases, PGN and coach library, and saved phone-coach state. Credentials are excluded by default. Add `-IncludeCredentials` only when the destination is private and encrypted.

## Restore on the new PC

Clone the repository, restore the bundle, then install the services:

```powershell
.\scripts\migrate-pc-analysis-state.ps1 -Mode Import -BundlePath 'E:\EnCroissantAnalysisBackup'
.\scripts\install-stockfish-remote-server.ps1
.\scripts\install-home-server.ps1
npm run web:publish-home
```

The import refuses to merge into non-empty destinations unless `-Force` is supplied. This protects an existing installation from accidental mixing. The install scripts recreate machine-specific Stockfish paths and scheduled tasks; executable downloads, generated web releases, caches, logs, and PID files are intentionally not copied.

If credentials were exported, pass `-IncludeCredentials` on import as well. Otherwise reconnect Lichess on the new PC so the shared credential store is recreated normally.
