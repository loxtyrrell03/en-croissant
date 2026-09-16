import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { test, expect } from "vitest";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import type { Role } from "chessops/types";
import {
    replayTacticalLine,
    tacticalCaptureGain,
    isNewlyExposedPawnCapture,
} from "../tacticalMotifs/causalTactics";

const values: Record<Role, number> = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 0,
};

// An inventory of omitted immediate captures, not a new admission rule. Keep
// the full games for exchange context: the previous move alone cannot identify
// a delayed recovery of a gambit pawn. Finite engine scores nominate decisions
// for review; neither a positive local bound nor an empty output is a label of
// correctness. Owner FENs and move histories must never be written to Git.
test.skipIf(
    !process.env.TACTICAL_CAPTURE_AUDIT_INPUTS ||
        !process.env.TACTICAL_CAPTURE_AUDIT_REPORT,
)(
    "inventory every legal immediate capture across complete frozen owner games",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(
            process.env.TACTICAL_CAPTURE_AUDIT_REPORT!,
        );
        expect(existsSync(output)).toBe(false);
        const probeOutput = process.env.TACTICAL_CAPTURE_AUDIT_PROBES
            ? privateReportPath(process.env.TACTICAL_CAPTURE_AUDIT_PROBES)
            : null;
        expect(probeOutput !== null && existsSync(probeOutput)).toBe(false);
        const inputs: { sample: string; replay: string }[] = JSON.parse(
            process.env.TACTICAL_CAPTURE_AUDIT_INPUTS!,
        );
        const cases: any[] = [];
        const ids = new Set<string>();
        const gameIds = new Set<string>();
        let positions = 0,
            captures = 0;
        for (const input of inputs) {
            const sample = JSON.parse(readFileSync(input.sample, "utf8"));
            const replay = JSON.parse(readFileSync(input.replay, "utf8"));
            expect(replay.sourceSha256).toBe(sample.sourceSha256);
            expect(replay.completed).toBe(sample.cases.length);
            const results = new Map<string, any>(
                replay.results.map((row: any) => [row.id, row]),
            );
            for (const game of sample.games) {
                expect(gameIds.has(game.id)).toBe(false);
                gameIds.add(game.id);
                const history = replayTacticalLine(game.startFen, game.moves);
                expect(history).toHaveLength(game.moves.length);
                const rows = sample.cases.filter(
                    (row: any) => row.game === game.id,
                );
                expect(rows).toHaveLength(history.length);
                for (const row of rows) {
                    expect(ids.has(row.id)).toBe(false);
                    ids.add(row.id);
                    const position = history[row.ply].before;
                    expect(makeFen(position.toSetup())).toBe(row.fen);
                    const result = results.get(row.id)!;
                    expect(result.fen).toBe(row.fen);
                    expect(result.playedMoveUci).toBe(row.playedMoveUci);
                    positions++;
                    let material = 0;
                    for (const [square, piece] of position.board) {
                        material +=
                            (piece.color === position.turn ? 1 : -1) *
                            values[piece.role];
                        expect(position.board.get(square)).toEqual(piece);
                    }
                    const recent = history.slice(
                        Math.max(0, row.ply - 12),
                        row.ply,
                    );
                    for (const [from, destinations] of position.allDests()) {
                        for (const to of destinations) {
                            if (
                                !position.board.get(to) &&
                                position.epSquare !== to
                            )
                                continue;
                            if (
                                position.board.get(from)?.role === "pawn" &&
                                (to < 8 || to >= 56)
                            )
                                continue;
                            const uci = makeUci({ from, to });
                            const root = replayTacticalLine(row.fen, [uci])[0];
                            if (!root?.capture) continue;
                            captures++;
                            const gain = tacticalCaptureGain(root);
                            if (gain === null || gain < 90) continue;
                            const candidate = result.before.find(
                                (line: any) => line.pvUci[0] === uci,
                            );
                            const variation = result.scan.variations.find(
                                (line: any) => line.lineUci[0] === uci,
                            );
                            const priorCaptures = recent
                                .filter(
                                    (step) =>
                                        step.capture || step.move.promotion,
                                )
                                .map((step) => ({
                                    fen: makeFen(step.before.toSetup()),
                                    uci: step.uci,
                                    san: step.san,
                                    side: step.before.turn,
                                    capture: step.capture,
                                    promotion: step.move.promotion,
                                }));
                            cases.push({
                                id: `${row.id}:${uci}`,
                                contextId: row.id,
                                game: game.id,
                                ply: row.ply,
                                fen: row.fen,
                                previousFen: row.previousFen,
                                previousMoveUci: row.previousMoveUci,
                                uci,
                                san: root.san,
                                capture: root.capture,
                                localGain: gain,
                                checking: root.after.isCheck(),
                                evasion: root.before.isCheck(),
                                materialBefore: material,
                                newlyExposed: isNewlyExposedPawnCapture(
                                    root,
                                    row.previousFen,
                                    row.previousMoveUci,
                                ),
                                candidate: candidate ?? null,
                                inLiveScan: Boolean(variation),
                                immediate:
                                    variation?.motifs.filter(
                                        (m: any) => m.ply === 1,
                                    ) ?? [],
                                principal: result.before[0],
                                played: row.playedMoveUci,
                                priorCaptures,
                            });
                        }
                    }
                }
            }
        }
        const nominated = cases.filter((row) => row.candidate);
        const omitted = nominated.filter((row) => !row.immediate.length);
        const summary = {
            games: gameIds.size,
            positions,
            legalCaptures: captures,
            locallyPositiveCaptures: cases.length,
            nominatedLocallyPositive: nominated.length,
            omittedNominated: omitted.length,
            omittedLiveCandidates: omitted.filter((row) => row.inLiveScan)
                .length,
            notSelectedForLiveScan: nominated.filter((row) => !row.inLiveScan)
                .length,
            omittedQuietPawns: omitted.filter(
                (row) => row.capture === 100 && !row.checking,
            ).length,
            omittedCheckingPawns: omitted.filter(
                (row) => row.capture === 100 && row.checking,
            ).length,
            omittedPieces: omitted.filter((row) => row.capture > 100).length,
            outsideTopCandidates: cases.filter((row) => !row.candidate).length,
        };
        // Every emitted decision must refer to a legal nonterminal root. This
        // catches malformed frozen inputs before issuing fresh engine requests.
        for (const row of cases)
            expect(
                Chess.fromSetup(parseFen(row.fen).unwrap()).unwrap().isEnd(),
            ).toBe(false);
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Local capture/nomination inventory over all available frozen owner games. Not accuracy labels; no production rule changed. Promotions are outside this capture audit. Twelve prior plies are displayed for human exchange-context review, not used as an automatic recovery rule.",
                    inputs,
                    summary,
                    cases,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        if (probeOutput)
            writeFileSync(
                probeOutput,
                JSON.stringify(
                    {
                        samplePath: output,
                        scope: "Every omitted same-search nominated capture with a positive local bound, plus the already preferred root on each distinct board. Held moves do not become recommendations merely by being searched.",
                        probes: [
                            ...omitted.map((row) => ({
                                id: `${row.id}:held`,
                                fen: row.fen,
                                searchMove: row.uci,
                            })),
                            ...[
                                ...new Map(
                                    omitted.map((row) => [row.contextId, row]),
                                ).values(),
                            ].map((row) => ({
                                id: `${row.contextId}:best`,
                                fen: row.fen,
                            })),
                        ],
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        console.log(JSON.stringify(summary));
    },
    180_000,
);

test.skipIf(
    !process.env.TACTICAL_CAPTURE_AUDIT_PROBES ||
        !process.env.TACTICAL_CAPTURE_ENGINE_REPORT,
)(
    "every final capture audit request has a fresh legal matching engine receipt",
    () => {
        const requests = JSON.parse(
            readFileSync(process.env.TACTICAL_CAPTURE_AUDIT_PROBES!, "utf8"),
        );
        const receipt = JSON.parse(
            readFileSync(process.env.TACTICAL_CAPTURE_ENGINE_REPORT!, "utf8"),
        );
        expect(receipt.completed).toBe(requests.probes.length);
        expect(receipt.searches).toHaveLength(requests.probes.length);
        const records = new Map<string, any>(
            receipt.searches.map((row: any) => [row.id, row]),
        );
        expect(records.size).toBe(requests.probes.length);
        for (const request of requests.probes) {
            const result = records.get(request.id)!;
            expect(result.fen).toBe(request.fen);
            expect(result.searchMove ?? null).toBe(request.searchMove ?? null);
            expect(result.lines[0].depth).toBe(16);
            expect(request.searchMove ? result.lines[0].pvUci[0] : null).toBe(request.searchMove ?? null);
            for (const line of result.lines) {
                expect(replayTacticalLine(result.fen, line.pvUci)).toHaveLength(
                    line.pvUci.length,
                );
            }
        }
    },
);
