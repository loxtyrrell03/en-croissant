import { ChildNode, makePgn, parsePgn } from "chessops/pgn";
import type { WebCompanionState, WebPrepLineMove } from "./model";
import { parsePgnDatabase } from "./pgn";
export type PhoneAnnotation = Pick<WebPrepLineMove, "annotations" | "comments">;
const glyphs = ["!", "?", "!!", "??", "!?", "?!"];
export function annotatePhoneMove(
    state: WebCompanionState,
    cursor: number,
    patch: PhoneAnnotation,
): WebCompanionState {
    const prep = state.prepWorkspaces.find((p) => p.id === state.activePrepId);
    const line = prep?.line ?? state.board.line;
    if (cursor < 1 || cursor > line.length) return state;
    const nextLine = line.map((m, i) => (i === cursor - 1 ? { ...m, ...patch } : m));
    if (prep)
        return {
            ...state,
            prepWorkspaces: state.prepWorkspaces.map((p) =>
                p.id === prep.id ? { ...p, line: nextLine, updatedAt: Date.now() } : p,
            ),
        };
    const board = { ...state.board, line: nextLine };
    const games = state.gamesByDatabase[board.sourceDatabaseId ?? ""];
    const game = games?.find((g) => g.id === board.sourceGameId);
    if (!game) return { ...state, board };
    const parsed = parsePgn(game.pgn)[0];
    if (!parsed) return { ...state, board };
    let node = parsed.moves;
    for (const move of nextLine.slice(0, cursor)) {
        let child = node.children.find((c) => c.data.san === move.san);
        if (!child) {
            child = new ChildNode({ san: move.san });
            node.children.push(child);
        }
        node = child;
    }
    const selected = node as (typeof parsed.moves.children)[number];
    if (patch.comments) {
        const metadata = (selected.data.comments ?? []).flatMap(
            (comment) => comment.match(/\[%[^\]]+\]/g) ?? [],
        );
        selected.data.comments = [...patch.comments, ...metadata];
    }
    if (patch.annotations)
        selected.data.nags = [
            ...(selected.data.nags ?? []).filter((n) => n > 6),
            ...patch.annotations.map((g) => glyphs.indexOf(g) + 1).filter((n) => n > 0),
        ];
    const pgn = makePgn(parsed);
    const rebuilt = parsePgnDatabase(game.databaseName, pgn, game.importedAt).games[0];
    if (!rebuilt) return { ...state, board };
    const updated = {
        ...game,
        pgn,
        moves: rebuilt.moves,
        comments: rebuilt.comments,
        rootVariations: rebuilt.rootVariations,
    };
    return {
        ...state,
        board,
        gamesByDatabase: {
            ...state.gamesByDatabase,
            [game.databaseId]: games.map((g) => (g.id === game.id ? updated : g)),
        },
    };
}
