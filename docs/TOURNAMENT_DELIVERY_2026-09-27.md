# Tournament and OTB delivery, 27 September 2026

The tournament hub and opponent-import workflow are available in En Croissant desktop source and the live phone app at https://lox-pc.tail89d19b.ts.net/. See [feature coverage and persistence](TOURNAMENT_PARITY.md). Novelty was read only: the final audit verified all 98 measured source files, its HEAD and its complete Git status against the initial receipt.

## Phone release

- Published source: `b398f15d94293c26e5f1197ee621ab372f9b1463` on `codex/tournament-phone-release-20260927`.
- Active app release: `b398f15d9429-5333f20badc7` under the existing `EnCroissantHomeServer/app-releases` directory.
- App shell SHA-256: `5333f20badc7f48d045791527b4743e1918e110e021d97e1766b7ceacf9cc3b1`.
- Versioned native helper: `encroissant-tournament-core-b398f15d9429.exe`, SHA-256 `e46069dfcff34b3856ebf98a512c764f36170bb7bda8d86691b967bab6677e93`.
- OTB collector SHA-256: `9f56491022a4a6adc2907985963352a37df346cf175c88c58ac35be5a8c16467`.

The canonical HTTPS health response reported the same source and an available tournament helper. An actual tournament settings RPC answered through the controller. PC services remained enabled and Ready; the complete Tailscale Serve configuration matched the preflight snapshot. The controller, scheduled launchers, permanent hostname and unrelated routes were preserved.

A rendered Chrome visit at 390px opened Tournaments, loaded real discovery results, opened an event with a 124-player roster, and displayed OTB download controls. There was no horizontal page overflow. Discovery retains its visible source-coverage warning rather than implying all worldwide events are available. These live checks did not follow an event, import owner games or start a corpus download. A separate synthetic 360px interaction followed an invented event, calculated next-round predictions, imported an opponent, opened Prep as Black and displayed the opponent's opening moves. This is browser evidence, not physical-phone verification.

The first publication exposed a UTF-8 BOM in a Windows-written runtime manifest. The JSON reader now accepts it, an isolated real-HTTP regression covers helper selection, and publication verifies a native RPC as well as health. The final release above passed those checks.

## Desktop artifact

The standalone executable at `src-tauri/target/release/en-croissant-fork.exe` was rebuilt from clean source `9907d291064c4c7699b8ba1bab511bfda15c1d55`. The subsequent phone manifest fix does not alter desktop frontend/native code.

- Size: 50,826,752 bytes.
- SHA-256: `87614b8370e674c65ec9fe9a1a2c63cbc7c06df5ef61534b26b20c2ed32f37e9`.
- Embedded forecast asset: `exactSwissForecast.worker-szPufPXL.js`, SHA-256 `d15d9888ddfed35e056d6d0b66047a1f52909704b615ee746241d1025682c3c5`.

The executable contains the tested worker asset key, and native dependency metadata identifies the clean release checkout. The existing Dev shortcut was unchanged; no desktop app was launched or restarted. This establishes build/package linkage, not native-window interaction proof.

## Verification

Verification used small synthetic fixtures and the existing shared build cache:

- 376 frontend tests for tournament models/views, imports, persistence and related FIDE/recovery behavior; the clean release additionally passed its 318-test tournament/phone/service-control selection.
- 60 native tournament-service tests, with two opt-in live tests skipped; 76 collector tests; 10 default native database-save checks and three atomic-append checks. A final `headless-otb` run also passed both converter integration cases (preserving deliberate removal and refusing a partially parsed database before a successful retry), plus the generated-binding check already included above.
- 51 Node import/FIDE/service checks; 20 clean release controller/worker/broker checks; the isolated real-HTTP Windows-manifest regression; PowerShell launcher safeguards.
- Compiled native-helper RPC smoke verified persistent collection identity and scoped settings.
- Whole-project TypeScript, production Vite builds, native helper/collector builds and the desktop release build passed.

These selections overlap and must not be summed into one distinct-test count. Provider-wide completeness and physical-device interaction are not inferred from fixture passes.

## Source, storage and recovery

Feature milestones are committed on `codex/tournament-phone-parity-20260927` through `42de3de0`. The clean release branch merges the prior live phone source `e92598be` to preserve its service controls and contains the publication fixes. Both branches are pushed. The main checkout's unrelated unfinished Stats/tactics work remains in place; it was not captured in the release.

One sparse task-owned release checkout was used at `../.worktrees/en-tournament-parity-20260927`, with existing dependency and compiler-cache junctions. No full evaluation or OTB corpus was downloaded/copied, and editable libraries were not linked together.

Local compact receipts are retained in the main checkout's ignored `tmp/tournament-port`: `live-receipt.json`, `desktop-receipt.json`, `phone-rollback-receipt.json`, source/worktree preflight records and publication logs. The scoped `phone-rollback` contains the prior code/binary/manifest files only, and the original phone app release is retained. `desktop-rollback/en-croissant-fork.exe` retains the previous desktop executable, SHA-256 `5e113bade15cb6dda47820de724a5798c39e57dda0d7550303085bf2994750ba`. Recovery must preserve the current owner On/Off choice, route ownership and live data; never restore an entire profile or reset Serve.
