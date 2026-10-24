import { invoke } from "@tauri-apps/api/core";
import type { PgnGameBatch, PgnGameSnapshot, PgnSourceRef, PgnWriteResult } from "./generated";
export type { PgnGameBatch, PgnGameSnapshot, PgnSourceRef, PgnWriteResult } from "./generated";

// Native PGN failures reject the owner transaction, which retains its edits.

export const pgnFiles = {
    read: (filePath: string, index: number) =>
        invoke<PgnGameSnapshot>("read_pgn_game", { filePath, index }),
    readBatch: (filePath: string, start: number, end: number) =>
        invoke<PgnGameBatch>("read_pgn_games", { filePath, start, end }),
    write: (filePath: string, n: number, expectedIdentity: string, pgn: string, metadata: string) =>
        invoke<PgnWriteResult>("write_game", { filePath, n, pgn, expectedIdentity, metadata }),
    create: (filePath: string, pgn: string, metadata: string, source: PgnSourceRef | null = null) =>
        invoke<PgnWriteResult>("create_pgn_game", { filePath, pgn, metadata, source }),
    append: (filePath: string, pgn: string, metadata: string) =>
        invoke<PgnWriteResult>("append_pgn_game", { filePath, pgn, metadata }),
    remove: (file: string, n: number, expectedIdentity: string) =>
        invoke<PgnWriteResult>("delete_game", { file, n, expectedIdentity }),
};
