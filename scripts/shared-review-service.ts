import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { setPriority, constants } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fetchWebOnlineGamesSince } from "../src/web/onlineImport";
import { parsePgnDatabase, playUciMove, normalizeWebFen } from "../src/web/pgn";
import {
    createPhoneReviewCard,
    selectGameReviewCards,
    selectDailyReview,
    gradePhoneReview,
    reviewScanKey,
    reviewPlayerColor,
    type PhoneReviewCard,
} from "../src/web/mistakeReview";
import { sharedReviewDeck, mergeSharedProgress, SHARED_REVIEW_FILE } from "../src/web/sharedReview";
import type { WebEngineLine, WebGame } from "../src/web/model";
import type { MistakeReviewDeck } from "../src/utils/mistakeReview";
import { positionFromFen } from "../src/utils/chessops";

type ArchiveGame = {
    source: "chesscom" | "lichess";
    pgn: string;
    end?: number;
    playedAt?: number;
    url?: string;
};
type Store = {
    cards: PhoneReviewCard[];
    scanned: string[];
    skipped: string[];
    updatedAt: number;
    processed?: string[];
};
type Options = {
    root: string;
    documentsRoot: string;
    engineConfigPath: string;
    lookup: (fen: string) => Promise<any>;
    log?: (message: string) => void;
    fetchGames?: typeof fetchWebOnlineGamesSince;
};
const readJson = async (path: string, fallback: any = null): Promise<any> => {
    try {
        return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    } catch (e: any) {
        if (e.code === "ENOENT") return fallback;
        throw e;
    }
};
async function atomicJson(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.next`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, path);
}

// One owner for the durable collection; background discovery and grading serialize their writes.
export class SharedReviewService {
    private data: Store = { cards: [], scanned: [], skipped: [], updatedAt: 0 };
    private status: Record<string, any> = { state: "starting", reviewedGames: 0 };
    private accounts: Record<string, string> = {};
    private timer: ReturnType<typeof setInterval> | undefined;
    private busy = false;
    private stopped = false;
    private enabled = true;
    private writes: Promise<any> = Promise.resolve();
    private engine: BackgroundEngine | undefined;
    private cache: DatabaseSync | undefined;
    private enginePath = "";
    private lastFetch = 0;
    private archive: ArchiveGame[] = [];
    private failures = new Map<string, number>();
    private readonly storePath: string;
    private readonly deckPath: string;
    constructor(private options: Options) {
        this.storePath = join(options.root, "review-store.json");
        this.deckPath = join(options.documentsRoot, SHARED_REVIEW_FILE);
    }
    async initialize(start = true) {
        await mkdir(this.options.root, { recursive: true });
        this.data = await readJson(this.storePath, this.data);
        const config = await readJson(join(this.options.root, "config.json"), {});
        this.accounts = config.accounts ?? {};
        if (!Object.values(this.accounts).some(Boolean)) {
            this.enabled = false;
            this.status = { state: "unconfigured", savedAnalysisSummaries: 0, error: null };
            return;
        }
        const existing = await readJson(this.deckPath);
        if (existing && existing.source !== "pc-online-review-v1")
            throw new Error("The online review filename is already used by another collection.");
        const settings = await readJson(join(this.options.root, "review-settings.json"), {
            enabled: true,
        });
        this.enabled = settings.enabled !== false;
        this.enginePath = (await readJson(this.options.engineConfigPath, {})).enginePath ?? "";
        const old = await readJson(join(this.options.root, "games.json"), { games: [] });
        const fresh = await readJson(join(this.options.root, "review-games.json"), []);
        this.archive = mergeArchive(old.games, fresh);
        const summaries = await readJson(join(this.options.root, "entries.json"), { entries: [] });
        this.status = {
            state: this.enabled ? "idle" : "paused",
            savedAnalysisSummaries: summaries.entries.length,
            lastCheckedAt: 0,
            error: null,
        };
        this.cache = new DatabaseSync(join(this.options.root, "review-evaluations.sqlite"));
        this.cache.exec(
            "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS evaluations (fen TEXT PRIMARY KEY, line TEXT NOT NULL)",
        );
        await this.persist();
        if (start) {
            this.timer = setInterval(() => void this.run(), 60_000);
            this.timer.unref();
            void this.run();
        }
    }
    snapshot() {
        return {
            ...this.status,
            enabled: this.enabled,
            running: this.busy,
            accounts: this.accounts,
            cards: this.data.cards,
            reviewedGames: this.data.scanned.length,
            skippedGames: this.data.skipped.length,
            archivedGames: this.archive.length,
            updatedAt: this.data.updatedAt,
            policy: "Checks online accounts every five minutes; prepares missing review positions at depth 16 using stored evaluations first.",
        };
    }
    phoneSnapshot() {
        return {
            ...this.snapshot(),
            cards: selectDailyReview(this.data.cards),
            usefulPositionsCount: this.data.cards.filter((c) => !c.hidden).length,
        };
    }
    fail(error: unknown) {
        this.stopped = true;
        this.enabled = false;
        this.status = {
            state: "error",
            error: "PC review data could not be loaded. Other app features remain available.",
        };
        this.options.log?.(String(error));
    }
    async deck() {
        await this.writes;
        return this.makeDeck();
    }
    private async makeDeck() {
        const fresh = sharedReviewDeck(
            this.data.cards,
            this.enginePath,
            this.data.updatedAt || Date.now(),
        );
        const previous = await readJson(this.deckPath);
        if (!previous) return fresh;
        const byKey = new Map(previous.positions.map((p: any) => [p.reviewKey, p]));
        return {
            ...fresh,
            createdAt: previous.createdAt,
            logs: previous.logs ?? [],
            positions: fresh.positions.map((p) => {
                const old = byKey.get(p.reviewKey) as any;
                return old
                    ? {
                          ...p,
                          ...old,
                          tags: p.tags,
                          card:
                              !p.tags?.includes("Hidden") &&
                              new Date(old.card.last_review ?? 0).getTime() >=
                                  new Date(p.card.last_review ?? 0).getTime()
                                  ? old.card
                                  : p.card,
                      }
                    : p;
            }),
        };
    }
    private transact(action: () => Promise<void> | void) {
        const run = this.writes.then(action);
        this.writes = run.catch(() => {});
        return run;
    }
    async grade(id: string, grade: "again" | "good" | "easy" | "hide", expectedReviews: number) {
        if (!["again", "good", "easy", "hide"].includes(grade))
            throw new Error("Invalid review grade.");
        await this.transact(async () => {
            const card = this.data.cards.find((c) => c.id === id);
            if (!card) throw new Error("Review position not found.");
            // Idempotent retry and stale-device protection.
            if (card.reviews !== expectedReviews) return;
            this.data.cards = this.data.cards.map((c) =>
                c.id === id ? gradePhoneReview(c, grade) : c,
            );
            await this.persist();
        });
        return this.snapshot();
    }
    async saveDeck(deck: MistakeReviewDeck) {
        if (!Array.isArray(deck?.positions) || !Array.isArray(deck?.logs))
            throw new Error("Invalid review collection.");
        await this.transact(async () => {
            this.data.cards = mergeSharedProgress(this.data.cards, deck);
            // Merge logs and annotations by identity; old clients cannot erase new positions.
            const previous = await this.makeDeck();
            const incoming = new Map(deck.positions.map((p) => [p.reviewKey, p]));
            const logs = new Map(
                [...previous.logs, ...deck.logs].map((l) => [JSON.stringify(l), l]),
            );
            await atomicJson(this.deckPath, {
                ...previous,
                logs: [...logs.values()],
                positions: previous.positions.map((p) => {
                    const next = incoming.get(p.reviewKey);
                    return next
                        ? {
                              ...p,
                              comment: next.comment,
                              annotations: next.annotations,
                              shapes: next.shapes,
                              reviewTree: next.reviewTree,
                              card:
                                  new Date(next.card.last_review ?? 0).getTime() >=
                                  new Date(p.card.last_review ?? 0).getTime()
                                      ? next.card
                                      : p.card,
                          }
                        : p;
                }),
            });
            await this.persist();
        });
        return this.deck();
    }
    async setEnabled(enabled: boolean) {
        this.enabled = enabled;
        await atomicJson(join(this.options.root, "review-settings.json"), { enabled });
        if (!enabled) this.engine?.close();
        this.status.state = enabled ? "idle" : "paused";
        if (enabled) void this.run();
        return this.snapshot();
    }
    private async persist() {
        // Also pick up progress saved by an already installed desktop before its next upgrade.
        const existingDeck = await readJson(this.deckPath);
        if (existingDeck) this.data.cards = mergeSharedProgress(this.data.cards, existingDeck);
        this.data.updatedAt = Date.now();
        await atomicJson(this.storePath, this.data);
        await atomicJson(this.deckPath, await this.makeDeck());
    }
    async run() {
        if (this.busy || this.stopped || !this.enabled) return;
        this.busy = true;
        try {
            await this.transact(() => this.persist());
            await this.discover();
            const seen = new Set([...this.data.scanned, ...this.data.skipped]);
            const processed = new Set(this.data.processed ?? []);
            const games: { game: WebGame; player: string; key: string; archiveKey: string }[] = [];
            let examined = 0;
            for (const item of [...this.archive].sort(
                (a, b) => (b.end ?? b.playedAt! / 1000) - (a.end ?? a.playedAt! / 1000),
            )) {
                const player = this.accounts[item.source];
                if (!player || !item.pgn) continue;
                if (/\[Result\s+"\*"\]/i.test(item.pgn)) continue;
                const archiveKey = `${item.source}:${player.toLowerCase()}:${item.url || item.pgn}`;
                if (processed.has(archiveKey) || (this.failures.get(archiveKey) ?? 0) > Date.now())
                    continue;
                if (++examined % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
                try {
                    const game = parsePgnDatabase("Online games", item.pgn).games[0];
                    if (!game || !reviewPlayerColor(game, player)) {
                        processed.add(archiveKey);
                        continue;
                    }
                    const key = reviewScanKey(game, player);
                    if (seen.has(key)) {
                        processed.add(archiveKey);
                        continue;
                    }
                    seen.add(key);
                    if (game.moves.length) games.push({ game, player, key, archiveKey });
                    else {
                        this.data.skipped.push(key);
                        processed.add(archiveKey);
                    }
                } catch {
                    /* Preserve unreadable source games without publishing fabricated positions. */
                }
                if (games.length >= 10) break;
            }
            this.data.processed = [...processed];
            this.status.pendingGames = Math.max(0, this.archive.length - processed.size);
            for (const { game, player, key, archiveKey } of games) {
                if (this.stopped || !this.enabled) break;
                this.status.state = "analyzing";
                this.status.currentGame = `${game.white} – ${game.black}`;
                this.status.currentDate = game.date;
                this.status.error = null;
                try {
                    const cards: PhoneReviewCard[] = [];
                    for (let i = 0; i < game.moves.length; i++) {
                        if (this.stopped || !this.enabled) throw new Error("Analysis paused.");
                        const move = game.moves[i];
                        if (move.color !== reviewPlayerColor(game, player)) continue;
                        this.status.currentPly = i + 1;
                        const best = await this.evaluate(move.fenBefore);
                        if (move.uci === best.uciMoves[0]) continue;
                        const reply = await this.evaluate(move.fenAfter);
                        const card = createPhoneReviewCard(game, i, player, best, reply);
                        if (card) cards.push(card);
                    }
                    await this.transact(async () => {
                        const ids = new Set(this.data.cards.map((c) => c.id));
                        this.data.cards.push(
                            ...selectGameReviewCards(cards).filter((c) => !ids.has(c.id)),
                        );
                        this.data.scanned.push(key);
                        this.data.processed!.push(archiveKey);
                        await this.persist();
                    });
                    this.status.pendingGames--;
                } catch (e: any) {
                    this.failures.set(archiveKey, Date.now() + 3600_000);
                    this.status.error = String(e.message ?? e);
                    this.engine?.close();
                    this.engine = undefined;
                    if (!this.enabled || this.stopped) break;
                }
                // New online games take priority on the next batch; discovery is independent of old history.
                if (Date.now() - this.lastFetch >= 300_000) break;
            }
            this.status.state = this.enabled ? (this.status.error ? "error" : "idle") : "paused";
        } catch (e: any) {
            this.status.state = this.enabled ? "error" : "paused";
            this.status.error = String(e.message ?? e);
            this.options.log?.(`Review preparation: ${this.status.error}`);
        } finally {
            this.engine?.close();
            this.engine = undefined;
            this.busy = false;
            await atomicJson(join(this.options.root, "review-status.json"), {
                ...this.status,
                updatedAt: Date.now(),
            });
            if (this.stopped) {
                this.cache?.close();
                this.cache = undefined;
            }
        }
    }
    private async discover() {
        if (Date.now() - this.lastFetch < 300_000) return;
        this.lastFetch = Date.now();
        this.status.state = "checking";
        const fresh = (await readJson(
            join(this.options.root, "review-games.json"),
            [],
        )) as ArchiveGame[];
        const byUrl = new Map(fresh.map((g) => [`${g.source}:${g.url}`, g]));
        const errors: string[] = [];
        const cursors = await readJson(join(this.options.root, "review-cursors.json"), {});
        for (const source of ["chesscom", "lichess"] as const) {
            const username = this.accounts[source];
            if (!username) continue;
            try {
                const cursorKey = `${source}:${username.toLowerCase()}`;
                const knownEnds = this.archive
                    .filter((g) => g.source === source)
                    .map((g) => (g.end ? g.end * 1000 : (g.playedAt ?? 0)));
                const lastKnown = Math.max(0, ...knownEnds);
                const since =
                    (cursors[cursorKey] ?? (lastKnown || Date.now() - 365 * 86400000)) - 86400000;
                const checkedAt = Date.now();
                const games = await (this.options.fetchGames ?? fetchWebOnlineGamesSince)({
                    source,
                    username,
                    since,
                    signal: AbortSignal.timeout(120_000),
                });
                for (const g of games) byUrl.set(`${source}:${g.url}`, g);
                // Save fetched games before advancing the provider cursor.
                await atomicJson(join(this.options.root, "review-games.json"), [...byUrl.values()]);
                cursors[cursorKey] = checkedAt;
                await atomicJson(join(this.options.root, "review-cursors.json"), cursors);
            } catch (e: any) {
                errors.push(`${source}: ${e.message}`);
            }
        }
        await atomicJson(join(this.options.root, "review-games.json"), [...byUrl.values()]);
        const old = await readJson(join(this.options.root, "games.json"), { games: [] });
        this.archive = mergeArchive(old.games, [...byUrl.values()]);
        this.status.lastCheckedAt = Date.now();
        this.status.discoveryError = errors.join("; ") || null;
    }
    private async evaluate(fen: string): Promise<WebEngineLine> {
        const outcome = positionFromFen(fen)[0]?.outcome();
        if (outcome)
            return engineLine(
                fen,
                99,
                {
                    type: "cp",
                    value: outcome.winner ? (outcome.winner === "white" ? 10000 : -10000) : 0,
                },
                [],
            );
        const key = normalizeWebFen(fen);
        const cached = this.cache!.prepare("SELECT line FROM evaluations WHERE fen = ?").get(key) as
            | { line: string }
            | undefined;
        if (cached) return JSON.parse(cached.line);
        const cloud = await this.options.lookup(fen);
        let line: WebEngineLine | undefined;
        if (
            cloud?.depth >= 16 &&
            cloud.pvs?.[0]?.moves &&
            (Number.isFinite(cloud.pvs[0].cp) || Number.isFinite(cloud.pvs[0].mate))
        ) {
            const pv = cloud.pvs[0];
            line = engineLine(
                fen,
                cloud.depth,
                Number.isFinite(pv.cp)
                    ? { type: "cp", value: pv.cp }
                    : { type: "mate", value: pv.mate },
                pv.moves.split(/\s+/),
            );
            line.source = "lichess-cloud";
            if (!line.uciMoves.length) line = undefined;
        }
        if (!line) {
            if (!this.engine) this.engine = new BackgroundEngine(this.enginePath);
            line = await this.engine.analyze(fen);
        }
        if (line.depth < 14) throw new Error("Engine did not reach the required review depth.");
        this.cache!.prepare("INSERT OR REPLACE INTO evaluations VALUES (?, ?)").run(
            key,
            JSON.stringify(line),
        );
        return line;
    }
    close() {
        this.stopped = true;
        clearInterval(this.timer);
        this.engine?.close();
        if (!this.busy) {
            this.cache?.close();
            this.cache = undefined;
        }
    }
}

function mergeArchive(old: ArchiveGame[], fresh: ArchiveGame[]) {
    return [
        ...new Map([...old, ...fresh].map((g) => [`${g.source}:${g.url || g.pgn}`, g])).values(),
    ];
}

export function engineLine(
    fen: string,
    depth: number,
    score: WebEngineLine["score"],
    uciMoves: string[],
): WebEngineLine {
    const sanMoves: string[] = [],
        legalMoves: string[] = [];
    for (const uci of uciMoves) {
        const move = playUciMove(fen, uci);
        if (!move) break;
        legalMoves.push(uci);
        sanMoves.push(move.san);
        fen = move.fenAfter;
    }
    return { source: "stockfish", multipv: 1, depth, score, uciMoves: legalMoves, sanMoves };
}

// A single low-priority CPU thread, separate from interactive phone/desktop engines.
// It is started only for a stored-evaluation miss and exits after each bounded batch.
class BackgroundEngine {
    private child: ChildProcessWithoutNullStreams;
    private waiting: { line: (line: string) => void; reject: (e: Error) => void } | undefined;
    private ready: Promise<void>;
    constructor(path: string) {
        if (!path) throw new Error("The PC Stockfish path is not configured.");
        this.child = spawn(path, [], { windowsHide: true, stdio: "pipe" });
        this.child.on("spawn", () => {
            try {
                setPriority(this.child.pid!, constants.priority.PRIORITY_BELOW_NORMAL);
            } catch {}
        });
        this.child.on("error", (e) => this.waiting?.reject(e));
        this.child.on("exit", () =>
            this.waiting?.reject(new Error("Background engine exited; preparation will retry.")),
        );
        this.child.stderr.resume();
        createInterface({ input: this.child.stdout }).on("line", (l) => this.waiting?.line(l));
        this.ready = this.exchange<void>("uci", (l) =>
            l === "uciok" ? { result: undefined } : null,
        ).then(() =>
            this.exchange<void>(
                "setoption name Threads value 1\nsetoption name Hash value 64\nisready",
                (l) => (l === "readyok" ? { result: undefined } : null),
            ),
        );
    }
    private exchange<T>(
        command: string,
        accept: (line: string) => { result: T } | null,
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.close();
                finish(new Error("Background engine timed out."));
            }, 30_000);
            const finish = (error?: Error, value?: T) => {
                clearTimeout(timer);
                this.waiting = undefined;
                if (error) reject(error);
                else resolve(value!);
            };
            this.waiting = {
                reject: (e) => finish(e),
                line: (l) => {
                    try {
                        const result = accept(l);
                        if (result) finish(undefined, result.result);
                    } catch (e) {
                        finish(e as Error);
                    }
                },
            };
            this.child.stdin.write(`${command}\n`);
        });
    }
    async analyze(fen: string) {
        await this.ready;
        let best: WebEngineLine | undefined;
        return this.exchange<WebEngineLine>(`position fen ${fen}\ngo depth 16`, (l) => {
            if (l.startsWith("info ") && !/\b(?:lowerbound|upperbound)\b/.test(l)) {
                const score = l.match(/\bscore (cp|mate) (-?\d+)/),
                    depth = l.match(/\bdepth (\d+)/),
                    pv = l.match(/\bpv (.+)/);
                if (score && depth && pv)
                    best = engineLine(
                        fen,
                        Number(depth[1]),
                        {
                            type: score[1] as "cp" | "mate",
                            value: Number(score[2]) * (fen.split(" ")[1] === "b" ? -1 : 1),
                        },
                        pv[1].trim().split(/\s+/),
                    );
            }
            if (l.startsWith("bestmove")) {
                if (!best) {
                    // Terminal positions have no PV; exact mate/stalemate is supplied by chessops below.
                    throw new Error("Engine returned no evaluation.");
                }
                return { result: best };
            }
            return null;
        });
    }
    close() {
        this.child.stdin.end("quit\n");
        this.child.kill();
    }
}
