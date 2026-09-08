import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

// Deliberately judged as positions, not by agreement with puzzle tags. The
// quiet controls matter as much as the combinations. Run explicitly with
// TACTICAL_JUDGEMENT_ENGINE set to a local UCI engine; no engine starts in CI.
const cases = [
    {
        name: "Initial position",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        why: "Development; no immediate tactical win.",
    },
    {
        name: "Quiet Italian",
        fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
        why: "Normal development; f7 pressure is not a winning capture.",
    },
    {
        name: "Ruy Lopez pressure",
        fen: "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
        why: "The c6 knight's pin is positional pressure, not a won piece.",
    },
    {
        name: "Hanging queen",
        fen: "r5k1/5ppp/8/8/Q7/8/5PPP/6K1 b - - 0 1",
        why: "Rxa4 wins a loose queen immediately; any later mate is secondary.",
    },
    {
        name: "Protected f7 fork",
        fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
        why: "Nxf7 forks queen and rook; Bxf7+ is a sound secondary capture.",
    },
    {
        name: "Back rank mate",
        fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        why: "Re8#; the back rank is the direct reason.",
    },
    {
        name: "Deflection combination",
        fen: "3r2k1/p4ppp/1p6/2pr2q1/4R3/1P2PQ2/P5PP/3R2K1 w - - 0 23",
        why: "Rxd5 Qxd5 Re8+ deflects the d8 rook, then Qxd5 wins the queen.",
    },
    {
        name: "Branch-dependent mating pattern",
        fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
        why: "Qh6+ forces mate, but Kxh6 Rh3# and Kg8 Qg7# have different patterns. Only the selected branch may name Anastasia's mate.",
    },
    {
        name: "King and pawn quiet",
        fen: "8/5k2/5p2/8/8/5P2/5K2/8 w - - 0 1",
        why: "Drawn pawn ending; no invented zugzwang or tactical king move.",
    },
];

async function analyse(engine: string, fen: string, searchMove?: string) {
    const child = spawn(engine, [], { windowsHide: true, stdio: "pipe" });
    const lines = new Map<
        number,
        {
            multipv: number;
            depth: number;
            pvUci: string[];
            pvSan: string[];
            cp: number | null;
            mate: number | null;
        }
    >();
    return new Promise<typeof lines>((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("UCI judgement timed out"));
        }, 20000);
        let pending = "";
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.stdout.on("data", (chunk) => {
            pending += String(chunk);
            const rows = pending.split(/\r?\n/);
            pending = rows.pop() ?? "";
            for (const row of rows) {
                if (row === "uciok")
                    child.stdin.write(
                        "setoption name Threads value 1\nsetoption name Hash value 32\nsetoption name MultiPV value 3\nisready\n",
                    );
                if (row === "readyok")
                    child.stdin.write(
                        `position fen ${fen}\ngo depth 16${searchMove ? ` searchmoves ${searchMove}` : ""}\n`,
                    );
                const match = row.match(
                    /info depth (\d+).* multipv (\d+).* score (cp|mate) (-?\d+).* pv (.+)/,
                );
                if (match) {
                    const pvUci = match[5].trim().split(/\s+/);
                    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
                    const pvSan = pvUci.map((uci) => {
                        const move = parseUci(uci)!;
                        if (!pos.isLegal(move)) throw new Error(`Illegal PV ${uci}`);
                        const san = makeSan(pos, move);
                        pos.play(move);
                        return san;
                    });
                    lines.set(Number(match[2]), {
                        depth: Number(match[1]),
                        multipv: Number(match[2]),
                        pvUci,
                        pvSan,
                        cp: match[3] === "cp" ? Number(match[4]) : null,
                        mate: match[3] === "mate" ? Number(match[4]) : null,
                    });
                }
                if (row.startsWith("bestmove ")) {
                    child.stdin.end("quit\n");
                }
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0 && lines.size) resolve(lines);
            else reject(new Error(`UCI exited ${code}`));
        });
        child.stdin.write("uci\n");
    });
}

describe("expert tactical judgement with fresh engine lines", () => {
    const engine = process.env.TACTICAL_JUDGEMENT_ENGINE ?? "";
    test.skipIf(!engine || !existsSync(engine))(
        "inspect quiet mating preparations",
        async () => {
            const report = [];
            const examples = [
                {
                    fen: "7k/7p/5KR1/7Q/8/8/8/8 w - - 0 1",
                    primary: "mateThreat",
                    why: "The quiet queen move forces mate next turn against either pawn push; do not reject it for lacking a check or capture.",
                },
                {
                    fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1",
                    primary: "mateIn3",
                    why: "The selected quiet queen move forces mate within three, with Kxg6 needed against the longest defence. The local tree, not the single mating PV, establishes this.",
                },
            ];
            for (const item of examples) {
                const { fen } = item;
                const lines = [...(await analyse(engine, fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const start = performance.now();
                const scan = buildLiveTacticalScan({
                    fen,
                    ...lines[0],
                    engineName: "Stockfish",
                    variations: lines,
                });
                report.push({
                    ...item,
                    lines,
                    headline: scan.motifs,
                    timeline: scan.variations.map((v) => ({
                        moves: v.lineSan,
                        motifs: v.timeline,
                    })),
                    classificationMs: performance.now() - start,
                });
                expect(scan.motifs.map((m) => m.id)).toEqual([item.primary]);
            }
            const fen = examples[1].fen;
            const forced = [...(await analyse(engine, fen, "h5h6")).values()];
            report.push({
                fen,
                why: "Candidate-search limitation: unrestricted depth-16 MultiPV omitted the faster Qh6 mate. A separately restricted search confirms it; this is not classifier evidence that the other mates fail.",
                forced,
            });
            expect(forced[0].mate).toBe(2);
            expect(
                buildLiveTacticalScan({ fen, ...forced[0], engineName: "Stockfish" }).motifs[0].id,
            ).toBe("mateThreat");
            if (process.env.TACTICAL_QUIET_REPORT)
                writeFileSync(process.env.TACTICAL_QUIET_REPORT, JSON.stringify(report, null, 2));
        },
        60000,
    );
    test.skipIf(!engine || !existsSync(engine))(
        "inspect primary causes and quiet controls",
        async () => {
            const report = [];
            const expected = [
                [],
                [],
                [],
                ["hangingPiece"],
                ["fork"],
                ["backRankMate"],
                ["deflection"],
                ["mateIn2"],
                [],
            ];
            for (const item of cases) {
                const lines = [...(await analyse(engine, item.fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const start = performance.now();
                const scan = buildLiveTacticalScan({
                    fen: item.fen,
                    ...lines[0],
                    engineName: "Stockfish",
                    variations: lines,
                });
                const classificationMs = performance.now() - start;
                report.push({
                    position: item.name,
                    fen: item.fen,
                    judgement: item.why,
                    expected: expected[report.length],
                    classificationMs,
                    headline: scan.motifs.map((m) => `${m.id}@${m.ply}`),
                    candidates: lines,
                    lines: scan.variations.map((v) => ({
                        multipv: v.multipv,
                        moves: v.lineSan.join(" "),
                        motifs: v.motifs.map((m) => `${m.id}@${m.ply}`),
                        timeline: v.timeline.map((m) => `${m.actor}:${m.id}@${m.ply}`),
                    })),
                });
                expect({ position: item.name, motifs: scan.motifs.map((m) => m.id) }).toEqual({
                    position: item.name,
                    motifs: expected[report.length - 1],
                });
            }
            if (process.env.TACTICAL_JUDGEMENT_REPORT)
                writeFileSync(
                    process.env.TACTICAL_JUDGEMENT_REPORT,
                    JSON.stringify(report, null, 2),
                );
            console.log(JSON.stringify(report));
        },
        180000,
    );

    test.skipIf(!engine || !existsSync(engine))(
        "judge actual before/after mistake causes",
        async () => {
            const examples = [
                {
                    name: "Missed quiet mate while leaving the queen attacked",
                    fen: "7k/7p/5Kp1/7Q/8/8/8/8 w - - 0 1",
                    played: "f6e5",
                    source: "missed",
                    primary: "mateIn3",
                    why: "Ke5 leaves the queen en prise, but the most valuable missed opportunity is the quiet forced mating preparation selected by the engine. Its all-defences proof is stronger evidence than the single PV's final mate tag.",
                },
                {
                    name: "b6 permits the f7 fork",
                    fen: "rnbqk2r/ppppbppp/5n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R b KQkq - 0 4",
                    played: "b7b6",
                    source: "allowed",
                    primary: "fork",
                    why: "Black should deal with f7; the quiet b6 move permits a protected queen-rook fork.",
                },
                {
                    name: "Missed queen while the knight is already attacked",
                    fen: "6k1/8/7p/6N1/4q3/3P4/8/K7 w - - 0 1",
                    played: "a1b1",
                    source: "missed",
                    primary: "hangingPiece",
                    why: "Nxe4 both wins the queen and saves the attacked knight. Kb1 misses that immediate gain; the later checks and pawn promotion in the refutation should not replace this simple lesson.",
                },
                {
                    name: "Failed to create a back-rank escape",
                    fen: "6k1/1p3ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1",
                    played: "b7b6",
                    source: "allowed",
                    primary: "backRankMate",
                    why: "A king-side pawn move gives the king an escape from Re8+; b6 allows Re8#. The game is already materially lost, so the lesson is preventing immediate mate.",
                },
            ];
            const report = [];
            for (const example of examples) {
                const before = [...(await analyse(engine, example.fen)).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const pos = Chess.fromSetup(parseFen(example.fen).unwrap()).unwrap();
                const played = parseUci(example.played)!;
                expect(pos.isLegal(played)).toBe(true);
                const rootSign = pos.turn === "white" ? 1 : -1;
                pos.play(played);
                const after = [...(await analyse(engine, makeFen(pos.toSetup()))).values()].sort(
                    (a, b) => a.multipv - b.multipv,
                );
                const best = before[0],
                    refutation = after[0];
                const beforeScore = best.cp ?? Math.sign(best.mate ?? 0) * 10000;
                const afterScore = refutation.cp ?? Math.sign(refutation.mate ?? 0) * 10000;
                const start = performance.now();
                const classification = classifyMistakeReviewMotifs({
                    fen: example.fen,
                    bestMoveUci: best.pvUci[0],
                    playedMoveUci: example.played,
                    pvUci: best.pvUci,
                    pvSan: best.pvSan,
                    refutationUci: refutation.pvUci,
                    refutationSan: refutation.pvSan,
                    cpBefore: beforeScore * rootSign,
                    cpAfter: -afterScore * rootSign,
                    cpLoss: Math.max(0, beforeScore + afterScore),
                });
                const explanation = buildMistakeReviewTacticalExplanation(classification);
                report.push({
                    ...example,
                    before,
                    after,
                    classification,
                    explanation,
                    classificationMs: performance.now() - start,
                });
                if (process.env.TACTICAL_CAUSAL_REPORT)
                    writeFileSync(
                        process.env.TACTICAL_CAUSAL_REPORT,
                        JSON.stringify(report, null, 2),
                    );
                expect({ primary: explanation?.primary.id, source: explanation?.source }).toEqual({
                    primary: example.primary,
                    source: example.source,
                });
            }
        },
        180000,
    );
});
