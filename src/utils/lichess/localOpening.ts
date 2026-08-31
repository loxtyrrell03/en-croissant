import { makeFen } from "chessops/fen";
import { parseUci } from "chessops";
import {
    commands,
    type LocalLichessOpeningQuery,
    type LocalLichessOpeningResult,
    type LocalLichessOpeningStatus,
} from "@/bindings";
import { positionFromFen } from "@/utils/chessops";
import type { PositionData } from "@/utils/lichess/api";

export async function getLocalLichessOpeningStatus(): Promise<LocalLichessOpeningStatus> {
    if (!hasTauriRuntime()) {
        return {
            available: false,
            path: "",
            gameCount: BigInt(0),
            moveRows: BigInt(0),
            standardMonths: [],
            mastersMonths: [],
            maxPlies: 0,
            storageBytes: BigInt(0),
            builtAt: null,
            error: null,
        };
    }
    return await commands.getLocalLichessOpeningDbStatus();
}

export async function queryLocalLichessOpening(
    query: LocalLichessOpeningQuery,
): Promise<LocalLichessOpeningResult | null> {
    if (!hasTauriRuntime()) return null;
    const result = await commands.queryLocalLichessOpening(query);
    if (result.status === "error") {
        throw new Error(`The local Lichess snapshot could not be read: ${result.error}`);
    }
    return result.data;
}

export function hasLocalLichessOpeningSource(
    status: LocalLichessOpeningStatus | undefined,
    source: "lichess-all" | "lichess-masters" | "lichess-player",
) {
    if (!status?.available) return false;
    return source === "lichess-masters"
        ? status.mastersMonths.length > 0
        : status.standardMonths.length > 0;
}

function hasTauriRuntime() {
    return Boolean(
        (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    );
}

export function localOpeningToPositionData(result: LocalLichessOpeningResult): PositionData {
    return {
        white: Number(result.white),
        draws: Number(result.draws),
        black: Number(result.black),
        moves: result.moves.map((move) => ({
            san: move.san,
            uci: move.uci,
            averageRating: 0,
            white: Number(move.white),
            draws: Number(move.draws),
            black: Number(move.black),
        })),
        topGames: result.topGames.map((game) => ({
            uci: "",
            id: game.id,
            winner: game.winner,
            speed: "",
            mode: "rated",
            white: { name: game.white.name, rating: game.white.rating ?? 0 },
            black: { name: game.black.name, rating: game.black.rating ?? 0 },
            year: game.year ?? 0,
            month: game.month ?? "",
        })),
        recentGames: result.recentGames.map((game) => ({
            uci: "",
            id: game.id,
            winner: game.winner,
            speed: "",
            mode: "rated",
            white: { name: game.white.name, rating: game.white.rating ?? 0 },
            black: { name: game.black.name, rating: game.black.rating ?? 0 },
            year: game.year ?? 0,
            month: game.month ?? "",
        })),
    };
}

/** Resolve the Explorer `play` path to the exact local position being queried. */
export function localExplorerFen(fen: string, play: string[]) {
    if (play.length === 0) return fen;
    const [position, error] = positionFromFen(fen);
    if (!position) throw new Error(`Invalid Explorer FEN: ${error?.message ?? fen}`);

    for (const uci of play) {
        const move = parseUci(uci);
        if (!move || !position.isLegal(move)) {
            throw new Error(`Invalid Explorer continuation move: ${uci}`);
        }
        position.play(move);
    }
    return makeFen(position.toSetup());
}

export function explorerMonth(date: Date | undefined) {
    return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : null;
}

export function explorerYear(date: Date | undefined) {
    return date ? String(date.getFullYear()) : null;
}
