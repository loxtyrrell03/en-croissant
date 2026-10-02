// Benchmark-only history layer. No production import or provider requests.
import { createHash } from "node:crypto";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import type { NormalMove } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";
import {
    validateTablebaseRecord,
    type TablebaseRecord,
} from "../../src/utils/tacticalMotifs/tablebaseEvidence";
import { verifyCertificate, type EndgameCertificate } from "./endgame-composition-prototype";

export type ReachedHistory = { fen: string; moves: string[] };
export type HistoryBoundCertificate = {
    schemaVersion: 1;
    historySha256: string;
    registrySha256: string;
    positionCertificate: EndgameCertificate;
};
export const HISTORY_LIMITS = { plies: 512, operations: 8192 };
type Budget = { spent: number; limit: number };
type Context = { pos: Chess; counts: Map<string, number>; complete: boolean };
const position = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const fen = (pos: Chess) => makeFen(pos.toSetup());
// chessops toSetup retains an EP square only when a legal EP capture exists.
export const repetitionKey = (pos: Chess) => fen(pos).split(" ").slice(0, 4).join(" ");
const spend = (budget: Budget, cost = 1) => {
    if (budget.spent + cost > budget.limit) throw Error("History operation budget exhausted");
    budget.spent += cost;
};
const legalMoves = (pos: Chess): NormalMove[] =>
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
const automatic = (state: Context) =>
    !state.pos.isCheckmate() &&
    (state.pos.halfmoves >= 150 || (state.counts.get(repetitionKey(state.pos)) ?? 0) >= 5);
function advance(state: Context, move: NormalMove): Context {
    const pos = state.pos.clone();
    pos.play(move);
    // Captures and pawn moves make every earlier board unreachable. Rights
    // losses could extend this subset, but this prototype does not need them.
    const reset = pos.halfmoves === 0;
    const counts = reset ? new Map<string, number>() : new Map(state.counts);
    const key = repetitionKey(pos);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return { pos, counts, complete: state.complete || reset };
}
function replay(rootFen: string, history: ReachedHistory, budget: Budget): Context {
    if (
        !history ||
        typeof history.fen !== "string" ||
        history.fen.length > 200 ||
        !Array.isArray(history.moves) ||
        history.moves.length > HISTORY_LIMITS.plies
    )
        throw Error("Malformed or overlong history");
    const initial = position(history.fen);
    let state: Context = {
        pos: initial,
        counts: new Map([[repetitionKey(initial), 1]]),
        complete: initial.halfmoves === 0,
    };
    for (const uci of history.moves) {
        spend(budget);
        if (state.pos.isEnd() || automatic(state)) throw Error("History continues after game end");
        if (typeof uci !== "string" || uci.length > 5) throw Error("Malformed history move");
        const move = parseUci(uci);
        if (!move || !("from" in move) || !state.pos.isLegal(move))
            throw Error("Illegal history move");
        state = advance(state, move);
    }
    if (fen(state.pos) !== fen(position(rootFen)))
        throw Error("History does not reach exact root FEN");
    return state;
}
function facts(state: Context, budget: Budget) {
    const currentOccurrences = state.counts.get(repetitionKey(state.pos)) ?? 0;
    const checkmate = state.pos.isCheckmate();
    const announced: string[] = [];
    if (!state.pos.isEnd() && !automatic(state))
        for (const move of legalMoves(state.pos)) {
            spend(budget);
            const after = advance(state, move);
            if ((after.counts.get(repetitionKey(after.pos)) ?? 0) >= 3)
                announced.push(makeUci(move));
        }
    return {
        checkmate,
        complete: state.complete,
        currentOccurrences,
        currentClaim: !state.pos.isEnd() && currentOccurrences >= 3,
        announced,
        automaticDraw: automatic(state),
    };
}
export function inspectReachedHistory(rootFen: string, history: ReachedHistory) {
    const budget = { spent: 0, limit: HISTORY_LIMITS.operations };
    try {
        return {
            valid: true as const,
            ...facts(replay(rootFen, history, budget), budget),
            operations: budget.spent,
        };
    } catch (error) {
        return { valid: false as const, reason: String(error), operations: budget.spent };
    }
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const historyIdentity = (history: ReachedHistory) => {
    if (
        !history ||
        typeof history.fen !== "string" ||
        history.fen.length > 200 ||
        !Array.isArray(history.moves) ||
        history.moves.length > HISTORY_LIMITS.plies ||
        history.moves.some((move) => typeof move !== "string" || move.length > 5)
    )
        throw Error("History binding bounds");
    return { fen: fen(position(history.fen)), moves: history.moves };
};
const registryIdentity = (records: readonly TablebaseRecord[], budget?: Budget) => {
    if (!Array.isArray(records) || records.length > 32) throw Error("Registry binding bounds");
    return records.map((record) => {
        const checked = validateTablebaseRecord(record, record?.fen);
        if (!checked) throw Error("Invalid registry binding record");
        if (budget) spend(budget, 1 + checked.moves.length);
        // Hash only the bounded validated semantic envelope, not arbitrary
        // extra transport fields or unbounded user-supplied nested objects.
        return checked;
    });
};
/** Binding is not authentication: history and registry must be independently
 * supplied by the caller, never taken on authority from the certificate. */
export function bindHistoryCertificate(
    positionCertificate: EndgameCertificate,
    history: ReachedHistory,
    records: readonly TablebaseRecord[],
): HistoryBoundCertificate {
    return {
        schemaVersion: 1,
        historySha256: digest(historyIdentity(history)),
        registrySha256: digest(registryIdentity(records)),
        positionCertificate,
    };
}

export function verifyHistoryCertificate(
    rootFen: string,
    moveUci: string,
    certificate: HistoryBoundCertificate,
    history: ReachedHistory | null | undefined,
    records: readonly TablebaseRecord[],
    operationLimit = HISTORY_LIMITS.operations,
): { status: "verified" | "refuted" | "unknown" | "invalid"; reason?: string; operations: number } {
    const budget = { spent: 0, limit: operationLimit };
    try {
        if (
            !Number.isSafeInteger(operationLimit) ||
            operationLimit <= 0 ||
            operationLimit > HISTORY_LIMITS.operations
        )
            throw Error("Invalid history operation limit");
        if (!history)
            return {
                status: "unknown",
                reason: "Missing independently supplied history",
                operations: 0,
            };
        // Bound before hashing caller-supplied arrays.
        if (
            !Array.isArray(history.moves) ||
            history.moves.length > HISTORY_LIMITS.plies ||
            !Array.isArray(records) ||
            records.length > 32
        )
            throw Error("History or registry bounds");
        const root = replay(rootFen, history, budget);
        if (
            !certificate ||
            certificate.schemaVersion !== 1 ||
            certificate.historySha256 !== digest(historyIdentity(history)) ||
            certificate.registrySha256 !== digest(registryIdentity(records, budget))
        )
            throw Error("History or registry binding mismatch");
        const checked = verifyCertificate(
            rootFen,
            moveUci,
            certificate.positionCertificate,
            records,
            operationLimit - budget.spent,
        );
        spend(budget, checked.operations);
        if (!checked.valid) throw Error(`Invalid position certificate: ${checked.reason}`);
        if (root.pos.isEnd() || automatic(root))
            return {
                status: "refuted",
                reason: "Game already ended before root move",
                operations: budget.spent,
            };
        const rootMove = parseUci(moveUci) as NormalMove;
        const defender = root.pos.turn === "white" ? "black" : "white";
        const unknown = new Set<string>();
        const graph = certificate.positionCertificate.actual;
        const walk = (index: number, state: Context): string | undefined => {
            spend(budget);
            const node = graph.nodes[index];
            if (fen(state.pos) !== node.fen) throw Error("History actual edge identity mismatch");
            const draw = facts(state, budget);
            if (draw.checkmate) return;
            if (draw.automaticDraw) return "Automatic draw in actual strategy";
            if (state.pos.turn === defender && (draw.currentClaim || draw.announced.length))
                return draw.currentClaim
                    ? "Defender current threefold claim"
                    : `Defender announced threefold claim: ${draw.announced.join(",")}`;
            if (!state.complete)
                unknown.add("Incomplete reversible history cannot exclude earlier claims");
            if (node.leaf) {
                // Past history only adds drawing resources to the pass side,
                // so its nonloss graph needs no analogous winning-leaf gate.
                // An actual WDL/KPK win alone cannot account for inherited
                // repetition history. Accept only a fresh irreversible leaf.
                if (
                    node.leaf.kind !== "terminal" &&
                    (!state.complete || state.pos.halfmoves !== 0 || state.counts.size !== 1)
                )
                    unknown.add("Winning exact leaf has inherited repetition history");
                return;
            }
            for (const edge of node.edges) {
                const failure = walk(edge.to, advance(state, parseUci(edge.uci) as NormalMove));
                if (failure) return failure;
            }
            return;
        };
        const failure = walk(graph.entry, advance(root, rootMove));
        if (failure) return { status: "refuted", reason: failure, operations: budget.spent };
        if (unknown.size)
            return { status: "unknown", reason: [...unknown].join("; "), operations: budget.spent };
        return { status: "verified", operations: budget.spent };
    } catch (error) {
        const reason = String(error);
        return {
            status: /budget exhausted|Verification limit/i.test(reason) ? "unknown" : "invalid",
            reason,
            operations: budget.spent,
        };
    }
}
