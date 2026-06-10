import { resolve } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import {
    commands,
    type PuzzleCardProgress,
    type PuzzleDatabaseInfo,
    type PuzzleTrainingMode,
} from "@/bindings";
import { getPuzzlesDir } from "@/utils/directories";
import { unwrap } from "./unwrap";

export type Completion = "correct" | "incorrect" | "incomplete";

export interface Puzzle {
    id: number;
    fen: string;
    moves: string[];
    rating: number;
    rating_deviation: number;
    popularity: number;
    nb_plays: number;
    completion: Completion;
    timeSpent?: number;
    themes?: string[];
    trainingMode?: PuzzleTrainingMode;
    selectionReason?: string;
    progress?: PuzzleCardProgress | null;
    usedHint?: boolean;
    viewedSolution?: boolean;
    attemptRecorded?: boolean;
    eloAfter?: number;
    eloDelta?: number;
}

async function getPuzzleDatabase(name: string): Promise<PuzzleDatabaseInfo> {
    const puzzlesDir = await getPuzzlesDir();
    const path = await resolve(puzzlesDir, name);
    return unwrap(await commands.getPuzzleDbInfo(path));
}

export async function getPuzzleDatabases(): Promise<PuzzleDatabaseInfo[]> {
    const puzzlesDir = await getPuzzlesDir();
    const files = await readDir(puzzlesDir);
    const dbs = files.filter(
        (file) => file.name?.endsWith(".db3") && file.name !== "puzzle-progress.db3",
    );
    return (await Promise.allSettled(dbs.map((db) => getPuzzleDatabase(db.name))))
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<PuzzleDatabaseInfo>).value);
}
