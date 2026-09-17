import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { makeSan } from "chessops/san";
import { proveImmediatePromotion, provePromotionThreat, replayTacticalLine } from "../tacticalMotifs/causalTactics";

// Inspect a quiet pawn push without borrowing promotion from one cooperative PV.
// All boards and engine requests remain in the explicitly chosen private report.
test.skipIf(!process.env.TACTICAL_PAWN_PUSH_REPLAY || !process.env.TACTICAL_PAWN_PUSH_REPORT)(
    "inspect every reply to selected immediate owner promotion threats",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PAWN_PUSH_REPORT!);
        expect(existsSync(output)).toBe(false);
        const replay = JSON.parse(readFileSync(process.env.TACTICAL_PAWN_PUSH_REPLAY!, "utf8"));
        const ids: string[] = JSON.parse(process.env.TACTICAL_PAWN_PUSH_IDS ?? "[]");
        expect(ids.length).toBeGreaterThan(0);
        const rows: { id: string; fen: string; before: { pvUci: string[] }[] }[] =
            replay.results.filter((row: any) => ids.includes(row.id));
        expect(rows).toHaveLength(ids.length);
        const probes: any[] = [];
        const cases = rows.map((row) => {
            const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
            expect(root.before.board.get(root.move.from)?.role).toBe("pawn");
            probes.push(
                { id: `${row.id}:best`, fen: row.fen },
                { id: `${row.id}:held`, fen: row.fen, searchMove: root.uci },
            );
            const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
                [...dests].flatMap((to) => {
                    const roles =
                        root.after.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                            ? (["queen", "rook", "bishop", "knight"] as const)
                            : [undefined];
                    return roles.map((promotion) => ({ from, to, promotion }));
                }),
            );
            const branches = replies.map((reply) => {
                const next = root.after.clone();
                next.play(reply);
                const fen = makeFen(next.toSetup());
                const promotions = [...next.allDests()].flatMap(([from, dests]) =>
                    [...dests].flatMap((to) =>
                        from === root.move.to &&
                        next.board.get(from)?.role === "pawn" &&
                        (to < 8 || to >= 56)
                            ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                                  from,
                                  to,
                                  promotion,
                              }))
                            : [],
                    ),
                );
                const candidates = promotions.map((move) => {
                    const step = replayTacticalLine(fen, [makeUci(move)])[0];
                    const proof = proveImmediatePromotion(step);
                    return {
                        move: makeUci(move),
                        san: step.san,
                        proof,
                        mate: step.after.isCheckmate(),
                    };
                });
                const selected = candidates.find((c) => c.proof);
                probes.push({ id: `${row.id}:reply:${makeUci(reply)}:best`, fen });
                if (selected)
                    probes.push({
                        id: `${row.id}:reply:${makeUci(reply)}:held`,
                        fen,
                        searchMove: selected.move,
                    });
                return {
                    reply: makeSan(root.after, reply),
                    replyUci: makeUci(reply),
                    fen,
                    candidates,
                };
            });
            return { id: row.id, fen: row.fen, move: root.uci, branches, threat: provePromotionThreat(root) };
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    scope: "Private immediate-promotion diagnosis, not a root certificate or accuracy estimate.",
                    samplePath: process.env.TACTICAL_PAWN_PUSH_REPLAY,
                    cases,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        console.log(
            JSON.stringify(
                cases.map((row) => ({
                    id: row.id,
                    branches: row.branches.map((b) => ({
                        reply: b.reply,
                        candidates: b.candidates.map((c) => ({
                            move: c.san,
                            gain: c.proof?.gain,
                            visits: c.proof?.visits,
                            mate: c.mate,
                        })),
                    })),
                })),
            ),
        );
    },
    120000,
);
