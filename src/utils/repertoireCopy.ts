import { resolve, tempDir } from "@tauri-apps/api/path";
import { exists, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { INITIAL_FEN } from "chessops/fen";
import { commands, type NormalizedGame } from "@/bindings";
import { parsePGN } from "@/utils/chess";
import { getDatabasesDir } from "@/utils/directories";
import { type TreeNode } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

type RepertoirePlayer = {
    id?: number | null;
    name: string;
};

type RepertoireDatabaseResult = {
    path: string;
    title: string;
    positions: number;
};

type RepertoireGameBatchSource = AsyncIterable<NormalizedGame[]> | Iterable<NormalizedGame[]>;

const RESULT_PATTERN = /\s(?:1-0|0-1|1\/2-1\/2|\*)\s*$/;
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;
const RESERVED_WINDOWS_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export async function createRepertoireDatabaseFromGames(
    games: NormalizedGame[],
    player: RepertoirePlayer,
    title = `${player.name} repertoire`,
): Promise<RepertoireDatabaseResult> {
    return createRepertoireDatabaseFromGameBatches([games], player, title);
}

export async function createRepertoireDatabaseFromGameBatches(
    gameBatches: RepertoireGameBatchSource,
    player: RepertoirePlayer,
    title = `${player.name} repertoire`,
): Promise<RepertoireDatabaseResult> {
    const databasesDir = await getDatabasesDir();
    const database = await getAvailableNamedPath(databasesDir, title, ".db3");
    const tempPgn = await resolve(
        await tempDir(),
        `${sanitizeFileSegment(database.title)}-${Date.now()}.pgn`,
    );

    let sourceGames = 0;
    let positions = 0;

    await writeTextFile(tempPgn, "");
    try {
        for await (const games of gameBatches) {
            sourceGames += games.length;
            const repertoirePgns = await buildRepertoirePgns(games, player);
            if (repertoirePgns.length === 0) continue;

            await writeTextFile(tempPgn, `${repertoirePgns.join("\n\n")}\n\n`, {
                append: true,
            });
            positions += repertoirePgns.length;
        }

        if (positions === 0) {
            throw new Error(`No ${player.name} repertoire moves were found in these games.`);
        }

        unwrap(
            await commands.convertPgn(
                tempPgn,
                database.path,
                null,
                database.title,
                `Copied ${player.name} repertoire responses from ${sourceGames} source game${
                    sourceGames === 1 ? "" : "s"
                }.`,
            ),
        );
    } finally {
        try {
            await remove(tempPgn);
        } catch {
            // Temporary PGN used only as the converter input.
        }
    }

    return {
        ...database,
        positions,
    };
}

async function buildRepertoirePgns(games: NormalizedGame[], player: RepertoirePlayer) {
    const pgns: string[] = [];

    for (const game of games) {
        const color = getPlayerColor(game, player);
        if (!color) continue;

        const tree = await parsePGN(gameToPgn(game));
        let parent = tree.root;
        let child = parent.children[0];

        while (child) {
            const moveColor = child.halfMoves % 2 === 1 ? "white" : "black";
            if (moveColor === color && child.san) {
                pgns.push(repertoireMoveToPgn(game, player.name, color, parent, child));
            }

            parent = child;
            child = parent.children[0];
        }
    }

    return pgns;
}

function repertoireMoveToPgn(
    game: NormalizedGame,
    playerName: string,
    color: "white" | "black",
    parent: TreeNode,
    child: TreeNode,
) {
    const opponent = color === "white" ? game.black : game.white;
    const result = game.result || "*";
    const tags: [string, string | number | null | undefined][] = [
        ["Event", `${playerName} repertoire response`],
        ["Site", game.site || "?"],
        ["Date", game.date || "????.??.??"],
        ["Round", game.round || "?"],
        ["White", color === "white" ? playerName : opponent || "?"],
        ["Black", color === "black" ? playerName : opponent || "?"],
        ["Result", result],
        ["SetUp", "1"],
        ["FEN", parent.fen],
        ["RepertoirePlayer", playerName],
        ["RepertoireColor", color],
        ["SourceGameId", game.id],
        ["SourceWhite", game.white],
        ["SourceBlack", game.black],
        ["SourceResult", game.result],
        ["SourceDate", game.date],
        ["SourceEvent", game.event],
    ];
    const header = tags
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([name, value]) => `[${name} "${escapeTagValue(String(value))}"]`)
        .join("\n");

    return `${header}\n\n${repertoireLineMoveText(parent, child)} ${result}`;
}

export function repertoireLineMoveText(parent: TreeNode, child: TreeNode) {
    const moves = [singleMoveText(parent.halfMoves, child.san!)];
    const reply = child.children[0];

    if (reply?.san) {
        moves.push(replyMoveText(child.halfMoves, reply.san));
    }

    return moves.join(" ");
}

function replyMoveText(halfMovesBeforeMove: number, san: string) {
    return halfMovesBeforeMove % 2 === 1 ? san : singleMoveText(halfMovesBeforeMove, san);
}

function singleMoveText(halfMovesBeforeMove: number, san: string) {
    const moveNumber = Math.floor(halfMovesBeforeMove / 2) + 1;
    return halfMovesBeforeMove % 2 === 0 ? `${moveNumber}. ${san}` : `${moveNumber}... ${san}`;
}

function getPlayerColor(game: NormalizedGame, player: RepertoirePlayer) {
    if (player.id !== null && player.id !== undefined) {
        if (game.white_id === player.id) return "white";
        if (game.black_id === player.id) return "black";
    }

    const playerName = normalizePlayerName(player.name);
    if (normalizePlayerName(game.white) === playerName) return "white";
    if (normalizePlayerName(game.black) === playerName) return "black";
    return null;
}

function gameToPgn(game: NormalizedGame) {
    const raw = game.moves.trim();
    if (raw.startsWith("[")) return raw;

    const result = game.result || "*";
    const tags: [string, string | number | null | undefined][] = [
        ["Event", game.event || "?"],
        ["Site", game.site || "?"],
        ["Date", game.date || "????.??.??"],
        ["Round", game.round || "?"],
        ["White", game.white || "?"],
        ["Black", game.black || "?"],
        ["Result", result],
        ["WhiteElo", game.white_elo],
        ["BlackElo", game.black_elo],
        ["ECO", game.eco],
        ["TimeControl", game.time_control],
        ["PlyCount", game.ply_count],
    ];

    if (game.fen && game.fen !== INITIAL_FEN) {
        tags.push(["SetUp", "1"], ["FEN", game.fen]);
    }

    const header = tags
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([name, value]) => `[${name} "${escapeTagValue(String(value))}"]`)
        .join("\n");
    const movetext = RESULT_PATTERN.test(raw) ? raw : `${raw} ${result}`.trim();

    return `${header}\n\n${movetext}`;
}

async function getAvailableNamedPath(dir: string, basename: string, extension: string) {
    const base = removeExtension(sanitizeFileSegment(basename), extension) || "repertoire";
    for (let index = 0; index < 1000; index++) {
        const suffix = index === 0 ? "" : ` ${index + 1}`;
        const title = `${base}${suffix}`;
        const candidate = await resolve(dir, `${title}${extension}`);
        if (!(await exists(candidate))) {
            return { path: candidate, title };
        }
    }
    throw new Error("Could not find an available repertoire database name");
}

function sanitizeFileSegment(value: string) {
    const clean = value
        .replace(INVALID_FILENAME_CHARS, " ")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "")
        .trim();
    if (!clean) return "";
    return RESERVED_WINDOWS_FILENAME.test(clean) ? `${clean}_` : clean;
}

function removeExtension(value: string, extension: string) {
    return value.toLowerCase().endsWith(extension) ? value.slice(0, -extension.length) : value;
}

function normalizePlayerName(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function escapeTagValue(value: string) {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
