import { afterAll, beforeAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { probeKingPawnEndgame } from "../../src/utils/tacticalMotifs/kpkBitbase";
import evidence from "./dvs4f-zugzwang-evidence.json";
import {
    generateCertificate,
    reflectedFen,
    reflectedMove,
    verifyCertificate,
    type EndgameCertificate,
} from "./endgame-composition-prototype";
import {
    bindHistoryCertificate,
    HISTORY_LIMITS,
    inspectReachedHistory,
    repetitionKey,
    verifyHistoryCertificate,
    type ReachedHistory,
} from "./endgame-composition-history";

const records = evidence.records.map((row) => ({ fen: row.fen, result: row.result }));
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
let base: EndgameCertificate;
beforeAll(() => {
    const generated = generateCertificate(evidence.rootFen, "a6b6", records);
    if (!generated.certificate) throw Error(`Missing baseline proof: ${generated.reason}`);
    base = generated.certificate!;
});
const reachedFen = (history: ReachedHistory) => {
    const pos = position(history.fen);
    for (const uci of history.moves) {
        const move = parseUci(uci)!;
        expect(pos.isLegal(move)).toBe(true);
        pos.play(move);
    }
    return makeFen(pos.toSetup());
};
function forHistory(history: ReachedHistory, reflected = false) {
    const supplied = reflected
        ? { fen: reflectedFen(history.fen), moves: history.moves.map(reflectedMove) }
        : history;
    const rootFen = reachedFen(supplied),
        move = reflected ? "a3b3" : "a6b6";
    const cert = structuredClone(base);
    if (reflected)
        for (const graph of [cert.actual, cert.passed])
            for (const node of graph.nodes) {
                node.fen = reflectedFen(node.fen);
                for (const edge of node.edges) edge.uci = reflectedMove(edge.uci);
                if (node.leaf?.kind === "tablebase") node.leaf.reflected = !node.leaf.reflected;
            }
    cert.rootFen = rootFen;
    cert.moveUci = move;
    const actual = position(rootFen);
    actual.play(parseUci(move)!);
    const retime = (index: number, pos: Chess) => {
        const node = cert.actual.nodes[index];
        node.fen = makeFen(pos.toSetup());
        for (const edge of node.edges) {
            const next = pos.clone();
            next.play(parseUci(edge.uci)!);
            retime(edge.to, next);
        }
    };
    retime(cert.actual.entry, actual);
    expect(verifyCertificate(rootFen, move, cert, records).valid).toBe(true);
    return {
        rootFen,
        move,
        supplied,
        cert,
        bound: bindHistoryCertificate(cert, supplied, records),
    };
}
const root0 = "8/8/k2p4/pp1P4/P2K4/1P6/8/8 b - - 0 50";
const currentCycle = ["a6b6", "d4c3", "b6a6", "c3d4"];
const optionalCycle = ["a6a7", "d4e4", "a7a6", "e4d4"];
const histories = {
    fresh: { fen: "8/8/k2p4/pp1P4/P7/1PK5/8/8 w - - 0 50", moves: ["c3d4"] },
    current: { fen: root0, moves: [...currentCycle, ...currentCycle] },
    announced: {
        fen: "8/8/1k1p4/pp1P4/P7/1PK5/8/8 b - - 0 50",
        moves: ["b6a6", "c3d4", "a6b6", "d4c3", "b6a6", "c3d4"],
    },
    optional: { fen: root0, moves: [...optionalCycle, ...optionalCycle] },
    automatic: { fen: root0, moves: Array(4).fill(optionalCycle).flat() },
} satisfies Record<string, ReachedHistory>;
const extraReceipt: unknown[] = [];
afterAll(() => {
    if (!process.env.ENDGAME_COMPOSITION_HISTORY_REPORT) return;
    const rows = Object.entries(histories).flatMap(([name, history]) =>
        [false, true].map((reflected) => {
            const c = forHistory(history, reflected);
            return {
                case: name,
                reflected,
                rootFen: c.rootFen,
                moveUci: c.move,
                history: c.supplied,
                positionOnlyAccepted: true,
                historyAware: verifyHistoryCertificate(
                    c.rootFen,
                    c.move,
                    c.bound,
                    c.supplied,
                    records,
                ),
            };
        }),
    );
    writeFileSync(
        process.env.ENDGAME_COMPOSITION_HISTORY_REPORT,
        JSON.stringify(
            {
                schemaVersion: 1,
                scope: "Benchmark-only history-bound endgame composition; no runtime accuracy credit",
                limits: HISTORY_LIMITS,
                rows: [...rows, ...extraReceipt],
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
});

for (const reflected of [false, true]) {
    test(`fresh supported capture-leaf proof remains verified, reflected=${reflected}`, () => {
        const c = forHistory(histories.fresh, reflected);
        expect(
            verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records).status,
        ).toBe("verified");
        expect(
            c.cert.actual.nodes.filter((n) => n.leaf).every((n) => n.fen.split(" ")[4] === "0"),
        ).toBe(true);
    });
    test(`current defender threefold refutes the history-blind certificate before capture reset, reflected=${reflected}`, () => {
        const c = forHistory(histories.current, reflected);
        const checked = verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records);
        expect(checked.status).toBe("refuted");
        expect(checked.reason).toBe("Defender current threefold claim");
    });
    test(`announced defender threefold is counted before the legal move, reflected=${reflected}`, () => {
        const c = forHistory(histories.announced, reflected);
        const checked = verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records);
        expect(checked.status).toBe("refuted");
        expect(checked.reason).toContain(
            `Defender announced threefold claim: ${reflected ? "d5c6" : "d4c3"}`,
        );
    });
    test(`attacker may decline their optional current claim, reflected=${reflected}`, () => {
        const c = forHistory(histories.optional, reflected);
        const facts = inspectReachedHistory(c.rootFen, c.supplied);
        expect(facts.valid && facts.currentClaim).toBe(true);
        expect(
            verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records).status,
        ).toBe("verified");
    });
    test(`fivefold is automatic even when the attacker wants to continue, reflected=${reflected}`, () => {
        const c = forHistory(histories.automatic, reflected);
        const checked = verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records);
        expect(checked.status).toBe("refuted");
        expect(checked.reason).toBe("Game already ended before root move");
    });
    test(`partial history can witness a claim but cannot prove its absence, reflected=${reflected}`, () => {
        const partial = { ...histories.current, fen: root0.replace(" 0 50", " 7 50") };
        const c = forHistory(partial, reflected);
        const facts = inspectReachedHistory(c.rootFen, c.supplied);
        expect(facts.valid && facts.complete).toBe(false);
        expect(
            verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records).status,
        ).toBe("refuted");
        const noPrefix = forHistory({ fen: evidence.rootFen, moves: [] }, reflected);
        expect(
            verifyHistoryCertificate(
                noPrefix.rootFen,
                noPrefix.move,
                noPrefix.bound,
                noPrefix.supplied,
                records,
            ).status,
        ).toBe("unknown");
    });
    test(`an inherited-history KPK win stays unknown even with no immediate claim, reflected=${reflected}`, () => {
        const history = { fen: "8/8/8/5k2/8/4K3/5P2/8 w - - 0 69", moves: [] };
        if (reflected) history.fen = reflectedFen(history.fen);
        const move = reflected ? "e6f6" : "e3f3";
        const generated = generateCertificate(history.fen, move, []);
        expect(generated.certificate).not.toBeNull();
        const bound = bindHistoryCertificate(generated.certificate!, history, []);
        const checked = verifyHistoryCertificate(history.fen, move, bound, history, []);
        expect(checked.status).toBe("unknown");
        expect(checked.reason).toBe("Winning exact leaf has inherited repetition history");
    });
    test(`a resetting pawn move cannot revive a game already ended by fivefold, reflected=${reflected}`, () => {
        let history = { fen: root0, moves: [...histories.automatic.moves, "b5b4"] };
        if (reflected)
            history = { fen: reflectedFen(history.fen), moves: history.moves.map(reflectedMove) };
        const rootFen = reachedFen(history);
        expect(rootFen.split(" ")[4]).toBe("0");
        const checked = inspectReachedHistory(rootFen, history);
        expect(checked.valid).toBe(false);
        expect(checked.reason).toContain("continues after game end");
    });
}

test("a claim deeper in an otherwise valid exact winning tree is checked before its leaf", () => {
    const history = {
        fen: "8/8/8/4k3/8/4K3/5P2/8 b - - 0 69",
        moves: ["e5d5", "e3d3", "d5e5", "d3e3", "e5f5"],
    };
    const rootFen = reachedFen(history),
        rootMove = "e3f3";
    const generated = generateCertificate(rootFen, rootMove, []);
    expect(generated.certificate).not.toBeNull();
    const cert = generated.certificate!;
    const actual = position(rootFen);
    actual.play(parseUci(rootMove)!);
    const moves = (pos: Chess) =>
        [...pos.allDests()].flatMap(([from, tos]) => [...tos].map((to) => ({ from, to })));
    const uci = (move: { from: number; to: number }) =>
        `${String.fromCharCode(97 + (move.from & 7))}${1 + (move.from >> 3)}${String.fromCharCode(97 + (move.to & 7))}${1 + (move.to >> 3)}`;
    const nodes: EndgameCertificate["actual"]["nodes"] = [
        { fen: makeFen(actual.toSetup()), edges: [] },
    ];
    let targetFound = false;
    for (const reply of moves(actual)) {
        const after = actual.clone();
        after.play(reply);
        const options = moves(after).filter((move) => {
            const result = after.clone();
            result.play(move);
            return probeKingPawnEndgame(result)?.win === true;
        });
        const choice =
            uci(reply) === "f5e5" ? options.find((move) => uci(move) === "f3e3") : options[0];
        expect(choice).toBeDefined();
        const leaf = after.clone();
        leaf.play(choice!);
        const index = nodes.length;
        nodes[0].edges.push({ uci: uci(reply), to: index });
        nodes.push({
            fen: makeFen(after.toSetup()),
            edges: [{ uci: uci(choice!), to: index + 1 }],
        });
        nodes.push({ fen: makeFen(leaf.toSetup()), edges: [], leaf: { kind: "kpk" } });
        if (uci(reply) === "f5e5") targetFound = true;
    }
    expect(targetFound).toBe(true);
    cert.actual = { entry: 0, nodes };
    expect(verifyCertificate(rootFen, rootMove, cert, []).valid).toBe(true);
    const rootFacts = inspectReachedHistory(makeFen(actual.toSetup()), {
        ...history,
        moves: [...history.moves, rootMove],
    });
    expect(rootFacts).toMatchObject({ valid: true, currentClaim: false, announced: [] });
    const checked = verifyHistoryCertificate(
        rootFen,
        rootMove,
        bindHistoryCertificate(cert, history, []),
        history,
        [],
    );
    extraReceipt.push({
        case: "descendant-kpk-claim",
        rootFen,
        moveUci: rootMove,
        history,
        positionOnlyAccepted: true,
        rootHasClaim: false,
        historyAware: checked,
    });
    expect(checked.status).toBe("refuted");
    expect(checked.reason).toBe("Defender current threefold claim");
});

test("equal root FENs reached through different legal histories cannot exchange bindings", () => {
    const first = forHistory({ fen: root0, moves: optionalCycle });
    const second = { fen: root0, moves: ["a6a7", "d4c3", "a7a6", "c3d4"] };
    expect(reachedFen(second)).toBe(first.rootFen);
    const checked = verifyHistoryCertificate(
        first.rootFen,
        first.move,
        first.bound,
        second,
        records,
    );
    expect(checked.status).toBe("invalid");
    expect(checked.reason).toContain("binding mismatch");
});
test("a replayed pawn move establishes a fresh suffix even from an incomplete origin", () => {
    const history = { fen: "8/8/k2p4/pp6/P2KP3/1P6/8/8 w - - 37 50", moves: ["e4e5"] };
    const checked = inspectReachedHistory(reachedFen(history), history);
    expect(checked.valid && checked.complete).toBe(true);
    expect(checked.valid && checked.currentOccurrences).toBe(1);
});
test("illegal continuation beyond automatic game end cannot be hidden in the history", () => {
    const history = { fen: root0, moves: [...histories.automatic.moves, "a6b6"] };
    const checked = inspectReachedHistory(reachedFen(history), history);
    expect(checked.valid).toBe(false);
    expect(checked.reason).toContain("continues after game end");
});
test("a zero-clock origin need not fabricate missing history but a nonzero one remains incomplete", () => {
    expect(inspectReachedHistory(root0, { fen: root0, moves: [] })).toMatchObject({
        valid: true,
        complete: true,
    });
    expect(
        inspectReachedHistory(evidence.rootFen, { fen: evidence.rootFen, moves: [] }),
    ).toMatchObject({ valid: true, complete: false });
});
test("checkmate retains priority over a move-count draw", () => {
    const fen = "k7/pPP5/2K5/8/8/8/8/8 b - - 150 1";
    expect(inspectReachedHistory(fen, { fen, moves: [] })).toMatchObject({
        valid: true,
        checkmate: true,
        automaticDraw: false,
        currentClaim: false,
        announced: [],
    });
});
test("repetition keys include castling rights and legally available en passant only", () => {
    const legalEp = "7k/8/8/3pP3/8/8/8/K7 w - d6 0 1";
    const pinnedEp = "4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    expect(repetitionKey(position(legalEp))).not.toBe(
        repetitionKey(position(legalEp.replace("d6", "-"))),
    );
    expect(repetitionKey(position(pinnedEp))).toBe(
        repetitionKey(position(pinnedEp.replace("d6", "-"))),
    );
    const castles = "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1";
    expect(repetitionKey(position(castles))).not.toBe(
        repetitionKey(position(castles.replace("KQ", "-"))),
    );
    expect(repetitionKey(position(root0))).toBe(
        repetitionKey(position(root0.replace("0 50", "99 99"))),
    );
});
test("missing, malformed, mismatched and overlong histories do not receive proof credit", () => {
    const c = forHistory(histories.fresh);
    expect(verifyHistoryCertificate(c.rootFen, c.move, c.bound, null, records).status).toBe(
        "unknown",
    );
    for (const changed of [
        { ...c.supplied, moves: ["a1a8"] },
        { ...c.supplied, moves: [null] as never },
        { ...c.supplied, moves: Array(HISTORY_LIMITS.plies + 1).fill("c3d4") },
        { ...c.supplied, fen: c.supplied.fen.replace(" 50", " 51") },
    ])
        expect(verifyHistoryCertificate(c.rootFen, c.move, c.bound, changed, records).status).toBe(
            "invalid",
        );
});
test("binding tampering, changed registries and exhausted budgets fail closed", () => {
    const c = forHistory(histories.fresh);
    const bound = structuredClone(c.bound);
    bound.historySha256 = "0".repeat(64);
    expect(verifyHistoryCertificate(c.rootFen, c.move, bound, c.supplied, records).status).toBe(
        "invalid",
    );
    const changed = structuredClone(records);
    changed[0].fen = changed[0].fen.replace(/ (\d+)$/, (_, fullmove) => ` ${Number(fullmove) + 1}`);
    expect(verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, changed).status).toBe(
        "invalid",
    );
    expect(
        verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records, 1).status,
    ).toBe("unknown");
    for (const limit of [0, HISTORY_LIMITS.operations + 1])
        expect(
            verifyHistoryCertificate(c.rootFen, c.move, c.bound, c.supplied, records, limit).status,
        ).toBe("invalid");
});
