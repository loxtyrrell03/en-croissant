import type { DrawBrushes } from "@lichess-org/chessground/draw";

export type BoardStyle = "default" | "chess-com";

export const DEFAULT_BOARD_STYLE: BoardStyle = "default";
export const CHESS_COM_BOARD_STYLE: BoardStyle = "chess-com";
export const CHESS_COM_STYLE_PIECE_SET = "chesscom-neo";
export const CHESS_COM_STYLE_SOUND_COLLECTION = "chess-com";

export const CHESS_COM_BOARD_COORD_COLORS = {
    white: "#eeeed2",
    black: "#769656",
};

export const CHESS_COM_DRAW_BRUSHES: DrawBrushes = {
    green: { key: "ccg", color: "#15781b", opacity: 0.78, lineWidth: 14 },
    red: { key: "ccr", color: "#c23a2f", opacity: 0.76, lineWidth: 14 },
    blue: { key: "ccb", color: "#2f6fad", opacity: 0.72, lineWidth: 14 },
    yellow: { key: "ccy", color: "#d99412", opacity: 0.76, lineWidth: 14 },
    paleBlue: { key: "ccpb", color: "#2f6fad", opacity: 0.34, lineWidth: 17 },
    paleGreen: { key: "ccpg", color: "#15781b", opacity: 0.34, lineWidth: 17 },
    paleRed: { key: "ccpr", color: "#c23a2f", opacity: 0.34, lineWidth: 17 },
    paleGrey: { key: "ccpgr", color: "#4f4f4f", opacity: 0.28, lineWidth: 17 },
    purple: { key: "ccpurple", color: "#7d47a5", opacity: 0.62, lineWidth: 14 },
    pink: { key: "ccpink", color: "#d94f88", opacity: 0.58, lineWidth: 14 },
    white: { key: "ccw", color: "#ffffff", opacity: 0.82, lineWidth: 14 },
    paleWhite: { key: "ccpw", color: "#ffffff", opacity: 0.5, lineWidth: 17 },
};

export function isChessComBoardStyle(style: BoardStyle) {
    return style === CHESS_COM_BOARD_STYLE;
}

export function getEffectivePieceSet(boardStyle: BoardStyle, selectedPieceSet: string) {
    return isChessComBoardStyle(boardStyle) ? CHESS_COM_STYLE_PIECE_SET : selectedPieceSet;
}

export function getEffectiveSoundCollection(
    boardStyle: BoardStyle,
    selectedSoundCollection: string,
) {
    return isChessComBoardStyle(boardStyle)
        ? CHESS_COM_STYLE_SOUND_COLLECTION
        : selectedSoundCollection;
}
