import { readFileSync, writeFileSync } from "node:fs";
import { Board } from "chessops/board";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { SquareSet } from "chessops/squareSet";
import type { Square } from "chessops/types";
import { expect, test } from "vitest";
import { replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    KPK_STATES,
    buildKpkBitbase,
    kpkIndex,
    kpkState,
    kpkTransitions,
    probeKingPawnEndgame,
    validKpk,
    winningKpkPromotion,
} from "../tacticalMotifs/kpkBitbase";

const table = buildKpkBitbase();
test.skipIf(!process.env.TACTICAL_KPK_DECISION_REPORT)(
    "inspect drawn-to-lost king choices before choosing an explanation fixture",
    () => {
        const cases = [];
        for (let index = 0; index < KPK_STATES; index++) {
            const state = kpkState(index);
            if (
                !table.valid[index] ||
                table.ranks[index] ||
                state.pawnTurn ||
                state.ownKing !== 26 ||
                state.pawn !== 18
            )
                continue;
            const choices = kpkTransitions(state);
            const best = choices.find((m) => typeof m.to === "number" && !table.ranks[m.to]);
            if (!best) continue;
            for (const played of choices) {
                if (typeof played.to !== "number" || !table.ranks[played.to]) continue;
                const replies = kpkTransitions(kpkState(played.to)).filter(
                    (m) =>
                        typeof m.to === "number" &&
                        table.ranks[m.to] &&
                        !table.ranks[kpkIndex({ ...kpkState(m.to), pawnTurn: true })],
                );
                if (replies.length) cases.push({ state, best, played, replies });
            }
        }
        expect(cases.length).toBeGreaterThan(0);
        writeFileSync(process.env.TACTICAL_KPK_DECISION_REPORT!, JSON.stringify(cases, null, 2), {
            flag: "wx",
        });
    },
);
test("every winning state has a decreasing finite conversion proof and every draw a closed defence", () => {
    const failures: unknown[] = [];
    let valid = 0,
        wins = 0,
        maxRank = 0;
    for (let index = 0; index < KPK_STATES; index++) {
        const state = kpkState(index);
        if (kpkIndex(state) !== index || Boolean(table.valid[index]) !== validKpk(state))
            failures.push(index);
        if (!table.valid[index]) continue;
        valid++;
        const rank = table.ranks[index];
        if (rank) {
            wins++;
            maxRank = Math.max(maxRank, rank);
        }
        const moves = kpkTransitions(state);
        const ranks = moves.map((m) =>
            m.to === "promotion"
                ? 0
                : m.to === "draw" || !table.ranks[m.to]
                  ? Infinity
                  : table.ranks[m.to],
        );
        const expected = !moves.length
            ? Infinity
            : state.pawnTurn
              ? Math.min(...ranks)
              : Math.max(...ranks);
        if ((rank ? rank - 1 : Infinity) !== expected) failures.push({ index, rank, expected });
    }
    expect(failures).toEqual([]);
    expect({ valid, wins, maxRank, edges: table.edges }).toMatchObject({
        wins: table.winningStates,
    });
    if (process.env.TACTICAL_KPK_REPORT)
        writeFileSync(
            process.env.TACTICAL_KPK_REPORT,
            JSON.stringify(
                { states: KPK_STATES, valid, wins, maxRank, edges: table.edges },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test("the complete canonical move graph and promotion exits agree with chessops", () => {
    const failures: unknown[] = [];
    for (let index = 0; index < KPK_STATES; index++) {
        const state = kpkState(index);
        const board = Board.empty();
        board.set(state.pawn as Square, { role: "pawn", color: "white" });
        board.set(state.ownKing as Square, { role: "king", color: "white" });
        board.set(state.enemyKing as Square, { role: "king", color: "black" });
        const result = Chess.fromSetup({
            board,
            turn: state.pawnTurn ? "white" : "black",
            castlingRights: SquareSet.empty(),
            halfmoves: 0,
            fullmoves: 1,
            epSquare: undefined,
            pockets: undefined,
            remainingChecks: undefined,
        });
        const valid =
            result.isOk &&
            board.occupied.size() === 3 &&
            board.pawn.size() === 1 &&
            board.king.size() === 2;
        if (valid !== Boolean(table.valid[index])) {
            failures.push({ index, validity: true });
            continue;
        }
        if (!valid) continue;
        const position = result.unwrap();
        const expected = [...position.allDests()]
            .flatMap(([from, targets]) => [...targets].map((to) => `${from}:${to}`))
            .sort();
        const actual = kpkTransitions(state)
            .map((m) => `${m.from}:${m.target}`)
            .sort();
        if (expected.join() !== actual.join()) failures.push({ index, expected, actual });
        if (
            state.pawnTurn &&
            state.pawn >= 48 &&
            position.isLegal({
                from: state.pawn as Square,
                to: (state.pawn + 8) as Square,
                promotion: "queen",
            })
        ) {
            const win = ["queen", "rook"].some((promotion) => {
                const next = position.clone();
                next.play({
                    from: state.pawn as Square,
                    to: (state.pawn + 8) as Square,
                    promotion: promotion as "queen" | "rook",
                });
                return (
                    next.isCheckmate() ||
                    (!next.isStalemate() &&
                        !next.isLegal({
                            from: state.enemyKing as Square,
                            to: (state.pawn + 8) as Square,
                        }))
                );
            });
            if (win !== winningKpkPromotion(state)) failures.push({ index, promotion: true });
        }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(failures).toHaveLength(0);
}, 60000);

test("the real additional Lichess continuation reaches mutual opposition with different move outcomes", () => {
    const sample = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/kpk-zugzwang-development.json", "utf8"),
    );
    const row = sample.cases[0];
    const steps = replayTacticalLine(row.startFen, row.bestLine);
    expect(steps).toHaveLength(5);
    expect(probeKingPawnEndgame(steps[4].after)).toMatchObject({ pawnSide: "white", win: true });
    const passed = steps[4].after.clone();
    passed.turn = "white";
    expect(probeKingPawnEndgame(passed)).toMatchObject({ pawnSide: "white", win: false });
    if (process.env.TACTICAL_KPK_POSITION_REPORT)
        writeFileSync(
            process.env.TACTICAL_KPK_POSITION_REPORT,
            JSON.stringify(
                {
                    row,
                    steps: steps.map((s) => ({
                        fen: makeFen(s.after.toSetup()),
                        probe: probeKingPawnEndgame(s.after),
                    })),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
});

test("non-KPK and exhausted fifty-move windows do not receive a theoretical win", () => {
    expect(probeKingPawnEndgame(Chess.default())).toBeNull();
    const position = Chess.fromSetup(
        parseFen("8/8/8/5k2/8/5K2/5P2/8 b - - 99 1").unwrap(),
    ).unwrap();
    expect(probeKingPawnEndgame(position)).toBeNull();
});
