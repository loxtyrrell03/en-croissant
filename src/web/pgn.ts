import { isNormal, makeUci, parseUci, type Move } from "chessops";
import type { Position } from "chessops/chess";
import { normalizeMove } from "chessops/chess";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import {
    makePgn,
    parseComment,
    parsePgn,
    startingPosition,
    type ChildNode,
    type PgnNodeData,
} from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";
import type {
    WebColor,
    WebDatabase,
    WebGame,
    WebImportResult,
    WebMove,
    WebPrepLineMove,
    WebResult,
} from "./model";

const MAX_PLAYER_NAMES = 80;

export function normalizeWebFen(fen: string) {
    return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function oppositeWebColor(color: WebColor): WebColor {
    return color === "white" ? "black" : "white";
}

export function getFenColor(fen: string): WebColor {
    return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

export function getResultScore(result: WebResult, side: WebColor) {
    if (result === "1/2-1/2" || result === "*") return 0.5;
    if (result === "1-0") return side === "white" ? 1 : 0;
    return side === "black" ? 1 : 0;
}

export function formatWebDate(value: string | null | undefined) {
    if (!value) return "";
    return value.replace(/\?/g, "").replace(/\.$/, "");
}

export function parsePgnDatabase(
    name: string,
    pgn: string,
    importedAt = Date.now(),
): WebImportResult {
    const id = createDatabaseId(name, importedAt);
    const parsedGames = parsePgn(pgn);
    const warnings: string[] = [];
    const games: WebGame[] = [];
    const players = new Map<string, number>();
    let latestDate: string | null = null;

    parsedGames.forEach((game, index) => {
        let position;
        try {
            position = startingPosition(game.headers).unwrap();
        } catch {
            warnings.push(`Game ${index + 1}: could not read starting position.`);
            return;
        }

        const moves = buildWebMoveLine({
            firstChild: game.moves.children[0],
            position,
            previousPly: 0,
            gameIndex: index,
            warnings,
        });
        const rootVariations = buildWebVariationLines({
            children: game.moves.children.slice(1),
            position,
            previousPly: 0,
            gameIndex: index,
            warnings,
        });

        const result = normalizeResult(game.headers.get("Result"));
        const date = game.headers.get("Date") ?? game.headers.get("UTCDate") ?? "";
        latestDate = pickLatestDate(latestDate, date);

        const white = game.headers.get("White") ?? "?";
        const black = game.headers.get("Black") ?? "?";
        countPlayer(players, white);
        countPlayer(players, black);

        const webGame: WebGame = {
            id: `${id}:${index + 1}`,
            databaseId: id,
            databaseName: name,
            index: index + 1,
            event: game.headers.get("Event") ?? "?",
            site: game.headers.get("Site") ?? "",
            date,
            white,
            black,
            whiteElo: parseRating(game.headers.get("WhiteElo")),
            blackElo: parseRating(game.headers.get("BlackElo")),
            result,
            timeControl: game.headers.get("TimeControl"),
            whiteTimeControl: game.headers.get("WhiteTimeControl"),
            blackTimeControl: game.headers.get("BlackTimeControl"),
            startedAtSeconds: parseWebPgnStartSeconds(game.headers),
            pgn: makePgn(game),
            moves,
            importedAt,
        };
        if (rootVariations.length > 0) webGame.rootVariations = rootVariations;
        const comments = formatWebComments(game.comments);
        if (comments.length > 0) webGame.comments = comments;

        games.push(webGame);
    });

    const database: WebDatabase = {
        id,
        name,
        importedAt,
        updatedAt: importedAt,
        gameCount: games.length,
        sizeBytes: new Blob([pgn]).size,
        latestDate,
        playerNames: Array.from(players.entries())
            .sort(
                (a, b) =>
                    b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
            )
            .slice(0, MAX_PLAYER_NAMES)
            .map(([player]) => player),
    };

    return { database, games, warnings };
}

export function playSanMove(fen: string, san: string) {
    const [position] = positionFromFen(fen);
    if (!position) return null;

    const move = parseSan(position, san);
    if (!move) return null;

    const normalizedSan = makeSan(position, move);
    const uci = makeMoveUci(position, move);
    position.play(move);

    return {
        san: normalizedSan,
        uci,
        fenAfter: makeFen(position.toSetup()),
    };
}

export function playUciMove(fen: string, uci: string) {
    const [position] = positionFromFen(fen);
    if (!position) return null;

    const move = parseUci(uci);
    if (!move) return null;

    const san = makeSan(position, move);
    const normalizedUci = makeMoveUci(position, move);
    position.play(move);

    return {
        san,
        uci: normalizedUci,
        fenAfter: makeFen(position.toSetup()),
    };
}

export function currentWebFen(line: { fenAfter: string }[], startFen = INITIAL_FEN) {
    return line.at(-1)?.fenAfter ?? startFen;
}

export function webGameToLine(game: WebGame): WebPrepLineMove[] {
    return webMovesToLine(getReplayHydratedWebMoves(game));
}

export function webGameToRootLines(game: WebGame): WebPrepLineMove[][] {
    return [webGameToLine(game), ...webMoveVariationLinesToPrepLines(game.rootVariations ?? [])];
}

export function getWebGameReplayTiming(game: WebGame) {
    if (
        game.timeControl !== undefined ||
        game.whiteTimeControl !== undefined ||
        game.blackTimeControl !== undefined ||
        game.startedAtSeconds !== undefined
    ) {
        return {
            timeControl: game.timeControl,
            whiteTimeControl: game.whiteTimeControl,
            blackTimeControl: game.blackTimeControl,
            startedAtSeconds: game.startedAtSeconds,
        };
    }

    const parsed = parsePgn(game.pgn)[0];
    return {
        timeControl: parsed?.headers.get("TimeControl"),
        whiteTimeControl: parsed?.headers.get("WhiteTimeControl"),
        blackTimeControl: parsed?.headers.get("BlackTimeControl"),
        startedAtSeconds: parsed ? parseWebPgnStartSeconds(parsed.headers) : null,
    };
}

export function getWebGameIndexedMoves(game: WebGame) {
    const moves: WebMove[] = [];
    collectWebMoves(game.moves, moves);
    for (const variation of game.rootVariations ?? []) {
        collectWebMoves(variation, moves);
    }
    return moves;
}

export function countWebGameVariationMoves(game: WebGame) {
    let count = 0;
    for (const move of game.moves) {
        count += countWebMoveVariations(move);
    }
    for (const variation of game.rootVariations ?? []) {
        count += countWebMoveLine(variation);
    }
    return count;
}

function createDatabaseId(name: string, importedAt: number) {
    const slug = name
        .toLowerCase()
        .replace(/\.[^.]+$/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);

    return `${slug || "pgn"}-${importedAt.toString(36)}`;
}

function makeMoveUci(position: Parameters<typeof normalizeMove>[0], move: Move) {
    const normalized = normalizeMove(position, move);
    return isNormal(normalized) ? makeUci(normalized) : null;
}

function buildWebMoveLine({
    firstChild,
    position,
    previousPly,
    gameIndex,
    warnings,
}: {
    firstChild: ChildNode<PgnNodeData> | undefined;
    position: Position;
    previousPly: number;
    gameIndex: number;
    warnings: string[];
}) {
    const line: WebMove[] = [];
    let currentChild = firstChild;
    let currentPosition = position.clone();
    let currentPly = previousPly;

    while (currentChild) {
        const parsed = buildWebMove({
            child: currentChild,
            position: currentPosition,
            previousPly: currentPly,
            gameIndex,
            warnings,
        });
        if (!parsed) break;

        line.push(parsed.move);
        currentPosition = parsed.positionAfter;
        currentPly = parsed.move.ply;
        currentChild = currentChild.children[0];
    }

    return line;
}

function buildWebMove({
    child,
    position,
    previousPly,
    gameIndex,
    warnings,
}: {
    child: ChildNode<PgnNodeData>;
    position: Position;
    previousPly: number;
    gameIndex: number;
    warnings: string[];
}) {
    const fenBefore = makeFen(position.toSetup());
    const parsedMove = parseSan(position, child.data.san);
    if (!parsedMove) {
        warnings.push(`Game ${gameIndex + 1}: stopped at illegal move ${child.data.san}.`);
        return null;
    }

    const san = makeSan(position, parsedMove);
    const uci = makeMoveUci(position, parsedMove);
    const positionAfter = position.clone();
    positionAfter.play(parsedMove);
    const ply = previousPly + 1;
    const webMove: WebMove = {
        ply,
        color: ply % 2 === 1 ? "white" : "black",
        san,
        uci,
        fenBefore,
        fenAfter: makeFen(positionAfter.toSetup()),
    };
    const clockSeconds = findLastWebCommentValue(child.data.comments, (comment) => {
        return parseComment(comment).clock;
    });
    const timestampSeconds = findLastWebCommentValue(
        child.data.comments,
        parseWebPgnTimestampSeconds,
    );
    const annotations = formatWebNags(child.data.nags);
    const startingComments = formatWebComments(child.data.startingComments);
    const comments = formatWebComments(child.data.comments);
    const variations = buildWebVariationLines({
        children: child.children.slice(1),
        position: positionAfter,
        previousPly: ply,
        gameIndex,
        warnings,
    });

    if (clockSeconds !== undefined) webMove.clockSeconds = clockSeconds;
    if (timestampSeconds !== undefined) webMove.timestampSeconds = timestampSeconds;
    if (annotations.length > 0) webMove.annotations = annotations;
    if (startingComments.length > 0) webMove.startingComments = startingComments;
    if (comments.length > 0) webMove.comments = comments;
    if (variations.length > 0) webMove.variations = variations;

    return {
        move: webMove,
        positionAfter,
    };
}

function buildWebVariationLines({
    children,
    position,
    previousPly,
    gameIndex,
    warnings,
}: {
    children: ChildNode<PgnNodeData>[];
    position: Position;
    previousPly: number;
    gameIndex: number;
    warnings: string[];
}) {
    return children
        .map((child) =>
            buildWebMoveLine({
                firstChild: child,
                position,
                previousPly,
                gameIndex,
                warnings,
            }),
        )
        .filter((line) => line.length > 0);
}

function webMovesToLine(moves: WebMove[]): WebPrepLineMove[] {
    return moves.map(webMoveToLineMove);
}

function webMoveToLineMove(move: WebMove): WebPrepLineMove {
    const lineMove: WebPrepLineMove = {
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        san: move.san,
        uci: move.uci,
        actor: move.color === "white" ? "user" : "opponent",
        clockSeconds: move.clockSeconds,
        timestampSeconds: move.timestampSeconds,
        annotations: move.annotations,
        comments: move.comments,
        startingComments: move.startingComments,
    };
    const variations = webMoveVariationLinesToPrepLines(move.variations ?? []);
    if (variations.length > 0) lineMove.variations = variations;
    return lineMove;
}

function webMoveVariationLinesToPrepLines(variations: WebMove[][]) {
    return variations.map(webMovesToLine).filter((line) => line.length > 0);
}

function collectWebMoves(line: WebMove[], moves: WebMove[]) {
    for (const move of line) {
        moves.push(move);
        for (const variation of move.variations ?? []) {
            collectWebMoves(variation, moves);
        }
    }
}

function countWebMoveLine(line: WebMove[]): number {
    return line.reduce((sum, move) => sum + 1 + countWebMoveVariations(move), 0);
}

function countWebMoveVariations(move: WebMove): number {
    return (move.variations ?? []).reduce((sum, variation) => sum + countWebMoveLine(variation), 0);
}

function normalizeResult(value: string | null | undefined): WebResult {
    return value === "1-0" || value === "0-1" || value === "1/2-1/2" ? value : "*";
}

function parseRating(value: string | null | undefined) {
    if (!value || value === "-") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function countPlayer(players: Map<string, number>, name: string) {
    const normalized = name.trim();
    if (!normalized || normalized === "?") return;
    players.set(normalized, (players.get(normalized) ?? 0) + 1);
}

function pickLatestDate(current: string | null, candidate: string) {
    const candidateKey = sortableDate(candidate);
    if (!candidateKey) return current;
    const currentKey = sortableDate(current ?? "");
    return !currentKey || candidateKey > currentKey ? candidate : current;
}

function sortableDate(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}

function formatWebNags(nags: readonly number[] | undefined) {
    return [...new Set((nags ?? []).map(formatWebNag))];
}

function formatWebNag(nag: number) {
    switch (nag) {
        case 1:
            return "!";
        case 2:
            return "?";
        case 3:
            return "!!";
        case 4:
            return "??";
        case 5:
            return "!?";
        case 6:
            return "?!";
        default:
            return `$${nag}`;
    }
}

function formatWebComments(comments: readonly string[] | undefined) {
    return (comments ?? []).map(formatWebComment).filter((comment) => comment.length > 0);
}

function formatWebComment(comment: string) {
    return parseComment(comment)
        .text.replace(/\s?\[%timestamp\s+\d+(?:\.\d+)?\]\s?/gi, " ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function getReplayHydratedWebMoves(game: WebGame) {
    if (
        game.moves.some(
            (move) =>
                typeof move.clockSeconds === "number" || typeof move.timestampSeconds === "number",
        ) ||
        !/\[%(?:clk|timestamp)\s/i.test(game.pgn)
    ) {
        return game.moves;
    }

    const parsed = parsePgn(game.pgn)[0];
    if (!parsed) return game.moves;

    try {
        return buildWebMoveLine({
            firstChild: parsed.moves.children[0],
            position: startingPosition(parsed.headers).unwrap(),
            previousPly: 0,
            gameIndex: 0,
            warnings: [],
        });
    } catch {
        return game.moves;
    }
}

function findLastWebCommentValue(
    comments: readonly string[] | undefined,
    readValue: (comment: string) => number | undefined,
) {
    for (let index = (comments?.length ?? 0) - 1; index >= 0; index -= 1) {
        const value = readValue(comments?.[index] ?? "");
        if (value !== undefined) return value;
    }
    return undefined;
}

function parseWebPgnTimestampSeconds(comment: string) {
    const match = comment.match(/\[%timestamp\s+(\d+(?:\.\d+)?)\]/i);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : undefined;
}

function parseWebPgnStartSeconds(headers: Map<string, string>) {
    const date = headers.get("UTCDate") ?? headers.get("Date");
    const time = headers.get("UTCTime") ?? headers.get("Time");
    if (!date || !time) return null;

    const dateMatch = date.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!dateMatch || !timeMatch) return null;

    const timestamp = Date.UTC(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
        Number(timeMatch[3] ?? "0"),
    );
    return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}
