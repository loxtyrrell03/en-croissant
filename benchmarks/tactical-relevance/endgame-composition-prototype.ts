// Benchmark-only feasibility prototype. Never imported by a production scanner.
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { Color, NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import { probeKingPawnEndgame } from "../../src/utils/tacticalMotifs/kpkBitbase";
import {
    validateTablebaseRecord,
    type TablebaseRecord,
} from "../../src/utils/tacticalMotifs/tablebaseEvidence";

export type Leaf =
    | { kind: "terminal" }
    | { kind: "kpk" }
    | {
          kind: "tablebase";
          record: number;
          reflected: boolean;
      };
export type CertificateNode = { fen: string; leaf?: Leaf; edges: { uci: string; to: number }[] };
export type CertificateGraph = { entry: number; nodes: CertificateNode[] };
export type EndgameCertificate = {
    schemaVersion: 1;
    kind: "pawn-ending-win-versus-pass-nonloss";
    rootFen: string;
    moveUci: string;
    actual: CertificateGraph;
    passed: CertificateGraph;
};
export type Limits = {
    generationNodes: number;
    generationOperations: number;
    winDepth: number;
    certificateNodes: number;
    verificationOperations: number;
};
export const DEFAULT_LIMITS: Limits = {
    generationNodes: 16384,
    generationOperations: 200000,
    winDepth: 4,
    certificateNodes: 1024,
    verificationOperations: 8192,
};
type Stats = {
    operations: number;
    positions: number;
    passEdges: number;
    retainedActual: number;
    retainedPass: number;
    records: number;
};
type Budget = { left: number; spent: number };
const spend = (budget: Budget, cost = 1) => {
    if (cost > budget.left) throw Error("Operation budget exhausted");
    budget.left -= cost;
    budget.spent += cost;
};
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const fen = (pos: Chess) => makeFen(pos.toSetup());
const boardKey = (pos: Chess) => fen(pos).split(" ").slice(0, 4).join(" ");
const leafKey = (pos: Chess) => fen(pos).split(" ").slice(0, 5).join(" ");
const canonical = (pos: Chess) => position(boardKey(pos) + " 0 1");
const allMoves = (pos: Chess): NormalMove[] =>
    [...pos.allDests()].flatMap(([from, tos]) =>
        [...tos].flatMap((to) =>
            pos.board.get(from)?.role === "pawn" && (to < 8 || to >= 56)
                ? (["queen", "rook", "bishop", "knight"] as const).map((promotion) => ({
                      from,
                      to,
                      promotion,
                  }))
                : [{ from, to }],
        ),
    );
const pawnEnding = (pos: Chess) =>
    pos.board.occupied.size() <= 8 &&
    pos.board.king.size() === 2 &&
    pos.board.occupied.size() === pos.board.king.size() + pos.board.pawn.size() &&
    pos.castles.castlingRights.isEmpty() &&
    pos.epSquare === undefined;
const zeroing = (pos: Chess, move: NormalMove) =>
    pos.board.get(move.from)?.role === "pawn" || pos.board.has(move.to);
const claim = (pos: Chess) =>
    !pos.isCheckmate() &&
    (pos.halfmoves >= 100 ||
        (pos.halfmoves === 99 && allMoves(pos).some((move) => !zeroing(pos, move))));
const terminalOutcome = (pos: Chess, beneficiary: Color): number | null =>
    pos.isCheckmate()
        ? pos.turn === beneficiary
            ? -1
            : 1
        : pos.isEnd() || pos.halfmoves >= 150
          ? 0
          : null;
const irreversibleRank = (pos: Chess) => [
    pos.board.pawn.size(),
    [...pos.board.pawn].reduce(
        (sum, square) =>
            sum + (pos.board.get(square)!.color === "white" ? 7 - (square >> 3) : square >> 3),
        0,
    ),
];

export function reflectedFen(original: string) {
    const fields = original.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = fields[1] === "w" ? "b" : "w";
    // This prototype admits no castling or en-passant rights.
    if (fields[2] !== "-" || fields[3] !== "-") throw Error("Unsupported reflection rights");
    return fields.join(" ");
}
export const reflectedMove = (uci: string) => uci.replace(/[1-8]/g, (r) => String(9 - Number(r)));
const ordered = (pos: Chess, beneficiary: Color) =>
    allMoves(pos).sort((a, b) => {
        const capture = (m: NormalMove) => Number(pos.board.has(m.to));
        return (
            capture(b) - capture(a) ||
            (beneficiary === "white" ? makeUci(a) : reflectedMove(makeUci(a))).localeCompare(
                beneficiary === "white" ? makeUci(b) : reflectedMove(makeUci(b)),
            )
        );
    });

class Oracle {
    private entries: { leaf: Leaf; key: string; outcome: number; turn: Color }[] = [];
    constructor(
        readonly records: readonly TablebaseRecord[],
        private budget: Budget,
    ) {
        if (!Array.isArray(records) || records.length > 32) throw Error("Record limit");
        const identities = new Set<string>();
        for (let index = 0; index < records.length; index++) {
            spend(budget);
            const record = records[index],
                verified = validateTablebaseRecord(record, record.fen);
            if (!verified || identities.has(record.fen))
                throw Error("Invalid or duplicate tablebase record");
            identities.add(record.fen);
            spend(budget, verified.moves.length);
            for (const reflected of [false, true]) {
                const pos = position(reflected ? reflectedFen(record.fen) : record.fen);
                this.entries.push({
                    leaf: { kind: "tablebase", record: index, reflected },
                    key: leafKey(pos),
                    outcome: verified.outcome,
                    turn: pos.turn,
                });
            }
        }
    }
    evaluate(pos: Chess, beneficiary: Color): { outcome: number; leaf: Leaf } | undefined {
        spend(this.budget);
        const terminal = terminalOutcome(pos, beneficiary);
        if (terminal !== null) return { outcome: terminal, leaf: { kind: "terminal" } };
        const local = probeKingPawnEndgame(pos);
        if (local) {
            const outcome = local.win ? (local.pawnSide === beneficiary ? 1 : -1) : 0;
            return { outcome, leaf: { kind: "kpk" } };
        }
        for (const entry of this.entries)
            if (entry.key === leafKey(pos)) {
                const outcome = entry.turn === beneficiary ? entry.outcome : -entry.outcome;
                return { outcome, leaf: entry.leaf };
            }
        return undefined;
    }
    find(pos: Chess, beneficiary: Color, win: boolean): Leaf | undefined {
        const known = this.evaluate(pos, beneficiary);
        return known && (win ? known.outcome === 1 : known.outcome >= 0) ? known.leaf : undefined;
    }
    accepts(pos: Chess, leaf: Leaf, beneficiary: Color, win: boolean) {
        spend(this.budget);
        if (leaf.kind === "terminal") {
            const outcome = terminalOutcome(pos, beneficiary);
            return outcome !== null && (win ? outcome === 1 : outcome >= 0);
        }
        if (terminalOutcome(pos, beneficiary) !== null) return false;
        if (leaf.kind === "kpk") {
            const local = probeKingPawnEndgame(pos);
            const outcome = local
                ? local.win
                    ? local.pawnSide === beneficiary
                        ? 1
                        : -1
                    : 0
                : null;
            return outcome !== null && (win ? outcome === 1 : outcome >= 0);
        }
        if (
            leaf.kind !== "tablebase" ||
            !Number.isSafeInteger(leaf.record) ||
            typeof leaf.reflected !== "boolean"
        )
            return false;
        return this.entries.some(
            (entry) =>
                entry.leaf.kind === "tablebase" &&
                entry.leaf.record === leaf.record &&
                entry.leaf.reflected === leaf.reflected &&
                entry.key === leafKey(pos) &&
                (win
                    ? (entry.turn === beneficiary ? entry.outcome : -entry.outcome) === 1
                    : (entry.turn === beneficiary ? entry.outcome : -entry.outcome) >= 0),
        );
    }
}

function request(rootFen: string, moveUci: string) {
    if (
        typeof rootFen !== "string" ||
        rootFen.length > 200 ||
        typeof moveUci !== "string" ||
        moveUci.length > 5
    )
        throw Error("Invalid root identity");
    const before = position(rootFen),
        move = parseUci(moveUci);
    if (
        !pawnEnding(before) ||
        before.isCheck() ||
        before.isEnd() ||
        before.halfmoves >= 150 ||
        !move ||
        !("from" in move) ||
        move.promotion ||
        !before.isLegal(move) ||
        before.board.has(move.to)
    )
        throw Error("Unsupported root");
    const actual = before.clone();
    actual.play(move);
    if (!pawnEnding(actual) || actual.isCheck() || actual.isEnd())
        throw Error("Unsupported actual root");
    const passed = actual.clone();
    passed.turn = before.turn;
    const checkedPass = position(fen(passed));
    if (!pawnEnding(checkedPass) || checkedPass.isCheck() || checkedPass.isEnd())
        throw Error("Invalid pass counterfactual");
    return { before, actual, passed: checkedPass, beneficiary: before.turn, defender: actual.turn };
}

type Tree = { fen: string; leaf?: Leaf; edges: { uci: string; child: Tree }[] };
function flatten(tree: Tree): CertificateGraph {
    const nodes: CertificateNode[] = [];
    const walk = (node: Tree): number => {
        const index = nodes.length;
        nodes.push({ fen: node.fen, ...(node.leaf ? { leaf: node.leaf } : {}), edges: [] });
        nodes[index].edges = node.edges.map((edge) => ({ uci: edge.uci, to: walk(edge.child) }));
        return index;
    };
    return { entry: walk(tree), nodes };
}

export function generateCertificate(
    rootFen: string,
    moveUci: string,
    records: readonly TablebaseRecord[],
    overrides: Partial<Limits> = {},
): { certificate: EndgameCertificate | null; stats: Stats; reason?: string } {
    const limits = { ...DEFAULT_LIMITS, ...overrides };
    const budget: Budget = { left: limits.generationOperations, spent: 0 };
    const stats: Stats = {
        operations: 0,
        positions: 0,
        passEdges: 0,
        retainedActual: 0,
        retainedPass: 0,
        records: Array.isArray(records) ? records.length : 0,
    };
    try {
        if (
            Object.values(limits).some((n) => !Number.isSafeInteger(n) || n <= 0) ||
            Object.entries(limits).some(
                ([name, value]) => value > DEFAULT_LIMITS[name as keyof Limits],
            )
        )
            throw Error("Invalid limits");
        const root = request(rootFen, moveUci),
            oracle = new Oracle(records, budget);
        const win = (pos: Chess, depth: number, path: Set<string>): Tree | null => {
            spend(budget);
            if (stats.positions >= limits.generationNodes) throw Error("Position budget exhausted");
            stats.positions++;
            if (pos.turn === root.defender && claim(pos)) return null;
            const known = oracle.evaluate(pos, root.beneficiary);
            if (known)
                return known.outcome === 1 ? { fen: fen(pos), leaf: known.leaf, edges: [] } : null;
            if (!depth || pos.isEnd() || pos.halfmoves >= 150 || path.has(boardKey(pos)))
                return null;
            const nextPath = new Set([...path, boardKey(pos)]),
                edges: Tree["edges"] = [];
            for (const move of ordered(pos, root.beneficiary)) {
                spend(budget);
                const after = pos.clone();
                after.play(move);
                const child = win(after, depth - 1, nextPath);
                if (pos.turn === root.beneficiary) {
                    if (child) return { fen: fen(pos), edges: [{ uci: makeUci(move), child }] };
                } else {
                    if (!child) return null;
                    edges.push({ uci: makeUci(move), child });
                }
            }
            return pos.turn !== root.beneficiary && edges.length ? { fen: fen(pos), edges } : null;
        };
        const tree = win(root.actual, limits.winDepth, new Set());
        if (!tree)
            return {
                certificate: null,
                stats: { ...stats, operations: budget.spent },
                reason: "No bounded actual win",
            };
        const actual = flatten(tree);
        type Work = CertificateNode & { pos: Chess; parents: number[]; fixed?: boolean };
        const work: Work[] = [],
            identities = new Map<string, number>();
        const intern = (pos: Chess, leaf?: Leaf) => {
            const normalized = leaf ? pos : canonical(pos),
                identity = `${leaf ? "leaf" : "graph"}:${fen(normalized)}`;
            const old = identities.get(identity);
            if (old !== undefined) return old;
            if (stats.positions >= limits.generationNodes) throw Error("Position budget exhausted");
            stats.positions++;
            const index = work.length;
            identities.set(identity, index);
            work.push({
                fen: fen(normalized),
                pos: normalized,
                edges: [],
                parents: [],
                ...(leaf ? { leaf } : {}),
            });
            return index;
        };
        const knownPass = oracle.evaluate(root.passed, root.defender);
        if (knownPass && knownPass.outcome < 0)
            return {
                certificate: null,
                stats: { ...stats, operations: budget.spent },
                reason: "Exact pass position is losing for the defender",
            };
        const entry = intern(root.passed, knownPass?.leaf);
        // One extra zeroing reply can connect an initially unknown capture to
        // an exact leaf. This is still a complete AND/OR proof, not permission
        // to expand a new material class or follow a supplied PV.
        const zeroingBridge = (pos: Chess): Tree | null => {
            if (!pawnEnding(pos) || pos.isEnd()) return null;
            const edges: Tree["edges"] = [];
            for (const move of ordered(pos, root.defender)) {
                spend(budget);
                const after = pos.clone();
                after.play(move);
                const leaf =
                    zeroing(pos, move) || terminalOutcome(after, root.defender) !== null
                        ? oracle.find(after, root.defender, false)
                        : undefined;
                if (pos.turn === root.defender) {
                    if (leaf)
                        return {
                            fen: fen(pos),
                            edges: [
                                { uci: makeUci(move), child: { fen: fen(after), leaf, edges: [] } },
                            ],
                        };
                } else {
                    if (!leaf) return null;
                    edges.push({ uci: makeUci(move), child: { fen: fen(after), leaf, edges: [] } });
                }
            }
            return edges.length ? { fen: fen(pos), edges } : null;
        };
        const addBridge = (tree: Tree): number => {
            const index = intern(position(tree.fen), tree.leaf),
                node = work[index];
            if (node.leaf || node.fixed) return index;
            node.fixed = true;
            node.edges = tree.edges.map((edge) => {
                const to = addBridge(edge.child);
                work[to].parents.push(index);
                stats.passEdges++;
                return { uci: edge.uci, to };
            });
            return index;
        };
        for (let cursor = 0; cursor < work.length; cursor++) {
            spend(budget);
            const node = work[cursor];
            if (node.leaf || node.fixed) continue;
            if (!pawnEnding(node.pos) || node.pos.isEnd()) continue;
            for (const move of ordered(node.pos, root.defender)) {
                spend(budget);
                const after = node.pos.clone();
                after.play(move);
                const resets = zeroing(node.pos, move),
                    capture = node.pos.board.has(move.to);
                const terminal = terminalOutcome(after, root.defender) !== null;
                const leaf =
                    resets || terminal ? oracle.find(after, root.defender, false) : undefined;
                let to = -1;
                if (leaf) to = intern(after, leaf);
                else if (capture) {
                    const bridge = zeroingBridge(after);
                    if (bridge) to = addBridge(bridge);
                }
                // Conservative candidate scope, independent of any puzzle:
                // defender quiet king moves; opposing king moves/pawn advances.
                else if (
                    !capture &&
                    !move.promotion &&
                    pawnEnding(after) &&
                    !after.isEnd() &&
                    (node.pos.turn !== root.defender ||
                        node.pos.board.get(move.from)?.role === "king")
                )
                    to = intern(after);
                if (node.pos.turn === root.defender && to < 0) continue;
                node.edges.push({ uci: makeUci(move), to });
                stats.passEdges++;
                if (to >= 0) work[to].parents.push(cursor);
            }
        }
        const bad = new Set<number>(),
            queue: number[] = [],
            remaining = work.map((node) => node.edges.filter((edge) => edge.to >= 0).length);
        const fail = (index: number) => {
            if (!bad.has(index)) {
                bad.add(index);
                queue.push(index);
            }
        };
        for (let index = 0; index < work.length; index++) {
            const node = work[index];
            if (node.leaf) continue;
            if (
                !node.edges.length ||
                (node.pos.turn !== root.defender && node.edges.some((edge) => edge.to < 0))
            )
                fail(index);
        }
        for (let cursor = 0; cursor < queue.length; cursor++)
            for (const parent of work[queue[cursor]].parents) {
                spend(budget);
                if (work[parent].pos.turn !== root.defender || --remaining[parent] === 0)
                    fail(parent);
            }
        if (bad.has(entry))
            return {
                certificate: null,
                stats: { ...stats, operations: budget.spent },
                reason: "No closed pass nonloss strategy with supplied exact leaves",
            };
        const retained: CertificateNode[] = [],
            mapped = new Map<number, number>(),
            pending = [entry];
        mapped.set(entry, 0);
        for (let cursor = 0; cursor < pending.length; cursor++) {
            const old = pending[cursor],
                node = work[old];
            let edges = node.edges.filter((edge) => !bad.has(edge.to));
            if (node.pos.turn === root.defender && !node.leaf)
                edges = [...edges]
                    .sort(
                        (a, b) =>
                            Number(Boolean(work[b.to].leaf)) - Number(Boolean(work[a.to].leaf)),
                    )
                    .slice(0, 1);
            const copied = edges.map((edge) => {
                if (!mapped.has(edge.to)) {
                    mapped.set(edge.to, pending.length);
                    pending.push(edge.to);
                }
                return { uci: edge.uci, to: mapped.get(edge.to)! };
            });
            retained.push({
                fen: node.fen,
                edges: copied,
                ...(node.leaf ? { leaf: node.leaf } : {}),
            });
            if (retained.length > limits.certificateNodes)
                throw Error("Certificate size exhausted");
        }
        stats.retainedActual = actual.nodes.length;
        stats.retainedPass = retained.length;
        stats.operations = budget.spent;
        const certificate: EndgameCertificate = {
            schemaVersion: 1,
            kind: "pawn-ending-win-versus-pass-nonloss",
            rootFen: fen(root.before),
            moveUci,
            actual,
            passed: { entry: 0, nodes: retained },
        };
        const checked = verifyCertificate(
            rootFen,
            moveUci,
            certificate,
            records,
            limits.verificationOperations,
        );
        if (!checked.valid) throw Error(`Independent verifier: ${checked.reason}`);
        return { certificate, stats };
    } catch (error) {
        return {
            certificate: null,
            stats: { ...stats, operations: budget.spent },
            reason: String(error),
        };
    }
}

/** Independent graph walk: no reuse of the generator's fixed-point labels. */
export function verifyCertificate(
    rootFen: string,
    moveUci: string,
    certificate: EndgameCertificate,
    records: readonly TablebaseRecord[],
    operationLimit = DEFAULT_LIMITS.verificationOperations,
) {
    const budget: Budget = { left: operationLimit, spent: 0 };
    try {
        if (
            !Number.isSafeInteger(operationLimit) ||
            operationLimit <= 0 ||
            operationLimit > DEFAULT_LIMITS.verificationOperations
        )
            throw Error("Verification limit");
        const root = request(rootFen, moveUci),
            oracle = new Oracle(records, budget);
        if (
            !certificate ||
            certificate.schemaVersion !== 1 ||
            certificate.kind !== "pawn-ending-win-versus-pass-nonloss" ||
            certificate.rootFen !== fen(root.before) ||
            certificate.moveUci !== moveUci
        )
            throw Error("Certificate identity");
        for (const graph of [certificate.actual, certificate.passed]) {
            if (
                !graph ||
                !Array.isArray(graph.nodes) ||
                graph.nodes.length === 0 ||
                graph.nodes.length > DEFAULT_LIMITS.certificateNodes ||
                !Number.isSafeInteger(graph.entry) ||
                graph.entry < 0 ||
                graph.entry >= graph.nodes.length
            )
                throw Error("Graph bounds");
            for (const node of graph.nodes)
                if (
                    !node ||
                    typeof node.fen !== "string" ||
                    node.fen.length > 200 ||
                    !Array.isArray(node.edges) ||
                    node.edges.length > 32
                )
                    throw Error("Node bounds");
        }
        const edgeMap = (node: CertificateNode, pos: Chess, chooser: Color) => {
            const legal = allMoves(pos).map(makeUci).sort();
            spend(budget, legal.length);
            const selected = node.edges.map((edge) => edge.uci).sort();
            if (
                new Set(selected).size !== selected.length ||
                selected.some((uci) => !legal.includes(uci)) ||
                (pos.turn === chooser
                    ? selected.length !== 1
                    : JSON.stringify(selected) !== JSON.stringify(legal))
            )
                throw Error("Incomplete or illegal choice coverage");
        };
        const reachedWin = new Set<number>();
        const verifyWin = (index: number, expected: Chess, path: Set<number>) => {
            spend(budget);
            if (
                !Number.isSafeInteger(index) ||
                index < 0 ||
                index >= certificate.actual.nodes.length ||
                path.has(index)
            )
                throw Error("Invalid winning cycle");
            const node = certificate.actual.nodes[index];
            if (node.fen !== fen(expected)) throw Error("Actual edge identity");
            if (reachedWin.has(index)) return;
            reachedWin.add(index);
            if (expected.turn === root.defender && claim(expected))
                throw Error("Defender draw claim");
            if (node.leaf) {
                if (
                    node.edges.length ||
                    !oracle.accepts(expected, node.leaf, root.beneficiary, true)
                )
                    throw Error("Unproved winning leaf");
                return;
            }
            if (expected.isEnd() || expected.halfmoves >= 150 || !pawnEnding(expected))
                throw Error("Unproved winning terminal");
            edgeMap(node, expected, root.beneficiary);
            for (const edge of node.edges) {
                const after = expected.clone();
                after.play(parseUci(edge.uci)!);
                verifyWin(edge.to, after, new Set([...path, index]));
            }
        };
        verifyWin(certificate.actual.entry, root.actual, new Set());
        if (reachedWin.size !== certificate.actual.nodes.length)
            throw Error("Unreachable winning nodes");
        const reachedPass = new Set<number>(),
            pending = [
                {
                    index: certificate.passed.entry,
                    expected: root.passed,
                    reset: false,
                    root: true,
                },
            ];
        for (let cursor = 0; cursor < pending.length; cursor++) {
            spend(budget);
            const item = pending[cursor];
            if (
                !Number.isSafeInteger(item.index) ||
                item.index < 0 ||
                item.index >= certificate.passed.nodes.length
            )
                throw Error("Pass edge bounds");
            const node = certificate.passed.nodes[item.index],
                pos = position(node.fen);
            if (boardKey(pos) !== boardKey(item.expected)) throw Error("Pass edge identity");
            if (node.leaf) {
                if (
                    node.edges.length ||
                    (node.leaf.kind !== "terminal" && !item.root && !item.reset) ||
                    leafKey(pos) !== leafKey(item.expected) ||
                    !oracle.accepts(pos, node.leaf, root.defender, false)
                )
                    throw Error("Unproved pass leaf or changed draw clock");
                reachedPass.add(item.index);
                continue;
            }
            if (node.fen !== fen(canonical(pos)) || !pawnEnding(pos) || pos.isEnd())
                throw Error("Invalid pass strategy state");
            if (reachedPass.has(item.index)) continue;
            reachedPass.add(item.index);
            edgeMap(node, pos, root.defender);
            for (const edge of node.edges) {
                const move = parseUci(edge.uci) as NormalMove,
                    after = pos.clone();
                after.play(move);
                const reset = zeroing(pos, move);
                if (reset && !move.promotion) {
                    const beforeRank = irreversibleRank(pos),
                        afterRank = irreversibleRank(after);
                    if (
                        !(
                            afterRank[0] < beforeRank[0] ||
                            (afterRank[0] === beforeRank[0] && afterRank[1] < beforeRank[1])
                        )
                    )
                        throw Error("Unproved irreversible rank");
                }
                pending.push({ index: edge.to, expected: after, reset, root: false });
            }
        }
        if (reachedPass.size !== certificate.passed.nodes.length)
            throw Error("Unreachable pass nodes");
        return {
            valid: true,
            operations: budget.spent,
            actualNodes: reachedWin.size,
            passNodes: reachedPass.size,
        };
    } catch (error) {
        return { valid: false, operations: budget.spent, reason: String(error) };
    }
}
