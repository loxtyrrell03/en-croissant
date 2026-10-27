import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { ChildNode, makePgn, parsePgn, type PgnNodeData, type Node } from "chessops/pgn";
import type { WebCompanionState, WebPrepLineMove } from "./model";
import { retainPhoneGameLine } from "./phoneAnnotations";
import { newPhoneAnnotationOwner, phoneDrawingComment } from "./phoneDrawings";
import { phoneMoveRootLines, retainPhoneMoveLine } from "./phoneMoveTree";
import { parsePgnDatabase } from "./pgn";
import { createEmptyWebBoardState } from "./storage";
import { phoneBoardOrientation, phoneWorkspaceOwner } from "./workspacePreferences";
import type { createWebStateSession } from "./webStateSession";

export class NewBoardSaveError extends Error {
    constructor(
        message: string,
        readonly retryOwner: string,
    ) {
        super(message);
    }
}

export function validateNewBoardFen(input: string) {
    const setup = parseFen(input.trim());
    if (setup.isErr) throw new Error("Enter a full FEN position, including the side to move.");
    const position = Chess.fromSetup(setup.value);
    if (position.isErr)
        throw new Error("Check the pieces and side to move: this position is not legal.");
    return makeFen(position.value.toSetup());
}

function newFile(state: WebCompanionState, name: string, pgn: string) {
    const base = name.trim().replace(/\.pgn$/i, "") || "Untitled";
    let unique = base;
    let suffix = 2;
    while (
        state.databases.some((item) => item.name.toLowerCase() === `${unique}.pgn`.toLowerCase())
    )
        unique = `${base} (${suffix++})`;
    const imported = parsePgnDatabase(`${unique}.pgn`, pgn);
    if (imported.games.length !== 1 || imported.warnings.length)
        throw new Error(
            "This board could not be saved completely. Your current board has been kept.",
        );
    imported.database = { ...imported.database, sourceKind: "opened-file", phoneCreated: true };
    return imported;
}

function emptyPgn(fen: string) {
    const game = parsePgn("*")[0];
    if (fen !== INITIAL_FEN) {
        game.headers.set("SetUp", "1");
        game.headers.set("FEN", fen);
    }
    return game;
}

/** Retain the entire unbound analysis tree before leaving it, including root notes and drawings. */
export function retainBoardBeforeNew(state: WebCompanionState): WebCompanionState {
    if (state.prepWorkspaces.some((prep) => prep.id === state.activePrepId)) return state;
    const source = state.gamesByDatabase[state.board.sourceDatabaseId ?? ""]?.find(
        (game) => game.id === state.board.sourceGameId,
    );
    if (source) {
        const next = retainPhoneGameLine(state, state.board.line);
        if (!next)
            throw new Error(
                "Your current game could not be saved. Keep this board open and retry.",
            );
        return next;
    }
    const board = state.board;
    if (
        !board.line.length &&
        !board.moveTree?.length &&
        board.startFen === INITIAL_FEN &&
        !board.sourceComments.length &&
        !board.rootShapes?.length &&
        !board.coachReview
    )
        return state;
    const game = emptyPgn(validateNewBoardFen(board.startFen));
    game.comments = [...board.sourceComments];
    const rootDrawing = phoneDrawingComment(board.rootShapes ?? []);
    if (rootDrawing) game.comments.push(rootDrawing);
    const glyphs = ["!", "?", "!!", "??", "!?", "?!"];
    function addLines(parent: Node<PgnNodeData>, lines: WebPrepLineMove[][]) {
        for (const line of lines) {
            let node = parent;
            for (const move of line) {
                const comments = [...(move.comments ?? [])];
                const drawing = phoneDrawingComment(move.shapes ?? []);
                if (drawing) comments.push(drawing);
                if (move.timestampSeconds !== undefined)
                    comments.push(`[%timestamp ${move.timestampSeconds}]`);
                if (move.clockSeconds !== undefined) {
                    const seconds = move.clockSeconds;
                    comments.push(
                        `[%clk ${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}]`,
                    );
                }
                const child = new ChildNode<PgnNodeData>({
                    san: move.san,
                    comments,
                    startingComments: move.startingComments,
                    nags: (move.annotations ?? [])
                        .map((glyph) =>
                            /^\$\d+$/.test(glyph)
                                ? Number(glyph.slice(1))
                                : glyphs.indexOf(glyph) + 1,
                        )
                        .filter(Boolean),
                });
                node.children.push(child);
                node = child;
                addLines(node, move.variations ?? []);
            }
        }
    }
    // Build the main continuation before alternatives so PGN first-child ordering is retained.
    function orderedLines(lines: WebPrepLineMove[][]): WebPrepLineMove[][] {
        return lines.map((line) => line.map((move) => ({ ...move, variations: undefined })));
    }
    const roots = retainPhoneMoveLine(phoneMoveRootLines(state), board.line);
    function tree(parent: Node<PgnNodeData>, lines: WebPrepLineMove[][]) {
        const offset = parent.children.length;
        addLines(parent, orderedLines(lines));
        lines.forEach((line, root) => {
            let node = parent.children[offset + root];
            line.forEach((move) => {
                if (move.variations?.length) tree(node, move.variations);
                node = node.children[0];
            });
        });
    }
    tree(game.moves, roots);
    const imported = newFile(state, board.sourceTitle || "Analysis board", makePgn(game));
    imported.games[0].coachReview = board.coachReview;
    return {
        ...state,
        databases: [...state.databases, imported.database],
        gamesByDatabase: { ...state.gamesByDatabase, [imported.database.id]: imported.games },
        board: {
            ...board,
            sourceDatabaseId: imported.database.id,
            sourceGameId: imported.games[0].id,
            sourceTitle: imported.database.name,
        },
    };
}

export function createPhoneBoard(state: WebCompanionState, name = "Untitled", fen = INITIAL_FEN) {
    const startFen = validateNewBoardFen(fen);
    const imported = newFile(state, name, makePgn(emptyPgn(startFen)));
    return {
        ...state,
        activePrepId: null,
        databases: [...state.databases, imported.database],
        gamesByDatabase: { ...state.gamesByDatabase, [imported.database.id]: imported.games },
        board: {
            ...createEmptyWebBoardState(),
            annotationOwnerId: newPhoneAnnotationOwner(),
            orientation: phoneBoardOrientation(state),
            startFen,
            sourceTitle: imported.database.name,
            sourceDatabaseId: imported.database.id,
            sourceGameId: imported.games[0].id,
        },
    };
}

/** Save the old board before switching; late saves never replace a newer board or move. */
export async function startNewPhoneBoard(
    session: ReturnType<typeof createWebStateSession>,
    expectedOwner: string,
    name = "Untitled",
    fen = INITIAL_FEN,
) {
    const startFen = validateNewBoardFen(fen);
    const before = session.getSnapshot();
    if (!before.loaded || phoneWorkspaceOwner(before.state) !== expectedOwner)
        throw new Error(
            "The board changed. Close this panel and try again from the current board.",
        );
    const retained = retainBoardBeforeNew(before.state);
    session.setState(retained);
    const retainedOwner = phoneWorkspaceOwner(retained);
    try {
        await session.flush();
    } catch (error) {
        const now = session.getSnapshot().state;
        if (now.board === retained.board && now.activePrepId === retained.activePrepId)
            throw new NewBoardSaveError(
                error instanceof Error ? error.message : "Your current board could not be saved.",
                retainedOwner,
            );
        throw new Error(
            "The board changed while saving. Your latest work is kept; close this panel and try again.",
        );
    }
    const current = session.getSnapshot().state;
    if (
        phoneWorkspaceOwner(current) !== retainedOwner ||
        current.board !== retained.board ||
        current.prepWorkspaces !== retained.prepWorkspaces
    )
        throw new Error("The board changed while saving. Your latest work is kept; try again.");
    session.setState(createPhoneBoard(current, name, startFen));
}
