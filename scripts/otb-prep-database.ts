import { parsePgnDatabase } from "../src/web/pgn";
import type { WebImportResult } from "../src/web/model";

export function buildWebOtbPrepDatabase({
    name,
    pgn,
    importedAt,
}: {
    name: string;
    pgn: string;
    importedAt: number;
}): WebImportResult {
    const imported = parsePgnDatabase(name, pgn, importedAt);
    return {
        ...imported,
        database: {
            ...imported.database,
            sourceKind: "source",
        },
    };
}
