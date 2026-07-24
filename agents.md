# AGENTS.md

- On 2026-07-24, the lawful opening-book corpus gained a schema-v2 concrete
  line index. Figurine/SAN notation and nested variations are replayed from
  rooted positions; every accepted ply stores SAN, UCI, before/after FEN,
  source page/chunk, and confidence, while unrooted, ambiguous, or illegal
  fragments remain explicitly unresolved instead of being guessed. The
  installed excerpts currently yield 3,399 variations/illustrative games,
  67,054 source-linked materialized line plies, and 8,000 exact positions with
  zero broken chains or foreign-key failures. Both native and PC-hosted phone
  coaches compare the user's game positions with this index before GPT-5.6 Sol
  chooses categories/books/chapters, prioritize diversified exact matches, and
  tell the model whether the game followed or diverged from the cited book
  move. Source cards carry the full real title/chapter/citation and exact book
  PGN. Both coach UIs render saved key-game and cited-book positions as
  read-only boards with next-move arrows and backward/forward controls; old
  saved answers migrate with empty line arrays. Preserve legality-checked
  provenance, AI chapter selection, source/engine separation, lawful-content
  boundaries, diagram navigation, and persistence compatibility. User-owned
  full editions must enter through the same pipeline rather than fabricated or
  unlicensed text.

- On 2026-07-21, AI Coach reviews became background-safe across both shipped
  surfaces. Phone review jobs are owned by the gaming-PC home server, are no
  longer aborted when the browser request disconnects, and atomically save the
  completed structured answer into the PC review store before reporting
  success. Reopened phones poll that store while a replacement review is still
  pending, including when an older saved answer exists. Native fork close/quit
  requests during an active coach run now hide the window, let the existing
  process finish and save the adjacent coach sidecar, then exit. Preserve the
  PC-owned lifecycle: client disconnect, panel unmount, window close, and menu
  quit must never cancel or discard an in-progress coach review.

- On 2026-07-20, the phone Coach's false `Codex is installed but not signed
  in` warning was traced to two combined faults: its forced submission-time
  `codex login status` process had a five-second deadline and mapped every
  timeout or launch failure to signed-out while a 16-thread engine was active,
  and the phone retained that request error after health recovered. Codex auth
  probing is now tri-state, coalesced, allowed 15 seconds, pinned to the same
  explicit `CODEX_HOME` as model execution, and preserves a confirmed login
  across an inconclusive transient probe; only explicit auth output marks the
  session signed out. The phone retries unavailable health every five seconds
  and clears the obsolete error once readiness is confirmed. Preserve these
  distinctions so compute contention can never masquerade as lost credentials.

- On 2026-07-20, PC-hosted phone changes are not complete merely because they
  build locally. Unless the owner explicitly asks for local-only work, every
  completed phone UI or phone-server change must be committed, published with
  `npm run web:publish-home`, and verified against the live private origin
  before reporting completion. If publishing is genuinely blocked, state that
  prominently instead of implying the change is live. Continue to use the
  clean-source, ancestry, mutex, immutable-release, and health guards below;
  never copy `dist` directly or weaken a guard to force a deployment.

- On 2026-07-20, a separate FastChess hardware match froze the PC-hosted phone
  app by running a 16-thread, 4 GiB Stockfish child at Normal priority. The
  recurring Stockfish remote watchdog now demotes every FastChess process tree
  to Windows Idle priority without stopping the match, allowing benchmarks to
  consume spare compute while always yielding to the home proxy, Tailscale,
  and shared phone engine. All future benchmarks, stress tests, corpus jobs,
  and other bulk compute on the gaming PC must likewise run at Idle or Below
  Normal priority and must not monopolize the interactive phone host at Normal
  or higher priority.

- On 2026-07-20, the phone engine display stopped treating a stored cloud
  evaluation's missing NPS as an unfinished search. Cache hits are labelled
  `PC cloud evals` and show their stored depth in the compact strip; live
  searches identify their source as `PC` or `Local phone` and continue to show
  depth, total nodes, and NPS. The full Engine panel always reserves visible
  metrics for Eval, Depth, Nodes, and NPS, and each line keeps its source,
  depth, and node count. These source labels supersede the historical `PC
  cache`, `PC live`, and `Phone fallback` UI-label requirements below while
  preserving the same authoritative PC cache-first execution policy.

- On 2026-07-20, the phone evaluation rail stopped resetting to an artificial
  50/50 position whenever the board moved ahead of the next engine result. It
  retains the last known score during the cache/live loading gap and updates
  when the new position produces a result. Engine arrows remain strictly
  scoped to their analyzed FEN so moves from the prior position are never
  drawn on the new board.

- On 2026-07-20, the lawful chess-book corpus was wired into both AI Coach
  surfaces. The desktop Rust coach now performs native, diversified FTS5
  retrieval from the local corpus, sends up to six page-bounded passages to
  the existing model/Stockfish coach, and returns source objects
  separately so the UI shows exact excerpts, chapters, printed/PDF citations,
  and local PDF controls. The PC-hosted phone gained a fifth `Coach` board tab
  backed by private `/api/chess-coach`, `/api/chess-coach/health`,
  `/api/chess-books/search`, and byte-range `/api/chess-books/pdf` routes. A
  game review scans the PC's stored evaluations cache for the selected side,
  ranks centipawn-loss moments, retrieves the same citation-safe passages, and
  sends both evidence classes to a local, authenticated `codex exec` run using
  explicit `gpt-5.6-sol` at medium reasoning. The Codex run is ephemeral,
  read-only, ignores user config and rules, and is told to use no tools; it
  receives only the prepared prompt evidence. This owner-requested provider
  change supersedes the historical phone-coach Gemini and Antigravity pins
  below. It never launches a live full-game Stockfish sweep. Keep
  engine verdicts and book principles distinct, preserve `[Book N]` mappings,
  never expose local paths or full book text to the phone, keep all coach/book
  APIs restricted to the private origins, and disable phone submission until
  `codex login status` confirms the PC's saved ChatGPT authentication.

- On 2026-07-20, the native En Croissant AI Coach also moved completely from
  Gemini/Antigravity to the locally authenticated OpenAI Codex CLI. Its main
  answer, Stockfish planner, chess-fact planner, repair/audit passes, opponent
  prep prose, and inline plan reports are all owner-pinned to explicit
  `gpt-5.6-sol` with medium reasoning. Codex runs ephemerally in a temporary
  directory with read-only sandboxing, ignores user config and repository
  rules, and receives only the prepared prompt evidence. New storage keys set
  the command to `codex` and prevent saved `agy` or old planner-model values
  from remaining active. Legacy Gemini-named Rust/TypeScript fields and the
  dormant AGY compatibility branch may remain for binding and migration
  safety, but no shipped coach surface may select them. This instruction
  supersedes every historical desktop Gemini/Antigravity model pin below.

- On 2026-07-20, the owner retired the GitHub Pages phone site and fallback.
  This instruction supersedes every historical Pages, `web:publish`,
  `web:push`, web-sync, and fallback-publishing note below. Do not publish the
  app or hosted library to `loxtyrrell03.github.io`, do not reinstall its sync
  task, and do not re-enable Pages. The phone app is PC-hosted only and phone
  changes are deployed exclusively with `npm run web:publish-home`.

- On 2026-07-20, PC phone publishing was made parallel-agent-safe after a stale
  detached worktree finished several minutes after a newer publish and rolled
  the live site back to an older mixed feature set. Home publishes take one
  machine-wide mutex, require a clean committed source, recheck that source
  after the build, stamp every app-shell file into `app-version.json`, and
  reject any source commit that is not a descendant of the active deployment.
  PC app shells deploy into immutable release directories selected by one
  atomic pointer; the home server serves the active release separately from the
  mutable hosted library, so an obsolete script copying into the legacy site
  directory cannot alter the running phone UI. The home-server runtime has a
  stable installed path across worktrees, and each source commit stamps a new
  service-worker cache that reloads open clients on activation. Parallel agents
  may build and commit independently, but a publisher must first integrate the
  live deployed commit; never bypass these guards or publish by copying `dist`
  directly.

- On 2026-07-20, phone Stockfish analysis became a board-wide session instead
  of belonging to the Engine tab. Switching among Moves, Database, Prep, and
  the full Engine view no longer unmounts or cancels the current PC search;
  every non-engine tab carries a compact always-available strip with an
  on/off switch, live NPS, the top three moves, and their White-relative
  evaluations; the full Engine view also exposes NPS as a header metric.
  Live engine arrows also remain visible across those tabs. The phone board
  now has the fork-style 25 px evaluation rail on its left, oriented with the
  board and driven by the same top line as the strip. Its visible score uses
  the fork's compact one-decimal format so it cannot overflow the narrow rail,
  while the accessible label retains the precise evaluation. Keep one engine
  component mounted across board-panel changes so future UI reshuffles cannot
  reintroduce cancellation or duplicate Stockfish requests.

- On 2026-07-20, phone Database and Prep lookups were moved onto the gaming
  PC after Lichess All appeared to hang between positions. The visible delay
  came from blocking the move table on a serialized one-request-per-second
  cloud-eval sweep over as many as 20 child positions. Online explorer data
  now goes through `/api/lichess-explorer`, where the shared PC credential is
  applied privately, identical in-flight requests are collapsed, results are
  cached in memory and on disk with stale-while-revalidate, and the next three
  likely child positions are prefetched. The phone waits at most 75 ms for a
  PC-stored strength evaluation and never performs the old child-eval sweep;
  practical move statistics render first. Lazy local Database and Prep sources
  now query the PC's precise `/api/database-position` index before falling back
  to a static shard, with browser and server LRUs. Live tests measured eight
  concurrent cold Lichess requests as one upstream request returning in 132 ms,
  a 16 ms warm hit, and En Croissant database queries at 130 ms cold / 18 ms
  warm. Keep explorer response latency independent of strength enrichment and
  verify both caches, request coalescing, direct-Lichess fallback, and a zero
  Stockfish queue before publishing future phone builds.

- On 2026-07-20, the phone online-game importer moved out of the under-board
  tool row and into the sticky top navigation beside `Board` and `Files`. Its
  clearer `Import Online` label opens the existing Chess.com/Lichess game
  picker, while the under-board row is reserved for board analysis tools.

- On 2026-07-20, the PC-hosted phone Files browser became genuinely lazy and
  cache-backed. Ordinary navigation now requests only the current directory,
  reuses visited listings in the phone session, and fetches recursive file
  metadata only when a folder is opened as PGNs or imported as a database. The
  home server parses the published manifest once, builds a directory index at
  startup, and reuses it until the manifest timestamp or size changes; library
  refreshes clear and pre-warm that index after the atomic directory swap. On
  the live 2,298-file library this reduced the root response from a 1.4 MB,
  roughly 1.5-second full-manifest request to a 3 KB directory response in
  roughly 3 ms. Keep the scoped-query compatibility fallback for GitHub Pages
  and older home-server builds, and retain tests proving directory requests do
  not include descendants while recursive imports do.

- On 2026-07-20, PC phone publishes were hardened against stale home-server PID
  files. A forced restart now resolves the actual listener on the configured
  port, stops it only when its command line matches this home-server script,
  refuses to replace unrelated listeners, and accepts startup health only from
  the new process ID. This prevents a dead replacement process from being
  mistaken for a successful deploy because an older server still answered.

- On 2026-07-20, the PC-hosted phone Files view was simplified into one
  readable filesystem browser. The duplicate browser-cache manager was
  removed from the page; folders now lead the current directory followed by
  its PGN/PDF files, with larger type, icons, tap targets, clear back/refresh
  controls, and an optional `Open all PGNs` action inside multi-PGN folders.
  Individual hosted PGNs, uploaded one-game PGNs, and one-off Chess.com or
  Lichess games opened for analysis remain available on the board but are
  deliberately excluded from Database and Prep source pickers. Existing
  one-game online-analysis records from the earlier behavior are recognized
  and hidden as well.

- On 2026-07-20, Lichess authentication became one-time and shared across the
  PC-hosted phone app, the GitHub Pages fallback, En Croissant, and Outpost.
  Moving the phone site between origins had exposed the old design flaw: its
  token lived only in origin-scoped browser storage, while each desktop app
  used a separate WebView profile. The private gaming-PC home server is now
  the authoritative credential store at
  `%LOCALAPPDATA%\EnCroissantHomeServer\credentials\lichess.json`; the existing
  valid `lachlan1415` session was migrated there without exposing its token.
  Phone startup silently hydrates that credential before rendering Prep, and
  both desktop shells hydrate their normal Lichess session on mount. Future
  OAuth completion from any surface validates the account against Lichess and
  updates the same store. The phone UI no longer exposes bearer-token, forget,
  or routine relink controls: it shows a quiet `Lichess saved` state, with a
  one-time connect action only when no shared credential exists. The sensitive
  API restricts browser CORS to the private phone origin, the Pages fallback,
  and the two Tauri origins; persistence survives server restarts and origin
  changes until the user explicitly revokes the Lichess token.

- On 2026-07-20, the remaining phone cache-miss delay and accidental phone
  fallback were removed. The root causes were synchronous read/decompression
  of 24 MiB stored-eval shards on the Stockfish HTTP control loop and running
  all 16 Stockfish threads at Windows High priority, which could starve the
  home proxy, Tailscale, and ordinary clients for 2.4-2.7 seconds. Stored-eval
  shard I/O and Zstandard decompression are now asynchronous and de-duplicated,
  with a 512 MiB shard LRU, so cache work cannot freeze live-engine control.
  The backend remains High priority but Stockfish children use Above Normal:
  controlled testing retained roughly 8.1-9.1 million NPS at depth 21 while 18
  rapid PC starts averaged 23 ms with a 105 ms maximum, versus repeated
  multi-second stalls at High. The home proxy runs at Normal priority, flushes
  streamed headers immediately, disables Nagle on its upstream socket, and
  treats expected client cancellation as a clean completion. When the private
  PC origin is configured, browser Stockfish now makes two PC attempts with a
  short retry and a four-second first-line guard, then reports a PC error;
  it never instantiates bundled phone Stockfish automatically. A 20-position
  cold cache-miss/cancel stress run through the real private HTTPS origin had
  151 ms average stored-eval lookup, 145 ms average first PC depth, 556 ms
  worst first depth, and a final backend queue of zero. Keep regression tests
  for PC-only retry/failure, cache-before-live ordering, prompt streamed starts,
  and queue drainage.

- On 2026-07-20, phone analysis made the gaming-PC eval store authoritative
  and cache-first. Every position now completes its stored-eval lookup before
  any engine request: a hit is the final result and never starts Stockfish on
  top, while only a confirmed miss or failed lookup can proceed to `PC live`
  and then `Phone fallback`. Known game lines prefetch the next three positions
  sequentially into a 160-position browser LRU, so normal forward review is a
  memory hit; position changes may join the same in-flight lookup without
  spawning live analysis. With Stockfish idle, six cold consecutive opening
  positions measured 93-107 ms direct and warm private-origin requests were
  about 37 ms, so the old ten-second concurrent deadline was replaced by a
  two-second failure deadline. The UI continues to identify `PC cache`, `PC
  live`, and `Phone fallback` honestly. The private backend still raises every
  Stockfish HTTP/UCI child to Windows High priority, and controlled trials keep
  16 threads with a 512 MiB hash. Do not smooth or inflate NPS; regression
  testing must prove that cache hits make no `/v1/analyze` request, misses are
  ordered cache-before-live, cancellations cannot start live work, prefetched
  positions are reused, and backend queues drain to zero.

- On 2026-07-20, the lawful AI Chess Coach library gained a reproducible local
  ingestion and retrieval layer under
  `C:\Users\loxty\Documents\EnCroissant\AI Chess Coach Library\00 AI Corpus`.
  `scripts/build-chess-book-corpus.py` now extracts and cleans all 95 installed
  publisher-excerpt PDFs into book, page, chapter, and page-bounded chunk
  records; performs local RapidOCR on the image-only *Modernized Sicilian Kan*;
  removes private-use diagram-font noise while retaining visual-fallback flags;
  preserves exact PDF and supported printed-page citations; and writes portable
  JSONL plus a SQLite FTS5 database with local 384-dimensional
  `BAAI/bge-small-en-v1.5` embeddings. The current corpus has 103 book records,
  1,561 pages, 3,322 chapter entries, 1,609 chunks and matching embeddings, 22
  OCR pages, zero extraction/OCR/citation/orphan failures, and no control or
  private-use characters in searchable text. `scripts/search-chess-book-corpus.py`
  provides diversified FTS, semantic, and hybrid retrieval;
  `scripts/render-chess-book-page.py` supplies exact visual pages for diagrams;
  and `scripts/test-chess-book-corpus.py` passes calculation, exchanges,
  defence, rook-endgame, and computer-chess retrieval checks. The implementation
  and rights boundary are documented in `docs/chess-book-corpus.md`. This makes
  the excerpt corpus AI-retrieval-ready, but the En Croissant coach UI is not
  wired yet and full-book coverage still requires lawfully acquired editions.

- On 2026-07-20, the complete lawful chess PDF shelf was added to the live
  private Jellyfin server as a dedicated `Chess Books` library. It points
  directly at
  `C:\Users\loxty\Documents\EnCroissant\AI Chess Coach Library`, so the source
  files are neither copied nor moved. Jellyfin 10.11.11 completed its media
  scan and indexed all 97 PDFs: the 95 installed publisher excerpts plus the
  complete-library and opening-shelf catalogues, with zero missing or extra
  book records. The `loxty` administrator retains all-library access, and an
  authenticated byte-range download of a PDF succeeded through the private
  `https://gaming-pc.tail89d19b.ts.net:10000` phone endpoint.

- On 2026-07-20, the Jellyfin `Chess Books` shelf gained persistent cover art
  after all PDF entries appeared as blank placeholders. The reproducible
  `scripts/build-jellyfin-chess-book-covers.py` workflow now reads the catalogue,
  retrieves and validates real product artwork, records reviewed overrides for
  five retired or generic product links, and uses a rendered PDF front page only
  as a final fallback. It writes same-basename JPEG sidecars beside the PDFs,
  refreshes Jellyfin through its normal API without storing credentials, and
  records provenance, dimensions, hashes, and verification in
  `00 Master Library Guide/Jellyfin cover report.json`. The completed shelf has
  95 recognisable book covers plus two designed catalogue covers; visual QA
  caught and corrected one stale Yearbook image, all 97 Jellyfin entries expose
  a primary image, and all 97 exact images were fetched successfully through the
  private Tailscale phone endpoint. Cover art remains private and must not be
  redistributed.

- On 2026-07-20, phone Stockfish startup and cancellation were hardened after
  abandoned browser requests accumulated in the single-engine queue and the
  Windows task launched the server and engine at Below Normal priority. The
  home proxy now destroys its upstream request when the phone response closes,
  the watchdog repairs task/process priority to Normal and restarts an
  implausibly backed-up idle service. A short-lived policy started the live PC
  request before the stored-eval preview; the authoritative cache-first policy
  at the top of this file supersedes that behavior. The gaming PC keeps
  all 16 threads but now uses a 512 MiB hash, which benchmarked faster than the
  previous 2 GiB allocation and cuts cold initialization cost. Phone engine
  depth is capped at 70 again, with a persistent `Infinite depth` toggle that
  sends a true infinite UCI search to either the PC or phone fallback until the
  user pauses it or changes position. Cancellation stress tests must leave
  `queuedAnalyses` at zero before this path is considered healthy.

- On 2026-07-20, the gaming PC became the primary phone-app host over private
  Tailscale Serve, with GitHub Pages retained as a fallback. The home server
  now proxies `/v1/*` to the local Stockfish 18 service, so the phone UI,
  workspace/database APIs, stored evals, and live engine share one HTTPS
  origin. `npm run web:publish-home` performs a fast app-only build/deploy while
  preserving the large live library, restarts only the home-server process,
  restores private Serve if Funnel was enabled, and verifies both app and
  Stockfish health. Home builds point both server URLs at the PC origin.

- On 2026-07-20, the lawful AI Chess Coach book corpus was expanded from the
  opening shelf into a complete nine-shelf library under
  `C:\Users\loxty\Documents\EnCroissant\AI Chess Coach Library`. The combined
  catalogue now records 103 books: the existing 39 opening titles plus 64
  broad GM-led selections covering strategy, middlegames and pawn structures,
  thinking and calculation, tactics, attack and defence, endgames, practical
  improvement and computer chess, and annotated master games. Thinking and
  calculation is intentionally a first-class shelf rather than being folded
  into tactics, with sources for candidate generation, visualization,
  evaluation, time use, psychology, and training design. Ninety-five official
  publisher excerpts are installed; eight books remain clearly labelled
  acquisition items because no usable authorized excerpt was available.
  `00 Master Library Guide` contains the polished 17-page complete catalogue,
  one machine-readable retrieval manifest, a rights/workflow README, and a
  PDF audit. All 97 local PDFs parse successfully; the previously known
  image-only *Modernized Sicilian Kan* excerpt remains the sole OCR target.
  Full editions must be bought or supplied from copies the user lawfully owns.

- On 2026-07-20, phone analysis was corrected after the restored stored-eval
  path accidentally prevented live Stockfish from starting on every cache hit.
  That intermediate revision treated a PC-stored evaluation as a preview while
  continuing into live Stockfish. It was superseded later the same day by the
  authoritative cache-first policy at the top of this file. Engine rows and
  the header still explicitly distinguish `PC cache`, `PC live`, and `Phone
  fallback`, so verification must confirm the execution source rather than
  inferring it from generic Stockfish output.

- On 2026-07-20, a lawful broad GM-authored computer-era opening-book starter
  shelf was assembled under
  `C:\Users\loxty\Documents\EnCroissant\AI Chess Coach Library\Opening Books`.
  It catalogs 39 respected titles across nine general, White-repertoire,
  Black-defence, and sideline shelves and installs 38 publisher-authorized
  sample PDFs rather than unlicensed scans. `00 Shelf Guide` contains a
  polished acquisition catalogue PDF, machine-readable book metadata, and a
  validation report with page counts, extraction status, sizes, and SHA-256
  hashes. All 39 local PDFs parse cleanly; 37 of the 38 book samples have
  extractable text, while the official *Modernized Sicilian Kan* sample is
  image-only and is explicitly flagged for future OCR. Berg's French Defence
  Volume One remains an acquisition-only catalogue slot because no official
  PDF excerpt was offered. Full editions must come from books the user buys or
  already owns, and the local corpus must not be redistributed.

- On 2026-07-20, the phone board gained a compact `Analyze` panel for public
  Chess.com and Lichess games. Each provider remembers its own username;
  `Analyze last game` opens the newest game immediately, while `Choose a game`
  shows recent games in a small expandable list. Chosen games are indexed in
  browser storage, open at move one with the board oriented to the account's
  side, switch directly to the Engine panel, and start Stockfish 18. The
  existing remote-first engine, bundled fallback, and blue/pale-blue arrow
  hierarchy remain unchanged.

- On 2026-07-20, the phone's stored cloud-eval path was restored after a
  later Stockfish publish accidentally skipped it. Phone analysis now queries
  the gaming PC's `/v1/cloud-eval` endpoint first, converts a hit into the
  normal engine lines/arrows, and only starts remote Stockfish (then bundled
  WASM fallback) when no stored evaluation exists or the lookup fails. The
  duplicate-root-move filter and blue/pale-blue arrow hierarchy remain layered
  on the resulting lines.

- On 2026-07-20, the Southall Congress app-side prep layout was flattened at
  the user's request. All 13 OTB and online-account databases, their matching
  PGNs, search indexes, and import metadata now live directly in
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Southall Congress 260620 U2400`
  rather than six per-player subfolders. The Southall manifests and layout
  notes were updated to the new paths; the event folder remains active and was
  not archived.

- On 2026-07-20, transient duplicate top moves in the phone Stockfish table
  were traced to mixed-depth MultiPV snapshots: Stockfish updates one rank at
  a time, so a newly ranked move could briefly duplicate the stale next rank.
  Every streamed update now deduplicates by root UCI move, preferring the
  deepest result and then the better rank, before feeding both the table and
  board arrows.

- On 2026-07-20, the phone engine-arrow styling was restored on top of the
  remote-first Stockfish build after a publish from an older checkout briefly
  replaced it. The best MultiPV move uses the strong blue brush, alternative
  moves use pale blue, and the existing win-chance-based widths remain intact.
  The combined GitHub Pages bundle was verified to contain both this arrow
  hierarchy and the gaming-PC Stockfish endpoint; future phone publishes must
  preserve both changes together.

- On 2026-07-20, the shared Stockfish 18 service was restored for the laptop
  and phone. The UCI listener now binds directly to the gaming PC's private
  Tailscale address because the former TCP Serve hop accepted and immediately
  closed raw UCI connections; the laptop uses a repaired remote-client relay
  under its existing engine ID and retains its local Stockfish fallback. The
  phone engine is remote-first through the private HTTPS analysis endpoint and
  falls back to its bundled WASM engine when the PC is unavailable. A recurring
  `Stockfish18RemoteWatchdog` task checks the backend every two minutes and
  restarts it after a failure.

- On 2026-07-20, the remaining intermittent white startup was traced to the
  lazy locale initialization being awaited without a deadline before React
  rendered anything. Startup now paints a dark progress surface immediately
  and caps the locale wait at two seconds; a slow or failed translation chunk
  can no longer strand the Tauri window on a permanent white page.

- On 2026-07-20, the genuinely empty Files page was traced to Windows Documents
  redirection rather than missing or archived data: Tauri resolved Documents to
  the empty `C:\Users\loxty\OneDrive\Documents\EnCroissant`, while the real
  5,296-PGN library remained at `C:\Users\loxty\Documents\EnCroissant`.
  Directory resolution now detects an empty redirected default (including a
  cached copy of that default) and selects the populated local Documents
  library, while continuing to preserve explicit custom directories.

- On 2026-07-20, Files visibility recovery was completed after the same parity
  smoke test that redirected the libraries was found to have archived the real
  `Ifan prep` and `Oxford FIDE Congress U2300 player games` folders in the
  production WebView profile. A one-time migration now restores only those two
  known test-toggled entries while preserving every other user archive choice;
  all 5,296 PGNs and their metadata remained intact on disk.

- On 2026-07-20, the live fork launcher stopped opening a permanently white
  Tauri window during a cold Vite start. Listening on port 1420 is no longer
  considered sufficient readiness: `scripts/launch-fork.ps1` now fetches and
  validates the real entry HTML before opening the native shell, warming the
  initial transform that can be delayed by the large hosted phone library.
  The React entry point also renders a readable startup failure instead of a
  silent white page if a future module import fails.

- On 2026-07-19, Outpost recovered apparently missing desktop libraries caused
  by a parity smoke test persisting its disposable `outpost-fork-parity-*`
  database, file, engine, and puzzle directories in the real WebView local
  storage. The app now rejects and clears those ephemeral overrides at startup,
  returning to the normal `%APPDATA%\org.encroissant.app` and
  `Documents\EnCroissant` roots without moving or deleting user data.

- On 2026-07-17, Outpost development storage was recovered after 15 separate
  repo/worktree checkouts accumulated independent Rust `src-tauri/target`
  trees. Cargo now uses the user-level shared target directory
  `C:\Users\loxty\.cargo\shared-target`, and `scripts/safe-dev.ps1` limits
  dated shared-data backups by both count and total size, skips oversized
  generated review sidecars in normal backups, and supports cleanup-only
  pruning for backups and stale large agent scratch databases. Compact backups
  exclude the required multi-gigabyte local Lichess evaluation store; the live
  store is preserved, while intentional full backups may include it. This
  prevents native builds, safety snapshots, and temporary database probes from
  multiplying into hundreds of gigabytes while retaining the newest backup.
- On 2026-07-17, Outpost learned setup families gained conservative offline
  opening-book names and Engine Plans recovered valid multi-route setups
  without weakening the two-route invariant. Book matches come only from
  normalized positions actually reached while a main route completes in
  exact-core observations. A same-side live footprint rejects labels donated
  by optional developed minors, queen/rook moves, variants, or root-only
  context; Plan Explorer requires agreement in every material opponent-reply
  bucket (including aggregated small replies), while Engine MultiPV requires
  unanimity because it has no independent reply tree. Matches remain
  display-only metadata that cannot merge families, add arrows, alter ranking,
  or affect strength; ambiguous and uncovered positions stay `Thematic setup`.
  Engine Plans now recommends five PVs, may treat one exact PV as
  low-confidence co-occurrence evidence, selects one complete representative
  bundle rather than unioning
  partial lines, and preserves curated named setup milestones through later
  exchanges. Root context still never qualifies a setup; pawn lineage and
  exact actor survival prevent captured pawns or replacement pieces from
  fabricating opening structures, and every displayed main route must coexist
  in one supporting observation.
- On 2026-07-17, Outpost setup discovery was widened without restoring subset
  noise. Plan Explorer now spends its crawl budget on representative deep
  continuations, measures family share only against branches deep enough to
  reveal the identity, canonicalizes transposed opponent structures, folds
  named subtypes into parents when both occur, and quality-selects at most six
  diverse families per side. Every rendered setup must contain at least two
  distinct compatible main routes: root context may name a family but cannot
  qualify it, and optional, reply-only, or choose-one moves do not count.
  Learned families are built only from new future targets; named Sicilian
  families cover the Closed Sicilian, Grand Prix, Open Sicilian, Alapin, and
  major Black structures from a matching `1.e4 c5` environment, with Alapin's
  `c3` structure taking precedence over the broader Open-Sicilian matcher.
  Root setup anchors count only while their target state remains on the board.
  Plan Explorer setups now use a compact four-column expandable table (`Setup`,
  `Blended strength`, `Games`,
  `W / D / L`) with Prep-style sortable headers; the blend combines shrunken
  exact-setup results with exact engine backing and clearly falls back to
  practical-only. Engine Plans uses a simpler three-column engine-only table
  because root-move practical results are not setup evidence. Technical reach,
  joint-core, and reply details remain behind expansion/tooltips rather than
  becoming permanent columns.
- On 2026-07-17, Outpost Plan Explorer and Engine Plans replaced flat
  fixed-size setup unions with one shared target-state family miner. Nested
  subsets now collapse into exclusive named or learned themes with a natural
  identity/core, horizon-aware additions, choose-one variants, and nested
  opponent-reply modules; defence names also require the matching opponent
  structure. Plan Explorer measures reply robustness from the family identity
  rather than reply-specific extras, while Engine Plans explicitly leaves it
  unmeasured until independent reply trees exist. Setup strength now uses the
  exact final-state core occurring together in the same PVs, weighted CP loss
  from those joint lines, reliability-shrunk exact-core practical results, and
  separate reach/cohesion/reply-confidence signals. This avoids fabricated
  arrows, pass-through target evidence, subset noise, and WDL/engine evidence
  being conflated into one unsupported claim.
- On 2026-07-17, Outpost Prep's color controls now consistently say `I'm
  white` and `I'm black`. Opponent Prep mirrors those choices into its internal
  opponent-color filter, so the label, selected state, and queried games all
  describe the user's own side rather than the opponent's side.
- On 2026-07-17, Outpost Opponent Prep now refreshes the opponent field on
  every local database change. The previous database's player is cleared while
  the lookup runs, the selected database's most common player is applied, and
  stale lookups cannot overwrite a newer selection or a name typed while the
  current lookup is in flight.
- On 2026-07-17, Outpost Prep stopped selecting or querying a database when a
  Prep panel opens. Player and General Prep now begin in an explicit blank
  state, show a clear prompt instead of a loading move table, and include a
  `No database selected` choice so any active database can be deselected and
  returned to the idle state. Prep source choices are intentionally
  session-only so reopening the panel never silently reloads prior evidence.
- On 2026-07-15, the Outpost desktop live launcher was recovered after Vite
  began watching the 20 GB native `src-tauri/target` tree and stalled before
  Tauri could open the window. Outpost's Vite configuration now excludes that
  generated tree, reducing the live server from roughly 37,000 handles to
  roughly 1,900. The in-progress deterministic OTB importer also received its
  missing Tokio time and Reqwest JSON/query/form features so the native build
  succeeds; the real desktop shortcut was relaunched and verified with a
  responsive `Outpost` window.
- On 2026-07-13, the Home `Import player games` dock was promoted above Daily
  Goals so the unified Chess.com, Lichess, and OTB database workflow is visible
  immediately. Its copy now frames the action around gathering one player's
  games, and a real low-memory Tauri build plus Computer Use accessibility
  inspection verified the dock, source labels, primary action, and Home order.
- On 2026-07-13, the deterministic OTB collector broadened its public-source
  coverage with FIDE-verified Chessscope broadcast discovery, the current and
  legacy BritBase hosts, and tightly filtered PGN Mentor event/player files.
  Initial-heavy identities such as `Sooraj M R` now match safely, every new
  lane still passes through the existing OTB filter, provenance, and
  move-sequence dedupe, and a failed or slow archive remains isolated to that
  source report. PGN Mentor discovery is surname-scoped before download so
  common forenames cannot trigger large unrelated player collections.
- On 2026-07-12, Home gained a polished `Import games into a database` dock
  above the general action grid. Its unified modal offers Chess.com, Lichess,
  and OTB source lanes: online accounts reuse the existing standard-game
  download, dedupe, auto-update, and database conversion pipeline, while OTB
  reuses the deterministic multi-source collector and is forced to persist a
  real database from this Home workflow. The card uses restrained source marks,
  progressive disclosure, responsive layout, and reduced-motion-safe hover and
  selection feedback rather than adding another generic dashboard tile.
- On 2026-07-12, Opponent Prep gained a separate deterministic `Find OTB
  games` importer. It searches Chess-Results by FIDE ID, current and monthly
  Lichess broadcasts, public ChessBase news-site PGNs, TWIC, official
  tournament-organiser PGN indexes (beginning with the 4NCL archive), and
  optional user PGN/ZIP/ZST sources; personal Chess.com/Lichess account games
  remain a separate importer and are never merged. The collector preserves
  per-game source provenance, filters explicit online events, resolves identity
  by FIDE ID plus exact normalized names, and deduplicates conflicting copies
  by their mainline moves. Regression audits found five public additions over
  Sameera Kodukula's 33-game baseline, nine over Alexey Lapidus's 112 genuinely
  unique games (the 129 source records contained repeated movetext), and no
  additions over Peter Large's 650 unique games among 776 source files.
- On 2026-07-12, Database move-quality scoring was corrected so the exact
  position's root evaluation remains the authoritative best-move baseline.
  Independently cached child-position evals may fill omitted rows but cannot
  displace the root PV, engine CP loss always uses the actual side to move
  rather than the selected WDL perspective, and displayed numeric evals remain
  White-relative to match the Analysis panel. The `1.e4 ...e5` regression now
  guarantees that the root-best `...e5` is zero-loss and Strong.
- On 2026-07-12, databases and database folders gained reversible archiving.
  The Databases library now separates Active and Archived views, exposes
  archive/restore actions on database cards, database settings, and folder
  menus, inherits archive state through nested folders, and keeps archived
  databases out of normal pickers and automatic update discovery without
  moving or deleting their files.
- On 2026-07-12, Plan Explorer WDL bars were unified with the Database move-table bars through a shared `DatabaseWdlBar` component. Plan rows now use the same theme-aware white/draw/black styling, decimal percentage labels, sizing behavior, outlines, and side-perspective ordering as Database rows.
- On 2026-07-12, Plan Explorer plan routes became true table rows with
  adjacent Share, Games, and full-size W/D/L columns. Routes are ordered by
  the current blended-strength score, so hovering a piece on the board previews
  the same clearly marked strongest route shown first in that piece's group.
- On 2026-07-12, Outpost General Opening Prep adopted the Database panel's
  visible `Local | Lichess All | Lichess Masters` segmented source selector.
  Local database selection remains available beside it only while Local is
  active, and Opponent Prep retains its player-oriented grouped source picker.

This file is the working product map for the En Croissant fork on the
`codex/en-croissant-fork` branch. It records the major features added during
the recent Codex session and gives future agents the design intent, navigation
model, implementation map, and verification expectations for this app.

## Ongoing Workflow

- Automatically create git commits as work progresses whenever an important,
  coherent milestone has been completed.
- Keep each commit focused on the meaningful progress just made, with a concise
  message describing that milestone.
- After each meaningful change or feature, update this `AGENTS.md` product map
  with a short note explaining what was added and why, so future agents inherit
  the current design intent instead of only the code diff.
- For every phone web companion change, treat publishing to the phone app site
  as part of the done criteria. After the app change is locally verified and
  committed, run `npm run web:publish-home` so the private PC-hosted phone app
  is rebuilt and deployed. This applies to `src/web/**`, browser/PWA startup,
  `public/web-*`, phone-only layout or styling, and any other change whose
  result should appear on the phone. GitHub Pages is retired; never run
  `web:publish`, `web:push`, `web:watch`, or `web:install-sync`.
- PC phone publishes are serialized and fast-forward-only. If a publish reports
  that another publish is active, wait and retry; if it reports that the live
  source is not an ancestor, integrate the deployed commit into the feature
  worktree before retrying. Never bypass the deployment metadata, immutable
  home release pointer, or clean-worktree check.
- If `npm run web:publish-home` fails, or if the user explicitly asks to defer
  publishing, say so in the final response and do not describe the phone app
  change as deployed.
- Do not wait until the end of a long session to save progress unless the user
  explicitly asks for a single final commit.
- Avoid committing broken, half-finished, or unverified work unless the user
  explicitly asks for a checkpoint commit.
- The working tree may contain user changes or local verification artifacts.
  Do not revert or delete them unless the user explicitly asks.

## Agent Playbooks

- Opponent preparation now has a dedicated future-agent playbook at
  `docs/opponent-prep-agent-guide.md`. Whenever the user asks for chess prep
  for a player, opponent, event, congress, tournament, entrant list, or rating
  threshold, read and follow that guide as the workflow source of truth before
  gathering games or creating prep databases. It records the required
  per-player folder/database workflow, mandatory online-source checks for every
  player, default subagent team coordination for hard web searches and
  comprehensive Chess.com account-link research, including club-member and
  rating-plausibility checks, Lichess broadcast PGN extraction pattern,
  mandatory full public Lichess broadcast database filtering, Chess-Results PGN
  search by FIDE ID, Chess.com account-confidence method, low-count second-pass
  checks, final-response count and most-recent-game reporting expectations,
  dedupe rules, and En Croissant verification steps. The Oxford U2300 prep
  showed why agents must finish the full exhaustive source checklist for one
  player before moving to the next instead of doing a shallow global pass.
- Before declaring opponent prep finished, run a canonical player-name audit on
  every prep target in both the per-player PGNs and the matching En Croissant
  `.db3` databases. Check for split identities caused by the same player being
  tagged in both `Surname, Firstname` and `Firstname Surname` order, including
  combined PGNs, archived/source PGNs, app-side source PGNs, and `Players` rows
  referenced by `Games.WhiteID`/`Games.BlackID`. If a split is found, normalize
  the PGN `White`/`Black` tags and generated game titles to the folder/database
  canonical form, merge duplicate database player rows into the canonical row,
  clear any stale search indexes for the changed database, and re-run the audit
  until there are zero remaining target-name splits. The Oxford U2300 cleanup
  examples were `Josh Sharma` -> `Sharma, Josh`, `Peter G Large` ->
  `Large, Peter G`, `Arya Cont` -> `Cont, Arya`, `Adam Sieczkowski` ->
  `Sieczkowski, Adam`, and `Anum Sheikh` -> `Sheikh, Anum`.
- On 2026-05-31, a quick single-player prep refresh was completed for
  `Mesropyan, Hayk` (FIDE 499455). The existing Oxford prep folder was reused,
  TWIC and ChessArchive second-pass games were merged where they added unique
  movetext, malformed ChessArchive scrape rows were pruned, and the app-side
  database was rebuilt from the Files-side PGN. Final verification showed 241
  source PGN games, 240 converted `.db3` games, latest known game date
  `2026.05.09`, and a clean canonical target-name audit with only
  `Mesropyan, Hayk` in both PGN tags and database player rows.
- On 2026-06-19, Southall Congress 260620 U2400 prep was completed for every
  section entrant except `Tyrrell, Lachlan`. Files-side folders were written to
  `C:\Users\loxty\Documents\EnCroissant\Southall Congress 260620 U2400 player games`
  and app-side OTB prep databases are organized under
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Southall Congress 260620 U2400\OTB Prep`
  as `NN PLAYER - Southall U2400 OTB prep.db3`. Sources checked included local
  Mega by exact player ID, Chess-Results game search by FIDE ID, Lichess FIDE
  pages, the full public Lichess broadcast monthly database from 2020-01
  through 2026-05, Chessscope player pages, FIDE/ECF identity pages, public
  web/TWIC searches, BritBase PGN files, ChessBites PGN pages, Chess.com public
  game pages, and subagent-led online account research. Final source PGN /
  converted `.db3` counts were: `Figeac, Aurelien` 52 / 52, `Onuoha, Obioma`
  146 / 145, `Lapidus, Alexey M.` 173 / 173,
  `Mokhber-Garcia, Sebastian` 480 / 477, and `Balmond, Tom` 146 / 145. The
  remaining source/database count gaps came from converter-skipped malformed or
  incomplete source PGNs and were reported rather than hidden. The canonical
  name audit was clean for all five targets. Account labels used in folder
  names are Figeac no Chess.com match, `obiosky` high,
  `alex_lapidus` high but stale,
  `Sebastian443` high, and `Tom_Balmond` high; no online account games were
  imported.
- A 2026-06-19 follow-up imported the researched Southall U2400 Chess.com
  accounts and then reorganized active online databases under
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Southall Congress 260620 U2400\Online Games Southall`
  with filenames that link each player to the handle, such as
  `02 Onuoha, Obioma - Chess.com obiosky.db3`. Online opening profiles were
  compared against the gathered OTB/broadcast prep PGNs. `figeac` was rejected
  as a mismatch and its downloaded Chess.com PGN/database were deleted, so
  Figeac has no active Chess.com database. Active converted Chess.com database
  counts after empty-game cleanup are `obiosky` 14,020, `alex_lapidus` 113,
  `Sebastian443` 27,797, and `Tom_Balmond` 2,044. The generated comparison and
  layout files live beside the prep folders as `_chesscom_import_summary.json`,
  `_chesscom_opening_comparison.json`, `Chess.com opening comparison.md`, and
  `Southall database layout.md`. Opening comparison kept `obiosky` high, kept
  `alex_lapidus` high identity but stale, kept `Sebastian443` high with a note
  that blitz/bullet online games are more experimental than OTB, and kept
  `Tom_Balmond` high.
- A later 2026-06-19 Southall follow-up added the current Lichess lead for
  `Lapidus, Alexey M.` to the same `Online Games Southall` app-side folder:
  `03 Lapidus, Alexey M. - Lichess ALexChess2010_2022.db3`. The source export
  from Lichess contained 5,644 standard public games from 2022-07-30 through
  2026-06-19, and conversion wrote all 5,644 games with no skipped games.
  Exact Lichess game IDs and canonical player/date/result/movetext duplicate
  checks were clean; broad date/result/move-blob duplicate-style hits were only
  separate 0- or 1-ply games with distinct opponents and Lichess IDs. The
  Southall manifest/layout sidecars were updated and
  `_lichess_import_summary.json` was added beside the prep folders.
- A later 2026-06-19 speed-focused Southall follow-up added `Onuoha, Obioma`
  Lichess `obiosky` to the same `Online Games Southall` app-side folder as
  `02 Onuoha, Obioma - Lichess obiosky.db3`. Lichess filtered account exports
  were capped at about 10,000 games per request and older-page pagination was
  stopped at the user's request to hurry, so this database intentionally uses
  the newest capped export slice rather than a full historical crawl. After
  removing 203 `From Position` games, the source PGN and converted database
  both contain 9,793 standard games from 2022-03-20 through 2026-06-13, with no
  converter skips and no duplicate Lichess game IDs. One broad canonical
  duplicate-style hit is only two separate abandoned games with distinct
  Lichess IDs and UTC times. The Southall manifest, layout markdown, and
  `_lichess_import_summary.json` sidecar were updated with this limitation.
- On 2026-06-19, `docs/opponent-prep-agent-guide.md` was updated from the
  Southall workflow: future prep runs must spawn one online-account search
  subagent per player when tooling is available, import plausible Chess.com
  accounts into separate account databases, compare their openings against OTB
  prep games before final confidence, delete clear mismatch imports, and finish
  with event-level database folders such as `OTB Prep` and
  `Online Games Southall`.
- On 2026-07-01, `docs/opponent-prep-agent-guide.md` was broadened after the
  Sameera Kodukula World Chess import. Account-search subagents must now search
  beyond Chess.com/Lichess and explicitly check World Chess / FIDE Online Arena
  profiles when a FIDE ID is known, including `worldchess.com/profile`,
  `chessarena.com/profile`, the public `api.worldchess.com/api/gaming/players`
  endpoints, per-board PGN downloads, exact FIDE ID verification, and separate
  `Online Accounts` database organization.
- A later 2026-06-19 Southall follow-up deduped repeated OTB source games
  across the Files-side player folders, app-side combined OTB PGNs, and rebuilt
  OTB `.db3` databases. Duplicate source copies were moved into timestamped
  `_dedupe_backup_*` folders under the Southall Files root, stale `.ecsi`
  indexes were cleared, and an independent SQLite check showed zero duplicate
  rows in every Southall OTB and Chess.com account database. Cleaned source PGN
  / converted `.db3` counts are now: `Figeac, Aurelien` 45 / 45,
  `Onuoha, Obioma` 107 / 107, `Lapidus, Alexey M.` 129 / 129,
  `Mokhber-Garcia, Sebastian` 370 / 369, and `Balmond, Tom` 96 / 95; the
  remaining one-game gaps are malformed/skipped PGNs, not duplicate rows.
  `scripts/dedupe-southall-prep.py` records the cleanup workflow. The same
  pass generated per-player PDF style reports in each Southall player folder
  using `scripts/generate-southall-style-reports.py`, with Stockfish 17.1 depth
  8 samples, opening/result summaries, strengths, weaknesses, and player
  strategy notes.
- On 2026-06-19, the user-requested Chess.com account `demyan7777` was imported
  into the Southall `Online Games Southall` app-side folder as
  `06 Verbytski, Oleg - Chess.com demyan7777.db3`. Chess.com profile metadata
  identified the account as NM Oleg Verbytski, GB. The public archive import
  covered 35 monthly archives from 2019-11 through 2026-05, wrote 1,070 source
  PGN games, then removed 5 zero-ply rows after conversion for 1,065 usable
  database games. The matching source PGN and `.import.json` live beside the
  `.db3`, and the Southall `_chesscom_import_summary.json`, `_manifest.json`,
  and `Southall database layout.md` sidecars were updated.
- A later 2026-06-19 Southall added-entrant pass completed the full prep
  pipeline for `Verbytski, Oleg` (FIDE 495506), while keeping the user's
  explicit `Liang Qin Yi` exclusion. A dedicated online-account subagent
  confirmed Chess.com `demyan7777` as high confidence and found a matching
  Lichess `Demyan7777` lead. The Files-side folder is
  `00 2092 - Verbytski, Oleg [cc demyan7777 high]`; 511 deduped raw OTB PGNs
  were reduced to 505 playable top-level PGNs after six zero-move shells were
  moved to `_excluded_empty_pgns_20260619`. The app-side OTB database
  `00 Verbytski, Oleg - Southall U2400 OTB prep.db3` was rebuilt with 505
  games, zero empty rows, zero duplicate game groups, and a clean canonical
  `Verbytski, Oleg` player-name audit. Sources checked included local Mega by
  exact player ID, Chess-Results by FIDE ID, Lichess FIDE rounds, the full
  public Lichess broadcast database, Chessscope slug checks, TWIC/event PGN
  attempts, FIDE/ECF pages, BritBase/public PGNs, and Chess.com archives.
  The Chess.com opening comparison kept `demyan7777` high confidence: White is
  an overwhelming 1.e4 match, recent 2026 Black games are Sicilian-heavy like
  OTB, and only older/slower account games show a notable extra 1...e5 tendency.
- On 2026-06-20, the Southall app-side database layout was reorganized into
  one event folder with one subfolder per player. The old `OTB Prep` and
  `Online Games Southall` folders were emptied and removed; all `.db3`, `.pgn`,
  `.ecsi`, and import sidecar files now live together by player under
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Southall Congress 260620 U2400`.
  Current player folders are `00 Verbytski, Oleg`, `01 Figeac, Aurelien`,
  `02 Onuoha, Obioma`, `03 Lapidus, Alexey M` (Windows path omits the trailing
  dot), `04 Mokhber-Garcia, Sebastian`, and `05 Balmond, Tom`. Verified
  converted database counts after the move are Verbytski 505 OTB and 1,065
  Chess.com, Figeac 45 OTB, Onuoha 107 OTB / 14,020 Chess.com / 9,793 Lichess,
  Lapidus 129 OTB / 113 Chess.com / 5,644 Lichess, Mokhber-Garcia 369 OTB /
  27,797 Chess.com, and Balmond 95 OTB / 2,044 Chess.com. The Southall
  `_manifest.json`, `_chesscom_import_summary.json`, `_lichess_import_summary.json`,
  `_dedupe_cleanup_summary.json`, `_style_report_analysis.json`, Verbytski
  prep summary, `Chess.com opening comparison.md`, and
  `Southall database layout.md` were updated so current paths no longer point
  at the removed folders.
- On 2026-06-30, single-player prep was completed for `Kodukula, Sameera`
  (FIDE `343413994`, ECF `348668A`). Files-side assets live under
  `C:\Users\loxty\Documents\EnCroissant\Sameera Kodukula prep player games`
  and app-side databases live under
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Sameera Kodukula Prep`.
  The full public Lichess broadcast database from 2020-01 through 2026-05 was
  streamed and filtered; Chessscope, Lichess FIDE, Chess-Results event/game
  pages, FIDE/ECF, TWIC/event searches, local Mega/reference databases,
  ChessArchive/public web searches, and account-search subagents were also
  checked. The target broadcast search found 34 records, but one 2026-01-31
  Kodukula-Lupu broadcast shell had zero movetext and was excluded, so the
  OTB prep source PGN and `.db3` contain 33 playable games. The canonical-name
  audit is clean with only `Kodukula, Sameera` in the OTB database target rows,
  zero duplicate PGN keys, and latest imported games on `2026.04.06` from the
  4NCL Easter Congress U2000. No credible current Chess.com account was found:
  `SKodukula` was rejected as low-confidence/inactive/no-archive. Lichess
  `SameeraKodukula` was imported separately as a high-confidence historical
  but stale/TOS-flagged account with 297 standard playable games; opening
  comparison shows low current prep value because the 2022 account is mostly
  1.e4/1...e5 while the 2024-2026 broadcast set is 1.Nf3/London and French/e6.
- A same-day Sameera follow-up created an explicit app-side `Lichess Broadcast`
  database because the original 33 playable Lichess broadcast games were
  present inside the OTB prep database but the naming was easy to miss. The
  duplicate explicit broadcast source lives at
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Sameera Kodukula Prep\Lichess Broadcast\00 Kodukula, Sameera - Lichess broadcast games.db3`
  with the matching `.pgn` beside it. Verification showed 33 games and all 33
  reference the canonical `Kodukula, Sameera` player row. The zero-ply
  Kodukula-Lupu broadcast shell remains excluded.
- On 2026-07-01, the Sameera app-side prep layout was reorganized to match the
  Southall per-opponent folder pattern. The active app-side folder is now
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\db\Sameera Kodukula Prep\00 Kodukula, Sameera`,
  containing `00 Kodukula, Sameera - OTB prep.db3` (33 games),
  `00 Kodukula, Sameera - Lichess broadcast games.db3` (33 games), and
  `00 Kodukula, Sameera - Lichess SameeraKodukula.db3` (297 account games),
  with matching `.pgn` files beside each database. The old split `OTB Prep`,
  `Lichess Broadcast`, and `Online Accounts` folders were removed after the
  new databases were verified. The Files-side player folder also now has a
  plainly named `Kodukula, Sameera - Lichess SameeraKodukula games (297).pgn`
  for the account source.
- A later 2026-07-01 Sameera account-search follow-up used three account
  subagents plus lead-agent checks across Chess.com direct/API candidates,
  public club-member lists, Lichess lookalikes, and broader web clues. No
  credible current Chess.com account was found; `SKodukula` remains rejected as
  low-confidence, inactive, AU-flagged, and archive-empty. The old Lichess
  `SameeraKodukula` account remains only high-confidence historical identity
  evidence; its public `tosViolation` flag and a Lichess issue comment do not
  publicly specify cheating, so do not describe the reason beyond TOS-flagged.
  The strong current online lead is World Chess / FIDE Online Arena profile
  `853760`, which matches exact real name, FIDE ID `343413994`, England, AFM,
  active status, and recent public games. Its public PGN endpoints were
  imported into the app-side player folder as
  `00 Kodukula, Sameera - World Chess 853760.db3` with 1,519 converted games
  from 2024-07-16 through 2026-06-26; the source API exposed 1,529 records, of
  which six zero-ply games, two bot games, and two duplicate normalized PGN
  keys were excluded. Verification showed all 1,519 rows reference canonical
  `Kodukula, Sameera`, zero duplicate database groups, and a strong current
  repertoire match to the OTB/broadcast prep: White is Nf3-heavy and Black is
  overwhelmingly French/e6. The Files-side folder label is now
  `00 1858 - Kodukula, Sameera [wc 853760 high recent li stale cc none]`.
- On 2026-07-02, Sameera prep was published to the phone web app. The hosted
  files folder `Sameera Kodukula prep player games` was added to the phone
  picker pins, and GitHub Pages was pushed with hosted database exports for
  `00 Kodukula, Sameera - OTB prep` (33 games), `00 Kodukula, Sameera -
  Lichess broadcast games` (33 games), `00 Kodukula, Sameera - Lichess
  SameeraKodukula` (297 games), and `00 Kodukula, Sameera - World Chess
  853760` (1,519 games). During the publish, the local desktop app-side
  `00 Kodukula, Sameera - Lichess broadcast games.db3` was found to be stale
  and locked by the running `en-croissant-fork` process, with 71 rows including
  unrelated `Alex_The_Great15` games. The phone site was corrected by copying
  the verified 33-game OTB hosted export over the generated broadcast export
  before rebuilding and republishing. Before any future full `npm run
  web:publish`, replace the local locked broadcast `.db3` with a clean copy
  rebuilt from its 33-game PGN or it may regenerate the stale 71-game hosted
  export.

## Local Browser Verification

- Do not run Playwright or other browser automation for local UI checks unless
  the user explicitly asks for Playwright/browser verification in the prompt.
  Default verification should be code inspection plus the smallest targeted
  check that matches the change, and it is acceptable to skip slow checks when
  the change is low-risk or the user has not asked for verification.
- The Vite dev server for this Tauri app normally serves at
  `http://localhost:1420`; `vite.config.ts` has `strictPort: true`, so check
  whether that port is already owned before starting a new server, but do not
  start it just for browser testing unless the user asked for that verification.
- Do not open the Vite app directly in the Codex in-app browser and try to patch
  in minimal Tauri globals. That path is brittle and previously failed because
  browser-loaded Tauri modules read `window.__TAURI_INTERNALS__.metadata` before
  the app had a real Tauri WebView environment, producing errors such as
  `Cannot read properties of undefined (reading 'metadata')`.
- If the user explicitly asks for Playwright/browser UI verification, document
  the exact harness used. Prefer testing against the real Tauri shell when
  possible; if using the Vite page outside Tauri, treat any stubbed Tauri API as
  a limited smoke-test harness, not product-equivalent verification.
- Temporary Playwright screenshots and `.playwright-mcp/page-*.yml` snapshots
  are local verification artifacts. Do not delete them unless the user
  explicitly confirms deletion.

## Rust/Tauri Verification

- Do not run Rust/Tauri compile-heavy commands by default. In this repo even
  apparently focused commands such as `cargo test --bin en-croissant-fork
some_filter` can sit compiling for many minutes and waste the user's time.
  Avoid broad `cargo check`, `cargo test`, Tauri builds, and binary test
  compiles unless the user explicitly asks for them or the change is high-risk
  enough that the command is truly necessary.
- Before starting any Rust/Tauri command expected to take more than about
  30 seconds, tell the user exactly what command will run and why it is worth
  the wait. If the user is frustrated about compile time or asks for speed,
  do not run it; use static inspection and faster checks instead.
- Prefer fast checks first: `npx tsgo --noEmit`, targeted `oxlint`, targeted
  `oxfmt --check`, `rustfmt --edition 2021 --check <changed rust file>`, and
  code inspection. For backend-only logic, add or update tests when useful,
  but do not automatically run the Rust binary test target unless the user
  approves the compile cost.
- Use `cargo fmt --manifest-path src-tauri/Cargo.toml --check` when formatting
  validation is enough. Avoid running full-manifest `cargo fmt` casually,
  because it may reformat unrelated Rust files and create noisy diffs.
- Reserve broad commands such as `cargo check`, unfiltered `cargo test`, or
  full Tauri builds for release/build work, dependency/type-boundary changes,
  risky native changes, or explicit user requests for exhaustive verification.
- After any Rust command times out, immediately check for lingering
  `cargo`, `rustc`, or `en-croissant-fork` processes before running another
  build command.

## Product Direction

This fork is becoming a guided chess improvement workspace layered on top of
the original En Croissant database, board, and engine tools. The product should
stay powerful, but the default path should be task-led:

- Prepare against an opponent.
- Review opening gaps from a repertoire, online games, or a reference database.
- Review mistakes from local or online games.
- Analyze a single game quickly.
- Explore opening plans and database move choices from the current board.
- Maintain local databases, online game databases, and Lichess study imports.

The design principle is "guided depth": keep all expert controls available, but
lead with the next useful action, the source of the evidence, and the safest
default.

- On 2026-07-02, `docs/PROPRIETARY_REBUILD_PLAN.md` was updated from a
  high-level clean-room MVP outline into a phased full 1:1 behavioral
  replacement plan. The current intent is to reuse the user's owner-authored
  non-native fork feature code heavily after full-history provenance
  extraction, while replacing GPL/native base implementation, final shipped
  assets, schemas, build files, and public product identity. The design target
  should draw inspiration from this fork's clean, modern, simple feel, but use
  original/right-cleared assets, copy, visual tokens, and branding. Future
  proprietary-rebuild agents may inspect the full git history only in the
  extraction workspace to identify owner-added code; implementation in the
  fresh proprietary repo should use approved reusable-delta bundles and the
  behavior/parity specs.
- A same-day follow-up replaced the stale April-only rebuild-plan commit
  inventory with a current owner-authored feature-wave map through 2026-07-02.
  The plan now explicitly captures later waves including smart prep, phone/PWA
  parity, Files/database organization, board style behavior, online clocks and
  live replay, AI Coach, puzzle/blindfold training, setup/structure mining,
  local Lichess eval storage, After-prep projections, World Chess account
  research, generated reports, and Southall/Sameera prep workflows.
- A subsequent 2026-07-02 cleanup deleted the obsolete attempted rebuild at
  `C:\Users\loxty\Desktop\Repos\proprietary-chess-workstation` so future
  agents do not mistake it for the active proprietary base. The rebuild plan's
  technology section now treats Tauri 2, Rust, TypeScript, React, Vite, and
  SQLite as the required baseline stack unless the owner explicitly approves a
  change.
- On 2026-07-07, a four-subagent read-only parity audit compared the active
  Outpost rebuild at `C:\Users\loxty\Desktop\Repos\outpost-chess` against this
  fork and Outpost's own parity/status docs. `docs/PROPRIETARY_REBUILD_PLAN.md`
  now has a dated "Current Outpost Gap Audit Addendum" marking the remaining
  holes for future agents: non-interactive startup and restored-tab routing,
  prep straight-line/habit finder, richer prep coach reports, prep source/audit
  tooling, database strength/reachability parity, review auto-updates, engine
  PV arrows, fork-style report workflow or replacement sign-off, clock
  hydration, puzzle/trainer decisions, URL/deep-link decisions, visual sign-off
  items, and owner/legal release decisions. A same-day owner direction now marks
  phone/PWA/web-companion parity as deferred rather than an active Outpost gap.
  Treat that addendum as the current patch backlog before claiming Outpost is a
  full fork replacement.
- On 2026-07-09, the active proprietary-rebuild handoff was consolidated in
  `C:\Users\loxty\Desktop\Repos\outpost-chess\docs\PROPRIETARY_REBUILD_PLAN.md`
  and `docs/parity-audit/2026-07-09` in the Outpost repo. A 2026-07-10 hidden
  sweep and follow-up pairing expanded the audit to a 321-image labeled corpus:
  150 current fork native, 63 Outpost native, 75 Outpost browser-fixture, 24
  historical fork native, and 9 historical phone images. Current pairs now
  include Files dialogs, configurable/duplicate Daily Goals, local-human Play,
  tab actions, every Outpost Settings category, shell menus/About, and puzzle
  rating states, in addition to populated Database/Prep and review/training
  evidence. The audit also contains an exhaustive source-backed parity matrix,
  prioritized gap ledger, and deterministic fixture contract. Native off-screen
  captures prove populated Prep and Database move tables, including segmented
  top/middle/bottom sets that collectively show every visible move row.
  `docs/parity-audit/SCREENSHOT_WORKFLOW.md` records the exact no-foreground
  WebView2/CDP procedure, and `docs/PROPRIETARY_REBUILD_GOAL_PROMPT.md` is the
  copy-ready long-running implementation handoff.
  The fork-side `docs/PROPRIETARY_REBUILD_PLAN.md` is now a concise pointer to
  that authoritative plan. Treat the July 9 matrix and ledger as current; the
  July 7 addendum and older phase/status narratives are historical evidence.
  Future capture must stay hidden/off-screen and must not move the owner's
  pointer or activate either product window.
- On 2026-07-10, the first post-audit Outpost implementation wave landed as
  focused milestones for fatal recovery, PV copy, deep Files search/state,
  configurable Daily Goals, board input/defaults, local-human Play/clocks,
  puzzle Elo/assistance, scoped Database preferences, tab behavior, Settings
  semantics, and honest engine/report failure states. Outpost commit `ad108d9`
  records the reconciled 321-image corpus, matrix, ledger, and hidden-capture
  workflow. The full TypeScript suite passed 1,621 tests and the production
  build was green. Remaining gaps include exact-path Home due binding and Prep
  Practice routing, Opening Review daily controls, per-side/engine-v-engine
  Play, Files icons/metadata/dialog outcomes/drag/multi-game save-back, native
  puzzle-chart proof and full Stats depth, Settings/OAuth/titlebar decisions,
  data ceilings, persistent jobs, release fixtures, and broad accessibility.
  Continue to avoid the owner-active board/Prep/native storage files unless
  their current changes have been reconciled first.
- Later on 2026-07-10, the owner narrowed the proprietary release target to a
  preparation-first V1. The complete Outpost parity state is preserved at
  branch `codex/full-parity-rebuild-2026-07-10`, commit `194c0e3`; Outpost
  `main` is now the focused product. Retained scope is Home analysis/latest/
  online/import, Files/folders, Databases, board/annotations, engines, Prep,
  Plan Explorer, Engine Plans, Compare, Info, and Accounts. Play, Blindfold,
  Opening/Mistake Review, repertoire Practice/due badges, Puzzle Training,
  standalone Reports/style reports, Daily Goals, Structures, AI Coach, and
  phone/PWA are scheduled for later waves rather than Wave 1 release bugs. The
  authoritative handoff is now Outpost `docs/PROPRIETARY_REBUILD_PLAN.md`, with exact archive
  recovery in `docs/FOCUSED_V1_SCOPE.md`. Future native capture must also heed
  the workflow's Windows warning: changing `APPDATA`/`LOCALAPPDATA` did not
  isolate Tauri `app_data_dir`; verify an explicit backend data-dir override
  with `storage_status` before fixture writes, otherwise capture read-only.
- A subsequent 2026-07-10 clarification makes that focus a sequencing decision,
  not a smaller final vision. The July matrix, gap ledger, micro-audit, 321-image
  corpus, fixtures, and every recorded visual/functional difference remain the
  authoritative long-term rebuild specification. Wave 1 ships the preparation
  essentials; later waves harden core depth/scale, restore improvement loops,
  and then restore Play/training/expansion features. A hidden Wave 1 surface is
  not a current release bug, but its existing parity status must not be deleted,
  closed, or marked matched. Use Outpost's staged
  `docs/PROPRIETARY_REBUILD_PLAN.md` for the exact wave interpretation.
- A later 2026-07-10 Outpost launcher follow-up replaced the desktop shortcut's
  direct stale-executable target with Outpost `scripts/launch-latest.ps1`.
  `Outpost.lnk` now hashes all frontend/native build inputs on every click,
  runs `npx tauri build --no-bundle` when they differ from the last successful
  release, and otherwise opens the verified current release immediately. The
  first verified build completed successfully and launched a responsive release;
  launcher state/logs live under `%LOCALAPPDATA%\Outpost`. Preserve this
  source-aware shortcut behavior so the desktop icon cannot silently reopen an
  obsolete binary.
- On 2026-07-11, Outpost commit `d943c49` removed the desktop shortcut's
  repeated full-release/LTO wait while preserving source freshness. The launcher
  now opens a versioned verified executable from
  `%LOCALAPPDATA%\Outpost\desktop-builds` before fingerprinting, ignores
  test-only inputs, and compiles changed source in the background for the next
  restart using a Vite production bundle plus incremental debug-native Rust
  without debug symbols. A named mutex prevents duplicate background builds;
  formal release builds still retain the release profile and full LTO. Preserve
  the cached-copy separation from `src-tauri\target\debug`, because it lets the
  compiler update the target while the currently verified app remains open.
- Later on 2026-07-11, Outpost commit `23b4331` made the desktop `Outpost.lnk`
  an active live-development launcher. `scripts/launch-live.ps1` keeps one
  `tauri dev` session on dedicated port 4799, so React, CSS, and asset edits
  update in the open native window through Vite HMR; Rust/backend edits use
  Tauri's watcher and automatically rebuild/restart the app. The stable cached
  production-bundle-style path remains available through
  `scripts/launch-latest.ps1`. Both launchers invoke the checked-in Tauri/Vite
  Node entrypoints directly so a temporarily missing `node_modules\.bin` or
  `npx` package-name resolution cannot break desktop startup.
- On 2026-07-11 evening, an Outpost visual-parity session landed three focused
  milestones on `main`: `e57c6f8` replaced the Files inline create-folder,
  rename, kind-edit, delete, and import-database flows with a fork-anatomy
  dialog family (focus trap/restore, designed destructive confirmation);
  `060dc2f` matched fork dialog geometry across the Home modals (top-anchored
  placement, 440/760 widths, single-line Import tabs, flat account-chooser
  rows, and a full online-game-picker rebuild with account chips, pager,
  provider tabs, three-line rows, pinned footer, and a board-thumbnail
  move-chip preview); `cc6c8d0` matched Accounts card flow/density and
  restructured the Engines detail panel into the fork's General/Search/
  Advanced form. New paired native evidence lives under Outpost
  `docs/parity-audit/2026-07-09/pairs/` (Accounts populated at both baselines,
  Engines, Home modal states, Files dialogs, tab states) and the matrix, gap
  ledger, and capture coverage were updated the same evening. Recorded fork
  baselines discovered during pairing: the fork deletes accounts and closes
  dirty analysis tabs without confirmation, has no live FEN validation
  (raw i18n key on error), and its picker provider fetches run in Rust so
  browser-level interception cannot fixture them. E-007 install progress and
  S-018 startup skeletons are recorded as not-fixturable. Capture stayed
  hidden/off-screen against isolated storage throughout; the owner-active
  board/database/settings/titlebar files were left untouched.

## Product Map

### Startup And Dev Launcher

- On 2026-07-03, the desktop dev launcher was changed to avoid a startup hang
  caused by `pnpm` prompting to purge/reinstall `node_modules` when a different
  pnpm version is first on PATH. `scripts/safe-dev.ps1` now calls
  `npm run dev:tauri`, and Tauri `beforeDevCommand`/`beforeBuildCommand` now
  call the existing npm scripts. Keep this non-interactive launcher path so a
  stale package-manager prompt cannot prevent the app window from opening.

### Engine Analysis Reliability

- On 2026-07-03, desktop live analysis was hardened after Stockfish could get
  stuck showing skeleton rows while CPU was still active. The frontend now
  wakes enabled local engines after the app returns from blur/hidden, preserving
  the existing inactive-window engine stop behavior instead of leaving a
  stopped search enabled with no output. The Tauri engine reader also now
  accumulates MultiPV info by the engine-reported `multipv` slot and replaces
  duplicate/out-of-order lines before emitting a completed depth, so Stockfish
  output ordering cannot wedge live analysis, game analysis, or mistake-review
  helper searches. Local Lichess cloud eval lookup and cloud-backed line
  extension are intentionally unchanged; focus wakeups only restart local
  fallback searches.

### Opponent Prep Conditional Lines

- On 2026-06-22, desktop opponent prep gained a compact conditional-line
  signal for saved replies. The prep coverage cell now detects when an
  opponent move has a strong surface score for the opponent, but the user's
  saved reply, or the opponent's usual next reply after it, drops the
  opponent's score enough to matter. In that case the row shows
  `Prep helps: opp X% -> Y%` and the existing tooltip explains the surface
  score, the saved reply score, and the usual next reply when available. Keep
  this intentionally thresholded and tied to saved prep lines so the move table
  does not become another broad lookahead table.
- A follow-up the same day extended the signal to the candidate reply table,
  which is the `Move / Strength / Games / WDL` view shown when the user is
  choosing their response to an opponent move. Candidate rows now detect when
  the opponent's most common next reply is common enough and materially worse
  for them than the surface result after the user's candidate move. This is
  deliberately visible only for meaningful reversals, so ordinary rows stay as
  compact as before.
- A subsequent pass moved the conditional value into the Strength column for
  opponent-specific prep. The original strength badge remains the first value,
  while rows with conditional evidence show a second compact line such as
  `After Nf3 88` for candidate replies or `After prep 58` for saved opponent
  branches. The second value is produced by the same strength scorer as the
  surface badge, with the conditional continuation's WDL evidence substituted
  for the row's surface WDL, so the two values stay comparable instead of being
  separate raw result stats.
- A correction to that pass made candidate reply strength scan a short
  continuation beyond the first candidate move: user's candidate, the
  opponent's likely reply, the best/common reply for the prep side, and up to a
  couple more nearby replies when the opponent path remains common. This fixes
  cases like `1.e4 c5 2.Nf3 g6`, where `...c5` can look bad from the surface
  WDL but the intended `...g6` prep reply scores much better for Black. Deeper
  endpoints are discounted by depth and opponent path frequency, so a rare WDL
  spike two or three moves later should not override a stronger near-term
  signal. Do not reduce this back to a one-ply `candidate -> opponent reply`
  check.
- A follow-up correction made candidate continuation choice use the same
  configured move Strength concept instead of choosing future prep replies by
  raw WDL. Opponent replies are still predicted by commonness, but prep-side
  replies below that are selected and ranked by `getPrepMoveStrengthMap` using
  the active Strength settings and database evidence from the future position.
  WDL remains supporting evidence for the tooltip and after-strength
  recalculation, not the primary future-move selector.
- The desktop move tables now show the conditional value as its own sortable
  `After prep` column beside the normal `Strength` column. Keep these as
  separate columns for opponent-specific prep; the WDL/results column is
  intentionally narrower to make room, and the future-line label belongs in
  the `After prep` cell rather than under the normal strength badge.
- For candidate replies, `After prep` is keyed to the current row and should
  show the best nearby prep-side strength, not blindly the next prep move
  deeper in the line. For example, if `1.e4 c5` is the row and the selected
  line is `2.Nf3 g6`, the `After prep` score can lift `...c5` to the strength
  of the future `...g6`. But once the table is already showing `...g6` as the
  current candidate, a later weaker move such as `...cxd4` must not drag the
  `After prep` value below `...g6`'s own current strength; the future-line label
  should only appear when that future continuation is the displayed score.
- Candidate `After prep` cells should normally be blank unless the future
  continuation is stronger than the row's normal `Strength`. A lower projected
  value may still be shown when the future prep-side reply came from local eval
  coverage because the opponent database has no reply row there; this clarifies
  sparse lines such as `1.c3` without silently hiding the local eval result.
  Identical values should remain blank, and ordinary deeper database lines
  should not drag an already-good current candidate below its own surface
  strength.
- When cloud engine is enabled, candidate lookahead must fetch engine/cloud
  moves for the future prep-side position before scoring the future reply. Do
  not call any external eval API here. The source must be the local stored
  Lichess cloud-eval database. If a future prep-side position has local eval
  moves but no opponent-database reply rows, synthesize engine-only reply
  candidates with neutral WDL and low-confidence scoring rather than leaving
  the cell blank. If the local store has no moves for the position, still show
  a practical/database projection instead of a blank or repeated missing-engine
  value such as `59`.
- Candidate lookahead may use future move strength to select a reply, but the
  displayed `After prep` score must be a projected line value from the original
  prep side's perspective. Cap the future move's relative strength by the
  absolute future WDL/eval blend so a locally best move in a bad future
  position does not show as `100` in the root table.
- Opponent-branch `After prep` must not depend on whether the user has already
  saved a line in the prep tree. When the table is showing opponent moves, the
  column should project the best available prep-side reply from the position
  after each opponent move, score it with the active strength settings and
  local eval data when enabled, and show a compact label such as `After c5`.
  Existing saved-line impact can still take precedence when present, but
  `NO LINE` rows may still have an `After prep` value. Engine scoring should
  use local Lichess evals only in this table, with a practical-only projection
  when the local store has no coverage.
- The prep strength scorer's engine floor is intentionally limited to Engine
  mode. In Smart and Practical modes, the configured engine/practical blend
  must be allowed to pull an engine-best move down when opponent-specific WDL is
  bad, so a move like `...e5` should not stay high solely because it is the top
  cloud move if the selected opponent scores heavily against it.
- On 2026-06-23, desktop `After prep` projection was extended from
  player-specific prep to general prep sources such as Lichess All and Lichess
  Masters. Both common source-move rows and user candidate rows may now show
  projected prep-side strength when a nearby continuation is genuinely better
  than the surface row. General-mode tooltips should describe the source side
  rather than a named opponent, while keeping the same eval rule: local Lichess
  evals only, practical projection when no local eval covers the position.
- A same-day performance pass made desktop `After prep` projections progressive
  instead of all-or-nothing. Branch/source rows now use a cheap immediate
  prep-side reply projection and publish each row as it resolves, while
  candidate rows first scan only the next likely source/opponent reply plus the
  prep-side response for every visible row, then run the deeper continuation
  refinement only for a small strongest/common subset. Keep this bounded,
  progressive shape so general prep does not freeze while waiting on many
  Lichess/database child-position lookups, and so missing general-mode values
  are not caused by one slow row blocking the entire map.
- A later 2026-06-23 desktop prep-builder pass made `Build prep` produce a
  compact game-plan brief before adding tree moves. The brief follows one
  principal route chosen from the same blended Strength and nearby After-prep
  projection evidence, then lists the highest-alert opponent/source replies
  with the recommended answer, usage, surface danger, and projected after-prep
  score. Short and Normal builder sizes now expand only a focused reply set
  at opponent turns, while Deep mode keeps the older broad reply coverage; the
  task queue is priority-led before ply-led so high-value continuations deepen
  sooner in quick pre-game runs.
- A follow-up on 2026-06-23 connected the game-plan brief to the existing Plan
  Coach surface. The brief now carries the prep source label, Strength score,
  local-eval CP/loss/source, database score, WDL-style surface score, After-prep
  score, and recommended answer evidence into a `Coach report` button, with the
  prompt explicitly telling the coach to explain only the supplied safe route
  and not recommend excluded or engine-unsafe alternatives. The builder remains
  the executor and safety gate: `Max CP Drop` is now hard-enforced in root prep
  move choice and in future prep-side reply selection, so a high practical WDL
  line cannot be chosen when local eval evidence marks every candidate outside
  the configured CP limit. If all practical candidates violate the limit, the
  builder stops that branch instead of falling back to the least-bad unsafe
  move.
- A same-day UX correction made the `Coach report` entry point visible in the
  top prep-builder button row beside `Build prep`. Clicking it now builds the
  compact game-plan evidence first when needed, opens the game-plan panel, and
  auto-runs the inline Plan Coach report from that evidence, instead of hiding
  the report action inside a panel that only appeared after a prior successful
  brief render.
- A later 2026-06-23 correction separated `Coach report` from `Build prep`.
  The coach report must not call the builder's game-plan selector or require a
  generated prep tree. It now runs its own bounded database/eval evidence pass
  from the prep start, gives the Plan Coach candidate lines with normal
  Strength, WDL/game-share evidence, local-eval CP loss/source, After-prep
  projection, and explicit safe/unsafe/no-answer status, and asks the coach to
  choose the best safe line itself. Keep the hard `Max CP Drop` rule in this
  evidence packet: engine-unsafe candidates may be shown as evidence, but the
  prompt must forbid recommending them.
- A same-day UX/model correction made the visible `Coach report` output the
  natural-language coach answer first, not the candidate evidence table. The
  candidate grid is now collapsed as supporting evidence, while the report
  auto-runs through `gemini-3.5-pro-preview`. Do not downgrade prep coach
  reports to the Flash planner model, and do not make the evidence table the
  primary "report" again.
- On 2026-07-07, the owner explicitly reverted and pinned the main Gemini
  coach/report model to `gemini-3.5-pro-preview`. Do not change this model id,
  default, placeholder, or prep-report override again.
- A later 2026-06-23 correction fixed the desktop candidate-row `After prep`
  semantics. The column must never show a `Current` fallback: it means the
  source/opponent's most common response after the displayed candidate, followed
  by the best available prep-side answer scored with the active Strength
  settings. Do not replace this with a deeper continuation scan; candidate
  `After prep` is intentionally one source/opponent reply plus one prep-side
  answer. Show that projection even when it is weaker than the candidate's
  surface Strength, because the projected line value is the point of the column.
  The repro was the Alexey Lapidus Lichess database as White at `1.e4`, where
  `...f5` should follow `...f5 2.e5 d5` and show the projected `d5` score
  rather than a surface/current value. A PGN probe over the local
  `ALexChess2010_2022` database checked `1.e4`, `1.e4 c5 2.Nf3`,
  `1.e4 f5 2.e5`, `1.e4 d5 2.exd5`, and `1.e4 c6 2.d4` with zero missing
  projected values. The same pass made Strength apply a hard cap when local
  eval CP loss exceeds the configured `Max CP Drop`, so a database-practical
  spike cannot outrank a sound move after blowing the CP threshold.
- A subsequent 2026-06-23 correction made projected `After prep` the primary
  decision value for both the independent coach report and `Build prep` user
  move selection. The builder now gathers safe static candidates, projects one
  likely source/opponent reply plus the best prep-side answer for a bounded
  candidate set, and chooses by projected `After prep` score before static
  Strength. Static Strength remains the fallback only when no projection is
  available. Keep this behavior: if `...c6` has the best immediate Strength
  but `...c5` has the better projected After-prep score, the coach and builder
  should prefer `...c5` subject to the Max CP Drop safety gate. The coach
  request must mark the top After-prep candidate as the app recommendation and
  list After-prep before immediate Strength in the evidence, so Gemini cannot
  drift back to a static-strength choice such as `...c6`.
- A same-day correction split independent coach report ranking into two
  stages. When the report starts from an opponent-to-move position, the
  opponent/source first move is ranked by reach/share first, and rare first
  moves below the configured important-reply share threshold are evidence-only
  even if their projected After-prep score is high. Once the main opponent move
  is chosen, the reply to that move is selected by projected After-prep before
  static Strength. This specifically prevents reports from recommending a
  rare `1.e3` over an overwhelmingly common `1.e4`, and prevents the main
  `1.e4` branch from falling back to `...c6` when `...c5` has the better
  projected After-prep score.

### Local Lichess Cloud Evals

- On 2026-06-22, the desktop fork gained a local compact Lichess cloud-eval
  store path. The design intentionally stores all positions from the official
  `lichess_db_eval.jsonl.zst` dump as sorted compressed binary shards under
  app data, with only a 128-bit stable FEN hash, depth, knodes, and the top
  1-5 root moves/evals per position. Full PV tails are deliberately omitted to
  keep the laptop copy compact; future prep features should reconstruct longer
  lines by chaining local position lookups and should use local Stockfish only
  for final verification or missing positions. Desktop cloud analysis now asks
  the local store first and falls back to the Lichess API when the store is not
  built or a position is absent. Build the store with `npm run
  lichess-evals:build`; the CLI streams the official `.zst` source directly
  with the release-profile builder and avoids writing a huge decompressed JSONL
  temporary file. The same CLI supports `--status` and `--lookup-fen <fen>` for
  local verification. The first full local build completed on 2026-06-22 at
  `C:\Users\loxty\AppData\Roaming\org.encroissant.app\lichess-cloud-evals`,
  storing 388,458,657 positions with 0 skipped rows in 2,048 shards and a final
  on-disk size of about 11.1 GB. A start-position lookup returned depth 65
  root moves `c2c4`, `e2e4`, `g1f3`, `d2d4`, and `g2g3`, confirming the built
  store is queryable.
- A follow-up on 2026-06-22 threaded the local cloud-eval source through
  desktop opponent-prep strength scoring. `queryLichessCloudMoves` now labels
  SAN engine moves from the local Lichess dump, and opponent prep preserves
  that label in both normal `Strength` and future-position `After prep`
  calculations.
- A correction immediately after made desktop eval/scoring local-only. The
  shared `queryLichessCloudMoves` / `getBestMoves` path must use the local
  Lichess eval store only; it must not fall through to the remote Lichess
  cloud-eval API, and opponent prep/database/opening-health scoring must not
  use ChessDB as an engine fallback. If the local store lacks an exact
  position, leave the engine evidence absent, or use local Stockfish only in
  features that explicitly expose a local-engine fallback.
- Another 2026-06-22 follow-up made desktop board cloud analysis extend compact
  local cloud rows with local Stockfish root MultiPV tails. The compact store
  still preserves only cloud evals plus first moves on disk; at runtime, rows
  from the local dump are marked as partial, the already-started local engine
  search is allowed to return MultiPV, and matching first-move PV tails are
  grafted onto the cloud row while keeping the cloud score, depth, and root
  move authoritative. If local Stockfish does not include a cloud first move in
  its MultiPV output, that row remains a one-move cloud line.
- A same-day correction hardened that line-extension path: after the root
  MultiPV graft, any still-one-move local cloud row now gets a hidden
  Stockfish follow-up search from the child position with `MultiPV=1`. The UI
  still shows the cloud score/depth/root move, but the continuation can now be
  filled even when the cloud move was not part of Stockfish's root MultiPV.
- A later 2026-06-22 engine-panel cleanup made desktop analysis quiet about
  cloud/API lookup failures and removed the visible `Loading`/cloud-status
  badges from the engine row. Local Stockfish analysis now starts immediately
  with no frontend search debounce or local UI update throttle, while local
  engine cloud lookup uses the compact local Lichess eval store only and falls
  straight through to Stockfish when that store has no row. Keep this panel
  focused on the active Stockfish/available local-cloud lines rather than
  surfacing Lichess API rate-limit or fallback narration.
- On 2026-06-23, the desktop board eval flow was corrected so local cloud evals
  are no longer blocked behind Stockfish continuation generation. The local
  eval lookup now runs first and returns saved cloud rows immediately; Stockfish
  only starts as the main fallback when the local store misses. For compact
  one-move cloud rows, hidden child-position Stockfish continuation searches
  may update the displayed PV later, but they must not delay or replace the
  saved cloud score/depth/root move.
- A later 2026-06-23 correction changed new local Lichess eval builds to
  format version 2, storing full cloud PV tails for the selected top 1-5 moves
  as binary UCI move codes instead of keeping only the root move. Version 1
  root-only shards remain readable while a rebuild is in progress, but new
  builds write variable-length records with a per-shard offset index so lookup
  still uses hash binary search. Frontend local-cloud rows are only marked as
  partial when the returned PV contains a single move, so full v2 cloud lines
  do not trigger local Stockfish continuation grafting.
- A same-day engine-panel speed fix made local Stockfish start immediately in
  parallel with the local cloud lookup. If the local cloud store hits, the
  cloud score/depth/PV remains authoritative and the speculative Stockfish
  search is stopped; if the cloud store misses, Stockfish has already started
  instead of waiting behind shard lookup/decompression. Keep this parallel
  miss path intact so out-of-book positions do not appear to stall before
  local analysis begins.
- A later 2026-06-23 reliability fix kept local Stockfish searches from being
  poisoned by empty fallback payloads. Empty local `bestmove` events and failed
  first-start attempts no longer cache `No analysis available`; starting a
  local search clears stale empty rows, clears any stale cloud-covered marker
  for that search key, resets progress, and retries one fresh local process if
  startup fails or the first output is too slow. The main visible Stockfish
  search keeps a bounded first-output watchdog, but timeout now means
  clear/retry/keep the UI recoverable rather than caching an empty analysis
  result. Keep this distinction so positions without saved local cloud evals
  fall through to live Stockfish immediately instead of freezing on an empty
  analysis state.
- The same reliability pass added a desktop engine-panel cutoff for local
  cloud-eval probes after fullmove 15. The compact local eval store does not
  record aggregate ply/fullmove coverage stats, so the app cannot cheaply ask
  the built store for its deepest contained position. The practical rule is
  now: visible local Stockfish analysis may use saved local cloud rows through
  move 15, but after that it skips the local cloud lookup and keeps the already
  running Stockfish search. Do not apply this blindly to remote cloud-only
  engines or prep scoring paths unless they have an equivalent live Stockfish
  fallback.
- A later 2026-06-23 cache fix made local cloud-eval misses honor the existing
  missing-position cache before calling the Tauri lookup again. This matters
  for After prep and other sparse-position features that may revisit the same
  future FEN repeatedly; cached misses should return as absent engine evidence
  instead of repeating slow shard/decompression work.

### Web Companion

- On 2026-06-03, a first browser/PWA MVP was added for phone access without
  Tauri. `src/index.tsx` now runtime-splits startup: real Tauri WebViews load
  the existing desktop app, while plain browsers load `src/web/WebApp.tsx`.
  The web companion is intentionally prep-first and excludes Opening/Mistake
  Review decks for now. It imports PGN files through the browser file picker,
  stores indexed data in IndexedDB, treats those PGNs as browser-side
  databases, provides Files and Databases views for browsing games/player
  summaries/exporting PGNs, and creates saved opponent-prep workspaces with a
  mobile Chessground board, notes, line navigation, practical move stats, and
  prepared/open row state. It does not read desktop `.db3` files directly yet;
  future phone sync should bridge desktop databases or linked Files PGNs into
  this browser-side model rather than reintroducing Tauri-only imports.
- The web MVP also adds `public/manifest.webmanifest` and `public/web-sw.js`
  so static hosting builds can be installed as a lightweight PWA. Keep the
  browser entry free of eager `@tauri-apps/*` imports; browser deployment
  depends on the desktop app remaining behind the dynamic Tauri-runtime import.
- Also on 2026-06-03, the phone web MVP was reshaped around a board-first
  workspace. The primary phone screen is now a Chessground board with a compact
  under-board `Moves / Database / Prep` segmented panel, matching the desktop
  analysis under-board model rather than separate deck-style pages. Moves
  navigates the active line, Database shows browser-indexed PGN move stats from
  the current FEN, and Prep creates/selects opponent workspaces with notes,
  prepared/open move state, and the same compact move table.
- On 2026-06-22, the phone/web under-board Engine panel was simplified to be
  Stockfish-first. It no longer exposes Lichess Cloud/API controls or a cloud
  status chip, defaults cloud lookup off for stored settings normalization, and
  treats an enabled engine as `Stockfish`/running immediately instead of
  showing a `Loading` or warm-up state before the first line arrives.
- Anywhere phone file access should use a hosted static library rather than a
  laptop-dependent bridge. `scripts/build-web-library.mjs` mirrors PGN/PDF files
  from `Documents/EnCroissant` or `EN_CROISSANT_WEB_FILES_DIR` into ignored
  `public/web-library` assets and writes a manifest consumed by
  `src/web/hostedFiles.ts`. Running `npm run web:library` before a static
  deployment lets the phone browse Hosted files and load PGNs/PDFs from the
  published site while the laptop is off. Do not reintroduce a local
  filesystem bridge as the phone product path; it makes phone access depend on
  the laptop being awake and can expose local files on a development network.
- On 2026-06-03, local auto-sync was added for the phone site. `npm run
web:publish` runs `scripts/publish-web-site.ps1`, regenerating the hosted
  library, building Vite, mirroring `dist` into the `loxtyrrell03.github.io`
  Pages checkout under `%LOCALAPPDATA%/EnCroissantWebSync`, committing, and
  pushing only when there are real staged changes. `npm run web:install-sync`
  registers the per-user Windows task `\EnCroissant\EnCroissantWebAutoSync`,
  which runs `scripts/watch-web-sync.ps1` at logon, watches
  `Documents/EnCroissant` plus the app/fork database directories, debounces
  PGN/PDF/DB changes, and performs periodic safety syncs. Logs live in
  `%LOCALAPPDATA%/EnCroissantWebSync`. Raw `.db3` changes can trigger a sync,
  but phone-usable database content still needs to be represented as linked or
  exported PGN files in the hosted Files library. The hosted library manifest
  preserves its previous `generatedAt` value when file paths, sizes, mtimes, and
  URLs are unchanged, so periodic safety syncs remain no-op publishes instead of
  creating timestamp-only Pages commits.
- Also on 2026-06-03, auto-sync began publishing eligible local `.db3`
  databases as generated PGN chunk folders under Hosted files `Databases/...`.
  `src-tauri/src/bin/export_db_to_pgn.rs` is a headless Rust exporter that
  reuses the fork's move-blob decoder, while `scripts/build-web-library.mjs`
  caches exports under `%LOCALAPPDATA%/EnCroissantWebSync/db-exports` and
  includes cached chunks in the static web library. On 2026-06-04, the default
  database export root was narrowed to the desktop app-data database directory
  resolved from `src-tauri/tauri.conf.json`; this keeps the phone picker from
  showing extra databases from multiple local app roots. Use
  `EN_CROISSANT_WEB_DATABASE_DIR` for one custom root or
  `EN_CROISSANT_WEB_DATABASE_DIRS` for an intentional multi-root publish. The
  Rust package must keep `default-run = "en-croissant-fork"` because the
  additional `export_db_to_pgn` binary otherwise makes `tauri dev` fail at
  startup when Cargo cannot infer which binary to run. The
  Database and Prep source pickers also filter previously indexed hosted
  databases once the current hosted manifest is loaded, so stale phone IndexedDB
  imports from an older multi-root publish do not remain selectable after the
  site is narrowed back to the desktop source. The
  publish/watch/install scripts expose `-MaxDatabaseMB` (default 200 MB) plus
  `-SkipDatabaseExports`; this keeps normal prep/account/repertoire databases
  available on the phone while deliberately skipping huge reference databases
  such as 2.7 GB Mega Database copies that are not practical for free static
  hosting. Phone users can import a generated database by opening Hosted files,
  browsing to `Databases/Desktop/...` for the default desktop app-data root,
  and importing the database folder.
- The web Prep panel now owns its database/import workflow instead of forcing a
  detour to Files. Its compact under-board Prep area has Databases, Hosted
  files, and Import games drawers: database source selection attaches indexed
  PGNs to the active prep, Hosted files can load PGNs/PDFs from the published
  web library, and Import games fetches public Lichess or Chess.com games by
  username with most-recent and date-range modes. Imports created from Prep are
  immediately used as prep sources when the prep has an explicit source list.
- The web Database panel now mirrors the fork's source model more closely:
  Local, Lichess All, and Lichess Masters are explicit under-board sources.
  Local uses browser-indexed databases and can import any hosted PGN folder as
  a single local database from the published laptop library. Prep uses the same
  hosted-folder import path, so exported local database folders can be selected
  and attached without leaving Prep. Lichess All/Masters use a browser PKCE
  Lichess sign-in flow and store the access token in phone localStorage; direct
  anonymous explorer requests return 401, so do not remove authentication.
  Desktop `.db3` move blobs are not decoded in the browser; publish linked
  Files/PGN exports for phone-accessible local database functionality.
- On 2026-06-04, the phone Database under-board header gained the desktop-style
  Stats sort menu plus a `Matches` count for Stats and Games views. The sort
  choice persists in browser storage and orders browser-indexed local stats and
  Lichess explorer stats by most/fewest played, recent/oldest, score, or move,
  making it easier to tell which source actually loaded on the phone.
- A follow-up on 2026-06-03 made synced database folders first-class, single
  choices in the phone Database and Prep source pickers. Generated hosted
  database folders under `Databases/...` now appear beside already indexed
  browser databases, import on selection without loading their first game onto
  the board, and are de-duplicated by hosted path/update timestamp. These
  pickers intentionally use one active database at a time, matching the fork's
  database comparison model; do not turn them back into multi-select controls.
  Hosted Files folder import is limited to folders with direct PGNs so broad
  parents such as `Databases` are browsed instead of accidentally imported. The
  Lichess token state is hoisted to the web app shell so OAuth completion and
  the token field share one persisted localStorage value.
- On 2026-06-04, phone Prep was tightened to match the desktop under-board Prep
  root workflow. Starting prep from setup now records the current board line as
  `rootPly`, the training header renders `Start: <line>` instead of always
  `game start`, and Common move / Done + next cycle the same opponent branch
  start that the fork uses rather than querying a simplified current-position
  or game-start-only flow. The phone Prep source picker still remains a single
  database/explorer choice and includes local synced folders plus Online /
  Lichess All / Lichess Masters with saved-token reuse.
- Also on 2026-06-04, phone Prep branch detection became cursor-aware, matching
  the desktop under-board panel when the user is preparing as White from the
  game start. After the user plays their first move, Common move now roots at
  the opponent-to-move position, Done + next marks the actual opponent branch,
  and the training header says `Away from prep start` when the board cursor is
  before the saved prep root instead of silently treating that position as the
  active prep branch.
- The phone Prep move table now uses desktop-style branch coverage in the
  `Prep` column. For browser-indexed local or temporary prep sources it scores
  the saved continuation below an opponent move, counts common replies from the
  same prep database, and labels the branch as `No line`, `Thin`, `Needs work`,
  `Solid`, or `Good`; online explorer sources still show saved-line depth but
  cannot yet fan out async multi-position explorer coverage in the browser.
- Also on 2026-06-04, phone synced-database loading was hardened so hosted
  database folders behave more like desktop database files. Re-importing a
  hosted database now replaces the older phone IndexedDB copy with the same
  hosted path, rewires Prep source IDs and board game origins to the fresh
  database, and removes stale duplicate loaded entries. Database and Prep
  selected local sources auto-refresh when the published folder is newer than
  the indexed copy, or when metadata exists but the games are missing; picker
  rows label newer hosted folders as `Update available` instead of implying the
  stale copy is current.
- A later 2026-06-03 Prep parity pass replaced the phone Prep setup with the
  fork's visible setup model: header badges, Player/General target mode,
  folder-aware `Prep source` picker with an Online group for Lichess All and
  Lichess Masters, player/opponent colour controls, general `I'm white`/`I'm
black`, Min games, Show top, and the online import drawer's Save database,
  Check range, range/count, and Import + use controls. Local prep stats now
  respect Player versus General filtering plus Min games/Show top. Lichess
  All/Masters prep sources use the persisted web Lichess token and the web
  explorer helper.
- On 2026-06-04, the phone Prep online import flow gained a prep-only
  temporary source path for Save database off. Public Lichess/Chess.com games
  imported from the Prep drawer can now be attached to the draft or active prep
  as an unsaved `Current prep` source, remain a single selected source in the
  same folder-aware picker, feed the normal prep move table, and stay out of
  the browser database list. Save database on still creates a normal
  browser-side database and attaches that one source to Prep.
- The same pass added phone active-prep workflow buttons matching the desktop
  under-board training stage: `Common move` plays the first open common row
  from the current prep table, while `Done + next` marks that row prepared and
  advances to the next open shown move. These controls intentionally operate on
  the currently selected single prep source and reuse the phone move table's
  Min games/Show top filtering.
- A 2026-06-04 follow-up made phone database source selection less confusing:
  the under-board Database panel now persists its selected source and local
  database in localStorage, and both Database and Prep show explicit loading
  text while a generated hosted database folder is being imported from synced
  files. This keeps the phone UI closer to the fork's remembered source model
  and avoids the appearance that selecting a large hosted database did nothing.
- A later 2026-06-04 phone Prep parity pass made the web Prep tab use the
  desktop under-board Prep shape more directly. Prep now has a setup stage with
  `Start prep`, then a training stage with `Common move`, `Done + next`, and a
  settings icon back to setup. Existing active prep workspaces reopen in the
  training stage after reload. Candidate-reply rows use the fork-style
  `Move / Strength / Games / WDL` table, while opponent-move rows use
  `Move / Strength / Games / Results / Prep / State`, sortable headers, Done
  and Skip actions, and local/temporary source `Go to game` evidence jumps.
  Browser-side prep workspaces now persist skipped move keys separately from
  prepared move keys.
- Another 2026-06-04 phone parity pass made the shared database picker more
  phone-friendly without changing the one-database source model. Database and
  Prep source pickers now include a search box when folders or many choices are
  present, show folder rows as drill-down entries, and show source row details
  such as `Loaded - 1,588 games - 1.1 MB`, `Not loaded - 1 PGN - 1.1 MB`, or
  `Explorer - saved token reused`. Selecting a generated hosted database still
  imports exactly one synced database folder, then replaces the active local or
  prep source with that one database.
- A subsequent 2026-06-04 phone Prep parity pass added the desktop under-board
  `Strength settings` control to the phone setup row. Web prep workspaces now
  persist a `builder` strength-settings slice, and browser-side prep move
  strength uses that mode/engine-blend/max-CP-drop configuration while keeping
  cloud engine disabled on the phone path until a browser-safe cloud-eval flow
  is added.
- A further 2026-06-04 phone Prep parity pass aligned the source/target state
  machine with the desktop fork. Choosing Lichess All or Lichess Masters from
  the phone `Prep source` picker now forces General/Opening prep, clears the
  player-only target fields, and keeps the saved-token Lichess controls in
  view. Switching back to Player mode from an online explorer source now
  returns to one local synced database source, mirroring the desktop
  under-board Prep panel instead of allowing a confusing `Player + Lichess`
  combination.
- A follow-up 2026-06-04 phone Prep cleanup made prep titles derive from the
  actual mode/opponent state instead of trusting stale saved workspace names.
  Old browser-side prep workspaces that were previously named `General prep`
  but are now in Player/local mode render as `Opponent prep` or
  `<player> prep` in the board title and setup picker, keeping the phone header,
  active prep selector, Player/General segment, and one selected source in sync.
- A later 2026-06-04 phone Database parity pass added the desktop-style local
  perspective controls to the under-board Database panel. Local browser
  databases now have a persisted Username field with White/Black, relabeled to
  `As white`/`As black` when a player is entered, and move stats filter to that
  single player's color instead of treating the selected database as an
  unscoped all-games source. Empty states name the exact filtered source, such
  as `lachlan1415 as black in lachlan1415_lichess.pgn`, so the phone UI stays
  aligned with the fork's one-database, one-perspective model.
- The next 2026-06-04 phone Prep parity pass split active-prep setup actions
  the way the fork does. Reopening setup for an existing phone prep now shows
  `Start prep`, explicit `Start here`, reset-to-prep-start, and clear
  done/skipped controls. `Start prep` no longer silently moves the prep root to
  the current board position or clears marks; changing the root is only done by
  `Start here`, preserving the fork's explicit root workflow on mobile.
- A later 2026-06-04 phone explorer parity pass added saved Lichess All and
  Lichess Masters filter controls shared by the phone Database and Prep panels.
  Lichess All now exposes time controls, average rating buckets, since/until
  months, player username plus color, and move count; player filters query the
  Lichess `/player` explorer endpoint just like the desktop fork instead of
  the generic all-games endpoint. Lichess Masters exposes since/until years and
  move count. These options persist in phone localStorage and are passed to
  both Database and Prep explorer requests, so the same online source behaves
  consistently across the phone app.
- A follow-up 2026-06-04 phone source-picker parity pass made hosted synced
  databases behave like normal one-at-a-time database sources in the Database
  and Prep tabs. Selecting a hosted database first checks the web manifest
  against the already indexed phone IndexedDB copy and immediately reuses it
  when current, instead of downloading PGN chunks again. Only new, stale, or
  missing indexed databases run the hosted PGN import path, and those real
  imports now show `loaded / total PGNs` progress so large synced prep
  databases are visibly loading rather than appearing stuck.
- A later 2026-06-04 hosted-database performance pass added static
  per-position indexes for generated `.db3` web exports. The Rust
  `export_db_to_pgn` helper now writes a `position-index` folder beside each
  exported database, sharded by normalized FEN and capped by
  `EN_CROISSANT_WEB_DB_INDEX_MAX_PLY` (default 80). The phone Database and Prep
  panels create lightweight hosted database records from that manifest and
  lazy-load only the current board position, including blended-strength cloud
  enhancement, instead of downloading and parsing every PGN chunk into
  IndexedDB. Lazy hosted sources intentionally do not expose full source-game
  samples or whole-database player/date filters until a separate lazy sample
  endpoint exists.
- The next 2026-06-04 source-picker cleanup removed the extra under-board
  `Browse`/`Hosted files` database route from the phone Database and Prep
  panels. Those panels now mirror the desktop fork more closely: database
  selection happens through the single `Local database` or `Prep source`
  picker, while hosted PGN/PDF browsing remains in the Files surface. The
  shared picker still drills into synced folders and can load not-yet-indexed
  hosted databases, so no database access was lost.
- A follow-up 2026-06-04 picker-state fix made `DatabaseFolderSelect` reset its
  active folder and search query whenever the popover opens or closes. This
  prevents the phone Database/Prep selector from reopening inside a stale
  folder after the user previously drilled into another database group, which
  had made the selected source label and visible database list feel mismatched
  or improperly loaded.
- The selected database's containing folder row in `DatabaseFolderSelect` now
  reads `Open current folder` instead of `Selected folder`. This keeps the
  shortcut to drill into the current database folder while avoiding the
  misleading impression that a folder, rather than exactly one database, is the
  active Database or Prep source.
- Phone Prep setup now mirrors the fork's under-board source/player controls
  more closely. The Prep and Database phone panels share a web-native
  Username plus player-color selector, local prep database labels such as
  `_lichess` seed the obvious player name, Start prep is blocked until the
  source and target are ready, and Prep setup choices persist in browser
  storage alongside the saved Lichess token and explorer filters.
- Phone Database and Prep local source choices now persist by stable hosted
  database path when a database comes from synced fork files, with old raw
  browser database ids still accepted for compatibility. This prevents a
  refreshed/reloaded hosted database from losing the selected source and
  falling through to an unrelated first database. Local Prep also treats an
  empty source list as no source instead of silently querying every indexed
  browser database.
- On 2026-06-04, a phone-only saved-prep workspace selector was removed from
  the Prep setup row because it did not exist in the fork's under-board Prep UI
  and made source selection look like a second, useless database/prep picker.
  Phone Prep setup should lead with the fork-style Player/General target,
  single Prep source picker, import drawer, and strength/builder controls.
- The 2026-06-04 phone Database/Prep parity pass added the fork's local
  date/result filters to both under-board panels. Database and Prep now search
  the selected local source through the same player/color, From, To, and Result
  scope shown in the UI, active preps with an empty local source no longer fall
  back to the first database, changing local prep databases clears stale
  opponent names so the new database can seed its own player, and saved Lichess
  access renders as `Lichess saved` with Relink/Forget controls instead of
  asking for sign-in on every Lichess All/Masters use.
- A follow-up 2026-06-04 phone Database parity pass added the fork-style
  `Stats / Games / Options` subview inside the under-board Database panel.
  Local databases now expose source-game samples for the current FEN through
  the same selected database, username/color, date, and result filters used by
  move stats, while local filters live in Options and online explorer options
  remain under the same subview.
- A later 2026-06-04 phone Prep parity pass added the remaining desktop
  under-board active-branch controls to the phone training header. When the
  current line has an active local or temporary source branch, phone Prep now
  shows the same header-level `Go to game` evidence jump plus the return arrow
  to the last opponent choice, and `Done + next` uses that shared active-branch
  selection including roots where the opponent is to move.
- The same pass made the phone Prep import drawer follow the desktop
  under-board layout: opening `Import games` collapses the normal prep
  source/player/min-games controls so the online source, username, range, save,
  preview, and import controls are the focused setup surface.
- A subsequent 2026-06-04 phone Prep parity pass added the fork's compact
  builder/sort settings row to the web Prep setup. Phone Prep now persists
  desktop-style move-sort defaults with saved setup and active prep workspaces,
  exposes Smart/Engine/Practical, Source/Their move sort, Your move sort,
  Engine blend, and Max CP drop controls in setup, and resets the visible
  opponent/candidate prep tables from those defaults when the workspace or
  defaults change.
- A 2026-06-04 phone layout fix made the under-board `Moves / Database / Prep`
  switch responsive. On narrow phone widths the header now puts the switch on
  its own full-width row with equal segments, so the `Prep` segment stays
  visible and tappable instead of being clipped by the FEN/title text.
- On 2026-06-12, the duplicate in-panel phone under-board header was removed.
  The blue board action buttons are now the only `Analysis / Database / Prep /
Engine` selector on the phone workspace, and the active panel content starts
  directly below them to preserve vertical board space.
- On 2026-06-12, the phone board gained compact previous/next arrow controls
  directly under the Chessground board, plus left/right empty-board swipe
  navigation that uses the same cursor model as the Moves panel. Swipe left
  advances one move and swipe right goes back one move; gestures that start on
  pieces are ignored by the swipe handler so normal piece dragging remains
  protected, while the existing vertical board-swipe page scroll behavior is
  preserved.
- On 2026-06-12, active phone Prep training was compacted further: once prep
  has started, the under-board Prep panel hides its setup/status/action header,
  badges, and position notes, then shows the move rows/table directly under the
  board with only a small `Return to prep settings` exit button. Keep this
  started-state surface move-first; source, target, root, and builder controls
  belong behind the setup/startup view.
- On 2026-06-12, phone under-board controls and prep rows were tightened for
  narrow screens: the board mode selector now uses shorter visible labels with
  full aria labels, source-picker folder rows use compact helper text, and
  phone prep move rows collapse strength, games, share, coverage, and WDL into
  one stat line. Keep future phone row additions similarly dense and scannable.
- On 2026-06-12, the phone Database and Prep source pickers stopped treating
  loose opened PGN files as selectable databases. Individual hosted PGNs opened
  from Files are now marked as `opened-file`, legacy unmarked loose PGNs are
  filtered out of the source dropdown, and only explicit source databases,
  synced hosted database folders, online sources, or current unsaved prep
  sources appear above/in the folder picker. Keep file browsing/history
  separate from source database selection so recently opened games do not
  masquerade as prep databases.
- On 2026-06-12, the phone board and source-picker labels were tightened for
  narrow screens: board action buttons use short labels with aria labels, Prep
  setup buttons use compact copy, and picker folder/details text avoids wrapping
  long phrases. Keep these controls terse so the board-first phone surface does
  not lose usable width to repeated explanatory text.
- On 2026-06-19, the shared Database/Prep source dropdown gained database
  pinning and manual row order. Pins are stored by database/source value in
  browser-safe localStorage, show a compact pin marker, appear as top
  quick-access rows before folder navigation, and can be reordered with row
  up/down actions; normal rows can also be reordered within their pinned or
  unpinned section. Database folder rows can also be pinned as top-level
  shortcuts while still opening into the same one-database picker; those folder
  pins are stored separately from database/source pins so existing preferences
  remain compatible. Keep this behavior in `DatabaseFolderSelect` so desktop
  and phone Database/Prep pickers stay consistent.
- On 2026-06-20, the desktop `DatabaseFolderSelect` popover was constrained so
  large database/folder lists scroll inside the dropdown instead of stretching
  the page. Search results, the top-level pinned/folder list, and drilled-in
  folder contents now share the same compact max-height scroll area.
- On 2026-06-12, the phone Database tab gained the same setup/start split as
  Prep. Database setup now keeps source/view/sort controls in a compact header
  with a `Start` action, and started Database mode hides those controls so only
  the move rows remain under the board with a small exit button back to
  settings. Keep future Database controls behind setup so started mode stays
  move-first.
- A later 2026-06-04 phone Database/Prep strength parity pass wired the web
  move tables into the fork's blended strength model. Local Database stats and
  Lichess All/Masters explorer rows now compute practical/blended strength,
  Database has saved Smart/Engine/Practical strength settings plus strength,
  engine, and WDL sort choices, and the phone Database table exposes
  `Blend / Engine / Games / WDL / Last` while Prep strength cells show the same
  engine and practical WDL details inline.
- A follow-up fixed the phone blended-strength engine signal. The web companion
  now uses a browser-safe Lichess cloud-eval helper instead of the desktop
  Tauri API, keeps cloud scoring enabled for legacy phone workspaces that had
  saved the old disabled value, and refreshes local Database/Prep rows plus
  Lichess All/Masters explorer rows with cloud engine moves. The helper first
  uses root MultiPV and then queries child positions for shown candidate moves
  not present in the root cloud lines, so common non-top moves no longer
  collapse to `Engine unavailable` when Lichess has cached analysis.
- On 2026-06-19, phone Database/Prep strength scoring was hardened after Prep
  rows could show `0` for normal move-one choices. Web Prep now scores
  opponent-turn strength from the opponent colour while keeping the existing
  result/tie-break perspective unchanged, lazy hosted Prep sources pass a
  separate strength side, and partial cloud coverage no longer treats a shown
  row missing from the cloud move list as a full engine-loss cliff. Keep these
  sides separate: `scoreForUser` remains UI/result perspective, while strength
  follows the side whose candidate move is being evaluated.
- A later 2026-06-19 phone Prep sorting fix made started-mode manual sort
  choices temporary to the current board position. Clicking a table header or
  the compact sort menu can still inspect another metric, but navigating to the
  next move resets the visible table to the saved automatic Prep sort defaults
  (Usage for their/source moves and Strength for user replies by default).
- A 2026-06-20 Prep tab persistence fix moved the setup/training page flag out
  of remount-local component state. Desktop under-board Prep now stores the
  current page in the per-tab opponent-prep atom, while phone Prep stores it on
  each active prep workspace and normalizes old saved workspaces to training.
  Clicking away from Prep and returning should preserve whether the user was in
  move-first training or the settings page.
- The practical/blended strength benchmark now ignores one- and two-game WDL
  spikes unless they have meaningful position share. Tiny perfect-score rows
  can still display their own result, but they no longer define the `best WDL`
  baseline and crush common engine-good moves such as `c4`/`Nf3` to `0%`.
- On 2026-06-11, the phone web companion layout was hardened against iPhone
  horizontal overflow. The app shell, board workspace, and under-board panel now
  clamp to the viewport, controls inside the under-board surface can shrink
  instead of forcing page width, and the compact Database/Prep tables drop their
  fixed desktop minimum width at phone breakpoints. Future phone UI work should
  keep table detail within the screen by wrapping/tightening the mobile layout
  rather than reintroducing sideways page scroll.
- A follow-up on 2026-06-11 fixed remaining sideways scroll on the phone Files
  page. Files panels, the hosted file list, indexed database list, inner
  database/game split, and Mantine scroll areas now all have explicit
  `min-width: 0` / `max-width: 100%` constraints, so long synced database or
  PGN names truncate inside their rows instead of widening the page.
- Another 2026-06-11 phone web companion fix made vertical swipes that begin
  on the Chessground board scroll the page. The board CSS now allows vertical
  panning, and the web board has a small touch escape hatch that converts clear
  up/down swipes into document scrolling even when Chessground captures a touch
  that started on a piece. Preserve this behavior for phone layouts; tap-to-move
  remains the primary reliable move input when a gesture is mostly vertical.
- On 2026-06-11, phone game files began carrying PGN annotations into the
  board `Moves` panel. Browser PGN import now keeps root comments, move
  comments, starting comments, and NAGs on `WebMove`/board-line records, while
  the phone move list renders annotated moves as wrapping rows with inline
  glyphs and note text. Keep this path lightweight: the full PGN still preserves
  richer notation for export, but the phone board intentionally shows mainline
  annotations without becoming a full variation editor.
- Also on 2026-06-11, the phone under-board workspace gained an `Engine` tab.
  It loads Stockfish 18's lite single-threaded browser WASM worker from the
  `stockfish` npm package, persists an on/off switch plus Lichess Cloud,
  MultiPV, and depth settings in browser storage, and shows tappable PV rows
  under the board. Lichess Cloud evals are fetched through the existing
  browser-safe cloud-eval path and can appear while local Stockfish warms up;
  the Database tab remains responsible for Lichess All/Masters opening
  explorer statistics. A follow-up reshaped the phone engine surface to match
  the fork's desktop analysis panel anatomy: play/pause icon header, compact
  source/eval/depth summary, settings cog with collapsed controls, progress
  strip, inactive/error states, and table-style PV rows.
- On 2026-06-11, the agent workflow was tightened so future phone web
  companion code, asset, layout, PWA, hosted-library, or publish-script changes
  must be followed by `npm run web:publish` after local verification and the
  local app commit. The publish step rebuilds and pushes the GitHub Pages phone
  app site, so phone work should not be reported as deployed until it succeeds
  unless the user explicitly defers publication.
- On 2026-06-12, `scripts/build-web-library.mjs` gained Windows retry options
  for generated-library directory removal. Large hosted database
  `position-index/shards` trees can momentarily report `ENOTEMPTY` during
  cleanup, so future publish-script cleanup should keep resilient `fs.rm`
  retries rather than hand-deleting generated folders.
- On 2026-07-06, a phone-app bug-fix wave landed from a full mobile QA +
  code-review sweep. Visual: chessground package coords are realigned inside
  the phone board (the package CSS assumes lichess-style outside gutters and
  clipped the `h` file / floated ranks above the board), the board-header
  action group no longer gets crushed by long file titles, dead CSS-module
  `square.last-move`/`move-dest` rules were rescoped with `:global` (CSS
  modules had hashed them into never-matching selectors), primary tap targets
  were raised to >=40px (move nav) and >=2rem elsewhere, and the moves panel
  auto-scrolls the current move pill into view. Features: pawn promotion now
  shows a phone promotion picker overlay instead of silently queening; the
  documented `Common move` / `Done + next` prep training buttons were
  restored to the training stage (handlers existed but were unreachable);
  Lichess explorer prep stats reuse `getWebPrepMoveKey` so started/prepared
  marks match online sources and survive transpositions; the Lichess
  `/player` explorer endpoint is parsed as ndjson (last line) instead of
  failing on `response.json()`; hosted database refresh remaps
  `board.sourceGameId` alongside `sourceDatabaseId`; local position stats
  count each game at most once per (position, move) so annotated PGNs and
  repetitions no longer inflate W/D/L; custom-FEN games keep their start
  position on the file board; engine pause clears stale eval/depth; engine
  multipv arrows use per-line colors; lazy hosted sources ignore a remembered
  player name when computing perspective; the opponent autofill only fires
  once per source so the field can be cleared; plus smaller fixes (media-query
  first-render flash, `state:asc` blank sort select, stale range-import
  caption, stray hosted `Up` button, nested-button database rows, singular
  pluralization).
- Also on 2026-07-06, phone-site freshness and fast pushes: `public/web-sw.js`
  (cache `en-croissant-web-v2`) is network-first for navigations and
  `web-library/manifest.json` so publishes appear on the phone's first load,
  hosted file URLs carry a `?v=<lastModified>` content stamp to bust HTTP/SW
  caches on re-push, and the new `npm run web:push -- <pattern>` /
  `--changed` (`scripts/push-web-files.mjs`) copies selected PGN/PDF files
  from `Documents/EnCroissant` straight into the Pages checkout plus
  `public/web-library`, upserts both manifests, and auto commits/pushes -
  seconds instead of a full `web:publish`, with `--dry-run` / `--no-push` /
  `--message` options. Full `web:publish` is still required for code changes
  (Vite build) and for adding/removing hosted database exports.

### App Shell

- `/home` is now the task launcher. It opens recent files, imports games,
  starts puzzles, opens the latest online game, launches the online game picker,
  manages Opening Review decks, and manages Mistake Review decks.
- `/files` remains the file and repertoire library. Recent work improved root
  drag behavior, deselection, file-preview safety when no board tab exists,
  right-click rename actions for files and folders in the tree, and a folder
  import/export flow that splits a PGN or `.db3` database into one game file per
  game.
- On 2026-06-06, an experimental local AI Coach vertical slice was added beside
  the board controls. It uses a Tauri-only Gemini CLI bridge for local personal
  use, defaults to `gemini-3.5-pro-preview`, sends Gemini only structured
  Stockfish-grounded prompts, and keeps Stockfish as the source of truth. The
  original version let Gemini request bounded follow-up Stockfish analysis, but
  the current version uses a separate fast planner to request targeted engine
  lines up front. Do not add credentials to the app, and do not expose this
  bridge from any public/server deployment.
- A follow-up the same day made Coach a visible text button beside the
  under-board `Moves / Database / Prep` switch, while keeping the sparkle icon
  as a secondary shortcut. The Gemini timeout setting was also narrowed to a
  normal numeric Rust type so generated TypeScript bindings keep
  `timeoutSecs` as `number` instead of `bigint`.
- Another same-day follow-up made the local Gemini bridge resolve bare
  `gemini` commands to Windows npm shims such as `%APPDATA%/npm/gemini.cmd`,
  because Tauri dev/app processes may not inherit the same PATH that an
  interactive PowerShell has.
- The Coach modal then gained a progress panel with elapsed time and local
  pipeline steps for position collection, Stockfish context, Gemini CLI
  waiting, follow-up analysis checks, and near-timeout state. It intentionally
  labels this as pipeline progress, not Gemini private reasoning. This was
  later replaced by backend-emitted progress events so the UI no longer guesses
  follow-up phases from elapsed time.
- A later same-day Coach pass turned the modal into a small chat transcript.
  Each question now sends prior user/coach messages, the current-line PGN up
  to the selected board position, previous targeted Stockfish results for the
  same FEN, and a compact Lichess All opening table when a saved Lichess token
  is available. The opening table is deliberately Lichess All only, not local
  database data, and includes move counts/WDL plus the app's blended strength
  numbers from `src/utils/openingMoveHealth.ts`. The backend prompt tells
  Gemini to use those opening stats only as practical/popularity evidence while
  keeping Stockfish as the source of tactical/evaluation truth. Gemini can now
  request up to two legal targeted Stockfish follow-ups, but requested FENs
  must match the current board FEN and later positions must be reached through
  `analyse_line`.
- The Coach UI now lives inside the under-board `Moves / Database / Prep /
Coach` area instead of a floating modal. The panel keeps a persistent chat
  input at the bottom, shows local request progress in the transcript, and can
  make Gemini-marked `<line>...</line>` engine lines clickable by creating or
  navigating a variation from the board path where the question was asked. The
  backend raises Coach MultiPV to 3-8 lines and requires concrete plans or
  variations to be grounded in supplied Stockfish data. Whole-game PGN plus
  stored analyze-game eval points are only sent for whole-game review
  questions; normal position questions still receive the current-line PGN
  only.
- A follow-up tightened clickable line grounding: targeted Stockfish results
  now prefix each PV with the requested move or requested line, so every engine
  line shown to Gemini is a full sequence from the current FEN. Final Gemini
  `<line>...</line>` blocks are parsed server-side and rejected unless they are
  legal from the current FEN and match a prefix of supplied Stockfish data.
- On 2026-06-06, the Coach backend became tolerant of Gemini's illegal
  follow-up requests or final `<line>` blocks without weakening Stockfish
  grounding. If Gemini asks Stockfish to analyse a game-start/opening sequence
  that is not legal from the current FEN, or marks such a sequence as a final
  clickable line, `src-tauri/src/coach.rs` now sends a correction prompt and
  asks for a grounded repair instead of surfacing the raw backend error in the
  Coach tab. Keep the repair path limited; unsupported lines must still be
  rejected if Gemini repeats them after correction.
- The Coach request pipeline now carries a frontend-generated request id and
  emits `ai-coach-progress` events from `src-tauri/src/coach.rs` for each real
  backend phase: settings validation, Flash planning, root Stockfish, planned
  targeted Stockfish, Pro coaching, answer repair, success, and failure. The
  same phases are written with `log::info!` / `log::warn!` using
  `ai_coach[request-id]`, so hangs can be debugged from the Tauri log/output
  instead of relying on the UI timer.
- Coach now uses a two-model Gemini pipeline. `gemini-3.5-flash` is the
  default planner model id. The legacy Gemini CLI with `oauth-personal` returned
  `ModelNotFoundError` for this official API model id on 2026-06-06, so the
  local bridge also supports Google's AGY / Antigravity CLI (`agy`) print mode
  and defaults the command setting to `agy` for new local settings. The planner
  receives the current FEN, legal root moves, current-line PGN, chat context,
  cached engine lines, prior targeted results, and Lichess All context, then
  outputs JSON-only Stockfish requests before any new engine work runs. The
  planner is intentionally generous, with up to six upfront requests; Rust
  validates every request against the exact current FEN and legal moves before
  Stockfish runs. `gemini-3.5-pro-preview` remains the default coach model and
  receives the root MultiPV plus all planned targeted results in a single final
  prompt. Pro is no longer allowed to request follow-up Stockfish analysis; if
  it outputs `<stockfish_request>`, the backend rejects it and the planner
  should be improved to request that line up front.
- On 2026-06-07, Coach gained a deterministic Shakmaty chess-fact tool phase
  between Stockfish evidence gathering and the final Pro prompt. Flash now
  plans JSON-only `position_facts`, `legal_moves`, `square_facts`,
  `move_facts`, and `line_facts` calls, while the backend always adds a
  current-position baseline plus mentioned-square/move checks. These facts are
  the source of truth for legal moves, attackers, defenders, undefended pieces,
  hanging pieces, checks, threats, and tactical mechanisms; Stockfish remains
  the source of truth for evaluation and PV quality. Final Coach prompts and
  the fact-audit repair pass must not let Gemini infer current-position board
  facts from visual memory, PGN context, or general chess knowledge. This was
  added after a Coach answer incorrectly called a c1 bishop undefended when
  the board facts showed it was defended.
- Also on 2026-06-07, the first Flash Stockfish-planning stage was made
  recoverable. Planner timeouts or malformed planner JSON now fall back to the
  deterministic current-line/whole-game scope heuristic plus existing
  deterministic Stockfish request inference instead of aborting the Coach
  answer. Keep planner-side AI hops short and optional; the user should not see
  a hard timeout before Stockfish and chess-fact evidence can run.
- Coach answers must treat chess fact data as invisible scaffolding, not prose
  material. The final answer should never mention tool calls, supplied facts,
  private checks, structured details, or verification machinery; translate the
  grounded facts into normal coach language and only include facts relevant to
  the user's actual question. Questions like "can't the queen take the bishop
  after Bd2?" should force a concrete capture/reply Stockfish line such as
  `Bd2 Qxd2`, then explain why that line works or fails before discussing the
  engine's best alternative.
- The baseline `position_facts` payload shown to Coach must stay low-noise:
  status, legal moves/captures, checks, and checkers only. Do not expose a
  global inventory of attacked, hanging, or undefended pieces in the final
  prompt path; it tempts the LLM to use incidental true facts as causal
  explanations. If a loose/undefended piece matters, ground it through a
  relevant `square_facts`, `move_facts`, `line_facts`, and especially a
  Stockfish line that actually exploits that piece.
- AGY print mode can return exit code 0 with no stdout when it triggers OAuth
  and the login flow times out; the useful error only appears in the AGY log.
  The coach bridge reads that temporary log and treats `You are not logged into
Antigravity`, OAuth-token failures, and auth timeouts as unauthenticated AI
  CLI errors rather than surfacing a misleading empty-response failure.
- Coach answer formatting is intentionally app-rendered rather than raw
  Markdown. The UI strips `###` headings into bold section labels, renders
  `**bold**`, asks Pro to use double-asterisk labels such as `**Verdict:**`,
  renders Gemini's occasional single-asterisk label spans such as `*Verdict*:`
  as bold text instead of leaking literal `*` characters, turns Markdown bullet
  markers into normal bullet rows, and renders each
  `<line>...</line>` variation as individual clickable move buttons. When
  Gemini accidentally includes a full game prefix inside a line block, the UI
  compares it with the current game's mainline, trims the matching prefix, and
  anchors clicks from the branch position so blue move lines start at the
  analysed position rather than at move 1.
- Coach inline move clicks must be anchored by local context before the game
  mainline. Assistant messages now carry the root Stockfish lines and targeted
  Stockfish results used for that answer; `AiCoachPanel` builds legal SAN
  anchors from those lines and the exact FEN path in the game tree. Inline
  variation sequences advance from their prior clicked/resolved prefix, so a
  move like `10.Qa6` inside `9...Nxd4 10.Qa6` goes to the Stockfish branch, not
  to an unrelated mainline move with the same SAN. Isolated move tokens are
  clickable only when they resolve through nearby context, a unique supplied
  engine-line prefix, or the actual loaded game move at that ply; unsupported
  alternatives remain plain text instead of guessing.
- If prose anchors a line with a move such as `after 15.Nc3` and the following
  variation repeats that first move (`Nc3 Nxc3 ...`), the repeated first token
  should reuse the existing click target rather than trying to play the same
  move twice. This keeps the rest of the inline variation clickable from the
  intended branch.
- Opening-phase Coach questions are a distinct phase-review scope. If the user
  asks to examine/review/analyse the opening phase of the loaded game,
  `src-tauri/src/coach.rs` forces whole-game PGN scope, filters stored analysis
  to plies 1-30, suppresses generic whole-game critical-moment injection, and
  filters prior targeted Stockfish memory to opening-phase FENs/labels. This
  prevents stale move-19 or endgame evidence from hijacking a fresh opening
  question while still allowing the Flash planner to request targeted opening
  positions up front.
- Coach phase-review questions must be evidence-focused rather than
  theme-specific heuristics. `AiCoachPanel.tsx` sends the full mainline
  ply/FEN map, not only annotated/evaluated moves, so the backend has safe
  anchors throughout the game. `src-tauri/src/coach.rs` classifies the latest
  question into named-move, opening, middlegame, conversion/endgame, or generic
  whole-game focus, filters stale targeted Stockfish memory to that focus, and
  injects deterministic `analyse_move` plus `analyse_position` checks for the
  focused positions before Pro answers. If there are no annotated critical
  moments, whole-game review falls back to representative game positions rather
  than sending Pro an evidence vacuum. This is meant to prevent both tangent
  answers and `no engine data for that phase` failures.
- Coach conversational follow-ups are their own focus path. Phrases such as
  `that sequence`, `that line`, `explain that better`, or `where I can win a
piece` must reuse the most recent targeted Stockfish evidence and
  coach-discussion references instead of falling through to generic whole-game
  critical-moment analysis. `AiCoachPanel.tsx` includes recent targeted
  Stockfish result FENs/PVs in `referenceContext`, while `coach.rs` forces
  non-whole-game scope for deictic follow-ups, trims prior targeted memory to
  recent results, suppresses whole-game fallback injection, and tells Pro to
  explain the referenced sequence directly.
- Coach final answers must never fail the UI because Gemini wrapped an
  unsupported variation in `<line>...</line>`. `coach.rs` validates line blocks
  after Pro answers, asks the coach model to repair invalid wrappers, then uses
  the Flash planner model as a safety auditor if repair still fails. The final
  deterministic gate keeps current-FEN Stockfish-backed line blocks clickable,
  demotes valid targeted lines from other FENs to plain text, strips
  `<stockfish_request>` blocks, and replaces any remaining unsupported line
  block with `[unsupported engine line removed]` instead of returning a red
  error to the user. On 2026-06-13, the pre-final targeted-line demotion probe
  was made non-fatal so unsupported current-FEN wrappers fall through to repair
  and final stripping instead of bubbling `GeminiUnsupportedLine` early. Do not
  weaken this fail-closed behavior.
- On 2026-06-14, Coach line-block validation was hardened for frontend
  normalized castling UCI. Chessops can send cloud PV castling as Chess960-style
  `e1h1`/`e8h8`, while Rust parses the displayed SAN `O-O` as standard
  `e1g1`/`e8g8`; this caused valid current-FEN Lichess Cloud lines to be
  rejected and could push Coach into a 25-second Flash audit timeout. The
  backend still requires each `<line>` block to parse legally from the live FEN
  and be backed by supplied current-FEN evidence, but it now accepts either UCI
  or SAN prefix equivalence so equivalent castling spellings do not break
  clickable lines.
- Coach was then moved out of the under-board panel and into the right-side
  analysis tab stack as its own `Coach` tab; the under-board Coach button is
  only a shortcut that selects that right-side tab. The standalone Current FEN
  card was removed from the Coach UI, the transcript area uses a flexed
  `ScrollArea`, Gemini timeout defaults to 180 seconds with a 120-240 second
  settings range, and Lichess All opening counts use wide numeric fields so
  billion-game totals do not fail Tauri request deserialization.
- A follow-up on 2026-06-06 made whole-game Coach reviews explain critical
  alternatives, not only mistakes. Whole-game analysis points now carry the
  pre-move FEN plus played move metadata, the planner prompt exposes critical
  blunder/mistake positions, and the backend forces up to three
  `analyse_position` Stockfish checks so Gemini can say what should have been
  played and why that best move was better. Non-current critical-position
  lines remain plain text rather than clickable `<line>` blocks, preserving the
  current-FEN line validation model.
- Another 2026-06-06 Coach pass added explicit reference context for chatbot
  follow-ups. `src/components/boards/AiCoachPanel.tsx` now sends a ply-by-ply
  current-line map with FENs and SAN prefixes, plus recent discussed
  `<line>...</line>` continuations, so phrases such as `after 19.Nexd4` or
  `the line we discussed after 19.Nexd4` can be resolved to an exact position.
  `src-tauri/src/coach.rs` formats this context into both the Flash planner and
  Pro coach prompts, keeps session targeted Stockfish results available across
  FENs, and validates planner requests against only the current FEN, critical
  whole-game FENs, or these supplied reference FENs. Do not let future prompt
  changes loosen that allowlist.
- The Flash planner, not the frontend, owns Coach context-scope selection.
  `AiCoachPanel.tsx` sends both `currentLinePgn` and `wholeGamePgn` plus game
  analysis metadata; `src-tauri/src/coach.rs` asks the planner to return
  `pgn_scope: "current_line" | "whole_game"` before building the Pro prompt.
  Natural requests like `analyse this game`, `review the game`, `annotate our
game`, and `go through this game` must select `whole_game`. If scope
  selection regresses, Pro will only see the start/current-line PGN and will
  incorrectly answer with opening move-1 advice instead of reviewing the loaded
  game. `CoachPlannerResponse` is under camelCase serde defaults, so its
  `pgn_scope` field must explicitly accept the snake-case key used in the
  planner prompt; otherwise Rust will deserialize an empty scope and reject the
  planner output.
- Whole-game Coach mode must not package current-board/root MultiPV or Lichess
  opening stats as Pro evidence. When Flash selects `whole_game`, the backend
  skips root current-position Stockfish, omits opening context from the Pro
  prompt, and tells Pro not to produce starting-position main lines or move-1
  opening advice. Whole-game answers should use the PGN, stored game evals, and
  critical targeted Stockfish positions instead.
- Coach answer move clicks should always use the response's intended base
  position, not the live board's current position. Blue `<line>` blocks trim
  full-game prefixes and jump/create from their stored base path. Inline prose
  SAN references are clickable too: numbered moves jump to the matching
  mainline ply when they are the played game move, or use the move number to
  anchor alternatives at the mainline position before that ply. Adjacent SAN
  sequences in prose carry their prefix from that anchor, so a response like
  `19.Nexd4 d5` plays from before White's 19th move rather than from the live
  board cursor.
- On 2026-06-06, Coach's default local Stockfish analysis depth was raised from
  12 to 17 in `src-tauri/src/coach.rs`. This applies to the current-position
  root MultiPV and planned/targeted Coach Stockfish checks so Gemini receives
  deeper tactical evidence by default.
- The Coach frontend also checks Lichess Cloud for current-position root PVs
  before submitting the request. When cloud lines exist, they are sent as the
  root engine evidence and the backend uses them even if fewer PVs are returned,
  because those opening-stage evaluations are usually much deeper than local
  Stockfish. Local depth-17 Stockfish remains the fallback and still handles
  targeted Coach checks.
- Coach verdicts must be line-backed. When Pro calls a move bad, inaccurate,
  a mistake, a blunder, winning, losing, or refuted, the prompt requires a
  concrete supplied engine PV with eval/depth where available. Whole-game
  critical moments now queue both `analyse_move` for the played mistake, giving
  the refutation line, and `analyse_position` from the same before-move FEN,
  giving the better Stockfish continuation. Do not regress this into vague
  strategic summaries such as "h4 weakens the king" without the Stockfish line
  that proves it.
- Coach explanations must also interpret the engine line. A PV plus an eval is
  evidence, not the explanation. When Pro discusses a critical moment, it must
  name the human chess mechanism first: loose piece, overloaded defender,
  tempo gain, king exposure, weak square, open file, pawn break, bad
  coordination, simplification, structure/endgame edge, etc. Material
  summaries are guardrails for factual claims, not a substitute for explaining
  why the position changed.
- For Coach targeted Stockfish results with a fixed move/line prefix, the
  first MultiPV line is the verdict under best play for that requested prefix.
  Later MultiPV lines are alternative replies for the side to move after the
  prefix; do not let Pro cite a line-2 or line-3 eval as the evaluation of the
  candidate move itself. This previously made `9...Nxd4 10.Qa6` look like
  `0.00` by quoting the second PV, even though the best-reply verdict was
  about `-1.01`.
- Coach `<line>...</line>` blocks are only clickable when they are legal from
  the live current FEN. If Pro wraps a line that is backed by a targeted
  Stockfish result from a different FEN, the backend should demote that wrapper
  to plain text instead of failing the whole answer. Do not accept truly
  unsupported invented lines, but do preserve valid targeted evidence as text
  when the UI cannot safely make it clickable from the board cursor.
- PGN sent to Coach models must be plain mainline movetext only. Do not send
  PGN comments, NAGs/glyphs, arrows, extra markups, or variations to either
  the Flash planner or Pro coach. User notes previously caused confident but
  unsupported tactical claims, so keep notes/annotations internal-only. Engine
  PVs now include material summaries; any claim like "wins the exchange",
  "wins a piece", or "wins a pawn" must match those summaries.
- Outpost's Coach composer parity requires a blank textarea input, Enter to
  submit, Shift+Enter to insert a newline, and empty/busy submissions blocked.
- Whole-game Coach Stockfish requests may legally start from exact critical
  before-move FENs selected from the stored game analysis, not only from the
  live board FEN or chat reference FENs. Keep planner sanitizing, request
  dedupe, and targeted execution on the same anchor-FEN rule; otherwise
  whole-game review questions like "why did I lose this game?" can reject the
  evidence-gathering requests before Stockfish runs.
- The same critical before-move FEN whitelist must apply even when the Flash
  planner chooses `current_line` scope for a follow-up question from the game
  start, such as "How could I have held the position after Qxb5?". The board
  cursor may be at the starting position, but the stored game-analysis critical
  moment still provides a valid Stockfish anchor for that referenced move.
- Specific Coach questions about a named move must stay anchored to that move.
  `src-tauri/src/coach.rs` now detects named moves such as `Qxb5`, matches
  them against loaded game-analysis rows, filters the stored analysis context
  to that move and immediate nearby plies, prioritizes analyse-move plus
  analyse-position Stockfish checks for the matching before-move FEN, and skips
  broad whole-game critical evidence for that turn. Keep unrelated later
  mistakes out of these answers unless they are direct alternatives,
  continuations/refutations, or necessary causal context for the named move.
- Coach must also answer the user's requested task, not just the nearest
  engine verdict. The prompt now carries a general question-intent summary for
  verdict, defensive-resource/recovery, comparison, explanation, best-move, and
  plan questions. For recovery questions such as "how could I have held after
  I played X?", Pro should acknowledge the eval at most briefly and then focus
  on the best practical try, concrete continuation, defensive idea, and what
  to aim for next; earlier alternatives are only a short contrast unless the
  user asks for them.
- On 2026-06-06, the Coach question box default was cleared so opening the
  Coach tab starts with a blank input instead of the seeded `What is the plan
here?` prompt. Keep the submit guard tied to non-empty trimmed text.
- On 2026-06-06, Coach input keyboard behavior was changed to chat-style
  submission: plain Enter sends the prompt, while Shift+Enter inserts a
  newline. Keep the textarea autosize behavior and non-empty submit guard.
- On 2026-06-08, Coach prompting was loosened into a concept-first teaching
  voice calibrated from the user's annotated `My classical games` PGNs. The
  final Pro prompt now tells the model to treat Stockfish/chess facts as a
  compass rather than the lesson, lead with the human mechanism, explain
  counterplay, tempo, weak squares, defenders, pawn breaks, practical risk, and
  what to train next, then cite concrete engine lines as proof. The previous
  rigid answer template was softened into a natural answer menu so follow-ups
  can feel conversational while still obeying clickable-line and grounding
  rules. To reduce latency and avoid over-boxing the final answer, the extra
  Gemini chess-fact planner is skipped for broad conceptual/phase-review
  questions and kept for concrete tactical, legality, capture, and
  fact-sensitive questions; final fact auditing is reserved for implementation
  leakage or high-risk board claims without specific fact results.
- On 2026-06-08, the Coach prompt was then tested directly against five hidden
  style targets derived from the user's annotated `My classical games` notes:
  practical `b5` over sharper `Bxh3` to kill `d5`/`f5` counterplay, immediate
  `fxe4` tempo into `Ng4`/`Nxf2`/`Bb6`, a failed `Nd4` tactic because the
  queen was defended, a rushed central break where `Ne4` kept the clamp, and a
  fortress endgame where `Ka1` required candidate expansion beyond bishop
  moves. The reusable local probe is `scripts/coach-style-eval.mjs`; it calls
  the local Gemini CLI, writes ignored reports under `tmp/coach-style-eval`,
  and scores whether answers recover the annotation-style mechanisms without
  being shown the original annotations. First pass was 5/5 overall but the
  defended-queen/process case was weak on calculation-language. The follow-up
  prompt patch added explicit process coaching for candidate expansion, CCT,
  opponent threats, loose/defended target verification, and psychological
  reset; the second pass remained 5/5 and improved that case from 4/5 must +
  1/4 nice signals to 5/5 must + 2/4 nice signals.
- A later 2026-06-08 iteration mined 215 annotation snippets and expanded
  `scripts/coach-style-eval.mjs` from 5 to 13 hidden probes covering broader
  themes: piece-trade quality/outposts, pawn-break deflection into backward
  pawn pressure, future-pin prophylaxis, weak-square pawn pushes, neutral
  candidate verification, space-advantage trades, opponent-resource checks,
  and king-invasion endgame plans. The user clarified that personal
  "ghost/fear" annotations should not drive coach style; annotations are only
  a rough guide to the type of chess insight, not psychology. The Coach style
  guide now explicitly avoids attributing mistakes to fear, ego, tilt,
  underestimating opponents, time pressure, "assuming", "blinded", or "bias"
  unless the user asks for that. Default answers must stay game-state focused:
  candidate moves, threats, counterplay, structure, pieces, and conversion
  technique. The broader probe suite now fails answers that volunteer those
  psychology terms, and the final run passed 13/13.
- On 2026-06-06, a source-derived White repertoire file was added under the
  app Files root's `Documents/EnCroissant/General repertoire/White  rep`
  folder as `Keymer Variation - Mendonca video.pgn`, with the matching `.info`
  sidecar marking it as a repertoire. It extracts the key 1.Nf3 d5 2.e3 Keymer
  Variation lessons from the ChessBase India video with GM Leon Mendonca:
  c6/Semi-Slav move orders, e6/Tarrasch and Queen's Indian structures, early c5
  systems, recurring cxd5/d4 decisions, Rg1-g4 kingside plans, and Ne2-g3
  manoeuvres.
- On 2026-06-06, the first weak-openings GM-video lesson file was added beside
  the existing weak deck at `Documents/EnCroissant/Weak openings training/black`
  as `Catalan - GM Neiksans Boot Camp.pgn`, with a repertoire `.info` sidecar.
  It is transcript-derived from GM Arturs Neiksans' long Catalan boot camp and
  focuses on Black's Catalan perspective: the value of `...Bb4+`, why `...c6`
  should usually precede `...b6`, when not to overvalue the c4 pawn, and the
  sharper `...Bd6` setup. Continue the remaining weak-opening video-derived
  lesson files one opening at a time in the same folder as each source weak
  PGN, without overwriting the original weak-opening decks.
- On 2026-06-06, the next weak-openings GM-video lesson file was added in the
  same Black weak folder as `Italian Game - GM Giri and Perunovic Lessons.pgn`,
  with a repertoire `.info` sidecar. It uses transcript-derived notes from GM
  Anish Giri's long Italian class for the quiet Italian `d3/c3/h3` structures,
  `...h6/...g5`, `...a6/...Ba7`, and central-break timing, plus GM Miodrag
  Perunovic's Scotch Gambit lesson for the `...Nf6`, tempo `...d5`, and
  Max-Lange-adjacent defensive themes that appear repeatedly in the weak deck.
  The user asked not to spend much time on the Center Game because it rarely
  appears; keep that file lightweight. When the weak-openings workflow reaches
  `Documents/EnCroissant/Weak openings training/whites/Grunfeld Defense.pgn`,
  prioritize the White line with `h3` after Black plays `...c5` instead of only
  covering the more common `Be3` mainline.
- Also on 2026-06-06, a Black Queen's Gambit weak-openings lesson file was
  added as `Queens Gambit - GM Finegold and Neiksans Lessons.pgn`, with a
  repertoire `.info` sidecar. It is built from GM Ben Finegold's Black-side
  Queen's Gambit Declined lecture and GM Arturs Neiksans' 2026 QGD Exchange
  boot camp, covering the weak deck's Exchange structures with `...c6`,
  `...h6`, `...Be7`, `...Re8`, and `...Nbd7`, the `Bf4`/`...Nbd7` branch,
  when `...Bf5` solves Black's light-square bishop problem, the g3 Orthodox
  setup, and the Tartakower `...b6/...dxc4` reminder.
- Also on 2026-06-06, a Black Ruy Lopez weak-openings lesson file was added as
  `Ruy Lopez - GM Seirawan Berlin Lesson.pgn`, with a repertoire `.info`
  sidecar. It is transcript-derived from GM Yasser Seirawan's Saint Louis
  Chess Club Berlin Defence lecture and maps the weak deck's Berlin focus:
  the queen-trade endgame after `4.O-O Nxe4 5.d4`, the `8.Qe2 Nd4` branch,
  `...Kxd8/...Ke8/...Kc8` king routes, `...h6/...h5` restraint of White's
  kingside majority, Rio-style `5.Re1 Nd6` lines, and anti-Berlin systems such
  as early `Bxc6`, `d3`, `d4`, and `Qe2`.
- Also on 2026-06-06, the Center Game weak-opening gap was intentionally kept
  lightweight because the user rarely sees it. `Center Game - GM Naroditsky
Lightweight Lesson.pgn` was added beside the Black weak deck with a
  repertoire `.info` sidecar. It uses GM Daniel Naroditsky's Center Game
  masterclass transcript mainly to capture the tactical warning about White's
  `Bc4`/f7 activity in related Center/Danish positions, then maps the exact
  weak-deck branch `1.e4 e5 2.d4 exd4 3.Qxd4 Nc6 4.Qd1 Nf6` to practical Black
  development: `...Bb4+` or `...Bb4`, fast castling, and timely `...d5`.
- Also on 2026-06-06, the Black Scotch weak-opening lesson file was added as
  `Scotch Game - GM Finegold and Perunovic Lessons.pgn`, with a repertoire
  `.info` sidecar. It combines GM Ben Finegold's exact Black-side Scotch Mieses
  lecture with the already downloaded GM Miodrag Perunovic Scotch Gambit
  transcript. The file covers the weak deck's Mieses branch through
  `4...Nf6 5.Nxc6 bxc6 6.e5 Qe7 7.Qe2 Nd5 8.c4 Nb6`, including `...Ba6`
  pins, `...O-O-O`, `...Re8`, and `...d5`, and the Scotch Gambit
  `4.Bc4 Nf6 5.Ng5 d5 6.exd5 Na5` branch, including Perunovic's warning about
  premature `...Nxd5`, the useful `...Qe7+` precision, `...c6`, `...h6`, and
  completing development.
- Also on 2026-06-06, the White Grunfeld weak-opening lesson file was added as
  `Grunfeld Defense - GM Svidler Naroditsky h3 Lesson.pgn`, with a repertoire
  `.info` sidecar. This deliberately follows the user's later request to cover
  the Exchange/Kramnik `8.h3` line after Black's `...c5`, rather than making
  the common `Be3/Qd2/Rc1` branch the main lesson. It uses GM Peter Svidler and
  GM Daniel Naroditsky Grunfeld video transcripts for the dynamic `...c5`
  center-attack themes, plus GM Neil McDonald's ChessPublishing h3 notes for
  the exact tabiya. The file teaches White to use `h3` to stop the easy
  `...Bg4` pin, continue with `Be2`, watch for Black's critical `...Bf5`
  equalizer, and treat the old `Be3` weak-deck line only as a secondary bridge.
- Also on 2026-06-06, the White Queen's Gambit weak-opening lesson file was
  added as `Queens Gambit - GM Naroditsky Colovic Lessons.pgn`, with a
  repertoire `.info` sidecar. It combines GM Daniel Naroditsky's Queen's Gambit
  and Queen's Gambit Accepted masterclass transcripts with GM Alex Colovic's QGD
  lecture. The file covers the weak deck's Harrwitz `Bf4/Bd3` development,
  `...c5` exchange structures, Baltic/Pseudo-Slav `Qb3/c5/Bf4/Nh4`, the
  `Bg5 h6 Bh4` branch, and QGA recovery plans including the IQP after
  `...cxd4/exd4` plus `a4` against `...a6`.
- Also on 2026-06-06, the White Sicilian weak-opening lesson file was added as
  `Sicilian Defense - GM Naroditsky Open Sicilian Lessons.pgn`, with a
  repertoire `.info` sidecar. It uses GM Daniel Naroditsky Open Sicilian,
  Accelerated Dragon, Najdorf, and Dragon transcripts, grouping the 25 weak
  Sicilian positions into e6/Kan/Taimanov `Bd3` structures, `Nc3/Bc4` Open
  Sicilians, Four Knights/Sveshnikov `Nxc6/e5/Bg5` reminders, Maroczy Bind
  `c4/Be3/Qd2` setups, Najdorf English Attack `Be3/f3/Qd2/O-O-O`, calmer
  Dragon `Be2` lines, and the Marshall Counterattack reminder.
- Also on 2026-06-06, the White Slav weak-opening lesson file was added as
  `Slav Defense - GM Naroditsky Finegold Lessons.pgn`, with a repertoire
  `.info` sidecar. It uses GM Daniel Naroditsky's Slav speedrun transcript plus
  GM Ben Finegold's Chebanenko clip, covering the weak deck's Schlechter
  `...g6/Bg5` branch, quiet `e3/Nc3/Nh4` against `...Bf5`, classical
  `dxc4/a4/Bxc4` and `Ne5/Nxc4` recovery plans, the Geller `e4 b5 a4`
  undermining idea, and Chebanenko `...a6` Advance `c5/Bf4` with the `a4`
  reminder.
- Also on 2026-06-06, the White Zukertort weak-opening lesson file was added
  as `Zukertort Opening - GM Finegold Reti Lesson.pgn`, with a repertoire
  `.info` sidecar. It uses GM Ben Finegold's long Reti lecture transcript as
  the main source and treats the deck as a 1.Nf3 transposition map rather than
  one narrow opening: pure Reti `2.c4` ideas, Catalan/QGD and Slav move-orders
  from `2.d4`, KID/Pirc/Old Indian structures after `...d6/...g6`, compact
  Dutch fixes with `Bf4/e3/c4` or `g3`, queenside fianchetto `...b6` setups,
  and odd `...c6`, `...Nc6`, `...Bf5`, and `...c5` leftovers.
- Files also treats `.pdf` prep reports as first-class folder entries: selecting
  a PDF shows an in-app document preview with a system-viewer fallback, while
  PGN-only metadata, sidecar `.info`, and game-opening actions stay scoped to
  chess files.
- Files directory scans load PGN metadata first and defer exact game counts
  until a file is selected or opened, so large linked database folders do not
  hold the whole file tree on "Loading files...".
- The Files tree now lazy-loads folder children: `/files` renders the root
  first, each folder reads its children when expanded, and global search/filter
  triggers a full background load only when that all-folder view is needed.
- Files tree rows sort newest-first by PGN modified time, with name as a stable
  fallback when timestamps match, so newly added game files appear at the top.
- Files and folders can be pinned from the Files tree context menu. Pinned
  entries persist, show a pin marker, stay above normal newest-first rows, and
  follow rename or move operations by path.
- Files and folders can be archived from the Files tree context menu. Archiving
  is stored as persisted path state rather than a filesystem move. Archived
  entries are hidden from the normal file-type pills, the toolbar has an
  Archived pill for reviewing them, and archived paths follow rename, delete,
  and drag/move repairs like pinned entries.
- The Files toolbar includes a persistent sort menu for newest first, oldest
  first, name A-Z/Z-A, and type; pinned entries remain grouped above the chosen
  sort order.
- The Files toolbar also includes Manual order. Dragging a row near the top or
  bottom edge of a sibling row saves a custom order for that folder, while
  dragging onto the middle of a folder keeps the existing move-into-folder
  behavior.
- Files directory scans hide generated `report-render`, `report-render-pdf`,
  `report-print-pages`, and `source-pgns` artifact folders so report workspaces
  and archived source PGNs do not clutter the library while the actual PDF
  report and combined game PGNs stay visible.
- `/databases` manages local databases, online game databases, merged
  Lichess/Chess.com databases, Lichess study imports, database conversion, and
  auto-update metadata. Database settings can export a whole database into the
  Files root as a folder of per-game PGNs.
- `/accounts` stores linked Lichess and Chess.com sessions. The sidebar shortcut
  was removed, but account settings remain reachable from online-game flows.
- `/engines` and `/settings` remain the local engine and global app settings
  surfaces. Settings now include trainer bot, engine display, and board behavior
  affordances.
- Board tabs now represent active workspaces: analysis, play, puzzles,
  Opening Review, and Mistake Review.
- Analysis workspaces place a Save game to files button in the top-left app
  bar near the File menu; it always saves the currently analysed game as a PGN
  copy, including games opened from online imports or database rows.

### Home Launcher

`src/components/tabs/NewTabHome.tsx` is the primary product entry point.

- "Analyse latest" pulls the newest linked Lichess or Chess.com game directly
  into an analysis board.
- The online game picker can select one recent game for analysis or multiple
  recent games for review generation.
- Opening Review opens saved decks, shows deck positions, supports focused
  practice by opening or color, launches Analyze Repertoire, and can create
  opening review decks from selected online games.
- Mistake Review opens saved mistake decks, launches a local PGN/database scan,
  and can create mistake decks from selected online games.
- Daily goals count completed Opening Review and Mistake Review trainer cards
  from any trainer entry point, including focused and long-think sessions.
- Empty states should always offer the next action: analyze repertoire, choose
  online games, add an engine, add a reference database, or link accounts.

### Board Workspace

`src/components/boards/BoardAnalysis.tsx` is the reusable analysis shell.

- The left side is the board plus always-visible annotation tools underneath.
- The right side uses responsive, independently scrollable panels.
- The top-right tabs are Practice, Analysis, Database, Plan Explorer, Engine
  Plans, Compare, and Info. Practice appears for repertoires and review decks.
- The bottom-right area contains detached eval, notation, board controls, and
  move controls.
- The under-board move-list area has a compact Moves / Database / Prep switch.
  Database and Prep reuse the existing right-panel implementations under the
  board so analysis can keep another feature open on the right; move controls
  stay visible only in Moves mode to give those panels the full lower workspace.
  The notation top bar stays stable while switching those modes. Under-board
  Prep uses a two-stage flow: setup first for source/opponent selection, then a
  training stage with the prep line, Common move, Done + next, and the move
  table so it fits the smaller space.
- The under-board move-list top row has a compact focus toggle that hides or
  restores the board eval bar together with move-quality annotations such as
  good moves, mistakes, blunders, eval scores, and short verdict comments like
  "Bxf4 is a mistake" while preserving normal written comments. The existing
  comments button remains the separate control for hiding or showing ordinary
  notes.
- Board move-quality bubbles are aligned using the actual eval-rail width plus
  board gap in pixels, not a rem-based approximation, so their square-relative
  placement stays stable when board or font sizing changes.
- Prep move tables support clickable, keyboard-accessible column headers for
  local sorting, matching the Database tab expectation: Move, Games, Results,
  Prep, and State in opponent-move mode, and Move, Games, and WDL in candidate
  reply mode. Manual column-header sorting is position-local: after the user
  makes another move, Prep returns to its saved automatic defaults, normally
  Usage for opponent/source moves and Strength for the user's candidate moves.
- Under-board Prep stays more compact than the right-side Prep panel: it forces
  dense controls/tables and replaces the large off-start blue alert with a
  one-line status so the move table remains the primary content.
- On 2026-06-19, the under-board Database/Prep surfaces were intentionally
  split from the right-side Database/Prep surfaces. Under-board Database now has
  its own per-tab source, local filters, Lichess/Masters filters, tab, and move
  strength side state; under-board Prep has its own prep workspace and saved
  defaults seeded from the under-board database state. Keep these placement
  states independent so a prep workflow can compare one database under the
  board with another database or prep source on the right.
- Engine output is docked into the active panel where possible and hidden when
  disabled.
- Board tab labels use icon-first compact tabs with hover tooltips.
- Arrow keys move through notation unless a modifier is held.

### Analysis And Engine Surfaces

- Analysis uses local engines, ChessDB, and Lichess Cloud where available.
- Lichess Cloud evals are integrated into analysis and local-engine fallback.
- Local Stockfish starts promptly while cloud checks run in parallel.
- On 2026-06-19, analysis cloud fallback gained explicit Lichess Cloud status
  state. `engineCloudEvalStatusFamily` stores per-position checking,
  available, missing, and error messages; `utils/lichess/api.tsx` now raises
  typed cloud failures for missing, rate-limited, timeout, network, HTTP, and
  invalid-response cases; and `EvalListener` records cloud availability while
  preserving local Stockfish fallback.
- A same-day follow-up made Lichess Cloud authoritative for local-engine
  analysis. Local Stockfish may still show interim/fallback lines, but a
  successful Lichess Cloud response replaces them instead of losing a short
  race. Engine rows now show `Cloud checking`, `No cloud`, or `Cloud error`
  status plus the exact reason in the expanded panel when Lichess is missing,
  timed out, rate-limited, unreachable, or returning bad data.
- On 2026-06-06, `scripts/generate-stockfish-opening-games.py` was added as a
  local utility for producing En Croissant Files-library PGNs from fixed
  opening positions using Stockfish 18 against Stockfish 11. It writes one
  multi-game PGN per opening under `Documents/EnCroissant/Stockfish 18 games`,
  tags the fixed line and learning side in PGN headers, supports `--only` for
  adding one opening without rerunning the whole suite, and expects the local
  engine cache under `%LOCALAPPDATA%/EnCroissantEngineMatches`. The Vincent
  Keymer System entry currently starts from
  `1. Nf3 d5 2. c4 e6 3. e3 Nf6 4. Nc3 Be7 5. b3 O-O 6. Bb2`.
- Engine output has been compacted so lines remain single-row and the dock fits
  content.
- Engine contention was reduced so analysis, annotation, and review UI remain
  responsive.
- Engine Plan Explorer can show plan-like continuations from engine analysis,
  including automatic board arrows.

### Databases And Sources

Database work is centered in `src/components/databases/*`,
`src/components/panels/database/*`, and `src-tauri/src/db/*`.

- Local database search now has cancellable request IDs.
- Database, Compare, and Plan Explorer cancel obsolete searches when users
  leave the view or change the source.
- Exact position lookup uses serialized occurrence indexes in `.ecsi` search
  indexes where possible.
- Existing v4 `.ecsi` indexes remain readable.
- Very large databases skip the synchronous occurrence table path to avoid
  blocking Mega Database loads.
- The mmap search-index cache keeps several recent indexes warm so Compare can
  keep both selected databases active.
- Search, replay, index generation, Plan Explorer, and database panels tolerate
  Shakmaty's harmless "too much material" validation case for displayable games.
- Opening tables support compact rendering, sorting, recent move sorting,
  player-perspective filters, cloud-enhanced move ranking, WDL perspective
  styling, and board-arrow previews on hover.
- Database Compare supports local sources, Lichess All, and Lichess Masters.
- Database panels use saved default source controls.
- Database panels now default to Lichess All when no explicit local reference
  database default exists. Online stats searches avoid hydrating sample-game
  PGNs, and Lichess explorer/game/cloud requests have explicit timeouts so the
  Database tab exits loading with an error instead of spinning forever when the
  remote service stalls.
- The Databases area now treats database folders as first-class organization:
  `.db3` files can live in nested folders under the database root, folders can
  be created or renamed from the database manager, databases can be moved into
  folders, and the Auto organize action groups common sources such as
  repertoires, online games, reference databases, personal games, and opponent
  prep databases. Folder moves preserve matching `.ecsi` search indexes.
- Database selectors used by analysis, Compare, Plan Explorer, Analyze
  Repertoire, opponent prep, and home review setup use a two-step picker:
  root-level databases remain directly selectable, while foldered databases are
  reached by first choosing the folder and then the database inside it.
- Databases can be linked to a Files folder that stores one PGN per game.
  Creating the link is available from the database export flow, and linked
  folders are incrementally synced after manual imports plus online and Lichess
  Study auto-updates by adding only games whose PGN content is not already in
  the folder.
- PGN conversion now initializes the En Croissant schema based on actual tables
  rather than only file existence, so zero-byte placeholder `.db3` files created
  during interrupted folder organization or external prep workflows are repaired
  on the next import instead of becoming permanent `no such table: Info`
  database cards.

### Online Game And Study Data

Online flows are in `src/utils/onlineGameImport.ts`,
`src/utils/onlineLatestGame.ts`, `src/components/common/OnlineGamePickerModal.tsx`,
and `src/utils/lichess/study.ts`.

- Lichess and Chess.com usernames can be imported into local databases.
- A merged online database can combine linked Lichess and Chess.com accounts.
- Lichess account tokens are reused when available.
- Online imports report progress and keep progress moving during long fetches.
- Online mistake and opening review decks can auto-update when linked account
  databases update.
- On 2026-06-14, review-deck auto-updates were hardened for moved online
  databases. Opening Review and Mistake Review now resolve the current database
  record by online identity when a saved deck still points at an older
  `*_chesscom.db3` or `*_lichess.db3` path, then write the recovered path back
  on the next successful scan. Opening Review also treats a newer database
  `lastUpdatedAt` as a scan trigger even when the stored game count already
  matches, so a database update cannot consume the signal before the deck scans.
- The online game picker has provider tabs for Lichess and Chess.com, account
  selection, recent-game previews, single-select analysis, and multi-select
  review deck creation.
- The online game picker now has Newer/Older paging so analysis and review
  creation can reach beyond the first recent-game slice without importing a
  full account database.
- Recent-game picker rows show the formatted time control next to the account,
  date, and result so online analysis/review choices can be filtered by pace at
  a glance.
- The Prep tab can import Lichess or Chess.com player games directly into the
  active opponent-prep source. Imports can use a most-recent game count with a
  preview of the oldest included game, or an uncapped date range such as last 3
  months or last year, and can optionally be saved as a normal database.
  Opening the import drawer collapses the normal prep filters so the online
  source, range, save, preview, and import controls remain compact.
- Prep move choice now uses a strength model based on raw cloud-engine
  centipawn loss and raw practical WDL loss instead of ordinal rankings. Prep
  tables can sort by Strength, and Prep settings expose Engine, Practical, and
  Smart modes plus a Smart engine/database blend and maximum safe CP drop, so a
  practical database move can beat a slightly better engine move while large
  engine drops are filtered out.
- Database opening tables now distinguish engine-only CP strength from the
  blended practical strength model. The shared table shows a separate blended
  strength column and sort, with a settings button in Database and Compare
  panels for Smart/Engine/Practical mode, engine blend, and maximum CP drop.
- The Prep panel also has a directly visible Strength settings button, separate
  from Builder settings, so max CP drop and engine/database blend can be tuned
  without opening the larger builder settings section.
- Player-mode Prep has a Straight Line finder for venom prep. From the current
  prep start it searches engine-approved user replies, requires each opponent
  move to meet a high forced-play-rate threshold, and surfaces lines where the
  final engine eval is objectively bad for the opponent; the result can be
  played onto the board for immediate analysis.
- Straight Line search falls back to candidate user moves from the selected
  opponent database when cloud/ChessDB does not return user replies, so prep
  against an opponent as Black can still reach their first forced reply from
  the starting position. Final "bad for them" scoring still depends on an
  engine eval for the target position.
- Smart strength now treats one- and two-game WDL spikes as evidence-poor:
  tiny samples are blended back toward the current position's practical baseline
  based on usage share before the engine/database blend is scored.
- Smart strength also detects clustered engine evaluations: when the top cloud
  engine candidates are within roughly 30cp, the effective engine weight is
  reduced so practical WDL evidence acts as the tie-breaker; clear engine
  separation restores the configured blend.
- On 2026-06-19, desktop Prep and Database strength handling was hardened for
  Lichess Cloud rate-limit and partial-coverage states. Opponent Prep shares
  engine lookups by FEN, side, and MultiPV across the side panel and under-board
  panel; Prep keeps ChessDB's full all-move fallback instead of slicing it to
  the Lichess MultiPV count; and strength is scored from the full 20-row prep
  move pool rather than the currently displayed `Show top` slice. The shared
  strength scorer caps missing-engine fallback scores so an unrelated or absent
  cloud move list cannot turn tiny WDL samples into confident top choices.
  A follow-up tightened the same scorer with a final low-share one/two-game
  sample cap in Smart/Practical modes, and made Prep treat Lichess Cloud as the
  authoritative engine list whenever it is available, using ChessDB only as a
  fallback when Lichess has no usable result. Database tables now prefer ChessDB
  all-move data when Lichess returns a partial list that misses shown rows. A
  later correction added an engine-backed score floor for covered prep moves,
  so a move that is best or safely close by engine cannot display as `0`
  strength merely because its practical WDL is poor; low-sample caps still
  override that floor for tiny one/two-game rows.
- Prep settings now save through a persisted app setting record, including
  source/player filters, min games/show top, move-sort defaults, and strength
  builder settings, so changed controls survive leaving and reopening the app.
- In Prep player mode, the color filter labels use the selected player name
  directly, such as "IfanRJ as white" and "IfanRJ as black", so the side filter
  reads as that player's game color instead of a generic board color.
- Prep player-mode color labels stack the player name above "as white" or
  "as black" and the surrounding filter row can wrap from the bottom edge, so
  long names remain readable beside Min games and Show top.
- In Prep general mode, the user-side selector says "I'm white" and "I'm black"
  so the control reads as the user's prep side rather than abstract colors; the
  segmented control is kept wide enough for both labels to render in full.
- Player-mode Prep can jump from an opponent move back to source evidence:
  opponent move rows and the active branch controls expose Go to game, sampling
  the local prep database, finding the exact FEN plus opponent move occurrence,
  and opening an analysis tab with that move selected.
- Player-mode Prep roots its branch search at the game start by default.
  "Start here" is the explicit action for changing the prep root to the
  currently selected board node; source/player/filter changes should not
  silently move that root to the current board path.
- Straight-line Prep now defaults to a stronger-player-friendly Venom mode:
  it treats repeated opponent choices as habits, scores the reach probability,
  and uses the actual engine evaluation of the position reached after the
  habitual opponent move for the user's prep color, while keeping a Strict mode
  for high-threshold railroad lines.
- Lichess Study links can be imported as local databases.
- Lichess Study databases support auto-update metadata and refresh tracking.
- Lichess Study databases expose a database-manager reload control that
  re-fetches the latest PGN, rebuilding games, comments, variations, and clock
  annotations; the same panel includes an update-automatically checkbox.
- Lichess Study update state now carries source/activity metadata, uses a
  study-specific banner label, times out stalled PGN downloads, and clears stale
  conversion banners left behind by interrupted sessions.
- Lichess Study imports preserve `StudyName`/`ChapterName` as the database
  event, and linked Files folder sync prefixes per-game PGNs with the study
  title so study chapters do not appear as only date plus player names.
- Lichess Study databases can opt into automatic two-way sync. When enabled,
  local En Croissant PGN annotations, variations, tags, and new chapters are
  pushed back to the linked Lichess study before remote changes are pulled into
  the database and linked Files folder; users need to relink Lichess with
  `study:write` scope for pushes. Push permission failures are explained as
  stale/missing study-write account access or missing edit permission instead
  of surfacing Lichess's raw 401/403 response, and the database settings prompt
  users to sign in to Lichess directly instead of relying on a removed Accounts
  page.
- Manual Lichess Study reloads now resolve a two-way-sync conflict in favor of
  the remote study PGN, rebuilding the local database and then syncing the
  linked Files folder. Automatic background sync remains conservative: if both
  the local database and remote study changed, it stops and asks the user to
  reload or resolve one side before pushing local annotations.
- Lichess Study database ordering is treated as source order rather than normal
  recent-game order. Opening a study database from Databases defaults the Games
  tab to ascending database id order, database PGN export explicitly writes
  games by id, and linked study folder sync uses numbered filenames while
  renaming existing matching PGNs into that numbered order so the Files folder
  can mirror the Lichess chapter sequence.
- Linked Lichess Study folder sync dedupes by source mainline as well as exact
  PGN text. This avoids creating a second file when the same game already
  exists locally with different headers or richer comments/variations; the
  local annotated PGN is kept and renamed into the ordered study slot. The
  2026-06-03 cleanup of `My classical games` moved 40 duplicate PGN copies
  into `Documents/EnCroissantDataBackups/my-classical-games-dedupe-*`, leaving
  45 active unique mainline PGNs and preserving all moved copies.
- On 2026-06-10, `My classical games` needed another repair because the study
  database had been used as an online-game import target. The current Lichess
  study `j2XwsJxt` had 45 chapters, while the local database had 58 rows; the
  13 extra rows were Chess.com `Live Chess` games from June 4 and June 6, and
  linked folder sync had also left lower-annotation duplicate PGNs beside the
  rich local copies. The cleanup moved 51 duplicate/off-study PGN+info pairs
  plus a database backup into
  `Documents/EnCroissantDataBackups/my-classical-games-cleanup-20260610-222430`,
  restored the database to 45 games, and renamed all active Files PGNs into
  numeric `0001`-`0045` study order. Future linked study folder sync now keeps
  the highest-annotation same-mainline file, removes stale same-mainline
  siblings during ordered sync, and online-game imports reject Lichess-study
  database descriptions so Chess.com/Lichess account imports cannot append
  into a study database again.
- PGN import timestamp normalization was fixed so online-update ordering stays
  reliable.

### Opening Review

Opening Review is implemented in `src/components/review/OpeningReviewWorkspace.tsx`
with helpers under `src/utils/openingReview*.ts`.

- Opening Review decks are saved files, not localStorage-only state.
- Analyze Repertoire moved into the Opening Review area rather than the normal
  board tab strip.
- Analyze Repertoire has two user-oriented modes: prepare against an opponent's
  repertoire and find gaps in the user's own repertoire.
- The scan is orientation-aware and attributes positions to the side being
  prepared or reviewed.
- Opening health uses frequency, recency, practical result gaps, and only large
  engine drops to prioritize cards.
- Date filters can limit opening health to recent games.
- Opening stats cache names, show summary bars, and respect white/black result
  perspective.
- Cloud validation uses ChessDB for bulk checks, Lichess Cloud for urgent deep
  checks, and local Stockfish fallback when enabled.
- Lichess Cloud hits and misses are cached so repeated scans avoid duplicate
  requests.
- Validation progress survives leaving and returning to the tab.
- Validation updates are batched; the scan can finish after the bulk ChessDB
  pass while slower validation continues.
- Rows show source, depth, evidence, priority messages, and post-attempt review
  evidence.
- Rows can be edited, deleted, or assigned a direct correct-move override.
- Saved review decks can merge new positions into existing decks.
- Daily Review mode creates a due queue with daily progress.
- Full-deck and focused practice remain available, including filtered practice
  by opening, color, or date range.
- Review cards preserve comments, arrows, annotations, board-played move
  overrides, trainer attempts, and post-attempt exploration as saved review-tree
  data.
- Opening stats now make the active filter scope explicit, use compact
  hover-detail rows for plan gaps and best/worst openings, and provide a Train
  button on each opening group so users can practice only that opening's cards.
- Whole decks and individual cards can be deleted.
- Older cards with generic cloud-validation source labels remain compatible.

### Mistake Review

Mistake Review reuses the Opening Review workspace shell with mistake-specific
deck metadata and training logic in `src/utils/mistakeReview*.ts`.

- Mistake Review scans games for mistakes and saves them as spaced-repetition
  cards.
- Local scans and online selected-game scans both create normal review decks.
- Analysis settings include single Stockfish pass or layered fast/deep
  confirmation, severity filters, win-probability drop thresholds, and time
  control filters.
- Mistake decks record source game metadata, player database information, last
  seen text, and latest additions.
- Daily progress is stabilized and synced after online auto-updates.
- Phase training supports focused mistake categories and session progress.
- Reveal controls, auto-reveal arrows, post-attempt summaries, and game context
  were added to make training less opaque.
- Post-attempt board play stays enabled in the Review tab, so users can explore
  continuations while keeping the mistake feedback visible.
- Starting a new Mistake Review card clears stale reveal/free-play state so the
  answer move is scored and the SRS panel appears instead of a return prompt.
- Mistake Review game info is anchored below the main action area so the board
  and action controls stay primary.
- Time-management training has a per-deck long-think threshold setting on the
  trainer button; trainer counts, position filters, and future auto-updates use
  the current threshold while preserving clock-data safety.
- Review action count badges on the idle Review panel have stable non-shrinking
  widths, so two- and three-digit daily/time-management counts remain fully
  readable beside long split-button labels.
- Focused Mistake Review trainers now respect SRS readiness: long-think, phase,
  and type batches include unseen or due cards by default and do not resurface
  cards scheduled for a future day after they have just been reviewed.
- Mistake Review no longer shows the saved answer in the pre-attempt review UI:
  the old "Current position" answer panel was removed, deletion moved into the
  session header, and board/game info summaries hide best-move text until an
  attempt or explicit reveal.
- Mistake Review and long-think review cards now preserve and hydrate the
  source-game move line up to the mistake position, show that line in the
  right-panel moves list, and use the shared move controls so back/forward
  navigation behaves like normal analysis once the answer is visible.
- Mistake Review trainer responsiveness was hardened for large decks: attempt
  bookkeeping and SRS writes are deferred out of the card-transition path,
  due-review sessions precompute their queue instead of rescanning the whole
  deck after every card, source-game line hydration is cached by stable card
  data instead of object identity, and whole-deck maintenance such as nature
  migration, clock hydration, and online mistake-deck auto-updates stay out of
  active practice.
- Mistake Review board attempts are keyed to the active practice session rather
  than the currently selected right-panel tab, so a user can still play and
  score the answer move after checking analysis, moves, or other review panels.
- Mistake Review large-deck daily practice avoids full-deck sorting and eager
  nature classification for the default trainer controls; daily queues use
  bounded ranked indices and time-management counts stay cheap until training
  actually starts.
- Mistake Review keeps the interactive engine listener alive on right-side
  panels that render engine controls, including the Review page, so reveal-time
  engine enabling and dock controls work without forcing users into the Eval
  tab.
- Opening Review and Mistake Review practice transitions load the target FEN
  first and defer source-game move-line hydration plus saved review-tree child
  cloning until the hidden-answer phase is over; idle prewarming should not
  parse full saved move sequences or clone saved child lines while the user is
  actively solving a hidden card.
- Opening Review and Mistake Review session progress bookkeeping is scheduled
  as transition work during practice starts and card advances, keeping the board
  position swap and practice-state reset higher priority than counters and
  remaining-queue UI updates.
- Opening Review and Mistake Review practice tree persistence is coalesced and
  idle-scheduled while training, so attempted moves and annotations still save
  back to the deck without forcing immediate large-deck atom updates during the
  next-card path.
- Board-side review-card lookups use the shared review FEN index instead of
  scanning the whole deck when resolving the current practice or mistake card.
- Hidden-answer review cards keep move-list and move-control subscribers
  unmounted and suppress engine-arrow derivation until feedback is visible, so
  the next-card paint is not competing with notation controls or stale analysis
  arrow processing.
- Normal analysis boards now use an inert empty review-deck key unless a
  review/practice session actually needs deck data. This keeps stale default
  review storage and large FEN indexes from waking on every board move, so the
  move list can update promptly while review tabs keep their indexed lookups.
- Hidden-answer mistake cards use only already-stored mistake-type metadata in
  board and game-info panels; fresh tactical/positional classification is
  deferred until answer feedback is visible.
- Due, full-deck, and scoped review trainers keep their large
  remaining-position queues stable while advancing by cursor offset, avoiding
  per-card array copies through React state on large Opening Review and Mistake
  Review decks.
- Full-deck Opening Review and Mistake Review practice now use an explicit
  lazy all-positions queue instead of materializing every card index up front.
  Daily opening batches and mistake phase/type/time-management batches return
  position indices directly, so focused trainer startup avoids extra
  position-array construction and reference remapping while preserving the
  existing whole-deck JSON storage format.
- Engine enable/disable-all updates are idempotent, so Mistake Review's
  optional engine-off-on-navigation behavior does not rewrite engine settings
  or wake engine subscribers when engines are already in the requested state.
- Review summary snapshots stay frozen while a practice session is active and
  refresh when practice returns idle, avoiding the old delayed 2.5-second
  whole-deck stats refresh during card transitions on large decks.
- Time-management trainer batches now treat repeated long-think evidence for
  the same FEN as one SRS item: a reviewed or scheduled copy suppresses fresh
  duplicates until it is due, attempted-today duplicates are skipped, and the
  ready count reflects the deduped board-position queue.

### Puzzle Training

Puzzle training is being upgraded from session-only random puzzle practice into
a durable guided trainer. The downloaded Lichess puzzle `.db3` remains
read-only; user progress is stored separately in an app-data SQLite database
keyed by a stable puzzle database fingerprint. Backend commands now initialize
and read puzzle progress, select Coach/SRS/theme/rating/random training
puzzles, record rated attempts, update SRS cards and per-theme skill estimates,
serve dashboard data, and reset/export progress. The Coach selector clears
urgent due cards first, then ordinary due reviews, then weak-theme or
rating-calibration puzzles. Puzzle progress is intentionally scoped per
installed puzzle database snapshot so future database updates do not silently
mix stats from different source data.

- The Puzzle tab UI now has Train, Stats, and SRS panels. Train shows Puzzle
  Elo, database accuracy, due/mastered counts, selection reason, SRS state,
  current puzzle themes, and the Elo delta after an attempt. Stats shows Elo,
  volume/accuracy trends, and per-theme skill/weakness rankings in one place;
  theme rows update immediately from the recorded attempt result and are then
  reconciled by the full dashboard refresh. SRS exposes counts, the next review
  queue, reset, refresh, and progress export controls. Completed puzzle
  attempts now increment existing puzzle daily goals automatically instead of
  requiring the Home goal's manual progress button.
- On 2026-06-15, Puzzle Training gained a Blindfold tactics solve mode. The
  mode uses the same puzzle database and solution-line mechanics as normal
  puzzles but records attempts, SRS cards, theme stats, dashboard data, export,
  reset, and Elo under a separate `blindfold:` progress namespace so Blindfold
  Elo never mutates normal Puzzle Elo. The Train panel has a Normal/Blindfold
  solve-mode switch, the settings accordion owns the configurable blindfold
  preview time, the board is visible but not draggable during preview, then an
  opaque hidden-board overlay appears. Solving happens from the right panel
  with blindfold-style Legal moves / Manual SAN input, and correct moves
  auto-play the puzzle reply while showing that response SAN prominently.
- Puzzle selection now broadens empty filter combinations before surfacing an
  error: if a theme/rating search has no match, it falls back through rating
  only, broad theme, then any available puzzle. Switching puzzle databases
  also clears the active session puzzle so stale puzzle IDs are not recorded
  into the newly selected database.
- Puzzle training now auto-selects an available saved puzzle database when the
  previous selection is missing, auto-loads the first trainer card for the
  selected database, and uses a visible Start/Next puzzle button instead of a
  tiny plus icon. Completed puzzles now stay selected long enough to show
  feedback, freeze the solve timer, display the Elo/SRS result, and let the
  user explicitly request the next trainer card. Completion feedback is
  optimistic and local-first: the timer stops and the result panel appears
  before the backend persists Elo/SRS progress, then the backend result is
  merged in when available. Selection-reason banners such as "Rating
  calibration" are hidden once a card is completed so they cannot mask the
  solve feedback.
- Puzzle Elo display preserves one decimal place and ignores stale progress
  refresh responses, so small review deltas remain visible and an older
  dashboard request cannot overwrite the fresher summary returned by a just
  recorded attempt.
- On 2026-06-10, puzzle attempt summaries returned from
  `recordPuzzleAttempt` became authoritative in the trainer UI so Puzzle Elo
  updates immediately after every recorded solve, miss, hint, or solution view.
  The Train panel now also shows a signed whole-number last Elo change such as
  `+10` or `-7`, and includes compact purpose copy for Coach, SRS, Theme,
  Ladder, and Random modes so users know when to choose each training path.
- A follow-up on 2026-06-10 simplified the Puzzle Train surface to two
  user-facing modes. `Smart` maps to the existing Coach backend selector and
  uses SRS first, then weaker-theme balancing, then rating-fit fallback without
  inheriting manual filters. `Manual` exposes only theme and rating range
  controls while still recording every solve, miss, hint, or solution view
  through the same rated Elo attempt model. The old five-way
  Coach/SRS/Theme/Ladder/Random selector and Progressive switch should stay
  hidden unless a future design deliberately re-expands the trainer.
- Another 2026-06-10 fix removed a truthiness check from the puzzle attempt
  recorder. Puzzle ids can be valid even when they are `0`; the UI must record
  attempts whenever the id is a finite number, otherwise Puzzle Elo silently
  stays static. Failed or skipped writes should clear the transient
  `Saving result` badge and surface a progress error instead of pretending
  the Elo update is still in flight.
- A further 2026-06-10 fix hardened the stuck `Saving result` path. The
  generated Tauri binding can throw real JavaScript `Error`s before returning a
  typed `Result`, so puzzle attempt saves must wrap `recordPuzzleAttempt` in
  `try/catch`, clear the optimistic saving state on failure, and show the
  thrown message in the progress alert. The frontend now also sends
  `timeSpentMs` as a plain safe number cast to the generated bigint type
  instead of a JavaScript `BigInt`, and retries any completed session puzzle
  that is still marked `attemptRecorded: false` so old stuck cards can finish
  saving after a reload.
- The Puzzle Train panel now uses explicit `Start training` and
  `Stop training` buttons inside the main Smart/Manual surface. `Stop training`
  clears the timer and disables solve timing, while `Start training` resumes
  timing for the current incomplete puzzle or loads the first session puzzle.
  Do not reintroduce a timer-labeled switch for this flow.
- On 2026-06-10, the Next puzzle path was made latency-tolerant. The trainer
  now keeps one matching training candidate prefetched for the active
  database/mode/rating/theme request and consumes that buffered card
  immediately when the user presses Next puzzle, then warms the following card
  in the background. Smart/SRS mode avoids prefetching while the current due
  card is still incomplete so the buffer does not repeat the same due puzzle.
  The backend random fallback also no longer uses `ORDER BY RANDOM()` for
  puzzle selection; it counts the filtered set and fetches a random offset,
  avoiding multi-second SQLite shuffles on large puzzle databases.
- On 2026-06-11, puzzle page loading was adjusted so rusqlite `query_map`
  iterators are collected into a local value before returning from
  `load_puzzle_page`. Keep this binding pattern in future puzzle pagination
  changes; returning the borrowed iterator chain as the final block expression
  can trip Rust's temporary-drop ordering and break the Tauri binary compile.
- A follow-up on 2026-06-10 hardened puzzle database handling against stale or
  invalid `.db3` selections. Puzzle source databases now open read-only and are
  validated before any trainer/progress command computes the database
  fingerprint, so missing paths cannot silently create empty SQLite files and
  raw `no such table` errors are converted into a user-facing invalid puzzle
  database message. Puzzle progress also migrates from the scanned
  `puzzles/puzzle-progress.db3` location into app-data `progress`, while the
  picker ignores any old `puzzle-progress.db3` file left behind so progress
  storage is not rediscovered as a puzzle source.
- A later 2026-06-10 persistence fix made that migration defensive instead of
  one-shot. Opening puzzle progress now initializes both the new
  `progress/puzzle-progress.db3` database and any legacy
  `puzzles/puzzle-progress.db3`, then merges legacy profiles, attempts, SRS
  cards, theme stats, and daily snapshots into the new store without duplicating
  attempts. This prevents Puzzle Elo from appearing to reset to 1500 between
  sessions when attempts were still stranded in the old puzzle-folder progress
  database or the copied target had an older default profile.
- Puzzle SRS is now attempt-quality aware instead of treating every clean solve
  the same. `recordPuzzleAttempt` classifies attempts as Failed, Assisted,
  Hard, Solid, or Fluent using solution/hint/wrong-move flags, solve time
  normalized by puzzle rating and current Puzzle Elo, and weak-theme context.
  Failed cards return in 10 minutes, assisted cards return tomorrow, hard
  solves use a short ladder, solid solves use a normal ladder, and fluent
  first-time solves graduate straight to mastered so high-volume training does
  not turn every easy puzzle into a future chore queue. Trainer feedback and
  the SRS queue show the last quality so the scheduling reason is visible.

### Practice Bot Trainer

Practice bot work is in `src/utils/practiceBot.ts`,
`src/hooks/usePracticeAgainstBot.ts`, `src/components/boards/OpponentForm.tsx`,
and `src-tauri/src/game.rs`.

- Puzzles now have a bot-practice entry point.
- The play setup can use a trainer bot profile instead of only a manually
  selected engine.
- Managed Maia trainer support installs or configures LC0/Maia where supported.
- Trainer strength is configured by FIDE-style rating and mapped to Maia or
  Stockfish as needed.
- Stockfish is used above Maia's useful capped range.
- Bot clock pacing and move delay were tuned so practice feels closer to a real
  opponent.
- Trainer settings include bot kind, rating, time usage, and time control.

### Plan Explorer

Plan Explorer lives in `src/components/panels/plan/PlanExplorerPanel.tsx`,
`src/utils/planExplorer.ts`, and backend search code.

- The tab is a ChessBase-style way to see piece routes and common plans from
  the current position.
- Sources include local reference databases, Lichess All, and Lichess Masters.
- Rows are grouped by piece, route count, result bars, side filters, ply depth,
  and selected database.
- Hovering a route previews arrows on the board.
- Hovering a piece row previews the piece's most common maneuver.
- Clicking a route pins its arrows.
- Ctrl+right-click on a board piece draws that piece's normal route.
- Auto arrows can be enabled from the panel and globally from board settings.
- Defaults are 8 ply and 10 automatic arrows.
- Automatic plan selection favors significant queen, rook, bishop, and knight
  maneuvers plus key pawn breaks or advanced pawn moves.
- Castling is treated as a first-class plan text case: local/online Plan
  Explorer rows and Engine Plans should show kingside or queenside castling
  rather than a king route through the rook square.
- Fallback scans use depth-aware sample caps and cancel as soon as enough
  continuations have been collected.
- Repeated lookups are cached, and side filters are pushed into board arrow
  data.

### Pawn Structure Trajectory

Pawn Structure Trajectory is implemented in `src/utils/pawnStructureDetector.ts`
and `src/utils/pawnStructureTrajectory.ts` using
`src/data/pawnStructureTemplates.v1.json` as the source of truth.

- All 28 Flores/Rios structure templates are first-class detector targets.
- Detection is pawn-skeleton based, supports colour reversal for every template,
  and supports file mirroring only where the template allows it.
- Required template features are weighted confidence signals rather than exact
  equality gates, while anchor pawns and forbidden conflicts keep matches
  conservative.
- Every detection returns confidence, side roles, evidence, and typical
  pawn-break plans where available.
- Open KID detection covers both common central-exchange subtypes: dxe5/dxe5
  e4/e5 liquidation and ...exd4 structures with primary c4/e4, no primary
  d-pawn, opposing d6, and the opposing c-pawn still providing KID context.
- KID Type I is calibrated as the post ...cxd5/cxd5 structure with d5/e4
  versus d6/e5 and both c-pawns gone; a position where Black has only played
  ...c6 remains pre-exchange and should not be labelled Type I.
- Benko detection includes the accepted/post-c-pawn-exchange shape where the
  primary side has d5/e4 with no c-pawn against opposing c5/d6, but still
  requires missing opposing a/b-pawn or open-file evidence so ordinary Benonis
  do not get absorbed.
- Asymmetric Benoni is calibrated as the c-pawn-exchanged d5/e4 versus c5/d6
  structure: the primary c-pawn is gone and the opposing e-pawn is gone. If the
  primary c-pawn remains on c4, use the appropriate symmetric Benoni/KID/Benko
  sibling instead of forcing Asymmetric Benoni.
- French Type I and III are calibrated around the d/e French centre while
  allowing c-pawns to remain home or advance: Type I is d4 versus d5/e6 with no
  primary e-pawn and no opposing f-pawn; Type III is d4/e5 versus d5/e6. Panov
  accepts the opposing e-pawn on e7 or e6, since c5/d4 versus d5 is the anchor.
- Najdorf, Dragon, and Scheveningen structures treat the opposing c-pawn being
  gone as a strong Sicilian-family signal rather than an absolute gate. If the
  c-pawn is still on the c-file, including c5, the detector may still classify
  the central shell but should show lower confidence and missing-c-file
  evidence.
- Central c/d/e pawn coordinates carry extra weight in Sicilian/KID/French
  overlap. In Open Sicilian shells, primary c4+e4 with no d-pawn and the
  opposing c-pawn gone is treated as a Maroczy Bind rather than Najdorf Type II,
  even if the opponent also has a d6/e5 Boleslavsky-style centre.
- The 3-3 vs 4-2 endgame-majority template allows file mirroring, so it detects
  both queenside and kingside versions of the four-pawn majority while still
  requiring simplified/central-liquidated evidence. It is strict about pawn
  files rather than ranks: primary a/b/c/f/g/h versus opposing a/b/c/d/g/h, or
  the file-mirrored equivalent.
- Main-line trajectory analysis groups consecutive structures, suppresses
  one-ply flicker, identifies transitions, picks primary and secondary
  structures, and writes a compact structural story.
- The board workspace has a compact Structures tab showing the current
  position label, confidence, role text, evidence, primary/secondary game
  structures, segment timeline, and transition moves. Clicking a segment jumps
  to the first move of that structural phase.

### Layout, Interaction, And Polish

- The old board workspace split shell was replaced with a resizable board and
  right-side layout.
- The board grows with a widened left pane, and responsive panel scaling keeps
  dense database/review tables usable.
- Resize handles are hidden unless needed visually.
- Annotation tools stay visible under the board instead of living in a tab.
- Board arrows are used for database moves, Compare rows, Analyze Repertoire,
  Plan Explorer routes, engine plans, and review feedback.
- Hover behavior should be discoverable through cursor changes, tooltips, icon
  tabs, or visible row affordances.
- The annotation editor should not steal focus from board or practice input.
- Compact panels should use icons, small labels, and stable row heights rather
  than large cards.
- Result bars should match the player's perspective in database, plan, and
  review contexts.
- Board workspaces now have a small board-style settings button in a slim rail
  beside the board, outside the chessground interaction surface.
  The persisted style can stay on the user's default board/piece setup or
  switch to a chess.com-inspired package with green squares, the real Chess.com
  Neo pieces vendored locally from the public theme PNGs, yellow
  selected/last-move squares, tuned arrow brushes, and the current Chess.com
  move/capture/check sounds vendored locally from the live web bundle. Volume
  still follows the normal sound setting. During Tauri dev runs, sound playback
  should prefer the Vite-served `/sound/...` files so newly vendored collections
  work before the Tauri resource directory is rebuilt. The mode is an override,
  so default appearance settings remain intact when users switch back. Keep the
  chess.com arrow/highlight SVG layers on `pointer-events: none`; otherwise they
  sit above the board and block piece selection.

## Design Guide

- Keep the app board-first. The chessboard and current position should remain
  the visual anchor for analysis, review, database research, and training.
- Prefer task-first entry points over exposing raw tabs as the first decision.
  Home should answer "what do you want to do now?"
- Do not remove expert functionality to simplify the app. Layer it behind
  sensible defaults, collapsible settings, focused modals, and saved choices.
- Make evidence explicit. Rows that recommend a move, review card, plan, or
  mistake should show source, sample size, depth, recency, result impact, or
  validation source where relevant.
- Treat cloud and engine work as background work. Show progress, allow users to
  keep moving, cache results, and avoid UI freezes.
- Make data provenance visible. Differentiate local database, Lichess All,
  Lichess Masters, ChessDB, Lichess Cloud, Stockfish, Chess.com, Lichess, merged
  online database, and Lichess Study sources.
- Use compact, utilitarian chess-tool UI. This is a working analysis app, not a
  marketing page. Prefer dense tables, clear sorting, restrained panels, and
  predictable controls.
- Keep text short and user-facing. Prefer "Review due", "Analyse latest",
  "Train mistakes", and "Create Opening Review" over technical implementation
  language.
- Preserve confidence and safety around destructive actions. Deleting decks,
  deleting cards, changing trained moves, and overwriting saved data should
  require clear confirmation or obvious recovery affordances.
- Responsive behavior matters. Check board size, right-panel scroll behavior,
  tab labels, engine dock height, and table overflow on laptop and wide
  viewports.
- Use icons in compact tabs and action buttons, but provide hover labels or
  `aria-label`s so the UI remains discoverable.
- Do not add large explanatory cards inside already framed panels. Review,
  database, and analysis surfaces should feel like workspaces.

## Implementation Map

- `src/components/tabs/NewTabHome.tsx`: home launcher, recent files, online game
  picker entry points, Opening Review modal, Mistake Review modal, latest game
  shortcuts.
- `src/components/boards/BoardAnalysis.tsx`: main board workspace layout,
  right-side analysis tabs, annotation layout, engine dock integration.
- `src/components/boards/Board.tsx`: board input, review practice behavior,
  arrows, hover previews, visibility toggles, and board-played move overrides.
- `src/components/review/OpeningReviewWorkspace.tsx`: Opening Review and
  Mistake Review workspace, review panels, daily/full/focused practice,
  position list, stats, analyze view, auto-update banner integration.
- `src/components/panels/gaps/RepertoireGapsPanel.tsx`: Analyze Repertoire and
  opening health scanning UI.
- `src/components/panels/database/*`: Database and Database Compare panels,
  perspective controls, source options, games/openings tables.
- `src/components/panels/plan/PlanExplorerPanel.tsx`: database-backed plan
  explorer.
- `src/components/panels/enginePlan/EnginePlanExplorerPanel.tsx`: engine-backed
  plan explorer.
- `src/components/panels/structure/PawnStructurePanel.tsx`: current-position
  pawn structure card and full-game structure trajectory panel.
- `src/utils/pawnStructureDetector.ts`: all-28 pawn-skeleton detector,
  confidence scoring, colour reversal, file mirroring, evidence, and sibling
  disambiguation.
- `src/utils/pawnStructureTrajectory.ts`: main-line structure sampling,
  segment smoothing, primary/secondary scoring, transitions, and story
  generation.
- `src/components/panels/analysis/*`: local/cloud engine display and compact
  best-move rows.
- `src/components/common/OnlineGamePickerModal.tsx`: recent online game picker
  shared by latest-game analysis, online Opening Review, and online Mistake
  Review.
- `src/components/databases/AddDatabase.tsx`: database import modal, online
  account database import, merged database import, Lichess Study import.
- `src/utils/databaseFileExport.ts`: shared helpers for exporting PGN or `.db3`
  sources into Files folders with one game PGN plus metadata sidecar per game,
  plus additive linked-folder sync for updating databases.
- `src/state/atoms.ts`: persisted source choices, auto-update state, review
  deck state, practice state, Plan Explorer state, compare selection state, and
  database-to-Files-folder link records.
- `src/utils/tabs.ts`: tab types and game-origin routing for analysis, database
  games, Opening Review, and Mistake Review.
- `src/utils/openingReview*.ts`: review deck persistence, auto-update,
  position ranking, practice logic, opening names, filters, and compatibility.
- `src/utils/mistakeReview*.ts`: mistake deck creation, scanning, daily/phase
  practice, auto-update, and metadata.
- `src/utils/onlineGameImport.ts`: online database imports and update metadata.
- `src/utils/onlineLatestGame.ts`: linked provider selection and recent/latest
  game lookup.
- `src/utils/lichess/study.ts`: Lichess Study import and update metadata.
- `src/utils/practiceBot.ts` and `src/hooks/usePracticeAgainstBot.ts`: trainer
  bot setup, managed Maia/Stockfish selection, and game integration.
- `src-tauri/src/db/search.rs`: database search, occurrence lookup, repertoire
  gap search, recent sorting, and perspective-aware result data.
- `src-tauri/src/db/search_index.rs`: `.ecsi` index format and occurrence table
  serialization.
- `src-tauri/src/db/mod.rs`: database import, update, online/study metadata,
  PGN timestamp normalization, and backend commands.
- `src-tauri/src/chess.rs`: game metadata and review/mistake backend helpers.
- `src-tauri/src/engine/process.rs`: local engine process startup and
  contention fixes.
- `src-tauri/src/game.rs`: play/trainer bot engine game behavior and clock
  pacing.

## Recent Feature Inventory

This inventory covers the recent two-week session represented by git history
from 2026-04-24 through 2026-05-03.

- Analysis workspace: Compare, Database, Plan Explorer, Engine Plans, Info, and
  Practice were shaped into a board-centered workspace with responsive panels
  and docked engine output.
- Plan Explorer: database-backed plan extraction, local and online sources,
  route previews, pinned arrows, board piece hover shortcuts, auto arrows,
  caching, and large-database fallback speedups were added.
- Database search: exact position occurrence indexes, cancellable searches,
  large-index responsiveness, cache warming, recent move sorting, player
  perspective filters, and cloud-enhanced move rankings were added.
- Online data: Lichess/Chess.com imports, merged online databases, online game
  picker flows, latest-game analysis, selected-game review creation, and
  Lichess Study database import/update support were added.
- Online game clocks: imported online games now surface simple per-move think
  times in notation from clock or timestamp comments, board clocks sit with the
  player strips at the top-left and bottom-left of the board area, and older
  online databases are marked for clock-data enrichment during refresh. Direct
  Chess.com game-link imports also translate callback move timestamps into PGN
  clock comments so existing display and save paths keep the timing data. Move
  list think-time chips show tenths of a second when the source provides them.
  Move controls include live replay, which advances through timed games using
  the recorded think time for each next move from a labelled play/pause control,
  animates the active side's board clock during each replayed move, and shows a
  blue full-game progress bar with remaining replay time.
- Opening Review: Analyze Repertoire was moved into review, opening health
  scoring was added, cloud validation was layered in, review decks became
  trainable files, and daily/full/focused spaced repetition workflows were
  added.
- Mistake Review: mistake scanning, mistake decks, daily progress, phase
  training, reveal controls, engine dock support, online selected-game scans,
  auto-updates, and game metadata were added.
- Practice bot: puzzle/bot entry points, trainer settings, managed Maia,
  Stockfish fallback, FIDE-style strength selection, and clock pacing were
  added.
- Board and layout: resizable board/right-side layout, under-board annotations,
  tab tooltips, compact engine lines, annotation focus fixes, hover arrow
  previews, and responsive panel scaling were added.
- Review panel readability: Opening Review and Mistake Review right-side panels
  were tightened so primary actions, progress, sync status, and game evidence
  fit default laptop-height panels, with shorter visible tab labels, wrapping
  action text, and compact mistake-game moves access.
- Mistake Review moves panel: the expanded right-panel moves area now uses one
  larger notation rectangle with its PGN and display controls in the header,
  removing the detached eval strip and separate arrow navigation row.
- Mistake Review now opens the right-panel moves area by default so the game
  line remains visible during review; users can still collapse it when they
  need the extra vertical room.
- Persistence and compatibility: review deck file storage, old review-card
  compatibility, no-tab preview safety, stale index refresh, and PGN timestamp
  normalization were added.
- Local process guidance: browser verification is opt-in only when the user
  explicitly asks for Playwright/browser checks, and agents should not rely on
  the old direct-browser minimal Tauri-global stub method.
- Performance pass: annotation changes now reuse notation/transposition derived
  data unless the move tree structure changes, review deck saves are delayed to
  idle time, large review files save more compactly, review deck summaries are
  cached by file mtime, trainer summary counts defer full-deck passes so the
  board and primary controls can paint first, and local engines stay warm
  longer with a startup watchdog.
- Engine responsiveness: board play with Stockfish enabled now keeps stale
  analysis requests from updating React, cancels superseded local searches, and
  avoids recomputing full move lines for engine arrows when the current board
  position is already known.
- Engine focus policy: when the app loses focus or becomes hidden, interactive
  board/plan/review engines are stopped and pending UI engine probes are
  cancelled, while intentional batch work such as Mistake Review scans,
  analysis reports, and opening-health engine verification keeps running.
- Review transition responsiveness: mistake/opening review now prewarms nearby
  card board states, defers SRS card writes until after the next card paints,
  and lets move-drop visuals paint before post-attempt feedback and cloud/engine
  assessment work begins.
- Opening trainer persistence: Opening Review attempts now become real board
  moves instead of temporary preview positions, so the attempted move stays on
  the board and annotations/variations created during gap training save back to
  the deck.
- Opening stats colour grouping now uses the source player's actual move side
  from the saved game position, so opponent-prep review-side inversions do not
  misclassify openings such as King's Gambit under the wrong colour.
- Opponent prep now seeds the player username field from the most common player
  counted across white/black game appearances in the selected local database,
  so single-player prep databases open ready to build without manual player
  search while still preserving manual edits and matching database-title casing
  where it refers to the same player.
- Opponent prep General mode now defaults to Lichess All when the user switches
  from player-specific prep, while still allowing another source to be chosen
  manually afterward.
- Launch reliability: the Windows fork launcher and `pnpm dev` fallback now
  serialize dev-session startup so repeated launches do not stop the Vite dev
  server while the Tauri WebView is still loading `localhost:1420`; clean
  single-instance exits are treated as an activation handoff instead of a broken
  binary. The launcher also self-heals missing `node_modules` by running
  `pnpm install --frozen-lockfile` before starting Vite or Tauri, so restored
  repo copies and moved worktrees can still launch from pinned shortcuts. The
  frontend updater package is explicitly declared so restored installs resolve
  the startup update-check import instead of opening Vite's missing-import
  overlay.
- Lichess login reliability: the OAuth callback server now binds a fresh
  localhost listener before opening the browser, then shuts it down after the
  callback, avoiding stale or racing localhost redirects.
- Files import ergonomics: the Files page now has an "Import database as files"
  action that accepts PGN, compressed PGN, or `.db3` sources, creates a named
  folder under the selected location, and writes each game as its own PGN plus
  the normal `.info` metadata sidecar.
- Analysis/database export ergonomics: analysis boards now expose a top-left
  app-bar Save game to files action near the File menu that saves a PGN copy
  from any analysis origin, and database settings can export an entire database
  into the Files root as a folder of individual game files.
- Opponent prep defaults: new Prep tabs now start with Min games set to 1 so
  even one-game opponent branches are visible by default.
- Opponent prep recency labels: Prep move rows now show relative last-played
  text such as "Last played 49 days ago" instead of only a raw game date, with
  the exact date still available on hover.
- Startup responsiveness: cached directory paths now let common route loaders
  paint immediately while the real paths refresh in the background. Major
  route and board workspace chunk loads show progress fallbacks instead of
  blank panes, and common feature chunks are warmed after first paint or
  sidebar hover so opening board, home, files, databases, engines, and settings
  feels much more immediate without blocking the app's initial open.
- Move-list game reports: the notation header now has an Analyse game action
  next to Copy PGN. It runs the selected local Stockfish on the main line,
  switches the move-list panel into a Lichess-style report with eval chart,
  phase markers, inaccuracies/mistakes/blunders, average centipawn loss, and
  Lichess-compatible accuracy, and saves the annotated PGN back to file or
  database origins so reopening an analysed game can rebuild the report without
  rerunning the engine.
- Move-list game report density was tightened so the chart and both players'
  accuracy rows fit the notation panel without routine vertical scrolling:
  smaller player markers, shorter stat rows, non-wrapping labels, and a shorter
  chart minimum keep the report readable in the board workspace.
- Review large-deck responsiveness: Opening Review and Mistake Review now use
  a prebuilt FEN index for active-position lookup, object-keyed cached board
  line states instead of recursive review-tree cache-key serialization, and
  deferred right-panel summary refreshes while practice is active so next-card
  transitions stay responsive on large decks.
- Review practice write buffering: per-card SRS updates are queued during an
  active Opening Review or Mistake Review session and flushed at stop,
  completion, lifecycle, or unmount boundaries instead of copying and saving
  the whole deck a couple seconds after every card. Nearby-card prewarming also
  stops after the first few queued indices instead of filtering the full
  remaining deck.
- Review engine quieting: the review workspace now keeps interactive engine
  analysis paused while a hidden-answer card is waiting on the Review tab, then
  re-enables it after reveal or when users open analysis-capable panels, so
  engine startup/search does not compete with next-card rendering.
- Board review attempt smoothness: the board no longer mutates the review deck
  just to mark a card seen immediately after an attempted move; durable progress
  flows through the buffered SRS update path. The active Mistake Review card is
  also retained in a ref instead of React state, removing an extra settling
  render on every card load.
- Mistake Review reveal countdowns now update at most once per displayed second
  and skip unchanged values, instead of waking the full board every 250ms during
  the common 2-3 second hidden-answer delay.
- Database engine columns are eval-first: move tables should show cloud
  centipawn/mate scores such as `+0.59` directly instead of presenting
  engine-order ranks as the useful value. Strength sorting can still use the
  same cloud score data, with CP-loss details in hover text.
- Database blended strength weighting keeps engine-strong moves readable when
  cloud evals are clustered: practical WDL still breaks close-eval ties, but it
  should not collapse good engine moves to `0` in the Blend column.
- Opponent prep move tables keep the user's clicked sort category while moving
  through a prep line. Initial defaults are side-specific: opponent/source moves
  sort by Usage, while user candidate moves sort by Smart strength; both
  defaults are tuneable from the prep settings controls.
- Opponent prep recency wording is perspective-aware in player prep: when it is
  the opponent's turn, rows say when that player last played the move; when it
  is the user's turn, candidate replies say when the opponent last played
  against that move.
- The chess.com-inspired board style uses checkerboard parity that matches
  normal chess coordinates in the White orientation: a1 is dark and a8 is
  light. Keep this invariant when adjusting the CSS gradient or square colors.
- Empty move-list annotation: right-clicking blank notation space now exposes
  an Annotate action that opens the starting-position comment editor, allowing
  pre-move PGN comments without first making a move.
- Phone engine/eval responsiveness: the web companion now treats under-board
  engine scores as White-perspective before display, converting local
  Stockfish side-to-move UCI scores at parse time so the sign does not flip
  every ply. The phone Chessground board also initializes once and updates via
  `api.set(config)` on FEN/config changes, avoiding a destroy/recreate cycle
  after every move.
- Phone Prep row spacing: active Prep move rows now use a phone-only stacked
  row layout instead of squeezing the desktop table columns into the under-board
  panel. Keep this compact, status-first shape when changing Prep training UI:
  move/date/actions first, then short strength, games, prep coverage, and
  result blocks with minimal explanatory copy.
- Phone Database/Prep row sizing: the same phone row renderer now handles
  Database stats and Prep rows, with rows forced to full under-board width,
  hidden phone metric labels, compact coverage badges, and a tightened
  two-column metric grid. Avoid returning to narrow, full-height table-card
  rows on phone; the row should scan as move/date/actions plus compact
  strength, games, prep, and WDL/results metrics.
- Phone engine arrows now mirror the desktop fork when the under-board Engine
  panel is enabled. The web board receives live Stockfish/Lichess cloud
  MultiPV lines as Chessground `drawable.autoShapes`, using the same strong
  blue best-line arrow, pale-blue close alternatives, win-chance filtering, and
  line-width thresholds as the desktop engine arrows.
- Phone PGN file playback now preserves PGN variation trees instead of only
  importing `mainline()` moves. Browser-side games carry root and nested
  variation lines with comments/NAGs, the under-board Moves panel renders those
  branches inline and can jump the board onto a tapped branch, and local
  Database/Prep indexing walks the full tree so repertoire files contribute
  variation moves to stats.
- Phone Moves variation selection keeps the source PGN tree separate from the
  active board branch. When a user taps a variation in a loaded file, the board
  line switches to the full selected branch and cursor, but the Moves panel
  still renders the original mainline plus root/nested variations instead of
  replacing the visible file with the selected branch prefix.
- The phone board title for an opened file/database now comes from the source
  file or database name instead of the loaded game's White/Black player pair.
  Keep the top board title source-oriented so browsing multi-game PGNs and prep
  files does not make the file identity disappear.
- On 2026-06-12, the phone web header was compressed so the board workspace
  starts higher in the first viewport. Narrow screens now use a single-row
  sticky header with the subtitle hidden, smaller title/icon/action sizing, and
  reduced top content padding; the board title row is also tightened so more of
  the under-board panel is visible without scrolling.
- On 2026-06-12, started phone Database and Prep views gained compact sort
  dropdowns above the move rows. Keep these controls available after Start so
  users can switch between blended strength, most played, results, and related
  row orderings without returning to setup.
- On 2026-06-12, Database and Prep move rows gained inline WDL bars at the same
  vertical level as the SAN, using the fork-style white/draw/black progress
  design. Keep the result visual tied to the move identity in compact phone
  rows and table move cells instead of leaving phone WDL as text-only metadata.
- On 2026-06-12, phone Engine settings replaced the editable Lines/Depth number
  inputs with compact button steppers. This keeps arrow taps from focusing a
  text field, selecting the value, opening the keyboard, or triggering mobile
  input zoom while preserving quick one-step changes.
- On 2026-06-12, the phone Files surface row density was reduced for Hosted
  files, Indexed PGNs, and game rows. Keep this page closer to a compact file
  browser than a card list so more folders and files remain visible without
  scrolling.
- A follow-up on 2026-06-12 made the phone Files rows denser again and added
  hosted-library pin support. Desktop Files pins are mirrored to app data as
  `web-pinned-file-entries.json`; `npm run web:publish` maps those absolute
  paths into hosted `pinnedPaths`, and the phone Hosted files list floats
  pinned siblings first with only a small pin icon. Keep pin UI compact and
  metadata-driven so publishing from the fork carries the user's pinned Files
  choices to the phone site.
- On 2026-06-13, desktop play gained a Blindfold trainer mode inspired by
  blindfold-chess.online. It can be launched from the home screen or board
  control rail, reuses the existing game backend, hides/reveals the board with
  per-tab blindfold settings, offers right-pane legal SAN move buttons plus a
  manual SAN keypad, and routes trainer setup through a Maia-only profile with
  Maia-level strength settings. Do not silently fall back to Patricia for this
  mode.
- A follow-up on 2026-06-13 made the Blindfold trainer a revisitable
  training surface instead of only a one-off play mode. Live blindfold games
  now auto-save into a dedicated local `Blindfold games` library separate from
  the normal Files surface, can still be exported explicitly as PGN, and can be
  reopened in blindfold review with the board hidden. Players can mark the
  current position as `Lost track`, which persists both as trainer metadata and
  as a PGN comment, then jump back to those marked positions later. The setup
  panel also accepts pasted FENs so arbitrary positions can be loaded and
  played out blindfold against Maia.
- A later 2026-06-13 cleanup made the Blindfold setup intentionally
  separate from the generic play-game opponent form. The right pane should stay
  focused on player colour, Maia level, managed Maia install/readiness,
  blindfold controls, saved blindfold games, and FEN loading; do not reintroduce
  Human/Trainer/Engine toggles, opening-book controls, or Patricia copy into
  this mode. Maia is now managed by the trainer path: on Windows it installs a
  CPU LC0 build plus the selected CSSLab Maia weights automatically when the
  setup opens or when the game starts, then passes the weight file through
  LC0's `WeightsFile` option. The LC0 Windows CPU archive extracts `lc0.exe`
  directly into the managed Maia directory; do not point the managed path at an
  extra nested release folder or Windows will fail to spawn it with a directory
  error.
- The user-facing name is intentionally just `Blindfold` / `Blindfold trainer`;
  Maia is the included opponent, not the mode name. When the board is hidden,
  the board overlay must be fully opaque so pieces and squares are not visible
  through a blur or tint.
- A follow-up on 2026-06-13 tightened the Blindfold trainer surface after user
  feedback. Blindfold games are untimed end to end, the active right pane is
  only for game actions such as lost-track marking, save, reveal, play-here,
  take-back, exit, legal/manual move-entry, and mark revisit controls, while the
  under-board area on the left is the normal notation move list plus navigation
  controls. The setup pane is phased into Settings, Library, and Position
  instead of dumping everything together; the Library is a dedicated saved-game
  list with open and delete actions. Loading a saved blindfold game should jump
  to the mainline end by default, while lost-track marks remain explicit
  revisit targets.
- On 2026-06-13, the Blindfold setup Library gained inline game previews like
  the `Choose online game` picker. Each saved-game row can expand before
  opening to show a readonly board plus clickable main-line SAN moves; the
  completed-game `Open` action still loads the saved game into the blindfold
  trainer review path rather than switching it to a generic analysis tab.
- A later 2026-06-13 Blindfold play update added the standard compact engine
  dock below the right-side move-entry/actions panel. Keep this wired through
  `EngineDockedPanel` and `EvalListener` so blindfold analysis follows the same
  dock setting, engine rows, and evaluation lifecycle as the other board
  workspaces.
- On 2026-06-15, the Blindfold play panel made the latest engine move a
  persistent prominent status panel instead of a timed small alert. Keep the
  latest engine SAN visible until a newer engine move replaces it, but keep the
  move readout compact enough that the move-entry panel below remains tall and
  usable without extra scrolling. Do not reintroduce the setup-side AI move
  display duration control. Blindfold tabs also hide the otherwise empty
  bottom-right workspace pane so the right-side move-entry area expands and the
  docked engine panel sits at the bottom of the full right column. The
  blindfold move-entry panel should use small `xs` buttons with normal `xs`
  grid spacing and smaller status text, keeping the legal/manual controls
  space-efficient without looking crushed. In manual SAN mode, keep the
  Backspace/Clear/Submit footer outside the scroll area with a non-shrinking
  row so the bottom buttons cannot be half-clipped by the panel edge. The
  overall Blindfold play panel must be a bounded flex column with no fixed
  minimum height on the move-entry area; otherwise the persistent Maia-move
  banner can push the manual controls below the visible panel.
- Also on 2026-06-15, unfinished Blindfold library entries became resumable
  instead of review-only. Saved games with `Result "*"` and a non-terminal
  mainline end now show `In progress` / `Resume`, reload to the mainline end,
  and automatically recreate the Maia backend from the saved initial FEN plus
  already-played moves while preserving the same saved-game id and lost-track
  marks. Completed saved games still open in blindfold review.
- A later 2026-06-15 Blindfold reveal fix made board visibility an explicit
  revealed/hidden session state instead of a peek tied to the current FEN.
  Revealing the board now stays revealed while cycling through moves, jumping
  to lost-track marks, or playing moves, until the user presses Hide. Keep both
  the right-panel Hide action and the compact in-board Hide button available
  while the board is revealed.
- On 2026-06-13, the desktop analysis board under-board move panel was given a
  slightly larger height allocation and switched to compact notation chrome.
  The intent is that the `Moves / Database / Prep / Coach` header takes less
  vertical space so more SAN moves and comments are visible before scrolling.
- A follow-up on 2026-06-13 made that compact under-board notation denser
  without making it tiny: move pills now use the existing compact style and the
  under-board comments/notation text render slightly smaller with tighter line
  height.
- On 2026-06-13, Lichess Cloud eval access was made API-friendly for both the
  desktop engine path and phone web engine/prep/database helpers. Cloud eval
  requests now cap MultiPV to Lichess's useful cloud range, share identical
  in-flight position lookups, run one cloud request at a time with a small
  spacing delay, and cool down after `429` responses so opening navigation
  does not burn the cloud limit and silently fall back to local Stockfish.
- On 2026-06-14, the database-backed Plan Explorer gained a second
  `Plans / Setups` view and a blended strength measure. The existing plan rows
  remain available, now with a `Blend` score that combines the engine-plan
  approval signal with comparable WDL performance using the shared move-strength
  settings. The new Setups view is backed by exact same-side three- to six-plan
  combinations observed in each sampled local database game, with matching
  branch-derived setup rows for online Lichess/Masters samples; this is meant to
  capture real opening structures such as a King's Indian style configuration
  with `...g6`, `...Bg7`, `...d6`, `...Nf6`, castling, and a central break
  rather than tiny fragments. Hovering a setup row should preview the full
  family of arrows, so use this for human opening training when judging whether
  a coordinated piece/pawn setup performs well in the selected database rather
  than judging every route in isolation.
- On 2026-06-14, Plan Explorer WDL result bars were aligned with the Database
  move table design: larger segmented bars, the shared light/dark outline and
  white-section styling, and readable in-bar percentage labels when a segment is
  wide enough. Keep future plan/setup result summaries visually consistent with
  Database rather than returning to unlabeled mini bars.
- A follow-up clarified the Plan Explorer setup WDL bars for black-side
  exploration. Blended strength was already scored from the row's effective
  perspective, but the bar could look inverted because the leading
  perspective segment reused the white-section styling even when it represented
  Black's result. The bar now colors and labels the scored side explicitly
  while preserving perspective-based scoring.
- On 2026-06-14, the Engine Plans tab gained its own `Plans / Setups` toggle.
  Engine setups are deliberately engine-only: they are generated from same-side
  plan signals that co-occur inside Stockfish PVs and are scored from PV support,
  PV1 presence, confidence, and supporting evaluations, with no database/WDL
  input. The engine extractor now treats quiet setup pawns such as `...g6` and
  `...d6`, plus fianchetto bishop destinations such as `...Bg7`, as plan
  signals so setup families can represent real opening structures like a King's
  Indian configuration. Hovering an engine setup row should preview the full
  setup arrow family, while drawing the setup should add the same family to the
  board.
- A follow-up on 2026-06-14 fixed Engine Plans setup blind spots where a real
  structure was already partly present in the current FEN. Setup generation now
  adds root-position anchors for common pawn structures, developed minor pieces,
  and already-castled kings before combining them with Stockfish PV signals.
  This keeps positions such as `1.d4 Nf6 2.Nf3 e6 3.c4 d5` from missing Catalan
  setups just because `d4`, `c4`, and `Nf3` were played before the current
  board. Root anchors are used for setup recognition and naming, not as fake
  arrows in the normal Plans table, and named archetypes such as Catalan and
  King's Indian should be based on component facts rather than a single hard
  coded FEN.
- A later 2026-06-14 setup-clustering pass made Plan Explorer and Engine Plans
  structure-aware instead of exact-combination-only. Local database, online
  Lichess/Masters, and engine PV setup generation now group candidates first by
  same-side pawn skeleton, then merge compatible piece-placement details inside
  that skeleton so a row can show deeper "where the pieces belong" arrows such
  as castling plus knight/bishop development. Conflicting destinations for the
  same piece slot, or conflicting castling sides, remain separate setup rows
  because those can change the nature of the setup even when the pawn structure
  matches. Merged database/online rows keep per-route game counts while the
  setup row count describes the whole compatible structure cluster.
- A follow-up on 2026-06-14 replaced database-backed Plan Explorer's
  setup-candidate catalog with generic co-occurrence mining. Local database and
  online Lichess/Masters setup rows now infer broad setup families from sampled
  human routes: each sampled branch contributes same-side setup features,
  recurring seed routes such as a true fianchetto pawn, developed minor, or
  castling move become setup-family keys, and compatible supporting routes are
  merged across database samples. Central/support pawns can support a setup but
  must not define a setup row on their own; final rows should include at least
  one minor-piece development or castling route so unrelated pawn bags such as
  `b4/c3/d3/d4/e4/h3` are filtered out. This means a row can grow from multiple
  related games instead of requiring one exact branch to contain the whole
  configuration, while still using only local/online database games, WDL, and
  blended strength. The online Lichess/Masters sampler was also widened to
  follow more popular human branches before mining setups. Do not reintroduce
  manual opening labels or a hardcoded opening catalog in the database Plan
  Explorer path.
- A follow-up on 2026-06-14 made Engine Plans setups less PV-literal. Stockfish
  PVs remain the evaluation source, but candidate setup families can now carry
  the full human arrow group when the engine supports a setup-starting move.
  This fixes cases such as `1.d4 Nf6 2.Nf3 e6 3.c4 d5`, where `g3` may be
  engine-playable but the PV does not naturally continue with the tidy Catalan
  `Bg2/O-O` setup inside the visible horizon. The current candidate catalog
  covers Catalan, London, Colle, English fianchetto, King's Indian, Queen's
  Indian, and Slav families; keep these engine-only by requiring root/PV
  support for the setup skeleton and scoring from Stockfish evidence, not
  database/WDL data.
- A later 2026-06-14 Engine Plans template-evidence fix tightened that
  candidate catalog: named template completions may still draw familiar setup
  arrows, but their scored support must come from template-specific PV evidence
  such as `g3/Bg2` for Catalan or `...g6/...Bg7` for King's Indian. Generic
  shared components such as an already-developed `Nf6` knight or kingside
  castling must not create or inflate named template support by themselves.
  This prevents Catalan/QGD positions like
  `1.d4 Nf6 2.c4 e6 3.Nf3 d5 4.g3` from showing a fake strongest black
  King's Indian setup merely because normal engine PVs castle.
- A follow-up on 2026-06-14 added inline Coach explanations to database-backed
  Plan Explorer rows and engine-only Engine Plans rows. These explanations use
  the existing local AI CLI bridge through a dedicated `ask_plan_coach` command
  and intentionally default to the fast `gemini-3.5-flash` model rather than
  the full Coach's Pro model. Row requests must include the available evidence:
  route/setup summaries, database WDL and blended strength where available,
  engine approval/support/eval/PV evidence where available, and an explicit
  note when database stats are not present in the engine-only panel. The coach
  should name real chess structures such as King's Indian, Hedgehog,
  fianchetto, IQP, Carlsbad, or Maroczy Bind only when the supplied position
  and route evidence justify that label; otherwise it should explain the plan
  without forcing a named setup.
- A later 2026-06-14 Plan Explorer setup-mode polish pass fixed two interaction
  traps: empty final engine-strength payloads now clear the running state
  instead of leaving setup rows on `Analyzing`, setup route hovers preview the
  route under the pointer before returning to the full setup family, and pinned
  plan arrows are temporarily hidden during hover previews so row changes remain
  visually obvious.
- A follow-up hardened that setup-mode fix after the UI could still appear
  unchanged: hover previews now suppress the normal automatic Plan Explorer
  arrow set until hover leaves, streaming engine-strength refreshes no longer
  clear the active hover preview, and a watchdog stops stale
  Plan Explorer engine-strength requests that never emit a matching final PV.
- Another Plan Explorer Setups polish pass made White/Black side filtering
  explicit and state-safe: switching side clears stale setup previews, setup
  rows are filtered through a shared setup-side classifier, and the side control
  shows filtered setup counts so agents can immediately tell whether the view is
  showing White, Black, or no rows for that side.
- A subsequent fix made the Setups White/Black switch a real lifecycle boundary:
  the side and `Plans / Setups` view now participate in the Plan Explorer
  request key and engine-strength cache key, side/view changes stop stale engine
  strength requests, setup rows only report `Analyzing` for the current side's
  active request, and nested per-route hover handlers were removed so moving
  between setup rows cannot restore a previous row's arrow preview.
- A 2026-06-14 Plan Explorer Setups dedupe pass moved setup family
  canonicalization into both the local database miner and browser/Lichess miner.
  Multiple seed moves from the same game now merge into one setup-family row
  before stats are counted, preventing duplicate setup rows and inflated games.
  In local Setups mode, changing the database White/Black perspective also
  updates the setup-side filter immediately so the table refreshes to the side
  the user just selected.
- A follow-up widened Plan Explorer Setups without changing the root semantics:
  setup rows must describe new plans from the current board position forward,
  never moves already played to reach the position. Local database and online
  Plan Explorer setup mining still accept compact two-component setup rows when
  they combine a real future anchor with a structural pawn, and setup-family
  keys prefer structural pawn anchors before individual seed pieces. Local setup
  variants are capped per key so broad samples cannot leave Plan Explorer stuck
  loading.
- On 2026-06-14, Engine Plans Setups gained a Lichess All practical overlay.
  The setup table now has a `Blend` column that fetches global Lichess All setup
  families for the current FEN, matches them to same-side engine setup
  components, and scores the row with the shared move-strength settings so
  Stockfish support is tempered by practical WDL strength. The overlay preserves
  existing Lichess All ratings/speeds/date filters but deliberately clears any
  player-specific explorer filter so the score reflects the broad Lichess All
  pool. Engine plan/setup rows expose a single `Engine Strength` column that
  combines the approval badge, PV support count, and best/weighted CP-loss
  context versus the strongest root PV; avoid splitting these into competing
  strength columns. The setup blend uses that CP-loss context when available
  before falling back to approval/support heuristics.
  Keep the fetch gated to Setups view with a saved Lichess token, and keep
  unmatched rows explicit as `No match` rather than inventing practical stats.
- On 2026-06-15, setup rows were hardened so Plan Explorer and Engine Plans no
  longer overstate loose setup evidence as a good setup. Engine setup signals
  now remember whether each component was PV-backed, already present at the
  root, or inferred from a named template; template-filled setups are labelled
  as candidates and cannot receive the same confidence as fully PV-backed
  setups. Plan Explorer Setups gained explicit verdict badges such as
  `Observed setup`, `Loose match`, `Engine risk`, and `Verified setup`, and the
  coach prompt receives the same verdict context. Local and online setup mining
  now require a structural pawn component in addition to a development/castling
  anchor, and non-pawn setup routes keep their real route instead of being
  flattened to the first move. Treat `Verified setup` as the only UI label that
  should imply a setup recommendation; other labels are evidence categories.
- On 2026-06-19, local database position search was hardened after Prep and
  Database panels could falsely show no threshold-eligible moves in common
  opening positions such as `1. e4 c5 2. Nf3 g6 3. d4 cxd4` from the
  Sebastian443 Chess.com database. The root issue is backend indexed-search
  fragility, not the Prep threshold UI: exact-position searches now consult
  both board/turn and exact occurrence keys, and if the occurrence index returns
  no playable continuation or no game sample, search falls back to the scan
  path instead of caching a false empty result. Preserve this invariant for all
  database move consumers: an indexed search result with only `*`, `Total`, or
  zero rows is not trustworthy enough to drive an empty-state message until the
  scan path has had a chance to recover.
- A same-day follow-up found that stale exact-position empty results could still
  survive through `line_cache`, especially because `is_position_in_db` novelty
  checks wrote negative lookups into the shared move-result cache. Exact cached
  results with no playable moves are now revalidated, cached game samples count
  as position hits, and `is_position_in_db` no longer writes negative entries
  into `line_cache`. Preserve this cache boundary: existence checks must not
  poison Prep/Database move tables.
- A second same-day follow-up found a separate frontend cause for the same Prep
  empty-state symptom: Player-mode prep could seed player text from source
  labels such as `Sebastian443 Chess.com`, fail to resolve the actual database
  player row `Sebastian443`, and then query `player1 = -1`. Player-name
  resolution now strips provider/database label tokens and prefers exact
  username-token matches before declaring no player. Keep this resolver
  tolerant of Chess.com/Lichess/source-label suffixes, because prep source
  labels are not always literal `Players.Name` values.
- The same bug also exposed that some imported online databases store
  placeholder reachability summaries (`WhiteMaterial = 39`, `BlackMaterial =
  39`, `PawnHome = 0`) for every game. Exact-position scan fallbacks now treat
  that combination as missing metadata and decode the move blob instead of
  pruning the game before search. A direct probe on the Sebastian443 Chess.com
  database found 73 Sebastian-as-White games after
  `1. e4 c5 2. Nf3 g6 3. d4 cxd4`, with continuations including `Nxd4` and
  `Qxd4`; keep this placeholder-metadata guard in any future search prefilter.
- On 2026-07-11, Outpost commit `d7f07d0` brought the rebuild's `After prep`
  projection semantics back in line with the fork. Opponent/source rows now
  score the best immediate prep reply, while prep-side candidates follow the
  most-played source reply and then score the best answer. Weaker future-line
  values remain visible; absolute future WDL/local-eval caps prevent inflated
  scores; saved replies take precedence and alone receive the saved-line
  caption; sparse local eval can synthesize zero-game replies; and visible rows
  resolve progressively with three concurrent jobs. The clean committed
  Outpost tree passed TypeScript checking and 30 focused prep tests.
- On 2026-07-12, Outpost commit `8137246` completed the visible and numeric
  `After prep` parity correction. Candidate projections still follow the
  source/opponent's most-played reply and then choose the best prep-side answer,
  but their displayed line value is no longer damped toward 50 by branch share;
  frequency selects the projected route without altering its score. Candidate
  captions now show both evidence moves, such as `After Nf3 g6`, while
  opponent/source rows keep the immediate one-move reply caption and saved
  projections keep `Saved line`. The two focused prep suites passed 31 tests;
  the repo-wide TypeScript check remained blocked only by unrelated concurrent
  `AppDialog.tsx` type errors.

## Verification Expectations

Choose focused verification based on the touched surface, and prefer lightweight
checks. Do not run the full test suite, broad Rust checks, browser automation,
or other slow verification by default; use them only when the user asks, when
the touched code clearly makes them necessary, or when a quick inspection finds
a concrete risk that the check would resolve.

- Frontend type/build check: `pnpm build-vite` when touching shared TypeScript,
  app startup, build wiring, or generated bindings.
- Frontend lint for touched files: `pnpm exec oxlint <files>` when lint-sensitive
  code was edited and the command is expected to be quick.
- Practice/review utility tests: `pnpm vitest run <test-file>` only for directly
  affected logic with an existing focused test.
- Rust compile check: `cargo check` from `src-tauri` or the repo script used by
  the project only when Rust/Tauri command signatures, Cargo configuration, or
  generated bindings are touched enough that inspection is not sufficient.
- Database/search tests: run focused tests such as `cargo test search_index`,
  `cargo test exact_matches`, and
  `cargo test exact_query_ignores_too_much_material_validation` only when the
  database/search behavior was changed.
- UI/layout verification: only perform Playwright/browser checks when the user
  explicitly asks for them. Do not use the old direct-browser minimal Tauri
  global-stub method; prefer non-browser verification by default, or a clearly
  documented dedicated harness when browser verification is requested.
- Known historical note: an earlier full `cargo test` had unrelated existing
  failures in eval/search fixture expectations. Treat broad failures as
  suspicious, but verify whether they predate the current change before editing
  unrelated code.

## Recent Evaluation Source Behavior

- On 2026-07-12, desktop evaluation source priority was made consistent across
  the board, Database, and Prep surfaces. Stored local Lichess cloud evaluations
  are now preferred at every move when available; the local engine starts only
  as fallback when the exact position is absent or unreadable. Prep Strength,
  After-prep projections, builder choices, and coach evidence always opt into
  the same stored cloud source, including workspaces carrying a legacy saved
  `useCloudEngine: false` value. Database Engine CP and Engine eval already use
  the shared local Lichess lookup and remain aligned with this behavior.

## Recent Plan Explorer UI Behavior

- On 2026-07-12, Plan Explorer removed the per-route and per-setup Explain
  controls. Route statistics now sit directly beside each route with explicit
  `games` and share labels, total-count badges say `games`, and setup routes
  show their supporting game count. Plan Explorer WDL bars now use the same
  compact white/draw/black styling and percentage-label thresholds as Prep.

## Recent Outpost ChessDB Evaluation Fallback

- On 2026-07-12, Outpost commit `19466ce` made Database move evaluations
  strictly local-Lichess-first per move, then filled only uncovered SAN rows
  with one cached, read-only ChessDB `queryall` API probe. Local overlaps stay
  authoritative; combined CP drops are recomputed across both sources. The
  fixed native endpoint has an 8-second timeout, 256 KB cap, in-flight dedupe,
  200-position LRU, five-minute miss TTL, and 60-second 429 backoff. Focused
  source-order/parser/cache/orientation tests, all 1,902 frontend tests, and the
  production build passed; the live API returned the formerly blank `g6`,
  `a6`, and `dxc4` evaluations from the owner's screenshot position.

## Recent Database Evaluation Behavior

- On 2026-07-12, the database move table removed its redundant Engine
  STRONG/WEAK column while retaining blended strength and numeric Eval. Stored
  local Lichess evaluations now fill moves omitted by the root position's
  five-PV ceiling from each move's evaluated child position, so rows no longer
  incorrectly show `Out` merely because they fell outside the root MultiPV
  list.

## Prep Source Selection

- On 2026-07-12, fresh Prep panels stopped restoring or inferring a database
  source. Prep now remains idle until the user explicitly selects a database,
  switching from General back to Player also returns to an empty source, and
  the legacy aggregate `My Library` database is excluded from Prep's picker so
  Prep cannot accidentally query across the full database collection.

## Recent Outpost Database Selection Performance

- On 2026-07-12, Outpost's Prep and Database source pickers stopped deferring
  position requests with UI timers. Native collection-scoped position queries
  now use a compact covering metadata index and a collection-first join, so a
  selected database no longer scans every collection or repeatedly reads large
  PGN-bearing table pages. The Database Games subtab also limits matching game
  IDs before loading full PGNs. This fixes source changes becoming trapped
  behind long SQLite work in multi-gigabyte libraries while preserving exact
  move totals, filters, recency evidence, paging, and stale-result protection.
