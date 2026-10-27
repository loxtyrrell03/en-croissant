import type { WebCompanionState, WebPrepLineMove } from "./model";
import { retainPhoneGameLine } from "./phoneAnnotations";
import { phoneDrawingSeat } from "./phoneDrawings";
import { playUciMove, webGameToRootLines } from "./pgn";

function sameMove(left: WebPrepLineMove, right: WebPrepLineMove | undefined) {
    return (
        !!right &&
        left.san === right.san &&
        left.fenBefore === right.fenBefore &&
        left.fenAfter === right.fenAfter
    );
}

/** Immutable PGN ordering: the first continuation remains the mainline. */
export function retainPhoneMoveLine(
    roots: WebPrepLineMove[][],
    line: WebPrepLineMove[],
): WebPrepLineMove[][] {
    if (!line.length) return roots;
    const rootIndex = roots.findIndex((root) => sameMove(line[0], root[0]));
    if (rootIndex < 0) return [...roots, line];
    const root = roots[rootIndex];
    let shared = 0;
    while (shared < line.length && sameMove(line[shared], root[shared])) shared++;
    if (shared === line.length) return roots;
    let nextRoot: WebPrepLineMove[];
    if (shared === root.length) nextRoot = [...root, ...line.slice(shared)];
    else {
        const parent = root[shared - 1];
        const variations = retainPhoneMoveLine(parent.variations ?? [], line.slice(shared));
        if (variations === parent.variations) return roots;
        nextRoot = root.map((move, index) =>
            index === shared - 1 ? { ...move, variations } : move,
        );
    }
    return roots.map((root, index) => (index === rootIndex ? nextRoot : root));
}

/** Select a branch with its existing continuation; navigation never truncates it. */
export function findPhoneMoveLine(
    roots: WebPrepLineMove[][],
    prefix: WebPrepLineMove[],
): WebPrepLineMove[] | null {
    if (!prefix.length) return roots[0] ?? [];
    for (const root of roots) {
        if (!sameMove(prefix[0], root[0])) continue;
        let shared = 0;
        while (shared < prefix.length && sameMove(prefix[shared], root[shared])) shared++;
        if (shared === prefix.length) return root;
        if (shared > 0) {
            const branch = findPhoneMoveLine(
                root[shared - 1].variations ?? [],
                prefix.slice(shared),
            );
            if (branch) return [...root.slice(0, shared), ...branch];
        }
    }
    return null;
}

export function phoneMoveRootLines(state: WebCompanionState) {
    const seat = phoneDrawingSeat(state);
    if (seat.prep) return seat.prep.moveTree ?? (seat.line.length ? [seat.line] : []);
    const game = state.gamesByDatabase[state.board.sourceDatabaseId ?? ""]?.find(
        (item) => item.id === state.board.sourceGameId,
    );
    return game
        ? webGameToRootLines(game)
        : (state.board.moveTree ?? (seat.line.length ? [seat.line] : []));
}

export function choosePhoneMoveLine(
    state: WebCompanionState,
    expectedOwner: string,
    requested: WebPrepLineMove[],
    cursor = requested.length,
): WebCompanionState {
    const seat = phoneDrawingSeat(state);
    if (seat.owner !== expectedOwner) return state;
    const next = seat.prep ? state : retainPhoneGameLine(state, seat.line);
    if (!next) return state;
    const moveTree = retainPhoneMoveLine(phoneMoveRootLines(next), seat.line);
    const line = findPhoneMoveLine(moveTree, requested);
    if (!line) return state;
    const board = { ...next.board, cursor: Math.max(0, Math.min(cursor, line.length)) };
    if (seat.prep)
        return {
            ...next,
            board,
            prepWorkspaces: next.prepWorkspaces.map((prep) =>
                prep.id === seat.prep!.id
                    ? {
                          ...prep,
                          line,
                          moveTree,
                          rootPly: Math.min(prep.rootPly ?? 0, line.length),
                          updatedAt: Date.now(),
                      }
                    : prep,
            ),
        };
    return { ...next, board: { ...board, line, moveTree } };
}

/** Atomic, owned move transaction used by board, engine, database and plan moves. */
export function playPhoneMoves(
    state: WebCompanionState,
    expectedOwner: string,
    ucis: readonly string[],
    sourceCursor = state.board.cursor,
): WebCompanionState {
    const seat = phoneDrawingSeat(state);
    if (
        seat.owner !== expectedOwner ||
        !ucis.length ||
        sourceCursor < 0 ||
        sourceCursor > seat.line.length
    )
        return state;
    const prefix = seat.line.slice(0, sourceCursor);
    let fen = prefix.at(-1)?.fenAfter ?? seat.startFen;
    for (const uci of ucis) {
        const played = playUciMove(fen, uci);
        if (!played) return state;
        prefix.push({
            fenBefore: fen,
            ...played,
            actor: seat.prep && fen.split(" ")[1] === seat.prep.userColor[0] ? "user" : "opponent",
        });
        fen = played.fenAfter;
    }
    // Retain an older unsaved draft before adding this new branch.
    let next = state;
    if (!seat.prep) {
        const retained = retainPhoneGameLine(state, seat.line);
        if (!retained) return state;
        const played = retainPhoneGameLine(retained, prefix);
        if (!played) return state;
        next = played;
    }
    const tree = retainPhoneMoveLine(
        retainPhoneMoveLine(phoneMoveRootLines(next), seat.line),
        prefix,
    );
    const line = findPhoneMoveLine(tree, prefix) ?? prefix;
    if (seat.prep)
        return {
            ...next,
            prepWorkspaces: next.prepWorkspaces.map((prep) =>
                prep.id === seat.prep!.id
                    ? {
                          ...prep,
                          line,
                          moveTree: tree,
                          updatedAt: Date.now(),
                      }
                    : prep,
            ),
            board: { ...next.board, cursor: prefix.length },
        };
    return { ...next, board: { ...next.board, line, moveTree: tree, cursor: prefix.length } };
}
