import { makeUci, parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import {
    type ReportSearchLimits,
    validReportSearchLimits,
} from "../../scripts/uci-report-search.mjs";
import { positionFromFen } from "@/utils/chessops";
import { gameAnalysisEvidence } from "@/utils/gameAnalysisEvidence";
import { buildGameAnalysisReport } from "@/utils/gameAnalysisReport";
import { gameReportGameKey } from "@/utils/gameReportOwnership";
import { readGameReportRun, recordGameReportRun } from "@/utils/gameReportRun";
import { createNode, defaultTree, treeIteratorMainLine, type TreeNode } from "@/utils/treeReducer";
import type { WebPrepLineMove } from "./model";
import { analyzeWithWebStockfish18 } from "./stockfishEngine";

export type WebReportGame = {
    startFen: string;
    line: readonly Pick<WebPrepLineMove, "fenBefore" | "fenAfter" | "san" | "uci">[];
    white?: string;
    black?: string;
};

export type SavedWebGameReport = { version: 1; root: TreeNode; run: string };

export function savedWebGameReport(
    report: Pick<SavedWebGameReport, "root" | "run">,
): SavedWebGameReport {
    return { version: 1, root: structuredClone(report.root), run: report.run };
}

/** Validate saved evidence against the current legal game, then rebuild display
 * data. Cached labels/statistics and a later preference cannot relabel a run. */
export async function readWebGameReport(value: unknown, game: WebReportGame) {
    try {
        const saved = value as SavedWebGameReport | null;
        if (!saved || saved.version !== 1 || typeof saved.run !== "string") return null;
        const { tree, nodes } = webReportTree(game);
        if (gameReportGameKey(saved.root) !== gameReportGameKey(tree.root)) return null;
        const run = await readGameReportRun(saved.run, saved.root);
        if (run?.limit.t !== "Combined" || !validReportSearchLimits(run.limit.c)) return null;
        const intrinsic = gameAnalysisEvidence(tree.root).scores;
        const savedNodes = [...treeIteratorMainLine(saved.root)].map(({ node }) => node);
        for (const [index, node] of nodes.entries()) {
            const evidence = savedNodes[index];
            const score = evidence.score?.value;
            if (
                !score ||
                !["cp", "mate"].includes(score.type) ||
                !Number.isSafeInteger(score.value)
            )
                return null;
            const terminal = index > 0 ? intrinsic[index - 1] : null;
            if (terminal) {
                if (
                    evidence.depth !== null ||
                    score.type !== terminal.type ||
                    score.value !== terminal.value
                )
                    return null;
            } else if (
                !Number.isSafeInteger(evidence.depth) ||
                evidence.depth! < 1 ||
                evidence.depth! > run.limit.c.depth
            )
                return null;
            node.score = { value: { ...score }, wdl: null };
            node.depth = evidence.depth;
        }
        return {
            root: tree.root,
            run: saved.run,
            details: run,
            report: buildGameAnalysisReport(tree.root, tree.headers),
        };
    } catch {
        return null;
    }
}

/** Build an isolated, replay-validated snapshot before any asynchronous work.
 * The native pure report/evidence/run modules are browser-safe; reusing them
 * keeps custom roots, history, accuracy and portable metadata in one contract.
 */
export function webReportTree(game: WebReportGame) {
    if (!game.line.length || game.line.length > 2000)
        throw new Error("Choose a game with 1–2,000 half-moves to analyze.");
    const [position] = positionFromFen(game.startFen);
    if (!position || position.isEnd())
        throw new Error("The report starting position is invalid or terminal.");
    const startFen = makeFen(position.toSetup());
    const tree = defaultTree(startFen);
    tree.root.halfMoves = position.fullmoves * 2 - (position.turn === "white" ? 2 : 1);
    tree.headers = {
        ...tree.headers,
        fen: startFen,
        white: game.white?.trim() || "White",
        black: game.black?.trim() || "Black",
    };
    const nodes = [tree.root];
    for (const [index, source] of game.line.entries()) {
        const [before] = positionFromFen(source.fenBefore);
        const [after] = positionFromFen(source.fenAfter);
        const sanMove = parseSan(position, source.san);
        const uciMove = source.uci ? parseUci(source.uci) : sanMove;
        const move = uciMove ? normalizeMove(position, uciMove) : null;
        if (
            !before ||
            !after ||
            makeFen(before.toSetup()) !== makeFen(position.toSetup()) ||
            !move ||
            !sanMove ||
            !position.isLegal(move) ||
            makeUci(normalizeMove(position, sanMove)) !== makeUci(move)
        )
            throw new Error(`Move ${index + 1} does not match its legal report position.`);
        const san = makeSan(position, move);
        position.play(move);
        const fen = makeFen(position.toSetup());
        if (makeFen(after.toSetup()) !== fen)
            throw new Error(`Move ${index + 1} has a mismatched saved report position.`);
        const node = createNode({ move, san, fen, halfMoves: tree.root.halfMoves + index + 1 });
        nodes.at(-1)!.children.push(node);
        nodes.push(node);
    }
    return { tree, nodes };
}

export async function analyzeWebGameReport(
    game: WebReportGame,
    options: {
        limits: ReportSearchLimits;
        signal?: AbortSignal;
        isCurrent?: () => boolean;
        onProgress?: (done: number, total: number) => void;
    },
) {
    if (!validReportSearchLimits(options.limits))
        throw new Error("Choose valid report depth and time limits.");
    const limits = { ...options.limits };
    const current = () => {
        options.signal?.throwIfAborted();
        if (options.isCurrent?.() === false)
            throw new DOMException(
                "This report belongs to a different game or request.",
                "AbortError",
            );
    };
    current();
    const { tree, nodes } = webReportTree(game);
    const gameKey = gameReportGameKey(tree.root)!;
    const terminalScores = gameAnalysisEvidence(tree.root).scores;
    const rulePositions: number[] = [];
    const engines = new Set<string>();
    options.onProgress?.(0, nodes.length);
    for (const [index, node] of nodes.entries()) {
        current();
        // No move-score exists yet. This pure evidence pass can only return
        // intrinsic mate/draw/repetition/fifty-move results for these children.
        const terminal = index > 0 ? terminalScores[index - 1] : null;
        if (terminal) {
            node.score = { value: terminal, wdl: null };
            rulePositions.push(index);
        } else {
            const lines = await analyzeWithWebStockfish18({
                fen: node.fen,
                multipv: 1,
                depth: limits.depth,
                reportLimits: limits,
                signal: options.signal,
            });
            current();
            const line = lines[0];
            if (
                !line ||
                line.source !== "stockfish" ||
                !Number.isSafeInteger(line.depth) ||
                line.depth < 1 ||
                line.depth > limits.depth ||
                !Number.isSafeInteger(line.score.value) ||
                !["cp", "mate"].includes(line.score.type)
            )
                throw new Error(`Position ${index + 1} has no usable bounded report score.`);
            node.score = { value: { ...line.score }, wdl: null };
            node.depth = line.depth;
            engines.add(line.engineName?.trim() || "Stockfish 18");
        }
        current();
        options.onProgress?.(index + 1, nodes.length);
    }
    let run: string | undefined;
    await recordGameReportRun(
        {
            getState: () => ({
                root: tree.root,
                setReportRun: (value: string) => {
                    run = value;
                },
            }),
        },
        { engine: [...engines].join(" / "), limit: { t: "Combined", c: limits } },
        () => !options.signal?.aborted && options.isCurrent?.() !== false,
    );
    current();
    if (!run) throw new Error("The completed report metadata could not be verified.");
    return {
        gameKey,
        root: tree.root,
        run,
        report: buildGameAnalysisReport(tree.root, tree.headers),
        rulePositions,
        enginePositions: nodes.length - rulePositions.length,
    };
}
