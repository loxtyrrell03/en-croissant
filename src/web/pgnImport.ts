export type WebPgnImportRequest = {
    name: string;
    pgn: string;
};

export const WEB_PGN_FILE_ACCEPT = ".pgn,application/x-chess-pgn,text/plain";

export function createWebPgnImportRequest({
    name,
    pgn,
}: {
    name?: string | null;
    pgn: string;
}): WebPgnImportRequest {
    const normalizedPgn = pgn.trim();
    if (!normalizedPgn) {
        throw new Error("Choose a PGN file or paste PGN text first.");
    }

    const normalizedName = name?.trim() || "Pasted game";
    return {
        name: /\.pgn$/i.test(normalizedName) ? normalizedName : `${normalizedName}.pgn`,
        pgn: normalizedPgn,
    };
}

export async function readWebPgnImportFile(
    file: Pick<File, "name" | "text">,
): Promise<WebPgnImportRequest> {
    return createWebPgnImportRequest({
        name: file.name,
        pgn: await file.text(),
    });
}
