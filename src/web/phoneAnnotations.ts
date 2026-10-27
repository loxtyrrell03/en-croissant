import { makeFen } from "chessops/fen";
import { ChildNode, makePgn, parsePgn, startingPosition, type PgnNodeData } from "chessops/pgn";
import type { WebCompanionState, WebGame, WebPrepLineMove } from "./model";
import { parsePgnDatabase, playSanMove, playUciMove } from "./pgn";
import {
    normalizePhoneDrawings,
    phoneDrawingComment,
    phoneDrawingSeat,
    phoneDrawingsFromComments,
} from "./phoneDrawings";
export type PhoneAnnotation = Pick<WebPrepLineMove, "annotations" | "comments">;
const glyphs = ["!", "?", "!!", "??", "!?", "?!"];

function patchWorkspaceTree(
    roots: WebPrepLineMove[][] | undefined,
    prefix: WebPrepLineMove[],
    patch: Partial<WebPrepLineMove>,
): WebPrepLineMove[][] | undefined {
    if (!roots || !prefix.length) return roots;
    return roots.map((line) => {
        let shared = 0;
        while (
            shared < prefix.length &&
            line[shared]?.san === prefix[shared].san &&
            line[shared]?.fenBefore === prefix[shared].fenBefore &&
            line[shared]?.fenAfter === prefix[shared].fenAfter
        )
            shared++;
        if (!shared) return line;
        return line.map((move, index) =>
            index !== shared - 1
                ? move
                : shared === prefix.length
                  ? { ...move, ...patch }
                  : {
                        ...move,
                        variations: patchWorkspaceTree(
                            move.variations,
                            prefix.slice(shared),
                            patch,
                        ),
                    },
        );
    });
}

/** Resolve the exact legal root/history in portable PGN, including side lines. */
function portableNode(
    game: WebGame,
    line: WebPrepLineMove[],
    cursor: number,
    startFen: string,
    create: boolean,
) {
    try {
        const parsed = parsePgn(game.pgn)[0];
        if (!parsed) return null;
        let fen = makeFen(startingPosition(parsed.headers).unwrap().toSetup());
        if (fen !== startFen || cursor < 0 || cursor > line.length) return null;
        let node = parsed.moves;
        for (const move of line.slice(0, cursor)) {
            const played = move.uci ? playUciMove(fen, move.uci) : playSanMove(fen, move.san);
            if (
                !played ||
                move.fenBefore !== fen ||
                move.fenAfter !== played.fenAfter ||
                move.san !== played.san
            )
                return null;
            let child = node.children.find(
                (candidate) => playSanMove(fen, candidate.data.san)?.uci === played.uci,
            );
            if (!child) {
                if (!create) return null;
                child = new ChildNode({ san: played.san });
                node.children.push(child);
            }
            node = child;
            fen = played.fenAfter;
        }
        const selected = cursor > 0 ? (node as ChildNode<PgnNodeData>) : null;
        return {
            parsed,
            selected,
            comments: selected ? selected.data.comments : parsed.comments,
            setComments(comments: string[]) {
                if (selected) selected.data.comments = comments;
                else parsed.comments = comments;
            },
        };
    } catch {
        return null;
    }
}

function sourceGame(state: WebCompanionState) {
    return state.gamesByDatabase[state.board.sourceDatabaseId ?? ""]?.find(
        (game) => game.id === state.board.sourceGameId,
    );
}

function replacePortableGame(
    state: WebCompanionState,
    game: WebGame,
    pgn: string,
): WebCompanionState {
    const rebuilt = parsePgnDatabase(game.databaseName, pgn, game.importedAt).games[0];
    if (!rebuilt) return state;
    const updated = {
        ...game,
        pgn,
        moves: rebuilt.moves,
        comments: rebuilt.comments,
        rootVariations: rebuilt.rootVariations,
        rootShapes: rebuilt.rootShapes,
    };
    return {
        ...state,
        gamesByDatabase: {
            ...state.gamesByDatabase,
            [game.databaseId]: state.gamesByDatabase[game.databaseId].map((item) =>
                item.id === game.id ? updated : item,
            ),
        },
    };
}

/** Add a legal played branch to portable PGN without promoting or replacing siblings. */
export function retainPhoneGameLine(
    state: WebCompanionState,
    line: WebPrepLineMove[],
): WebCompanionState | null {
    const game = sourceGame(state);
    if (!game) return state;
    const startFen = state.board.startFen;
    if (portableNode(game, line, line.length, startFen, false)) return state;
    const portable = portableNode(game, line, line.length, startFen, true);
    return portable ? replacePortableGame(state, game, makePgn(portable.parsed)) : null;
}

export function annotatePhoneMove(
    state: WebCompanionState,
    cursor: number,
    patch: PhoneAnnotation,
    expectedOwner?: string,
): WebCompanionState {
    const seat = phoneDrawingSeat(state);
    if (expectedOwner !== undefined && expectedOwner !== seat.owner) return state;
    const { prep, line } = seat;
    if (cursor < 1 || cursor > line.length) return state;
    const nextLine = line.map((m, i) => (i === cursor - 1 ? { ...m, ...patch } : m));
    if (prep)
        return {
            ...state,
            prepWorkspaces: state.prepWorkspaces.map((p) =>
                p.id === prep.id
                    ? {
                          ...p,
                          line: nextLine,
                          moveTree: patchWorkspaceTree(p.moveTree, line.slice(0, cursor), patch),
                          updatedAt: Date.now(),
                      }
                    : p,
            ),
        };
    const next = {
        ...state,
        board: {
            ...state.board,
            line: nextLine,
            moveTree: patchWorkspaceTree(state.board.moveTree, line.slice(0, cursor), patch),
        },
    };
    const game = sourceGame(state);
    if (!game) return next;
    const portable = portableNode(game, line, cursor, seat.startFen, true);
    if (!portable?.selected) return state;
    if (patch.comments) {
        const metadata = (portable.comments ?? []).flatMap(
            (comment) => comment.match(/\[%[^\]]+\]/g) ?? [],
        );
        portable.setComments([...patch.comments, ...metadata]);
    }
    if (patch.annotations)
        portable.selected.data.nags = [
            ...(portable.selected.data.nags ?? []).filter((n) => n > 6),
            ...patch.annotations.map((g) => glyphs.indexOf(g) + 1).filter((n) => n > 0),
        ];
    return replacePortableGame(next, game, makePgn(portable.parsed));
}

export function savedPhoneDrawings(state: WebCompanionState) {
    const seat = phoneDrawingSeat(state);
    const workspace = seat.prep ?? state.board;
    if (Object.hasOwn(workspace.drawings ?? {}, seat.node))
        return normalizePhoneDrawings(workspace.drawings![seat.node]);
    const shapes = seat.cursor > 0 ? seat.line[seat.cursor - 1]?.shapes : workspace.rootShapes;
    if (shapes !== undefined) return normalizePhoneDrawings(shapes);
    if (seat.prep) return [];
    // Older workspaces lack drawing fields; their portable evidence is usable
    // without migrating or rewriting the owner's storage.
    const game = sourceGame(state);
    if (!game || !/\[%(?:cal|csl)\s/i.test(game.pgn)) return [];
    const portable = portableNode(game, seat.line, seat.cursor, seat.startFen, false);
    return phoneDrawingsFromComments(portable?.comments);
}

/** Carry the real root and its annotations when the board becomes a Prep. */
export function phonePrepAnnotationContext(state: WebCompanionState) {
    const seat = phoneDrawingSeat(state);
    const workspace = seat.prep ?? state.board;
    return {
        startFen: seat.startFen,
        rootShapes: savedPhoneDrawings({ ...state, board: { ...state.board, cursor: 0 } }),
        drawings: Object.fromEntries(
            Object.entries(workspace.drawings ?? {}).map(([node, shapes]) => [
                node,
                normalizePhoneDrawings(shapes),
            ]),
        ),
    };
}

export function annotatePhoneDrawings(
    state: WebCompanionState,
    expectedOwner: string,
    shapes: readonly unknown[],
): WebCompanionState {
    const seat = phoneDrawingSeat(state);
    if (seat.owner !== expectedOwner) return state;
    const normalized = normalizePhoneDrawings(shapes);
    const workspace = seat.prep ?? state.board;
    const patch = {
        drawings: { ...workspace.drawings, [seat.node]: normalized },
        moveTree: patchWorkspaceTree(workspace.moveTree, seat.line.slice(0, seat.cursor), {
            shapes: normalized,
        }),
        ...(seat.cursor > 0
            ? {
                  line: seat.line.map((move, index) =>
                      index === seat.cursor - 1 ? { ...move, shapes: normalized } : move,
                  ),
              }
            : { rootShapes: normalized }),
    };
    if (seat.prep)
        return {
            ...state,
            prepWorkspaces: state.prepWorkspaces.map((item) =>
                item.id === seat.prep!.id ? { ...item, ...patch, updatedAt: Date.now() } : item,
            ),
        };
    const next = { ...state, board: { ...state.board, ...patch } };
    const game = sourceGame(state);
    if (!game) return next;
    const portable = portableNode(game, seat.line, seat.cursor, seat.startFen, true);
    if (!portable) return state;
    const retained = (portable.comments ?? [])
        .map((comment) => comment.replace(/\s*\[%(?:cal|csl)\s+[^\]]*\]/gi, " ").trim())
        .filter(Boolean);
    const drawingComment = phoneDrawingComment(normalized);
    portable.setComments(drawingComment ? [...retained, drawingComment] : retained);
    return replacePortableGame(next, game, makePgn(portable.parsed));
}
