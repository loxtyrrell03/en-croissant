// Independent public DVs4F adjudication. This is not an expanded runtime tablebase path.
import { test, expect } from "vitest";
import evidenceJson from "./dvs4f-zugzwang-evidence.json";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { makeUci, parseUci } from "chessops/util";
import {
    validateTablebaseRecord,
    tablebaseZugzwangRequests,
} from "../../src/utils/tacticalMotifs/tablebaseEvidence.ts";
import {
    probeKingPawnEndgame,
    proveKpkZugzwang,
} from "../../src/utils/tacticalMotifs/kpkBitbase.ts";
import { replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics.ts";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter.ts";
import {
    reflectMixedForkFen as reflectFen,
    reflectMixedForkMove as reflectMove,
} from "../../src/utils/tests/fixtures/mixedTargetFork.ts";
const evidence: any = evidenceJson;
const records = evidence.records;
const fortress = evidence.fortress,
    summary: any = { records: [], fortress: [], outputs: [] };
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
const moves = (pos: Chess) =>
    [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => ({ from, to })));
test("all13 provider certificates validate against exact FEN and complete legal move sets", () => {
    expect(records).toHaveLength(13);
    for (const row of records) {
        const verified = validateTablebaseRecord({ fen: row.fen, result: row.result }, row.fen);
        expect(verified).not.toBeNull();
        summary.records.push({
            id: row.id,
            fen: row.fen,
            category: row.result.category,
            dtz: row.result.dtz,
            verified: Boolean(verified),
            replyCount: verified?.moves.length,
        });
    }
});
for (const reflected of [false, true])
    test(`independent closure of the pawn-preserving draw strategy, reflected=${reflected}`, () => {
        const nodes = fortress.reachable;
        expect(Object.keys(nodes)).toHaveLength(230);
        let edges = 0;
        for (const raw of Object.values(nodes)) {
            const node: any = raw;
            const fen = reflected ? reflectFen(node.board + " 0 1") : node.board + " 0 1",
                pos = position(fen);
            const legal = moves(pos).map(makeUci).sort();
            const chosen = node.moves.map((edge: any) =>
                reflected ? reflectMove(edge.uci) : edge.uci,
            );
            expect(pos.turn).toBe(node.whiteTurn !== reflected ? "white" : "black");
            const terminalSafe = pos.isStalemate() || (pos.isCheckmate() && !node.whiteTurn);
            const choicesComplete = node.terminal
                ? terminalSafe && chosen.length === 0
                : node.whiteTurn
                  ? chosen.length === 1
                  : [...chosen].sort().join(" ") === legal.join(" ");
            expect(choicesComplete).toBe(true);
            for (const edge of node.moves) {
                const uci = reflected ? reflectMove(edge.uci) : edge.uci,
                    move = parseUci(uci)!;
                expect(pos.isLegal(move)).toBe(true);
                expect(pos.board.get(move.from)?.role).toBe("king");
                expect(pos.board.get(move.to)).toBeUndefined();
                const after = pos.clone();
                after.play(move);
                const child = nodes[edge.child];
                expect(child).toBeDefined();
                const expected = reflected
                    ? reflectFen(child.board + " 0 1")
                    : child.board + " 0 1";
                expect(key(makeFen(after.toSetup()))).toBe(key(expected));
                edges++;
            }
        }
        for (const entry of fortress.entries) {
            expect(entry.safe).toBe(true);
            expect(nodes[entry.key]).toBeDefined();
        }
        summary.fortress.push({
            reflected,
            nodes: Object.keys(nodes).length,
            edges,
            entries: fortress.entries.length,
            closed: true,
        });
    });
for (const reflected of [false, true])
    test(`complete actual and hypothetical-pass composition, reflected=${reflected}`, () => {
        const actual = "8/8/1k1p4/pp1P4/P2K4/1P6/8/8 w - - 2 51";
        const hypothetical = "8/8/1k1p4/pp1P4/P2K4/1P6/8/8 b - - 2 51";
        const inner = "8/8/k2p4/pp1P4/P7/1PK5/8/8 b - - 4 52";
        const posOf = (fen: string) => position(reflected ? reflectFen(fen) : fen);
        const afterPath = (fen: string, path: string[]) => {
            const pos = posOf(fen);
            for (const original of path) {
                const move = parseUci(reflected ? reflectMove(original) : original)!;
                expect(pos.isLegal(move)).toBe(true);
                pos.play(move);
            }
            return pos;
        };
        const assertLeaf = (
            fen: string,
            path: string[],
            id: string,
            outcome: "blackWin" | "whiteNonLoss",
        ) => {
            const row = records.find((r) => r.id === id);
            expect(row).toBeDefined();
            const after = afterPath(fen, path),
                expected = reflected ? reflectFen(row.fen) : row.fen;
            // Fullmove numbering changes under colour reflection; board, turn, rights and draw clock do not.
            expect(
                makeFen(after.toSetup())
                    .split(" ")
                    .slice(0, reflected ? 5 : 6)
                    .join(" "),
            ).toBe(
                expected
                    .split(" ")
                    .slice(0, reflected ? 5 : 6)
                    .join(" "),
            );
            const originalTurn = position(row.fen).turn;
            const expectedCategories =
                outcome === "blackWin"
                    ? [originalTurn === "black" ? "win" : "loss"]
                    : ["draw", "loss"];
            expect(outcome === "blackWin" || originalTurn === "black").toBe(true);
            expect(expectedCategories).toContain(row.result.category);
            expect(after.halfmoves).toBe(0);
        };
        const assertComplete = (fen: string, choices: string[]) =>
            expect(moves(posOf(fen)).map(makeUci).sort()).toEqual(
                choices.map((m) => (reflected ? reflectMove(m) : m)).sort(),
            );
        const actualBranches = [
            { path: ["d4e4", "b5a4"], id: "actual:d4e4" },
            { path: ["d4e3", "b5a4"], id: "actual:d4e3" },
            { path: ["d4d3", "b5a4"], id: "actual:d4d3" },
            { path: ["d4c3", "b5a4"], id: "actual:d4c3" },
            { path: ["a4b5"], id: "actual:axb5" },
            { path: ["b3b4", "a5b4"], id: "actual:b4" },
        ];
        assertComplete(
            actual,
            actualBranches.map((b) => b.path[0]),
        );
        for (const branch of actualBranches) assertLeaf(actual, branch.path, branch.id, "blackWin");
        assertComplete(hypothetical, ["b6c7", "b6b7", "b6a7", "b6a6", "b5a4", "b5b4"]);
        for (const move of ["b6c7", "b6b7", "b6a7"])
            assertLeaf(hypothetical, [move, "a4b5"], "pass:" + move, "whiteNonLoss");
        assertLeaf(hypothetical, ["b5a4", "b3a4"], "pass:bxa4", "whiteNonLoss");
        expect(key(makeFen(afterPath(hypothetical, ["b6a6", "d4c3"]).toSetup()))).toBe(
            key(makeFen(posOf(inner).toSetup())),
        );
        assertComplete(inner, ["a6b7", "a6a7", "a6b6", "b5a4", "b5b4"]);
        assertLeaf(inner, ["a6b7", "a4b5"], "pass-leaf-3", "whiteNonLoss");
        assertLeaf(inner, ["a6a7", "a4b5"], "pass-leaf-4", "whiteNonLoss");
        assertLeaf(inner, ["b5a4", "b3a4"], "pass-leaf-5", "whiteNonLoss");
        const repeated = afterPath(hypothetical, ["b6a6", "d4c3", "a6b6", "c3d4"]);
        expect(key(makeFen(repeated.toSetup()))).toBe(key(makeFen(posOf(hypothetical).toSetup())));
        expect(repeated.halfmoves).toBe(posOf(hypothetical).halfmoves + 4);
        for (const [fen, index] of [
            [hypothetical, 0],
            [inner, 1],
        ] as const) {
            const after = afterPath(fen, ["b5b4"]),
                entry = fortress.entries[index];
            expect(key(makeFen(after.toSetup()))).toBe(key(makeFen(posOf(entry.fen).toSetup())));
            expect(fortress.reachable[entry.key]).toBeDefined();
            expect(key(makeFen(posOf(entry.fen).toSetup()))).toBe(
                key(makeFen(posOf(fortress.reachable[entry.key].board + " 0 1").toSetup())),
            );
        }
        // Contrary root choices Ka7/Kb7 allow axb5 with an exact draw, so they cannot share this winning proof.
        for (const [root, leaf] of [
            ["a6a7", "pass:b6a7"],
            ["a6b7", "pass:b6b7"],
        ]) {
            const pos = afterPath("8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 1 50", [root, "a4b5"]);
            const row = records.find((r) => r.id === leaf);
            expect(key(makeFen(pos.toSetup()))).toBe(key(makeFen(posOf(row.fen).toSetup())));
            expect(row.result.category).toBe("draw");
        }
        summary.composition ??= [];
        summary.composition.push({
            reflected,
            actualReplies: 6,
            passReplies: 6,
            innerPassReplies: 5,
            actualExactBlackWinLeaves: 6,
            passExactNonLossLeaves: 7,
            closedFortressEntries: 2,
            quietRepeatPlies: 4,
            claim: "actual Black win; hypothetical White pass guarantees White nonloss",
            contraryQuietKingMoves: ["a6a7", "a6b7"],
        });
    });
for (const reflected of [false, true])
    test(`fifty-move claim boundary is before the defender's reset, reflected=${reflected}`, () => {
        const rows = [];
        for (const initialClock of [1, 97, 98, 99]) {
            const fen = `8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - ${initialClock} 50`,
                pos = position(reflected ? reflectFen(fen) : fen);
            const uci = (move: string) => parseUci(reflected ? reflectMove(move) : move)!;
            expect(pos.isLegal(uci("a6b6"))).toBe(true);
            pos.play(uci("a6b6"));
            const currentClaim = pos.halfmoves >= 100;
            const announcedQuietClaim = moves(pos).some((move) => {
                const next = pos.clone();
                next.play(move);
                return next.halfmoves >= 100;
            });
            expect(currentClaim || announcedQuietClaim).toBe(initialClock >= 98);
            pos.play(uci("d4e4"));
            pos.play(uci("b5a4"));
            expect(pos.halfmoves).toBe(0);
            rows.push({
                initialClock,
                claimBeforeBlackCapture: currentClaim || announcedQuietClaim,
            });
        }
        summary.clockBoundary ??= [];
        summary.clockBoundary.push({ reflected, rows });
    });
for (const reflected of [false, true])
    test(`root, full line and counterfactual boundaries, reflected=${reflected}`, () => {
        const original = "8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 1 50",
            line = ["a6b6", "a4b5", "b6b5"];
        const fen = reflected ? reflectFen(original) : original,
            pv = reflected ? line.map(reflectMove) : line;
        const steps = replayTacticalLine(fen, pv);
        expect(steps).toHaveLength(3);
        expect(probeKingPawnEndgame(steps[0].after)).toBeNull();
        expect(proveKpkZugzwang(steps[0].after)).toBeNull();
        expect(tablebaseZugzwangRequests(fen, pv[0])).toBeNull();
        const replySet = moves(steps[0].after).map(makeUci).sort();
        const expected = evidence.legal[1].replies
            .map((r: any) => (reflected ? reflectMove(r.uci) : r.uci))
            .sort();
        expect(replySet).toEqual(expected);
        const passed = steps[0].after.clone();
        passed.turn = steps[0].before.turn;
        const passReplySet = moves(passed).map(makeUci).sort();
        expect(passReplySet).toEqual(
            evidence.legal[2].replies
                .map((r: any) => (reflected ? reflectMove(r.uci) : r.uci))
                .sort(),
        );
        for (const length of [1, 3]) {
            const result = classifyPositionTacticalMotifs({ fen, pvUci: pv.slice(0, length) });
            expect(result.motifs.filter((m) => m.ply === 1)).toEqual([]);
            summary.outputs.push({
                reflected,
                plies: length,
                root: [],
                pieces: steps[0].after.board.occupied.size(),
                actualReplies: replySet,
                passReplies: passReplySet,
            });
        }
    });
