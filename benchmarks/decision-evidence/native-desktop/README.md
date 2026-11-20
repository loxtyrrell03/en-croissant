# Windows Decision Evidence verification

This is a desktop regression check of the committed classifier at
`32edca0e`. It opens three PGNs through Files, selects Tactics and checks
the explanations produced by a locally configured Stockfish 19. The rook
ending also uses the live Lichess tablebase. The three selected examples
check the app workflow. The held-out classifier scores are reported in the
separate benchmark directories.

| What was checked | Evidence in the app |
| --- | --- |
| Position character | Three candidates examined. `...Qc8` allows `Nxb5`. The better `...Nxd4` removes the knight that would make that capture. |
| Move justification | `...Bxe5` is Mixed. The tactical certificate and the strategic interpretation about `...d4` have separate labels. Both continuations show the pawn advance. |
| Mistake mechanism | The tablebase shows 3 of 19 legal moves draw, namely `Rg6`, `Rg7` and `Rg8`. The hypothetical `Kf1` goes from draw to loss because it lets Black play `...e2+`. |

[Run receipt](receipt.json) ·
[Three-scope accuracy audit](../current-classifier-audit/README.md) ·
[Neural shortlist comparison](../maia-branch-probe/README.md)

## Reproduce on Windows

Use a task-owned directory outside the installed app and the development
checkout. The archive, QA identity and WebView profile keep the run's files
and preferences isolated. The fixtures come from the checked-in public
benchmark records. Use the local repo dependencies, Python with python-chess,
Stockfish 19 and an existing Playwright installation. WebView2 exposes the
native renderer to Playwright on a temporary loopback port.
[Playwright WebView2 documentation](https://playwright.dev/docs/webview2)

From the repo root, set `$decisionQa`, `$decisionFish` and `$decisionPlaywright`
to the absolute QA directory, Stockfish executable and Playwright's
`index.mjs`. Use a new source folder for the archived revision.

```powershell
$decisionRepo = (Get-Location).Path
$decisionHash = git rev-parse 32edca0e
New-Item -ItemType Directory -Path "$decisionQa/source"
git archive --format=tar --output="$decisionQa/source.tar" $decisionHash
tar.exe -xf "$decisionQa/source.tar" -C "$decisionQa/source"
Remove-Item -LiteralPath "$decisionQa/source.tar"
Set-Content "$decisionQa/revision.txt" $decisionHash -Encoding ascii
New-Item -ItemType Junction -Path "$decisionQa/source/node_modules" -Target "$decisionRepo/node_modules"
python benchmarks/decision-evidence/native-desktop/prepare.py $decisionQa $decisionFish

Push-Location "$decisionQa/source"
$env:CARGO_TARGET_DIR = "$decisionQa/target"
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '4'
$env:VITE_EN_CROISSANT_HOME_BUILD = '0'
node node_modules/@tauri-apps/cli/tauri.js build --no-bundle --config "$decisionQa/tauri.qa.json"
Pop-Location
node benchmarks/decision-evidence/native-desktop/verify.mjs $decisionQa $decisionPlaywright
```

The checker saves the visible evidence, elapsed time and renderer version
to the QA directory. It checks that the four app directories resolve to
that run's fixtures before opening a game. The check timings include
opening the Tactics tab and running the selected analysis. The endgame
timing also includes the online lookup. App startup and compilation are
outside those timings. The installed release is outside the scope of this
check.

## Capture-order scenarios

Use revision `8bb06b6f` in the same isolated build workflow. Choose
`Finnish Capture Order`, `Asian Capture Order` or `Sardinia Capture Order`
as an argument after the Playwright entry point. These cases check the
mixed position, a move-order explanation on a played mistake, and the
engine label when a separate local proof is also present.
All three scenarios and the three earlier checks passed on the v56
isolated Windows build. [Run receipt](../checking-capture-order/windows.json) ·
[Classifier benchmark](../checking-capture-order/README.md)

Revision `27580772` adds `Berjaya Checking Defence` for the same reply
after the better move and `La Roda Checking Defence` for removing the
original checker after analysing a played move. Both ran with real
Stockfish and joined the three passing capture-order checks.
[Run receipt](../checking-order-defences/windows.json) ·
[Held-out benchmark](../checking-order-defences/README.md)

Revision `9adb8b38` adds `Quiet Counterattack`. The native
test shows h3 and Qg3 with an engine-supported explanation and
the conditional scope note in both sections. The Finnish and
Berjaya scenarios also pass on this revision.
[Run receipt](../quiet-reply-counterplay/windows.json)

Revision `893c9234` adds `Amager Defender Capture`. The native
app displays the exact captures and the conditional scope in both
the position and move sections. The exploratory `Ganja Defender
Capture` case stays unclear at the normal live search budget. The
fixed-budget replay finds its ordering after the different reply
`...Rb8`. The earlier Finnish and quiet counterattack scenarios
still pass. [Run receipt](../cached-capture-selection/windows.json)

Revision `9812c1bf` adds `Chile Passed Pawn`, `Passed Pawn Handoff`
and `Direct Pawn Blockade`. The live Chile scenario checks separate
tactical and positional evidence in the mixed position and move.
The live engine can support the tactic through either `...Bxe3`
or the cached comparison involving `...Bxf2`. The handoff checks
`...Rf8` and `...Nf7` against the f6 pawn. The direct blockade
checks `Kf2` against the f3 pawn. All three passed with real
Stockfish alongside the Amager scenario.
[Run receipt](../passer-role-contrasts/windows.json) ·
[Held-out benchmark](../passer-role-contrasts/README.md)

Use revision `9ebfae26` for the `Rear-Piece Trade` scenario.
Pass the name after the Playwright entry point. It analyses the
last move `...Rf6` with live Stockfish and checks that the
mistake still explains `Bxe7 Rxe7 Qxd6`. The equal rear-piece
exchange no longer appears as a skewer. `Chile Passed Pawn`
also passes on this build. [Run receipt](../shared-ray-mistakes/windows.json)

Revision `cd14819e` adds `Aligned Queen and Rook` and
`Promotion Diverts the Knight`. Run either scenario by passing its
name after the Playwright entry point. These checks compare the
same reply after the played and better moves, using live Stockfish.
Both passed alongside the rear-piece trade regression.
[Run receipt](../shared-ray-mistakes/transfer-windows.json)

Revision `46c70780` adds `Played Pawn Lock`. It selects the
actual `h4` outside Stockfish's shortlist and checks its strategic
evidence independently of the evaluation loss. The live promotion
diversion regression also passed on this build.
[Run receipt](../annotation-transfer/windows.json)

Revision `7a11ac6a` adds `Knight Keeps the Pawn Chain` and
`Queen Keeps the Pawn Chain`. Both verify mixed position and
candidate summaries and the two capture routes with live Stockfish.
The played-pawn-lock scenario also passed on this build.
[Run receipt](../capture-route-structure/windows.json)

Revision `de9b92f1` adds `Castle Before the Check`. The native
test explains the actual `...c6` mistake using both the forced
king move and the independent `...O-O-O Nd6+ cxd6` line.
The queen and played-pawn-lock scenarios also pass.
[Run receipt](../castling-interruption/windows.json)
