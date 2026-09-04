import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { constants, setPriority } from "node:os";
import { DatabaseSync } from "node:sqlite";
Object.create;
Object.defineProperty;
Object.getOwnPropertyDescriptor;
Object.getOwnPropertyNames;
Object.getPrototypeOf;
Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
//#region src/web/onlineImport.ts
var CHESSCOM_ARCHIVES_URL = "https://api.chess.com/pub/player";
var LICHESS_GAMES_URL = "https://lichess.org/api/games/user";
async function fetchWebOnlineGamesSince(request) {
	return request.source === "chesscom" ? fetchChessComGames(request.username, Infinity, request.since, void 0, request.signal, true) : fetchLichessGames(request.username, Infinity, request.since, void 0, request.signal);
}
async function fetchChessComGames(username, limit, since, onProgress, signal, strict = false) {
	const archivesResponse = await fetch(`${CHESSCOM_ARCHIVES_URL}/${encodeURIComponent(username.toLowerCase())}/games/archives`, { signal });
	if (!archivesResponse.ok) throw new Error(`Chess.com did not return archives for ${username}.`);
	const archives = ((await archivesResponse.json()).archives ?? []).filter((archive) => !since || chessComArchiveIsInRange(archive, since)).slice().reverse();
	const games = [];
	for (const [index, archive] of archives.entries()) {
		const response = await fetch(`${archive}/pgn`, { signal });
		if (!response.ok) {
			if (strict) throw new Error(`Chess.com archive fetch failed (HTTP ${response.status}); catch-up will retry.`);
			continue;
		}
		const pgnChunk = await response.text();
		for (const pgn of splitPgnGames(pgnChunk)) games.push({
			source: "chesscom",
			username,
			pgn,
			playedAt: getPgnTimestamp(pgn),
			url: getPgnHeader(pgn, "Link") ?? `https://www.chess.com/member/${username}`
		});
		games.sort((a, b) => b.playedAt - a.playedAt);
		onProgress?.(since ? index + 1 : Math.min(games.length, limit), since ? archives.length : limit);
		if (games.length >= limit) break;
		if (since && index === archives.length - 1) break;
	}
	return games.filter((game) => !since || game.playedAt >= since).sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
}
async function fetchLichessGames(username, limit, since, onProgress, signal) {
	const url = new URL(`${LICHESS_GAMES_URL}/${encodeURIComponent(username)}`);
	if (Number.isFinite(limit)) url.searchParams.set("max", String(limit));
	url.searchParams.set("ongoing", "false");
	url.searchParams.set("sort", "dateDesc");
	url.searchParams.set("pgnInJson", "true");
	url.searchParams.set("clocks", "true");
	url.searchParams.set("evals", "true");
	url.searchParams.set("accuracy", "true");
	url.searchParams.set("perfType", "ultraBullet,bullet,blitz,rapid,classical,correspondence");
	if (since) url.searchParams.set("since", String(since));
	const response = await fetch(url.toString(), {
		signal,
		headers: { Accept: "application/x-ndjson" }
	});
	if (!response.ok) throw new Error(`Lichess did not return public games for ${username}.`);
	const games = (await response.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
		try {
			return JSON.parse(line);
		} catch {
			return null;
		}
	}).filter((game) => Boolean(game?.pgn?.trim())).map((game) => ({
		source: "lichess",
		username,
		pgn: game.pgn.trim(),
		playedAt: game.lastMoveAt ?? game.createdAt ?? getPgnTimestamp(game.pgn),
		url: game.id ? `https://lichess.org/${game.id.slice(0, 8)}` : `https://lichess.org/@/${username}`
	})).filter((game) => !since || game.playedAt >= since).sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
	onProgress?.(games.length, limit);
	return games;
}
function chessComArchiveIsInRange(archive, since) {
	const [year, month] = archive.split("/").slice(-2).map((part) => Number.parseInt(part, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
	const archiveDate = new Date(year, month - 1, 1).getTime();
	const sinceDate = new Date(since);
	return archiveDate >= new Date(sinceDate.getFullYear(), sinceDate.getMonth(), 1).getTime();
}
function splitPgnGames(pgn) {
	return pgn.split(/\n(?=\[Event\s)/g).map((game) => game.trim()).filter(Boolean);
}
function getPgnTimestamp(pgn) {
	const utcDate = getPgnHeader(pgn, "EndDate") ?? getPgnHeader(pgn, "UTCDate") ?? getPgnHeader(pgn, "Date");
	const utcTime = getPgnHeader(pgn, "EndTime") ?? getPgnHeader(pgn, "UTCTime") ?? "00:00:00";
	if (!utcDate) return 0;
	const normalizedDate = utcDate.replace(/\./g, "-").replace(/\?/g, "0");
	const timestamp = Date.parse(`${normalizedDate}T${utcTime.replace(/\?/g, "0")}Z`);
	return Number.isFinite(timestamp) ? timestamp : 0;
}
function getPgnHeader(pgn, name) {
	return pgn.match(new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, "m"))?.[1] ?? null;
}
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/types.js
var FILE_NAMES = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h"
];
var RANK_NAMES = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8"
];
var COLORS = ["white", "black"];
var ROLES = [
	"pawn",
	"knight",
	"bishop",
	"rook",
	"queen",
	"king"
];
var CASTLING_SIDES = ["a", "h"];
var isDrop = (v) => "role" in v;
var isNormal = (v) => "from" in v;
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/util.js
var defined = (v) => v !== void 0;
var opposite = (color) => color === "white" ? "black" : "white";
var squareRank = (square) => square >> 3;
var squareFile = (square) => square & 7;
var squareFromCoords = (file, rank) => 0 <= file && file < 8 && 0 <= rank && rank < 8 ? file + 8 * rank : void 0;
var roleToChar = (role) => {
	switch (role) {
		case "pawn": return "p";
		case "knight": return "n";
		case "bishop": return "b";
		case "rook": return "r";
		case "queen": return "q";
		case "king": return "k";
	}
};
function charToRole(ch) {
	switch (ch.toLowerCase()) {
		case "p": return "pawn";
		case "n": return "knight";
		case "b": return "bishop";
		case "r": return "rook";
		case "q": return "queen";
		case "k": return "king";
		default: return;
	}
}
function parseSquare(str) {
	if (str.length !== 2) return;
	return squareFromCoords(str.charCodeAt(0) - "a".charCodeAt(0), str.charCodeAt(1) - "1".charCodeAt(0));
}
var makeSquare = (square) => FILE_NAMES[squareFile(square)] + RANK_NAMES[squareRank(square)];
var parseUci = (str) => {
	if (str[1] === "@" && str.length === 4) {
		const role = charToRole(str[0]);
		const to = parseSquare(str.slice(2));
		if (role && defined(to)) return {
			role,
			to
		};
	} else if (str.length === 4 || str.length === 5) {
		const from = parseSquare(str.slice(0, 2));
		const to = parseSquare(str.slice(2, 4));
		let promotion;
		if (str.length === 5) {
			promotion = charToRole(str[4]);
			if (!promotion) return;
		}
		if (defined(from) && defined(to)) return {
			from,
			to,
			promotion
		};
	}
};
/**
* Converts a move to UCI notation, like `g1f3` for a normal move,
* `a7a8q` for promotion to a queen, and `Q@f7` for a Crazyhouse drop.
*/
var makeUci = (move) => isDrop(move) ? `${roleToChar(move.role).toUpperCase()}@${makeSquare(move.to)}` : makeSquare(move.from) + makeSquare(move.to) + (move.promotion ? roleToChar(move.promotion) : "");
var kingCastlesTo = (color, side) => color === "white" ? side === "a" ? 2 : 6 : side === "a" ? 58 : 62;
var rookCastlesTo = (color, side) => color === "white" ? side === "a" ? 3 : 5 : side === "a" ? 59 : 61;
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/squareSet.js
var popcnt32 = (n) => {
	n = n - (n >>> 1 & 1431655765);
	n = (n & 858993459) + (n >>> 2 & 858993459);
	return Math.imul(n + (n >>> 4) & 252645135, 16843009) >> 24;
};
var bswap32 = (n) => {
	n = n >>> 8 & 16711935 | (n & 16711935) << 8;
	return n >>> 16 & 65535 | (n & 65535) << 16;
};
var rbit32 = (n) => {
	n = n >>> 1 & 1431655765 | (n & 1431655765) << 1;
	n = n >>> 2 & 858993459 | (n & 858993459) << 2;
	n = n >>> 4 & 252645135 | (n & 252645135) << 4;
	return bswap32(n);
};
/**
* An immutable set of squares, implemented as a bitboard.
*/
var SquareSet = class SquareSet {
	constructor(lo, hi) {
		this.lo = lo | 0;
		this.hi = hi | 0;
	}
	static fromSquare(square) {
		return square >= 32 ? new SquareSet(0, 1 << square - 32) : new SquareSet(1 << square, 0);
	}
	static fromRank(rank) {
		return new SquareSet(255, 0).shl64(8 * rank);
	}
	static fromFile(file) {
		return new SquareSet(16843009 << file, 16843009 << file);
	}
	static empty() {
		return new SquareSet(0, 0);
	}
	static full() {
		return new SquareSet(4294967295, 4294967295);
	}
	static corners() {
		return new SquareSet(129, 2164260864);
	}
	static center() {
		return new SquareSet(402653184, 24);
	}
	static backranks() {
		return new SquareSet(255, 4278190080);
	}
	static backrank(color) {
		return color === "white" ? new SquareSet(255, 0) : new SquareSet(0, 4278190080);
	}
	static lightSquares() {
		return new SquareSet(1437226410, 1437226410);
	}
	static darkSquares() {
		return new SquareSet(2857740885, 2857740885);
	}
	complement() {
		return new SquareSet(~this.lo, ~this.hi);
	}
	xor(other) {
		return new SquareSet(this.lo ^ other.lo, this.hi ^ other.hi);
	}
	union(other) {
		return new SquareSet(this.lo | other.lo, this.hi | other.hi);
	}
	intersect(other) {
		return new SquareSet(this.lo & other.lo, this.hi & other.hi);
	}
	diff(other) {
		return new SquareSet(this.lo & ~other.lo, this.hi & ~other.hi);
	}
	intersects(other) {
		return this.intersect(other).nonEmpty();
	}
	isDisjoint(other) {
		return this.intersect(other).isEmpty();
	}
	supersetOf(other) {
		return other.diff(this).isEmpty();
	}
	subsetOf(other) {
		return this.diff(other).isEmpty();
	}
	shr64(shift) {
		if (shift >= 64) return SquareSet.empty();
		if (shift >= 32) return new SquareSet(this.hi >>> shift - 32, 0);
		if (shift > 0) return new SquareSet(this.lo >>> shift ^ this.hi << 32 - shift, this.hi >>> shift);
		return this;
	}
	shl64(shift) {
		if (shift >= 64) return SquareSet.empty();
		if (shift >= 32) return new SquareSet(0, this.lo << shift - 32);
		if (shift > 0) return new SquareSet(this.lo << shift, this.hi << shift ^ this.lo >>> 32 - shift);
		return this;
	}
	bswap64() {
		return new SquareSet(bswap32(this.hi), bswap32(this.lo));
	}
	rbit64() {
		return new SquareSet(rbit32(this.hi), rbit32(this.lo));
	}
	minus64(other) {
		const lo = this.lo - other.lo;
		const c = (lo & other.lo & 1) + (other.lo >>> 1) + (lo >>> 1) >>> 31;
		return new SquareSet(lo, this.hi - (other.hi + c));
	}
	equals(other) {
		return this.lo === other.lo && this.hi === other.hi;
	}
	size() {
		return popcnt32(this.lo) + popcnt32(this.hi);
	}
	isEmpty() {
		return this.lo === 0 && this.hi === 0;
	}
	nonEmpty() {
		return this.lo !== 0 || this.hi !== 0;
	}
	has(square) {
		return (square >= 32 ? this.hi & 1 << square - 32 : this.lo & 1 << square) !== 0;
	}
	set(square, on) {
		return on ? this.with(square) : this.without(square);
	}
	with(square) {
		return square >= 32 ? new SquareSet(this.lo, this.hi | 1 << square - 32) : new SquareSet(this.lo | 1 << square, this.hi);
	}
	without(square) {
		return square >= 32 ? new SquareSet(this.lo, this.hi & ~(1 << square - 32)) : new SquareSet(this.lo & ~(1 << square), this.hi);
	}
	toggle(square) {
		return square >= 32 ? new SquareSet(this.lo, this.hi ^ 1 << square - 32) : new SquareSet(this.lo ^ 1 << square, this.hi);
	}
	last() {
		if (this.hi !== 0) return 63 - Math.clz32(this.hi);
		if (this.lo !== 0) return 31 - Math.clz32(this.lo);
	}
	first() {
		if (this.lo !== 0) return 31 - Math.clz32(this.lo & -this.lo);
		if (this.hi !== 0) return 63 - Math.clz32(this.hi & -this.hi);
	}
	withoutFirst() {
		if (this.lo !== 0) return new SquareSet(this.lo & this.lo - 1, this.hi);
		return new SquareSet(0, this.hi & this.hi - 1);
	}
	moreThanOne() {
		return this.hi !== 0 && this.lo !== 0 || (this.lo & this.lo - 1) !== 0 || (this.hi & this.hi - 1) !== 0;
	}
	singleSquare() {
		return this.moreThanOne() ? void 0 : this.last();
	}
	*[Symbol.iterator]() {
		let lo = this.lo;
		let hi = this.hi;
		while (lo !== 0) {
			const idx = 31 - Math.clz32(lo & -lo);
			lo ^= 1 << idx;
			yield idx;
		}
		while (hi !== 0) {
			const idx = 31 - Math.clz32(hi & -hi);
			hi ^= 1 << idx;
			yield 32 + idx;
		}
	}
	*reversed() {
		let lo = this.lo;
		let hi = this.hi;
		while (hi !== 0) {
			const idx = 31 - Math.clz32(hi);
			hi ^= 1 << idx;
			yield 32 + idx;
		}
		while (lo !== 0) {
			const idx = 31 - Math.clz32(lo);
			lo ^= 1 << idx;
			yield idx;
		}
	}
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/attacks.js
/**
* Compute attacks and rays.
*
* These are low-level functions that can be used to implement chess rules.
*
* Implementation notes: Sliding attacks are computed using
* [Hyperbola Quintessence](https://www.chessprogramming.org/Hyperbola_Quintessence).
* Magic Bitboards would deliver slightly faster lookups, but also require
* initializing considerably larger attack tables. On the web, initialization
* time is important, so the chosen method may strike a better balance.
*
* @packageDocumentation
*/
var computeRange = (square, deltas) => {
	let range = SquareSet.empty();
	for (const delta of deltas) {
		const sq = square + delta;
		if (0 <= sq && sq < 64 && Math.abs(squareFile(square) - squareFile(sq)) <= 2) range = range.with(sq);
	}
	return range;
};
var tabulate = (f) => {
	const table = [];
	for (let square = 0; square < 64; square++) table[square] = f(square);
	return table;
};
var KING_ATTACKS = tabulate((sq) => computeRange(sq, [
	-9,
	-8,
	-7,
	-1,
	1,
	7,
	8,
	9
]));
var KNIGHT_ATTACKS = tabulate((sq) => computeRange(sq, [
	-17,
	-15,
	-10,
	-6,
	6,
	10,
	15,
	17
]));
var PAWN_ATTACKS = {
	white: tabulate((sq) => computeRange(sq, [7, 9])),
	black: tabulate((sq) => computeRange(sq, [-7, -9]))
};
/**
* Gets squares attacked or defended by a king on `square`.
*/
var kingAttacks = (square) => KING_ATTACKS[square];
/**
* Gets squares attacked or defended by a knight on `square`.
*/
var knightAttacks = (square) => KNIGHT_ATTACKS[square];
/**
* Gets squares attacked or defended by a pawn of the given `color`
* on `square`.
*/
var pawnAttacks = (color, square) => PAWN_ATTACKS[color][square];
var FILE_RANGE = tabulate((sq) => SquareSet.fromFile(squareFile(sq)).without(sq));
var RANK_RANGE = tabulate((sq) => SquareSet.fromRank(squareRank(sq)).without(sq));
var DIAG_RANGE = tabulate((sq) => {
	const diag = new SquareSet(134480385, 2151686160);
	const shift = 8 * (squareRank(sq) - squareFile(sq));
	return (shift >= 0 ? diag.shl64(shift) : diag.shr64(-shift)).without(sq);
});
var ANTI_DIAG_RANGE = tabulate((sq) => {
	const diag = new SquareSet(270549120, 16909320);
	const shift = 8 * (squareRank(sq) + squareFile(sq) - 7);
	return (shift >= 0 ? diag.shl64(shift) : diag.shr64(-shift)).without(sq);
});
var hyperbola = (bit, range, occupied) => {
	let forward = occupied.intersect(range);
	let reverse = forward.bswap64();
	forward = forward.minus64(bit);
	reverse = reverse.minus64(bit.bswap64());
	return forward.xor(reverse.bswap64()).intersect(range);
};
var fileAttacks = (square, occupied) => hyperbola(SquareSet.fromSquare(square), FILE_RANGE[square], occupied);
var rankAttacks = (square, occupied) => {
	const range = RANK_RANGE[square];
	let forward = occupied.intersect(range);
	let reverse = forward.rbit64();
	forward = forward.minus64(SquareSet.fromSquare(square));
	reverse = reverse.minus64(SquareSet.fromSquare(63 - square));
	return forward.xor(reverse.rbit64()).intersect(range);
};
/**
* Gets squares attacked or defended by a bishop on `square`, given `occupied`
* squares.
*/
var bishopAttacks = (square, occupied) => {
	const bit = SquareSet.fromSquare(square);
	return hyperbola(bit, DIAG_RANGE[square], occupied).xor(hyperbola(bit, ANTI_DIAG_RANGE[square], occupied));
};
/**
* Gets squares attacked or defended by a rook on `square`, given `occupied`
* squares.
*/
var rookAttacks = (square, occupied) => fileAttacks(square, occupied).xor(rankAttacks(square, occupied));
/**
* Gets squares attacked or defended by a queen on `square`, given `occupied`
* squares.
*/
var queenAttacks = (square, occupied) => bishopAttacks(square, occupied).xor(rookAttacks(square, occupied));
/**
* Gets squares attacked or defended by a `piece` on `square`, given
* `occupied` squares.
*/
var attacks = (piece, square, occupied) => {
	switch (piece.role) {
		case "pawn": return pawnAttacks(piece.color, square);
		case "knight": return knightAttacks(square);
		case "bishop": return bishopAttacks(square, occupied);
		case "rook": return rookAttacks(square, occupied);
		case "queen": return queenAttacks(square, occupied);
		case "king": return kingAttacks(square);
	}
};
/**
* Gets all squares of the rank, file or diagonal with the two squares
* `a` and `b`, or an empty set if they are not aligned.
*/
var ray = (a, b) => {
	const other = SquareSet.fromSquare(b);
	if (RANK_RANGE[a].intersects(other)) return RANK_RANGE[a].with(a);
	if (ANTI_DIAG_RANGE[a].intersects(other)) return ANTI_DIAG_RANGE[a].with(a);
	if (DIAG_RANGE[a].intersects(other)) return DIAG_RANGE[a].with(a);
	if (FILE_RANGE[a].intersects(other)) return FILE_RANGE[a].with(a);
	return SquareSet.empty();
};
/**
* Gets all squares between `a` and `b` (bounds not included), or an empty set
* if they are not on the same rank, file or diagonal.
*/
var between = (a, b) => ray(a, b).intersect(SquareSet.full().shl64(a).xor(SquareSet.full().shl64(b))).withoutFirst();
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/board.js
/**
* Piece positions on a board.
*
* Properties are sets of squares, like `board.occupied` for all occupied
* squares, `board[color]` for all pieces of that color, and `board[role]`
* for all pieces of that role. When modifying the properties directly, take
* care to keep them consistent.
*/
var Board = class Board {
	constructor() {}
	static default() {
		const board = new Board();
		board.reset();
		return board;
	}
	/**
	* Resets all pieces to the default starting position for standard chess.
	*/
	reset() {
		this.occupied = new SquareSet(65535, 4294901760);
		this.promoted = SquareSet.empty();
		this.white = new SquareSet(65535, 0);
		this.black = new SquareSet(0, 4294901760);
		this.pawn = new SquareSet(65280, 16711680);
		this.knight = new SquareSet(66, 1107296256);
		this.bishop = new SquareSet(36, 603979776);
		this.rook = new SquareSet(129, 2164260864);
		this.queen = new SquareSet(8, 134217728);
		this.king = new SquareSet(16, 268435456);
	}
	static empty() {
		const board = new Board();
		board.clear();
		return board;
	}
	clear() {
		this.occupied = SquareSet.empty();
		this.promoted = SquareSet.empty();
		for (const color of COLORS) this[color] = SquareSet.empty();
		for (const role of ROLES) this[role] = SquareSet.empty();
	}
	clone() {
		const board = new Board();
		board.occupied = this.occupied;
		board.promoted = this.promoted;
		for (const color of COLORS) board[color] = this[color];
		for (const role of ROLES) board[role] = this[role];
		return board;
	}
	getColor(square) {
		if (this.white.has(square)) return "white";
		if (this.black.has(square)) return "black";
	}
	getRole(square) {
		for (const role of ROLES) if (this[role].has(square)) return role;
	}
	get(square) {
		const color = this.getColor(square);
		if (!color) return;
		return {
			color,
			role: this.getRole(square),
			promoted: this.promoted.has(square)
		};
	}
	/**
	* Removes and returns the piece from the given `square`, if any.
	*/
	take(square) {
		const piece = this.get(square);
		if (piece) {
			this.occupied = this.occupied.without(square);
			this[piece.color] = this[piece.color].without(square);
			this[piece.role] = this[piece.role].without(square);
			if (piece.promoted) this.promoted = this.promoted.without(square);
		}
		return piece;
	}
	/**
	* Put `piece` onto `square`, potentially replacing an existing piece.
	* Returns the existing piece, if any.
	*/
	set(square, piece) {
		const old = this.take(square);
		this.occupied = this.occupied.with(square);
		this[piece.color] = this[piece.color].with(square);
		this[piece.role] = this[piece.role].with(square);
		if (piece.promoted) this.promoted = this.promoted.with(square);
		return old;
	}
	has(square) {
		return this.occupied.has(square);
	}
	*[Symbol.iterator]() {
		for (const square of this.occupied) yield [square, this.get(square)];
	}
	pieces(color, role) {
		return this[color].intersect(this[role]);
	}
	rooksAndQueens() {
		return this.rook.union(this.queen);
	}
	bishopsAndQueens() {
		return this.bishop.union(this.queen);
	}
	/**
	* Finds the unique king of the given `color`, if any.
	*/
	kingOf(color) {
		return this.pieces(color, "king").singleSquare();
	}
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/setup.js
var MaterialSide = class MaterialSide {
	constructor() {}
	static empty() {
		const m = new MaterialSide();
		for (const role of ROLES) m[role] = 0;
		return m;
	}
	static fromBoard(board, color) {
		const m = new MaterialSide();
		for (const role of ROLES) m[role] = board.pieces(color, role).size();
		return m;
	}
	clone() {
		const m = new MaterialSide();
		for (const role of ROLES) m[role] = this[role];
		return m;
	}
	equals(other) {
		return ROLES.every((role) => this[role] === other[role]);
	}
	add(other) {
		const m = new MaterialSide();
		for (const role of ROLES) m[role] = this[role] + other[role];
		return m;
	}
	subtract(other) {
		const m = new MaterialSide();
		for (const role of ROLES) m[role] = this[role] - other[role];
		return m;
	}
	nonEmpty() {
		return ROLES.some((role) => this[role] > 0);
	}
	isEmpty() {
		return !this.nonEmpty();
	}
	hasPawns() {
		return this.pawn > 0;
	}
	hasNonPawns() {
		return this.knight > 0 || this.bishop > 0 || this.rook > 0 || this.queen > 0 || this.king > 0;
	}
	size() {
		return this.pawn + this.knight + this.bishop + this.rook + this.queen + this.king;
	}
};
var Material = class Material {
	constructor(white, black) {
		this.white = white;
		this.black = black;
	}
	static empty() {
		return new Material(MaterialSide.empty(), MaterialSide.empty());
	}
	static fromBoard(board) {
		return new Material(MaterialSide.fromBoard(board, "white"), MaterialSide.fromBoard(board, "black"));
	}
	clone() {
		return new Material(this.white.clone(), this.black.clone());
	}
	equals(other) {
		return this.white.equals(other.white) && this.black.equals(other.black);
	}
	add(other) {
		return new Material(this.white.add(other.white), this.black.add(other.black));
	}
	subtract(other) {
		return new Material(this.white.subtract(other.white), this.black.subtract(other.black));
	}
	count(role) {
		return this.white[role] + this.black[role];
	}
	size() {
		return this.white.size() + this.black.size();
	}
	isEmpty() {
		return this.white.isEmpty() && this.black.isEmpty();
	}
	nonEmpty() {
		return !this.isEmpty();
	}
	hasPawns() {
		return this.white.hasPawns() || this.black.hasPawns();
	}
	hasNonPawns() {
		return this.white.hasNonPawns() || this.black.hasNonPawns();
	}
};
var RemainingChecks = class RemainingChecks {
	constructor(white, black) {
		this.white = white;
		this.black = black;
	}
	static default() {
		return new RemainingChecks(3, 3);
	}
	clone() {
		return new RemainingChecks(this.white, this.black);
	}
	equals(other) {
		return this.white === other.white && this.black === other.black;
	}
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/@badrap+result@0.2.13/node_modules/@badrap/result/dist/index.modern.mjs
var r$1 = class {
	unwrap(r, t) {
		const e = this._chain((t) => n$2.ok(r ? r(t) : t), (r) => t ? n$2.ok(t(r)) : n$2.err(r));
		if (e.isErr) throw e.error;
		return e.value;
	}
	map(r, t) {
		return this._chain((t) => n$2.ok(r(t)), (r) => n$2.err(t ? t(r) : r));
	}
	chain(r, t) {
		return this._chain(r, t || ((r) => n$2.err(r)));
	}
};
var t$1 = class extends r$1 {
	constructor(r) {
		super(), this.value = void 0, this.isOk = !0, this.isErr = !1, this.value = r;
	}
	_chain(r, t) {
		return r(this.value);
	}
};
var e$1 = class extends r$1 {
	constructor(r) {
		super(), this.error = void 0, this.isOk = !1, this.isErr = !0, this.error = r;
	}
	_chain(r, t) {
		return t(this.error);
	}
};
var n$2;
(function(r) {
	r.ok = function(r) {
		return new t$1(r);
	}, r.err = function(r) {
		return new e$1(r || /* @__PURE__ */ new Error());
	}, r.all = function(t) {
		if (Array.isArray(t)) {
			const e = [];
			for (let r = 0; r < t.length; r++) {
				const n = t[r];
				if (n.isErr) return n;
				e.push(n.value);
			}
			return r.ok(e);
		}
		const e = {}, n = Object.keys(t);
		for (let r = 0; r < n.length; r++) {
			const s = t[n[r]];
			if (s.isErr) return s;
			e[n[r]] = s.value;
		}
		return r.ok(e);
	};
})(n$2 || (n$2 = {}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/chess.js
var IllegalSetup;
(function(IllegalSetup) {
	IllegalSetup["Empty"] = "ERR_EMPTY";
	IllegalSetup["OppositeCheck"] = "ERR_OPPOSITE_CHECK";
	IllegalSetup["PawnsOnBackrank"] = "ERR_PAWNS_ON_BACKRANK";
	IllegalSetup["Kings"] = "ERR_KINGS";
	IllegalSetup["Variant"] = "ERR_VARIANT";
})(IllegalSetup || (IllegalSetup = {}));
var PositionError = class extends Error {};
var attacksTo = (square, attacker, board, occupied) => board[attacker].intersect(rookAttacks(square, occupied).intersect(board.rooksAndQueens()).union(bishopAttacks(square, occupied).intersect(board.bishopsAndQueens())).union(knightAttacks(square).intersect(board.knight)).union(kingAttacks(square).intersect(board.king)).union(pawnAttacks(opposite(attacker), square).intersect(board.pawn)));
var Castles = class Castles {
	constructor() {}
	static default() {
		const castles = new Castles();
		castles.castlingRights = SquareSet.corners();
		castles.rook = {
			white: {
				a: 0,
				h: 7
			},
			black: {
				a: 56,
				h: 63
			}
		};
		castles.path = {
			white: {
				a: new SquareSet(14, 0),
				h: new SquareSet(96, 0)
			},
			black: {
				a: new SquareSet(0, 234881024),
				h: new SquareSet(0, 1610612736)
			}
		};
		return castles;
	}
	static empty() {
		const castles = new Castles();
		castles.castlingRights = SquareSet.empty();
		castles.rook = {
			white: {
				a: void 0,
				h: void 0
			},
			black: {
				a: void 0,
				h: void 0
			}
		};
		castles.path = {
			white: {
				a: SquareSet.empty(),
				h: SquareSet.empty()
			},
			black: {
				a: SquareSet.empty(),
				h: SquareSet.empty()
			}
		};
		return castles;
	}
	clone() {
		const castles = new Castles();
		castles.castlingRights = this.castlingRights;
		castles.rook = {
			white: {
				a: this.rook.white.a,
				h: this.rook.white.h
			},
			black: {
				a: this.rook.black.a,
				h: this.rook.black.h
			}
		};
		castles.path = {
			white: {
				a: this.path.white.a,
				h: this.path.white.h
			},
			black: {
				a: this.path.black.a,
				h: this.path.black.h
			}
		};
		return castles;
	}
	add(color, side, king, rook) {
		const kingTo = kingCastlesTo(color, side);
		const rookTo = rookCastlesTo(color, side);
		this.castlingRights = this.castlingRights.with(rook);
		this.rook[color][side] = rook;
		this.path[color][side] = between(rook, rookTo).with(rookTo).union(between(king, kingTo).with(kingTo)).without(king).without(rook);
	}
	static fromSetup(setup) {
		const castles = Castles.empty();
		const rooks = setup.castlingRights.intersect(setup.board.rook);
		for (const color of COLORS) {
			const backrank = SquareSet.backrank(color);
			const king = setup.board.kingOf(color);
			if (!defined(king) || !backrank.has(king)) continue;
			const side = rooks.intersect(setup.board[color]).intersect(backrank);
			const aSide = side.first();
			if (defined(aSide) && aSide < king) castles.add(color, "a", king, aSide);
			const hSide = side.last();
			if (defined(hSide) && king < hSide) castles.add(color, "h", king, hSide);
		}
		return castles;
	}
	discardRook(square) {
		if (this.castlingRights.has(square)) {
			this.castlingRights = this.castlingRights.without(square);
			for (const color of COLORS) for (const side of CASTLING_SIDES) if (this.rook[color][side] === square) this.rook[color][side] = void 0;
		}
	}
	discardColor(color) {
		this.castlingRights = this.castlingRights.diff(SquareSet.backrank(color));
		this.rook[color].a = void 0;
		this.rook[color].h = void 0;
	}
};
var Position = class {
	constructor(rules) {
		this.rules = rules;
	}
	reset() {
		this.board = Board.default();
		this.pockets = void 0;
		this.turn = "white";
		this.castles = Castles.default();
		this.epSquare = void 0;
		this.remainingChecks = void 0;
		this.halfmoves = 0;
		this.fullmoves = 1;
	}
	setupUnchecked(setup) {
		this.board = setup.board.clone();
		this.board.promoted = SquareSet.empty();
		this.pockets = void 0;
		this.turn = setup.turn;
		this.castles = Castles.fromSetup(setup);
		this.epSquare = validEpSquare(this, setup.epSquare);
		this.remainingChecks = void 0;
		this.halfmoves = setup.halfmoves;
		this.fullmoves = setup.fullmoves;
	}
	kingAttackers(square, attacker, occupied) {
		return attacksTo(square, attacker, this.board, occupied);
	}
	playCaptureAt(square, captured) {
		this.halfmoves = 0;
		if (captured.role === "rook") this.castles.discardRook(square);
		if (this.pockets) this.pockets[opposite(captured.color)][captured.promoted ? "pawn" : captured.role]++;
	}
	ctx() {
		const variantEnd = this.isVariantEnd();
		const king = this.board.kingOf(this.turn);
		if (!defined(king)) return {
			king,
			blockers: SquareSet.empty(),
			checkers: SquareSet.empty(),
			variantEnd,
			mustCapture: false
		};
		const snipers = rookAttacks(king, SquareSet.empty()).intersect(this.board.rooksAndQueens()).union(bishopAttacks(king, SquareSet.empty()).intersect(this.board.bishopsAndQueens())).intersect(this.board[opposite(this.turn)]);
		let blockers = SquareSet.empty();
		for (const sniper of snipers) {
			const b = between(king, sniper).intersect(this.board.occupied);
			if (!b.moreThanOne()) blockers = blockers.union(b);
		}
		const checkers = this.kingAttackers(king, opposite(this.turn), this.board.occupied);
		return {
			king,
			blockers,
			checkers,
			variantEnd,
			mustCapture: false
		};
	}
	clone() {
		var _a, _b;
		const pos = new this.constructor();
		pos.board = this.board.clone();
		pos.pockets = (_a = this.pockets) === null || _a === void 0 ? void 0 : _a.clone();
		pos.turn = this.turn;
		pos.castles = this.castles.clone();
		pos.epSquare = this.epSquare;
		pos.remainingChecks = (_b = this.remainingChecks) === null || _b === void 0 ? void 0 : _b.clone();
		pos.halfmoves = this.halfmoves;
		pos.fullmoves = this.fullmoves;
		return pos;
	}
	validate() {
		if (this.board.occupied.isEmpty()) return n$2.err(new PositionError(IllegalSetup.Empty));
		if (this.board.king.size() !== 2) return n$2.err(new PositionError(IllegalSetup.Kings));
		if (!defined(this.board.kingOf(this.turn))) return n$2.err(new PositionError(IllegalSetup.Kings));
		const otherKing = this.board.kingOf(opposite(this.turn));
		if (!defined(otherKing)) return n$2.err(new PositionError(IllegalSetup.Kings));
		if (this.kingAttackers(otherKing, this.turn, this.board.occupied).nonEmpty()) return n$2.err(new PositionError(IllegalSetup.OppositeCheck));
		if (SquareSet.backranks().intersects(this.board.pawn)) return n$2.err(new PositionError(IllegalSetup.PawnsOnBackrank));
		return n$2.ok(void 0);
	}
	dropDests(_ctx) {
		return SquareSet.empty();
	}
	dests(square, ctx) {
		ctx = ctx || this.ctx();
		if (ctx.variantEnd) return SquareSet.empty();
		const piece = this.board.get(square);
		if (!piece || piece.color !== this.turn) return SquareSet.empty();
		let pseudo, legal;
		if (piece.role === "pawn") {
			pseudo = pawnAttacks(this.turn, square).intersect(this.board[opposite(this.turn)]);
			const delta = this.turn === "white" ? 8 : -8;
			const step = square + delta;
			if (0 <= step && step < 64 && !this.board.occupied.has(step)) {
				pseudo = pseudo.with(step);
				const canDoubleStep = this.turn === "white" ? square < 16 : square >= 48;
				const doubleStep = step + delta;
				if (canDoubleStep && !this.board.occupied.has(doubleStep)) pseudo = pseudo.with(doubleStep);
			}
			if (defined(this.epSquare) && canCaptureEp(this, square, ctx)) legal = SquareSet.fromSquare(this.epSquare);
		} else if (piece.role === "bishop") pseudo = bishopAttacks(square, this.board.occupied);
		else if (piece.role === "knight") pseudo = knightAttacks(square);
		else if (piece.role === "rook") pseudo = rookAttacks(square, this.board.occupied);
		else if (piece.role === "queen") pseudo = queenAttacks(square, this.board.occupied);
		else pseudo = kingAttacks(square);
		pseudo = pseudo.diff(this.board[this.turn]);
		if (defined(ctx.king)) {
			if (piece.role === "king") {
				const occ = this.board.occupied.without(square);
				for (const to of pseudo) if (this.kingAttackers(to, opposite(this.turn), occ).nonEmpty()) pseudo = pseudo.without(to);
				return pseudo.union(castlingDest(this, "a", ctx)).union(castlingDest(this, "h", ctx));
			}
			if (ctx.checkers.nonEmpty()) {
				const checker = ctx.checkers.singleSquare();
				if (!defined(checker)) return SquareSet.empty();
				pseudo = pseudo.intersect(between(checker, ctx.king).with(checker));
			}
			if (ctx.blockers.has(square)) pseudo = pseudo.intersect(ray(square, ctx.king));
		}
		if (legal) pseudo = pseudo.union(legal);
		return pseudo;
	}
	isVariantEnd() {
		return false;
	}
	variantOutcome(_ctx) {}
	hasInsufficientMaterial(color) {
		if (this.board[color].intersect(this.board.pawn.union(this.board.rooksAndQueens())).nonEmpty()) return false;
		if (this.board[color].intersects(this.board.knight)) return this.board[color].size() <= 2 && this.board[opposite(color)].diff(this.board.king).diff(this.board.queen).isEmpty();
		if (this.board[color].intersects(this.board.bishop)) return (!this.board.bishop.intersects(SquareSet.darkSquares()) || !this.board.bishop.intersects(SquareSet.lightSquares())) && this.board.pawn.isEmpty() && this.board.knight.isEmpty();
		return true;
	}
	toSetup() {
		var _a, _b;
		return {
			board: this.board.clone(),
			pockets: (_a = this.pockets) === null || _a === void 0 ? void 0 : _a.clone(),
			turn: this.turn,
			castlingRights: this.castles.castlingRights,
			epSquare: legalEpSquare(this),
			remainingChecks: (_b = this.remainingChecks) === null || _b === void 0 ? void 0 : _b.clone(),
			halfmoves: Math.min(this.halfmoves, 150),
			fullmoves: Math.min(Math.max(this.fullmoves, 1), 9999)
		};
	}
	isInsufficientMaterial() {
		return COLORS.every((color) => this.hasInsufficientMaterial(color));
	}
	hasDests(ctx) {
		ctx = ctx || this.ctx();
		for (const square of this.board[this.turn]) if (this.dests(square, ctx).nonEmpty()) return true;
		return this.dropDests(ctx).nonEmpty();
	}
	isLegal(move, ctx) {
		if (isDrop(move)) {
			if (!this.pockets || this.pockets[this.turn][move.role] <= 0) return false;
			if (move.role === "pawn" && SquareSet.backranks().has(move.to)) return false;
			return this.dropDests(ctx).has(move.to);
		} else {
			if (move.promotion === "pawn") return false;
			if (move.promotion === "king" && this.rules !== "antichess") return false;
			if (!!move.promotion !== (this.board.pawn.has(move.from) && SquareSet.backranks().has(move.to))) return false;
			const dests = this.dests(move.from, ctx);
			return dests.has(move.to) || dests.has(normalizeMove$1(this, move).to);
		}
	}
	isCheck() {
		const king = this.board.kingOf(this.turn);
		return defined(king) && this.kingAttackers(king, opposite(this.turn), this.board.occupied).nonEmpty();
	}
	isEnd(ctx) {
		if (ctx ? ctx.variantEnd : this.isVariantEnd()) return true;
		return this.isInsufficientMaterial() || !this.hasDests(ctx);
	}
	isCheckmate(ctx) {
		ctx = ctx || this.ctx();
		return !ctx.variantEnd && ctx.checkers.nonEmpty() && !this.hasDests(ctx);
	}
	isStalemate(ctx) {
		ctx = ctx || this.ctx();
		return !ctx.variantEnd && ctx.checkers.isEmpty() && !this.hasDests(ctx);
	}
	outcome(ctx) {
		const variantOutcome = this.variantOutcome(ctx);
		if (variantOutcome) return variantOutcome;
		ctx = ctx || this.ctx();
		if (this.isCheckmate(ctx)) return { winner: opposite(this.turn) };
		else if (this.isInsufficientMaterial() || this.isStalemate(ctx)) return { winner: void 0 };
		else return;
	}
	allDests(ctx) {
		ctx = ctx || this.ctx();
		const d = /* @__PURE__ */ new Map();
		if (ctx.variantEnd) return d;
		for (const square of this.board[this.turn]) d.set(square, this.dests(square, ctx));
		return d;
	}
	play(move) {
		const turn = this.turn;
		const epSquare = this.epSquare;
		const castling = castlingSide(this, move);
		this.epSquare = void 0;
		this.halfmoves += 1;
		if (turn === "black") this.fullmoves += 1;
		this.turn = opposite(turn);
		if (isDrop(move)) {
			this.board.set(move.to, {
				role: move.role,
				color: turn
			});
			if (this.pockets) this.pockets[turn][move.role]--;
			if (move.role === "pawn") this.halfmoves = 0;
		} else {
			const piece = this.board.take(move.from);
			if (!piece) return;
			let epCapture;
			if (piece.role === "pawn") {
				this.halfmoves = 0;
				if (move.to === epSquare) epCapture = this.board.take(move.to + (turn === "white" ? -8 : 8));
				const delta = move.from - move.to;
				if (Math.abs(delta) === 16 && 8 <= move.from && move.from <= 55) this.epSquare = move.from + move.to >> 1;
				if (move.promotion) {
					piece.role = move.promotion;
					piece.promoted = !!this.pockets;
				}
			} else if (piece.role === "rook") this.castles.discardRook(move.from);
			else if (piece.role === "king") {
				if (castling) {
					const rookFrom = this.castles.rook[turn][castling];
					if (defined(rookFrom)) {
						const rook = this.board.take(rookFrom);
						this.board.set(kingCastlesTo(turn, castling), piece);
						if (rook) this.board.set(rookCastlesTo(turn, castling), rook);
					}
				}
				this.castles.discardColor(turn);
			}
			if (!castling) {
				const capture = this.board.set(move.to, piece) || epCapture;
				if (capture) this.playCaptureAt(move.to, capture);
			}
		}
		if (this.remainingChecks) {
			if (this.isCheck()) this.remainingChecks[turn] = Math.max(this.remainingChecks[turn] - 1, 0);
		}
	}
};
var Chess = class extends Position {
	constructor() {
		super("chess");
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
};
var validEpSquare = (pos, square) => {
	if (!defined(square)) return;
	const epRank = pos.turn === "white" ? 5 : 2;
	const forward = pos.turn === "white" ? 8 : -8;
	if (squareRank(square) !== epRank) return;
	if (pos.board.occupied.has(square + forward)) return;
	const pawn = square - forward;
	if (!pos.board.pawn.has(pawn) || !pos.board[opposite(pos.turn)].has(pawn)) return;
	return square;
};
var legalEpSquare = (pos) => {
	if (!defined(pos.epSquare)) return;
	const ctx = pos.ctx();
	const candidates = pos.board.pieces(pos.turn, "pawn").intersect(pawnAttacks(opposite(pos.turn), pos.epSquare));
	for (const candidate of candidates) if (pos.dests(candidate, ctx).has(pos.epSquare)) return pos.epSquare;
};
var canCaptureEp = (pos, pawnFrom, ctx) => {
	if (!defined(pos.epSquare)) return false;
	if (!pawnAttacks(pos.turn, pawnFrom).has(pos.epSquare)) return false;
	if (!defined(ctx.king)) return true;
	const delta = pos.turn === "white" ? 8 : -8;
	const captured = pos.epSquare - delta;
	return pos.kingAttackers(ctx.king, opposite(pos.turn), pos.board.occupied.toggle(pawnFrom).toggle(captured).with(pos.epSquare)).without(captured).isEmpty();
};
var castlingDest = (pos, side, ctx) => {
	if (!defined(ctx.king) || ctx.checkers.nonEmpty()) return SquareSet.empty();
	const rook = pos.castles.rook[pos.turn][side];
	if (!defined(rook)) return SquareSet.empty();
	if (pos.castles.path[pos.turn][side].intersects(pos.board.occupied)) return SquareSet.empty();
	const kingTo = kingCastlesTo(pos.turn, side);
	const kingPath = between(ctx.king, kingTo);
	const occ = pos.board.occupied.without(ctx.king);
	for (const sq of kingPath) if (pos.kingAttackers(sq, opposite(pos.turn), occ).nonEmpty()) return SquareSet.empty();
	const rookTo = rookCastlesTo(pos.turn, side);
	const after = pos.board.occupied.toggle(ctx.king).toggle(rook).toggle(rookTo);
	if (pos.kingAttackers(kingTo, opposite(pos.turn), after).nonEmpty()) return SquareSet.empty();
	return SquareSet.fromSquare(rook);
};
var pseudoDests = (pos, square, ctx) => {
	if (ctx.variantEnd) return SquareSet.empty();
	const piece = pos.board.get(square);
	if (!piece || piece.color !== pos.turn) return SquareSet.empty();
	let pseudo = attacks(piece, square, pos.board.occupied);
	if (piece.role === "pawn") {
		let captureTargets = pos.board[opposite(pos.turn)];
		if (defined(pos.epSquare)) captureTargets = captureTargets.with(pos.epSquare);
		pseudo = pseudo.intersect(captureTargets);
		const delta = pos.turn === "white" ? 8 : -8;
		const step = square + delta;
		if (0 <= step && step < 64 && !pos.board.occupied.has(step)) {
			pseudo = pseudo.with(step);
			const canDoubleStep = pos.turn === "white" ? square < 16 : square >= 48;
			const doubleStep = step + delta;
			if (canDoubleStep && !pos.board.occupied.has(doubleStep)) pseudo = pseudo.with(doubleStep);
		}
		return pseudo;
	} else pseudo = pseudo.diff(pos.board[pos.turn]);
	if (square === ctx.king) return pseudo.union(castlingDest(pos, "a", ctx)).union(castlingDest(pos, "h", ctx));
	else return pseudo;
};
var castlingSide = (pos, move) => {
	if (isDrop(move)) return;
	const delta = move.to - move.from;
	if (Math.abs(delta) !== 2 && !pos.board[pos.turn].has(move.to)) return;
	if (!pos.board.king.has(move.from)) return;
	return delta > 0 ? "h" : "a";
};
var normalizeMove$1 = (pos, move) => {
	const side = castlingSide(pos, move);
	if (!side) return move;
	const rookFrom = pos.castles.rook[pos.turn][side];
	return {
		from: move.from,
		to: defined(rookFrom) ? rookFrom : move.to
	};
};
var InvalidFen;
(function(InvalidFen) {
	InvalidFen["Fen"] = "ERR_FEN";
	InvalidFen["Board"] = "ERR_BOARD";
	InvalidFen["Pockets"] = "ERR_POCKETS";
	InvalidFen["Turn"] = "ERR_TURN";
	InvalidFen["Castling"] = "ERR_CASTLING";
	InvalidFen["EpSquare"] = "ERR_EP_SQUARE";
	InvalidFen["RemainingChecks"] = "ERR_REMAINING_CHECKS";
	InvalidFen["Halfmoves"] = "ERR_HALFMOVES";
	InvalidFen["Fullmoves"] = "ERR_FULLMOVES";
})(InvalidFen || (InvalidFen = {}));
var FenError = class extends Error {};
var nthIndexOf = (haystack, needle, n) => {
	let index = haystack.indexOf(needle);
	while (n-- > 0) {
		if (index === -1) break;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return index;
};
var parseSmallUint = (str) => /^\d{1,4}$/.test(str) ? parseInt(str, 10) : void 0;
var charToPiece = (ch) => {
	const role = charToRole(ch);
	return role && {
		role,
		color: ch.toLowerCase() === ch ? "black" : "white"
	};
};
var parseBoardFen = (boardPart) => {
	const board = Board.empty();
	let rank = 7;
	let file = 0;
	for (let i = 0; i < boardPart.length; i++) {
		const c = boardPart[i];
		if (c === "/" && file === 8) {
			file = 0;
			rank--;
		} else {
			const step = parseInt(c, 10);
			if (step > 0) file += step;
			else {
				if (file >= 8 || rank < 0) return n$2.err(new FenError(InvalidFen.Board));
				const square = file + rank * 8;
				const piece = charToPiece(c);
				if (!piece) return n$2.err(new FenError(InvalidFen.Board));
				if (boardPart[i + 1] === "~") {
					piece.promoted = true;
					i++;
				}
				board.set(square, piece);
				file++;
			}
		}
	}
	if (rank !== 0 || file !== 8) return n$2.err(new FenError(InvalidFen.Board));
	return n$2.ok(board);
};
var parsePockets = (pocketPart) => {
	if (pocketPart.length > 64) return n$2.err(new FenError(InvalidFen.Pockets));
	const pockets = Material.empty();
	for (const c of pocketPart) {
		const piece = charToPiece(c);
		if (!piece) return n$2.err(new FenError(InvalidFen.Pockets));
		pockets[piece.color][piece.role]++;
	}
	return n$2.ok(pockets);
};
var parseCastlingFen = (board, castlingPart) => {
	let castlingRights = SquareSet.empty();
	if (castlingPart === "-") return n$2.ok(castlingRights);
	for (const c of castlingPart) {
		const lower = c.toLowerCase();
		const color = c === lower ? "black" : "white";
		const rank = color === "white" ? 0 : 7;
		if ("a" <= lower && lower <= "h") castlingRights = castlingRights.with(squareFromCoords(lower.charCodeAt(0) - "a".charCodeAt(0), rank));
		else if (lower === "k" || lower === "q") {
			const rooksAndKings = board[color].intersect(SquareSet.backrank(color)).intersect(board.rook.union(board.king));
			const candidate = lower === "k" ? rooksAndKings.last() : rooksAndKings.first();
			castlingRights = castlingRights.with(defined(candidate) && board.rook.has(candidate) ? candidate : squareFromCoords(lower === "k" ? 7 : 0, rank));
		} else return n$2.err(new FenError(InvalidFen.Castling));
	}
	if (COLORS.some((color) => SquareSet.backrank(color).intersect(castlingRights).size() > 2)) return n$2.err(new FenError(InvalidFen.Castling));
	return n$2.ok(castlingRights);
};
var parseRemainingChecks = (part) => {
	const parts = part.split("+");
	if (parts.length === 3 && parts[0] === "") {
		const white = parseSmallUint(parts[1]);
		const black = parseSmallUint(parts[2]);
		if (!defined(white) || white > 3 || !defined(black) || black > 3) return n$2.err(new FenError(InvalidFen.RemainingChecks));
		return n$2.ok(new RemainingChecks(3 - white, 3 - black));
	} else if (parts.length === 2) {
		const white = parseSmallUint(parts[0]);
		const black = parseSmallUint(parts[1]);
		if (!defined(white) || white > 3 || !defined(black) || black > 3) return n$2.err(new FenError(InvalidFen.RemainingChecks));
		return n$2.ok(new RemainingChecks(white, black));
	} else return n$2.err(new FenError(InvalidFen.RemainingChecks));
};
var parseFen$1 = (fen) => {
	const parts = fen.split(/[\s_]+/);
	const boardPart = parts.shift();
	let board;
	let pockets = n$2.ok(void 0);
	if (boardPart.endsWith("]")) {
		const pocketStart = boardPart.indexOf("[");
		if (pocketStart === -1) return n$2.err(new FenError(InvalidFen.Fen));
		board = parseBoardFen(boardPart.slice(0, pocketStart));
		pockets = parsePockets(boardPart.slice(pocketStart + 1, -1));
	} else {
		const pocketStart = nthIndexOf(boardPart, "/", 7);
		if (pocketStart === -1) board = parseBoardFen(boardPart);
		else {
			board = parseBoardFen(boardPart.slice(0, pocketStart));
			pockets = parsePockets(boardPart.slice(pocketStart + 1));
		}
	}
	let turn;
	const turnPart = parts.shift();
	if (!defined(turnPart) || turnPart === "w") turn = "white";
	else if (turnPart === "b") turn = "black";
	else return n$2.err(new FenError(InvalidFen.Turn));
	return board.chain((board) => {
		const castlingPart = parts.shift();
		const castlingRights = defined(castlingPart) ? parseCastlingFen(board, castlingPart) : n$2.ok(SquareSet.empty());
		const epPart = parts.shift();
		let epSquare;
		if (defined(epPart) && epPart !== "-") {
			epSquare = parseSquare(epPart);
			if (!defined(epSquare)) return n$2.err(new FenError(InvalidFen.EpSquare));
		}
		let halfmovePart = parts.shift();
		let earlyRemainingChecks;
		if (defined(halfmovePart) && halfmovePart.includes("+")) {
			earlyRemainingChecks = parseRemainingChecks(halfmovePart);
			halfmovePart = parts.shift();
		}
		const halfmoves = defined(halfmovePart) ? parseSmallUint(halfmovePart) : 0;
		if (!defined(halfmoves)) return n$2.err(new FenError(InvalidFen.Halfmoves));
		const fullmovesPart = parts.shift();
		const fullmoves = defined(fullmovesPart) ? parseSmallUint(fullmovesPart) : 1;
		if (!defined(fullmoves)) return n$2.err(new FenError(InvalidFen.Fullmoves));
		const remainingChecksPart = parts.shift();
		let remainingChecks = n$2.ok(void 0);
		if (defined(remainingChecksPart)) {
			if (defined(earlyRemainingChecks)) return n$2.err(new FenError(InvalidFen.RemainingChecks));
			remainingChecks = parseRemainingChecks(remainingChecksPart);
		} else if (defined(earlyRemainingChecks)) remainingChecks = earlyRemainingChecks;
		if (parts.length > 0) return n$2.err(new FenError(InvalidFen.Fen));
		return pockets.chain((pockets) => castlingRights.chain((castlingRights) => remainingChecks.map((remainingChecks) => {
			return {
				board,
				pockets,
				turn,
				castlingRights,
				remainingChecks,
				epSquare,
				halfmoves,
				fullmoves: Math.max(1, fullmoves)
			};
		})));
	});
};
var makePiece = (piece) => {
	let r = roleToChar(piece.role);
	if (piece.color === "white") r = r.toUpperCase();
	if (piece.promoted) r += "~";
	return r;
};
var makeBoardFen = (board) => {
	let fen = "";
	let empty = 0;
	for (let rank = 7; rank >= 0; rank--) for (let file = 0; file < 8; file++) {
		const square = file + rank * 8;
		const piece = board.get(square);
		if (!piece) empty++;
		else {
			if (empty > 0) {
				fen += empty;
				empty = 0;
			}
			fen += makePiece(piece);
		}
		if (file === 7) {
			if (empty > 0) {
				fen += empty;
				empty = 0;
			}
			if (rank !== 0) fen += "/";
		}
	}
	return fen;
};
var makePocket = (material) => ROLES.map((role) => roleToChar(role).repeat(material[role])).join("");
var makePockets = (pocket) => makePocket(pocket.white).toUpperCase() + makePocket(pocket.black);
var makeCastlingFen = (board, castlingRights) => {
	let fen = "";
	for (const color of COLORS) {
		const backrank = SquareSet.backrank(color);
		let king = board.kingOf(color);
		if (defined(king) && !backrank.has(king)) king = void 0;
		const candidates = board.pieces(color, "rook").intersect(backrank);
		for (const rook of castlingRights.intersect(backrank).reversed()) if (rook === candidates.first() && defined(king) && rook < king) fen += color === "white" ? "Q" : "q";
		else if (rook === candidates.last() && defined(king) && king < rook) fen += color === "white" ? "K" : "k";
		else {
			const file = FILE_NAMES[squareFile(rook)];
			fen += color === "white" ? file.toUpperCase() : file;
		}
	}
	return fen || "-";
};
var makeRemainingChecks = (checks) => `${checks.white}+${checks.black}`;
var makeFen = (setup, opts) => [
	makeBoardFen(setup.board) + (setup.pockets ? `[${makePockets(setup.pockets)}]` : ""),
	setup.turn[0],
	makeCastlingFen(setup.board, setup.castlingRights),
	defined(setup.epSquare) ? makeSquare(setup.epSquare) : "-",
	...setup.remainingChecks ? [makeRemainingChecks(setup.remainingChecks)] : [],
	...(opts === null || opts === void 0 ? void 0 : opts.epd) ? [] : [Math.max(0, Math.min(setup.halfmoves, 9999)), Math.max(1, Math.min(setup.fullmoves, 9999))]
].join(" ");
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/san.js
var makeSanWithoutSuffix = (pos, move) => {
	let san = "";
	if (isDrop(move)) {
		if (move.role !== "pawn") san = roleToChar(move.role).toUpperCase();
		san += "@" + makeSquare(move.to);
	} else {
		const role = pos.board.getRole(move.from);
		if (!role) return "--";
		if (role === "king" && (pos.board[pos.turn].has(move.to) || Math.abs(move.to - move.from) === 2)) san = move.to > move.from ? "O-O" : "O-O-O";
		else {
			const capture = pos.board.occupied.has(move.to) || role === "pawn" && squareFile(move.from) !== squareFile(move.to);
			if (role !== "pawn") {
				san = roleToChar(role).toUpperCase();
				let others;
				if (role === "king") others = kingAttacks(move.to).intersect(pos.board.king);
				else if (role === "queen") others = queenAttacks(move.to, pos.board.occupied).intersect(pos.board.queen);
				else if (role === "rook") others = rookAttacks(move.to, pos.board.occupied).intersect(pos.board.rook);
				else if (role === "bishop") others = bishopAttacks(move.to, pos.board.occupied).intersect(pos.board.bishop);
				else others = knightAttacks(move.to).intersect(pos.board.knight);
				others = others.intersect(pos.board[pos.turn]).without(move.from);
				if (others.nonEmpty()) {
					const ctx = pos.ctx();
					for (const from of others) if (!pos.dests(from, ctx).has(move.to)) others = others.without(from);
					if (others.nonEmpty()) {
						let row = false;
						let column = others.intersects(SquareSet.fromRank(squareRank(move.from)));
						if (others.intersects(SquareSet.fromFile(squareFile(move.from)))) row = true;
						else column = true;
						if (column) san += FILE_NAMES[squareFile(move.from)];
						if (row) san += RANK_NAMES[squareRank(move.from)];
					}
				}
			} else if (capture) san = FILE_NAMES[squareFile(move.from)];
			if (capture) san += "x";
			san += makeSquare(move.to);
			if (move.promotion) san += "=" + roleToChar(move.promotion).toUpperCase();
		}
	}
	return san;
};
var makeSanAndPlay = (pos, move) => {
	var _a;
	const san = makeSanWithoutSuffix(pos, move);
	pos.play(move);
	if ((_a = pos.outcome()) === null || _a === void 0 ? void 0 : _a.winner) return san + "#";
	if (pos.isCheck()) return san + "+";
	return san;
};
var makeSan = (pos, move) => makeSanAndPlay(pos.clone(), move);
var parseSan = (pos, san) => {
	const ctx = pos.ctx();
	const match = san.match(/^([NBRQK])?([a-h])?([1-8])?[-x]?([a-h][1-8])(?:=?([nbrqkNBRQK]))?[+#]?$/);
	if (!match) {
		let castlingSide;
		if (san === "O-O" || san === "O-O+" || san === "O-O#") castlingSide = "h";
		else if (san === "O-O-O" || san === "O-O-O+" || san === "O-O-O#") castlingSide = "a";
		if (castlingSide) {
			const rook = pos.castles.rook[pos.turn][castlingSide];
			if (!defined(ctx.king) || !defined(rook) || !pos.dests(ctx.king, ctx).has(rook)) return;
			return {
				from: ctx.king,
				to: rook
			};
		}
		const match = san.match(/^([pnbrqkPNBRQK])?@([a-h][1-8])[+#]?$/);
		if (!match) return;
		const move = {
			role: match[1] ? charToRole(match[1]) : "pawn",
			to: parseSquare(match[2])
		};
		return pos.isLegal(move, ctx) ? move : void 0;
	}
	const role = match[1] ? charToRole(match[1]) : "pawn";
	const to = parseSquare(match[4]);
	const promotion = match[5] ? charToRole(match[5]) : void 0;
	if (!!promotion !== (role === "pawn" && SquareSet.backranks().has(to))) return;
	if (promotion === "king" && pos.rules !== "antichess") return;
	let candidates = pos.board.pieces(pos.turn, role);
	if (role === "pawn" && !match[2]) candidates = candidates.intersect(SquareSet.fromFile(squareFile(to)));
	else if (match[2]) candidates = candidates.intersect(SquareSet.fromFile(match[2].charCodeAt(0) - "a".charCodeAt(0)));
	if (match[3]) candidates = candidates.intersect(SquareSet.fromRank(match[3].charCodeAt(0) - "1".charCodeAt(0)));
	const pawnAdvance = role === "pawn" ? SquareSet.fromFile(squareFile(to)) : SquareSet.empty();
	candidates = candidates.intersect(pawnAdvance.union(attacks({
		color: opposite(pos.turn),
		role
	}, to, pos.board.occupied)));
	let from;
	for (const candidate of candidates) if (pos.dests(candidate, ctx).has(to)) {
		if (defined(from)) return;
		from = candidate;
	}
	if (!defined(from)) return;
	return {
		from,
		to,
		promotion
	};
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/variant.js
var Crazyhouse = class extends Position {
	constructor() {
		super("crazyhouse");
	}
	reset() {
		super.reset();
		this.pockets = Material.empty();
	}
	setupUnchecked(setup) {
		super.setupUnchecked(setup);
		this.board.promoted = setup.board.promoted.intersect(setup.board.occupied).diff(setup.board.king).diff(setup.board.pawn);
		this.pockets = setup.pockets ? setup.pockets.clone() : Material.empty();
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	validate() {
		return super.validate().chain((_) => {
			var _a, _b;
			if ((_a = this.pockets) === null || _a === void 0 ? void 0 : _a.count("king")) return n$2.err(new PositionError(IllegalSetup.Kings));
			if ((((_b = this.pockets) === null || _b === void 0 ? void 0 : _b.size()) || 0) + this.board.occupied.size() > 64) return n$2.err(new PositionError(IllegalSetup.Variant));
			return n$2.ok(void 0);
		});
	}
	hasInsufficientMaterial(color) {
		if (!this.pockets) return super.hasInsufficientMaterial(color);
		return this.board.occupied.size() + this.pockets.size() <= 3 && this.board.pawn.isEmpty() && this.board.promoted.isEmpty() && this.board.rooksAndQueens().isEmpty() && this.pockets.count("pawn") <= 0 && this.pockets.count("rook") <= 0 && this.pockets.count("queen") <= 0;
	}
	dropDests(ctx) {
		var _a, _b;
		const mask = this.board.occupied.complement().intersect(((_a = this.pockets) === null || _a === void 0 ? void 0 : _a[this.turn].hasNonPawns()) ? SquareSet.full() : ((_b = this.pockets) === null || _b === void 0 ? void 0 : _b[this.turn].hasPawns()) ? SquareSet.backranks().complement() : SquareSet.empty());
		ctx = ctx || this.ctx();
		if (defined(ctx.king) && ctx.checkers.nonEmpty()) {
			const checker = ctx.checkers.singleSquare();
			if (!defined(checker)) return SquareSet.empty();
			return mask.intersect(between(checker, ctx.king));
		} else return mask;
	}
};
var Atomic = class extends Position {
	constructor() {
		super("atomic");
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	validate() {
		if (this.board.occupied.isEmpty()) return n$2.err(new PositionError(IllegalSetup.Empty));
		if (this.board.king.size() > 2) return n$2.err(new PositionError(IllegalSetup.Kings));
		const otherKing = this.board.kingOf(opposite(this.turn));
		if (!defined(otherKing)) return n$2.err(new PositionError(IllegalSetup.Kings));
		if (this.kingAttackers(otherKing, this.turn, this.board.occupied).nonEmpty()) return n$2.err(new PositionError(IllegalSetup.OppositeCheck));
		if (SquareSet.backranks().intersects(this.board.pawn)) return n$2.err(new PositionError(IllegalSetup.PawnsOnBackrank));
		return n$2.ok(void 0);
	}
	kingAttackers(square, attacker, occupied) {
		const attackerKings = this.board.pieces(attacker, "king");
		if (attackerKings.isEmpty() || kingAttacks(square).intersects(attackerKings)) return SquareSet.empty();
		return super.kingAttackers(square, attacker, occupied);
	}
	playCaptureAt(square, captured) {
		super.playCaptureAt(square, captured);
		this.board.take(square);
		for (const explode of kingAttacks(square).intersect(this.board.occupied).diff(this.board.pawn)) {
			const piece = this.board.take(explode);
			if ((piece === null || piece === void 0 ? void 0 : piece.role) === "rook") this.castles.discardRook(explode);
			if ((piece === null || piece === void 0 ? void 0 : piece.role) === "king") this.castles.discardColor(piece.color);
		}
	}
	hasInsufficientMaterial(color) {
		if (this.board.pieces(opposite(color), "king").isEmpty()) return false;
		if (this.board[color].diff(this.board.king).isEmpty()) return true;
		if (this.board[opposite(color)].diff(this.board.king).nonEmpty()) {
			if (this.board.occupied.equals(this.board.bishop.union(this.board.king))) {
				if (!this.board.bishop.intersect(this.board.white).intersects(SquareSet.darkSquares())) return !this.board.bishop.intersect(this.board.black).intersects(SquareSet.lightSquares());
				if (!this.board.bishop.intersect(this.board.white).intersects(SquareSet.lightSquares())) return !this.board.bishop.intersect(this.board.black).intersects(SquareSet.darkSquares());
			}
			return false;
		}
		if (this.board.queen.nonEmpty() || this.board.pawn.nonEmpty()) return false;
		if (this.board.knight.union(this.board.bishop).union(this.board.rook).size() === 1) return true;
		if (this.board.occupied.equals(this.board.knight.union(this.board.king))) return this.board.knight.size() <= 2;
		return false;
	}
	dests(square, ctx) {
		ctx = ctx || this.ctx();
		let dests = SquareSet.empty();
		for (const to of pseudoDests(this, square, ctx)) {
			const after = this.clone();
			after.play({
				from: square,
				to
			});
			const ourKing = after.board.kingOf(this.turn);
			if (defined(ourKing) && (!defined(after.board.kingOf(after.turn)) || after.kingAttackers(ourKing, after.turn, after.board.occupied).isEmpty())) dests = dests.with(to);
		}
		return dests;
	}
	isVariantEnd() {
		return !!this.variantOutcome();
	}
	variantOutcome(_ctx) {
		for (const color of COLORS) if (this.board.pieces(color, "king").isEmpty()) return { winner: opposite(color) };
	}
};
var Antichess = class extends Position {
	constructor() {
		super("antichess");
	}
	reset() {
		super.reset();
		this.castles = Castles.empty();
	}
	setupUnchecked(setup) {
		super.setupUnchecked(setup);
		this.castles = Castles.empty();
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	validate() {
		if (this.board.occupied.isEmpty()) return n$2.err(new PositionError(IllegalSetup.Empty));
		if (SquareSet.backranks().intersects(this.board.pawn)) return n$2.err(new PositionError(IllegalSetup.PawnsOnBackrank));
		return n$2.ok(void 0);
	}
	kingAttackers(_square, _attacker, _occupied) {
		return SquareSet.empty();
	}
	ctx() {
		const ctx = super.ctx();
		if (defined(this.epSquare) && pawnAttacks(opposite(this.turn), this.epSquare).intersects(this.board.pieces(this.turn, "pawn"))) {
			ctx.mustCapture = true;
			return ctx;
		}
		const enemy = this.board[opposite(this.turn)];
		for (const from of this.board[this.turn]) if (pseudoDests(this, from, ctx).intersects(enemy)) {
			ctx.mustCapture = true;
			return ctx;
		}
		return ctx;
	}
	dests(square, ctx) {
		ctx = ctx || this.ctx();
		const dests = pseudoDests(this, square, ctx);
		const enemy = this.board[opposite(this.turn)];
		return dests.intersect(ctx.mustCapture ? defined(this.epSquare) && this.board.getRole(square) === "pawn" ? enemy.with(this.epSquare) : enemy : SquareSet.full());
	}
	hasInsufficientMaterial(color) {
		if (this.board[color].isEmpty()) return false;
		if (this.board[opposite(color)].isEmpty()) return true;
		if (this.board.occupied.equals(this.board.bishop)) {
			const weSomeOnLight = this.board[color].intersects(SquareSet.lightSquares());
			const weSomeOnDark = this.board[color].intersects(SquareSet.darkSquares());
			const theyAllOnDark = this.board[opposite(color)].isDisjoint(SquareSet.lightSquares());
			const theyAllOnLight = this.board[opposite(color)].isDisjoint(SquareSet.darkSquares());
			return weSomeOnLight && theyAllOnDark || weSomeOnDark && theyAllOnLight;
		}
		if (this.board.occupied.equals(this.board.knight) && this.board.occupied.size() === 2) return this.board.white.intersects(SquareSet.lightSquares()) !== this.board.black.intersects(SquareSet.darkSquares()) !== (this.turn === color);
		return false;
	}
	isVariantEnd() {
		return this.board[this.turn].isEmpty();
	}
	variantOutcome(ctx) {
		ctx = ctx || this.ctx();
		if (ctx.variantEnd || this.isStalemate(ctx)) return { winner: this.turn };
	}
};
var KingOfTheHill = class extends Position {
	constructor() {
		super("kingofthehill");
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	hasInsufficientMaterial(_color) {
		return false;
	}
	isVariantEnd() {
		return this.board.king.intersects(SquareSet.center());
	}
	variantOutcome(_ctx) {
		for (const color of COLORS) if (this.board.pieces(color, "king").intersects(SquareSet.center())) return { winner: color };
	}
};
var ThreeCheck = class extends Position {
	constructor() {
		super("3check");
	}
	reset() {
		super.reset();
		this.remainingChecks = RemainingChecks.default();
	}
	setupUnchecked(setup) {
		var _a;
		super.setupUnchecked(setup);
		this.remainingChecks = ((_a = setup.remainingChecks) === null || _a === void 0 ? void 0 : _a.clone()) || RemainingChecks.default();
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	hasInsufficientMaterial(color) {
		return this.board.pieces(color, "king").equals(this.board[color]);
	}
	isVariantEnd() {
		return !!this.remainingChecks && (this.remainingChecks.white <= 0 || this.remainingChecks.black <= 0);
	}
	variantOutcome(_ctx) {
		if (this.remainingChecks) {
			for (const color of COLORS) if (this.remainingChecks[color] <= 0) return { winner: color };
		}
	}
};
var racingKingsBoard = () => {
	const board = Board.empty();
	board.occupied = new SquareSet(65535, 0);
	board.promoted = SquareSet.empty();
	board.white = new SquareSet(61680, 0);
	board.black = new SquareSet(3855, 0);
	board.pawn = SquareSet.empty();
	board.knight = new SquareSet(6168, 0);
	board.bishop = new SquareSet(9252, 0);
	board.rook = new SquareSet(16962, 0);
	board.queen = new SquareSet(129, 0);
	board.king = new SquareSet(33024, 0);
	return board;
};
var RacingKings = class extends Position {
	constructor() {
		super("racingkings");
	}
	reset() {
		this.board = racingKingsBoard();
		this.pockets = void 0;
		this.turn = "white";
		this.castles = Castles.empty();
		this.epSquare = void 0;
		this.remainingChecks = void 0;
		this.halfmoves = 0;
		this.fullmoves = 1;
	}
	setupUnchecked(setup) {
		super.setupUnchecked(setup);
		this.castles = Castles.empty();
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	validate() {
		if (this.isCheck() || this.board.pawn.nonEmpty()) return n$2.err(new PositionError(IllegalSetup.Variant));
		return super.validate();
	}
	dests(square, ctx) {
		ctx = ctx || this.ctx();
		if (square === ctx.king) return super.dests(square, ctx);
		let dests = SquareSet.empty();
		for (const to of super.dests(square, ctx)) {
			const move = {
				from: square,
				to
			};
			const after = this.clone();
			after.play(move);
			if (!after.isCheck()) dests = dests.with(to);
		}
		return dests;
	}
	hasInsufficientMaterial(_color) {
		return false;
	}
	isVariantEnd() {
		const goal = SquareSet.fromRank(7);
		const inGoal = this.board.king.intersect(goal);
		if (inGoal.isEmpty()) return false;
		if (this.turn === "white" || inGoal.intersects(this.board.black)) return true;
		const blackKing = this.board.kingOf("black");
		if (defined(blackKing)) {
			const occ = this.board.occupied.without(blackKing);
			for (const target of kingAttacks(blackKing).intersect(goal).diff(this.board.black)) if (this.kingAttackers(target, "white", occ).isEmpty()) return false;
		}
		return true;
	}
	variantOutcome(ctx) {
		if (ctx ? !ctx.variantEnd : !this.isVariantEnd()) return;
		const goal = SquareSet.fromRank(7);
		const blackInGoal = this.board.pieces("black", "king").intersects(goal);
		const whiteInGoal = this.board.pieces("white", "king").intersects(goal);
		if (blackInGoal && !whiteInGoal) return { winner: "black" };
		if (whiteInGoal && !blackInGoal) return { winner: "white" };
		return { winner: void 0 };
	}
};
var hordeBoard = () => {
	const board = Board.empty();
	board.occupied = new SquareSet(4294967295, 4294901862);
	board.promoted = SquareSet.empty();
	board.white = new SquareSet(4294967295, 102);
	board.black = new SquareSet(0, 4294901760);
	board.pawn = new SquareSet(4294967295, 16711782);
	board.knight = new SquareSet(0, 1107296256);
	board.bishop = new SquareSet(0, 603979776);
	board.rook = new SquareSet(0, 2164260864);
	board.queen = new SquareSet(0, 134217728);
	board.king = new SquareSet(0, 268435456);
	return board;
};
var Horde = class extends Position {
	constructor() {
		super("horde");
	}
	reset() {
		this.board = hordeBoard();
		this.pockets = void 0;
		this.turn = "white";
		this.castles = Castles.default();
		this.castles.discardColor("white");
		this.epSquare = void 0;
		this.remainingChecks = void 0;
		this.halfmoves = 0;
		this.fullmoves = 1;
	}
	static default() {
		const pos = new this();
		pos.reset();
		return pos;
	}
	static fromSetup(setup) {
		const pos = new this();
		pos.setupUnchecked(setup);
		return pos.validate().map((_) => pos);
	}
	clone() {
		return super.clone();
	}
	validate() {
		if (this.board.occupied.isEmpty()) return n$2.err(new PositionError(IllegalSetup.Empty));
		if (this.board.king.size() !== 1) return n$2.err(new PositionError(IllegalSetup.Kings));
		const otherKing = this.board.kingOf(opposite(this.turn));
		if (defined(otherKing) && this.kingAttackers(otherKing, this.turn, this.board.occupied).nonEmpty()) return n$2.err(new PositionError(IllegalSetup.OppositeCheck));
		for (const color of COLORS) {
			const backranks = this.board.pieces(color, "king").isEmpty() ? SquareSet.backrank(opposite(color)) : SquareSet.backranks();
			if (this.board.pieces(color, "pawn").intersects(backranks)) return n$2.err(new PositionError(IllegalSetup.PawnsOnBackrank));
		}
		return n$2.ok(void 0);
	}
	hasInsufficientMaterial(color) {
		if (this.board.pieces(color, "king").nonEmpty()) return false;
		const oppositeSquareColor = (squareColor) => squareColor === "light" ? "dark" : "light";
		const coloredSquares = (squareColor) => squareColor === "light" ? SquareSet.lightSquares() : SquareSet.darkSquares();
		const hasBishopPair = (side) => {
			const bishops = this.board.pieces(side, "bishop");
			return bishops.intersects(SquareSet.darkSquares()) && bishops.intersects(SquareSet.lightSquares());
		};
		const horde = MaterialSide.fromBoard(this.board, color);
		const hordeBishops = (squareColor) => coloredSquares(squareColor).intersect(this.board.pieces(color, "bishop")).size();
		const hordeBishopColor = hordeBishops("light") >= 1 ? "light" : "dark";
		const hordeNum = horde.pawn + horde.knight + horde.rook + horde.queen + Math.min(hordeBishops("dark"), 2) + Math.min(hordeBishops("light"), 2);
		const pieces = MaterialSide.fromBoard(this.board, opposite(color));
		const piecesBishops = (squareColor) => coloredSquares(squareColor).intersect(this.board.pieces(opposite(color), "bishop")).size();
		const piecesNum = pieces.size();
		const piecesOfRoleNot = (piece) => piecesNum - piece;
		if (hordeNum === 0) return true;
		if (hordeNum >= 4) return false;
		if ((horde.pawn >= 1 || horde.queen >= 1) && hordeNum >= 2) return false;
		if (horde.rook >= 1 && hordeNum >= 2) {
			if (!(hordeNum === 2 && horde.rook === 1 && horde.bishop === 1 && piecesOfRoleNot(piecesBishops(hordeBishopColor)) === 1)) return false;
		}
		if (hordeNum === 1) {
			if (piecesNum === 1) return true;
			else if (horde.queen === 1) return !(pieces.pawn >= 1 || pieces.rook >= 1 || piecesBishops("light") >= 2 || piecesBishops("dark") >= 2);
			else if (horde.pawn === 1) {
				const pawnSquare = this.board.pieces(color, "pawn").last();
				const promoteToQueen = this.clone();
				promoteToQueen.board.set(pawnSquare, {
					color,
					role: "queen"
				});
				const promoteToKnight = this.clone();
				promoteToKnight.board.set(pawnSquare, {
					color,
					role: "knight"
				});
				return promoteToQueen.hasInsufficientMaterial(color) && promoteToKnight.hasInsufficientMaterial(color);
			} else if (horde.rook === 1) return !(pieces.pawn >= 2 || pieces.rook >= 1 && pieces.pawn >= 1 || pieces.rook >= 1 && pieces.knight >= 1 || pieces.pawn >= 1 && pieces.knight >= 1);
			else if (horde.bishop === 1) return !(piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 2 || piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 1 && pieces.pawn >= 1 || pieces.pawn >= 2);
			else if (horde.knight === 1) return !(piecesNum >= 4 && (pieces.knight >= 2 || pieces.pawn >= 2 || pieces.rook >= 1 && pieces.knight >= 1 || pieces.rook >= 1 && pieces.bishop >= 1 || pieces.knight >= 1 && pieces.bishop >= 1 || pieces.rook >= 1 && pieces.pawn >= 1 || pieces.knight >= 1 && pieces.pawn >= 1 || pieces.bishop >= 1 && pieces.pawn >= 1 || hasBishopPair(opposite(color)) && pieces.pawn >= 1) && (piecesBishops("dark") < 2 || piecesOfRoleNot(piecesBishops("dark")) >= 3) && (piecesBishops("light") < 2 || piecesOfRoleNot(piecesBishops("light")) >= 3));
		} else if (hordeNum === 2) if (piecesNum === 1) return true;
		else if (horde.knight === 2) return pieces.pawn + pieces.bishop + pieces.knight < 1;
		else if (hasBishopPair(color)) return !(pieces.pawn >= 1 || pieces.bishop >= 1 || pieces.knight >= 1 && pieces.rook + pieces.queen >= 1);
		else if (horde.bishop >= 1 && horde.knight >= 1) return !(pieces.pawn >= 1 || piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 1 || piecesOfRoleNot(piecesBishops(hordeBishopColor)) >= 3);
		else return !(pieces.pawn >= 1 && piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 1 || pieces.pawn >= 1 && pieces.knight >= 1 || piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 1 && pieces.knight >= 1 || piecesBishops(oppositeSquareColor(hordeBishopColor)) >= 2 || pieces.knight >= 2 || pieces.pawn >= 2);
		else if (hordeNum === 3) if (horde.knight === 2 && horde.bishop === 1 || horde.knight === 3 || hasBishopPair(color)) return false;
		else return piecesNum === 1;
		return true;
	}
	isVariantEnd() {
		return this.board.white.isEmpty() || this.board.black.isEmpty();
	}
	variantOutcome(_ctx) {
		if (this.board.white.isEmpty()) return { winner: "black" };
		if (this.board.black.isEmpty()) return { winner: "white" };
	}
};
var defaultPosition = (rules) => {
	switch (rules) {
		case "chess": return Chess.default();
		case "antichess": return Antichess.default();
		case "atomic": return Atomic.default();
		case "horde": return Horde.default();
		case "racingkings": return RacingKings.default();
		case "kingofthehill": return KingOfTheHill.default();
		case "3check": return ThreeCheck.default();
		case "crazyhouse": return Crazyhouse.default();
	}
};
var setupPosition = (rules, setup) => {
	switch (rules) {
		case "chess": return Chess.fromSetup(setup);
		case "antichess": return Antichess.fromSetup(setup);
		case "atomic": return Atomic.fromSetup(setup);
		case "horde": return Horde.fromSetup(setup);
		case "racingkings": return RacingKings.fromSetup(setup);
		case "kingofthehill": return KingOfTheHill.fromSetup(setup);
		case "3check": return ThreeCheck.fromSetup(setup);
		case "crazyhouse": return Crazyhouse.fromSetup(setup);
	}
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/pgn.js
/**
* Parse, transform and write PGN.
*
* ## Parser
*
* The parser will interpret any input as a PGN, creating a tree of
* syntactically valid (but not necessarily legal) moves, skipping any invalid
* tokens.
*
* ```ts
* import { parsePgn, startingPosition } from 'chessops/pgn';
* import { parseSan } from 'chessops/san';
*
* const pgn = '1. d4 d5 *';
* const games = parsePgn(pgn);
* for (const game of games) {
*   const pos = startingPosition(game.headers).unwrap();
*   for (const node of game.moves.mainline()) {
*     const move = parseSan(pos, node.san);
*     if (!move) break; // Illegal move
*     pos.play(move);
*   }
* }
* ```
*
* ## Streaming parser
*
* The module also provides a denial-of-service resistant streaming parser.
* It can be configured with a budget for reasonable complexity of a single
* game, fed with chunks of text, and will yield parsed games as they are
* completed.
*
* ```ts
*
* import { createReadStream } from 'fs';
* import { PgnParser } from 'chessops/pgn';
*
* const stream = createReadStream('games.pgn', { encoding: 'utf-8' });
*
* const parser = new PgnParser((game, err) => {
*   if (err) {
*     // Budget exceeded.
*     stream.destroy(err);
*   }
*
*   // Use game ...
* });
*
* await new Promise<void>(resolve =>
*   stream
*     .on('data', (chunk: string) => parser.parse(chunk, { stream: true }))
*     .on('close', () => {
*       parser.parse('');
*       resolve();
*     })
* );
* ```
*
* ## Augmenting the game tree
*
* You can use `walk` to visit all nodes in the game tree, or `transform`
* to augment it with user data.
*
* Both allow you to provide context. You update the context inside the
* callback, and it is automatically `clone()`-ed at each fork.
* In the example below, the current position `pos` is provided as context.
*
* ```ts
* import { transform } from 'chessops/pgn';
* import { makeFen } from 'chessops/fen';
* import { parseSan, makeSanAndPlay } from 'chessops/san';
*
* const pos = startingPosition(game.headers).unwrap();
* game.moves = transform(game.moves, pos, (pos, node) => {
*   const move = parseSan(pos, node.san);
*   if (!move) {
*     // Illegal move. Returning undefined cuts off the tree here.
*     return;
*   }
*
*   const san = makeSanAndPlay(pos, move); // Mutating pos!
*
*   return {
*     ...node, // Keep comments and annotation glyphs
*     san, // Normalized SAN
*     fen: makeFen(pos.toSetup()), // Add arbitrary user data to node
*   };
* });
* ```
*
* ## Writing
*
* Requires each node to at least have a `san` property.
*
* ```
* import { makePgn } from 'chessops/pgn';
*
* const rewrittenPgn = makePgn(game);
* ```
*
* @packageDocumentation
*/
var defaultGame = (initHeaders = defaultHeaders) => ({
	headers: initHeaders(),
	moves: new Node()
});
var Node = class {
	constructor() {
		this.children = [];
	}
	*mainlineNodes() {
		let node = this;
		while (node.children.length) {
			const child = node.children[0];
			yield child;
			node = child;
		}
	}
	*mainline() {
		for (const child of this.mainlineNodes()) yield child.data;
	}
	end() {
		let node = this;
		while (node.children.length) node = node.children[0];
		return node;
	}
};
var ChildNode = class extends Node {
	constructor(data) {
		super();
		this.data = data;
	}
};
var makeOutcome = (outcome) => {
	if (!outcome) return "*";
	else if (outcome.winner === "white") return "1-0";
	else if (outcome.winner === "black") return "0-1";
	else return "1/2-1/2";
};
var parseOutcome = (s) => {
	if (s === "1-0") return { winner: "white" };
	else if (s === "0-1") return { winner: "black" };
	else if (s === "1/2-1/2") return { winner: void 0 };
	else return;
};
var escapeHeader = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
var safeComment = (comment) => comment.replace(/\}/g, "");
var makePgn = (game) => {
	const builder = [], tokens = [];
	if (game.headers.size) {
		for (const [key, value] of game.headers.entries()) builder.push("[", key, " \"", escapeHeader(value), "\"]\n");
		builder.push("\n");
	}
	for (const comment of game.comments || []) tokens.push("{", safeComment(comment), "}");
	const fen = game.headers.get("FEN");
	const initialPly = fen ? parseFen$1(fen).unwrap((setup) => (setup.fullmoves - 1) * 2 + (setup.turn === "white" ? 0 : 1), (_) => 0) : 0;
	const stack = [];
	if (game.moves.children.length) {
		const variations = game.moves.children[Symbol.iterator]();
		stack.push({
			state: 0,
			ply: initialPly,
			node: variations.next().value,
			sidelines: variations,
			startsVariation: false,
			inVariation: false
		});
	}
	let forceMoveNumber = true;
	while (stack.length) {
		const frame = stack[stack.length - 1];
		if (frame.inVariation) {
			tokens.push(")");
			frame.inVariation = false;
			forceMoveNumber = true;
		}
		switch (frame.state) {
			case 0:
				for (const comment of frame.node.data.startingComments || []) {
					tokens.push("{", safeComment(comment), "}");
					forceMoveNumber = true;
				}
				if (forceMoveNumber || frame.ply % 2 === 0) {
					tokens.push(Math.floor(frame.ply / 2) + 1 + (frame.ply % 2 ? "..." : "."));
					forceMoveNumber = false;
				}
				tokens.push(frame.node.data.san);
				for (const nag of frame.node.data.nags || []) {
					tokens.push("$" + nag);
					forceMoveNumber = true;
				}
				for (const comment of frame.node.data.comments || []) tokens.push("{", safeComment(comment), "}");
				frame.state = 1;
			case 1: {
				const child = frame.sidelines.next();
				if (child.done) {
					if (frame.node.children.length) {
						const variations = frame.node.children[Symbol.iterator]();
						stack.push({
							state: 0,
							ply: frame.ply + 1,
							node: variations.next().value,
							sidelines: variations,
							startsVariation: false,
							inVariation: false
						});
					}
					frame.state = 2;
				} else {
					tokens.push("(");
					forceMoveNumber = true;
					stack.push({
						state: 0,
						ply: frame.ply,
						node: child.value,
						sidelines: [][Symbol.iterator](),
						startsVariation: true,
						inVariation: false
					});
					frame.inVariation = true;
				}
				break;
			}
			case 2: stack.pop();
		}
	}
	tokens.push(makeOutcome(parseOutcome(game.headers.get("Result"))));
	builder.push(tokens.join(" "), "\n");
	return builder.join("");
};
var defaultHeaders = () => new Map([
	["Event", "?"],
	["Site", "?"],
	["Date", "????.??.??"],
	["Round", "?"],
	["White", "?"],
	["Black", "?"],
	["Result", "*"]
]);
var BOM = "﻿";
var isWhitespace = (line) => /^\s*$/.test(line);
var isCommentLine = (line) => line.startsWith("%");
var PgnError = class extends Error {};
var PgnParser = class {
	constructor(emitGame, initHeaders = defaultHeaders, maxBudget = 1e6) {
		this.emitGame = emitGame;
		this.initHeaders = initHeaders;
		this.maxBudget = maxBudget;
		this.lineBuf = [];
		this.resetGame();
		this.state = 0;
	}
	resetGame() {
		this.budget = this.maxBudget;
		this.found = false;
		this.state = 1;
		this.game = defaultGame(this.initHeaders);
		this.stack = [{
			parent: this.game.moves,
			root: true
		}];
		this.commentBuf = [];
	}
	consumeBudget(cost) {
		this.budget -= cost;
		if (this.budget < 0) throw new PgnError("ERR_PGN_BUDGET");
	}
	parse(data, options) {
		if (this.budget < 0) return;
		try {
			let idx = 0;
			for (;;) {
				const nlIdx = data.indexOf("\n", idx);
				if (nlIdx === -1) break;
				const crIdx = nlIdx > idx && data[nlIdx - 1] === "\r" ? nlIdx - 1 : nlIdx;
				this.consumeBudget(nlIdx - idx);
				this.lineBuf.push(data.slice(idx, crIdx));
				idx = nlIdx + 1;
				this.handleLine();
			}
			this.consumeBudget(data.length - idx);
			this.lineBuf.push(data.slice(idx));
			if (!(options === null || options === void 0 ? void 0 : options.stream)) {
				this.handleLine();
				this.emit(void 0);
			}
		} catch (err) {
			this.emit(err);
		}
	}
	handleLine() {
		let freshLine = true;
		let line = this.lineBuf.join("");
		this.lineBuf = [];
		continuedLine: for (;;) switch (this.state) {
			case 0:
				if (line.startsWith(BOM)) line = line.slice(1);
				this.state = 1;
			case 1:
				if (isWhitespace(line) || isCommentLine(line)) return;
				this.found = true;
				this.state = 2;
			case 2: {
				if (isCommentLine(line)) return;
				let moreHeaders = true;
				while (moreHeaders) {
					moreHeaders = false;
					line = line.replace(/^\s*\[([A-Za-z0-9][A-Za-z0-9_+#=:-]*)\s+"((?:[^"\\]|\\"|\\\\)*)"\]/, (_match, headerName, headerValue) => {
						this.consumeBudget(200);
						this.game.headers.set(headerName, headerValue.replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
						moreHeaders = true;
						freshLine = false;
						return "";
					});
				}
				if (isWhitespace(line)) return;
				this.state = 3;
			}
			case 3: {
				if (freshLine) {
					if (isCommentLine(line)) return;
					if (isWhitespace(line)) return this.emit(void 0);
				}
				const tokenRegex = /(?:[NBKRQ]?[a-h]?[1-8]?[-x]?[a-h][1-8](?:=?[nbrqkNBRQK])?|[pnbrqkPNBRQK]?@[a-h][1-8]|O-O-O|0-0-0|O-O|0-0)[+#]?|--|Z0|0000|@@@@|{|;|\$\d{1,4}|[?!]{1,2}|\(|\)|\*|1-0|0-1|1\/2-1\/2/g;
				let match;
				while (match = tokenRegex.exec(line)) {
					const frame = this.stack[this.stack.length - 1];
					let token = match[0];
					if (token === ";") return;
					else if (token.startsWith("$")) this.handleNag(parseInt(token.slice(1), 10));
					else if (token === "!") this.handleNag(1);
					else if (token === "?") this.handleNag(2);
					else if (token === "!!") this.handleNag(3);
					else if (token === "??") this.handleNag(4);
					else if (token === "!?") this.handleNag(5);
					else if (token === "?!") this.handleNag(6);
					else if (token === "1-0" || token === "0-1" || token === "1/2-1/2" || token === "*") {
						if (this.stack.length === 1 && token !== "*") this.game.headers.set("Result", token);
					} else if (token === "(") {
						this.consumeBudget(100);
						this.stack.push({
							parent: frame.parent,
							root: false
						});
					} else if (token === ")") {
						if (this.stack.length > 1) this.stack.pop();
					} else if (token === "{") {
						const openIndex = tokenRegex.lastIndex;
						const beginIndex = line[openIndex] === " " ? openIndex + 1 : openIndex;
						line = line.slice(beginIndex);
						this.state = 4;
						continue continuedLine;
					} else {
						this.consumeBudget(100);
						if (token === "Z0" || token === "0000" || token === "@@@@") token = "--";
						else if (token.startsWith("0")) token = token.replace(/0/g, "O");
						if (frame.node) frame.parent = frame.node;
						frame.node = new ChildNode({
							san: token,
							startingComments: frame.startingComments
						});
						frame.startingComments = void 0;
						frame.root = false;
						frame.parent.children.push(frame.node);
					}
				}
				return;
			}
			case 4: {
				const closeIndex = line.indexOf("}");
				if (closeIndex === -1) {
					this.commentBuf.push(line);
					return;
				} else {
					const endIndex = closeIndex > 0 && line[closeIndex - 1] === " " ? closeIndex - 1 : closeIndex;
					this.commentBuf.push(line.slice(0, endIndex));
					this.handleComment();
					line = line.slice(closeIndex);
					this.state = 3;
					freshLine = false;
				}
			}
		}
	}
	handleNag(nag) {
		var _a;
		this.consumeBudget(50);
		const frame = this.stack[this.stack.length - 1];
		if (frame.node) {
			(_a = frame.node.data).nags || (_a.nags = []);
			frame.node.data.nags.push(nag);
		}
	}
	handleComment() {
		var _a, _b;
		this.consumeBudget(100);
		const frame = this.stack[this.stack.length - 1];
		const comment = this.commentBuf.join("\n");
		this.commentBuf = [];
		if (frame.node) {
			(_a = frame.node.data).comments || (_a.comments = []);
			frame.node.data.comments.push(comment);
		} else if (frame.root) {
			(_b = this.game).comments || (_b.comments = []);
			this.game.comments.push(comment);
		} else {
			frame.startingComments || (frame.startingComments = []);
			frame.startingComments.push(comment);
		}
	}
	emit(err) {
		if (this.state === 4) this.handleComment();
		if (err) return this.emitGame(this.game, err);
		if (this.found) this.emitGame(this.game, void 0);
		this.resetGame();
	}
};
var parsePgn = (pgn, initHeaders = defaultHeaders) => {
	const games = [];
	new PgnParser((game) => games.push(game), initHeaders, NaN).parse(pgn);
	return games;
};
var parseVariant = (variant) => {
	switch ((variant || "chess").toLowerCase()) {
		case "chess":
		case "chess960":
		case "chess 960":
		case "standard":
		case "from position":
		case "classical":
		case "normal":
		case "fischerandom":
		case "fischerrandom":
		case "fischer random":
		case "wild/0":
		case "wild/1":
		case "wild/2":
		case "wild/3":
		case "wild/4":
		case "wild/5":
		case "wild/6":
		case "wild/7":
		case "wild/8":
		case "wild/8a": return "chess";
		case "crazyhouse":
		case "crazy house":
		case "house":
		case "zh": return "crazyhouse";
		case "king of the hill":
		case "koth":
		case "kingofthehill": return "kingofthehill";
		case "three-check":
		case "three check":
		case "threecheck":
		case "three check chess":
		case "3-check":
		case "3 check":
		case "3check": return "3check";
		case "antichess":
		case "anti chess":
		case "anti": return "antichess";
		case "atomic":
		case "atom":
		case "atomic chess": return "atomic";
		case "horde":
		case "horde chess": return "horde";
		case "racing kings":
		case "racingkings":
		case "racing":
		case "race": return "racingkings";
		default: return;
	}
};
var startingPosition = (headers) => {
	const rules = parseVariant(headers.get("Variant"));
	if (!rules) return n$2.err(new PositionError(IllegalSetup.Variant));
	const fen = headers.get("FEN");
	if (fen) return parseFen$1(fen).chain((setup) => setupPosition(rules, setup));
	else return n$2.ok(defaultPosition(rules));
};
function parseCommentShapeColor(str) {
	switch (str) {
		case "G": return "green";
		case "R": return "red";
		case "Y": return "yellow";
		case "B": return "blue";
		default: return;
	}
}
var parseCommentShape = (str) => {
	const color = parseCommentShapeColor(str.slice(0, 1));
	const from = parseSquare(str.slice(1, 3));
	const to = parseSquare(str.slice(3, 5));
	if (!color || !defined(from)) return;
	if (str.length === 3) return {
		color,
		from,
		to: from
	};
	if (str.length === 5 && defined(to)) return {
		color,
		from,
		to
	};
};
var parseComment = (comment) => {
	let emt, clock, evaluation;
	const shapes = [];
	return {
		text: comment.replace(/\s?\[%(emt|clk)\s(\d{1,5}):(\d{1,2}):(\d{1,2}(?:\.\d{0,3})?)\]\s?/g, (_, annotation, hours, minutes, seconds) => {
			const value = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseFloat(seconds);
			if (annotation === "emt") emt = value;
			else if (annotation === "clk") clock = value;
			return "  ";
		}).replace(/\s?\[%(?:csl|cal)\s([RGYB][a-h][1-8](?:[a-h][1-8])?(?:,[RGYB][a-h][1-8](?:[a-h][1-8])?)*)\]\s?/g, (_, arrows) => {
			for (const arrow of arrows.split(",")) shapes.push(parseCommentShape(arrow));
			return "  ";
		}).replace(/\s?\[%eval\s(?:#([+-]?\d{1,5})|([+-]?(?:\d{1,5}|\d{0,5}\.\d{1,2})))(?:,(\d{1,5}))?\]\s?/g, (_, mate, pawns, d) => {
			const depth = d && parseInt(d, 10);
			evaluation = mate ? {
				mate: parseInt(mate, 10),
				depth
			} : {
				pawns: parseFloat(pawns),
				depth
			};
			return "  ";
		}).trim(),
		shapes,
		emt,
		clock,
		evaluation
	};
};
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/ts-pattern@5.0.8/node_modules/ts-pattern/dist/index.js
var t = Symbol.for("@ts-pattern/matcher"), e = Symbol.for("@ts-pattern/isVariadic"), n$1 = "@ts-pattern/anonymous-select-key", r = (t) => Boolean(t && "object" == typeof t), i = (e) => e && !!e[t], s = (n, o, c) => {
	if (i(n)) {
		const { matched: r, selections: i } = n[t]().match(o);
		return r && i && Object.keys(i).forEach((t) => c(t, i[t])), r;
	}
	if (r(n)) {
		if (!r(o)) return !1;
		if (Array.isArray(n)) {
			if (!Array.isArray(o)) return !1;
			let t = [], r = [], a = [];
			for (const s of n.keys()) {
				const o = n[s];
				i(o) && o[e] ? a.push(o) : a.length ? r.push(o) : t.push(o);
			}
			if (a.length) {
				if (a.length > 1) throw new Error("Pattern error: Using `...P.array(...)` several times in a single pattern is not allowed.");
				if (o.length < t.length + r.length) return !1;
				const e = o.slice(0, t.length), n = 0 === r.length ? [] : o.slice(-r.length), i = o.slice(t.length, 0 === r.length ? Infinity : -r.length);
				return t.every((t, n) => s(t, e[n], c)) && r.every((t, e) => s(t, n[e], c)) && (0 === a.length || s(a[0], i, c));
			}
			return n.length === o.length && n.every((t, e) => s(t, o[e], c));
		}
		return Object.keys(n).every((e) => {
			const r = n[e];
			return (e in o || i(a = r) && "optional" === a[t]().matcherType) && s(r, o[e], c);
			var a;
		});
	}
	return Object.is(o, n);
}, o = (e) => {
	var n, s, a;
	return r(e) ? i(e) ? null != (n = null == (s = (a = e[t]()).getSelectionKeys) ? void 0 : s.call(a)) ? n : [] : Array.isArray(e) ? c(e, o) : c(Object.values(e), o) : [];
}, c = (t, e) => t.reduce((t, n) => t.concat(e(n)), []);
function u$1(t) {
	return Object.assign(t, {
		optional: () => l(t),
		and: (e) => m(t, e),
		or: (e) => d$1(t, e),
		select: (e) => void 0 === e ? p$1(t) : p$1(e, t)
	});
}
function h(t) {
	return Object.assign(((t) => Object.assign(t, { [Symbol.iterator]() {
		let n = 0;
		const r = [{
			value: Object.assign(t, { [e]: !0 }),
			done: !1
		}, {
			done: !0,
			value: void 0
		}];
		return { next: () => {
			var t;
			return null != (t = r[n++]) ? t : r.at(-1);
		} };
	} }))(t), {
		optional: () => h(l(t)),
		select: (e) => h(void 0 === e ? p$1(t) : p$1(e, t))
	});
}
function l(e) {
	return u$1({ [t]: () => ({
		match: (t) => {
			let n = {};
			const r = (t, e) => {
				n[t] = e;
			};
			return void 0 === t ? (o(e).forEach((t) => r(t, void 0)), {
				matched: !0,
				selections: n
			}) : {
				matched: s(e, t, r),
				selections: n
			};
		},
		getSelectionKeys: () => o(e),
		matcherType: "optional"
	}) });
}
function m(...e) {
	return u$1({ [t]: () => ({
		match: (t) => {
			let n = {};
			const r = (t, e) => {
				n[t] = e;
			};
			return {
				matched: e.every((e) => s(e, t, r)),
				selections: n
			};
		},
		getSelectionKeys: () => c(e, o),
		matcherType: "and"
	}) });
}
function d$1(...e) {
	return u$1({ [t]: () => ({
		match: (t) => {
			let n = {};
			const r = (t, e) => {
				n[t] = e;
			};
			return c(e, o).forEach((t) => r(t, void 0)), {
				matched: e.some((e) => s(e, t, r)),
				selections: n
			};
		},
		getSelectionKeys: () => c(e, o),
		matcherType: "or"
	}) });
}
function y$1(e) {
	return { [t]: () => ({ match: (t) => ({ matched: Boolean(e(t)) }) }) };
}
function p$1(...e) {
	const r = "string" == typeof e[0] ? e[0] : void 0, i = 2 === e.length ? e[1] : "string" == typeof e[0] ? void 0 : e[0];
	return u$1({ [t]: () => ({
		match: (t) => {
			let e = { [null != r ? r : n$1]: t };
			return {
				matched: void 0 === i || s(i, t, (t, n) => {
					e[t] = n;
				}),
				selections: e
			};
		},
		getSelectionKeys: () => [null != r ? r : n$1].concat(void 0 === i ? [] : o(i))
	}) });
}
function v$1(t) {
	return "number" == typeof t;
}
function b$1(t) {
	return "string" == typeof t;
}
function w(t) {
	return "bigint" == typeof t;
}
u$1(y$1(function(t) {
	return !0;
}));
var j = (t) => Object.assign(u$1(t), {
	startsWith: (e) => {
		return j(m(t, (n = e, y$1((t) => b$1(t) && t.startsWith(n)))));
		var n;
	},
	endsWith: (e) => {
		return j(m(t, (n = e, y$1((t) => b$1(t) && t.endsWith(n)))));
		var n;
	},
	minLength: (e) => j(m(t, ((t) => y$1((e) => b$1(e) && e.length >= t))(e))),
	maxLength: (e) => j(m(t, ((t) => y$1((e) => b$1(e) && e.length <= t))(e))),
	includes: (e) => {
		return j(m(t, (n = e, y$1((t) => b$1(t) && t.includes(n)))));
		var n;
	},
	regex: (e) => {
		return j(m(t, (n = e, y$1((t) => b$1(t) && Boolean(t.match(n))))));
		var n;
	}
});
j(y$1(b$1));
var K = (t) => Object.assign(u$1(t), {
	between: (e, n) => K(m(t, ((t, e) => y$1((n) => v$1(n) && t <= n && e >= n))(e, n))),
	lt: (e) => K(m(t, ((t) => y$1((e) => v$1(e) && e < t))(e))),
	gt: (e) => K(m(t, ((t) => y$1((e) => v$1(e) && e > t))(e))),
	lte: (e) => K(m(t, ((t) => y$1((e) => v$1(e) && e <= t))(e))),
	gte: (e) => K(m(t, ((t) => y$1((e) => v$1(e) && e >= t))(e))),
	int: () => K(m(t, y$1((t) => v$1(t) && Number.isInteger(t)))),
	finite: () => K(m(t, y$1((t) => v$1(t) && Number.isFinite(t)))),
	positive: () => K(m(t, y$1((t) => v$1(t) && t > 0))),
	negative: () => K(m(t, y$1((t) => v$1(t) && t < 0)))
});
K(y$1(v$1));
var A = (t) => Object.assign(u$1(t), {
	between: (e, n) => A(m(t, ((t, e) => y$1((n) => w(n) && t <= n && e >= n))(e, n))),
	lt: (e) => A(m(t, ((t) => y$1((e) => w(e) && e < t))(e))),
	gt: (e) => A(m(t, ((t) => y$1((e) => w(e) && e > t))(e))),
	lte: (e) => A(m(t, ((t) => y$1((e) => w(e) && e <= t))(e))),
	gte: (e) => A(m(t, ((t) => y$1((e) => w(e) && e >= t))(e))),
	positive: () => A(m(t, y$1((t) => w(t) && t > 0))),
	negative: () => A(m(t, y$1((t) => w(t) && t < 0)))
});
A(y$1(w)), u$1(y$1(function(t) {
	return "boolean" == typeof t;
})), u$1(y$1(function(t) {
	return "symbol" == typeof t;
})), u$1(y$1(function(t) {
	return null == t;
}));
//#endregion
//#region src/utils/chessops.ts
function positionFromFen(fen) {
	const [setup, error] = parseFen$1(fen).unwrap((v) => [v, null], (e) => [null, e]);
	if (error) return [null, error];
	return Chess.fromSetup(setup).unwrap((v) => [v, null], (e) => [null, e]);
}
//#endregion
//#region src/web/pgn.ts
var MAX_PLAYER_NAMES = 80;
function normalizeWebFen(fen) {
	return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}
function parsePgnDatabase(name, pgn, importedAt = Date.now()) {
	const id = createDatabaseId(name, importedAt);
	const parsedGames = parsePgn(pgn);
	const warnings = [];
	const games = [];
	const players = /* @__PURE__ */ new Map();
	let latestDate = null;
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
			warnings
		});
		const rootVariations = buildWebVariationLines({
			children: game.moves.children.slice(1),
			position,
			previousPly: 0,
			gameIndex: index,
			warnings
		});
		const result = normalizeResult(game.headers.get("Result"));
		const date = game.headers.get("Date") ?? game.headers.get("UTCDate") ?? "";
		latestDate = pickLatestDate(latestDate, date);
		const white = game.headers.get("White") ?? "?";
		const black = game.headers.get("Black") ?? "?";
		countPlayer(players, white);
		countPlayer(players, black);
		const webGame = {
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
			importedAt
		};
		if (rootVariations.length > 0) webGame.rootVariations = rootVariations;
		const comments = formatWebComments(game.comments);
		if (comments.length > 0) webGame.comments = comments;
		games.push(webGame);
	});
	return {
		database: {
			id,
			name,
			importedAt,
			updatedAt: importedAt,
			gameCount: games.length,
			sizeBytes: new Blob([pgn]).size,
			latestDate,
			playerNames: Array.from(players.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], void 0, { sensitivity: "base" })).slice(0, MAX_PLAYER_NAMES).map(([player]) => player)
		},
		games,
		warnings
	};
}
function playUciMove(fen, uci) {
	const [position] = positionFromFen(fen);
	if (!position) return null;
	const move = parseUci(uci);
	if (!move || !position.isLegal(move)) return null;
	const san = makeSan(position, move);
	const normalizedUci = makeMoveUci(position, move);
	position.play(move);
	return {
		san,
		uci: normalizedUci,
		fenAfter: makeFen(position.toSetup())
	};
}
function createDatabaseId(name, importedAt) {
	return `${name.toLowerCase().replace(/\.[^.]+$/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "pgn"}-${importedAt.toString(36)}`;
}
function makeMoveUci(position, move) {
	const normalized = normalizeMove$1(position, move);
	return isNormal(normalized) ? makeUci(normalized) : null;
}
function buildWebMoveLine({ firstChild, position, previousPly, gameIndex, warnings }) {
	const line = [];
	let currentChild = firstChild;
	let currentPosition = position.clone();
	let currentPly = previousPly;
	let currentFen = makeFen(currentPosition.toSetup());
	while (currentChild) {
		const parsed = buildWebMove({
			child: currentChild,
			position: currentPosition,
			fenBefore: currentFen,
			previousPly: currentPly,
			gameIndex,
			warnings
		});
		if (!parsed) break;
		line.push(parsed.move);
		currentPosition = parsed.positionAfter;
		currentFen = parsed.move.fenAfter;
		currentPly = parsed.move.ply;
		currentChild = currentChild.children[0];
	}
	return line;
}
function buildWebMove({ child, position, fenBefore, previousPly, gameIndex, warnings }) {
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
	const webMove = {
		ply,
		color: ply % 2 === 1 ? "white" : "black",
		san,
		uci,
		fenBefore,
		fenAfter: makeFen(positionAfter.toSetup())
	};
	const clockSeconds = findLastWebCommentValue(child.data.comments, (comment) => {
		return parseComment(comment).clock;
	});
	const timestampSeconds = findLastWebCommentValue(child.data.comments, parseWebPgnTimestampSeconds);
	const annotations = formatWebNags(child.data.nags);
	const startingComments = formatWebComments(child.data.startingComments);
	const comments = formatWebComments(child.data.comments);
	const variations = buildWebVariationLines({
		children: child.children.slice(1),
		position: positionAfter,
		previousPly: ply,
		gameIndex,
		warnings
	});
	if (clockSeconds !== void 0) webMove.clockSeconds = clockSeconds;
	if (timestampSeconds !== void 0) webMove.timestampSeconds = timestampSeconds;
	if (annotations.length > 0) webMove.annotations = annotations;
	if (startingComments.length > 0) webMove.startingComments = startingComments;
	if (comments.length > 0) webMove.comments = comments;
	if (variations.length > 0) webMove.variations = variations;
	return {
		move: webMove,
		positionAfter
	};
}
function buildWebVariationLines({ children, position, previousPly, gameIndex, warnings }) {
	return children.map((child) => buildWebMoveLine({
		firstChild: child,
		position,
		previousPly,
		gameIndex,
		warnings
	})).filter((line) => line.length > 0);
}
function normalizeResult(value) {
	return value === "1-0" || value === "0-1" || value === "1/2-1/2" ? value : "*";
}
function parseRating(value) {
	if (!value || value === "-") return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}
function countPlayer(players, name) {
	const normalized = name.trim();
	if (!normalized || normalized === "?") return;
	players.set(normalized, (players.get(normalized) ?? 0) + 1);
}
function pickLatestDate(current, candidate) {
	const candidateKey = sortableDate(candidate);
	if (!candidateKey) return current;
	const currentKey = sortableDate(current ?? "");
	return !currentKey || candidateKey > currentKey ? candidate : current;
}
function sortableDate(value) {
	const digits = value.replace(/\D/g, "");
	return digits.length > 0 ? Number(digits.padEnd(8, "0")) : 0;
}
function formatWebNags(nags) {
	return [...new Set((nags ?? []).map(formatWebNag))];
}
function formatWebNag(nag) {
	switch (nag) {
		case 1: return "!";
		case 2: return "?";
		case 3: return "!!";
		case 4: return "??";
		case 5: return "!?";
		case 6: return "?!";
		default: return `$${nag}`;
	}
}
function formatWebComments(comments) {
	return (comments ?? []).map(formatWebComment).filter((comment) => comment.length > 0);
}
function formatWebComment(comment) {
	return parseComment(comment).text.replace(/\s?\[%timestamp\s+\d+(?:\.\d+)?\]\s?/gi, " ").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function findLastWebCommentValue(comments, readValue) {
	for (let index = (comments?.length ?? 0) - 1; index >= 0; index -= 1) {
		const value = readValue(comments?.[index] ?? "");
		if (value !== void 0) return value;
	}
}
function parseWebPgnTimestampSeconds(comment) {
	const match = comment.match(/\[%timestamp\s+(\d+(?:\.\d+)?)\]/i);
	if (!match) return void 0;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : void 0;
}
function parseWebPgnStartSeconds(headers) {
	const date = headers.get("UTCDate") ?? headers.get("Date");
	const time = headers.get("UTCTime") ?? headers.get("Time");
	if (!date || !time) return null;
	const dateMatch = date.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
	const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (!dateMatch || !timeMatch) return null;
	const timestamp = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3] ?? "0"));
	return Number.isFinite(timestamp) ? timestamp / 1e3 : null;
}
//#endregion
//#region src/utils/tacticalMotifs/siteClassifier/chess-primitives.js
/**
* chess-primitives.js — Rich chess board query layer
*
* Standalone module that parses FEN and provides attack / pin / ray
* primitives needed by theme-detector.js.  Uses the same 64-index
* layout as ChessLite (index 0 = a8, index 63 = h1).
*
* Adapted from lichess-puzzler util.py piece-value and attack helpers.
*/
var FILES$2 = "abcdefgh";
var PIECE_VALUES = {
	P: 1,
	p: 1,
	N: 3,
	n: 3,
	B: 3,
	b: 3,
	R: 5,
	r: 5,
	Q: 9,
	q: 9,
	K: 99,
	k: 99
};
var KNIGHT_OFFSETS = [
	[-2, -1],
	[-2, 1],
	[-1, -2],
	[-1, 2],
	[1, -2],
	[1, 2],
	[2, -1],
	[2, 1]
];
var DIAG_DIRS$1 = [
	[-1, -1],
	[-1, 1],
	[1, -1],
	[1, 1]
];
var ORTH_DIRS$1 = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1]
];
var ALL_DIRS$1 = DIAG_DIRS$1.concat(ORTH_DIRS$1);
function ChessPrimitives(fen) {
	const board = new Array(64).fill(null);
	let side = "w";
	let epIdx = -1;
	function rcOf(i) {
		return {
			r: Math.floor(i / 8),
			c: i % 8
		};
	}
	function idxOf(r, c) {
		return r * 8 + c;
	}
	function inBounds(r, c) {
		return r >= 0 && r < 8 && c >= 0 && c < 8;
	}
	function idxToSq(i) {
		return FILES$2[i % 8] + (8 - Math.floor(i / 8));
	}
	function sqToIdx(sq) {
		return (7 - (parseInt(sq[1], 10) - 1)) * 8 + FILES$2.indexOf(sq[0]);
	}
	function colorOf(pc) {
		if (!pc) return null;
		return pc === pc.toUpperCase() ? "w" : "b";
	}
	function typeOf(pc) {
		if (!pc) return null;
		return pc.toUpperCase();
	}
	function loadFEN(f) {
		board.fill(null);
		const parts = f.trim().split(/\s+/);
		const rows = parts[0].split("/");
		for (let r = 0; r < 8; r++) {
			let file = 0;
			for (const ch of rows[r]) if (/[1-8]/.test(ch)) file += parseInt(ch, 10);
			else {
				board[r * 8 + file] = ch;
				file++;
			}
		}
		side = parts[1] || "w";
		epIdx = parts[3] && parts[3] !== "-" ? sqToIdx(parts[3]) : -1;
	}
	function pieceAt(idx) {
		return board[idx];
	}
	function valueOf(idx) {
		return PIECE_VALUES[board[idx]] || 0;
	}
	function pieceValue(pc) {
		return PIECE_VALUES[pc] || 0;
	}
	function kingIdx(color) {
		const k = color === "w" ? "K" : "k";
		for (let i = 0; i < 64; i++) if (board[i] === k) return i;
		return -1;
	}
	function attacks(fromIdx) {
		const pc = board[fromIdx];
		if (!pc) return [];
		const t = pc.toUpperCase();
		const clr = colorOf(pc);
		const { r, c } = rcOf(fromIdx);
		const out = [];
		if (t === "P") {
			const dir = clr === "w" ? -1 : 1;
			if (inBounds(r + dir, c - 1)) out.push(idxOf(r + dir, c - 1));
			if (inBounds(r + dir, c + 1)) out.push(idxOf(r + dir, c + 1));
		} else if (t === "N") {
			for (const [dr, dc] of KNIGHT_OFFSETS) if (inBounds(r + dr, c + dc)) out.push(idxOf(r + dr, c + dc));
		} else if (t === "K") {
			for (const [dr, dc] of ALL_DIRS$1) if (inBounds(r + dr, c + dc)) out.push(idxOf(r + dr, c + dc));
		} else {
			const dirs = t === "B" ? DIAG_DIRS$1 : t === "R" ? ORTH_DIRS$1 : ALL_DIRS$1;
			for (const [dr, dc] of dirs) {
				let rr = r + dr, cc = c + dc;
				while (inBounds(rr, cc)) {
					out.push(idxOf(rr, cc));
					if (board[idxOf(rr, cc)]) break;
					rr += dr;
					cc += dc;
				}
			}
		}
		return out;
	}
	function attackers(color, targetIdx) {
		const { r, c } = rcOf(targetIdx);
		const out = [];
		const pawnDir = color === "w" ? 1 : -1;
		const pawnChar = color === "w" ? "P" : "p";
		for (const dc of [-1, 1]) {
			const pr = r + pawnDir, pc2 = c + dc;
			if (inBounds(pr, pc2) && board[idxOf(pr, pc2)] === pawnChar) out.push(idxOf(pr, pc2));
		}
		const knightChar = color === "w" ? "N" : "n";
		for (const [dr, dc] of KNIGHT_OFFSETS) {
			const rr = r + dr, cc = c + dc;
			if (inBounds(rr, cc) && board[idxOf(rr, cc)] === knightChar) out.push(idxOf(rr, cc));
		}
		const kingChar = color === "w" ? "K" : "k";
		for (const [dr, dc] of ALL_DIRS$1) if (inBounds(r + dr, c + dc) && board[idxOf(r + dr, c + dc)] === kingChar) out.push(idxOf(r + dr, c + dc));
		const bishopChar = color === "w" ? "B" : "b";
		const rookChar = color === "w" ? "R" : "r";
		const queenChar = color === "w" ? "Q" : "q";
		for (const [dr, dc] of DIAG_DIRS$1) {
			let rr = r + dr, cc = c + dc;
			while (inBounds(rr, cc)) {
				const p = board[idxOf(rr, cc)];
				if (p) {
					if (p === bishopChar || p === queenChar) out.push(idxOf(rr, cc));
					break;
				}
				rr += dr;
				cc += dc;
			}
		}
		for (const [dr, dc] of ORTH_DIRS$1) {
			let rr = r + dr, cc = c + dc;
			while (inBounds(rr, cc)) {
				const p = board[idxOf(rr, cc)];
				if (p) {
					if (p === rookChar || p === queenChar) out.push(idxOf(rr, cc));
					break;
				}
				rr += dr;
				cc += dc;
			}
		}
		return out;
	}
	function squaresBetween(idx1, idx2) {
		const { r: r1, c: c1 } = rcOf(idx1);
		const { r: r2, c: c2 } = rcOf(idx2);
		const dr = Math.sign(r2 - r1);
		const dc = Math.sign(c2 - c1);
		if (dr === 0 && dc === 0) return [];
		if (dr !== 0 && dc !== 0 && Math.abs(r2 - r1) !== Math.abs(c2 - c1)) return [];
		const out = [];
		let rr = r1 + dr, cc = c1 + dc;
		while (rr !== r2 || cc !== c2) {
			out.push(idxOf(rr, cc));
			rr += dr;
			cc += dc;
		}
		return out;
	}
	function isPinned(squareIdx) {
		const pc = board[squareIdx];
		if (!pc) return null;
		const clr = colorOf(pc);
		const ki = kingIdx(clr);
		if (ki < 0) return null;
		const { r: kr, c: kc } = rcOf(ki);
		const { r: sr, c: sc } = rcOf(squareIdx);
		const dr = Math.sign(sr - kr);
		const dc = Math.sign(sc - kc);
		if (dr === 0 && dc === 0) return null;
		if (dr !== 0 && dc !== 0 && Math.abs(sr - kr) !== Math.abs(sc - kc)) return null;
		if (dr === 0 && sr !== kr) return null;
		if (dc === 0 && sc !== kc) return null;
		let rr = kr + dr, cc = kc + dc;
		while ((rr !== sr || cc !== sc) && inBounds(rr, cc)) {
			if (board[idxOf(rr, cc)]) return null;
			rr += dr;
			cc += dc;
		}
		rr = sr + dr;
		cc = sc + dc;
		while (inBounds(rr, cc)) {
			const p = board[idxOf(rr, cc)];
			if (p) {
				if (colorOf(p) === clr) return null;
				const t = p.toUpperCase();
				const isDiag = dr !== 0 && dc !== 0;
				if (isDiag && (t === "B" || t === "Q")) return idxOf(rr, cc);
				if (!isDiag && (t === "R" || t === "Q")) return idxOf(rr, cc);
				return null;
			}
			rr += dr;
			cc += dc;
		}
		return null;
	}
	function isHanging(squareIdx) {
		const pc = board[squareIdx];
		if (!pc) return false;
		const clr = colorOf(pc);
		return attackers(clr === "w" ? "b" : "w", squareIdx).length > 0 && attackers(clr, squareIdx).length === 0;
	}
	function canBeTakenByLower(squareIdx) {
		const pc = board[squareIdx];
		if (!pc) return false;
		const opp = colorOf(pc) === "w" ? "b" : "w";
		const val = PIECE_VALUES[pc];
		for (const ai of attackers(opp, squareIdx)) {
			const ap = board[ai];
			if (ap && ap.toUpperCase() !== "K" && PIECE_VALUES[ap] < val) return true;
		}
		return false;
	}
	function isInBadSpot(squareIdx) {
		const pc = board[squareIdx];
		if (!pc) return false;
		if (attackers(colorOf(pc) === "w" ? "b" : "w", squareIdx).length === 0) return false;
		return isHanging(squareIdx) || canBeTakenByLower(squareIdx);
	}
	function checkerCount(color) {
		const ki = kingIdx(color);
		if (ki < 0) return 0;
		return attackers(color === "w" ? "b" : "w", ki).length;
	}
	function revealsAttack(fromIdx, toIdx, attackerColor) {
		const oppColor = attackerColor === "w" ? "b" : "w";
		const { r: fr, c: fc } = rcOf(fromIdx);
		const origFrom = board[fromIdx];
		const origTo = board[toIdx];
		board[fromIdx] = null;
		board[toIdx] = origFrom;
		let found = false;
		for (const [dr, dc] of ALL_DIRS$1) {
			let attackerIdx = -1;
			let rr = fr + dr, cc = fc + dc;
			while (inBounds(rr, cc)) {
				const p = board[idxOf(rr, cc)];
				if (p) {
					if (colorOf(p) === attackerColor) {
						const t = p.toUpperCase();
						const isDiag = dr !== 0 && dc !== 0;
						if (isDiag && (t === "B" || t === "Q") || !isDiag && (t === "R" || t === "Q")) attackerIdx = idxOf(rr, cc);
					}
					break;
				}
				rr += dr;
				cc += dc;
			}
			if (attackerIdx < 0) continue;
			rr = fr - dr;
			cc = fc - dc;
			while (inBounds(rr, cc)) {
				const p = board[idxOf(rr, cc)];
				if (p) {
					if (colorOf(p) === oppColor && p.toUpperCase() !== "P") found = true;
					break;
				}
				rr -= dr;
				cc -= dc;
			}
			if (found) break;
		}
		board[fromIdx] = origFrom;
		board[toIdx] = origTo;
		return found;
	}
	if (fen) loadFEN(fen);
	return {
		loadFEN,
		pieceAt,
		valueOf,
		pieceValue,
		colorOf,
		typeOf,
		kingIdx,
		attacks,
		attackers,
		isPinned,
		squaresBetween,
		isHanging,
		canBeTakenByLower,
		isInBadSpot,
		checkerCount,
		revealsAttack,
		idxToSq,
		sqToIdx,
		rcOf,
		PIECE_VALUES,
		side: () => side,
		epIndex: () => epIdx
	};
}
//#endregion
//#region src/utils/tacticalMotifs/siteClassifier/analysis.js
/**
* DOM-free compatibility export for the vendored site tactical classifier.
*
* ChessLite is copied from public/js/services/analysis.js in Chess Mistake Trainer.
* Keep this file limited to the ChessLite function: the original module also owns
* browser UI, storage, and network behavior that does not belong in En Croissant.
*/
function ChessLite() {
	const FILES = "abcdefgh";
	let board = new Array(64).fill(null);
	let side = "w";
	let castling = {
		K: true,
		Q: true,
		k: true,
		q: true
	};
	let ep = -1, halfmove = 0, fullmove = 1;
	function idx(file, rank) {
		return (7 - (rank - 1)) * 8 + file;
	}
	function sqToIdx(sq) {
		return idx(FILES.indexOf(sq[0]), parseInt(sq[1], 10));
	}
	function idxToSq(i) {
		const r = 8 - Math.floor(i / 8);
		return FILES[i % 8] + r;
	}
	function pieceColor(pc) {
		return pc === pc?.toUpperCase() ? "w" : "b";
	}
	function reset() {
		loadFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	}
	function loadFEN(f) {
		board.fill(null);
		const parts = f.trim().split(/\s+/);
		const rows = parts[0].split("/");
		for (let r = 0; r < 8; r++) {
			let file = 0;
			for (const ch of rows[r]) if (/[1-8]/.test(ch)) file += parseInt(ch, 10);
			else {
				board[r * 8 + file] = ch;
				file++;
			}
		}
		side = parts[1] || "w";
		castling = {
			K: false,
			Q: false,
			k: false,
			q: false
		};
		if (parts[2] && parts[2] !== "-") {
			for (const c of parts[2]) if (castling.hasOwnProperty(c)) castling[c] = true;
		}
		ep = parts[3] && parts[3] !== "-" ? sqToIdx(parts[3]) : -1;
		halfmove = parts[4] ? parseInt(parts[4], 10) : 0;
		fullmove = parts[5] ? parseInt(parts[5], 10) : 1;
		return true;
	}
	function fen() {
		let s = "";
		for (let r = 0; r < 8; r++) {
			let empty = 0;
			for (let f = 0; f < 8; f++) {
				const p = board[r * 8 + f];
				if (!p) empty++;
				else {
					if (empty) {
						s += empty;
						empty = 0;
					}
					s += p;
				}
			}
			if (empty) s += empty;
			if (r < 7) s += "/";
		}
		s += " " + side + " ";
		let cstr = "";
		if (castling.K) cstr += "K";
		if (castling.Q) cstr += "Q";
		if (castling.k) cstr += "k";
		if (castling.q) cstr += "q";
		s += cstr || "-";
		s += " " + (ep >= 0 ? idxToSq(ep) : "-");
		s += " " + halfmove + " " + fullmove;
		return s;
	}
	function rcOf(i) {
		return {
			r: Math.floor(i / 8),
			c: i % 8
		};
	}
	function inBounds(r, c) {
		return r >= 0 && r < 8 && c >= 0 && c < 8;
	}
	function kingIndex(color) {
		const K = color === "w" ? "K" : "k";
		for (let i = 0; i < 64; i++) if (board[i] === K) return i;
		return -1;
	}
	function squareAttacked(i, by) {
		const { r, c } = rcOf(i);
		if (by === "w") {
			const rr = r + 1;
			if (inBounds(rr, c - 1) && board[rr * 8 + c - 1] === "P") return true;
			if (inBounds(rr, c + 1) && board[rr * 8 + c + 1] === "P") return true;
		} else {
			const rr = r - 1;
			if (inBounds(rr, c - 1) && board[rr * 8 + c - 1] === "p") return true;
			if (inBounds(rr, c + 1) && board[rr * 8 + c + 1] === "p") return true;
		}
		for (const [dr, dc] of [
			[-2, -1],
			[-2, 1],
			[-1, -2],
			[-1, 2],
			[1, -2],
			[1, 2],
			[2, -1],
			[2, 1]
		]) {
			const rr = r + dr, cc = c + dc;
			if (!inBounds(rr, cc)) continue;
			const p = board[rr * 8 + cc];
			if (p && (by === "w" && p === "N" || by === "b" && p === "n")) return true;
		}
		for (const [dr, dc] of [
			[-1, -1],
			[-1, 1],
			[1, -1],
			[1, 1]
		]) {
			let rr = r + dr, cc = c + dc;
			while (inBounds(rr, cc)) {
				const p = board[rr * 8 + cc];
				if (p) {
					if (by === "w" && "BQ".includes(p) || by === "b" && "bq".includes(p)) return true;
					break;
				}
				rr += dr;
				cc += dc;
			}
		}
		for (const [dr, dc] of [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1]
		]) {
			let rr = r + dr, cc = c + dc;
			while (inBounds(rr, cc)) {
				const p = board[rr * 8 + cc];
				if (p) {
					if (by === "w" && "RQ".includes(p) || by === "b" && "rq".includes(p)) return true;
					break;
				}
				rr += dr;
				cc += dc;
			}
		}
		for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
			if (dr === 0 && dc === 0) continue;
			const rr = r + dr, cc = c + dc;
			if (!inBounds(rr, cc)) continue;
			const p = board[rr * 8 + cc];
			if (p && (by === "w" && p === "K" || by === "b" && p === "k")) return true;
		}
		return false;
	}
	function inCheck(color) {
		return squareAttacked(kingIndex(color), color === "w" ? "b" : "w");
	}
	function clone() {
		return {
			board: board.slice(),
			side,
			castling: { ...castling },
			ep,
			halfmove,
			fullmove
		};
	}
	function restore(s) {
		board = s.board.slice();
		side = s.side;
		castling = { ...s.castling };
		ep = s.ep;
		halfmove = s.halfmove;
		fullmove = s.fullmove;
	}
	function makeMove(from, to, promotion) {
		const prev = clone();
		const p = board[from];
		const pc = pieceColor(p);
		const cap = board[to];
		if (p === "P" || p === "p") {
			const { r: rf, c: cf } = rcOf(from);
			const { r: rt, c: ct } = rcOf(to);
			if (cf !== ct && !cap) {
				const capIdx = pc === "w" ? to + 8 : to - 8;
				board[capIdx] = null;
			}
		}
		board[to] = board[from];
		board[from] = null;
		if (promotion) board[to] = pc === "w" ? promotion.toUpperCase() : promotion.toLowerCase();
		if (p === "K" && Math.abs(rcOf(to).c - rcOf(from).c) === 2) {
			if (rcOf(to).c === 6) {
				board[sqToIdx("f1")] = "R";
				board[sqToIdx("h1")] = null;
			} else {
				board[sqToIdx("d1")] = "R";
				board[sqToIdx("a1")] = null;
			}
			castling.K = false;
			castling.Q = false;
		}
		if (p === "k" && Math.abs(rcOf(to).c - rcOf(from).c) === 2) {
			if (rcOf(to).c === 6) {
				board[sqToIdx("f8")] = "r";
				board[sqToIdx("h8")] = null;
			} else {
				board[sqToIdx("d8")] = "r";
				board[sqToIdx("a8")] = null;
			}
			castling.k = false;
			castling.q = false;
		}
		ep = -1;
		if (p === "P" || p === "p") {
			const { r: rf } = rcOf(from);
			const { r: rt } = rcOf(to);
			if (Math.abs(rt - rf) === 2) ep = pc === "w" ? to + 8 : to - 8;
		}
		const fromSq = idxToSq(from), toSq = idxToSq(to);
		if (p === "K") {
			castling.K = false;
			castling.Q = false;
		}
		if (p === "k") {
			castling.k = false;
			castling.q = false;
		}
		if (fromSq === "h1" || toSq === "h1") castling.K = false;
		if (fromSq === "a1" || toSq === "a1") castling.Q = false;
		if (fromSq === "h8" || toSq === "h8") castling.k = false;
		if (fromSq === "a8" || toSq === "a8") castling.q = false;
		if (p === "P" || p === "p" || cap) halfmove = 0;
		else halfmove++;
		if (side === "b") fullmove++;
		side = side === "w" ? "b" : "w";
		return prev;
	}
	function generate() {
		const moves = [];
		const us = side, them = side === "w" ? "b" : "w";
		for (let i = 0; i < 64; i++) {
			const p = board[i];
			if (!p || pieceColor(p) !== us) continue;
			const { r, c } = rcOf(i);
			const add = (from, to, promotion) => {
				let captured = null;
				const targetPiece = board[to];
				if (targetPiece && pieceColor(targetPiece) === them) captured = targetPiece;
				else if ((p === "P" || p === "p") && to === ep && !targetPiece) captured = us === "w" ? "p" : "P";
				const prev = clone();
				makeMove(from, to, promotion);
				const legal = !inCheck(us);
				restore(prev);
				if (legal) moves.push({
					from,
					to,
					promotion: promotion || null,
					piece: p,
					captured
				});
			};
			if (p === "P" || p === "p") {
				const forward = us === "w" ? -1 : 1;
				const start = us === "w" ? 6 : 1;
				const promo = us === "w" ? 0 : 7;
				const oneR = r + forward;
				if (inBounds(oneR, c) && !board[oneR * 8 + c]) {
					if (oneR === promo) for (const pr of [
						"q",
						"r",
						"b",
						"n"
					]) add(i, oneR * 8 + c, pr);
					else add(i, oneR * 8 + c);
					const twoR = r + 2 * forward;
					if (r === start && !board[twoR * 8 + c]) add(i, twoR * 8 + c);
				}
				for (const dc of [-1, 1]) {
					const rr = r + forward, cc = c + dc;
					if (!inBounds(rr, cc)) continue;
					const t = rr * 8 + cc;
					if (board[t] && pieceColor(board[t]) === them) if (rr === promo) for (const pr of [
						"q",
						"r",
						"b",
						"n"
					]) add(i, t, pr);
					else add(i, t);
					else if (t === ep) add(i, t);
				}
			} else if (p === "N" || p === "n") for (const [dr, dc] of [
				[-2, -1],
				[-2, 1],
				[-1, -2],
				[-1, 2],
				[1, -2],
				[1, 2],
				[2, -1],
				[2, 1]
			]) {
				const rr = r + dr, cc = c + dc;
				if (!inBounds(rr, cc)) continue;
				const t = rr * 8 + cc;
				if (!board[t] || pieceColor(board[t]) !== us) add(i, t);
			}
			else if (p === "B" || p === "b") for (const [dr, dc] of [
				[-1, -1],
				[-1, 1],
				[1, -1],
				[1, 1]
			]) {
				let rr = r + dr, cc = c + dc;
				while (inBounds(rr, cc)) {
					const t = rr * 8 + cc;
					if (board[t]) {
						if (pieceColor(board[t]) !== us) add(i, t);
						break;
					}
					add(i, t);
					rr += dr;
					cc += dc;
				}
			}
			else if (p === "R" || p === "r") for (const [dr, dc] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1]
			]) {
				let rr = r + dr, cc = c + dc;
				while (inBounds(rr, cc)) {
					const t = rr * 8 + cc;
					if (board[t]) {
						if (pieceColor(board[t]) !== us) add(i, t);
						break;
					}
					add(i, t);
					rr += dr;
					cc += dc;
				}
			}
			else if (p === "Q" || p === "q") for (const [dr, dc] of [
				[-1, -1],
				[-1, 1],
				[1, -1],
				[1, 1],
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1]
			]) {
				let rr = r + dr, cc = c + dc;
				while (inBounds(rr, cc)) {
					const t = rr * 8 + cc;
					if (board[t]) {
						if (pieceColor(board[t]) !== us) add(i, t);
						break;
					}
					add(i, t);
					rr += dr;
					cc += dc;
				}
			}
			else if (p === "K" || p === "k") {
				for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
					if (dr === 0 && dc === 0) continue;
					const rr = r + dr, cc = c + dc;
					if (!inBounds(rr, cc)) continue;
					const t = rr * 8 + cc;
					if (!board[t] || pieceColor(board[t]) !== us) add(i, t);
				}
				if (us === "w" && r === 7 && c === 4) {
					if (castling.K && !board[sqToIdx("f1")] && !board[sqToIdx("g1")] && !inCheck("w") && !squareAttacked(sqToIdx("f1"), "b") && !squareAttacked(sqToIdx("g1"), "b")) add(i, sqToIdx("g1"));
					if (castling.Q && !board[sqToIdx("d1")] && !board[sqToIdx("c1")] && !board[sqToIdx("b1")] && !inCheck("w") && !squareAttacked(sqToIdx("d1"), "b") && !squareAttacked(sqToIdx("c1"), "b")) add(i, sqToIdx("c1"));
				}
				if (us === "b" && r === 0 && c === 4) {
					if (castling.k && !board[sqToIdx("f8")] && !board[sqToIdx("g8")] && !inCheck("b") && !squareAttacked(sqToIdx("f8"), "w") && !squareAttacked(sqToIdx("g8"), "w")) add(i, sqToIdx("g8"));
					if (castling.q && !board[sqToIdx("d8")] && !board[sqToIdx("c8")] && !board[sqToIdx("b8")] && !inCheck("b") && !squareAttacked(sqToIdx("d8"), "w") && !squareAttacked(sqToIdx("c8"), "w")) add(i, sqToIdx("c8"));
				}
			}
		}
		return moves.map((m) => ({
			from: idxToSq(m.from),
			to: idxToSq(m.to),
			uci: idxToSq(m.from) + idxToSq(m.to) + (m.promotion ? m.promotion : ""),
			piece: m.piece,
			promotion: m.promotion || null,
			captured: m.captured
		}));
	}
	function moveUci(uci) {
		const from = sqToIdx(uci.slice(0, 2)), to = sqToIdx(uci.slice(2, 4));
		const promo = uci.length > 4 ? uci[4] : null;
		if (generate().filter((m) => m.uci === uci).length) return {
			ok: true,
			prev: makeMove(from, to, promo)
		};
		return { ok: false };
	}
	function parseSANtoMove(san) {
		san = san.trim();
		if (/^O-O-O|^0-0-0/.test(san)) return side === "w" ? "e1c1" : "e8c8";
		if (/^O-O|^0-0/.test(san)) return side === "w" ? "e1g1" : "e8g8";
		san = san.replace(/[+#]|!!|\?\?|!\?|\?!/g, "");
		let promo = null;
		const pm = san.match(/=([NBRQ])/);
		if (pm) {
			promo = pm[1].toLowerCase();
			san = san.replace(/=([NBRQ])/, "");
		}
		const dm = san.match(/([a-h][1-8])$/);
		if (!dm) return null;
		const dest = dm[1];
		san = san.slice(0, san.length - dest.length);
		let pieceLetter = "P";
		if (/^[NBRQK]/.test(san)) {
			pieceLetter = san[0];
			san = san.slice(1);
		}
		san = san.replace("x", "");
		let disFile = null, disRank = null;
		if (san.length === 2) {
			if (/[a-h]/.test(san[0])) disFile = san[0];
			if (/[1-8]/.test(san[0])) disRank = san[0];
			if (/[a-h]/.test(san[1])) disFile = san[1];
			if (/[1-8]/.test(san[1])) disRank = san[1];
		} else if (san.length === 1) {
			if (/[a-h]/.test(san)) disFile = san;
			if (/[1-8]/.test(san)) disRank = san;
		}
		const legal = generate().filter((m) => m.to === dest).filter((m) => {
			const want = pieceLetter;
			if (!(want === "P" ? /[Pp]/.test(m.piece) : want === "N" ? /[Nn]/.test(m.piece) : want === "B" ? /[Bb]/.test(m.piece) : want === "R" ? /[Rr]/.test(m.piece) : want === "Q" ? /[Qq]/.test(m.piece) : /[Kk]/.test(m.piece))) return false;
			if (disFile && m.from[0] !== disFile) return false;
			if (disRank && m.from[1] !== disRank) return false;
			if (promo && m.promotion !== promo) return false;
			return true;
		});
		return legal[0] && legal[0].uci || null;
	}
	function loadPGN(pgn) {
		const text = (pgn || "").replace(/\r/g, "").replace(/\[(.|\n)*?\]\s*/g, " ").trim();
		const tokens = [];
		let i = 0;
		while (i < text.length) {
			const ch = text[i];
			if (ch === "{") {
				let j = i + 1;
				while (j < text.length && text[j] !== "}") j++;
				tokens.push({
					type: "comment",
					value: text.slice(i + 1, j)
				});
				i = j + 1;
				continue;
			}
			if (/\s/.test(ch)) {
				i++;
				continue;
			}
			const num = text.slice(i).match(/^\d+\.(\.\.)?/);
			if (num) {
				i += num[0].length;
				continue;
			}
			const res = text.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/);
			if (res) {
				i += res[0].length;
				continue;
			}
			const nag = text.slice(i).match(/^\$\d+/);
			if (nag) {
				i += nag[0].length;
				continue;
			}
			let j = i;
			while (j < text.length && !/\s|\{/.test(text[j])) j++;
			tokens.push({
				type: "san",
				value: text.slice(i, j)
			});
			i = j;
		}
		reset();
		const moves = [];
		for (const t of tokens) if (t.type === "san") {
			const uci = parseSANtoMove(t.value);
			if (!uci) continue;
			if (!moveUci(uci).ok) continue;
			moves.push({
				uci,
				san: t.value,
				fenAfter: fen()
			});
		} else moves.push({ comment: t.value });
		return moves;
	}
	return {
		reset,
		loadFEN,
		fen,
		turn: () => side,
		moves: generate,
		moveUci,
		parseSANtoMove,
		loadPGN,
		idxToSq,
		sqToIdx,
		inCheck
	};
}
//#endregion
//#region src/utils/tacticalMotifs/siteClassifier/mate-pattern-detector.js
/**
* Named checkmate-pattern detection for final FEN positions.
*
* This module is deliberately self-contained: it has no DOM, storage, engine,
* or application dependencies, so the site classifier and En Croissant can
* share it. Detection is gated behind a legal checkmate check. Pattern rules
* then use conservative piece geometry; a familiar-looking position which is
* merely check, stalemate, or an illegal FEN never receives a named-mate tag.
*/
var NAMED_MATE_PATTERN_IDS = Object.freeze([
	"anastasiaMate",
	"arabianMate",
	"backRankMate",
	"balestraMate",
	"blindSwineMate",
	"bodenMate",
	"cornerMate",
	"doubleBishopMate",
	"dovetailMate",
	"epauletteMate",
	"hookMate",
	"killBoxMate",
	"pillsburysMate",
	"morphysMate",
	"operaMate",
	"swallowstailMate",
	"triangleMate",
	"vukovicMate",
	"smotheredMate"
]);
var FILES$1 = "abcdefgh";
var PIECES = /* @__PURE__ */ new Set("prnbqkPRNBQK");
var KNIGHT_STEPS = Object.freeze([
	[-2, -1],
	[-2, 1],
	[-1, -2],
	[-1, 2],
	[1, -2],
	[1, 2],
	[2, -1],
	[2, 1]
]);
var DIAGONALS = Object.freeze([
	[-1, -1],
	[-1, 1],
	[1, -1],
	[1, 1]
]);
var ORTHOGONALS = Object.freeze([
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1]
]);
var KING_STEPS = Object.freeze([...DIAGONALS, ...ORTHOGONALS]);
function indexOf(row, col) {
	return row * 8 + col;
}
function rowOf(square) {
	return Math.floor(square / 8);
}
function colOf(square) {
	return square % 8;
}
function inBounds$1(row, col) {
	return row >= 0 && row < 8 && col >= 0 && col < 8;
}
function offsetSquare(square, dr, dc) {
	const row = rowOf(square) + dr;
	const col = colOf(square) + dc;
	return inBounds$1(row, col) ? indexOf(row, col) : -1;
}
function squareName(square) {
	return `${FILES$1[colOf(square)]}${8 - rowOf(square)}`;
}
function squareIndex(name) {
	if (!/^[a-h][1-8]$/.test(name || "")) return -1;
	return indexOf(8 - Number(name[1]), FILES$1.indexOf(name[0]));
}
function colorOf(piece) {
	if (!piece) return null;
	return piece === piece.toUpperCase() ? "w" : "b";
}
function typeOf(piece) {
	return piece ? piece.toUpperCase() : null;
}
function otherColor(color) {
	return color === "w" ? "b" : "w";
}
function parseFen(fen) {
	if (typeof fen !== "string" || !fen.trim()) throw new Error("FEN must be a non-empty string");
	const fields = fen.trim().split(/\s+/);
	if (fields.length < 2 || fields.length > 6) throw new Error("FEN must contain between two and six fields");
	const ranks = fields[0].split("/");
	if (ranks.length !== 8) throw new Error("FEN board must contain eight ranks");
	const board = new Array(64).fill(null);
	for (let row = 0; row < 8; row += 1) {
		let col = 0;
		for (const token of ranks[row]) if (/^[1-8]$/.test(token)) col += Number(token);
		else if (PIECES.has(token)) {
			if (col >= 8) throw new Error(`FEN rank ${8 - row} is too wide`);
			board[indexOf(row, col)] = token;
			col += 1;
		} else throw new Error(`Invalid FEN piece token: ${token}`);
		if (col !== 8) throw new Error(`FEN rank ${8 - row} does not contain eight files`);
	}
	const turn = fields[1];
	if (turn !== "w" && turn !== "b") throw new Error("FEN active color must be w or b");
	const castling = fields[2] || "-";
	if (castling !== "-" && !/^(?!.*(.).*\1)[KQkq]+$/.test(castling)) throw new Error("Invalid FEN castling field");
	const ep = fields[3] || "-";
	if (ep !== "-" && !/^[a-h][36]$/.test(ep)) throw new Error("Invalid FEN en-passant field");
	const halfmove = fields[4] === void 0 ? 0 : Number(fields[4]);
	const fullmove = fields[5] === void 0 ? 1 : Number(fields[5]);
	if (!Number.isInteger(halfmove) || halfmove < 0) throw new Error("Invalid FEN halfmove clock");
	if (!Number.isInteger(fullmove) || fullmove < 1) throw new Error("Invalid FEN fullmove number");
	return {
		board,
		turn,
		castling,
		epSquare: ep === "-" ? -1 : squareIndex(ep),
		halfmove,
		fullmove
	};
}
function piecesOf(board, color, type = null) {
	const result = [];
	for (let square = 0; square < 64; square += 1) {
		const piece = board[square];
		if (piece && colorOf(piece) === color && (!type || typeOf(piece) === type)) result.push(square);
	}
	return result;
}
function kingSquare(board, color) {
	const kings = piecesOf(board, color, "K");
	return kings.length === 1 ? kings[0] : -1;
}
/** Return pseudo-attackers. Pins intentionally do not erase attacks. */
function attackers(board, target, color) {
	const result = [];
	const row = rowOf(target);
	const col = colOf(target);
	const pawn = color === "w" ? "P" : "p";
	const pawnSourceDr = color === "w" ? 1 : -1;
	for (const dc of [-1, 1]) {
		const sourceRow = row + pawnSourceDr;
		const sourceCol = col + dc;
		if (inBounds$1(sourceRow, sourceCol)) {
			const source = indexOf(sourceRow, sourceCol);
			if (board[source] === pawn) result.push(source);
		}
	}
	const knight = color === "w" ? "N" : "n";
	for (const [dr, dc] of KNIGHT_STEPS) {
		const sourceRow = row + dr;
		const sourceCol = col + dc;
		if (inBounds$1(sourceRow, sourceCol)) {
			const source = indexOf(sourceRow, sourceCol);
			if (board[source] === knight) result.push(source);
		}
	}
	const king = color === "w" ? "K" : "k";
	for (const [dr, dc] of KING_STEPS) {
		const sourceRow = row + dr;
		const sourceCol = col + dc;
		if (inBounds$1(sourceRow, sourceCol)) {
			const source = indexOf(sourceRow, sourceCol);
			if (board[source] === king) result.push(source);
		}
	}
	const bishop = color === "w" ? "B" : "b";
	const rook = color === "w" ? "R" : "r";
	const queen = color === "w" ? "Q" : "q";
	for (const [dr, dc] of DIAGONALS) {
		let scanRow = row + dr;
		let scanCol = col + dc;
		while (inBounds$1(scanRow, scanCol)) {
			const square = indexOf(scanRow, scanCol);
			const piece = board[square];
			if (piece) {
				if (piece === bishop || piece === queen) result.push(square);
				break;
			}
			scanRow += dr;
			scanCol += dc;
		}
	}
	for (const [dr, dc] of ORTHOGONALS) {
		let scanRow = row + dr;
		let scanCol = col + dc;
		while (inBounds$1(scanRow, scanCol)) {
			const square = indexOf(scanRow, scanCol);
			const piece = board[square];
			if (piece) {
				if (piece === rook || piece === queen) result.push(square);
				break;
			}
			scanRow += dr;
			scanCol += dc;
		}
	}
	return result;
}
function pieceAttacks(board, from, target) {
	const piece = board[from];
	return Boolean(piece) && attackers(board, target, colorOf(piece)).includes(from);
}
function addPawnMove(moves, from, to, promotionRow, epCapture = -1) {
	if (rowOf(to) !== promotionRow) {
		moves.push({
			from,
			to,
			epCapture
		});
		return;
	}
	for (const promotion of [
		"Q",
		"R",
		"B",
		"N"
	]) moves.push({
		from,
		to,
		epCapture,
		promotion
	});
}
function pseudoLegalMoves(position) {
	const { board, turn, epSquare } = position;
	const moves = [];
	for (let from = 0; from < 64; from += 1) {
		const piece = board[from];
		if (!piece || colorOf(piece) !== turn) continue;
		const type = typeOf(piece);
		const row = rowOf(from);
		const col = colOf(from);
		if (type === "P") {
			const direction = turn === "w" ? -1 : 1;
			const startRow = turn === "w" ? 6 : 1;
			const promotionRow = turn === "w" ? 0 : 7;
			const oneRow = row + direction;
			if (inBounds$1(oneRow, col)) {
				const one = indexOf(oneRow, col);
				if (!board[one]) {
					addPawnMove(moves, from, one, promotionRow);
					const twoRow = row + 2 * direction;
					if (row === startRow && inBounds$1(twoRow, col)) {
						const two = indexOf(twoRow, col);
						if (!board[two]) moves.push({
							from,
							to: two,
							epCapture: -1
						});
					}
				}
			}
			for (const dc of [-1, 1]) {
				const targetRow = row + direction;
				const targetCol = col + dc;
				if (!inBounds$1(targetRow, targetCol)) continue;
				const to = indexOf(targetRow, targetCol);
				const targetPiece = board[to];
				if (targetPiece && colorOf(targetPiece) !== turn && typeOf(targetPiece) !== "K") addPawnMove(moves, from, to, promotionRow);
				else if (to === epSquare && !targetPiece) {
					const captured = indexOf(row, targetCol);
					const expectedPawn = turn === "w" ? "p" : "P";
					if (board[captured] === expectedPawn) addPawnMove(moves, from, to, promotionRow, captured);
				}
			}
			continue;
		}
		if (type === "N" || type === "K") {
			const steps = type === "N" ? KNIGHT_STEPS : KING_STEPS;
			for (const [dr, dc] of steps) {
				const targetRow = row + dr;
				const targetCol = col + dc;
				if (!inBounds$1(targetRow, targetCol)) continue;
				const to = indexOf(targetRow, targetCol);
				const target = board[to];
				if (!target || colorOf(target) !== turn && typeOf(target) !== "K") moves.push({
					from,
					to,
					epCapture: -1
				});
			}
			continue;
		}
		const directions = type === "B" ? DIAGONALS : type === "R" ? ORTHOGONALS : KING_STEPS;
		for (const [dr, dc] of directions) {
			let targetRow = row + dr;
			let targetCol = col + dc;
			while (inBounds$1(targetRow, targetCol)) {
				const to = indexOf(targetRow, targetCol);
				const target = board[to];
				if (!target) moves.push({
					from,
					to,
					epCapture: -1
				});
				else {
					if (colorOf(target) !== turn && typeOf(target) !== "K") moves.push({
						from,
						to,
						epCapture: -1
					});
					break;
				}
				targetRow += dr;
				targetCol += dc;
			}
		}
	}
	return moves;
}
function boardAfterMove(board, move, moverColor) {
	const next = board.slice();
	const piece = next[move.from];
	next[move.from] = null;
	if (move.epCapture >= 0) next[move.epCapture] = null;
	next[move.to] = move.promotion ? moverColor === "w" ? move.promotion : move.promotion.toLowerCase() : piece;
	return next;
}
function hasLegalMove(position) {
	const mover = position.turn;
	const opponent = otherColor(mover);
	for (const move of pseudoLegalMoves(position)) {
		const board = boardAfterMove(position.board, move, mover);
		const king = kingSquare(board, mover);
		if (king >= 0 && attackers(board, king, opponent).length === 0) return true;
	}
	return false;
}
function validatePosition(position) {
	const { board, turn } = position;
	const whiteKings = piecesOf(board, "w", "K");
	const blackKings = piecesOf(board, "b", "K");
	if (whiteKings.length !== 1 || blackKings.length !== 1) return "A legal position must contain exactly one king of each color";
	const whiteKing = whiteKings[0];
	const blackKing = blackKings[0];
	if (Math.max(Math.abs(rowOf(whiteKing) - rowOf(blackKing)), Math.abs(colOf(whiteKing) - colOf(blackKing))) <= 1) return "Kings may not occupy adjacent squares";
	for (let col = 0; col < 8; col += 1) if (typeOf(board[indexOf(0, col)]) === "P" || typeOf(board[indexOf(7, col)]) === "P") return "An unpromoted pawn may not occupy the first or eighth rank";
	if (attackers(board, kingSquare(board, otherColor(turn)), turn).length > 0) return "The side not to move has its king in check";
	return null;
}
function kingRing(king) {
	const result = [];
	for (const [dr, dc] of KING_STEPS) {
		const square = offsetSquare(king, dr, dc);
		if (square >= 0) result.push(square);
	}
	return result;
}
function relative(from, to) {
	return {
		dr: rowOf(to) - rowOf(from),
		dc: colOf(to) - colOf(from)
	};
}
function isOrthogonallyAdjacent(first, second) {
	const { dr, dc } = relative(first, second);
	return Math.abs(dr) + Math.abs(dc) === 1;
}
function isDiagonallyAdjacent(first, second) {
	const { dr, dc } = relative(first, second);
	return Math.abs(dr) === 1 && Math.abs(dc) === 1;
}
function isOnEdge(square) {
	const row = rowOf(square);
	const col = colOf(square);
	return row === 0 || row === 7 || col === 0 || col === 7;
}
function isCorner(square) {
	const row = rowOf(square);
	const col = colOf(square);
	return (row === 0 || row === 7) && (col === 0 || col === 7);
}
function diagonalFamily(from, to) {
	const { dr, dc } = relative(from, to);
	if (Math.abs(dr) !== Math.abs(dc) || dr === 0) return 0;
	return Math.sign(dr) * Math.sign(dc);
}
function makeContext(position) {
	const defender = position.turn;
	const attacker = otherColor(defender);
	const king = kingSquare(position.board, defender);
	const ring = kingRing(king);
	const checkers = attackers(position.board, king, attacker);
	const ownBlockers = ring.filter((square) => colorOf(position.board[square]) === defender);
	const byType = (type) => piecesOf(position.board, attacker, type);
	const checkerType = (type) => checkers.filter((square) => typeOf(position.board[square]) === type);
	const controlsRing = (square) => ring.filter((target) => pieceAttacks(position.board, square, target));
	const protectedBy = (square, excludedType = null) => attackers(position.board, square, attacker).filter((source) => source !== square && (!excludedType || typeOf(position.board[source]) !== excludedType));
	return {
		board: position.board,
		defender,
		attacker,
		king,
		ring,
		checkers,
		ownBlockers,
		byType,
		checkerType,
		controlsRing,
		protectedBy
	};
}
function hasAnastasiaMate(ctx) {
	if (isCorner(ctx.king) || !isOnEdge(ctx.king)) return false;
	const edgeRules = [];
	const row = rowOf(ctx.king);
	const col = colOf(ctx.king);
	if (col === 0) edgeRules.push({
		nr: 0,
		nc: 1,
		sameAxis: (sq) => colOf(sq) === col
	});
	if (col === 7) edgeRules.push({
		nr: 0,
		nc: -1,
		sameAxis: (sq) => colOf(sq) === col
	});
	if (row === 0) edgeRules.push({
		nr: 1,
		nc: 0,
		sameAxis: (sq) => rowOf(sq) === row
	});
	if (row === 7) edgeRules.push({
		nr: -1,
		nc: 0,
		sameAxis: (sq) => rowOf(sq) === row
	});
	for (const rule of edgeRules) {
		const inner = offsetSquare(ctx.king, rule.nr, rule.nc);
		if (inner < 0 || colorOf(ctx.board[inner]) !== ctx.defender) continue;
		const diagonalEscapes = rule.nr === 0 ? [offsetSquare(ctx.king, -1, rule.nc), offsetSquare(ctx.king, 1, rule.nc)] : [offsetSquare(ctx.king, rule.nr, -1), offsetSquare(ctx.king, rule.nr, 1)];
		if (diagonalEscapes.some((square) => square < 0)) continue;
		const knight = ctx.byType("N").some((square) => diagonalEscapes.every((target) => pieceAttacks(ctx.board, square, target)));
		const rookChecker = ctx.checkerType("R").some(rule.sameAxis);
		if (knight && rookChecker) return true;
	}
	return false;
}
function hasArabianMate(ctx) {
	if (!isCorner(ctx.king)) return false;
	const orthogonalRing = ORTHOGONALS.map(([dr, dc]) => offsetSquare(ctx.king, dr, dc)).filter((square) => square >= 0);
	for (const rook of ctx.checkerType("R")) {
		if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
		const otherEscape = orthogonalRing.find((square) => square !== rook);
		if (otherEscape < 0) continue;
		if (ctx.byType("N").some((knight) => pieceAttacks(ctx.board, knight, rook) && pieceAttacks(ctx.board, knight, otherEscape))) return true;
	}
	return false;
}
function hasBackRankMate(ctx) {
	const homeRow = ctx.defender === "w" ? 7 : 0;
	if (rowOf(ctx.king) !== homeRow) return false;
	const inward = ctx.defender === "w" ? -1 : 1;
	const blockers = [
		-1,
		0,
		1
	].map((dc) => offsetSquare(ctx.king, inward, dc)).filter((square) => square >= 0);
	if (blockers.length < 2 || blockers.some((square) => colorOf(ctx.board[square]) !== ctx.defender)) return false;
	return ctx.checkers.some((checker) => {
		const type = typeOf(ctx.board[checker]);
		return (type === "R" || type === "Q") && rowOf(checker) === homeRow;
	});
}
function hasBalestraMate(ctx) {
	if (ctx.checkerType("B").length === 0) return false;
	return ctx.byType("Q").some((queen) => {
		if (ctx.checkers.includes(queen)) return false;
		const { dr, dc } = relative(ctx.king, queen);
		const distances = [Math.abs(dr), Math.abs(dc)].sort((a, b) => a - b);
		return distances[0] === 1 && distances[1] === 2 && ctx.controlsRing(queen).length >= 2;
	});
}
function hasBlindSwineMate(ctx) {
	for (const rook of ctx.checkerType("R")) {
		if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
		const { dr, dc } = relative(ctx.king, rook);
		const perpendiculars = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
		for (const [pr, pc] of perpendiculars) {
			const partner = offsetSquare(rook, pr, pc);
			if (partner >= 0 && ctx.board[partner] && colorOf(ctx.board[partner]) === ctx.attacker && typeOf(ctx.board[partner]) === "R" && isDiagonallyAdjacent(partner, ctx.king)) return true;
		}
	}
	return false;
}
function hasBodenMate(ctx) {
	if (ctx.ownBlockers.length < 2) return false;
	for (const checker of ctx.checkerType("B")) {
		const checkerFamily = diagonalFamily(checker, ctx.king);
		for (const bishop of ctx.byType("B")) {
			if (bishop === checker) continue;
			if (ctx.ring.some((target) => pieceAttacks(ctx.board, bishop, target) && diagonalFamily(bishop, target) === -checkerFamily)) return true;
		}
	}
	return false;
}
function hasDoubleBishopMate(ctx) {
	if (ctx.ownBlockers.length < 1) return false;
	for (const checker of ctx.checkerType("B")) for (const bishop of ctx.byType("B")) {
		if (bishop === checker) continue;
		if (isOrthogonallyAdjacent(checker, bishop)) return true;
	}
	return false;
}
function hasDovetailMate(ctx) {
	for (const queen of ctx.checkerType("Q")) {
		if (!isDiagonallyAdjacent(queen, ctx.king)) continue;
		const { dr, dc } = relative(ctx.king, queen);
		if ([offsetSquare(ctx.king, -dr, 0), offsetSquare(ctx.king, 0, -dc)].every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender)) return true;
	}
	return false;
}
function hasEpauletteMate(ctx) {
	for (const checker of ctx.checkers) {
		const type = typeOf(ctx.board[checker]);
		if (type !== "R" && type !== "Q") continue;
		const { dr, dc } = relative(checker, ctx.king);
		if (dr !== 0 && dc !== 0) continue;
		if ((dr === 0 ? [offsetSquare(ctx.king, -1, 0), offsetSquare(ctx.king, 1, 0)] : [offsetSquare(ctx.king, 0, -1), offsetSquare(ctx.king, 0, 1)]).every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender)) return true;
	}
	return false;
}
function hasHookMate(ctx) {
	if (!ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) === "P")) return false;
	for (const rook of ctx.checkerType("R")) {
		if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
		for (const knight of ctx.byType("N")) {
			if (!pieceAttacks(ctx.board, knight, rook)) continue;
			for (const pawn of ctx.byType("P")) if (pieceAttacks(ctx.board, pawn, knight) && ctx.ring.some((target) => pieceAttacks(ctx.board, pawn, target))) return true;
		}
	}
	return false;
}
function hasKillBoxMate(ctx) {
	for (const rook of ctx.checkerType("R")) {
		if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
		for (const queen of ctx.byType("Q")) {
			const { dr, dc } = relative(queen, rook);
			if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) continue;
			const middle = offsetSquare(queen, dr / 2, dc / 2);
			if (!ctx.board[middle] && pieceAttacks(ctx.board, queen, rook)) return true;
		}
	}
	return false;
}
function hasMorphyMate(ctx) {
	if (ctx.checkers.length !== 1 || ctx.checkerType("B").length !== 1) return false;
	return ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) === "P") && ctx.byType("R").some((rook) => ctx.controlsRing(rook).length >= 1);
}
function hasOperaMate(ctx) {
	if (!ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) !== "N")) return false;
	return ctx.checkerType("R").some((rook) => isOrthogonallyAdjacent(rook, ctx.king) && ctx.byType("B").some((bishop) => pieceAttacks(ctx.board, bishop, rook)));
}
function hasPillsburysMate(ctx) {
	if (!isOnEdge(ctx.king)) return false;
	return ctx.checkerType("R").some((rook) => ctx.byType("B").some((bishop) => !pieceAttacks(ctx.board, bishop, rook) && ctx.controlsRing(bishop).some((square) => square !== ctx.king)));
}
function hasSwallowsTailMate(ctx) {
	for (const queen of ctx.checkerType("Q")) {
		if (!isOrthogonallyAdjacent(queen, ctx.king)) continue;
		const { dr, dc } = relative(ctx.king, queen);
		if ((dr !== 0 ? [offsetSquare(ctx.king, -dr, -1), offsetSquare(ctx.king, -dr, 1)] : [offsetSquare(ctx.king, -1, -dc), offsetSquare(ctx.king, 1, -dc)]).every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender) && ctx.protectedBy(queen).length > 0) return true;
	}
	return false;
}
function hasTriangleMate(ctx) {
	for (const queen of ctx.checkerType("Q")) {
		if (!isDiagonallyAdjacent(queen, ctx.king)) continue;
		for (const rook of ctx.byType("R")) {
			const { dr, dc } = relative(queen, rook);
			if (!(Math.abs(dr) === 2 && dc === 0 || dr === 0 && Math.abs(dc) === 2)) continue;
			const middle = offsetSquare(queen, Math.sign(dr), Math.sign(dc));
			if (!ctx.board[middle] && pieceAttacks(ctx.board, rook, queen)) return true;
		}
	}
	return false;
}
function hasVukovicMate(ctx) {
	if (!isOnEdge(ctx.king)) return false;
	for (const rook of ctx.checkerType("R")) {
		if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
		if (!ctx.protectedBy(rook).some((protector) => {
			const type = typeOf(ctx.board[protector]);
			return type !== "N" && type !== "B";
		})) continue;
		for (const knight of ctx.byType("N")) if (ctx.ring.some((target) => !pieceAttacks(ctx.board, rook, target) && pieceAttacks(ctx.board, knight, target))) return true;
	}
	return false;
}
function hasSmotheredMate(ctx) {
	return ctx.checkers.length === 1 && ctx.checkerType("N").length === 1 && ctx.ring.every((square) => colorOf(ctx.board[square]) === ctx.defender);
}
function hasCornerMate(ctx, specific) {
	if (specific) return false;
	if (ctx.checkers.length !== 1) return false;
	const checkerType = typeOf(ctx.board[ctx.checkers[0]]);
	if (checkerType !== "N" && checkerType !== "B") return false;
	if (ctx.ownBlockers.length < 1) return false;
	return [...ctx.byType("R"), ...ctx.byType("Q")].some((piece) => ctx.controlsRing(piece).length >= 1);
}
function classifyMate(ctx) {
	const detected = /* @__PURE__ */ new Set();
	const add = (id, condition) => {
		if (condition) detected.add(id);
	};
	const anastasia = hasAnastasiaMate(ctx);
	const arabian = hasArabianMate(ctx);
	const backRank = hasBackRankMate(ctx);
	const balestra = hasBalestraMate(ctx);
	const blindSwine = hasBlindSwineMate(ctx);
	const bodenCandidate = hasBodenMate(ctx);
	const doubleBishop = hasDoubleBishopMate(ctx);
	const dovetail = hasDovetailMate(ctx);
	const epaulette = hasEpauletteMate(ctx);
	const hook = hasHookMate(ctx);
	const killBox = hasKillBoxMate(ctx);
	const morphy = hasMorphyMate(ctx);
	const boden = bodenCandidate && !morphy;
	const opera = hasOperaMate(ctx);
	const pillsbury = !backRank && hasPillsburysMate(ctx);
	const swallowsTail = hasSwallowsTailMate(ctx);
	const triangle = hasTriangleMate(ctx);
	const vukovic = hasVukovicMate(ctx);
	const smothered = hasSmotheredMate(ctx);
	const corner = hasCornerMate(ctx, balestra || boden || doubleBishop || morphy || smothered);
	add("anastasiaMate", anastasia);
	add("arabianMate", arabian);
	add("backRankMate", backRank);
	add("balestraMate", balestra);
	add("blindSwineMate", blindSwine);
	add("bodenMate", boden);
	add("cornerMate", corner);
	add("doubleBishopMate", doubleBishop);
	add("dovetailMate", dovetail);
	add("epauletteMate", epaulette);
	add("hookMate", hook);
	add("killBoxMate", killBox);
	add("pillsburysMate", pillsbury);
	add("morphysMate", morphy);
	add("operaMate", opera);
	add("swallowstailMate", swallowsTail);
	add("triangleMate", triangle);
	add("vukovicMate", vukovic);
	add("smotheredMate", smothered);
	return NAMED_MATE_PATTERN_IDS.filter((id) => detected.has(id));
}
/**
* Analyze a final FEN. Invalid positions are reported, rather than thrown,
* which keeps imports and background retagging robust against bad source data.
*/
function analyzeNamedMatePatterns(fen) {
	let position;
	try {
		position = parseFen(fen);
	} catch (error) {
		return {
			valid: false,
			isCheckmate: false,
			patterns: [],
			reason: error instanceof Error ? error.message : String(error)
		};
	}
	const invalidReason = validatePosition(position);
	if (invalidReason) return {
		valid: false,
		isCheckmate: false,
		patterns: [],
		reason: invalidReason
	};
	const defender = position.turn;
	const attacker = otherColor(defender);
	const king = kingSquare(position.board, defender);
	const checkingSquares = attackers(position.board, king, attacker);
	const inCheck = checkingSquares.length > 0;
	if (!(inCheck && !hasLegalMove(position))) return {
		valid: true,
		isCheckmate: false,
		patterns: [],
		sideToMove: defender,
		checkingSquares: checkingSquares.map(squareName),
		reason: inCheck ? "The checked side has a legal evasion" : "The side to move is not in check"
	};
	return {
		valid: true,
		isCheckmate: true,
		patterns: classifyMate(makeContext(position)),
		sideToMove: defender,
		matedKing: squareName(king),
		checkingSquares: checkingSquares.map(squareName),
		reason: null
	};
}
/** Return only the pinned Lichess-compatible motif IDs for a final FEN. */
function detectNamedMatePatterns(fen) {
	return analyzeNamedMatePatterns(fen).patterns;
}
var THEMES = {
	FORK: "fork",
	PIN: "pin",
	SKEWER: "skewer",
	DISCOVERED_ATTACK: "discoveredAttack",
	DOUBLE_CHECK: "doubleCheck",
	HANGING_PIECE: "hangingPiece",
	TRAPPED_PIECE: "trappedPiece",
	SACRIFICE: "sacrifice",
	BACK_RANK: "backRank",
	BACK_RANK_MATE: "backRankMate",
	PROMOTION: "promotion",
	EN_PASSANT: "enPassant",
	CASTLING: "castling",
	CHECK: "check",
	CAPTURE: "capture",
	QUIET_MOVE: "quietMove",
	MATE: "mate",
	MATE_IN_1: "mateIn1",
	MATE_IN_2: "mateIn2",
	MATE_IN_3: "mateIn3",
	MATE_IN_4: "mateIn4",
	MATE_IN_5: "mateIn5",
	MATE_THREAT: "mateThreat",
	SMOTHERED_MATE: "smotheredMate",
	ANASTASIA_MATE: "anastasiaMate",
	HOOK_MATE: "hookMate",
	ARABIAN_MATE: "arabianMate",
	BODEN_MATE: "bodenMate",
	DOUBLE_BISHOP_MATE: "doubleBishopMate",
	DOVETAIL_MATE: "dovetailMate",
	BALESTRA_MATE: "balestraMate",
	BLIND_SWINE_MATE: "blindSwineMate",
	CORNER_MATE: "cornerMate",
	EPAULETTE_MATE: "epauletteMate",
	KILL_BOX_MATE: "killBoxMate",
	MORPHYS_MATE: "morphysMate",
	OPERA_MATE: "operaMate",
	PILLSBURYS_MATE: "pillsburysMate",
	SWALLOWSTAIL_MATE: "swallowstailMate",
	TRIANGLE_MATE: "triangleMate",
	VUKOVIC_MATE: "vukovicMate",
	DEFLECTION: "deflection",
	ATTRACTION: "attraction",
	INTERFERENCE: "interference",
	SELF_INTERFERENCE: "selfInterference",
	INTERMEZZO: "intermezzo",
	CLEARANCE: "clearance",
	X_RAY_ATTACK: "xRayAttack",
	COLLINEAR_MOVE: "collinearMove",
	DISCOVERED_CHECK: "discoveredCheck",
	ZUGZWANG: "zugzwang",
	CAPTURING_DEFENDER: "capturingDefender",
	DEFENSIVE_MOVE: "defensiveMove",
	CRUSHING: "crushing",
	ADVANTAGE: "advantage",
	EQUALITY: "equality",
	ONE_MOVE: "oneMove",
	SHORT: "short",
	LONG: "long",
	VERY_LONG: "veryLong",
	PAWN_ENDGAME: "pawnEndgame",
	ROOK_ENDGAME: "rookEndgame",
	BISHOP_ENDGAME: "bishopEndgame",
	KNIGHT_ENDGAME: "knightEndgame",
	QUEEN_ENDGAME: "queenEndgame",
	QUEEN_ROOK_ENDGAME: "queenRookEndgame",
	KINGSIDE_ATTACK: "kingsideAttack",
	QUEENSIDE_ATTACK: "queensideAttack",
	EXPOSED_KING: "exposedKing",
	ADVANCED_PAWN: "advancedPawn",
	UNDER_PROMOTION: "underPromotion",
	ATTACKING_F2F7: "attackingF2F7",
	ATTACKING_UNDEFENDED_PIECE: "attacking_undefended_piece"
};
var TACTICAL_THEMES = new Set([
	THEMES.FORK,
	THEMES.PIN,
	THEMES.SKEWER,
	THEMES.DISCOVERED_ATTACK,
	THEMES.DOUBLE_CHECK,
	THEMES.HANGING_PIECE,
	THEMES.TRAPPED_PIECE,
	THEMES.SACRIFICE,
	THEMES.BACK_RANK,
	THEMES.BACK_RANK_MATE,
	THEMES.DEFLECTION,
	THEMES.ATTRACTION,
	THEMES.INTERFERENCE,
	THEMES.INTERMEZZO,
	THEMES.CLEARANCE,
	THEMES.CAPTURING_DEFENDER,
	THEMES.X_RAY_ATTACK,
	THEMES.COLLINEAR_MOVE,
	THEMES.DISCOVERED_CHECK,
	THEMES.DEFENSIVE_MOVE,
	THEMES.ZUGZWANG,
	THEMES.MATE,
	THEMES.MATE_IN_1,
	THEMES.MATE_IN_2,
	THEMES.MATE_IN_3,
	THEMES.MATE_IN_4,
	THEMES.MATE_IN_5,
	THEMES.MATE_THREAT,
	THEMES.CHECK,
	THEMES.SMOTHERED_MATE,
	THEMES.ANASTASIA_MATE,
	THEMES.HOOK_MATE,
	THEMES.ARABIAN_MATE,
	THEMES.BODEN_MATE,
	THEMES.DOUBLE_BISHOP_MATE,
	THEMES.DOVETAIL_MATE,
	THEMES.BALESTRA_MATE,
	THEMES.BLIND_SWINE_MATE,
	THEMES.CORNER_MATE,
	THEMES.EPAULETTE_MATE,
	THEMES.KILL_BOX_MATE,
	THEMES.MORPHYS_MATE,
	THEMES.OPERA_MATE,
	THEMES.PILLSBURYS_MATE,
	THEMES.SWALLOWSTAIL_MATE,
	THEMES.TRIANGLE_MATE,
	THEMES.VUKOVIC_MATE,
	THEMES.PROMOTION,
	THEMES.UNDER_PROMOTION,
	THEMES.EN_PASSANT,
	THEMES.CASTLING,
	THEMES.QUIET_MOVE,
	THEMES.ADVANCED_PAWN,
	THEMES.ATTACKING_F2F7,
	THEMES.EXPOSED_KING,
	THEMES.KINGSIDE_ATTACK,
	THEMES.QUEENSIDE_ATTACK,
	THEMES.ATTACKING_UNDEFENDED_PIECE
]);
var THEME_LABELS = {
	fork: "Fork",
	pin: "Pin",
	skewer: "Skewer",
	discoveredAttack: "Discovered Attack",
	doubleCheck: "Double Check",
	hangingPiece: "Hanging Piece",
	trappedPiece: "Trapped Piece",
	sacrifice: "Sacrifice",
	backRank: "Back Rank",
	backRankMate: "Back Rank Mate",
	promotion: "Promotion",
	enPassant: "En Passant",
	castling: "Castling",
	check: "Check",
	capture: "Capture",
	quietMove: "Quiet Move",
	mate: "Mate",
	mateIn1: "Mate in 1",
	mateIn2: "Mate in 2",
	mateIn3: "Mate in 3",
	mateIn4: "Mate in 4",
	mateIn5: "Mate in 5",
	mateThreat: "Mate Threat",
	smotheredMate: "Smothered Mate",
	anastasiaMate: "Anastasia Mate",
	hookMate: "Hook Mate",
	arabianMate: "Arabian Mate",
	bodenMate: "Boden Mate",
	doubleBishopMate: "Double Bishop Mate",
	dovetailMate: "Dovetail Mate",
	balestraMate: "Balestra Mate",
	blindSwineMate: "Blind Swine Mate",
	cornerMate: "Corner Mate",
	epauletteMate: "Epaulette Mate",
	killBoxMate: "Kill Box Mate",
	morphysMate: "Morphy's Mate",
	operaMate: "Opera Mate",
	pillsburysMate: "Pillsbury's Mate",
	swallowstailMate: "Swallow's Tail Mate",
	triangleMate: "Triangle Mate",
	vukovicMate: "Vukovic Mate",
	deflection: "Deflection",
	attraction: "Attraction",
	interference: "Interference",
	selfInterference: "Self-Interference",
	intermezzo: "Intermezzo",
	clearance: "Clearance Sacrifice",
	xRayAttack: "X-Ray Attack",
	collinearMove: "Collinear Move",
	discoveredCheck: "Discovered Check",
	zugzwang: "Zugzwang",
	capturingDefender: "Removing the Defender",
	defensiveMove: "Defensive Move",
	crushing: "Crushing",
	advantage: "Advantage",
	equality: "Equality",
	oneMove: "One Move",
	short: "Short",
	long: "Long",
	veryLong: "Very Long",
	pawnEndgame: "Pawn Endgame",
	rookEndgame: "Rook Endgame",
	bishopEndgame: "Bishop Endgame",
	knightEndgame: "Knight Endgame",
	queenEndgame: "Queen Endgame",
	queenRookEndgame: "Queen+Rook Endgame",
	kingsideAttack: "Kingside Attack",
	queensideAttack: "Queenside Attack",
	exposedKing: "Exposed King",
	advancedPawn: "Advanced Pawn",
	underPromotion: "Under-Promotion",
	attackingF2F7: "Attacking f2/f7",
	attacking_undefended_piece: "Threatening a Piece"
};
/** Normalise a move field to lowercase UCI (e.g. "e2e4"). */
function normalizeMove(fen, move) {
	if (!move) return null;
	if (typeof move === "object") {
		const uci = typeof move.uci === "string" && move.uci ? String(move.uci) : typeof move.from === "string" && typeof move.to === "string" ? `${move.from}${move.to}${typeof move.promotion === "string" ? move.promotion : ""}` : "";
		if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) return uci.toLowerCase();
		if (typeof move.san === "string") move = move.san;
		else return null;
	}
	if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move)) return move.toLowerCase();
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		const uci = cl.parseSANtoMove(move);
		return uci ? uci.toLowerCase() : null;
	} catch {
		return null;
	}
}
function normalizeBestMove(mistake) {
	return normalizeMove(mistake.fen, mistake.best);
}
function coerceMoveToUci(cl, moveLike) {
	if (!moveLike) return null;
	if (typeof moveLike === "string") {
		const mm = moveLike.trim();
		if (!mm) return null;
		if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(mm)) return mm.toLowerCase();
		try {
			const parsed = cl.parseSANtoMove(mm);
			if (parsed && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(parsed)) return String(parsed).toLowerCase();
		} catch {}
		return null;
	}
	if (moveLike && typeof moveLike === "object") {
		if (typeof moveLike.uci === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(moveLike.uci)) return String(moveLike.uci).toLowerCase();
		if (typeof moveLike.from === "string" && typeof moveLike.to === "string") {
			const promo = typeof moveLike.promotion === "string" && /^[qrbn]$/i.test(moveLike.promotion) ? String(moveLike.promotion).toLowerCase() : "";
			const candidate = `${moveLike.from}${moveLike.to}${promo}`;
			if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(candidate)) return candidate.toLowerCase();
		}
	}
	return null;
}
function normalizeSide(side, fen) {
	const raw = String(side || "").trim().toLowerCase();
	if (raw === "w" || raw === "white") return "w";
	if (raw === "b" || raw === "black") return "b";
	try {
		const turn = String(fen || "").trim().split(/\s+/)[1];
		if (turn === "w" || turn === "b") return turn;
	} catch {}
	return "w";
}
function shouldSuppressExchangeRecaptureHanging(step, mistake, steps = null) {
	if (!step || !step.uci || !step.capturedPiece) return false;
	const currentTo = step.uci.slice(2, 4);
	if (mistake) {
		const prevFen = mistake._prevFen;
		const prevPlayed = mistake._prevPlayedMove;
		if (!prevFen || !prevPlayed) return false;
		const prevUci = normalizeMove(prevFen, prevPlayed);
		if (!prevUci) return false;
		const prevTo = prevUci.slice(2, 4);
		if (prevTo !== currentTo) return false;
		let movedPrev = null;
		let capturedPrev = null;
		try {
			const prevBoard = ChessPrimitives(prevFen);
			const prevFromIdx = prevBoard.sqToIdx(prevUci.slice(0, 2));
			const prevToIdx = prevBoard.sqToIdx(prevTo);
			movedPrev = prevBoard.pieceAt(prevFromIdx);
			capturedPrev = prevBoard.pieceAt(prevToIdx);
			if (!capturedPrev && movedPrev && String(movedPrev).toUpperCase() === "P" && prevFromIdx >= 0 && prevToIdx >= 0) {
				const from = rcOf(prevFromIdx);
				const to = rcOf(prevToIdx);
				const movedSide = prevBoard.colorOf(movedPrev);
				if (from.c !== to.c && (movedSide === "w" || movedSide === "b")) {
					const epCapturedIdx = prevToIdx + (movedSide === "w" ? 8 : -8);
					if (epCapturedIdx >= 0 && epCapturedIdx < 64) {
						const epPiece = prevBoard.pieceAt(epCapturedIdx);
						if (epPiece && prevBoard.colorOf(epPiece) !== movedSide && String(epPiece).toUpperCase() === "P") capturedPrev = epPiece;
					}
				}
			}
		} catch {
			return false;
		}
		if (!movedPrev || !capturedPrev) return false;
		if (String(step.capturedPiece).toUpperCase() !== String(movedPrev).toUpperCase()) return false;
		const movedPrevVal = PIECE_VAL[movedPrev] || 0;
		const exchangeSwing = (PIECE_VAL[capturedPrev] || 0) - movedPrevVal;
		if (exchangeSwing === 0) return true;
		if (exchangeSwing > 0) return false;
		const deltaCp = typeof mistake.deltaCp === "number" ? Math.abs(mistake.deltaCp) : null;
		if (deltaCp !== null && deltaCp >= 100) return false;
		return true;
	}
	if (Array.isArray(steps)) {
		const idx = steps.indexOf(step);
		if (idx <= 0) return false;
		const prev = steps[idx - 1];
		if (!prev || !prev.uci || !prev.capturedPiece || !prev.movedPiece) return false;
		const prevSide = normalizeSide(prev.side, prev.fenBefore);
		const currSide = normalizeSide(step.side, step.fenBefore);
		if (!prevSide || !currSide || prevSide === currSide) return false;
		if (prev.uci.slice(2, 4) !== currentTo) return false;
		if (String(step.capturedPiece).toUpperCase() !== String(prev.movedPiece).toUpperCase()) return false;
		return (PIECE_VAL[prev.movedPiece] || 0) === (PIECE_VAL[prev.capturedPiece] || 0);
	}
	return false;
}
function isImmediatelyRecapturedOnDestination(steps, step, opponent) {
	if (!Array.isArray(steps) || !step || !step.uci || !step.movedPiece || !opponent) return false;
	const idx = steps.indexOf(step);
	if (idx < 0 || idx + 1 >= steps.length) return false;
	const next = steps[idx + 1];
	const nextSide = normalizeSide(next?.side, next?.fenBefore);
	if (!next || nextSide !== opponent || !next.uci || !next.capturedPiece) return false;
	if (next.uci.slice(2, 4) !== step.uci.slice(2, 4)) return false;
	const toIdx = step?.boardAfter?.sqToIdx?.(String(step.uci).slice(2, 4));
	const pieceOnDestination = Number.isInteger(toIdx) ? step?.boardAfter?.pieceAt?.(toIdx) : null;
	const movedType = String(pieceOnDestination || step.movedPiece).toUpperCase();
	return String(next.capturedPiece).toUpperCase() === movedType;
}
/**
* Suppress pin tags when the would-be pinning piece is immediately recaptured.
* Even if the capture wins material, a one-ply pin that disappears instantly
* is usually incidental noise rather than the core motif.
*/
function shouldSuppressPinOnImmediateTrade(steps, step, playerSide = null) {
	if (!Array.isArray(steps) || !step || !step.uci || !step.movedPiece) return false;
	const moverSide = normalizeSide(step.side, step.fenBefore) || normalizeSide(playerSide);
	if (!moverSide) return false;
	if (isImmediatelyRecapturedOnDestination(steps, step, moverSide === "w" ? "b" : "w")) return true;
	const idx = steps.indexOf(step);
	if (idx >= 0 && idx + 1 < steps.length) return false;
	const toSq = String(step.uci || "").slice(2, 4);
	if (!/^[a-h][1-8]$/.test(toSq)) return false;
	const toIdx = step?.boardAfter?.sqToIdx?.(toSq);
	if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) return false;
	const movedAfter = step.boardAfter.pieceAt(toIdx);
	if (!movedAfter || step.boardAfter.colorOf(movedAfter) !== moverSide) return false;
	const bestRecaptureGain = bestLegalCaptureGainOnSquare(step.boardAfter, moverSide, toIdx, movedAfter);
	if (!Number.isFinite(bestRecaptureGain)) return false;
	return bestRecaptureGain >= 0;
}
/**
* True if the side opposite `moverSide` has any legal recapture on target.
*/
function hasLegalRecapture(boardAfter, moverSide, targetIdx) {
	if (!boardAfter || !moverSide) return false;
	const opponent = moverSide === "w" ? "b" : "w";
	const recapturers = boardAfter.attackers(opponent, targetIdx);
	for (const di of recapturers) {
		const dp = boardAfter.pieceAt(di);
		if (!dp || boardAfter.colorOf(dp) !== opponent) continue;
		const dt = dp.toUpperCase();
		let canRecapture = true;
		if (dt === "K") canRecapture = boardAfter.attackers(moverSide, targetIdx).filter((ai) => ai !== di).length === 0;
		else if (pinnedDefenderCannotCapture(boardAfter, di, targetIdx)) canRecapture = false;
		if (canRecapture) return true;
	}
	return false;
}
/**
* Returns the best immediate material gain (targetValue - capturerValue)
* for the side opposite `moverSide` when capturing on `targetIdx`.
* Returns null when no legal capture exists.
*/
function bestLegalCaptureGainOnSquare(boardAfter, moverSide, targetIdx, targetPieceOverride = null) {
	if (!boardAfter || !moverSide || !Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return null;
	const opponent = moverSide === "w" ? "b" : "w";
	const targetPiece = targetPieceOverride || boardAfter.pieceAt(targetIdx);
	if (!targetPiece) return null;
	const targetVal = effectivePieceValue(targetPiece, targetIdx);
	const recapturers = boardAfter.attackers(opponent, targetIdx);
	let bestGain = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const di of recapturers) {
		const dp = boardAfter.pieceAt(di);
		if (!dp || boardAfter.colorOf(dp) !== opponent) continue;
		const dt = dp.toUpperCase();
		let canRecapture = true;
		if (dt === "K") canRecapture = boardAfter.attackers(moverSide, targetIdx).filter((ai) => ai !== di).length === 0;
		else if (pinnedDefenderCannotCapture(boardAfter, di, targetIdx)) canRecapture = false;
		if (!canRecapture) continue;
		found = true;
		const gain = targetVal - effectivePieceValue(dp, di);
		if (gain > bestGain) bestGain = gain;
	}
	return found ? bestGain : null;
}
function shouldSuppressCustomThreatRecapture(step, playerSide, steps = null) {
	if (!step || !step.boardAfter || !step.uci || !step.movedPiece) return false;
	if (step.capturedPiece) return false;
	const moverSide = step.side === "w" || step.side === "b" ? step.side : playerSide === "w" || playerSide === "b" ? playerSide : null;
	if (!moverSide) return false;
	const opponent = moverSide === "w" ? "b" : "w";
	if (Array.isArray(steps) && isImmediatelyRecapturedOnDestination(steps, step, opponent)) return true;
	const toSq = step.uci.slice(2, 4);
	if (!/^[a-h][1-8]$/.test(toSq)) return false;
	const toIdx = step.boardAfter.sqToIdx(toSq);
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	const bestRecaptureGain = bestLegalCaptureGainOnSquare(step.boardAfter, moverSide, toIdx, step.movedPiece);
	if (!Number.isFinite(bestRecaptureGain)) return false;
	return bestRecaptureGain >= 0;
}
function shouldSuppressAttackingUndefendedPieceOnImmediateTrade(steps, step, playerSide = null) {
	if (!Array.isArray(steps) || !step || !step.uci || !step.movedPiece) return false;
	const moverSide = step.side === "w" || step.side === "b" ? step.side : playerSide === "w" || playerSide === "b" ? playerSide : null;
	if (!moverSide) return false;
	if (!isImmediatelyRecapturedOnDestination(steps, step, moverSide === "w" ? "b" : "w")) return false;
	const toIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || "").slice(2, 4));
	const fromIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || "").slice(0, 2));
	return (step.capturedPiece ? effectivePieceValue(step.capturedPiece, Number.isInteger(toIdx) ? toIdx : null) : 0) - effectivePieceValue(step.movedPiece, Number.isInteger(fromIdx) ? fromIdx : null) <= 0;
}
function filterToTactical(themes) {
	let arr = [];
	try {
		if (Array.isArray(themes)) arr = themes;
		else if (themes && typeof themes[Symbol.iterator] === "function") arr = [...themes];
	} catch {}
	return [...new Set(arr)].filter((t) => TACTICAL_THEMES.has(t));
}
var FILES = "abcdefgh";
var PIECE_VAL = {
	P: 1,
	p: 1,
	N: 3,
	n: 3,
	B: 3,
	b: 3,
	R: 5,
	r: 5,
	Q: 9,
	q: 9,
	K: 0,
	k: 0
};
var DIAG_DIRS = [
	[-1, -1],
	[-1, 1],
	[1, -1],
	[1, 1]
];
var ORTH_DIRS = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1]
];
var ALL_DIRS = DIAG_DIRS.concat(ORTH_DIRS);
function rcOf(i) {
	return {
		r: Math.floor(i / 8),
		c: i % 8
	};
}
function idxOf(r, c) {
	return r * 8 + c;
}
function inBounds(r, c) {
	return r >= 0 && r < 8 && c >= 0 && c < 8;
}
function sqToIdx(sq) {
	return (7 - (parseInt(sq[1], 10) - 1)) * 8 + FILES.indexOf(sq[0]);
}
function idxToSq(i) {
	return FILES[i % 8] + (8 - Math.floor(i / 8));
}
function dist(i1, i2) {
	const { r: r1, c: c1 } = rcOf(i1);
	const { r: r2, c: c2 } = rcOf(i2);
	return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}
function effectivePieceValue(piece, idx = null) {
	const base = PIECE_VAL[piece] || 0;
	if (!piece || base <= 0) return 0;
	const type = String(piece).toUpperCase();
	if (type !== "P") return base;
	if (!Number.isInteger(idx) || idx < 0 || idx > 63) return base;
	const { r } = rcOf(idx);
	const distToPromotion = piece === type ? r : 7 - r;
	if (distToPromotion <= 1) return base + 4;
	if (distToPromotion === 2) return base + 2;
	if (distToPromotion === 3) return base + 1;
	return base;
}
/** Count total pieces on board */
function countPieces(board) {
	let count = 0;
	for (let i = 0; i < 64; i++) if (board.pieceAt(i)) count++;
	return count;
}
/** Get legal moves using ChessLite */
function getLegalMoves(fen) {
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		return cl.moves();
	} catch {
		return [];
	}
}
/** Check if position is checkmate */
function isCheckmate(fen) {
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		const loser = cl.turn();
		if (!cl.inCheck(loser)) return false;
		return cl.moves().length === 0;
	} catch {
		return false;
	}
}
/** Check if position is in check */
function positionInCheck(fen) {
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		return cl.inCheck(cl.turn());
	} catch {
		return false;
	}
}
/**
* FORK  after the best move, the moved piece attacks 2+ opponent
* pieces that are either higher-value or hanging (pawn targets excluded).
* King never forks. Piece must not be in bad spot.
* King can be counted as a valid fork target for all attacker types.
*/
function detectFork(boardAfter, toIdx, movedPieceChar, opponent) {
	if (!movedPieceChar) return false;
	if (movedPieceChar.toUpperCase() === "K") return false;
	if (boardAfter.isInBadSpot(toIdx)) return false;
	const movedVal = boardAfter.pieceValue(movedPieceChar);
	const attackedSquares = boardAfter.attacks(toIdx);
	const oppKingIdx = boardAfter.kingIdx(opponent);
	let count = oppKingIdx >= 0 && attackedSquares.includes(oppKingIdx) ? 1 : 0;
	for (const atkIdx of attackedSquares) {
		const target = boardAfter.pieceAt(atkIdx);
		if (!target) continue;
		if (boardAfter.colorOf(target) !== opponent) continue;
		if (target.toUpperCase() === "P") continue;
		if (target.toUpperCase() === "K") continue;
		if (boardAfter.PIECE_VALUES[target] > movedVal) count++;
		else if (boardAfter.isHanging(atkIdx)) {
			if (!boardAfter.attackers(opponent, toIdx).includes(atkIdx)) count++;
		}
	}
	return count >= 2;
}
/**
* FUNCTIONAL PIN  an opponent piece is attacked and cannot move without
* material loss. Detected by checking if after a player move, a high-value
* opponent piece is attacked but stays put (captured in a later player move
* on the same square). This covers knight-based pins that aren't ray pins.
*
* Extra guard: verify that the opponent piece doesn't move at all between
* the attack and the capture (truly stuck, not just a coincidental exchange).
*/
function detectFunctionalPin(_steps, playerSteps, piIdx, _side, opponent) {
	const step = playerSteps[piIdx];
	const boardAfter = step.boardAfter;
	const toIdx = boardAfter.sqToIdx(step.uci.slice(2, 4));
	const attacks = boardAfter.attacks(toIdx);
	const movedPiece = step.movedPiece;
	if (!movedPiece) return false;
	const movedType = movedPiece.toUpperCase();
	const movedVal = PIECE_VAL[movedPiece] || 0;
	if (movedType !== "N" && movedType !== "B") return false;
	for (const atkIdx of attacks) {
		const target = boardAfter.pieceAt(atkIdx);
		if (!target) continue;
		if (boardAfter.colorOf(target) !== opponent) continue;
		const tt = target.toUpperCase();
		if (tt === "P" || tt === "K") continue;
		if ((PIECE_VAL[target] || 0) <= movedVal) continue;
		const atkSq = idxToSq(atkIdx);
		const stepIdxInAll = _steps.indexOf(step);
		if (stepIdxInAll < 0) continue;
		let targetMoved = false;
		for (let si = stepIdxInAll + 1; si < _steps.length; si++) {
			const s = _steps[si];
			if (s.side === opponent && s.uci.slice(0, 2) === atkSq) {
				targetMoved = true;
				break;
			}
			if (s.side === _side && s.uci.slice(2, 4) === atkSq && s.capturedPiece) {
				if (!targetMoved) return true;
				break;
			}
		}
	}
	return false;
}
/**
* PIN  after the last player move, a friendly ray piece creates a NEW pin
* on an opponent piece through to a more valuable piece (or king) behind it.
*
* To reduce false positives, we ONLY check pins that are CAUSED by the move:
*   (a) The moved piece itself is the pinner (it landed on a square that pins), OR
*   (b) The move cleared a square on the pin ray (discovered pin).
* This avoids flagging incidental pin geometry that happens to exist on the board.
*/
function hasPinGeometry(board, pinnerIdx, pinnedIdx, behindIdx, side, opponent) {
	const pinner = board.pieceAt(pinnerIdx);
	const pinned = board.pieceAt(pinnedIdx);
	const behind = board.pieceAt(behindIdx);
	if (!pinner || !pinned || !behind) return false;
	if (board.colorOf(pinner) !== side) return false;
	if (board.colorOf(pinned) !== opponent || board.colorOf(behind) !== opponent) return false;
	if (pinned.toUpperCase() === "K") return false;
	const pType = pinner.toUpperCase();
	if (pType !== "B" && pType !== "R" && pType !== "Q") return false;
	const a = rcOf(pinnerIdx);
	const b = rcOf(pinnedIdx);
	const dr = b.r - a.r;
	const dc = b.c - a.c;
	if (dr === 0 && dc === 0) return false;
	const stepR = Math.sign(dr);
	const stepC = Math.sign(dc);
	const orth = stepR === 0 || stepC === 0;
	const diag = Math.abs(dr) === Math.abs(dc);
	if (!orth && !diag) return false;
	if (pType === "B" && !diag) return false;
	if (pType === "R" && !orth) return false;
	let rr = a.r + stepR;
	let cc = a.c + stepC;
	while (inBounds(rr, cc)) {
		const idx = idxOf(rr, cc);
		if (board.pieceAt(idx)) {
			if (idx !== pinnedIdx) return false;
			break;
		}
		rr += stepR;
		cc += stepC;
	}
	if (!inBounds(rr, cc)) return false;
	rr += stepR;
	cc += stepC;
	while (inBounds(rr, cc)) {
		const idx = idxOf(rr, cc);
		if (board.pieceAt(idx)) {
			if (idx !== behindIdx) return false;
			const behindType = behind.toUpperCase();
			const behindVal = board.PIECE_VALUES[behind] || 0;
			const pinnedVal = board.PIECE_VALUES[pinned] || 0;
			if (behindType === "K") return true;
			if (behindVal > pinnedVal) return true;
			return isEqualOrLowerPinWithUndefendedScreen(board, behind, behindVal, pinnedVal, behindIdx, opponent, side, pinnedIdx, pinnerIdx);
		}
		rr += stepR;
		cc += stepC;
	}
	return false;
}
function isMeaningfulRelativePin(behindVal, pinnedVal, pinnerVal) {
	if (!Number.isFinite(behindVal) || !Number.isFinite(pinnedVal) || !Number.isFinite(pinnerVal)) return false;
	if (behindVal <= pinnedVal) return false;
	if (behindVal <= pinnerVal) return false;
	return true;
}
function isLegalKingCaptureFromFen(fen, fromIdx, targetIdx) {
	if (typeof fen !== "string" || !fen.trim()) return false;
	if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) return false;
	if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return false;
	const fromSq = idxToSq(fromIdx);
	const toSq = idxToSq(targetIdx);
	if (!/^[a-h][1-8]$/.test(fromSq) || !/^[a-h][1-8]$/.test(toSq)) return false;
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		return !!cl.moveUci(`${fromSq}${toSq}`)?.ok;
	} catch {
		return false;
	}
}
function withFenTurn(fen, side) {
	if (typeof fen !== "string" || !fen.trim()) return null;
	if (side !== "w" && side !== "b") return null;
	const parts = String(fen).trim().split(/\s+/);
	if (parts.length < 2) return null;
	parts[1] = side;
	return parts.join(" ");
}
function tryApplyUciWithPromotionFallback(cl, uci, movedPiece, targetSq) {
	if (!cl || !uci) return null;
	let applied = null;
	try {
		applied = cl.moveUci(uci);
	} catch {}
	if (applied?.ok) return applied;
	if (String(movedPiece || "").toUpperCase() !== "P") return null;
	if (!/^[a-h][18]$/.test(String(targetSq || ""))) return null;
	if (uci.length !== 4) return null;
	for (const promo of [
		"q",
		"r",
		"b",
		"n"
	]) try {
		const p = cl.moveUci(`${uci}${promo}`);
		if (p?.ok) return p;
	} catch {}
	return null;
}
function canKingRecaptureAfterSingleCapture(fen, board, defenderSide, attackerSide, kingIdx, targetIdx) {
	if (!board) return false;
	if (!Number.isInteger(kingIdx) || kingIdx < 0 || kingIdx > 63) return false;
	if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return false;
	if (defenderSide !== "w" && defenderSide !== "b") return false;
	if (attackerSide !== "w" && attackerSide !== "b") return false;
	const fenAttackerTurn = withFenTurn(fen, attackerSide);
	if (!fenAttackerTurn) return false;
	const targetSq = idxToSq(targetIdx);
	const attackerCandidates = board.attackers(attackerSide, targetIdx) || [];
	for (const ai of attackerCandidates) {
		const ap = board.pieceAt(ai);
		if (!ap || board.colorOf(ap) !== attackerSide) continue;
		if (String(ap).toUpperCase() === "K") continue;
		if (pinnedDefenderCannotCapture(board, ai, targetIdx)) continue;
		const captureUci = `${idxToSq(ai)}${targetSq}`;
		let fenAfterCapture = null;
		try {
			const clCap = ChessLite();
			clCap.loadFEN(fenAttackerTurn);
			if (!tryApplyUciWithPromotionFallback(clCap, captureUci, ap, targetSq)?.ok) continue;
			fenAfterCapture = clCap.fen();
		} catch {
			continue;
		}
		if (!fenAfterCapture) continue;
		try {
			const kingAfterIdx = ChessPrimitives(fenAfterCapture).kingIdx(defenderSide);
			if (!Number.isInteger(kingAfterIdx) || kingAfterIdx < 0) continue;
			const recaptureUci = `${idxToSq(kingAfterIdx)}${targetSq}`;
			const clRecap = ChessLite();
			clRecap.loadFEN(fenAfterCapture);
			if (clRecap.moveUci(recaptureUci)?.ok) return true;
		} catch {}
	}
	return false;
}
function countEffectiveCapturers(board, capturerSide, opposingSide, targetIdx, options = null) {
	if (!board || !Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return 0;
	const excludeIdx = options && Number.isInteger(options.excludeIdx) ? options.excludeIdx : -1;
	const fen = options && typeof options.fen === "string" ? options.fen : null;
	const candidates = board.attackers(capturerSide, targetIdx);
	if (!Array.isArray(candidates) || !candidates.length) return 0;
	let count = 0;
	for (const ci of candidates) {
		if (ci === excludeIdx) continue;
		const cp = board.pieceAt(ci);
		if (!cp || board.colorOf(cp) !== capturerSide) continue;
		if (cp.toUpperCase() === "K") {
			if (fen) {
				if (isLegalKingCaptureFromFen(fen, ci, targetIdx)) {
					count++;
					continue;
				}
				const targetPiece = board.pieceAt(targetIdx);
				if (!!targetPiece && board.colorOf(targetPiece) === capturerSide && canKingRecaptureAfterSingleCapture(fen, board, capturerSide, opposingSide, ci, targetIdx)) {
					count++;
					continue;
				}
				continue;
			} else if (board.attackers(opposingSide, targetIdx).filter((ei) => ei !== ci).length > 0) continue;
			count++;
			continue;
		}
		if (pinnedDefenderCannotCapture(board, ci, targetIdx)) continue;
		count++;
	}
	return count;
}
function isEffectivelyUnderdefended(board, targetIdx, defenderSide, attackerSide, options = null) {
	const excludeDefenderIdx = options && Number.isInteger(options.excludeDefenderIdx) ? options.excludeDefenderIdx : -1;
	const extraAttackers = options && Number.isInteger(options.extraAttackers) ? Math.max(0, options.extraAttackers) : 0;
	const fen = options && typeof options.fen === "string" ? options.fen : null;
	return countEffectiveCapturers(board, attackerSide, defenderSide, targetIdx, { fen }) + extraAttackers > countEffectiveCapturers(board, defenderSide, attackerSide, targetIdx, {
		excludeIdx: excludeDefenderIdx,
		fen
	});
}
function countXRaySupportBehindPinner(board, attackerSide, pinnerIdx, targetIdx) {
	if (!board) return 0;
	if (!Number.isInteger(pinnerIdx) || pinnerIdx < 0 || pinnerIdx > 63) return 0;
	if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return 0;
	const pinner = board.pieceAt(pinnerIdx);
	if (!pinner || board.colorOf(pinner) !== attackerSide) return 0;
	const { r: pr, c: pc } = rcOf(pinnerIdx);
	const { r: tr, c: tc } = rcOf(targetIdx);
	const dr = tr - pr;
	const dc = tc - pc;
	if (dr === 0 && dc === 0) return 0;
	const stepR = Math.sign(dr);
	const stepC = Math.sign(dc);
	const orth = stepR === 0 || stepC === 0;
	const diag = Math.abs(dr) === Math.abs(dc);
	if (!orth && !diag) return 0;
	const pinnerType = String(pinner).toUpperCase();
	if (diag && pinnerType !== "B" && pinnerType !== "Q") return 0;
	if (orth && pinnerType !== "R" && pinnerType !== "Q") return 0;
	let rr = pr - stepR;
	let cc = pc - stepC;
	while (inBounds(rr, cc)) {
		const idx = idxOf(rr, cc);
		const piece = board.pieceAt(idx);
		if (!piece) {
			rr -= stepR;
			cc -= stepC;
			continue;
		}
		if (board.colorOf(piece) !== attackerSide) return 0;
		const type = String(piece).toUpperCase();
		return (diag ? type === "B" || type === "Q" : type === "R" || type === "Q") ? 1 : 0;
	}
	return 0;
}
function isEqualOrLowerPinWithUndefendedScreen(board, behindPiece, behindVal, pinnedVal, behindIdx, defenderSide, attackerSide, pinnedIdx, pinnerIdx = -1) {
	if (!Number.isFinite(behindVal) || !Number.isFinite(pinnedVal)) return false;
	if (!behindPiece || String(behindPiece).toUpperCase() === "P") return false;
	const currentAttackers = board.attackers(attackerSide, behindIdx);
	const pinnerAlreadyAttacks = Array.isArray(currentAttackers) && currentAttackers.includes(pinnerIdx);
	return isEffectivelyUnderdefended(board, behindIdx, defenderSide, attackerSide, {
		excludeDefenderIdx: pinnedIdx,
		extraAttackers: (pinnerIdx >= 0 && !pinnerAlreadyAttacks ? 1 : 0) + (pinnerIdx >= 0 ? countXRaySupportBehindPinner(board, attackerSide, pinnerIdx, behindIdx) : 0)
	});
}
/**
* Borderline pin probe: if the defender "accepts" by moving the pinned piece,
* can the attacker immediately win the screened piece?
*
* This targets conditional pin motifs (like moving a blocker that opens a
* tactical capture), without running expensive multipv analysis.
*/
function detectAcceptedPinConsequence(fenAfter, boardAfter, attackerSide, defenderSide, pinnedIdx, screenedIdx, pinnerIdx) {
	if (!fenAfter || !boardAfter) return false;
	if (!Number.isInteger(pinnedIdx) || !Number.isInteger(screenedIdx) || !Number.isInteger(pinnerIdx)) return false;
	const pinnedSq = idxToSq(pinnedIdx);
	const screenedSq = idxToSq(screenedIdx);
	const pinnerSq = idxToSq(pinnerIdx);
	const pinnedPiece = boardAfter.pieceAt(pinnedIdx);
	const screenedPiece = boardAfter.pieceAt(screenedIdx);
	const pinnerPiece = boardAfter.pieceAt(pinnerIdx);
	if (!pinnedPiece || !screenedPiece || !pinnerPiece) return false;
	if (boardAfter.colorOf(pinnedPiece) !== defenderSide) return false;
	if (boardAfter.colorOf(screenedPiece) !== defenderSide) return false;
	if (boardAfter.colorOf(pinnerPiece) !== attackerSide) return false;
	if (String(screenedPiece).toUpperCase() === "K") return false;
	if ((PIECE_VAL[screenedPiece] || 0) < 2) return false;
	try {
		if (String(fenAfter).trim().split(/\s+/)[1] !== defenderSide) return false;
	} catch {
		return false;
	}
	let legalMoves = [];
	try {
		const cl = ChessLite();
		cl.loadFEN(fenAfter);
		const raw = cl.moves() || [];
		for (const m of raw) {
			const uci = coerceMoveToUci(cl, m);
			if (!uci) continue;
			if (uci.slice(0, 2) !== pinnedSq) continue;
			if (uci.slice(2, 4) === pinnerSq) continue;
			legalMoves.push(uci);
			if (legalMoves.length >= 10) break;
		}
	} catch {
		return false;
	}
	if (!legalMoves.length) return false;
	const pinnerType = String(pinnerPiece).toUpperCase();
	const screenedType = String(screenedPiece).toUpperCase();
	for (const acceptUci of legalMoves) {
		let fenAccepted = null;
		try {
			const clAccept = ChessLite();
			clAccept.loadFEN(fenAfter);
			const ok = clAccept.moveUci(acceptUci);
			if (!ok || !ok.ok) continue;
			fenAccepted = clAccept.fen();
		} catch {
			continue;
		}
		if (!fenAccepted) continue;
		let boardAccepted = null;
		try {
			boardAccepted = ChessPrimitives(fenAccepted);
		} catch {
			continue;
		}
		const pinnerNowIdx = boardAccepted.sqToIdx(pinnerSq);
		const pinnerNow = boardAccepted.pieceAt(pinnerNowIdx);
		if (!pinnerNow || boardAccepted.colorOf(pinnerNow) !== attackerSide) continue;
		if (String(pinnerNow).toUpperCase() !== pinnerType) continue;
		const screenedNowIdx = boardAccepted.sqToIdx(screenedSq);
		const screenedNow = boardAccepted.pieceAt(screenedNowIdx);
		if (!screenedNow || boardAccepted.colorOf(screenedNow) !== defenderSide) continue;
		if (String(screenedNow).toUpperCase() !== screenedType) continue;
		const attacks = boardAccepted.attacks(pinnerNowIdx);
		if (!Array.isArray(attacks) || !attacks.includes(screenedNowIdx)) continue;
		const captureUci = `${pinnerSq}${screenedSq}`;
		let fenAfterCapture = null;
		try {
			const clCap = ChessLite();
			clCap.loadFEN(fenAccepted);
			const cap = clCap.moveUci(captureUci);
			if (!cap || !cap.ok) continue;
			fenAfterCapture = clCap.fen();
		} catch {
			continue;
		}
		if (!fenAfterCapture) continue;
		let boardAfterCapture = null;
		try {
			boardAfterCapture = ChessPrimitives(fenAfterCapture);
		} catch {
			continue;
		}
		const captureIdx = boardAfterCapture.sqToIdx(screenedSq);
		const recaptured = hasLegalRecapture(boardAfterCapture, attackerSide, captureIdx);
		const capturedVal = PIECE_VAL[screenedNow] || 0;
		const pinnerVal = PIECE_VAL[pinnerNow] || 0;
		const favorablePrimaryCapture = capturedVal > pinnerVal;
		if (!recaptured && favorablePrimaryCapture && capturedVal >= 2) return true;
		if (recaptured && favorablePrimaryCapture && capturedVal - pinnerVal >= 2) return true;
		if (recaptured) {
			const defenderRecapturers = boardAfterCapture.attackers(defenderSide, captureIdx) || [];
			for (const di of defenderRecapturers) {
				const dp = boardAfterCapture.pieceAt(di);
				if (!dp || boardAfterCapture.colorOf(dp) !== defenderSide) continue;
				const dt = String(dp).toUpperCase();
				let canRecapture = true;
				if (dt === "K") canRecapture = boardAfterCapture.attackers(attackerSide, captureIdx).filter((ai) => ai !== di).length === 0;
				else if (pinnedDefenderCannotCapture(boardAfterCapture, di, captureIdx)) canRecapture = false;
				if (!canRecapture) continue;
				const recaptureUci = `${idxToSq(di)}${screenedSq}`;
				let fenAfterRecapture = null;
				try {
					const clRecap = ChessLite();
					clRecap.loadFEN(fenAfterCapture);
					const rr = clRecap.moveUci(recaptureUci);
					if (!rr || !rr.ok) continue;
					fenAfterRecapture = clRecap.fen();
				} catch {
					continue;
				}
				if (!fenAfterRecapture) continue;
				let boardAfterRecapture = null;
				try {
					boardAfterRecapture = ChessPrimitives(fenAfterRecapture);
				} catch {
					continue;
				}
				if (!hasLegalRecapture(boardAfterRecapture, defenderSide, boardAfterRecapture.sqToIdx(screenedSq))) continue;
				const recapturerVal = PIECE_VAL[dp] || 0;
				if (favorablePrimaryCapture && capturedVal - pinnerVal + recapturerVal >= 2) return true;
			}
		}
	}
	return false;
}
function hasLegalMoveFromSquare(fen, fromSq, options = null) {
	if (!fen || !/^[a-h][1-8]$/.test(String(fromSq || ""))) return false;
	const excludeToSquare = /^[a-h][1-8]$/.test(String(options?.excludeToSquare || "")) ? String(options.excludeToSquare) : null;
	try {
		const cl = ChessLite();
		cl.loadFEN(fen);
		const raw = cl.moves() || [];
		for (const m of raw) {
			const uci = coerceMoveToUci(cl, m);
			if (!uci) continue;
			if (uci.slice(0, 2) !== fromSq) continue;
			if (excludeToSquare && uci.slice(2, 4) === excludeToSquare) continue;
			return true;
		}
	} catch {}
	return false;
}
function hasImmediatePinPayoffInSteps(steps, stepIndex, attackerSide, pinnedIdx, screenedIdx = -1) {
	if (!Array.isArray(steps) || !Number.isInteger(stepIndex) || stepIndex < 0) return false;
	if (!Number.isInteger(pinnedIdx) || pinnedIdx < 0 || pinnedIdx > 63) return false;
	const pinnedSq = idxToSq(pinnedIdx);
	const screenedSq = Number.isInteger(screenedIdx) && screenedIdx >= 0 && screenedIdx <= 63 ? idxToSq(screenedIdx) : null;
	const maxIdx = Math.min(steps.length - 1, stepIndex + 3);
	for (let i = stepIndex + 1; i <= maxIdx; i++) {
		const step = steps[i];
		if (!step || !step.uci || !step.capturedPiece) continue;
		if (normalizeSide(step.side, step.fenBefore) !== attackerSide) continue;
		const toSq = step.uci.slice(2, 4);
		if (toSq === pinnedSq || screenedSq && toSq === screenedSq) return true;
	}
	return false;
}
function detectPin(boardAfter, toIdx, side, opponent, boardBefore, fromIdxHint = null) {
	const fromIdx = Number.isInteger(fromIdxHint) && fromIdxHint >= 0 ? fromIdxHint : boardBefore ? _findFromIdx(boardAfter, boardBefore, side, toIdx) : -1;
	for (let i = 0; i < 64; i++) {
		const pc = boardAfter.pieceAt(i);
		if (!pc) continue;
		if (boardAfter.colorOf(pc) !== side) continue;
		const t = pc.toUpperCase();
		if (t !== "B" && t !== "R" && t !== "Q") continue;
		const dirs = t === "B" ? DIAG_DIRS : t === "R" ? ORTH_DIRS : ALL_DIRS;
		const { r: pr, c: pCol } = rcOf(i);
		for (const [dr, dc] of dirs) {
			let rr = pr + dr, cc = pCol + dc;
			let firstPiece = null, firstIdx = -1;
			let raySquares = [];
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const p = boardAfter.pieceAt(idx);
				if (p) {
					firstPiece = p;
					firstIdx = idx;
					break;
				}
				raySquares.push(idx);
				rr += dr;
				cc += dc;
			}
			if (!firstPiece || boardAfter.colorOf(firstPiece) !== opponent) continue;
			if (firstPiece.toUpperCase() === "K") continue;
			rr = rcOf(firstIdx).r + dr;
			cc = rcOf(firstIdx).c + dc;
			let behindRaySquares = [];
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const p = boardAfter.pieceAt(idx);
				if (p) {
					if (boardAfter.colorOf(p) === opponent) {
						const behindType = p.toUpperCase();
						const pinnedType = firstPiece.toUpperCase();
						const behindVal = boardAfter.PIECE_VALUES[p] || 0;
						const pinnedVal = boardAfter.PIECE_VALUES[firstPiece] || 0;
						const highValuePin = isMeaningfulRelativePin(behindVal, pinnedVal, boardAfter.PIECE_VALUES[pc] || 0);
						const undefendedEqualOrLowerPin = isEqualOrLowerPinWithUndefendedScreen(boardAfter, p, behindVal, pinnedVal, idx, opponent, side, firstIdx, i);
						if (behindType === "K" || highValuePin || undefendedEqualOrLowerPin) {
							if (pinnedType === "P" && behindType !== "K") break;
							const pinnerIsMoved = i === toIdx;
							const moveCleared = fromIdx >= 0 && (raySquares.includes(fromIdx) || behindRaySquares.includes(fromIdx));
							if (!pinnerIsMoved && !moveCleared) break;
							if (boardBefore) {
								const pinnerBefore = boardBefore.pieceAt(i);
								const pinnedBefore = boardBefore.pieceAt(firstIdx);
								const behindBefore = boardBefore.pieceAt(idx);
								if (pinnerBefore && boardBefore.colorOf(pinnerBefore) === side && pinnerBefore.toUpperCase() === t && pinnedBefore && pinnedBefore === firstPiece && behindBefore && behindBefore === p) break;
								if (pinnerIsMoved && fromIdx >= 0) {
									const movedBefore = boardBefore.pieceAt(fromIdx);
									if (movedBefore && movedBefore === pc) {
										if (hasPinGeometry(boardBefore, fromIdx, firstIdx, idx, side, opponent)) break;
									}
								}
							}
							return true;
						}
					}
					break;
				}
				behindRaySquares.push(idx);
				rr += dr;
				cc += dc;
			}
		}
	}
	return false;
}
/**
* Returns true when a pinned defender that attacks `targetIdx` cannot
* legally capture there because moving would expose its king.
*/
function pinnedDefenderCannotCapture(boardAfter, defenderIdx, targetIdx) {
	const defender = boardAfter.pieceAt(defenderIdx);
	if (!defender) return false;
	const pinnerIdx = boardAfter.isPinned(defenderIdx);
	if (pinnerIdx === null || pinnerIdx === void 0) return false;
	if (targetIdx === pinnerIdx) return false;
	const clr = boardAfter.colorOf(defender);
	const ki = boardAfter.kingIdx(clr);
	if (ki < 0) return false;
	const lineSquares = boardAfter.squaresBetween(ki, pinnerIdx);
	if (!Array.isArray(lineSquares) || !lineSquares.length) return true;
	if (!lineSquares.includes(targetIdx)) return true;
	return false;
}
/**
* PIN EXPLOITATION (type A):
* Move lands on a square attacked by opponent pieces, but all would-be
* capturers are effectively unable to capture because they are pinned (or king-capture is illegal).
*/
function detectPinnedDefenderExploitation(boardAfter, toIdx, side, opponent) {
	const defenders = boardAfter.attackers(opponent, toIdx);
	if (!defenders.length) return false;
	let blockedCapturers = 0;
	let legalCapturers = 0;
	let consideredDefenders = 0;
	for (const di of defenders) {
		const dp = boardAfter.pieceAt(di);
		if (!dp || boardAfter.colorOf(dp) !== opponent) continue;
		if (dp.toUpperCase() === "K") continue;
		consideredDefenders++;
		if (!pinnedDefenderCannotCapture(boardAfter, di, toIdx)) legalCapturers++;
		else blockedCapturers++;
	}
	if (consideredDefenders === 0) return false;
	return blockedCapturers > 0 && legalCapturers === 0;
}
/**
* PIN EXPLOITATION (type B):
* Move increases pressure on a piece that is already pinned (or captures that pinned piece).
*/
function detectPinnedPiecePressure(boardBefore, boardAfter, toIdx, side, opponent, fenAfter = null, options = null) {
	const fromIdx = boardBefore ? _findFromIdx(boardAfter, boardBefore, side, toIdx) : -1;
	function getPinTargetInfo(board, pinnedIdx, fenContext = null) {
		const pinned = board.pieceAt(pinnedIdx);
		if (!pinned || board.colorOf(pinned) !== opponent) return null;
		if (pinned.toUpperCase() === "K") return null;
		const absolutePinner = board.isPinned(pinnedIdx);
		if (absolutePinner !== null && absolutePinner !== void 0) return {
			ok: true,
			isAbsolute: true,
			pinnedType: pinned.toUpperCase(),
			behindType: "K",
			pinnerIdx: absolutePinner,
			screenedIdx: board.kingIdx(opponent)
		};
		const pinnedVal = board.PIECE_VALUES[pinned] || 0;
		const { r: pr, c: pc } = rcOf(pinnedIdx);
		for (const [dr, dc] of ALL_DIRS) {
			let rr = pr + dr, cc = pc + dc;
			let hasAttackingSlider = false;
			let attackingSliderVal = 0;
			let attackingSliderIdx = -1;
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const piece = board.pieceAt(idx);
				if (piece) {
					if (board.colorOf(piece) === side) {
						const type = piece.toUpperCase();
						const isDiag = dr !== 0 && dc !== 0;
						hasAttackingSlider = isDiag && (type === "B" || type === "Q") || !isDiag && (type === "R" || type === "Q");
						if (hasAttackingSlider) {
							attackingSliderVal = board.PIECE_VALUES[piece] || 0;
							attackingSliderIdx = idx;
						}
					}
					break;
				}
				rr += dr;
				cc += dc;
			}
			if (!hasAttackingSlider) continue;
			rr = pr - dr;
			cc = pc - dc;
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const piece = board.pieceAt(idx);
				if (piece) {
					if (board.colorOf(piece) === opponent) {
						const behindType = piece.toUpperCase();
						const behindVal = board.PIECE_VALUES[piece] || 0;
						if (behindType === "K") return {
							ok: true,
							isAbsolute: true,
							pinnedType: pinned.toUpperCase(),
							behindType,
							pinnerIdx: attackingSliderIdx,
							screenedIdx: idx
						};
						const highValuePin = isMeaningfulRelativePin(behindVal, pinnedVal, attackingSliderVal);
						const undefendedEqualOrLowerPin = isEqualOrLowerPinWithUndefendedScreen(board, piece, behindVal, pinnedVal, idx, opponent, side, pinnedIdx, attackingSliderIdx);
						const acceptedPinProbe = !highValuePin && !undefendedEqualOrLowerPin ? detectAcceptedPinConsequence(fenContext, board, side, opponent, pinnedIdx, idx, attackingSliderIdx) : false;
						if (highValuePin || undefendedEqualOrLowerPin || acceptedPinProbe) return {
							ok: true,
							isAbsolute: false,
							pinnedType: pinned.toUpperCase(),
							behindType,
							pinnerIdx: attackingSliderIdx,
							screenedIdx: idx
						};
					}
					break;
				}
				rr -= dr;
				cc -= dc;
			}
		}
		return null;
	}
	const attacks = boardAfter.attacks(toIdx);
	for (const atkIdx of attacks) {
		const target = boardAfter.pieceAt(atkIdx);
		if (!target || boardAfter.colorOf(target) !== opponent) continue;
		const pinInfoAfter = getPinTargetInfo(boardAfter, atkIdx, fenAfter);
		if (!pinInfoAfter?.ok) continue;
		if (boardBefore && fromIdx >= 0) {
			const beforeAttacks = boardBefore.attacks(fromIdx);
			if (Array.isArray(beforeAttacks) && beforeAttacks.includes(atkIdx)) continue;
		}
		if (!pinInfoAfter.isAbsolute && pinInfoAfter.pinnedType === "P") {
			if (boardAfter.attackers(side, atkIdx).length < 2) continue;
		}
		if (pinInfoAfter.isAbsolute && pinInfoAfter.pinnedType === "P") {
			if (hasLegalMoveFromSquare(fenAfter, idxToSq(atkIdx), { excludeToSquare: Number.isInteger(pinInfoAfter.pinnerIdx) ? idxToSq(pinInfoAfter.pinnerIdx) : null })) {
				if (!hasImmediatePinPayoffInSteps(options?.steps, options?.stepIndex, side, atkIdx, pinInfoAfter.screenedIdx)) continue;
			}
		}
		return true;
	}
	return false;
}
/**
* PIN (broadened):
* - new/created ray pin (detectPin),
* - functional pin continuation (detectFunctionalPin),
* - exploitation of existing pinned defenders/pieces.
*/
function detectPinExploitation(boardBefore, boardAfter, toIdx, side, opponent, fenAfter = null, options = null) {
	try {
		if (detectPinnedDefenderExploitation(boardAfter, toIdx, side, opponent)) return true;
	} catch {}
	try {
		if (detectPinnedPiecePressure(boardBefore, boardAfter, toIdx, side, opponent, fenAfter, options)) return true;
	} catch {}
	return false;
}
/** Helper: find the from-square index by comparing boards */
function _findFromIdx(boardAfter, boardBefore, side, toIdx) {
	const pc = boardAfter.pieceAt(toIdx);
	if (!pc) return -1;
	if (boardBefore.pieceAt(toIdx) === pc) return -1;
	for (let i = 0; i < 64; i++) {
		if (i === toIdx) continue;
		const bp = boardBefore.pieceAt(i);
		if (bp === pc && boardAfter.pieceAt(i) !== bp) return i;
	}
	return -1;
}
/**
* SKEWER  after best move a ray piece attacks a high-value opponent
* piece, with a lower-value piece behind it on the same ray.
* The front piece must be genuinely more valuable (King counts as highest,
* and we need at least 2 pts difference for non-king).
* The moved piece must be the ray piece creating the skewer (not just any piece).
*/
function detectSkewer(boardAfter, toIdx, movedPieceChar, opponent) {
	if (!movedPieceChar) return false;
	const t = movedPieceChar.toUpperCase();
	if (t !== "B" && t !== "R" && t !== "Q") return false;
	const dirs = t === "B" ? DIAG_DIRS : t === "R" ? ORTH_DIRS : ALL_DIRS;
	const { r: pr, c: pCol } = rcOf(toIdx);
	for (const [dr, dc] of dirs) {
		let rr = pr + dr, cc = pCol + dc;
		let firstPiece = null, firstIdx = -1;
		while (inBounds(rr, cc)) {
			const idx = idxOf(rr, cc);
			const p = boardAfter.pieceAt(idx);
			if (p) {
				firstPiece = p;
				firstIdx = idx;
				break;
			}
			rr += dr;
			cc += dc;
		}
		if (!firstPiece || boardAfter.colorOf(firstPiece) !== opponent) continue;
		if (firstPiece.toUpperCase() !== "K") continue;
		rr = rcOf(firstIdx).r + dr;
		cc = rcOf(firstIdx).c + dc;
		while (inBounds(rr, cc)) {
			const idx = idxOf(rr, cc);
			const p = boardAfter.pieceAt(idx);
			if (p) {
				if (boardAfter.colorOf(p) === opponent) {
					if (p.toUpperCase() === "P") break;
					return true;
				}
				break;
			}
			rr += dr;
			cc += dc;
		}
	}
	return false;
}
/**
* DISCOVERED ATTACK  moving the piece from origin reveals an attack
* from a friendly ray piece through the origin onto an enemy piece.
* Also handles en passant: removing the captured pawn may reveal an attack.
*/
function findRevealedRayAttack(boardBefore, boardAfter, openedIdx, side) {
	if (!Number.isInteger(openedIdx) || openedIdx < 0 || openedIdx > 63) return null;
	const opponent = side === "w" ? "b" : "w";
	const { r: fr, c: fc } = rcOf(openedIdx);
	for (const [dr, dc] of ALL_DIRS) {
		let attackerIdx = -1;
		let attackerPiece = null;
		let rr = fr + dr, cc = fc + dc;
		while (inBounds(rr, cc)) {
			const idx = idxOf(rr, cc);
			const p = boardAfter.pieceAt(idx);
			if (p) {
				if (boardAfter.colorOf(p) === side) {
					const t = p.toUpperCase();
					const isDiag = dr !== 0 && dc !== 0;
					if (isDiag && (t === "B" || t === "Q") || !isDiag && (t === "R" || t === "Q")) {
						attackerIdx = idx;
						attackerPiece = p;
					}
				}
				break;
			}
			rr += dr;
			cc += dc;
		}
		if (attackerIdx < 0 || !attackerPiece) continue;
		let targetIdx = -1;
		let targetPiece = null;
		rr = fr - dr;
		cc = fc - dc;
		while (inBounds(rr, cc)) {
			const idx = idxOf(rr, cc);
			const p = boardAfter.pieceAt(idx);
			if (p) {
				if (boardAfter.colorOf(p) === opponent && p.toUpperCase() !== "P") {
					targetIdx = idx;
					targetPiece = p;
				}
				break;
			}
			rr -= dr;
			cc -= dc;
		}
		if (targetIdx < 0 || !targetPiece) continue;
		if (boardBefore.attackers(side, targetIdx).includes(attackerIdx)) continue;
		return {
			attackerIdx,
			attackerPiece,
			targetIdx,
			targetPiece
		};
	}
	return null;
}
function isRelevantDiscoveredHit(boardAfter, hit) {
	if (!hit || !hit.targetPiece || !hit.attackerPiece) return false;
	if (hit.targetPiece.toUpperCase() === "K") return true;
	if (boardAfter.isInBadSpot(hit.targetIdx)) return true;
	if (boardAfter.isPinned(hit.targetIdx)) return true;
	const attackerVal = PIECE_VAL[hit.attackerPiece] || 0;
	const targetVal = PIECE_VAL[hit.targetPiece] || 0;
	if (targetVal > attackerVal) return true;
	if (targetVal < attackerVal) return false;
	const side = boardAfter.colorOf(hit.attackerPiece);
	if (side !== "w" && side !== "b") return false;
	const opponent = side === "w" ? "b" : "w";
	return boardAfter.attackers(side, hit.targetIdx).length > boardAfter.attackers(opponent, hit.targetIdx).length;
}
function detectDiscoveredAttack(boardBefore, boardAfter, fromIdx, toIdx, side, isEp) {
	try {
		const movedBefore = boardBefore?.pieceAt?.(fromIdx);
		if (movedBefore && String(movedBefore).toUpperCase() === "P") {
			const toRow = rcOf(toIdx).r;
			if (toRow === 0 || toRow === 7) return false;
		}
	} catch {}
	if (isRelevantDiscoveredHit(boardAfter, findRevealedRayAttack(boardBefore, boardAfter, fromIdx, side))) return true;
	if (isEp) {
		const epCapturedRow = rcOf(fromIdx).r;
		const epCapturedCol = rcOf(toIdx).c;
		if (isRelevantDiscoveredHit(boardAfter, findRevealedRayAttack(boardBefore, boardAfter, idxOf(epCapturedRow, epCapturedCol), side))) return true;
	}
	return false;
}
/**
* DOUBLE CHECK  2+ pieces give check after the best move.
*/
function detectDoubleCheck(boardAfter, opponent) {
	return boardAfter.checkerCount(opponent) >= 2;
}
/**
* TRAPPED PIECE  after best move, an opponent piece (worth 3+ pts)
* is in a bad spot with no safe escape squares.
* Scans ALL opponent non-pawn, non-king pieces that are in a bad spot.
* Uses attack-based heuristic for speed.
*/
function detectTrappedPiece(boardBefore, boardAfter, _toIdx, opponent, _fenAfter, _fenBefore = null, options = null) {
	const side = opponent === "w" ? "b" : "w";
	if (!boardAfter) return false;
	const DEFERRED_TRAP_LOOKAHEAD_PLIES = 5;
	const DEFERRED_TRAP_MIN_GAIN = 2;
	const ENABLE_TRAPPED_ESCAPE_CONCESSION = false;
	const BRANCH_PROOF_MAX_NODES = 180;
	const BRANCH_PROOF_MAX_MS = 6;
	if (typeof _fenAfter === "string" && _fenAfter.trim() && positionInCheck(_fenAfter)) return false;
	function moveFromSq(m) {
		if (!m) return null;
		if (typeof m === "string") return m.slice(0, 2);
		if (typeof m.from === "string") return m.from;
		if (typeof m.uci === "string") return m.uci.slice(0, 2);
		return null;
	}
	function moveToUci(m) {
		if (!m) return null;
		if (typeof m === "string") return m.toLowerCase();
		if (typeof m.uci === "string") return m.uci.toLowerCase();
		if (typeof m.from === "string" && typeof m.to === "string") {
			const promo = typeof m.promotion === "string" && m.promotion ? m.promotion.toLowerCase() : "";
			return `${m.from}${m.to}${promo}`;
		}
		return null;
	}
	function simulateFenAfterMove(startFen, move) {
		const uci = moveToUci(move);
		if (!uci || typeof startFen !== "string" || !startFen.trim()) return null;
		try {
			const cl = ChessLite();
			cl.loadFEN(startFen);
			if (!cl.moveUci(uci)?.ok) return null;
			return cl.fen();
		} catch {
			return null;
		}
	}
	function analyzePieceState(board, pieceIdx, ownSide, enemySide, fenContext = null) {
		const piece = board.pieceAt(pieceIdx);
		if (!piece || board.colorOf(piece) !== ownSide) return null;
		const pieceVal = PIECE_VAL[piece] || 0;
		const attacks = board.attacks(pieceIdx) || [];
		const legalSquares = [];
		const safeSquares = [];
		let canTradeUpCapture = false;
		const fromSq = idxToSq(pieceIdx);
		const simFen = (() => {
			try {
				if (typeof fenContext !== "string" || !fenContext.trim()) return null;
				const parts = fenContext.trim().split(/\s+/);
				if (parts.length < 2) return fenContext.trim();
				if (String(parts[1] || "").toLowerCase() === ownSide) return parts.join(" ");
				parts[1] = ownSide;
				return parts.join(" ");
			} catch {
				return null;
			}
		})();
		const canSimulate = typeof simFen === "string" && !!simFen.trim();
		for (const dst of attacks) {
			const occ = board.pieceAt(dst);
			if (occ && board.colorOf(occ) === ownSide) continue;
			let legal = true;
			let attackedByEnemy = false;
			if (canSimulate) {
				const fenAfterCandidate = simulateFenAfterMove(simFen, `${fromSq}${idxToSq(dst)}`);
				if (!fenAfterCandidate) legal = false;
				else try {
					const boardAfterCandidate = ChessPrimitives(fenAfterCandidate);
					const movedNow = boardAfterCandidate.pieceAt(dst);
					if (!movedNow || boardAfterCandidate.colorOf(movedNow) !== ownSide) legal = false;
					else attackedByEnemy = (boardAfterCandidate.attackers(enemySide, dst) || []).length > 0;
				} catch {
					legal = false;
				}
			} else attackedByEnemy = (board.attackers(enemySide, dst) || []).length > 0;
			if (!legal) continue;
			legalSquares.push(dst);
			if (occ && board.colorOf(occ) === enemySide) {
				if ((PIECE_VAL[occ] || 0) >= pieceVal) canTradeUpCapture = true;
			}
			if (!attackedByEnemy) safeSquares.push(dst);
		}
		return {
			piece,
			pieceVal,
			attackedNow: (board.attackers(enemySide, pieceIdx) || []).length > 0,
			legalSquares,
			safeSquares,
			canTradeUpCapture
		};
	}
	function reliefMoveConcedesTooMuch(baseBoard, defendedBoard, move, ownSide, defendedFen = null) {
		const MIN_CONCESSION_GAIN = 2;
		const MIN_MAJOR_PIECE_VALUE = 3;
		if (!baseBoard || !defendedBoard) return false;
		const uci = moveToUci(move);
		if (!uci || uci.length < 4) return false;
		const fromIdx = defendedBoard.sqToIdx(uci.slice(0, 2));
		const toIdx = defendedBoard.sqToIdx(uci.slice(2, 4));
		if (!Number.isInteger(fromIdx) || fromIdx < 0) return false;
		if (!Number.isInteger(toIdx) || toIdx < 0) return false;
		const movedBefore = baseBoard.pieceAt(fromIdx);
		const movedAfter = defendedBoard.pieceAt(toIdx);
		if (!movedBefore || !movedAfter) return false;
		if (baseBoard.colorOf(movedBefore) !== ownSide || defendedBoard.colorOf(movedAfter) !== ownSide) return false;
		const movedVal = effectivePieceValue(movedAfter, toIdx);
		if (movedVal <= 0) return false;
		const opponentSide = ownSide === "w" ? "b" : "w";
		let captureGain = bestLegalCaptureGainOnSquare(defendedBoard, ownSide, toIdx, movedAfter);
		if (typeof defendedFen === "string" && defendedFen.trim()) try {
			const legalReplies = getLegalMoves(defendedFen) || [];
			const toSq = idxToSq(toIdx);
			const mover = ownSide === "w" ? "b" : "w";
			let legalBestGain = Number.NEGATIVE_INFINITY;
			let foundLegalCapture = false;
			for (const reply of legalReplies) {
				const uci = moveToUci(reply);
				if (!uci || uci.length < 4) continue;
				if (uci.slice(2, 4) !== toSq) continue;
				const from = defendedBoard.sqToIdx(uci.slice(0, 2));
				if (!Number.isInteger(from) || from < 0 || from > 63) continue;
				const capturer = defendedBoard.pieceAt(from);
				if (!capturer || defendedBoard.colorOf(capturer) !== mover) continue;
				const gain = movedVal - effectivePieceValue(capturer, from);
				foundLegalCapture = true;
				if (gain > legalBestGain) legalBestGain = gain;
			}
			if (foundLegalCapture && (!Number.isFinite(captureGain) || legalBestGain > captureGain)) captureGain = legalBestGain;
		} catch {}
		if (Number.isFinite(captureGain) && captureGain >= MIN_CONCESSION_GAIN) return true;
		if (movedVal >= MIN_MAJOR_PIECE_VALUE) {
			const enemyAttackers = (defendedBoard.attackers(opponentSide, toIdx) || []).length;
			const ownDefenders = (defendedBoard.attackers(ownSide, toIdx) || []).length;
			if (enemyAttackers > ownDefenders) return true;
			if (enemyAttackers > 0 && ownDefenders === 0 && defendedBoard.isInBadSpot(toIdx)) return true;
		}
		return false;
	}
	function isPieceForcedLostInShortBranch(fen, trackedIdx, trackedType, ownSide, enemySide, pliesLeft, cache = null, branchGuard = null) {
		const key = `${fen}|${trackedIdx}|${trackedType}|${ownSide}|${enemySide}|${pliesLeft}`;
		if (cache && cache.has(key)) return !!cache.get(key);
		if (branchGuard && branchGuard.aborted) {
			if (cache) cache.set(key, false);
			return false;
		}
		if (branchGuard) {
			branchGuard.nodes = (Number(branchGuard.nodes) || 0) + 1;
			const elapsed = Date.now() - (Number(branchGuard.startedAt) || Date.now());
			if (branchGuard.nodes > BRANCH_PROOF_MAX_NODES || elapsed > BRANCH_PROOF_MAX_MS) {
				branchGuard.aborted = true;
				if (cache) cache.set(key, false);
				return false;
			}
		}
		let board = null;
		try {
			board = ChessPrimitives(fen);
		} catch {
			if (cache) cache.set(key, false);
			return false;
		}
		if (!board) {
			if (cache) cache.set(key, false);
			return false;
		}
		const trackedPiece = board.pieceAt(trackedIdx);
		if (!trackedPiece || board.colorOf(trackedPiece) !== ownSide || String(trackedPiece).toUpperCase() !== trackedType) {
			if (cache) cache.set(key, false);
			return false;
		}
		const turn = normalizeSide(null, fen);
		if (turn !== ownSide && turn !== enemySide) {
			if (cache) cache.set(key, false);
			return false;
		}
		const MIN_FORCE_GAIN = 2;
		if (turn === enemySide) {
			const immediateGain = bestLegalCaptureGainOnSquare(board, ownSide, trackedIdx, trackedPiece);
			if (Number.isFinite(immediateGain) && immediateGain >= MIN_FORCE_GAIN) {
				if (cache) cache.set(key, true);
				return true;
			}
		}
		if (pliesLeft <= 0) {
			if (cache) cache.set(key, false);
			return false;
		}
		const legalMoves = getLegalMoves(fen) || [];
		if (!Array.isArray(legalMoves) || !legalMoves.length) {
			if (cache) cache.set(key, false);
			return false;
		}
		if (turn === enemySide) {
			const attackersBefore = (board.attackers(enemySide, trackedIdx) || []).length;
			const attackerCandidates = [];
			const seenAttackerCandidate = /* @__PURE__ */ new Set();
			const addAttackerCandidate = (mv, priority = 99) => {
				const key = moveToUci(mv);
				if (!key || seenAttackerCandidate.has(key)) return;
				seenAttackerCandidate.add(key);
				attackerCandidates.push({
					mv,
					priority
				});
			};
			for (const mv of legalMoves) {
				const uci = moveToUci(mv);
				if (!uci || uci.length < 4) continue;
				const fromIdx = board.sqToIdx(uci.slice(0, 2));
				const toIdx = board.sqToIdx(uci.slice(2, 4));
				if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
				if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
				if (toIdx === trackedIdx) {
					addAttackerCandidate(mv, 0);
					continue;
				}
				const fenNext = simulateFenAfterMove(fen, mv);
				if (!fenNext) continue;
				try {
					const boardNext = ChessPrimitives(fenNext);
					const attackersAfter = (boardNext.attackers(enemySide, trackedIdx) || []).length;
					if (attackersAfter > attackersBefore) {
						addAttackerCandidate(mv, 1);
						continue;
					}
					if (attackersAfter > 0) {
						addAttackerCandidate(mv, 2);
						continue;
					}
					if (boardNext.checkerCount(ownSide) > 0) {
						addAttackerCandidate(mv, 3);
						continue;
					}
					const capturedBefore = board.pieceAt(toIdx);
					if (capturedBefore && board.colorOf(capturedBefore) === ownSide) addAttackerCandidate(mv, 4);
				} catch {}
			}
			const attackerMoves = attackerCandidates.length ? attackerCandidates.sort((a, b) => a.priority - b.priority).slice(0, 14).map((entry) => entry.mv) : legalMoves;
			for (const mv of attackerMoves) {
				const uci = moveToUci(mv);
				if (!uci || uci.length < 4) continue;
				const fromIdx = board.sqToIdx(uci.slice(0, 2));
				const toIdx = board.sqToIdx(uci.slice(2, 4));
				if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
				if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
				const fenNext = simulateFenAfterMove(fen, mv);
				if (!fenNext) continue;
				if (toIdx === trackedIdx) {
					const capturerBefore = board.pieceAt(fromIdx);
					const capturedBefore = board.pieceAt(trackedIdx);
					if (!capturerBefore || !capturedBefore) continue;
					if (board.colorOf(capturerBefore) !== enemySide || board.colorOf(capturedBefore) !== ownSide) continue;
					const gain = (PIECE_VAL[capturedBefore] || 0) - (PIECE_VAL[capturerBefore] || 0);
					if (!Number.isFinite(gain) || gain < MIN_FORCE_GAIN) continue;
					let recapOffsets = false;
					try {
						const boardNext = ChessPrimitives(fenNext);
						const capturerAfter = boardNext.pieceAt(toIdx);
						if (capturerAfter && boardNext.colorOf(capturerAfter) === enemySide) {
							const recapGain = bestLegalCaptureGainOnSquare(boardNext, enemySide, toIdx, capturerAfter);
							if (Number.isFinite(recapGain) && recapGain >= gain) recapOffsets = true;
						}
					} catch {}
					if (!recapOffsets) {
						if (cache) cache.set(key, true);
						return true;
					}
					continue;
				}
				if (isPieceForcedLostInShortBranch(fenNext, trackedIdx, trackedType, ownSide, enemySide, pliesLeft - 1, cache, branchGuard)) {
					if (cache) cache.set(key, true);
					return true;
				}
			}
			if (cache) cache.set(key, false);
			return false;
		}
		const currentAttackers = board.attackers(enemySide, trackedIdx) || [];
		const defendersBefore = (board.attackers(ownSide, trackedIdx) || []).length;
		const attackersBefore = currentAttackers.length;
		const defenderCandidates = [];
		const seenDefenderCandidate = /* @__PURE__ */ new Set();
		const addDefenderCandidate = (mv) => {
			const key = moveToUci(mv);
			if (!key || seenDefenderCandidate.has(key)) return;
			seenDefenderCandidate.add(key);
			defenderCandidates.push(mv);
		};
		for (const mv of legalMoves) {
			const uci = moveToUci(mv);
			if (!uci || uci.length < 4) continue;
			const fromIdx = board.sqToIdx(uci.slice(0, 2));
			const toIdx = board.sqToIdx(uci.slice(2, 4));
			if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
			if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
			if (fromIdx === trackedIdx) {
				addDefenderCandidate(mv);
				continue;
			}
			if (currentAttackers.includes(toIdx)) {
				addDefenderCandidate(mv);
				continue;
			}
			const fenNext = simulateFenAfterMove(fen, mv);
			if (!fenNext) continue;
			try {
				const boardNext = ChessPrimitives(fenNext);
				const defendersAfter = (boardNext.attackers(ownSide, trackedIdx) || []).length;
				const attackersAfter = (boardNext.attackers(enemySide, trackedIdx) || []).length;
				if (defendersAfter > defendersBefore || attackersAfter < attackersBefore) addDefenderCandidate(mv);
			} catch {}
		}
		const defenderMoves = defenderCandidates.length ? defenderCandidates : legalMoves;
		for (const mv of defenderMoves) {
			const uci = moveToUci(mv);
			if (!uci || uci.length < 4) continue;
			const fromIdx = board.sqToIdx(uci.slice(0, 2));
			const toIdx = board.sqToIdx(uci.slice(2, 4));
			if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
			if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
			const fenNext = simulateFenAfterMove(fen, mv);
			if (!fenNext) continue;
			let nextTrackedIdx = trackedIdx;
			if (fromIdx === trackedIdx) {
				const movedPiece = board.pieceAt(fromIdx);
				if (!movedPiece || board.colorOf(movedPiece) !== ownSide || String(movedPiece).toUpperCase() !== trackedType) continue;
				nextTrackedIdx = toIdx;
			}
			if (!isPieceForcedLostInShortBranch(fenNext, nextTrackedIdx, trackedType, ownSide, enemySide, pliesLeft - 1, cache, branchGuard)) {
				if (cache) cache.set(key, false);
				return false;
			}
		}
		if (cache) cache.set(key, true);
		return true;
	}
	function pieceForcedLossAfterEscapeInShownLine(steps, stepIndex, ownSide, enemySide, startIdx, pieceType) {
		if (!Array.isArray(steps) || !steps.length) return false;
		if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) return false;
		if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx > 63) return false;
		const trackedType = String(pieceType || "").toUpperCase();
		if (!trackedType) return false;
		let trackedIdx = startIdx;
		let escapedByOwner = false;
		const maxIdx = Math.min(steps.length - 1, stepIndex + (DEFERRED_TRAP_LOOKAHEAD_PLIES - 1));
		for (let i = stepIndex + 1; i <= maxIdx; i++) {
			const step = steps[i];
			if (!step || !step.uci || !step.boardBefore) continue;
			const stepSide = normalizeSide(step.side, step.fenBefore);
			if (stepSide !== ownSide && stepSide !== enemySide) continue;
			const fromSq = String(step.uci).slice(0, 2);
			const toSq = String(step.uci).slice(2, 4);
			const fromIdx = step.boardBefore.sqToIdx(fromSq);
			const toIdx = step.boardBefore.sqToIdx(toSq);
			if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
			if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
			if (stepSide === ownSide) {
				const movedType = String(step.movedPiece || "").toUpperCase();
				if (fromIdx === trackedIdx && movedType === trackedType) {
					trackedIdx = toIdx;
					escapedByOwner = true;
				}
				continue;
			}
			const capturedType = String(step.capturedPiece || "").toUpperCase();
			if (toIdx !== trackedIdx || capturedType !== trackedType) continue;
			if (!escapedByOwner) continue;
			const gain = (PIECE_VAL[step.capturedPiece] || 0) - (PIECE_VAL[step.movedPiece] || 0);
			if (!Number.isFinite(gain) || gain < DEFERRED_TRAP_MIN_GAIN) continue;
			const next = steps[i + 1];
			if (next && normalizeSide(next.side, next.fenBefore) === ownSide && next.uci) {
				if (String(next.uci).slice(2, 4) === String(step.uci).slice(2, 4) && next.capturedPiece && step.movedPiece) {
					const recapGain = (PIECE_VAL[next.capturedPiece] || 0) - (PIECE_VAL[next.movedPiece] || 0);
					if (Number.isFinite(recapGain) && recapGain >= gain) continue;
				}
			}
			return true;
		}
		return false;
	}
	function pieceForcedLossInShownLine(steps, stepIndex, ownSide, enemySide, startIdx, pieceType) {
		if (!Array.isArray(steps) || !steps.length) return false;
		if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) return false;
		if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx > 63) return false;
		const trackedType = String(pieceType || "").toUpperCase();
		if (!trackedType) return false;
		let trackedIdx = startIdx;
		const maxIdx = Math.min(steps.length - 1, stepIndex + (DEFERRED_TRAP_LOOKAHEAD_PLIES - 1));
		for (let i = stepIndex + 1; i <= maxIdx; i++) {
			const step = steps[i];
			if (!step || !step.uci || !step.boardBefore) continue;
			const stepSide = normalizeSide(step.side, step.fenBefore);
			if (stepSide !== ownSide && stepSide !== enemySide) continue;
			const fromSq = String(step.uci).slice(0, 2);
			const toSq = String(step.uci).slice(2, 4);
			const fromIdx = step.boardBefore.sqToIdx(fromSq);
			const toIdx = step.boardBefore.sqToIdx(toSq);
			if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
			if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
			if (stepSide === ownSide) {
				const movedType = String(step.movedPiece || "").toUpperCase();
				if (fromIdx === trackedIdx && movedType === trackedType) trackedIdx = toIdx;
				continue;
			}
			const capturedType = String(step.capturedPiece || "").toUpperCase();
			if (toIdx !== trackedIdx || capturedType !== trackedType) continue;
			const gain = (PIECE_VAL[step.capturedPiece] || 0) - (PIECE_VAL[step.movedPiece] || 0);
			if (!Number.isFinite(gain) || gain < DEFERRED_TRAP_MIN_GAIN) continue;
			const next = steps[i + 1];
			if (next && normalizeSide(next.side, next.fenBefore) === ownSide && next.uci) {
				if (String(next.uci).slice(2, 4) === String(step.uci).slice(2, 4) && next.capturedPiece && step.movedPiece) {
					const recapGain = (PIECE_VAL[next.capturedPiece] || 0) - (PIECE_VAL[next.movedPiece] || 0);
					if (Number.isFinite(recapGain) && recapGain >= gain) continue;
				}
			}
			return true;
		}
		return false;
	}
	const legalMovesAfter = typeof _fenAfter === "string" && _fenAfter.trim() ? getLegalMoves(_fenAfter) : [];
	const stepsContext = Array.isArray(options?.steps) ? options.steps : [];
	const stepContextIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : -1;
	for (let pieceIdx = 0; pieceIdx < 64; pieceIdx++) {
		const piece = boardAfter.pieceAt(pieceIdx);
		if (!piece) continue;
		if (boardAfter.colorOf(piece) !== opponent) continue;
		const type = piece.toUpperCase();
		if (type !== "N" && type !== "B" && type !== "R" && type !== "Q") continue;
		if (boardAfter.isPinned(pieceIdx)) continue;
		const afterState = analyzePieceState(boardAfter, pieceIdx, opponent, side, _fenAfter);
		if (!afterState) continue;
		const noSafeAfter = afterState.safeSquares.length === 0;
		const noLegalAfter = afterState.legalSquares.length === 0;
		const hotTrapAfter = afterState.attackedNow && noSafeAfter;
		const coffinTrapAfter = !afterState.attackedNow && noLegalAfter;
		let badSpotAfter = false;
		try {
			badSpotAfter = !!boardAfter.isInBadSpot(pieceIdx);
		} catch {}
		afterState.attackedNow;
		const immediateTrapAfter = hotTrapAfter || coffinTrapAfter || ENABLE_TRAPPED_ESCAPE_CONCESSION;
		let beforeState = null;
		let beforeBadSpot = false;
		let becameTrapped = true;
		let wasCoffinBefore = false;
		let pressureIntroducedByMove = false;
		if (boardBefore) {
			const beforePiece = boardBefore.pieceAt(pieceIdx);
			if (!beforePiece || boardBefore.colorOf(beforePiece) !== opponent || beforePiece.toUpperCase() !== type) continue;
			beforeState = analyzePieceState(boardBefore, pieceIdx, opponent, side, _fenBefore);
			if (!beforeState) continue;
			try {
				beforeBadSpot = !!boardBefore.isInBadSpot(pieceIdx);
			} catch {}
			const noSafeBefore = beforeState.safeSquares.length === 0;
			const noLegalBefore = beforeState.legalSquares.length === 0;
			const hotTrapBefore = beforeState.attackedNow && noSafeBefore;
			const coffinTrapBefore = !beforeState.attackedNow && noLegalBefore;
			wasCoffinBefore = coffinTrapBefore;
			becameTrapped = !hotTrapBefore && !coffinTrapBefore;
			pressureIntroducedByMove = afterState.attackedNow && !beforeState.attackedNow || badSpotAfter && !beforeBadSpot;
		}
		let deferredLineTrapAfter = false;
		if (!immediateTrapAfter && true) continue;
		const usingDeferredPath = !immediateTrapAfter && deferredLineTrapAfter;
		if (afterState.canTradeUpCapture) continue;
		let immediateTrapGain = Number.NEGATIVE_INFINITY;
		try {
			immediateTrapGain = bestLegalCaptureGainOnSquare(boardAfter, opponent, pieceIdx, piece);
		} catch {}
		let activatedCoffinTrap = false;
		if (!becameTrapped && wasCoffinBefore && pressureIntroducedByMove) activatedCoffinTrap = Number.isFinite(immediateTrapGain) && immediateTrapGain >= DEFERRED_TRAP_MIN_GAIN;
		let lineProvesPieceLoss = false;
		if (Array.isArray(stepsContext) && stepContextIndex >= 0 && (activatedCoffinTrap || Number.isFinite(immediateTrapGain) && immediateTrapGain < 0)) lineProvesPieceLoss = pieceForcedLossInShownLine(stepsContext, stepContextIndex, opponent, side, pieceIdx, type) || pieceForcedLossAfterEscapeInShownLine(stepsContext, stepContextIndex, opponent, side, pieceIdx, type);
		let hasRelief = false;
		if (Array.isArray(legalMovesAfter) && legalMovesAfter.length && typeof _fenAfter === "string" && _fenAfter.trim()) {
			const pieceSq = idxToSq(pieceIdx);
			for (const mv of legalMovesAfter) {
				if (moveFromSq(mv) === pieceSq) continue;
				const fenAfterDefense = simulateFenAfterMove(_fenAfter, mv);
				if (!fenAfterDefense) continue;
				let boardAfterDefense = null;
				try {
					boardAfterDefense = ChessPrimitives(fenAfterDefense);
				} catch {
					continue;
				}
				const stillThere = boardAfterDefense.pieceAt(pieceIdx);
				if (!stillThere || boardAfterDefense.colorOf(stillThere) !== opponent) continue;
				if (stillThere.toUpperCase() !== type) continue;
				const defenseState = analyzePieceState(boardAfterDefense, pieceIdx, opponent, side, fenAfterDefense);
				if (!defenseState) continue;
				if (!defenseState.attackedNow || defenseState.safeSquares.length > 0 || defenseState.canTradeUpCapture) {
					const immediateLossAfterDefense = bestLegalCaptureGainOnSquare(boardAfterDefense, opponent, pieceIdx, stillThere);
					if (Number.isFinite(immediateLossAfterDefense) && immediateLossAfterDefense >= DEFERRED_TRAP_MIN_GAIN) continue;
					if (usingDeferredPath || lineProvesPieceLoss) continue;
					if (reliefMoveConcedesTooMuch(boardAfter, boardAfterDefense, mv, opponent, fenAfterDefense)) continue;
					hasRelief = true;
					break;
				}
			}
		}
		if (hasRelief) continue;
		let defendedByOwnSide = false;
		let onlyHigherValueAttackers = false;
		try {
			defendedByOwnSide = (boardAfter.attackers(opponent, pieceIdx) || []).length > 0;
			const attackers = boardAfter.attackers(side, pieceIdx) || [];
			const targetVal = effectivePieceValue(piece, pieceIdx);
			let seenAttacker = false;
			let allHigher = true;
			for (const ai of attackers) {
				const attackerPiece = boardAfter.pieceAt(ai);
				if (!attackerPiece || boardAfter.colorOf(attackerPiece) !== side) continue;
				seenAttacker = true;
				if (effectivePieceValue(attackerPiece, ai) <= targetVal) {
					allHigher = false;
					break;
				}
			}
			onlyHigherValueAttackers = seenAttacker && allHigher;
		} catch {}
		if (defendedByOwnSide && onlyHigherValueAttackers && Number.isFinite(immediateTrapGain) && immediateTrapGain < 0 && !usingDeferredPath && !lineProvesPieceLoss) continue;
		if (!becameTrapped && !activatedCoffinTrap) continue;
		return true;
	}
	return false;
}
/**
* SACRIFICE  tracks cumulative material across the PV with two paths:
* 1) Accepted sacrifice: opponent captures and player goes down material.
* 2) Declined sacrifice: a legal profitable capture exists, but engine
*    best defense declines taking the offered material.
*
* Excludes:
* - PVs where the player promotes (promotion compensates)
* - Simple exchanges where material is immediately recovered
* - Obvious forced-king-defense moves
*/
function detectSacrificeInPVDetails(steps, playerSide, _isMate, options = null) {
	const meta = options && typeof options === "object" ? options.mistake && typeof options.mistake === "object" ? options.mistake : options : null;
	const MIN_MATERIAL_LOSS = 2;
	const MIN_ACCEPTED_DELTA_CP = 200;
	const MIN_DECLINED_DELTA_CP = 100;
	const MIN_INTENT_CP = -150;
	const MIN_DESPERATION_MATERIAL_DEFICIT = 3;
	const MAX_PRE_EXISTING_ADVANTAGE_FOR_DECLINED = 4;
	const MAX_DECLINED_TRIGGER_PLAYER_PLY = 2;
	function resolveIntentCp() {
		const explicit = Number(meta?._sacrificeIntentCp);
		if (Number.isFinite(explicit)) return explicit;
		const cpBefore = Number(meta?.cpBefore);
		if (Number.isFinite(cpBefore)) return cpBefore;
		return null;
	}
	function hasForcingPayoff() {
		return !!_isMate;
	}
	function resolveRootMaterialDeficit() {
		const rootBoard = steps[0] && steps[0].boardBefore;
		if (!rootBoard) return null;
		let playerMaterial = 0;
		let opponentMaterial = 0;
		for (let idx = 0; idx < 64; idx++) {
			const piece = rootBoard.pieceAt(idx);
			if (!piece) continue;
			const value = PIECE_VAL[piece] || 0;
			if (rootBoard.colorOf(piece) === playerSide) playerMaterial += value;
			else opponentMaterial += value;
		}
		return Math.max(0, opponentMaterial - playerMaterial);
	}
	function isSacrificeLikeTrigger(step) {
		if (!step || !step.movedPiece) return false;
		if (String(step.movedPiece).toUpperCase() === "K") return false;
		if (!step.capturedPiece) return true;
		const movedVal = PIECE_VAL[step.movedPiece] || 0;
		return (PIECE_VAL[step.capturedPiece] || 0) < movedVal;
	}
	function isForcedKingDefense(step) {
		if (!step || !step.movedPiece || !step.fenBefore) return false;
		if (String(step.movedPiece).toUpperCase() !== "K") return false;
		return positionInCheck(step.fenBefore);
	}
	function isDirectTriggerRecapture(triggerStep, lossStep) {
		if (!triggerStep || !lossStep || !triggerStep.uci || !lossStep.uci) return false;
		if (!triggerStep.movedPiece || !lossStep.capturedPiece) return false;
		if (lossStep.uci.slice(2, 4) !== triggerStep.uci.slice(2, 4)) return false;
		return String(lossStep.capturedPiece).toUpperCase() === String(triggerStep.movedPiece).toUpperCase();
	}
	function isLikelyForcedLoss(triggerStepIndex, deficitStepIndex) {
		if (triggerStepIndex < 0 || deficitStepIndex < 0) return false;
		const triggerStep = steps[triggerStepIndex];
		const lossStep = steps[deficitStepIndex];
		if (!triggerStep || !lossStep || !lossStep.capturedPiece || !triggerStep.boardBefore) return false;
		const lossSquare = lossStep.uci.slice(2, 4);
		if (!lossSquare) return false;
		if (triggerStep.uci.slice(0, 2) === lossSquare) return false;
		const lossIdx = triggerStep.boardBefore.sqToIdx(lossSquare);
		if (lossIdx < 0) return false;
		const prePiece = triggerStep.boardBefore.pieceAt(lossIdx);
		if (!prePiece) return false;
		if (triggerStep.boardBefore.colorOf(prePiece) !== playerSide) return false;
		if (String(prePiece).toUpperCase() !== String(lossStep.capturedPiece).toUpperCase()) return false;
		return triggerStep.boardBefore.isInBadSpot(lossIdx);
	}
	function isTriggerCapturedSoon(triggerStepIndex, lookAheadPly = 4) {
		if (!Number.isInteger(triggerStepIndex) || triggerStepIndex < 0 || triggerStepIndex >= steps.length) return false;
		const triggerStep = steps[triggerStepIndex];
		if (!triggerStep || !triggerStep.uci || !triggerStep.movedPiece) return false;
		const triggerTo = triggerStep.uci.slice(2, 4);
		const movedType = String(triggerStep.movedPiece).toUpperCase();
		if (!triggerTo || !movedType) return false;
		const opponent = playerSide === "w" ? "b" : "w";
		const maxIdx = Math.min(triggerStepIndex + lookAheadPly, steps.length - 1);
		for (let i = triggerStepIndex + 1; i <= maxIdx; i++) {
			const s = steps[i];
			if (!s || s.side !== opponent || !s.capturedPiece || !s.uci) continue;
			if (s.uci.slice(2, 4) !== triggerTo) continue;
			if (String(s.capturedPiece).toUpperCase() === movedType) return true;
		}
		return false;
	}
	function detectDeclinedSacrifice() {
		if (!steps.length) return {
			isSacrifice: false,
			triggerStepIndex: -1,
			deficitStepIndex: -1
		};
		const opponent = playerSide === "w" ? "b" : "w";
		const finalCumulative = Number(steps[steps.length - 1]?.cumulativeDelta) || 0;
		for (let i = 0; i + 1 < steps.length; i++) {
			const step = steps[i];
			if (!step || step.side !== playerSide || !step.boardAfter || !step.uci || !step.movedPiece) continue;
			if (!isSacrificeLikeTrigger(step)) continue;
			if (isForcedKingDefense(step)) continue;
			if (countPlayerPlyAtIndex(steps, i, playerSide) > MAX_DECLINED_TRIGGER_PLAYER_PLY) continue;
			if ((Number(step.cumulativeDelta) || 0) > MAX_PRE_EXISTING_ADVANTAGE_FOR_DECLINED) continue;
			if (!(!!step.capturedPiece || positionInCheck(step.fenAfter))) continue;
			if ((PIECE_VAL[step.movedPiece] || 0) < MIN_MATERIAL_LOSS) continue;
			const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
			if (!Number.isInteger(toIdx) || toIdx < 0) continue;
			const bestGain = bestLegalCaptureGainOnSquare(step.boardAfter, playerSide, toIdx, step.movedPiece);
			if (!Number.isFinite(bestGain) || bestGain < MIN_MATERIAL_LOSS) continue;
			const next = steps[i + 1];
			if (!next || next.side !== opponent) continue;
			if (isDirectTriggerRecapture(step, next)) continue;
			if (isTriggerCapturedSoon(i, 4)) continue;
			if (finalCumulative <= -MIN_MATERIAL_LOSS) continue;
			return {
				isSacrifice: true,
				triggerStepIndex: i,
				deficitStepIndex: -1
			};
		}
		return {
			isSacrifice: false,
			triggerStepIndex: -1,
			deficitStepIndex: -1
		};
	}
	const deltaAbs = meta && typeof meta.deltaCp === "number" && Number.isFinite(meta.deltaCp) ? Math.abs(meta.deltaCp) : null;
	if (deltaAbs !== null && deltaAbs < MIN_DECLINED_DELTA_CP) return {
		isSacrifice: false,
		triggerStepIndex: -1,
		deficitStepIndex: -1
	};
	const allowAcceptedSacPath = deltaAbs === null || deltaAbs >= MIN_ACCEPTED_DELTA_CP;
	const intentCp = resolveIntentCp();
	const forcingPayoff = hasForcingPayoff();
	if (intentCp !== null && intentCp < MIN_INTENT_CP && !forcingPayoff) return {
		isSacrifice: false,
		triggerStepIndex: -1,
		deficitStepIndex: -1
	};
	if (intentCp === null) {
		const rootMaterialDeficit = resolveRootMaterialDeficit();
		if (rootMaterialDeficit !== null && rootMaterialDeficit >= MIN_DESPERATION_MATERIAL_DEFICIT && !forcingPayoff) return {
			isSacrifice: false,
			triggerStepIndex: -1,
			deficitStepIndex: -1
		};
	}
	let hasPlayerPromotion = false;
	for (const step of steps) if (step.promotion && step.side === playerSide) hasPlayerPromotion = true;
	if (hasPlayerPromotion) return {
		isSacrifice: false,
		triggerStepIndex: -1,
		deficitStepIndex: -1
	};
	if (allowAcceptedSacPath) {
		let playerMaterial = 0;
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			if (step.capturedPiece) {
				const capVal = PIECE_VAL[step.capturedPiece] || 0;
				if (step.side === playerSide) playerMaterial += capVal;
				else playerMaterial -= capVal;
			}
			if (step.side !== playerSide && step.capturedPiece && playerMaterial <= -MIN_MATERIAL_LOSS) {
				let recovered = false;
				let lookAheadMat = playerMaterial;
				for (let j = i + 1; j < Math.min(i + 5, steps.length); j++) {
					if (steps[j].capturedPiece) {
						const cVal = PIECE_VAL[steps[j].capturedPiece] || 0;
						if (steps[j].side === playerSide) lookAheadMat += cVal;
						else lookAheadMat -= cVal;
					}
					if (steps[j].side === playerSide && lookAheadMat > -MIN_MATERIAL_LOSS) {
						recovered = true;
						break;
					}
				}
				if (recovered) continue;
				let triggerStepIndex = -1;
				for (let k = i - 1; k >= 0; k--) if (steps[k].side === playerSide) {
					triggerStepIndex = k;
					break;
				}
				if (triggerStepIndex < 0) continue;
				const triggerStep = steps[triggerStepIndex];
				if (!isSacrificeLikeTrigger(triggerStep)) continue;
				if (isForcedKingDefense(triggerStep)) continue;
				if (!isDirectTriggerRecapture(triggerStep, step)) continue;
				if ((PIECE_VAL[triggerStep.movedPiece] || 0) - (PIECE_VAL[triggerStep.capturedPiece] || 0) < MIN_MATERIAL_LOSS) continue;
				if (isLikelyForcedLoss(triggerStepIndex, i)) continue;
				return {
					isSacrifice: true,
					triggerStepIndex,
					deficitStepIndex: i
				};
			}
		}
	}
	const declined = detectDeclinedSacrifice();
	if (declined.isSacrifice) return declined;
	return {
		isSacrifice: false,
		triggerStepIndex: -1,
		deficitStepIndex: -1
	};
}
function detectSacrificeInPV(steps, playerSide, isMate, options = null) {
	return detectSacrificeInPVDetails(steps, playerSide, isMate, options).isSacrifice;
}
/**
* HANGING PIECE:
* Rule 1: a non-king move captures a piece for free.
* "For free" means the opponent has no legal recapture on that square.
*/
function detectHangingPiece(boardBefore, capturedPiece, toIdx, movedPiece, boardAfter) {
	if (!capturedPiece) return false;
	if (movedPiece && movedPiece.toUpperCase() === "K") return false;
	if (!boardAfter || !movedPiece) return boardBefore.isHanging(toIdx);
	const moverSide = boardAfter.colorOf(movedPiece);
	if (!moverSide) return false;
	if (hasLegalRecapture(boardAfter, moverSide, toIdx)) return false;
	return true;
}
/**
* A material-winning capture can still be a hanging-piece punishment even
* when a legal recapture exists (e.g., winning an exchange).
*/
function detectMaterialWinningCapture(step) {
	if (!step || !step.capturedPiece || !step.movedPiece) return false;
	if (String(step.movedPiece).toUpperCase() === "K") return false;
	const toIdx = step?.boardBefore?.sqToIdx?.(String(step.uci || "").slice(2, 4));
	const fromIdx = step?.boardBefore?.sqToIdx?.(String(step.uci || "").slice(0, 2));
	return effectivePieceValue(step.capturedPiece, Number.isInteger(toIdx) ? toIdx : null) - effectivePieceValue(step.movedPiece, Number.isInteger(fromIdx) ? fromIdx : null) >= 2;
}
/**
* "Practical hanging" capture: the captured unit is already underdefended
* (attackers > defenders) and the immediate recapture is not materially
* favorable for the defender. This catches cases where a piece/pawn is
* effectively won even if a nominal recapture exists.
*/
function detectUnderdefendedWinningCapture(step) {
	if (!step || !step.boardBefore || !step.boardAfter || !step.uci) return false;
	if (!step.capturedPiece || !step.movedPiece) return false;
	if (String(step.movedPiece).toUpperCase() === "K") return false;
	const side = step.side === "w" || step.side === "b" ? step.side : null;
	if (!side) return false;
	const opponent = side === "w" ? "b" : "w";
	const toSq = String(step.uci).slice(2, 4);
	const toIdx = step.boardBefore.sqToIdx(toSq);
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	if (effectivePieceValue(step.capturedPiece, toIdx) <= 0) return false;
	if (!isEffectivelyUnderdefended(step.boardBefore, toIdx, opponent, side, { fen: step.fenBefore })) return false;
	const bestRecaptureGain = bestLegalCaptureGainOnSquare(step.boardAfter, side, toIdx, step.movedPiece);
	if (Number.isFinite(bestRecaptureGain) && bestRecaptureGain > 0) return false;
	return true;
}
/**
* Rule 2 (conceded path):
* The bad move hangs a piece (on its destination square), and the opponent
* captures that exact piece later in the refutation PV.
*/
function detectHungPiecePunishInPv(steps, side, mistake) {
	if (!Array.isArray(steps) || !steps.length || !mistake?._prevFen || !mistake?._prevPlayedMove) return false;
	const prevUci = normalizeMove(mistake._prevFen, mistake._prevPlayedMove);
	if (!prevUci) return false;
	const droppedSq = prevUci.slice(2, 4);
	const initialBoard = steps[0].boardBefore || ChessPrimitives(mistake.fen);
	const droppedIdx = initialBoard.sqToIdx(droppedSq);
	const droppedPiece = initialBoard.pieceAt(droppedIdx);
	if (!droppedPiece) return false;
	if (initialBoard.colorOf(droppedPiece) === side) return false;
	if (!initialBoard.isHanging(droppedIdx)) return false;
	for (const step of steps) {
		if (!step || step.side !== side || !step.capturedPiece) continue;
		if (step.uci.slice(2, 4) !== droppedSq) continue;
		if (String(step.capturedPiece).toUpperCase() !== String(droppedPiece).toUpperCase()) continue;
		if (step.movedPiece && step.movedPiece.toUpperCase() === "K") continue;
		if (shouldSuppressExchangeRecaptureHanging(step, mistake)) continue;
		const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
		if (!hasLegalRecapture(step.boardAfter, side, toIdx)) return true;
	}
	return false;
}
/**
* BACK RANK  best move delivers check on the opponent's back rank
* where the king's forward escape is blocked by own pieces (pawns).
* Lichess: the key feature is the king hemmed in by own pieces on
* the rank in front, checked by R/Q along the back rank.
* Does NOT require full checkmate  the pattern/theme is enough.
*/
function detectAttackingUndefendedPiece(boardBefore, boardAfter, fromIdx, toIdx, opponent, movedPiece, capturedPiece, fenBefore = null, fenAfter = null) {
	if (!boardAfter || !movedPiece || capturedPiece) return false;
	if (String(movedPiece).toUpperCase() === "K") return false;
	const side = opponent === "w" ? "b" : "w";
	const movedVal = effectivePieceValue(movedPiece, Number.isInteger(toIdx) ? toIdx : null);
	const afterAttacks = boardAfter.attacks(toIdx) || [];
	const beforeAttacks = boardBefore && Number.isInteger(fromIdx) && fromIdx >= 0 ? boardBefore.attacks(fromIdx) || [] : [];
	for (const targetIdx of afterAttacks) {
		const targetPiece = boardAfter.pieceAt(targetIdx);
		if (!targetPiece) continue;
		if (boardAfter.colorOf(targetPiece) !== opponent) continue;
		if (String(targetPiece).toUpperCase() === "K") continue;
		const attackedBeforeByMovedPiece = Array.isArray(beforeAttacks) && beforeAttacks.includes(targetIdx);
		const targetVal = effectivePieceValue(targetPiece, targetIdx);
		if (boardAfter.isHanging(targetIdx)) {
			if (!!!(boardBefore && boardBefore.isHanging(targetIdx)) || !attackedBeforeByMovedPiece) return true;
			continue;
		}
		const movedBaseVal = PIECE_VAL[movedPiece] || movedVal;
		const targetBaseVal = PIECE_VAL[targetPiece] || targetVal;
		if (!attackedBeforeByMovedPiece && targetBaseVal - movedBaseVal >= 2) return true;
		if (!isEffectivelyUnderdefended(boardAfter, targetIdx, opponent, side, { fen: fenAfter })) continue;
		if (!(boardBefore ? isEffectivelyUnderdefended(boardBefore, targetIdx, opponent, side, { fen: fenBefore }) : false) || !attackedBeforeByMovedPiece) return true;
	}
	return false;
}
function detectBackRank(boardAfter, opponent) {
	const ki = boardAfter.kingIdx(opponent);
	if (ki < 0) return false;
	const side = opponent === "w" ? "b" : "w";
	const backRank = opponent === "w" ? 7 : 0;
	const { r: kr, c: kc } = rcOf(ki);
	if (kr !== backRank) return false;
	if (boardAfter.checkerCount(opponent) === 0) return false;
	const checkers = boardAfter.attackers(side, ki);
	let hasRankChecker = false;
	for (const ci of checkers) {
		const cp = boardAfter.pieceAt(ci);
		if (!cp) continue;
		const ct = cp.toUpperCase();
		if ((ct === "R" || ct === "Q") && rcOf(ci).r === backRank) {
			hasRankChecker = true;
			break;
		}
	}
	if (!hasRankChecker) return false;
	const forwardRow = kr + (opponent === "w" ? -1 : 1);
	let forwardBlockedCount = 0;
	let forwardSquareCount = 0;
	if (inBounds(forwardRow, 0)) for (let dc = -1; dc <= 1; dc++) {
		const nc = kc + dc;
		if (!inBounds(forwardRow, nc)) continue;
		forwardSquareCount++;
		const idx = idxOf(forwardRow, nc);
		const p = boardAfter.pieceAt(idx);
		if (p && boardAfter.colorOf(p) === opponent) forwardBlockedCount++;
	}
	if (forwardBlockedCount < forwardSquareCount) return false;
	return true;
}
function isCastling(movedPiece, fromIdx, toIdx) {
	if (!movedPiece || movedPiece.toUpperCase() !== "K") return false;
	const fc = fromIdx % 8;
	const tc = toIdx % 8;
	return Math.abs(fc - tc) >= 2;
}
/**
* Walk a sequence of UCI moves from a FEN, tracking material balance.
* Returns an array of step snapshots.
*/
function walkPV(fen, moves, playerSide) {
	if (!fen || !Array.isArray(moves) || !moves.length) return [];
	const cl = ChessLite();
	cl.loadFEN(fen);
	const steps = [];
	let cumulative = 0;
	for (const uci of moves) {
		if (!uci || uci.length < 4) break;
		const fenBefore = cl.fen();
		const boardBefore = ChessPrimitives(fenBefore);
		const side = cl.turn();
		const fromIdx = boardBefore.sqToIdx(uci.slice(0, 2));
		const toIdx = boardBefore.sqToIdx(uci.slice(2, 4));
		const movedPiece = boardBefore.pieceAt(fromIdx);
		const capturedPiece = boardBefore.pieceAt(toIdx);
		const isEp = movedPiece && movedPiece.toUpperCase() === "P" && fromIdx % 8 !== toIdx % 8 && !capturedPiece;
		const captured = capturedPiece || (isEp ? side === "w" ? "p" : "P" : null);
		const mv = cl.moveUci(uci);
		if (!mv || !mv.ok) break;
		const fenAfter = cl.fen();
		let capturedIdx = toIdx;
		if (isEp && Number.isInteger(toIdx)) capturedIdx = side === "w" ? toIdx + 8 : toIdx - 8;
		const captureVal = captured ? effectivePieceValue(captured, Number.isInteger(capturedIdx) ? capturedIdx : null) : 0;
		const delta = side === playerSide ? captureVal : -captureVal;
		cumulative += delta;
		steps.push({
			uci,
			fenBefore,
			fenAfter,
			movedPiece,
			capturedPiece: captured,
			materialDelta: delta,
			cumulativeDelta: cumulative,
			side,
			boardBefore,
			boardAfter: ChessPrimitives(fenAfter),
			isEp,
			promotion: uci.length > 4 ? uci[4] : null
		});
	}
	return steps;
}
/**
* Find the "payoff step"  the first step in the PV where playerSide
* achieves a net material gain (cumulative > 0).
*/
function findPayoffStep(steps) {
	for (const step of steps) if (step.cumulativeDelta > 0) return step;
	return null;
}
/**
* Check if the PV ends in checkmate.
*/
function pvEndsMate(steps) {
	if (!steps.length) return false;
	const last = steps[steps.length - 1];
	return isCheckmate(last.fenAfter);
}
function hasPlayerCaptureOnSquareWithin(steps, startIdx, playerSide, square, maxPlies = 6) {
	if (!Array.isArray(steps) || !square) return false;
	const begin = Math.max(0, Number.isInteger(startIdx) ? startIdx : 0);
	const end = Math.min(steps.length - 1, begin + Math.max(1, maxPlies));
	for (let i = begin; i <= end; i++) {
		const step = steps[i];
		if (!step || step.side !== playerSide || !step.capturedPiece || !step.uci) continue;
		if (step.uci.slice(2, 4) === square) return true;
	}
	return false;
}
function isFreeOrWinningCaptureStep(step) {
	if (!step || !step.uci || !step.boardBefore || !step.boardAfter || !step.movedPiece) return false;
	const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	return detectHangingPiece(step.boardBefore, step.capturedPiece, toIdx, step.movedPiece, step.boardAfter) || detectMaterialWinningCapture(step) || detectUnderdefendedWinningCapture(step);
}
function isNonIgnorableInterferenceMove(step, playerSide) {
	if (!step || !step.boardAfter || !step.uci || !step.movedPiece) return false;
	if (positionInCheck(step.fenAfter)) return true;
	if (step.capturedPiece) return true;
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	if (!step.boardAfter.isInBadSpot(toIdx)) return true;
	const movedVal = PIECE_VAL[step.movedPiece] || 0;
	const bestCounterGain = bestLegalCaptureGainOnSquare(step.boardAfter, playerSide, toIdx, step.movedPiece);
	return Number.isFinite(bestCounterGain) && bestCounterGain > 0 && movedVal >= 3;
}
function findFreshHighValueThreat(step, threatenedSide, minPieceValue = 4) {
	if (!step || !step.boardBefore || !step.boardAfter) return null;
	if (threatenedSide !== "w" && threatenedSide !== "b") return null;
	const attackerSide = threatenedSide === "w" ? "b" : "w";
	const before = step.boardBefore;
	const after = step.boardAfter;
	let best = null;
	for (let idx = 0; idx < 64; idx++) {
		const piece = after.pieceAt(idx);
		if (!piece || after.colorOf(piece) !== threatenedSide) continue;
		if (String(piece).toUpperCase() === "K") continue;
		const value = PIECE_VAL[piece] || 0;
		if (value < minPieceValue) continue;
		const attackersBefore = before.attackers(attackerSide, idx) || [];
		const attackersAfter = after.attackers(attackerSide, idx) || [];
		if (!attackersAfter.length) continue;
		const freshAttackers = attackersAfter.filter((sq) => !attackersBefore.includes(sq));
		if (!(freshAttackers.length > 0 || attackersAfter.length > attackersBefore.length)) continue;
		const hangingAfter = after.isHanging(idx);
		const underAfter = isEffectivelyUnderdefended(after, idx, threatenedSide, attackerSide, { fen: step.fenAfter });
		if (!hangingAfter && !underAfter && freshAttackers.length === 0) continue;
		const score = value * 100 + freshAttackers.length * 10 + (hangingAfter ? 8 : 0) + (underAfter ? 6 : 0) + Math.max(0, attackersAfter.length - attackersBefore.length);
		if (!best || score > best.score) best = {
			targetIdx: idx,
			targetSq: idxToSq(idx),
			targetPiece: piece,
			targetValue: value,
			attackerSide,
			attackerSquares: attackersAfter,
			score
		};
	}
	return best;
}
function findCurrentHighValueThreat(board, threatenedSide, fen = null, minPieceValue = 4, includePawns = false) {
	if (!board) return null;
	if (threatenedSide !== "w" && threatenedSide !== "b") return null;
	const attackerSide = threatenedSide === "w" ? "b" : "w";
	let best = null;
	for (let idx = 0; idx < 64; idx += 1) {
		const info = getOwnPieceVulnerability(board, idx, threatenedSide, fen, includePawns);
		if (!info || !info.vulnerable) continue;
		const value = Number(info.value) || 0;
		if (value < minPieceValue) continue;
		const pressure = Math.max(0, (Number(info.attackers) || 0) - (Number(info.defenders) || 0));
		const score = value * 100 + (info.hanging ? 12 : 0) + (info.under ? 8 : 0) + pressure;
		if (!best || score > best.score) best = {
			targetIdx: idx,
			targetSq: idxToSq(idx),
			targetPiece: info.piece,
			targetValue: value,
			attackerSide,
			attackerSquares: board.attackers(attackerSide, idx) || [],
			score
		};
	}
	return best;
}
function moveAddressesThreatDirectly(step, threat) {
	if (!step || !threat || !step.uci || !step.boardAfter) return false;
	if (step.uci.slice(0, 2) === threat.targetSq) return true;
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	if (step.capturedPiece && Number.isInteger(toIdx) && toIdx >= 0 && threat.attackerSquares.includes(toIdx)) return true;
	return (step.boardAfter.attackers(threat.attackerSide, threat.targetIdx) || []).length === 0;
}
function isThreatResolvedAfterPlayerMove(step, threat, playerSide) {
	if (!step || !threat || !step.uci || !step.boardAfter) return false;
	if (step.uci.slice(0, 2) === threat.targetSq) return true;
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	if (step.capturedPiece && Number.isInteger(toIdx) && toIdx >= 0 && threat.attackerSquares.includes(toIdx)) return true;
	const pieceOnThreatSq = step.boardAfter.pieceAt(threat.targetIdx);
	if (!pieceOnThreatSq || step.boardAfter.colorOf(pieceOnThreatSq) !== playerSide) return true;
	if (!(step.boardAfter.attackers(threat.attackerSide, threat.targetIdx) || []).length) return true;
	return !isEffectivelyUnderdefended(step.boardAfter, threat.targetIdx, playerSide, threat.attackerSide, { fen: step.fenAfter });
}
/**
* DEFLECTION  Player captures/attacks a piece. Opponent piece moves away
* from a square it was defending. Player captures on the now-undefended square.
*/
function findDeflectionAnchorIndex(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (let i = 0; i < steps.length - 2; i++) {
		const s1 = steps[i];
		const s2 = steps[i + 1];
		const s3 = steps[i + 2];
		if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) continue;
		const deflectedFrom = sqToIdx(s2.uci.slice(0, 2));
		const deflectedTo = sqToIdx(s2.uci.slice(2, 4));
		if (!s3.capturedPiece) continue;
		const captureTarget = sqToIdx(s3.uci.slice(2, 4));
		if (!Number.isInteger(deflectedFrom) || deflectedFrom < 0) continue;
		if (!Number.isInteger(deflectedTo) || deflectedTo < 0) continue;
		if (!Number.isInteger(captureTarget) || captureTarget < 0) continue;
		if (!s1.boardBefore || !s1.boardAfter || !s2.boardBefore || !s2.boardAfter) continue;
		if (captureTarget === deflectedTo) continue;
		if (s2.boardBefore.attackers(opponent, captureTarget).includes(deflectedFrom)) {
			if (s2.boardAfter.attackers(opponent, captureTarget).includes(deflectedTo)) continue;
			const atkBefore = s1.boardBefore.attackers(playerSide, deflectedFrom).length;
			const atkAfter = s1.boardAfter.attackers(playerSide, deflectedFrom).length;
			let decoySacTrigger = false;
			try {
				const s1To = s1.uci.slice(2, 4);
				const s2To = s2.uci.slice(2, 4);
				const s2Captured = String(s2.capturedPiece || "").toUpperCase();
				const s1Moved = String(s1.movedPiece || "").toUpperCase();
				decoySacTrigger = !!s1To && !!s2To && s1To === s2To && !!s2Captured && !!s1Moved && s2Captured === s1Moved;
			} catch {}
			if (!(atkAfter > atkBefore || !!s1.capturedPiece || positionInCheck(s1.fenAfter) || decoySacTrigger)) continue;
			const underBefore = isEffectivelyUnderdefended(s2.boardBefore, captureTarget, opponent, playerSide, { fen: s2.fenBefore });
			const underAfter = isEffectivelyUnderdefended(s2.boardAfter, captureTarget, opponent, playerSide, { fen: s2.fenAfter });
			if (underBefore || !underAfter) continue;
			if (isFreeOrWinningCaptureStep(s3)) return i;
		}
	}
	return -1;
}
function detectDeflection(steps, playerSide) {
	return findDeflectionAnchorIndex(steps, playerSide) >= 0;
}
/**
* ATTRACTION  Player sacrifices on a square. Opponent K/Q/R captures (attracted).
* Player then exploits the attracted piece's new position.
*/
function detectAttraction(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	const STRICT_ATTRACTION_MOTIFS = new Set([
		THEMES.FORK,
		THEMES.PIN,
		THEMES.SKEWER,
		THEMES.DISCOVERED_ATTACK,
		THEMES.DOUBLE_CHECK,
		THEMES.BACK_RANK,
		THEMES.MATE,
		THEMES.MATE_IN_1,
		THEMES.MATE_IN_2,
		THEMES.MATE_IN_3,
		THEMES.MATE_IN_4,
		THEMES.MATE_IN_5
	]);
	for (let i = 0; i < steps.length - 2; i++) {
		const s1 = steps[i];
		const s2 = steps[i + 1];
		const s3 = steps[i + 2];
		if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) continue;
		const sacSquare = s1.uci.slice(2, 4);
		if (s2.uci.slice(2, 4) !== sacSquare) continue;
		if (!s2.capturedPiece) continue;
		const attractor = s2.movedPiece;
		if (!attractor) continue;
		const at = attractor.toUpperCase();
		if (at !== "K" && at !== "Q" && at !== "R") continue;
		const movedVal = PIECE_VAL[s1.movedPiece] || 0;
		const capVal = s1.capturedPiece ? PIECE_VAL[s1.capturedPiece] || 0 : 0;
		if (!(s1.capturedPiece ? movedVal > capVal : movedVal >= 3)) continue;
		const attractorTo = s2.uci.slice(2, 4);
		const attractorFromIdx = s2.boardBefore.sqToIdx(s2.uci.slice(0, 2));
		const attractorToIdx = s2.boardAfter.sqToIdx(attractorTo);
		if (!Number.isInteger(attractorToIdx) || attractorToIdx < 0) continue;
		if (s3.uci.slice(2, 4) === attractorTo) continue;
		let s3Themes = [];
		try {
			s3Themes = detectTacticsAtStep(s3, playerSide, { steps });
		} catch {}
		const hasStrictMotif = s3Themes.some((theme) => STRICT_ATTRACTION_MOTIFS.has(theme));
		const pressureBefore = s1.boardBefore.attackers(playerSide, attractorToIdx).length;
		const newlyPressured = s3.boardAfter.attackers(playerSide, attractorToIdx).length > pressureBefore;
		const capturedSoon = hasPlayerCaptureOnSquareWithin(steps, i + 2, playerSide, attractorTo, 4);
		if (at === "K") {
			if (positionInCheck(s3.fenAfter) && (newlyPressured || hasStrictMotif)) return true;
			continue;
		}
		if (!hasStrictMotif || !newlyPressured && !capturedSoon) continue;
		if (!s3.capturedPiece) continue;
		const finalTargetIdx = s3.boardBefore.sqToIdx(s3.uci.slice(2, 4));
		if (!Number.isInteger(finalTargetIdx) || finalTargetIdx < 0) continue;
		const defendersBefore = s2.boardBefore.attackers(opponent, finalTargetIdx);
		const defendersAfter = s2.boardAfter.attackers(opponent, finalTargetIdx);
		const wasDefendedByAttractor = defendersBefore.includes(attractorFromIdx);
		const stillDefendedByAttractor = defendersAfter.includes(attractorToIdx);
		if (!wasDefendedByAttractor || stillDefendedByAttractor) continue;
		if (isFreeOrWinningCaptureStep(s3)) return true;
	}
	return false;
}
/**
* INTERFERENCE  A piece lands between an opponent piece and its ray defender,
* cutting the defense line.
*/
function detectInterference(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.side !== playerSide) continue;
		if (!isNonIgnorableInterferenceMove(step, playerSide)) continue;
		const toIdx2 = sqToIdx(step.uci.slice(2, 4));
		const boardA = step.boardAfter;
		const boardB = step.boardBefore;
		for (const [dr, dc] of ALL_DIRS) {
			const { r: tr, c: tc } = rcOf(toIdx2);
			let rr = tr + dr, cc = tc + dc;
			let piece1Idx = -1;
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const p = boardA.pieceAt(idx);
				if (p) {
					if (boardA.colorOf(p) === opponent) piece1Idx = idx;
					break;
				}
				rr += dr;
				cc += dc;
			}
			if (piece1Idx < 0) continue;
			rr = tr - dr;
			cc = tc - dc;
			let piece2Idx = -1;
			while (inBounds(rr, cc)) {
				const idx = idxOf(rr, cc);
				const p = boardA.pieceAt(idx);
				if (p) {
					if (boardA.colorOf(p) === opponent) {
						const pt = p.toUpperCase();
						const isDiag = dr !== 0 && dc !== 0;
						if (isDiag && (pt === "B" || pt === "Q") || !isDiag && (pt === "R" || pt === "Q")) piece2Idx = idx;
					}
					break;
				}
				rr -= dr;
				cc -= dc;
			}
			if (piece2Idx < 0) continue;
			if (boardB.attackers(opponent, piece1Idx).includes(piece2Idx)) {
				const underBefore = isEffectivelyUnderdefended(boardB, piece1Idx, opponent, playerSide, { fen: step.fenBefore });
				const underAfter = isEffectivelyUnderdefended(boardA, piece1Idx, opponent, playerSide, { fen: step.fenAfter });
				if (underBefore || !underAfter) continue;
				const piece1Sq = idxToSq(piece1Idx);
				if (hasPlayerCaptureOnSquareWithin(steps, i + 1, playerSide, piece1Sq, 6)) return true;
			}
		}
	}
	return false;
}
/**
* INTERMEZZO (Zwischenzug)  Instead of recapturing, player inserts
* a forcing intermediate move (usually a check), then recaptures later.
*/
function detectIntermezzo(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (let i = 0; i < steps.length - 2; i++) {
		const s1 = steps[i];
		const s2 = steps[i + 1];
		if (s1.side !== opponent || s2.side !== playerSide) continue;
		if (s1.capturedPiece) {
			const captureSquare = s1.uci.slice(2, 4);
			const captureIdx = s1.boardAfter.sqToIdx(captureSquare);
			if (Number.isInteger(captureIdx) && captureIdx >= 0) {
				if (hasLegalRecapture(s1.boardAfter, opponent, captureIdx)) {
					if (s2.uci.slice(2, 4) !== captureSquare) {
						const isCheck = positionInCheck(s2.fenAfter);
						const capVal = s2.capturedPiece ? PIECE_VAL[s2.capturedPiece] || 0 : 0;
						const moveVal = s2.movedPiece ? PIECE_VAL[s2.movedPiece] || 0 : 0;
						const forcingCapture = !!s2.capturedPiece && capVal >= moveVal;
						if (isCheck || forcingCapture) {
							if (hasPlayerCaptureOnSquareWithin(steps, i + 2, playerSide, captureSquare, 6)) return true;
						}
					}
				}
			}
		}
		const threat = findFreshHighValueThreat(s1, playerSide, 4);
		if (!threat) continue;
		if (moveAddressesThreatDirectly(s2, threat)) continue;
		const movedWasThreatenedPiece = s2.uci.slice(0, 2) === threat.targetSq;
		const desperadoGain = s2.capturedPiece ? PIECE_VAL[s2.capturedPiece] || 0 : 0;
		if (movedWasThreatenedPiece && desperadoGain > 0) {
			if (isMovedPiecePickedOffSoon(steps, i + 2, s2, playerSide, 3)) return true;
		}
		const s2IsCheck = positionInCheck(s2.fenAfter);
		const s2CaptureVal = s2.capturedPiece ? PIECE_VAL[s2.capturedPiece] || 0 : 0;
		if (!(s2IsCheck || s2CaptureVal >= threat.targetValue)) continue;
		let playerFollowups = 0;
		const end = Math.min(steps.length - 1, i + 6);
		let threatLostBeforeResolution = false;
		for (let j = i + 2; j <= end; j++) {
			const sx = steps[j];
			if (!sx || !sx.uci) continue;
			if (sx.side === opponent) {
				if (sx.capturedPiece && sx.uci.slice(2, 4) === threat.targetSq) {
					threatLostBeforeResolution = true;
					break;
				}
				continue;
			}
			if (sx.side !== playerSide) continue;
			playerFollowups += 1;
			if (isThreatResolvedAfterPlayerMove(sx, threat, playerSide)) return true;
			if (playerFollowups >= 2) break;
		}
		if (threatLostBeforeResolution) continue;
	}
	return false;
}
/**
* MATE THREAT
* Player creates a direct mate-in-1 threat if the opponent were to "pass",
* and the opponent's best reply neutralizes that immediate mate threat.
*/
function hasMateThreatAtIndex(steps, index, playerSide, hasMateInOneFn = hasMateInOneIfSideToMove) {
	if (!Array.isArray(steps) || steps.length < 2) return false;
	if (!Number.isInteger(index) || index < 0 || index + 1 >= steps.length) return false;
	const opponent = playerSide === "w" ? "b" : "w";
	const s1 = steps[index];
	const s2 = steps[index + 1];
	if (!s1 || !s2 || s1.side !== playerSide || s2.side !== opponent) return false;
	if (!s1.fenAfter || !s2.fenAfter) return false;
	if (isCheckmate(s1.fenAfter)) return false;
	if (positionInCheck(s1.fenAfter)) return false;
	if (!hasMateInOneFn(s1.fenAfter, playerSide)) return false;
	return !hasMateInOneFn(s2.fenAfter, playerSide);
}
function findMateThreatStepIndex(steps, playerSide) {
	if (!Array.isArray(steps) || steps.length < 2) return -1;
	const maxScan = Math.min(steps.length - 1, 5);
	const memo = /* @__PURE__ */ new Map();
	const hasMateCached = (fen, side) => {
		const key = `${side}|${withFenTurn(fen, side) || ""}`;
		if (memo.has(key)) return memo.get(key);
		const value = hasMateInOneIfSideToMove(fen, side);
		memo.set(key, value);
		return value;
	};
	for (let i = 0; i < maxScan; i++) if (hasMateThreatAtIndex(steps, i, playerSide, hasMateCached)) return i;
	return -1;
}
function detectMateThreat(steps, playerSide) {
	const idx = findMateThreatStepIndex(steps, playerSide);
	return Number.isInteger(idx) && idx >= 0;
}
function isSliderPieceType(piece) {
	const t = String(piece || "").toUpperCase();
	return t === "B" || t === "R" || t === "Q";
}
function isLikelyForcedClearanceReply(s1, s2, clearedTo) {
	if (!s1 || !s2 || !s2.uci) return false;
	if (positionInCheck(s1.fenAfter)) return true;
	if (!s2.capturedPiece) return false;
	const replyTo = sqToIdx(s2.uci.slice(2, 4));
	if (!Number.isInteger(replyTo) || replyTo < 0) return false;
	if (replyTo !== clearedTo) return false;
	return String(s2.capturedPiece).toUpperCase() === String(s1.movedPiece || "").toUpperCase();
}
function isClearanceSacrificeTrigger(s1, playerSide, minLoss = 2) {
	if (!s1 || !s1.uci || !s1.boardAfter || !s1.movedPiece) return false;
	if (String(s1.movedPiece).toUpperCase() === "K") return false;
	const toIdx = s1.boardAfter.sqToIdx(s1.uci.slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	const bestGain = bestLegalCaptureGainOnSquare(s1.boardAfter, playerSide, toIdx, s1.movedPiece);
	return Number.isFinite(bestGain) && bestGain >= minLoss;
}
function classifyClearanceUsage(s1, s3, playerSide, clearedFrom, movedFrom, movedTo) {
	if (!s1?.boardBefore || !s3?.boardBefore || !s3?.movedPiece) return null;
	const clearerBefore = s1.boardBefore.pieceAt(clearedFrom);
	if (!clearerBefore || s1.boardBefore.colorOf(clearerBefore) !== playerSide) return null;
	const followerBefore = s1.boardBefore.pieceAt(movedFrom);
	if (!followerBefore || s1.boardBefore.colorOf(followerBefore) !== playerSide) return null;
	if (String(followerBefore).toUpperCase() !== String(s3.movedPiece).toUpperCase()) return null;
	if (movedTo === clearedFrom && movedFrom !== clearedFrom) return { type: "square" };
	if (!isSliderPieceType(s3.movedPiece)) return null;
	if (!(s3.boardBefore.squaresBetween(movedFrom, movedTo) || []).includes(clearedFrom)) return null;
	if (!(s1.boardBefore.squaresBetween(movedFrom, movedTo) || []).includes(clearedFrom)) return null;
	return { type: "line" };
}
function hasDecisiveClearanceEntry(s1, s3, playerSide, opponent, requireForcingPayoff) {
	if (positionInCheck(s3.fenAfter)) return true;
	if (s3.capturedPiece) {
		const capVal = PIECE_VAL[s3.capturedPiece] || 0;
		const moverVal = PIECE_VAL[s3.movedPiece] || 0;
		if (isFreeOrWinningCaptureStep(s3)) return true;
		if (!requireForcingPayoff && capVal >= Math.max(moverVal, 3)) return true;
	}
	const fromIdx3 = s3.boardBefore.sqToIdx(s3.uci.slice(0, 2));
	const toIdx3 = s3.boardBefore.sqToIdx(s3.uci.slice(2, 4));
	try {
		if (detectDiscoveredAttack(s3.boardBefore, s3.boardAfter, fromIdx3, toIdx3, playerSide, s3.isEp)) return true;
	} catch {}
	const step3Threat = findFreshHighValueThreat(s3, opponent, 3);
	if (!step3Threat) return false;
	const step1Threat = findFreshHighValueThreat(s1, opponent, 3);
	if (!step1Threat) return step3Threat.targetValue >= 4;
	const strongerByValue = step3Threat.targetValue > step1Threat.targetValue;
	const strongerByPressure = step3Threat.score >= step1Threat.score + 10;
	if (strongerByValue || strongerByPressure) return true;
	if (!requireForcingPayoff && step3Threat.score > step1Threat.score) return true;
	return false;
}
function isMovedPiecePickedOffSoon(steps, startIdx, moveStep, moverSide, maxPlies = 3) {
	if (!Array.isArray(steps) || !moveStep || !moveStep.uci || !moveStep.movedPiece) return false;
	if (moverSide !== "w" && moverSide !== "b") return false;
	const opponent = moverSide === "w" ? "b" : "w";
	const trackedTo = moveStep.uci.slice(2, 4);
	if (!trackedTo) return false;
	const trackedType = String(moveStep.movedPiece).toUpperCase();
	const begin = Math.max(0, Number.isInteger(startIdx) ? startIdx : 0);
	const end = Math.min(steps.length - 1, begin + Math.max(1, maxPlies));
	for (let i = begin; i <= end; i++) {
		const step = steps[i];
		if (!step || step.side !== opponent || !step.uci || !step.capturedPiece) continue;
		if (step.uci.slice(2, 4) !== trackedTo) continue;
		if (String(step.capturedPiece).toUpperCase() === trackedType) return true;
	}
	return false;
}
function hasMateInOneIfSideToMove(fen, sideToMove) {
	if (!fen || sideToMove !== "w" && sideToMove !== "b") return false;
	const fenTurn = withFenTurn(fen, sideToMove);
	if (!fenTurn) return false;
	try {
		const cl = ChessLite();
		cl.loadFEN(fenTurn);
		const rawMoves = cl.moves() || [];
		for (const mv of rawMoves) {
			const uci = coerceMoveToUci(cl, mv);
			if (!uci) continue;
			const cl2 = ChessLite();
			cl2.loadFEN(fenTurn);
			if (!cl2.moveUci(uci)?.ok) continue;
			const defender = cl2.turn();
			if (cl2.inCheck(defender) && (cl2.moves() || []).length === 0) return true;
		}
	} catch {}
	return false;
}
function isClearanceTriggerAtIndex(steps, index, playerSide) {
	if (!Array.isArray(steps) || index < 0 || index + 2 >= steps.length) return false;
	const opponent = playerSide === "w" ? "b" : "w";
	const s1 = steps[index];
	const s2 = steps[index + 1];
	const s3 = steps[index + 2];
	if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) return false;
	if (!s1.boardBefore || !s1.boardAfter || !s2.boardAfter || !s3.boardBefore || !s3.boardAfter) return false;
	if (!s1.uci || !s2.uci || !s3.uci || !s1.movedPiece || !s3.movedPiece) return false;
	const clearedFrom = sqToIdx(s1.uci.slice(0, 2));
	const clearedTo = sqToIdx(s1.uci.slice(2, 4));
	const movedFrom = sqToIdx(s3.uci.slice(0, 2));
	const movedTo = sqToIdx(s3.uci.slice(2, 4));
	if (!Number.isInteger(clearedFrom) || clearedFrom < 0) return false;
	if (!Number.isInteger(clearedTo) || clearedTo < 0) return false;
	if (!Number.isInteger(movedFrom) || movedFrom < 0) return false;
	if (!Number.isInteger(movedTo) || movedTo < 0) return false;
	const clearerBefore = s1.boardBefore.pieceAt(clearedFrom);
	const clearerAfter = s1.boardAfter.pieceAt(clearedTo);
	if (!clearerBefore || !clearerAfter) return false;
	if (s1.boardBefore.colorOf(clearerBefore) !== playerSide) return false;
	if (s1.boardAfter.colorOf(clearerAfter) !== playerSide) return false;
	if (s1.boardAfter.pieceAt(clearedFrom)) return false;
	if (!isClearanceSacrificeTrigger(s1, playerSide, String(s1.movedPiece || "").toUpperCase() === "P" ? 0 : 2)) return false;
	if (movedFrom === clearedTo) return false;
	if (!classifyClearanceUsage(s1, s3, playerSide, clearedFrom, movedFrom, movedTo)) return false;
	if (!hasDecisiveClearanceEntry(s1, s3, playerSide, opponent, !isLikelyForcedClearanceReply(s1, s2, clearedTo))) return false;
	return true;
}
/**
* CLEARANCE SACRIFICE (strict)
* 1) Move 1 vacates a square/line.
* 2) Move 1 is a sacrifice (capturable with meaningful material gain).
* 3) Opponent replies.
* 4) Move 3 immediately uses that exact vacated square/line.
* 5) "Impossible before" check: move 3 route was blocked by the clearer.
* 6) Move 3 must carry tactical justification.
*/
function detectClearance(steps, playerSide) {
	for (let i = 0; i < steps.length - 2; i++) if (isClearanceTriggerAtIndex(steps, i, playerSide)) return true;
	return false;
}
/**
* CAPTURING DEFENDER  Player captures a piece that was defending another target.
* Returns the trigger step index (capturing the defender), or -1 if absent.
*/
function findCapturingDefenderAnchorIndex(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (let i = 0; i < steps.length - 1; i++) {
		const s1 = steps[i];
		if (s1.side !== playerSide || !s1.capturedPiece || !s1.boardBefore || !s1.boardAfter || !s1.uci) continue;
		const capturedDefenderSquare = sqToIdx(s1.uci.slice(2, 4));
		if (!Number.isInteger(capturedDefenderSquare) || capturedDefenderSquare < 0) continue;
		const candidateTargets = [];
		for (let targetIdx = 0; targetIdx < 64; targetIdx++) {
			if (targetIdx === capturedDefenderSquare) continue;
			const targetPiece = s1.boardAfter.pieceAt(targetIdx);
			if (!targetPiece || s1.boardAfter.colorOf(targetPiece) !== opponent) continue;
			if (String(targetPiece).toUpperCase() === "K") continue;
			const defendersBefore = s1.boardBefore.attackers(opponent, targetIdx) || [];
			if (!defendersBefore.includes(capturedDefenderSquare)) continue;
			if ((s1.boardAfter.attackers(opponent, targetIdx) || []).length >= defendersBefore.length) continue;
			const soleCriticalDefender = defendersBefore.length === 1;
			const underBefore = isEffectivelyUnderdefended(s1.boardBefore, targetIdx, opponent, playerSide, { fen: s1.fenBefore });
			const underAfter = isEffectivelyUnderdefended(s1.boardAfter, targetIdx, opponent, playerSide, { fen: s1.fenAfter });
			const hangingAfter = s1.boardAfter.isHanging(targetIdx);
			const becameLooseNow = !underBefore && underAfter || hangingAfter;
			candidateTargets.push({
				idx: targetIdx,
				sq: idxToSq(targetIdx),
				soleCriticalDefender,
				underBefore,
				becameLooseNow
			});
		}
		if (!candidateTargets.length) continue;
		const end = Math.min(steps.length - 1, i + 6);
		for (let j = i + 1; j <= end; j++) {
			const sFollow = steps[j];
			if (!sFollow || sFollow.side !== playerSide || !sFollow.capturedPiece || !sFollow.boardBefore || !sFollow.uci) continue;
			const targetSq = sFollow.uci.slice(2, 4);
			const match = candidateTargets.find((candidate) => candidate.sq === targetSq);
			if (!match) continue;
			const directWinningCapture = isFreeOrWinningCaptureStep(sFollow);
			const deferredConversion = hasDeferredDefenderConversion(steps, j, playerSide);
			if (!directWinningCapture && !deferredConversion) continue;
			if (!match.soleCriticalDefender && !match.becameLooseNow && !deferredConversion) continue;
			const underAtFollowup = isEffectivelyUnderdefended(sFollow.boardBefore, match.idx, opponent, playerSide, { fen: sFollow.fenBefore });
			const hangingAtFollowup = sFollow.boardBefore.isHanging(match.idx);
			if (!match.soleCriticalDefender && !underAtFollowup && !hangingAtFollowup && !deferredConversion) continue;
			if (!match.soleCriticalDefender && match.underBefore && !underAtFollowup && !hangingAtFollowup && !deferredConversion) continue;
			return i;
		}
	}
	return -1;
}
function detectCapturingDefender(steps, playerSide) {
	return findCapturingDefenderAnchorIndex(steps, playerSide) >= 0;
}
function hasDeferredDefenderConversion(steps, followupIndex, playerSide, minGain = 1, maxPlies = 4) {
	if (!Array.isArray(steps) || !Number.isInteger(followupIndex) || followupIndex < 0 || followupIndex >= steps.length) return false;
	const followup = steps[followupIndex];
	if (!followup || followup.side !== playerSide) return false;
	const baseline = followupIndex > 0 ? Number(steps[followupIndex - 1]?.cumulativeDelta) || 0 : 0;
	const windowEnd = Math.min(steps.length - 1, followupIndex + Math.max(2, maxPlies));
	let sawOpponentReply = false;
	let bestAfterReply = -Infinity;
	for (let i = followupIndex + 1; i <= windowEnd; i++) {
		const step = steps[i];
		if (!step) continue;
		if (step.side !== playerSide) sawOpponentReply = true;
		if (!sawOpponentReply) continue;
		const cumulative = Number(step.cumulativeDelta) || 0;
		if (cumulative > bestAfterReply) bestAfterReply = cumulative;
	}
	if (!sawOpponentReply) return false;
	return bestAfterReply >= baseline + Math.max(1, Number(minGain) || 1);
}
/**
* QUIET MOVE  A player move with no capture, not a king move,
* not a pawn on the 7th rank. Check-giving moves count as quiet
* only if the moving piece is a pawn (a pawn push that happens to
* give check is still "quiet" in nature). Non-pawn checks are not quiet.
*/
function detectQuietMove(step) {
	if (step.capturedPiece) return false;
	if (!step.movedPiece) return false;
	const mt = step.movedPiece.toUpperCase();
	if (mt === "K") return false;
	if (step.promotion) return false;
	if (mt !== "P" && positionInCheck(step.fenAfter)) return false;
	if (mt === "P") {
		if (rcOf(sqToIdx(step.uci.slice(2, 4))).r === (step.side === "w" ? 1 : 6)) return false;
	}
	return true;
}
/**
* DEFENSIVE MOVE (strict)
* Non-forcing move that neutralizes a fresh tactical threat from the
* opponent's previous move and improves own material safety.
*/
function isEndgameForDefensivePawnCounting(fen) {
	let endgameType = null;
	try {
		endgameType = detectEndgameType(fen);
	} catch {}
	return !!endgameType;
}
function isDefensiveVulnerabilityCandidate(piece, includePawns) {
	if (!piece) return false;
	const t = String(piece).toUpperCase();
	if (t === "K") return false;
	if (t === "P") return !!includePawns;
	return (PIECE_VAL[piece] || 0) >= 3;
}
function getOwnPieceVulnerability(board, idx, side, fen = null, includePawns = false) {
	if (!board || !Number.isInteger(idx) || idx < 0 || idx > 63) return null;
	if (side !== "w" && side !== "b") return null;
	const piece = board.pieceAt(idx);
	if (!piece || board.colorOf(piece) !== side) return null;
	if (!isDefensiveVulnerabilityCandidate(piece, includePawns)) return null;
	const opponent = side === "w" ? "b" : "w";
	const under = isEffectivelyUnderdefended(board, idx, side, opponent, { fen });
	const hanging = board.isHanging(idx);
	const attackers = countEffectiveCapturers(board, opponent, side, idx, { fen });
	const defenders = countEffectiveCapturers(board, side, opponent, idx, { fen });
	const vulnerable = !!(under || hanging);
	return {
		idx,
		piece,
		value: PIECE_VAL[piece] || 0,
		under,
		hanging,
		attackers,
		defenders,
		vulnerable
	};
}
function countVulnerableOwnPieces(board, side, fen = null, includePawns = false) {
	if (!board || side !== "w" && side !== "b") return 0;
	let count = 0;
	for (let idx = 0; idx < 64; idx++) {
		const info = getOwnPieceVulnerability(board, idx, side, fen, includePawns);
		if (info && info.vulnerable) count++;
	}
	return count;
}
function sameFenPlacementTurnCastlingEp(fenA, fenB) {
	try {
		const a = String(fenA || "").trim().split(/\s+/);
		const b = String(fenB || "").trim().split(/\s+/);
		if (a.length < 4 || b.length < 4) return false;
		return a.slice(0, 4).join(" ") === b.slice(0, 4).join(" ");
	} catch {
		return false;
	}
}
function buildStepFromFenAndMove(fenBefore, move) {
	if (!fenBefore || !move) return null;
	const uci = normalizeMove(fenBefore, move);
	if (!uci) return null;
	try {
		const cl = ChessLite();
		cl.loadFEN(fenBefore);
		const boardBefore = ChessPrimitives(fenBefore);
		const side = normalizeSide(null, fenBefore);
		const fromIdx = boardBefore.sqToIdx(uci.slice(0, 2));
		const toIdx = boardBefore.sqToIdx(uci.slice(2, 4));
		const movedPiece = boardBefore.pieceAt(fromIdx);
		const capturedPiece = boardBefore.pieceAt(toIdx);
		const isEp = movedPiece && movedPiece.toUpperCase() === "P" && fromIdx % 8 !== toIdx % 8 && !capturedPiece;
		const captured = capturedPiece || (isEp ? side === "w" ? "p" : "P" : null);
		const applied = cl.moveUci(uci);
		if (!applied || !applied.ok) return null;
		const fenAfter = cl.fen();
		return {
			uci,
			fenBefore,
			fenAfter,
			movedPiece,
			capturedPiece: captured,
			side,
			boardBefore,
			boardAfter: ChessPrimitives(fenAfter),
			isEp,
			promotion: uci.length > 4 ? uci[4] : null
		};
	} catch {
		return null;
	}
}
function resolvePreviousOpponentStepForDefense(step, options = null) {
	if (!step || !step.uci) return null;
	const side = step.side === "w" || step.side === "b" ? step.side : null;
	if (!side) return null;
	const opponent = side === "w" ? "b" : "w";
	const steps = options && Array.isArray(options.steps) ? options.steps : null;
	const stepIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : -1;
	if (steps && stepIndex > 0 && stepIndex < steps.length) {
		const prev = steps[stepIndex - 1];
		if (prev && prev.side === opponent && prev.boardBefore && prev.boardAfter) return prev;
	}
	const explicitPrev = options && options.previousStep;
	if (explicitPrev && explicitPrev.side === opponent && explicitPrev.boardBefore && explicitPrev.boardAfter) return explicitPrev;
	const previousFen = typeof options?.previousFen === "string" ? options.previousFen : null;
	const previousMove = typeof options?.previousMove === "string" ? options.previousMove : null;
	if (!previousFen || !previousMove) return null;
	const rebuilt = buildStepFromFenAndMove(previousFen, previousMove);
	if (!rebuilt || rebuilt.side !== opponent) return null;
	if (step.fenBefore && !sameFenPlacementTurnCastlingEp(rebuilt.fenAfter, step.fenBefore)) return null;
	return rebuilt;
}
function moveDefensivelyResolvesThreat(step, threat, side, includePawns) {
	if (!step || !threat || !step.boardBefore || !step.boardAfter || !step.uci) return false;
	const opponent = side === "w" ? "b" : "w";
	const threatIdx = threat.targetIdx;
	if (!Number.isInteger(threatIdx) || threatIdx < 0 || threatIdx > 63) return false;
	const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
	const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
	if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx)) return false;
	const beforeInfo = getOwnPieceVulnerability(step.boardBefore, threatIdx, side, step.fenBefore, includePawns);
	if (!beforeInfo || !beforeInfo.vulnerable) return false;
	const pieceAfterOnThreat = step.boardAfter.pieceAt(threatIdx);
	const sameOwnPieceStillOnThreat = pieceAfterOnThreat && step.boardAfter.colorOf(pieceAfterOnThreat) === side;
	const afterInfoOnThreat = sameOwnPieceStillOnThreat ? getOwnPieceVulnerability(step.boardAfter, threatIdx, side, step.fenAfter, includePawns) : null;
	const movedThreatenedResolved = fromIdx === threatIdx && toIdx !== threatIdx && (() => {
		const infoAtNewSq = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
		return !infoAtNewSq || !infoAtNewSq.vulnerable;
	})();
	const attackersBefore = step.boardBefore.attackers(opponent, threatIdx) || [];
	const attackersAfter = step.boardAfter.attackers(opponent, threatIdx) || [];
	const defendersBefore = step.boardBefore.attackers(side, threatIdx) || [];
	const defendersAfter = step.boardAfter.attackers(side, threatIdx) || [];
	const movedPieceDefendsThreatAfter = defendersAfter.includes(toIdx);
	const movedPieceDefendedThreatBefore = defendersBefore.includes(fromIdx);
	const guardArrived = sameOwnPieceStillOnThreat && !!afterInfoOnThreat && !afterInfoOnThreat.vulnerable && movedPieceDefendsThreatAfter && !movedPieceDefendedThreatBefore && defendersAfter.length > defendersBefore.length;
	const removedAttackers = attackersBefore.filter((ai) => !attackersAfter.includes(ai));
	let lineBlocked = false;
	if (sameOwnPieceStillOnThreat && !!afterInfoOnThreat && !afterInfoOnThreat.vulnerable && removedAttackers.length) {
		for (const ai of removedAttackers) if ((step.boardBefore.squaresBetween(ai, threatIdx) || []).includes(toIdx)) {
			lineBlocked = true;
			break;
		}
	}
	return movedThreatenedResolved || guardArrived || lineBlocked;
}
function estimateDefensiveAlternativeDropCp(step, threat, side, includePawns) {
	if (!step || !threat || !step.boardBefore || !step.boardAfter || !step.uci) return Number.POSITIVE_INFINITY;
	if (positionInCheck(step.fenAfter)) return 220;
	const opponent = side === "w" ? "b" : "w";
	const resolvesThreat = moveDefensivelyResolvesThreat(step, threat, side, includePawns);
	const beforeVulnerable = countVulnerableOwnPieces(step.boardBefore, side, step.fenBefore, includePawns);
	const afterVulnerable = countVulnerableOwnPieces(step.boardAfter, side, step.fenAfter, includePawns);
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	const movedPieceVuln = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
	const createdCounterThreat = findFreshHighValueThreat(step, opponent, includePawns ? 1 : 3);
	let drop = 0;
	if (!resolvesThreat) drop += 130;
	if (afterVulnerable > beforeVulnerable) drop += Math.min(90, (afterVulnerable - beforeVulnerable) * 24);
	else if (afterVulnerable === beforeVulnerable) drop += 70;
	if (movedPieceVuln && movedPieceVuln.vulnerable) drop += 45;
	if (createdCounterThreat && createdCounterThreat.targetValue >= threat.targetValue) drop = Math.max(0, drop - 20);
	return Math.max(0, drop);
}
function detectDefensiveMove(step, options = null) {
	if (!step || !step.boardBefore || !step.boardAfter || !step.uci) return false;
	const side = step.side === "w" || step.side === "b" ? step.side : null;
	if (!side) return false;
	const opponent = side === "w" ? "b" : "w";
	if (step.capturedPiece) return false;
	if (positionInCheck(step.fenAfter)) return false;
	if (positionInCheck(step.fenBefore)) return false;
	if (step.movedPiece && String(step.movedPiece).toUpperCase() === "K") return false;
	const legalMovesRaw = getLegalMoves(step.fenBefore);
	const legalMoveUcis = [];
	const seenLegal = /* @__PURE__ */ new Set();
	for (const rawMove of Array.isArray(legalMovesRaw) ? legalMovesRaw : []) {
		const uci = normalizeMove(step.fenBefore, rawMove);
		if (!uci || seenLegal.has(uci)) continue;
		seenLegal.add(uci);
		legalMoveUcis.push(uci);
	}
	if (!legalMoveUcis.length) return false;
	const chosenUci = String(step.uci || "").toLowerCase();
	const alternativeUcis = legalMoveUcis.filter((uci) => uci !== chosenUci);
	if (!alternativeUcis.length) return false;
	const deltaCpAbs = Number.isFinite(Number(options?.deltaCp)) ? Math.abs(Number(options.deltaCp)) : null;
	if (deltaCpAbs !== null && deltaCpAbs < 80) return false;
	const previousOpponentStep = resolvePreviousOpponentStepForDefense(step, options);
	const includePawns = isEndgameForDefensivePawnCounting(step.fenBefore);
	const minThreatValue = includePawns ? 1 : 3;
	let freshThreat = previousOpponentStep ? findFreshHighValueThreat(previousOpponentStep, side, minThreatValue) : null;
	if (!freshThreat) freshThreat = findCurrentHighValueThreat(step.boardBefore, side, step.fenBefore, minThreatValue, includePawns);
	if (!freshThreat) return false;
	if (!moveDefensivelyResolvesThreat(step, freshThreat, side, includePawns)) return false;
	const beforeVulnerable = countVulnerableOwnPieces(step.boardBefore, side, step.fenBefore, includePawns);
	if (beforeVulnerable <= 0) return false;
	if (countVulnerableOwnPieces(step.boardAfter, side, step.fenAfter, includePawns) >= beforeVulnerable) return false;
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	const movedPieceVuln = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
	if (movedPieceVuln && movedPieceVuln.vulnerable) return false;
	const createdCounterThreat = findFreshHighValueThreat(step, opponent, includePawns ? 1 : 3);
	if (createdCounterThreat && createdCounterThreat.targetValue >= freshThreat.targetValue) return false;
	const minAltDropCp = Number.isFinite(Number(options?.defensiveAlternativeDropCpMin)) ? Number(options.defensiveAlternativeDropCpMin) : 70;
	let consideredAlternatives = 0;
	let bestAlternativeDropCp = Number.POSITIVE_INFINITY;
	for (const altUci of alternativeUcis) {
		const altStep = buildStepFromFenAndMove(step.fenBefore, altUci);
		if (!altStep || altStep.side !== side) continue;
		if (moveDefensivelyResolvesThreat(altStep, freshThreat, side, includePawns)) return false;
		consideredAlternatives += 1;
		const altDropCp = estimateDefensiveAlternativeDropCp(altStep, freshThreat, side, includePawns);
		if (Number.isFinite(altDropCp)) bestAlternativeDropCp = Math.min(bestAlternativeDropCp, altDropCp);
	}
	if (consideredAlternatives <= 0) return false;
	if (!Number.isFinite(bestAlternativeDropCp)) return false;
	if (bestAlternativeDropCp < minAltDropCp) return false;
	return true;
}
function detectDefensiveMoveInPV(steps, playerSide, options = null) {
	if (!Array.isArray(steps) || !steps.length) return false;
	const seedPrev = options && typeof options.previousFen === "string" && typeof options.previousMove === "string" ? buildStepFromFenAndMove(options.previousFen, options.previousMove) : null;
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (!step || step.side !== playerSide) continue;
		const prevStep = i > 0 ? steps[i - 1] : seedPrev;
		if (prevStep && prevStep.side === playerSide) continue;
		if (detectDefensiveMove(step, {
			...options || {},
			steps,
			stepIndex: i,
			previousStep: prevStep
		})) return true;
	}
	return false;
}
var DETECT_TACTICS_STEP_CACHE_LIMIT = 3e3;
var DETECT_TACTICS_STEP_CACHE = /* @__PURE__ */ new Map();
function detectTacticsCacheStepKey(step) {
	if (!step || typeof step !== "object") return "";
	const fenBefore = String(step.fenBefore || "").trim();
	const fenAfter = String(step.fenAfter || "").trim();
	const uci = String(step.uci || "").trim().toLowerCase();
	if (!fenBefore || !fenAfter || !uci) return "";
	return [
		fenBefore,
		uci,
		fenAfter,
		String(step.side || ""),
		String(step.movedPiece || ""),
		String(step.capturedPiece || "")
	].join("|");
}
function buildDetectTacticsCacheKey(step, playerSide, options = null) {
	try {
		const base = detectTacticsCacheStepKey(step);
		if (!base) return "";
		const contextSteps = options && Array.isArray(options.steps) ? options.steps : null;
		const explicitIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : null;
		const stepIndex = explicitIndex !== null ? explicitIndex : contextSteps ? contextSteps.indexOf(step) : -1;
		const prevStep = contextSteps && stepIndex > 0 ? contextSteps[stepIndex - 1] : null;
		const nextStep = contextSteps && stepIndex >= 0 && stepIndex + 1 < contextSteps.length ? contextSteps[stepIndex + 1] : null;
		const previousFen = typeof options?.previousFen === "string" ? options.previousFen : typeof step?._prevFen === "string" ? step._prevFen : "";
		const previousMove = typeof options?.previousMove === "string" ? options.previousMove : typeof step?._prevPlayedMove === "string" ? step._prevPlayedMove : "";
		const directDelta = Number(options?.deltaCp);
		const mistakeDelta = Number(options?.mistake?.deltaCp);
		const suppressionDelta = Number.isFinite(directDelta) ? directDelta : Number.isFinite(mistakeDelta) ? mistakeDelta : "";
		const prevKey = prevStep ? `${String(prevStep.uci || "").trim().toLowerCase()}:${String(prevStep.side || "")}` : "";
		const nextKey = nextStep ? `${String(nextStep.uci || "").trim().toLowerCase()}:${String(nextStep.side || "")}` : "";
		return [
			String(55),
			String(playerSide || ""),
			base,
			String(stepIndex),
			prevKey,
			nextKey,
			String(previousFen || ""),
			String(previousMove || "").trim().toLowerCase(),
			String(suppressionDelta)
		].join("||");
	} catch {
		return "";
	}
}
function setDetectTacticsCache(key, themes) {
	if (!key) return;
	try {
		DETECT_TACTICS_STEP_CACHE.set(key, themes);
		if (DETECT_TACTICS_STEP_CACHE.size <= DETECT_TACTICS_STEP_CACHE_LIMIT) return;
		const oldest = DETECT_TACTICS_STEP_CACHE.keys().next();
		if (!oldest.done) DETECT_TACTICS_STEP_CACHE.delete(oldest.value);
	} catch {}
}
/**
* Apply tactical detectors at a specific step in the PV.
*/
function detectTacticsAtStep(step, playerSide, options = null) {
	if (!step || !step.boardBefore || !step.boardAfter || !step.uci) return [];
	const cacheKey = buildDetectTacticsCacheKey(step, playerSide, options);
	if (cacheKey && DETECT_TACTICS_STEP_CACHE.has(cacheKey)) {
		const cached = DETECT_TACTICS_STEP_CACHE.get(cacheKey);
		return Array.isArray(cached) ? cached.slice() : [];
	}
	const themes = [];
	const opponent = playerSide === "w" ? "b" : "w";
	const contextSteps = options && Array.isArray(options.steps) ? options.steps : null;
	const previousFen = typeof options?.previousFen === "string" ? options.previousFen : typeof step?._prevFen === "string" ? step._prevFen : null;
	const previousMove = typeof options?.previousMove === "string" ? options.previousMove : typeof step?._prevPlayedMove === "string" ? step._prevPlayedMove : null;
	const { boardBefore, boardAfter, uci, movedPiece } = step;
	const toIdx = boardAfter.sqToIdx(uci.slice(2, 4));
	const fromIdx = boardBefore.sqToIdx(uci.slice(0, 2));
	if (step.side === playerSide) {
		try {
			if (detectFork(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.FORK);
		} catch {}
		try {
			const isPin = detectPin(boardAfter, toIdx, playerSide, opponent, boardBefore, fromIdx) || detectPinExploitation(boardBefore, boardAfter, toIdx, playerSide, opponent, step.fenAfter, {
				steps: contextSteps,
				stepIndex: contextSteps ? contextSteps.indexOf(step) : -1
			});
			const suppressPin = contextSteps ? shouldSuppressPinOnImmediateTrade(contextSteps, step, playerSide) : false;
			if (isPin && !suppressPin) themes.push(THEMES.PIN);
		} catch {}
		try {
			if (detectSkewer(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.SKEWER);
		} catch {}
		try {
			if (detectDiscoveredAttack(boardBefore, boardAfter, fromIdx, toIdx, playerSide)) themes.push(THEMES.DISCOVERED_ATTACK);
		} catch {}
		try {
			if (detectDoubleCheck(boardAfter, opponent)) themes.push(THEMES.DOUBLE_CHECK);
		} catch {}
		try {
			const stepIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : contextSteps ? contextSteps.indexOf(step) : -1;
			if (detectTrappedPiece(boardBefore, boardAfter, toIdx, opponent, step.fenAfter, step.fenBefore, {
				steps: contextSteps,
				stepIndex
			})) themes.push(THEMES.TRAPPED_PIECE);
		} catch {}
		try {
			let suppressionMistake = options && typeof options.mistake === "object" ? options.mistake : null;
			if ((!suppressionMistake || typeof suppressionMistake !== "object") && previousFen && previousMove) suppressionMistake = {
				_prevFen: previousFen,
				_prevPlayedMove: previousMove
			};
			if (suppressionMistake && typeof suppressionMistake === "object") {
				const deltaCp = Number(options?.deltaCp);
				if (!Number.isFinite(Number(suppressionMistake.deltaCp)) && Number.isFinite(deltaCp)) suppressionMistake.deltaCp = deltaCp;
			}
			if (!shouldSuppressExchangeRecaptureHanging(step, suppressionMistake, contextSteps)) {
				const isFreeCapture = detectHangingPiece(boardBefore, step.capturedPiece, toIdx, movedPiece, boardAfter);
				const isMaterialWinning = detectMaterialWinningCapture(step);
				const isUnderdefendedWin = detectUnderdefendedWinningCapture(step);
				if (isFreeCapture || isMaterialWinning || isUnderdefendedWin) themes.push(THEMES.HANGING_PIECE);
			}
		} catch {}
		try {
			if (detectBackRank(boardAfter, opponent)) themes.push(THEMES.BACK_RANK);
		} catch {}
		try {
			if (contextSteps) {
				const stepIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : contextSteps.indexOf(step);
				if (stepIndex >= 0 && hasMateThreatAtIndex(contextSteps, stepIndex, playerSide)) themes.push(THEMES.MATE_THREAT);
			}
		} catch {}
		const suppressCustomThreat = shouldSuppressCustomThreatRecapture(step, playerSide, contextSteps);
		const suppressAupTrade = shouldSuppressAttackingUndefendedPieceOnImmediateTrade(contextSteps, step, playerSide);
		if (!suppressCustomThreat && !suppressAupTrade) try {
			if (detectAttackingUndefendedPiece(boardBefore, boardAfter, fromIdx, toIdx, opponent, movedPiece, step.capturedPiece, step.fenBefore, step.fenAfter)) themes.push(THEMES.ATTACKING_UNDEFENDED_PIECE);
		} catch {}
		if (contextSteps) {
			try {
				const stepIndex = contextSteps.indexOf(step);
				if (stepIndex >= 0 && isClearanceTriggerAtIndex(contextSteps, stepIndex, playerSide)) themes.push(THEMES.CLEARANCE);
			} catch {}
			try {
				const stepIndex = contextSteps.indexOf(step);
				if (stepIndex >= 0 && detectDefensiveMove(step, {
					steps: contextSteps,
					stepIndex,
					previousFen,
					previousMove
				})) themes.push(THEMES.DEFENSIVE_MOVE);
			} catch {}
		}
	}
	const uniqueThemes = Array.from(new Set(themes));
	setDetectTacticsCache(cacheKey, uniqueThemes);
	return uniqueThemes;
}
function detectEndgameType(fen) {
	const board = ChessPrimitives(fen);
	const pieces = {
		w: {},
		b: {}
	};
	for (let i = 0; i < 64; i++) {
		const p = board.pieceAt(i);
		if (!p) continue;
		const color = board.colorOf(p);
		const type = p.toUpperCase();
		if (type === "K") continue;
		pieces[color][type] = (pieces[color][type] || 0) + 1;
	}
	const wTypes = Object.keys(pieces.w).filter((t) => t !== "P");
	const bTypes = Object.keys(pieces.b).filter((t) => t !== "P");
	const totalPieces = wTypes.reduce((s, t) => s + pieces.w[t], 0) + bTypes.reduce((s, t) => s + pieces.b[t], 0);
	if (totalPieces === 0) return THEMES.PAWN_ENDGAME;
	if (totalPieces <= 3) {
		const allTypes = new Set([...wTypes, ...bTypes]);
		if (allTypes.size === 1) {
			const t = [...allTypes][0];
			if (t === "R") return THEMES.ROOK_ENDGAME;
			if (t === "B") return THEMES.BISHOP_ENDGAME;
			if (t === "N") return THEMES.KNIGHT_ENDGAME;
			if (t === "Q") return THEMES.QUEEN_ENDGAME;
		}
		if (allTypes.size === 2 && allTypes.has("Q") && allTypes.has("R")) return THEMES.QUEEN_ROOK_ENDGAME;
	}
	return null;
}
function isRayPieceType(piece) {
	const type = String(piece || "").toUpperCase();
	return type === "B" || type === "R" || type === "Q";
}
function isVeryAdvancedPawnStep(step) {
	if (!step || String(step.movedPiece || "").toUpperCase() !== "P") return false;
	const toIdx = step.boardAfter?.sqToIdx?.(String(step.uci || "").slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	const { r } = rcOf(toIdx);
	return step.side === "w" ? r <= 1 : r >= 6;
}
function isAdvancedPawnStep(step) {
	if (!step || String(step.movedPiece || "").toUpperCase() !== "P") return false;
	if (step.promotion) return true;
	const toIdx = step.boardAfter?.sqToIdx?.(String(step.uci || "").slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	const { r } = rcOf(toIdx);
	return step.side === "w" ? r <= 2 : r >= 5;
}
function stepAttacksOpponentPiece(step, playerSide) {
	if (!step || !step.boardAfter || !step.uci) return false;
	const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	for (const targetIdx of step.boardAfter.attacks(toIdx) || []) {
		const target = step.boardAfter.pieceAt(targetIdx);
		if (target && step.boardAfter.colorOf(target) !== playerSide) return true;
	}
	return false;
}
function legalUciSet(fen) {
	const result = /* @__PURE__ */ new Set();
	for (const move of getLegalMoves(fen)) {
		const uci = normalizeMove(fen, move);
		if (uci) result.add(uci);
	}
	return result;
}
function areCollinearIndices(a, b, c) {
	if (![
		a,
		b,
		c
	].every((i) => Number.isInteger(i) && i >= 0 && i < 64)) return false;
	const p1 = rcOf(a), p2 = rcOf(b), p3 = rcOf(c);
	if (p1.r === p2.r && p2.r === p3.r) return true;
	if (p1.c === p2.c && p2.c === p3.c) return true;
	if (p1.r - p1.c === p2.r - p2.c && p2.r - p2.c === p3.r - p3.c) return true;
	return p1.r + p1.c === p2.r + p2.c && p2.r + p2.c === p3.r + p3.c;
}
function rayPieceSupportsLine(piece, a, b) {
	const type = String(piece || "").toUpperCase();
	const p1 = rcOf(a), p2 = rcOf(b);
	const orthogonal = p1.r === p2.r || p1.c === p2.c;
	if (type === "Q") return true;
	if (type === "R") return orthogonal;
	if (type === "B") return !orthogonal && Math.abs(p1.r - p2.r) === Math.abs(p1.c - p2.c);
	return false;
}
function detectSequenceAdvancedPawn(steps, playerSide) {
	return steps.some((step) => step.side === playerSide && isVeryAdvancedPawnStep(step));
}
function detectSequenceAttackingF2F7(steps, playerSide) {
	const targetSquare = playerSide === "w" ? "f7" : "f2";
	const kingSquare = playerSide === "w" ? "e8" : "e1";
	const opponent = playerSide === "w" ? "b" : "w";
	for (const step of steps) {
		if (step.side !== playerSide || !step.capturedPiece) continue;
		if (step.uci.slice(2, 4) !== targetSquare) continue;
		const kingIdx = step.boardAfter.sqToIdx(kingSquare);
		const king = step.boardAfter.pieceAt(kingIdx);
		if (king && String(king).toUpperCase() === "K" && step.boardAfter.colorOf(king) === opponent) return true;
	}
	return false;
}
function detectSequenceDiscoveredCheck(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (const step of steps) {
		if (step.side !== playerSide) continue;
		const kingIdx = step.boardAfter.kingIdx(opponent);
		const movedTo = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
		if (kingIdx < 0 || movedTo < 0) continue;
		const checkers = step.boardAfter.attackers(playerSide, kingIdx) || [];
		if (checkers.length && checkers.some((square) => square !== movedTo)) return true;
	}
	return false;
}
function detectSequenceFork(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	const playerSteps = steps.filter((step) => step.side === playerSide);
	for (const step of playerSteps.slice(0, -1)) {
		const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
		if (detectFork(step.boardAfter, toIdx, step.movedPiece, opponent)) return true;
	}
	for (let i = 0; i < steps.length - 1; i++) {
		const step = steps[i];
		const reply = steps[i + 1];
		if (!step?.uci || !step.boardAfter || step.side !== playerSide) continue;
		if (!reply?.boardAfter || reply.side === playerSide) continue;
		if (steps.slice(i + 1).some((candidate) => candidate?.side === playerSide)) continue;
		const attackerSquare = step.uci.slice(2, 4);
		const attackerIdx = reply.boardAfter.sqToIdx(attackerSquare);
		const survivor = reply.boardAfter.pieceAt(attackerIdx);
		if (!survivor || reply.boardAfter.colorOf(survivor) !== playerSide) continue;
		if (String(survivor).toUpperCase() !== String(step.movedPiece || "").toUpperCase()) continue;
		if (detectFork(reply.boardAfter, attackerIdx, survivor, opponent)) return true;
		const survivorValue = reply.boardAfter.pieceValue(survivor);
		if ((reply.boardAfter.attacks(attackerIdx) || []).filter((targetIdx) => {
			const target = reply.boardAfter.pieceAt(targetIdx);
			if (!target || reply.boardAfter.colorOf(target) !== opponent) return false;
			const targetType = String(target).toUpperCase();
			if (targetType === "K" || targetType === "P") return false;
			return reply.boardAfter.pieceValue(target) > survivorValue;
		}).length >= 2) return true;
	}
	for (let i = 0; i < steps.length - 2; i++) {
		const step = steps[i];
		if (!step || step.side !== playerSide || !step.boardAfter || !step.uci) continue;
		if (String(step.movedPiece || "").toUpperCase() === "K") continue;
		const attackerTo = step.uci.slice(2, 4);
		const attackerIdx = step.boardAfter.sqToIdx(attackerTo);
		const kingIdx = step.boardAfter.kingIdx(opponent);
		if (attackerIdx < 0 || kingIdx < 0) continue;
		const attacks = step.boardAfter.attacks(attackerIdx) || [];
		if (!attacks.includes(kingIdx)) continue;
		const targetSquares = /* @__PURE__ */ new Set();
		for (const targetIdx of attacks) {
			const target = step.boardAfter.pieceAt(targetIdx);
			if (!target || step.boardAfter.colorOf(target) !== opponent) continue;
			const type = String(target).toUpperCase();
			if (type === "K" || type === "P") continue;
			if (!(step.boardAfter.attacks(targetIdx) || []).includes(attackerIdx)) continue;
			targetSquares.add(idxToSq(targetIdx));
		}
		if (!targetSquares.size) continue;
		let attackerSquare = attackerTo;
		let laterPlayerTurns = 0;
		for (let j = i + 1; j < steps.length && laterPlayerTurns < 2; j++) {
			const continuation = steps[j];
			if (!continuation?.uci) continue;
			const from = continuation.uci.slice(0, 2);
			const to = continuation.uci.slice(2, 4);
			if (continuation.side !== playerSide) {
				if (targetSquares.has(from)) targetSquares.delete(from);
				if (continuation.capturedPiece && to === attackerSquare) break;
				continue;
			}
			laterPlayerTurns += 1;
			if (from !== attackerSquare) continue;
			if (continuation.capturedPiece && targetSquares.has(to)) return true;
			attackerSquare = to;
		}
	}
	return false;
}
function isSequenceHanging(board, targetIdx, victimSide) {
	if ((board.attackers(victimSide, targetIdx) || []).length) return false;
	const opponent = victimSide === "w" ? "b" : "w";
	for (const attackerIdx of board.attackers(opponent, targetIdx) || []) {
		if (!isRayPieceType(board.pieceAt(attackerIdx))) continue;
		const target = rcOf(targetIdx), attackerPos = rcOf(attackerIdx);
		const dr = Math.sign(attackerPos.r - target.r);
		const dc = Math.sign(attackerPos.c - target.c);
		let r = attackerPos.r + dr, c = attackerPos.c + dc;
		while (inBounds(r, c)) {
			const idx = idxOf(r, c);
			const piece = board.pieceAt(idx);
			if (piece) {
				if (board.colorOf(piece) === victimSide && rayPieceSupportsLine(piece, targetIdx, idx)) return false;
				break;
			}
			r += dr;
			c += dc;
		}
	}
	return true;
}
function standardMaterialBalance(board, side) {
	let balance = 0;
	for (let idx = 0; idx < 64; idx++) {
		const piece = board.pieceAt(idx);
		if (!piece || String(piece).toUpperCase() === "K") continue;
		const value = PIECE_VAL[piece] || 0;
		balance += board.colorOf(piece) === side ? value : -value;
	}
	return balance;
}
function detectSequenceHangingPiece(steps, playerSide, mistake) {
	const first = steps.find((step) => step.side === playerSide);
	if (!first || !first.capturedPiece) return false;
	const toIdx = first.boardBefore.sqToIdx(first.uci.slice(2, 4));
	const opponent = playerSide === "w" ? "b" : "w";
	if (!Number.isInteger(toIdx) || toIdx < 0) return false;
	const targetIsLoose = isSequenceHanging(first.boardBefore, toIdx, opponent);
	const hasImmediateRecapture = hasLegalRecapture(first.boardAfter, playerSide, toIdx);
	const capturedType = String(first.capturedPiece).toUpperCase();
	let freeCapture = targetIsLoose && !hasImmediateRecapture && capturedType !== "P";
	if (capturedType === "P" && targetIsLoose && !hasImmediateRecapture && !first.isEp && !positionInCheck(first.fenAfter)) {
		let capturesJustMovedPawn = false;
		if (mistake && typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string" && String(first.movedPiece || "").toUpperCase() !== "P" && String(first.movedPiece || "").toUpperCase() !== "K") {
			const previous = buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove);
			capturesJustMovedPawn = !!previous && previous.uci.slice(2, 4) === first.uci.slice(2, 4) && String(previous.movedPiece || "").toUpperCase() === "P";
		}
		const firstIndex = steps.indexOf(first);
		const nextPlayerStep = firstIndex >= 0 ? steps.slice(firstIndex + 1).find((step) => step?.side === playerSide) : null;
		const entryCaptureWinsMaterial = !!nextPlayerStep?.capturedPiece && nextPlayerStep.uci.slice(0, 2) === first.uci.slice(2, 4) && (PIECE_VAL[nextPlayerStep.capturedPiece] || 0) >= (PIECE_VAL[first.movedPiece] || 0);
		freeCapture = capturesJustMovedPawn || entryCaptureWinsMaterial;
	}
	let favorableLooseCapture = false;
	if (capturedType !== "P" && detectMaterialWinningCapture(first)) {
		const firstIndex = steps.indexOf(first);
		const reply = firstIndex >= 0 ? steps[firstIndex + 1] : null;
		if (!reply || reply.side === playerSide) favorableLooseCapture = true;
		else {
			const survivor = reply.boardAfter?.pieceAt?.(reply.boardAfter.sqToIdx(first.uci.slice(2, 4)));
			favorableLooseCapture = !!survivor && reply.boardAfter.colorOf(survivor) === playerSide && String(survivor).toUpperCase() === String(first.movedPiece || "").toUpperCase();
		}
	}
	if (!freeCapture && !favorableLooseCapture) return false;
	if (mistake && typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string") {
		const previous = buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove);
		if (previous?.capturedPiece && previous.uci.slice(2, 4) === first.uci.slice(2, 4) && (PIECE_VAL[previous.capturedPiece] || 0) >= (PIECE_VAL[first.capturedPiece] || 0)) return false;
	}
	if (steps.length < 3) return true;
	if (favorableLooseCapture) return standardMaterialBalance(steps[2].boardAfter, playerSide) > standardMaterialBalance(first.boardBefore, playerSide);
	return standardMaterialBalance(steps[2].boardAfter, playerSide) >= standardMaterialBalance(first.boardAfter, playerSide);
}
function detectSequenceSkewer(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const step = steps[i];
		const previous = steps[i - 1];
		if (!previous || !step.capturedPiece || !isRayPieceType(step.movedPiece)) continue;
		if (isCheckmate(step.fenAfter)) continue;
		if (previous.uci.slice(2, 4) === step.uci.slice(2, 4)) continue;
		const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
		const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
		const evadedFrom = step.boardBefore.sqToIdx(previous.uci.slice(0, 2));
		if (!(step.boardBefore.squaresBetween(fromIdx, toIdx) || []).includes(evadedFrom)) continue;
		if ((String(previous.movedPiece || "").toUpperCase() === "K" ? 99 : PIECE_VAL[previous.movedPiece] || 0) <= (PIECE_VAL[step.capturedPiece] || 0)) continue;
		if (step.boardBefore.isInBadSpot(toIdx)) return true;
	}
	return false;
}
function pieceTypeOrdinal(piece) {
	return {
		P: 1,
		N: 2,
		B: 3,
		R: 4,
		Q: 5,
		K: 6
	}[String(piece || "").toUpperCase()] || 0;
}
function detectSequenceDeflection(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentMove = steps[i - 1], previousPlayer = steps[i - 2];
		if (!current || !opponentMove || !previousPlayer || !current.capturedPiece && !current.promotion) continue;
		if (current.capturedPiece) {
			if ((String(current.capturedPiece).toUpperCase() === "K" ? 99 : PIECE_VAL[current.capturedPiece] || 0) > (String(current.movedPiece).toUpperCase() === "K" ? 99 : PIECE_VAL[current.movedPiece] || 0)) continue;
		}
		const targetSquare = current.uci.slice(2, 4);
		const previousCapture = previousPlayer.capturedPiece;
		if (previousCapture && (PIECE_VAL[previousCapture] || 0) >= pieceTypeOrdinal(previousPlayer.movedPiece)) continue;
		if (targetSquare === opponentMove.uci.slice(2, 4) || targetSquare === previousPlayer.uci.slice(2, 4)) continue;
		if (opponentMove.uci.slice(2, 4) !== previousPlayer.uci.slice(2, 4) && !positionInCheck(previousPlayer.fenAfter)) continue;
		const beforeReply = previousPlayer.boardAfter;
		const opponentFrom = beforeReply.sqToIdx(opponentMove.uci.slice(0, 2));
		const targetIdx = beforeReply.sqToIdx(targetSquare);
		const directDeflection = (beforeReply.attacks(opponentFrom) || []).includes(targetIdx);
		const promotionDeflection = current.promotion && targetSquare[0] === opponentMove.uci.slice(0, 2)[0] && (beforeReply.attacks(opponentFrom) || []).includes(beforeReply.sqToIdx(current.uci.slice(0, 2)));
		if (!directDeflection && !promotionDeflection) continue;
		const replyTo = current.boardBefore.sqToIdx(opponentMove.uci.slice(2, 4));
		const currentTarget = current.boardBefore.sqToIdx(targetSquare);
		if ((current.boardBefore.attacks(replyTo) || []).includes(currentTarget)) continue;
		return true;
	}
	return false;
}
function detectSequenceXRay(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], previousOpponent = steps[i - 1], previousPlayer = steps[i - 2];
		if (!current?.capturedPiece || !previousOpponent || !previousPlayer) continue;
		const target = current.uci.slice(2, 4);
		if (previousOpponent.uci.slice(2, 4) !== target || previousPlayer.uci.slice(2, 4) !== target) continue;
		if (String(previousOpponent.movedPiece || "").toUpperCase() === "K") continue;
		const fromIdx = current.boardBefore.sqToIdx(current.uci.slice(0, 2));
		const toIdx = current.boardBefore.sqToIdx(target);
		const blockerFrom = current.boardBefore.sqToIdx(previousOpponent.uci.slice(0, 2));
		if ((current.boardBefore.squaresBetween(fromIdx, toIdx) || []).includes(blockerFrom)) return true;
	}
	return false;
}
function detectSequenceDiscoveredAttack(steps, playerSide) {
	if (detectSequenceDiscoveredCheck(steps, playerSide)) return true;
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (!step || step.side !== playerSide || !step.boardBefore || !step.boardAfter || !step.uci) continue;
		const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
		const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
		if (fromIdx < 0 || toIdx < 0) continue;
		if (step.promotion || isCastling(step.movedPiece, fromIdx, toIdx)) continue;
		const hits = [];
		const primary = findRevealedRayAttack(step.boardBefore, step.boardAfter, fromIdx, playerSide);
		if (primary) hits.push(primary);
		if (step.isEp) {
			const epCapturedIdx = idxOf(rcOf(fromIdx).r, rcOf(toIdx).c);
			const epHit = findRevealedRayAttack(step.boardBefore, step.boardAfter, epCapturedIdx, playerSide);
			if (epHit) hits.push(epHit);
		}
		const reply = steps[i + 1];
		for (const hit of hits) {
			if (hit.attackerIdx === toIdx) continue;
			const targetSquare = idxToSq(hit.targetIdx);
			if (!stepAttacksOpponentPiece(step, playerSide) || !reply || reply.side === playerSide || reply.uci?.slice(0, 2) !== targetSquare) continue;
			const movedType = String(step.movedPiece || "").toUpperCase();
			const revealedType = String(hit.attackerPiece || "").toUpperCase();
			const targetType = String(hit.targetPiece || "").toUpperCase();
			const quietMinorDoubleThreat = !step.capturedPiece && !reply.capturedPiece && (movedType === "N" || movedType === "B") && (revealedType === "N" || revealedType === "B") && (targetType === "N" || targetType === "B");
			const targetCapturesVacatingPawn = movedType === "P" && !step.isEp && !!step.capturedPiece && !!reply.capturedPiece && reply.uci.slice(2, 4) === step.uci.slice(2, 4) && (PIECE_VAL[hit.targetPiece] || 0) > (PIECE_VAL[step.movedPiece] || 0);
			if (quietMinorDoubleThreat || targetCapturesVacatingPawn) return true;
		}
	}
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], previousOpponent = steps[i - 1], previousPlayer = steps[i - 2];
		if (!current?.capturedPiece || !previousOpponent || !previousPlayer) continue;
		if (previousOpponent.uci.slice(2, 4) === current.uci.slice(2, 4)) continue;
		const fromIdx = current.boardBefore.sqToIdx(current.uci.slice(0, 2));
		const toIdx = current.boardBefore.sqToIdx(current.uci.slice(2, 4));
		const clearedFrom = current.boardBefore.sqToIdx(previousPlayer.uci.slice(0, 2));
		const clearedTo = previousPlayer.uci.slice(2, 4);
		if (!(current.boardBefore.squaresBetween(fromIdx, toIdx) || []).includes(clearedFrom)) continue;
		if (current.uci.slice(2, 4) === clearedTo || current.uci.slice(0, 2) === clearedTo) continue;
		const prevFrom = previousPlayer.boardBefore.sqToIdx(previousPlayer.uci.slice(0, 2));
		const prevTo = previousPlayer.boardBefore.sqToIdx(clearedTo);
		if (isCastling(previousPlayer.movedPiece, prevFrom, prevTo)) continue;
		return true;
	}
	return false;
}
function detectSequenceCollinearMove(steps, playerSide) {
	for (const step of steps) {
		if (step.side !== playerSide || step.capturedPiece || !isRayPieceType(step.movedPiece)) continue;
		const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
		const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
		const legal = legalUciSet(step.fenBefore);
		for (const targetIdx of step.boardBefore.attacks(fromIdx) || []) {
			const target = step.boardBefore.pieceAt(targetIdx);
			if (!target || step.boardBefore.colorOf(target) === playerSide || !isRayPieceType(target)) continue;
			if (!areCollinearIndices(fromIdx, targetIdx, toIdx)) continue;
			if (!rayPieceSupportsLine(target, fromIdx, targetIdx)) continue;
			if (legal.has(`${idxToSq(fromIdx)}${idxToSq(targetIdx)}`)) return true;
		}
	}
	return false;
}
function absolutePinRay(board, pinnedSide, pinnedIdx) {
	if (!board || pinnedSide !== "w" && pinnedSide !== "b") return null;
	const kingIdx = board.kingIdx(pinnedSide);
	if (kingIdx < 0 || pinnedIdx === kingIdx) return null;
	const king = rcOf(kingIdx), pinned = rcOf(pinnedIdx);
	const rawDr = pinned.r - king.r, rawDc = pinned.c - king.c;
	if (!(rawDr === 0 || rawDc === 0 || Math.abs(rawDr) === Math.abs(rawDc))) return null;
	const dr = Math.sign(rawDr), dc = Math.sign(rawDc);
	if (dr === 0 && dc === 0) return null;
	let r = king.r + dr, c = king.c + dc;
	while (inBounds(r, c) && idxOf(r, c) !== pinnedIdx) {
		if (board.pieceAt(idxOf(r, c))) return null;
		r += dr;
		c += dc;
	}
	if (!inBounds(r, c)) return null;
	const pinnedPiece = board.pieceAt(pinnedIdx);
	if (!pinnedPiece || board.colorOf(pinnedPiece) !== pinnedSide) return null;
	r += dr;
	c += dc;
	let pinnerIdx = -1;
	while (inBounds(r, c)) {
		const idx = idxOf(r, c);
		const piece = board.pieceAt(idx);
		if (piece) {
			if (board.colorOf(piece) === pinnedSide || !rayPieceSupportsLine(piece, kingIdx, idx)) return null;
			pinnerIdx = idx;
			break;
		}
		r += dr;
		c += dc;
	}
	if (pinnerIdx < 0) return null;
	const ray = new Set([kingIdx]);
	r = king.r + dr;
	c = king.c + dc;
	while (inBounds(r, c)) {
		const idx = idxOf(r, c);
		ray.add(idx);
		if (idx === pinnerIdx) break;
		r += dr;
		c += dc;
	}
	return {
		kingIdx,
		pinnedIdx,
		pinnerIdx,
		ray
	};
}
function hasPseudoEscapeOutsidePin(board, pinnedIdx, pinnedSide, ray) {
	const piece = board.pieceAt(pinnedIdx);
	if (!piece) return false;
	for (const targetIdx of board.attacks(pinnedIdx) || []) {
		if (ray.has(targetIdx)) continue;
		const occupant = board.pieceAt(targetIdx);
		if (!occupant || board.colorOf(occupant) !== pinnedSide) return true;
	}
	if (String(piece).toUpperCase() === "P") {
		const { r, c } = rcOf(pinnedIdx);
		const oneR = r + (pinnedSide === "w" ? -1 : 1);
		if (inBounds(oneR, c)) {
			const one = idxOf(oneR, c);
			if (!ray.has(one) && !board.pieceAt(one)) return true;
		}
	}
	return false;
}
function detectSequencePin(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (const step of steps) {
		if (step.side !== playerSide) continue;
		const board = step.boardAfter;
		for (let pinnedIdx = 0; pinnedIdx < 64; pinnedIdx++) {
			const pinnedPiece = board.pieceAt(pinnedIdx);
			if (!pinnedPiece || board.colorOf(pinnedPiece) !== opponent || String(pinnedPiece).toUpperCase() === "K") continue;
			const pin = absolutePinRay(board, opponent, pinnedIdx);
			if (!pin) continue;
			const pinnedValue = PIECE_VAL[pinnedPiece] || 0;
			for (const targetIdx of board.attacks(pinnedIdx) || []) {
				if (pin.ray.has(targetIdx)) continue;
				const target = board.pieceAt(targetIdx);
				if (!target || board.colorOf(target) !== playerSide) continue;
				if ((PIECE_VAL[target] || 0) > pinnedValue || board.isHanging(targetIdx)) return true;
			}
			for (const attackerIdx of board.attackers(playerSide, pinnedIdx) || []) {
				if (!pin.ray.has(attackerIdx)) continue;
				const attacker = board.pieceAt(attackerIdx);
				if (!attacker) continue;
				if (pinnedValue > (PIECE_VAL[attacker] || 0)) return true;
				const pinnedCannotTakeAttacker = !(board.attackers(opponent, attackerIdx) || []).includes(pinnedIdx);
				if (board.isHanging(pinnedIdx) && pinnedCannotTakeAttacker && hasPseudoEscapeOutsidePin(board, pinnedIdx, opponent, pin.ray)) return true;
			}
		}
	}
	return false;
}
function isSequenceTrapped(board, fen, square, victimSide) {
	if (!board || !fen || positionInCheck(fen) || absolutePinRay(board, victimSide, square)) return false;
	const piece = board.pieceAt(square);
	if (!piece || board.colorOf(piece) !== victimSide || ["P", "K"].includes(String(piece).toUpperCase())) return false;
	if (!board.isInBadSpot(square)) return false;
	const pieceValue = PIECE_VAL[piece] || 0;
	const fromSquare = idxToSq(square);
	for (const uci of legalUciSet(fen)) {
		if (uci.slice(0, 2) !== fromSquare) continue;
		const toIdx = board.sqToIdx(uci.slice(2, 4));
		const capture = board.pieceAt(toIdx);
		if (capture && (PIECE_VAL[capture] || 0) >= pieceValue) return false;
		const escape = buildStepFromFenAndMove(fen, uci);
		if (!escape) continue;
		const escapedIdx = escape.boardAfter.sqToIdx(uci.slice(2, 4));
		if (!escape.boardAfter.isInBadSpot(escapedIdx)) return false;
	}
	return true;
}
function detectSequenceTrappedPiece(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], previous = steps[i - 1];
		if (!current?.capturedPiece || !previous || String(current.capturedPiece).toUpperCase() === "P") continue;
		let trappedSquare = current.uci.slice(2, 4);
		if (previous.uci.slice(2, 4) === trappedSquare) trappedSquare = previous.uci.slice(0, 2);
		const board = previous.boardBefore;
		const square = board.sqToIdx(trappedSquare);
		const victimSide = playerSide === "w" ? "b" : "w";
		if (isSequenceTrapped(board, previous.fenBefore, square, victimSide)) return true;
	}
	return false;
}
function detectSequenceSelfInterference(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentReply = steps[i - 1];
		if (!current?.capturedPiece || !opponentReply) continue;
		const targetIdx = current.boardBefore.sqToIdx(current.uci.slice(2, 4));
		if (!current.boardBefore.isHanging(targetIdx)) continue;
		const initial = opponentReply.boardBefore;
		const defenderSide = initial.colorOf(initial.pieceAt(targetIdx));
		if (!defenderSide) continue;
		const replyTo = initial.sqToIdx(opponentReply.uci.slice(2, 4));
		for (const defenderIdx of initial.attackers(defenderSide, targetIdx) || []) {
			if (!isRayPieceType(initial.pieceAt(defenderIdx))) continue;
			if ((initial.squaresBetween(targetIdx, defenderIdx) || []).includes(replyTo)) return true;
		}
	}
	return false;
}
function detectSequenceInterference(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentReply = steps[i - 1], interfering = steps[i - 2];
		if (!current?.capturedPiece || !opponentReply || !interfering) continue;
		if (current.uci.slice(2, 4) === opponentReply.uci.slice(2, 4)) continue;
		const targetIdx = current.boardBefore.sqToIdx(current.uci.slice(2, 4));
		if (!current.boardBefore.isHanging(targetIdx)) continue;
		const initial = interfering.boardBefore;
		const targetInitialIdx = initial.sqToIdx(current.uci.slice(2, 4));
		const capturedInitially = initial.pieceAt(targetInitialIdx);
		const defenderSide = initial.colorOf(capturedInitially);
		if (!defenderSide) continue;
		const interferingTo = initial.sqToIdx(interfering.uci.slice(2, 4));
		for (const defenderIdx of initial.attackers(defenderSide, targetInitialIdx) || []) {
			if (!isRayPieceType(initial.pieceAt(defenderIdx))) continue;
			if ((initial.squaresBetween(targetInitialIdx, defenderIdx) || []).includes(interferingTo)) return true;
		}
	}
	return false;
}
function detectSequenceIntermezzo(steps, playerSide, mistake = null) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentReply = steps[i - 1], intermezzo = steps[i - 2];
		const earlierOpponent = steps[i - 3] || (mistake && typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string" ? buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove) : null);
		if (!current?.capturedPiece || !opponentReply || !intermezzo || !earlierOpponent) continue;
		const captureSquare = current.uci.slice(2, 4);
		const replyFromIdx = intermezzo.boardAfter.sqToIdx(opponentReply.uci.slice(0, 2));
		const captureIdx = intermezzo.boardAfter.sqToIdx(captureSquare);
		if ((intermezzo.boardAfter.attackers(playerSide === "w" ? "b" : "w", captureIdx) || []).includes(replyFromIdx)) continue;
		if (intermezzo.uci.slice(2, 4) === captureSquare) continue;
		if (earlierOpponent.uci.slice(2, 4) !== captureSquare || !earlierOpponent.capturedPiece) continue;
		if (legalUciSet(intermezzo.fenBefore).has(current.uci)) return true;
	}
	return false;
}
function detectSequenceAttraction(steps, playerSide) {
	const opponent = playerSide === "w" ? "b" : "w";
	for (let i = 0; i + 2 < steps.length; i++) {
		const decoy = steps[i], reply = steps[i + 1], followUp = steps[i + 2];
		if (decoy.side !== playerSide || reply.side !== opponent || followUp.side !== playerSide) continue;
		const decoySquare = decoy.uci.slice(2, 4);
		if (!reply.capturedPiece || reply.uci.slice(2, 4) !== decoySquare) continue;
		const attractedType = String(reply.movedPiece || "").toUpperCase();
		if (![
			"K",
			"Q",
			"R"
		].includes(attractedType)) continue;
		const attractedIdx = followUp.boardAfter.sqToIdx(decoySquare);
		const followUpTo = followUp.boardAfter.sqToIdx(followUp.uci.slice(2, 4));
		if (!(followUp.boardAfter.attackers(playerSide, attractedIdx) || []).includes(followUpTo)) continue;
		if (attractedType === "K") return true;
		const laterPlayer = steps[i + 4];
		if (laterPlayer && laterPlayer.side === playerSide && laterPlayer.capturedPiece && laterPlayer.uci.slice(2, 4) === decoySquare) return true;
	}
	return false;
}
function detectSequenceClearance(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentReply = steps[i - 1], clearing = steps[i - 2];
		if (!current || !opponentReply || !clearing || current.capturedPiece || !isRayPieceType(current.movedPiece)) continue;
		if (clearing.promotion) continue;
		const currentFrom = current.boardBefore.sqToIdx(current.uci.slice(0, 2));
		const currentTo = current.boardBefore.sqToIdx(current.uci.slice(2, 4));
		const clearingFrom = current.boardBefore.sqToIdx(clearing.uci.slice(0, 2));
		if (clearing.uci.slice(2, 4) === current.uci.slice(0, 2) || clearing.uci.slice(2, 4) === current.uci.slice(2, 4)) continue;
		if (positionInCheck(current.fenBefore)) continue;
		if (positionInCheck(current.fenAfter) && String(opponentReply.movedPiece || "").toUpperCase() === "K") continue;
		if (clearingFrom !== currentTo && !(current.boardBefore.squaresBetween(currentFrom, currentTo) || []).includes(clearingFrom)) continue;
		const clearingToBefore = clearing.boardBefore.sqToIdx(clearing.uci.slice(2, 4));
		const arrivedOnEmpty = !clearing.boardBefore.pieceAt(clearingToBefore);
		const clearingToAfter = clearing.boardAfter.sqToIdx(clearing.uci.slice(2, 4));
		const sacrificedTempo = clearing.boardAfter.pieceAt(clearingToAfter) && clearing.boardAfter.isInBadSpot(clearingToAfter);
		if (arrivedOnEmpty || sacrificedTempo) return true;
	}
	return false;
}
function detectSequenceCapturingDefender(steps, playerSide) {
	const playerIndices = [];
	for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
	for (const i of playerIndices.slice(1)) {
		const current = steps[i], opponentReply = steps[i - 1], removesDefender = steps[i - 2];
		if (!current || !opponentReply || !removesDefender) continue;
		const targetIdx = current.boardBefore.sqToIdx(current.uci.slice(2, 4));
		const captured = current.boardBefore.pieceAt(targetIdx);
		if (!(isCheckmate(current.fenAfter) || captured && String(current.movedPiece || "").toUpperCase() !== "K" && (PIECE_VAL[captured] || 0) <= (PIECE_VAL[current.movedPiece] || 0) && current.boardBefore.isHanging(targetIdx) && opponentReply.uci.slice(2, 4) !== current.uci.slice(2, 4)) || positionInCheck(removesDefender.fenAfter)) continue;
		if (removesDefender.uci.slice(2, 4) === current.uci.slice(0, 2)) continue;
		const initial = removesDefender.boardBefore;
		const defenderIdx = initial.sqToIdx(removesDefender.uci.slice(2, 4));
		const targetInitialIdx = initial.sqToIdx(current.uci.slice(2, 4));
		const defender = initial.pieceAt(defenderIdx);
		if (!defender || positionInCheck(removesDefender.fenBefore)) continue;
		const defenderSide = initial.colorOf(defender);
		if ((initial.attackers(defenderSide, targetInitialIdx) || []).includes(defenderIdx)) return true;
	}
	return false;
}
function detectSequenceQuietMove(steps, playerSide) {
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.side !== playerSide || i === steps.length - 1) continue;
		if (step.capturedPiece || positionInCheck(step.fenBefore) || positionInCheck(step.fenAfter)) continue;
		if (String(step.movedPiece || "").toUpperCase() === "K" || isAdvancedPawnStep(step)) continue;
		if (!stepAttacksOpponentPiece(step, playerSide)) return true;
	}
	return false;
}
function detectSequenceDefensiveMove(steps, playerSide) {
	if (!steps.length) return false;
	const final = steps[steps.length - 1];
	if (final.side === playerSide && !final.capturedPiece && !positionInCheck(final.fenAfter) && !stepAttacksOpponentPiece(final, playerSide) && !isAdvancedPawnStep(final) && legalUciSet(final.fenBefore).size >= 3) return true;
	for (const step of steps) {
		if (step.side !== playerSide || step.capturedPiece || positionInCheck(step.fenAfter)) continue;
		if (legalUciSet(step.fenBefore).size >= 3 && positionInCheck(step.fenBefore)) return true;
	}
	return false;
}
function detectSequenceSacrifice(steps, playerSide) {
	if (steps.some((step) => step.side === playerSide && step.promotion)) return false;
	let materialDelta = 0;
	let playerMoveCount = 0;
	for (const step of steps) {
		if (step.capturedPiece) {
			const value = PIECE_VAL[step.capturedPiece] || 0;
			materialDelta += step.side === playerSide ? value : -value;
		}
		if (step.side === playerSide) {
			playerMoveCount += 1;
			if (playerMoveCount > 1 && materialDelta <= -2) return true;
		}
	}
	return false;
}
function detectSequenceExposedKing(steps, playerSide) {
	if (!steps.length) return false;
	const opponent = playerSide === "w" ? "b" : "w";
	const board = steps[0].boardBefore;
	const kingIdx = board.kingIdx(opponent);
	if (kingIdx < 0) return false;
	const { r, c } = rcOf(kingIdx);
	if (!(opponent === "b" ? r <= 2 : r >= 5)) return false;
	const towardCenter = opponent === "b" ? 1 : -1;
	const shield = [
		[towardCenter, 0],
		[0, -1],
		[0, 1],
		[towardCenter, -1],
		[towardCenter, 1]
	];
	for (const [dr, dc] of shield) {
		const rr = r + dr, cc = c + dc;
		if (!inBounds(rr, cc)) continue;
		const piece = board.pieceAt(idxOf(rr, cc));
		if (piece && board.colorOf(piece) === opponent && String(piece).toUpperCase() === "P") return false;
	}
	return steps.filter((step) => step.side === playerSide).slice(1, -1).some((step) => positionInCheck(step.fenAfter));
}
function detectSequenceSideAttack(steps, playerSide, flank) {
	if (!steps.length) return false;
	const opponent = playerSide === "w" ? "b" : "w";
	const board = steps[0].boardBefore;
	const kingIdx = board.kingIdx(opponent);
	if (kingIdx < 0) return false;
	const { r: kingRow, c: kingFile } = rcOf(kingIdx);
	const homeRow = opponent === "b" ? 0 : 7;
	const files = flank === "king" ? [6, 7] : [
		0,
		1,
		2
	];
	const minPieces = flank === "king" ? 20 : 18;
	if (kingRow !== homeRow || !files.includes(kingFile) || countPieces(board) < minPieces) return false;
	const playerSteps = steps.filter((step) => step.side === playerSide);
	if (!playerSteps.some((step) => positionInCheck(step.fenAfter))) return false;
	const cornerIdx = idxOf(homeRow, flank === "king" ? 7 : 0);
	let score = 0;
	for (const step of playerSteps) {
		const distance = dist(cornerIdx, step.boardAfter.sqToIdx(step.uci.slice(2, 4)));
		if (positionInCheck(step.fenAfter)) score += 1;
		if (step.capturedPiece && distance <= 3) score += 1;
		else if (distance >= 5) score -= 1;
	}
	return score >= 2;
}
function detectSequenceZugzwang(steps, playerSide) {
	const first = steps.find((step) => step.side === playerSide);
	if (!first || first.capturedPiece || positionInCheck(first.fenBefore) || positionInCheck(first.fenAfter)) return false;
	if (isVeryAdvancedPawnStep(first)) return false;
	if (countPieces(first.boardBefore) > 10) return false;
	if (steps.some((step) => step.promotion)) return false;
	const reply = steps[steps.indexOf(first) + 1];
	if (!reply || reply.capturedPiece || positionInCheck(reply.fenAfter)) return false;
	if (steps.length >= 5) return true;
	const replies = legalUciSet(first.fenAfter);
	if (!replies.size || replies.size > 12) return false;
	for (const uci of replies) {
		const alt = buildStepFromFenAndMove(first.fenAfter, uci);
		if (!alt || alt.capturedPiece || positionInCheck(alt.fenAfter)) return false;
	}
	return true;
}
function collectSequenceAlignedThemes(steps, playerSide, mistake) {
	const themes = /* @__PURE__ */ new Set();
	const enginePvMode = mistake?._analysisMode === "engine-pv";
	if (detectSequenceAdvancedPawn(steps, playerSide)) themes.add(THEMES.ADVANCED_PAWN);
	if (detectSequenceAttackingF2F7(steps, playerSide)) themes.add(THEMES.ATTACKING_F2F7);
	if (detectSequenceDiscoveredCheck(steps, playerSide)) themes.add(THEMES.DISCOVERED_CHECK);
	if (detectSequenceDiscoveredAttack(steps, playerSide)) themes.add(THEMES.DISCOVERED_ATTACK);
	if (detectSequenceFork(steps, playerSide)) themes.add(THEMES.FORK);
	if (detectSequenceHangingPiece(steps, playerSide, mistake)) themes.add(THEMES.HANGING_PIECE);
	if (detectSequenceSkewer(steps, playerSide)) themes.add(THEMES.SKEWER);
	if (detectSequenceDeflection(steps, playerSide)) themes.add(THEMES.DEFLECTION);
	if (detectSequenceXRay(steps, playerSide)) themes.add(THEMES.X_RAY_ATTACK);
	if (detectSequenceCollinearMove(steps, playerSide)) themes.add(THEMES.COLLINEAR_MOVE);
	if (detectSequencePin(steps, playerSide)) themes.add(THEMES.PIN);
	if (detectSequenceTrappedPiece(steps, playerSide)) themes.add(THEMES.TRAPPED_PIECE);
	if (detectSequenceSelfInterference(steps, playerSide) || detectSequenceInterference(steps, playerSide)) themes.add(THEMES.INTERFERENCE);
	if (detectSequenceIntermezzo(steps, playerSide, mistake)) themes.add(THEMES.INTERMEZZO);
	if (detectSequenceAttraction(steps, playerSide)) themes.add(THEMES.ATTRACTION);
	if (detectSequenceClearance(steps, playerSide)) themes.add(THEMES.CLEARANCE);
	if (detectSequenceCapturingDefender(steps, playerSide)) themes.add(THEMES.CAPTURING_DEFENDER);
	if (!enginePvMode && detectSequenceQuietMove(steps, playerSide)) themes.add(THEMES.QUIET_MOVE);
	if (!enginePvMode && detectSequenceDefensiveMove(steps, playerSide)) themes.add(THEMES.DEFENSIVE_MOVE);
	if (detectSequenceSacrifice(steps, playerSide)) themes.add(THEMES.SACRIFICE);
	if (detectSequenceExposedKing(steps, playerSide)) themes.add(THEMES.EXPOSED_KING);
	if (detectSequenceSideAttack(steps, playerSide, "king")) themes.add(THEMES.KINGSIDE_ATTACK);
	else if (detectSequenceSideAttack(steps, playerSide, "queen")) themes.add(THEMES.QUEENSIDE_ATTACK);
	if (detectSequenceZugzwang(steps, playerSide)) themes.add(THEMES.ZUGZWANG);
	for (const step of steps) {
		if (step.side !== playerSide) continue;
		if (step.promotion) themes.add(THEMES.PROMOTION);
		if (step.promotion && step.promotion !== "q") themes.add(THEMES.UNDER_PROMOTION);
		if (step.isEp) themes.add(THEMES.EN_PASSANT);
		const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
		const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
		if (isCastling(step.movedPiece, fromIdx, toIdx)) themes.add(THEMES.CASTLING);
	}
	return themes;
}
/**
* Detect tactical themes for a mistake by walking the engine's best line.
*
* @param {object} mistake  { fen, side, best, bestLine?, deltaCp? }
* @returns {string[]}  Array of theme tags
*/
function detectThemes(mistake) {
	if (!mistake || !mistake.fen || !mistake.best) return [];
	const bestUci = normalizeBestMove(mistake);
	if (!bestUci) return [];
	const side = normalizeSide(mistake.side, mistake.fen);
	const opponent = side === "w" ? "b" : "w";
	const bestLine = Array.isArray(mistake.bestLine) && mistake.bestLine.length ? mistake.bestLine : null;
	if (bestLine) {
		const cappedLine = bestLine.slice(0, 20);
		const steps = walkPV(mistake.fen, cappedLine, side);
		if (!steps.length) return [];
		const sacrificePath = steps;
		const sacrificeIsMate = pvEndsMate(sacrificePath);
		const themes = /* @__PURE__ */ new Set();
		const isMate = pvEndsMate(steps);
		const playerSteps = steps.filter((s) => s.side === side);
		let hasDoubleCheck = false;
		let hasPinExploitation = false;
		let hasHangingPiece = false;
		let hasMaterialWinningHanging = false;
		const allowDeferredConcededTrap = !!mistake && typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string";
		for (let pi = 0; pi < playerSteps.length; pi++) {
			const step = playerSteps[pi];
			const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
			const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
			const isFirstMove = pi === 0;
			const isLastPlayerMove = pi === playerSteps.length - 1;
			try {
				if (detectFork(step.boardAfter, toIdx, step.movedPiece, opponent)) themes.add(THEMES.FORK);
			} catch {}
			try {
				const pinExploitation = detectPinExploitation(step.boardBefore, step.boardAfter, toIdx, side, opponent, step.fenAfter, {
					steps,
					stepIndex: steps.indexOf(step)
				});
				const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
				if (pinExploitation && !suppressPin) {
					themes.add(THEMES.PIN);
					hasPinExploitation = true;
				}
			} catch {}
			if (!isLastPlayerMove && step.capturedPiece && step.capturedPiece.toUpperCase() !== "P") try {
				if ((PIECE_VAL[step.capturedPiece] || 0) > (PIECE_VAL[step.movedPiece] || 0) && step.boardAfter.checkerCount(opponent) > 0 && step.boardAfter.isInBadSpot(toIdx)) {
					const nextPS = playerSteps[pi + 1];
					if (nextPS && nextPS.capturedPiece && nextPS.capturedPiece.toUpperCase() !== "P") themes.add(THEMES.FORK);
				}
			} catch {}
			if (isLastPlayerMove) try {
				const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
				if (detectPin(step.boardAfter, toIdx, side, opponent, step.boardBefore, fromIdx) && !suppressPin) themes.add(THEMES.PIN);
			} catch {}
			if (!isLastPlayerMove) try {
				const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
				if (detectFunctionalPin(steps, playerSteps, pi, side, opponent) && !suppressPin) themes.add(THEMES.PIN);
			} catch {}
			try {
				if (detectSkewer(step.boardAfter, toIdx, step.movedPiece, opponent)) themes.add(THEMES.SKEWER);
			} catch {}
			try {
				if (detectDiscoveredAttack(step.boardBefore, step.boardAfter, fromIdx, toIdx, side, step.isEp)) themes.add(THEMES.DISCOVERED_ATTACK);
			} catch {}
			try {
				if (detectDoubleCheck(step.boardAfter, opponent)) {
					themes.add(THEMES.DOUBLE_CHECK);
					hasDoubleCheck = true;
				}
			} catch {}
			if (isLastPlayerMove) try {
				if (detectBackRank(step.boardAfter, opponent)) themes.add(THEMES.BACK_RANK);
			} catch {}
			if (isFirstMove) try {
				if (!shouldSuppressExchangeRecaptureHanging(step, mistake, steps)) {
					const isFreeCapture = detectHangingPiece(step.boardBefore, step.capturedPiece, toIdx, step.movedPiece, step.boardAfter);
					const isMaterialWinning = detectMaterialWinningCapture(step);
					const isUnderdefendedWin = detectUnderdefendedWinningCapture(step);
					if (isFreeCapture || isMaterialWinning || isUnderdefendedWin) {
						themes.add(THEMES.HANGING_PIECE);
						hasHangingPiece = true;
						if (isMaterialWinning || isUnderdefendedWin) hasMaterialWinningHanging = true;
					}
				}
			} catch {}
			if (pi <= 1 || allowDeferredConcededTrap) try {
				const stepIndex = steps.indexOf(step);
				if (detectTrappedPiece(step.boardBefore, step.boardAfter, toIdx, opponent, step.fenAfter, step.fenBefore, {
					steps,
					stepIndex: Number.isInteger(stepIndex) ? stepIndex : -1
				})) themes.add(THEMES.TRAPPED_PIECE);
			} catch {}
			if (isFirstMove) {
				const suppressCustomThreat = shouldSuppressCustomThreatRecapture(step, side, steps);
				const suppressAupTrade = shouldSuppressAttackingUndefendedPieceOnImmediateTrade(steps, step, side);
				if (!suppressCustomThreat && !suppressAupTrade) try {
					if (detectAttackingUndefendedPiece(step.boardBefore, step.boardAfter, fromIdx, toIdx, opponent, step.movedPiece, step.capturedPiece, step.fenBefore, step.fenAfter)) themes.add(THEMES.ATTACKING_UNDEFENDED_PIECE);
				} catch {}
			}
			if (step.promotion) themes.add(THEMES.PROMOTION);
			if (step.isEp) themes.add(THEMES.EN_PASSANT);
			if (step.movedPiece && isCastling(step.movedPiece, fromIdx, toIdx)) themes.add(THEMES.CASTLING);
			if (step.promotion && step.promotion !== "q") themes.add(THEMES.UNDER_PROMOTION);
		}
		if (!themes.has(THEMES.BACK_RANK) && playerSteps.length > 0) try {
			if (detectBackRank(playerSteps[0].boardAfter, opponent)) themes.add(THEMES.BACK_RANK);
		} catch {}
		if (!hasHangingPiece) try {
			if (detectHungPiecePunishInPv(steps, side, mistake)) {
				themes.add(THEMES.HANGING_PIECE);
				hasHangingPiece = true;
			}
		} catch {}
		try {
			if (detectDeflection(steps, side)) themes.add(THEMES.DEFLECTION);
		} catch {}
		try {
			if (detectAttraction(steps, side)) themes.add(THEMES.ATTRACTION);
		} catch {}
		try {
			if (detectInterference(steps, side)) themes.add(THEMES.INTERFERENCE);
		} catch {}
		try {
			if (detectIntermezzo(steps, side)) themes.add(THEMES.INTERMEZZO);
		} catch {}
		try {
			if (detectMateThreat(steps, side)) themes.add(THEMES.MATE_THREAT);
		} catch {}
		try {
			if (detectClearance(steps, side)) themes.add(THEMES.CLEARANCE);
		} catch {}
		try {
			if (detectCapturingDefender(steps, side)) themes.add(THEMES.CAPTURING_DEFENDER);
		} catch {}
		try {
			if (detectDefensiveMoveInPV(steps, side, {
				deltaCp: mistake.deltaCp,
				previousFen: typeof mistake._prevFen === "string" ? mistake._prevFen : null,
				previousMove: typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null
			})) themes.add(THEMES.DEFENSIVE_MOVE);
		} catch {}
		if (hasDoubleCheck) themes.delete(THEMES.DISCOVERED_ATTACK);
		if (themes.has(THEMES.TRAPPED_PIECE)) themes.delete(THEMES.HANGING_PIECE);
		if (themes.has(THEMES.BACK_RANK)) themes.delete(THEMES.HANGING_PIECE);
		if (themes.has(THEMES.HANGING_PIECE) && themes.has(THEMES.DISCOVERED_ATTACK)) themes.delete(THEMES.DISCOVERED_ATTACK);
		if (themes.has(THEMES.CASTLING) && !hasPinExploitation) themes.delete(THEMES.PIN);
		if (themes.has(THEMES.DISCOVERED_ATTACK) && !hasPinExploitation) themes.delete(THEMES.PIN);
		if (themes.has(THEMES.FORK) && !hasPinExploitation) themes.delete(THEMES.PIN);
		if (themes.has(THEMES.HANGING_PIECE) && !hasPinExploitation) themes.delete(THEMES.PIN);
		try {
			if (detectSacrificeInPV(sacrificePath, side, sacrificeIsMate, { mistake })) {
				const STRUCTURAL_THEMES = new Set([
					THEMES.PROMOTION,
					THEMES.EN_PASSANT,
					THEMES.CASTLING,
					THEMES.UNDER_PROMOTION,
					THEMES.QUIET_MOVE
				]);
				const hasTacticalTheme = [...themes].some((t) => !STRUCTURAL_THEMES.has(t));
				if (sacrificeIsMate && hasTacticalTheme) {} else themes.add(THEMES.SACRIFICE);
			}
		} catch {}
		{
			let foundQuiet = false;
			if (playerSteps.length > 0) try {
				if (detectQuietMove(playerSteps[0])) foundQuiet = true;
			} catch {}
			if (!foundQuiet && themes.size === 0) for (let qi = 1; qi < playerSteps.length; qi++) try {
				if (detectQuietMove(playerSteps[qi])) {
					foundQuiet = true;
					break;
				}
			} catch {}
			if (foundQuiet) themes.add(THEMES.QUIET_MOVE);
		}
		if (isMate) {
			const MATE_PATTERN_THEMES = new Set([
				THEMES.BACK_RANK_MATE,
				THEMES.SMOTHERED_MATE,
				THEMES.ANASTASIA_MATE,
				THEMES.HOOK_MATE,
				THEMES.ARABIAN_MATE,
				THEMES.BODEN_MATE,
				THEMES.DOUBLE_BISHOP_MATE,
				THEMES.DOVETAIL_MATE,
				THEMES.BALESTRA_MATE,
				THEMES.BLIND_SWINE_MATE,
				THEMES.CORNER_MATE,
				THEMES.EPAULETTE_MATE,
				THEMES.KILL_BOX_MATE,
				THEMES.MORPHYS_MATE,
				THEMES.OPERA_MATE,
				THEMES.PILLSBURYS_MATE,
				THEMES.SWALLOWSTAIL_MATE,
				THEMES.TRIANGLE_MATE,
				THEMES.VUKOVIC_MATE
			]);
			const lastStep = steps[steps.length - 1];
			for (const pattern of MATE_PATTERN_THEMES) themes.delete(pattern);
			themes.delete(THEMES.BACK_RANK);
			try {
				for (const pattern of detectNamedMatePatterns(lastStep.fenAfter)) if (MATE_PATTERN_THEMES.has(pattern)) themes.add(pattern);
			} catch {}
			themes.add(THEMES.MATE);
			const numPlayerMoves = playerSteps.length;
			if (numPlayerMoves === 1) themes.add(THEMES.MATE_IN_1);
			else if (numPlayerMoves === 2) themes.add(THEMES.MATE_IN_2);
			else if (numPlayerMoves === 3) themes.add(THEMES.MATE_IN_3);
			else if (numPlayerMoves === 4) themes.add(THEMES.MATE_IN_4);
			else if (numPlayerMoves >= 5) themes.add(THEMES.MATE_IN_5);
			if ([...themes].filter((t) => t !== THEMES.MATE && !t.startsWith("mateIn") && t !== THEMES.CHECK && !MATE_PATTERN_THEMES.has(t)).length === 0) themes.add(THEMES.CHECK);
		}
		const sequenceAligned = collectSequenceAlignedThemes(steps, side, mistake);
		const sequenceOwnedThemes = new Set([
			THEMES.ADVANCED_PAWN,
			THEMES.ATTACKING_F2F7,
			THEMES.DISCOVERED_ATTACK,
			THEMES.DISCOVERED_CHECK,
			THEMES.FORK,
			THEMES.PIN,
			THEMES.HANGING_PIECE,
			THEMES.TRAPPED_PIECE,
			THEMES.SKEWER,
			THEMES.SACRIFICE,
			THEMES.ATTRACTION,
			THEMES.DEFLECTION,
			THEMES.INTERFERENCE,
			THEMES.INTERMEZZO,
			THEMES.CLEARANCE,
			THEMES.X_RAY_ATTACK,
			THEMES.COLLINEAR_MOVE,
			THEMES.CAPTURING_DEFENDER,
			THEMES.QUIET_MOVE,
			THEMES.DEFENSIVE_MOVE,
			THEMES.EXPOSED_KING,
			THEMES.KINGSIDE_ATTACK,
			THEMES.QUEENSIDE_ATTACK,
			THEMES.ZUGZWANG,
			THEMES.PROMOTION,
			THEMES.UNDER_PROMOTION,
			THEMES.EN_PASSANT,
			THEMES.CASTLING
		]);
		for (const theme of sequenceOwnedThemes) themes.delete(theme);
		for (const theme of sequenceAligned) themes.add(theme);
		if (!isMate) {
			themes.delete(THEMES.BACK_RANK);
			themes.delete(THEMES.BACK_RANK_MATE);
		}
		if (themes.has(THEMES.BACK_RANK_MATE) || themes.has(THEMES.FORK)) {
			themes.delete(THEMES.KINGSIDE_ATTACK);
			themes.delete(THEMES.QUEENSIDE_ATTACK);
		}
		try {
			const egType = detectEndgameType(mistake.fen);
			if (egType === THEMES.PAWN_ENDGAME) themes.add(egType);
		} catch {}
		const deltaCp = typeof mistake.deltaCp === "number" ? Math.abs(mistake.deltaCp) : null;
		if (deltaCp !== null && deltaCp < 100 && !isMate) {
			const TACTICAL_THEMES = new Set([
				THEMES.FORK,
				THEMES.PIN,
				THEMES.SKEWER,
				THEMES.DISCOVERED_ATTACK,
				THEMES.DOUBLE_CHECK,
				THEMES.HANGING_PIECE,
				THEMES.TRAPPED_PIECE,
				THEMES.SACRIFICE,
				THEMES.BACK_RANK,
				THEMES.DEFLECTION,
				THEMES.ATTRACTION,
				THEMES.INTERFERENCE,
				THEMES.INTERMEZZO,
				THEMES.CLEARANCE,
				THEMES.CAPTURING_DEFENDER,
				THEMES.MATE_THREAT
			]);
			for (const t of TACTICAL_THEMES) {
				if (t === THEMES.HANGING_PIECE && hasMaterialWinningHanging) continue;
				themes.delete(t);
			}
		}
		return filterToTactical(themes);
	}
	const boardBefore = ChessPrimitives(mistake.fen);
	const cl = ChessLite();
	cl.loadFEN(mistake.fen);
	const mv = cl.moveUci(bestUci);
	if (!mv || !mv.ok) return [];
	const fenAfter = cl.fen();
	const boardAfter = ChessPrimitives(fenAfter);
	const fromIdx = boardBefore.sqToIdx(bestUci.slice(0, 2));
	const toIdx = boardBefore.sqToIdx(bestUci.slice(2, 4));
	const movedPiece = boardBefore.pieceAt(fromIdx);
	const capturedPc = boardBefore.pieceAt(toIdx);
	const themes = [];
	try {
		if (detectFork(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.FORK);
	} catch {}
	try {
		if (detectBackRank(boardAfter, opponent)) themes.push(THEMES.BACK_RANK);
	} catch {}
	try {
		if (detectDoubleCheck(boardAfter, opponent)) themes.push(THEMES.DOUBLE_CHECK);
	} catch {}
	try {
		const legacyStep = {
			uci: bestUci,
			fenBefore: mistake.fen,
			fenAfter,
			movedPiece,
			capturedPiece: capturedPc,
			side,
			boardBefore,
			boardAfter
		};
		if (!shouldSuppressExchangeRecaptureHanging(legacyStep, mistake, null) && (detectHangingPiece(boardBefore, capturedPc, toIdx, movedPiece, boardAfter) || detectMaterialWinningCapture(legacyStep) || detectUnderdefendedWinningCapture(legacyStep))) themes.push(THEMES.HANGING_PIECE);
	} catch {}
	if (isCheckmate(fenAfter)) {
		themes.push(THEMES.MATE);
		themes.push(THEMES.MATE_IN_1);
		if (!themes.some((t) => t !== THEMES.MATE && t !== THEMES.MATE_IN_1)) themes.push(THEMES.CHECK);
	}
	if (!capturedPc && movedPiece && movedPiece.toUpperCase() !== "K" && !positionInCheck(fenAfter)) themes.push(THEMES.QUIET_MOVE);
	return filterToTactical(themes);
}
Object.freeze({
	[THEMES.MATE_IN_1]: 245,
	[THEMES.MATE_IN_2]: 235,
	[THEMES.MATE_IN_3]: 228,
	[THEMES.MATE_IN_4]: 220,
	[THEMES.MATE_IN_5]: 212,
	[THEMES.MATE_THREAT]: 132,
	[THEMES.MATE]: 205,
	[THEMES.SMOTHERED_MATE]: 200,
	[THEMES.ANASTASIA_MATE]: 198,
	[THEMES.HOOK_MATE]: 196,
	[THEMES.ARABIAN_MATE]: 194,
	[THEMES.BODEN_MATE]: 194,
	[THEMES.DOUBLE_BISHOP_MATE]: 194,
	[THEMES.DOVETAIL_MATE]: 194,
	[THEMES.DOUBLE_CHECK]: 184,
	[THEMES.FORK]: 214,
	[THEMES.SKEWER]: 202,
	[THEMES.PIN]: 146,
	[THEMES.DISCOVERED_ATTACK]: 198,
	[THEMES.BACK_RANK]: 166,
	[THEMES.DEFLECTION]: 170,
	[THEMES.ATTRACTION]: 172,
	[THEMES.INTERFERENCE]: 145,
	[THEMES.INTERMEZZO]: 145,
	[THEMES.CLEARANCE]: 178,
	[THEMES.CAPTURING_DEFENDER]: 212,
	[THEMES.TRAPPED_PIECE]: 190,
	[THEMES.HANGING_PIECE]: 186,
	[THEMES.SACRIFICE]: 176,
	[THEMES.DEFENSIVE_MOVE]: 145,
	[THEMES.ATTACKING_UNDEFENDED_PIECE]: 142,
	[THEMES.CHECK]: 88,
	[THEMES.CAPTURE]: 66,
	[THEMES.QUIET_MOVE]: 44
});
new Set([
	THEMES.HANGING_PIECE,
	THEMES.TRAPPED_PIECE,
	THEMES.ATTACKING_UNDEFENDED_PIECE,
	THEMES.PIN
]);
Object.freeze([
	"opening",
	"middlegame",
	"endgame"
]);
function countPlayerPlyAtIndex(steps, idx, playerSide) {
	if (!Array.isArray(steps) || idx < 0) return Number.MAX_SAFE_INTEGER;
	let ply = 0;
	for (let i = 0; i <= idx && i < steps.length; i++) if (normalizeSide(steps[i]?.side, steps[i]?.fenBefore) === playerSide) ply += 1;
	return ply || Number.MAX_SAFE_INTEGER;
}
/**
* Enhanced theme detection returning step-level diagnostic data.
*/
function detectThemesDetailed(mistake) {
	const empty = {
		themes: [],
		steps: [],
		themeStepIndex: -1,
		themeStepIndexByTheme: {},
		themeUci: null,
		payoffIndex: -1,
		isMate: false,
		sacrificeStepIndex: -1,
		previousFen: null,
		previousMove: null
	};
	if (!mistake || !mistake.fen || !mistake.best) return empty;
	const bestUci = normalizeBestMove(mistake);
	if (!bestUci) return empty;
	const side = normalizeSide(mistake.side, mistake.fen);
	const bestLine = Array.isArray(mistake.bestLine) && mistake.bestLine.length ? mistake.bestLine : null;
	if (bestLine) {
		const cappedLine = bestLine.slice(0, 20);
		const steps = walkPV(mistake.fen, cappedLine, side);
		if (!steps.length) return empty;
		if (typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string") try {
			steps[0]._prevFen = mistake._prevFen;
			steps[0]._prevPlayedMove = mistake._prevPlayedMove;
		} catch {}
		const sacrificePath = steps;
		const themes = detectThemes(mistake);
		const isMate = pvEndsMate(steps);
		const payoff = findPayoffStep(steps);
		const payoffIndex = payoff ? steps.indexOf(payoff) : -1;
		const sacrificeInfo = detectSacrificeInPVDetails(sacrificePath, side, pvEndsMate(sacrificePath), { mistake });
		const sacrificeStepIndex = sacrificeInfo.isSacrifice && Number.isInteger(sacrificeInfo.triggerStepIndex) && sacrificeInfo.triggerStepIndex >= 0 && sacrificeInfo.triggerStepIndex < steps.length ? sacrificeInfo.triggerStepIndex : -1;
		let themeStepIndex = -1;
		if (isMate) themeStepIndex = steps.length - 1;
		else if (payoffIndex >= 0) {
			themeStepIndex = payoffIndex;
			if (payoffIndex > 0 && steps[payoffIndex - 1].side === side) {
				if (detectTacticsAtStep(steps[payoffIndex - 1], side, {
					steps,
					previousFen: typeof mistake._prevFen === "string" ? mistake._prevFen : null,
					previousMove: typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null
				}).length > 0) themeStepIndex = payoffIndex - 1;
			}
		} else {
			for (let i = 0; i < steps.length; i++) {
				if (steps[i].side !== side) continue;
				if (detectTacticsAtStep(steps[i], side, {
					steps,
					previousFen: typeof mistake._prevFen === "string" ? mistake._prevFen : null,
					previousMove: typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null
				}).length > 0) {
					themeStepIndex = i;
					break;
				}
			}
			if (themeStepIndex < 0) themeStepIndex = 0;
		}
		if (Array.isArray(themes) && themes.includes(THEMES.DEFLECTION)) {
			const deflectionIdx = findDeflectionAnchorIndex(steps, side);
			if (deflectionIdx >= 0) themeStepIndex = deflectionIdx;
		}
		const themeStepIndexByTheme = {};
		const anchor = Number.isInteger(themeStepIndex) && themeStepIndex >= 0 && themeStepIndex < steps.length ? themeStepIndex : 0;
		const priorFen = typeof mistake._prevFen === "string" ? mistake._prevFen : null;
		const priorMove = typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null;
		const stepThemeCache = /* @__PURE__ */ new Map();
		const getStepThemes = (idx) => {
			if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) return [];
			if (stepThemeCache.has(idx)) return stepThemeCache.get(idx);
			let tactical = [];
			try {
				const step = steps[idx];
				tactical = filterToTactical(detectTacticsAtStep(step, normalizeSide(step?.side, step?.fenBefore) || side, {
					steps,
					previousFen: priorFen,
					previousMove: priorMove
				}) || []);
			} catch {}
			stepThemeCache.set(idx, tactical);
			return tactical;
		};
		if (Array.isArray(themes) && themes.length) {
			const ordered = [];
			for (let i = anchor; i < steps.length; i++) ordered.push(i);
			for (let i = 0; i < anchor; i++) ordered.push(i);
			for (const theme of themes) {
				let idx = -1;
				if (theme === THEMES.MATE_THREAT) idx = findMateThreatStepIndex(steps, side);
				else if (theme === THEMES.CAPTURING_DEFENDER) idx = findCapturingDefenderAnchorIndex(steps, side);
				else if (theme === THEMES.SACRIFICE && Number.isInteger(sacrificeStepIndex) && sacrificeStepIndex >= 0 && sacrificeStepIndex < steps.length) idx = sacrificeStepIndex;
				else for (const stepIdx of ordered) {
					if (normalizeSide(steps[stepIdx]?.side, steps[stepIdx]?.fenBefore) !== side) continue;
					if (getStepThemes(stepIdx).includes(theme)) {
						idx = stepIdx;
						break;
					}
				}
				if (Number.isInteger(idx) && idx >= 0 && idx < steps.length) themeStepIndexByTheme[theme] = idx;
			}
		}
		return {
			themes,
			steps,
			themeStepIndex,
			themeStepIndexByTheme,
			themeUci: steps[themeStepIndex]?.uci || null,
			payoffIndex,
			isMate,
			sacrificeStepIndex,
			previousFen: typeof mistake._prevFen === "string" ? mistake._prevFen : null,
			previousMove: typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null
		};
	}
	const boardBefore = ChessPrimitives(mistake.fen);
	const cl = ChessLite();
	cl.loadFEN(mistake.fen);
	const mv = cl.moveUci(bestUci);
	if (!mv || !mv.ok) return empty;
	const fenAfter = cl.fen();
	const boardAfter = ChessPrimitives(fenAfter);
	const fromIdx = boardBefore.sqToIdx(bestUci.slice(0, 2));
	const toIdx = boardBefore.sqToIdx(bestUci.slice(2, 4));
	const movedPiece = boardBefore.pieceAt(fromIdx);
	const capturedPc = boardBefore.pieceAt(toIdx);
	const themes = detectThemes(mistake);
	const legacyStep = {
		uci: bestUci,
		fenBefore: mistake.fen,
		fenAfter,
		movedPiece,
		capturedPiece: capturedPc,
		materialDelta: 0,
		cumulativeDelta: 0,
		side,
		boardBefore,
		boardAfter
	};
	if (typeof mistake._prevFen === "string" && typeof mistake._prevPlayedMove === "string") {
		legacyStep._prevFen = mistake._prevFen;
		legacyStep._prevPlayedMove = mistake._prevPlayedMove;
	}
	const legacyThemeMap = {};
	if (Array.isArray(themes)) for (const t of themes) legacyThemeMap[t] = 0;
	return {
		themes,
		steps: [legacyStep],
		themeStepIndex: themes.length ? 0 : -1,
		themeStepIndexByTheme: legacyThemeMap,
		themeUci: themes.length ? bestUci : null,
		payoffIndex: -1,
		isMate: false,
		sacrificeStepIndex: -1,
		previousFen: typeof mistake._prevFen === "string" ? mistake._prevFen : null,
		previousMove: typeof mistake._prevPlayedMove === "string" ? mistake._prevPlayedMove : null
	};
}
/**
* Enhanced allowed-theme detection with step-level data.
*/
function detectAllowedThemesDetailed(fenAfterBadMove, refutationPV, opponentSide, options = null) {
	const empty = {
		themes: [],
		steps: [],
		themeStepIndex: -1,
		themeStepIndexByTheme: {},
		themeUci: null,
		payoffIndex: -1,
		isMate: false,
		sacrificeStepIndex: -1,
		previousFen: null,
		previousMove: null
	};
	if (!fenAfterBadMove || !Array.isArray(refutationPV) || !refutationPV.length || !opponentSide) return empty;
	const deltaCp = typeof options === "number" ? options : options && typeof options.deltaCp === "number" ? options.deltaCp : null;
	const prevFen = options && typeof options === "object" && typeof options.previousFen === "string" ? options.previousFen : null;
	const prevPlayedMove = options && typeof options === "object" && typeof options.playedMove === "string" ? options.playedMove : null;
	const cpBefore = options && typeof options === "object" && typeof options.cpBefore === "number" ? options.cpBefore : null;
	const cpAfter = options && typeof options === "object" && typeof options.cpAfter === "number" ? options.cpAfter : null;
	const sacrificeIntentCp = options && typeof options === "object" && typeof options._sacrificeIntentCp === "number" ? options._sacrificeIntentCp : null;
	const syntheticMistake = {
		fen: fenAfterBadMove,
		side: normalizeSide(opponentSide, fenAfterBadMove),
		best: refutationPV[0],
		bestLine: refutationPV,
		deltaCp,
		_prevFen: prevFen,
		_prevPlayedMove: prevPlayedMove
	};
	if (cpBefore !== null) syntheticMistake.cpBefore = cpBefore;
	if (cpAfter !== null) syntheticMistake.cpAfter = cpAfter;
	if (sacrificeIntentCp !== null) syntheticMistake._sacrificeIntentCp = sacrificeIntentCp;
	return detectThemesDetailed(syntheticMistake);
}
//#endregion
//#region src/utils/tacticalMotifs/mistakeReviewAdapter.ts
var detectAllowedThemesDetailedWithOptions = detectAllowedThemesDetailed;
var TACTICAL_MOTIF_ADAPTER_VERSION = 2;
var MOTIF_CACHE_LIMIT = 2500;
var motifCache = /* @__PURE__ */ new Map();
var MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION = `site-55.adapter-${TACTICAL_MOTIF_ADAPTER_VERSION}`;
var MATE_MOTIF_PATTERN = /(?:^mate(?:In\d+|Threat)?$|Mate$)/;
function cleanUci(value) {
	const move = String(value ?? "").trim().toLowerCase();
	return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : null;
}
function cleanUciLine(values) {
	return (Array.isArray(values) ? values : []).map((value) => cleanUci(value)).filter((value) => Boolean(value));
}
function normalizeLine(firstMove, lineInput) {
	const line = cleanUciLine(lineInput);
	if (!firstMove) return line;
	return line[0] === firstMove ? line : [firstMove, ...line];
}
function fenSide(fen) {
	return String(fen ?? "").trim().split(/\s+/)[1] === "b" ? "b" : "w";
}
function deriveFenAfterMove(fen, moveInput) {
	const move = cleanUci(moveInput);
	if (!fen || !move) return null;
	try {
		const chess = ChessLite();
		chess.loadFEN(fen);
		return chess.moveUci(move)?.ok ? chess.fen() : null;
	} catch {
		return null;
	}
}
function normalizeThemeIds(value) {
	const labels = THEME_LABELS;
	const seen = /* @__PURE__ */ new Set();
	const themes = [];
	for (const candidate of Array.isArray(value) ? value : []) {
		const id = String(candidate ?? "").trim();
		if (!id || seen.has(id) || !labels[id]) continue;
		seen.add(id);
		themes.push(id);
	}
	return themes;
}
function motifConfidence(detail, motifId, stepIndex) {
	if (detail.isMate && MATE_MOTIF_PATTERN.test(motifId)) return "high";
	if (stepIndex >= 0 && detail.steps?.[stepIndex]?.uci) return "high";
	if (Array.isArray(detail.steps) && detail.steps.length > 0) return "medium";
	return "low";
}
var PIECE_NAMES = {
	p: "pawn",
	n: "knight",
	b: "bishop",
	r: "rook",
	q: "queen",
	k: "king"
};
function pieceName(piece) {
	return PIECE_NAMES[String(piece ?? "").toLowerCase()] ?? "piece";
}
function numberWord(value) {
	if (value === 0) return "no times";
	if (value === 1) return "once";
	if (value === 2) return "twice";
	return `${value} times`;
}
function joinTargetFacts(targets) {
	const labels = targets.map((target) => `${target.piece} on ${target.square}`);
	if (labels.length <= 1) return labels[0] ?? "two targets";
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
	return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
function stepBoard(step, after) {
	const fen = String(after ? step?.fenAfter ?? "" : step?.fenBefore ?? "").trim();
	if (!fen) return null;
	try {
		return ChessPrimitives(fen);
	} catch {
		return null;
	}
}
function forkTargets(step) {
	const move = cleanUci(step?.uci);
	const board = stepBoard(step, true);
	const side = step?.side === "b" ? "b" : "w";
	if (!move || !board) return [];
	const targetSquare = move.slice(2, 4);
	const attackerIndex = board.sqToIdx(targetSquare);
	const attacker = board.pieceAt(attackerIndex);
	if (!attacker || board.colorOf(attacker) !== side) return [];
	const opponent = side === "w" ? "b" : "w";
	const attackerValue = board.pieceValue(attacker);
	return board.attacks(attackerIndex).map((index) => {
		const target = board.pieceAt(index);
		if (!target || board.colorOf(target) !== opponent) return null;
		const type = String(target).toUpperCase();
		if (type === "P") return null;
		const value = type === "K" ? 100 : board.pieceValue(target);
		if (type !== "K" && value <= attackerValue && !board.isHanging(index)) return null;
		return {
			square: board.idxToSq(index),
			piece: pieceName(target),
			value
		};
	}).filter((target) => Boolean(target)).sort((left, right) => right.value - left.value || left.square.localeCompare(right.square));
}
function findEvidenceStepIndex(detail, motifId, fallbackIndex) {
	const steps = Array.isArray(detail.steps) ? detail.steps : [];
	if (motifId === "fork") {
		const forkIndex = steps.findIndex((step) => forkTargets(step).length >= 2);
		if (forkIndex >= 0) return forkIndex;
	}
	if (motifId === "attackingF2F7") {
		const weakSquareIndex = steps.findIndex((step) => {
			const destination = cleanUci(step?.uci)?.slice(2, 4);
			return destination === "f2" || destination === "f7";
		});
		if (weakSquareIndex >= 0) return weakSquareIndex;
	}
	return fallbackIndex;
}
function moveDisplay(moveUci, sanLine, stepIndex) {
	return String(sanLine[stepIndex] ?? "").trim() || moveUci || "The tactical move";
}
function protectedFromKingCaptureFact(step) {
	const move = cleanUci(step?.uci);
	const board = stepBoard(step, true);
	const side = step?.side === "b" ? "b" : "w";
	if (!move || !board) return null;
	const targetSquare = move.slice(2, 4);
	const targetIndex = board.sqToIdx(targetSquare);
	const opponent = side === "w" ? "b" : "w";
	if (!board.attackers(opponent, targetIndex).some((index) => String(board.pieceAt(index) ?? "").toUpperCase() === "K")) return null;
	const supporterIndex = board.attackers(side, targetIndex).find((index) => {
		const supporter = board.pieceAt(index);
		return supporter && board.colorOf(supporter) === side;
	});
	if (!Number.isInteger(supporterIndex)) return null;
	return {
		supporter: pieceName(board.pieceAt(supporterIndex)),
		supporterSquare: board.idxToSq(supporterIndex),
		movedPiece: pieceName(step?.movedPiece),
		targetSquare
	};
}
function forkEvidence(detail, stepIndex, sanLine) {
	const steps = Array.isArray(detail.steps) ? detail.steps : [];
	const step = steps[stepIndex];
	const moveUci = cleanUci(step?.uci);
	const targets = forkTargets(step);
	if (!moveUci || targets.length < 2) return null;
	let evidence = `${moveDisplay(moveUci, sanLine, stepIndex)} forks the ${joinTargetFacts(targets.slice(0, 3))}.`;
	const protection = protectedFromKingCaptureFact(step);
	if (protection) evidence += ` The ${protection.supporter} on ${protection.supporterSquare} protects ${protection.targetSquare}, so the king cannot capture the ${protection.movedPiece}.`;
	let attackerSquare = moveUci.slice(2, 4);
	let payoffIndex = -1;
	for (let index = stepIndex + 1; index < steps.length; index += 1) {
		const candidate = steps[index];
		const candidateMove = cleanUci(candidate?.uci);
		if (!candidateMove) continue;
		if (candidate.side !== step?.side) {
			if (candidateMove.slice(2, 4) === attackerSquare && candidate.capturedPiece) break;
			continue;
		}
		if (candidateMove.slice(0, 2) !== attackerSquare) continue;
		attackerSquare = candidateMove.slice(2, 4);
		if (candidate.capturedPiece) {
			payoffIndex = index;
			break;
		}
	}
	if (payoffIndex >= 0) {
		const payoff = steps[payoffIndex];
		const payoffMove = cleanUci(payoff.uci);
		evidence += ` The line continues with ${moveDisplay(payoffMove, sanLine, payoffIndex)}, winning the ${pieceName(payoff.capturedPiece)}.`;
	}
	return evidence;
}
function weakF2F7Evidence(detail, stepIndex, sanLine) {
	const step = detail.steps?.[stepIndex];
	const moveUci = cleanUci(step?.uci);
	const boardBefore = stepBoard(step, false);
	const boardAfter = stepBoard(step, true);
	const side = step?.side === "b" ? "b" : "w";
	if (!moveUci || !boardBefore || !boardAfter) return null;
	const square = moveUci.slice(2, 4);
	if (square !== "f2" && square !== "f7") return null;
	const squareIndex = boardBefore.sqToIdx(square);
	const opponent = side === "w" ? "b" : "w";
	const attackerCount = boardBefore.attackers(side, squareIndex).length;
	const defenderCount = boardBefore.attackers(opponent, squareIndex).length;
	const display = moveDisplay(moveUci, sanLine, stepIndex);
	let givesCheck = false;
	try {
		const chess = ChessLite();
		chess.loadFEN(String(step?.fenAfter ?? ""));
		givesCheck = Boolean(chess.inCheck(opponent));
	} catch {
		givesCheck = false;
	}
	let evidence = `${display} exploits ${square}, which is attacked ${numberWord(attackerCount)} and defended ${numberWord(defenderCount)}`;
	evidence += givesCheck ? ", and gives check." : ".";
	const protection = protectedFromKingCaptureFact(step);
	if (protection) evidence += ` The ${protection.supporter} on ${protection.supporterSquare} protects the ${protection.movedPiece}, so the king cannot recapture.`;
	return evidence;
}
function loosePieceEvidence(detail, stepIndex, sanLine) {
	const steps = Array.isArray(detail.steps) ? detail.steps : [];
	const capture = steps[stepIndex];
	if (!capture?.capturedPiece) return null;
	const actualIndex = steps.indexOf(capture);
	const moveUci = cleanUci(capture.uci);
	if (!moveUci) return null;
	return `${moveDisplay(moveUci, sanLine, actualIndex)} wins the loose ${pieceName(capture.capturedPiece)} on ${moveUci.slice(2, 4)}.`;
}
function rayTacticFact(step, kind) {
	const board = stepBoard(step, true);
	const side = step?.side === "b" ? "b" : "w";
	if (!board) return null;
	const opponent = side === "w" ? "b" : "w";
	const moveTarget = cleanUci(step?.uci)?.slice(2, 4);
	const candidateIndices = Array.from({ length: 64 }, (_, index) => index).sort((a, b) => {
		if (!moveTarget) return a - b;
		const targetIndex = board.sqToIdx(moveTarget);
		return Number(b === targetIndex) - Number(a === targetIndex) || a - b;
	});
	for (const pinnerIndex of candidateIndices) {
		const pinner = board.pieceAt(pinnerIndex);
		if (!pinner || board.colorOf(pinner) !== side) continue;
		const pinnerType = String(pinner).toUpperCase();
		if (!/[BRQ]/.test(pinnerType)) continue;
		const directions = [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
			[-1, -1],
			[-1, 1],
			[1, -1],
			[1, 1]
		].filter(([row, column]) => pinnerType === "Q" || (pinnerType === "R" ? row === 0 || column === 0 : row !== 0 && column !== 0));
		const row = Math.floor(pinnerIndex / 8);
		const column = pinnerIndex % 8;
		for (const [rowStep, columnStep] of directions) {
			const blockers = [];
			let nextRow = row + rowStep;
			let nextColumn = column + columnStep;
			while (nextRow >= 0 && nextRow < 8 && nextColumn >= 0 && nextColumn < 8) {
				const index = nextRow * 8 + nextColumn;
				if (board.pieceAt(index)) {
					blockers.push(index);
					if (blockers.length === 2) break;
				}
				nextRow += rowStep;
				nextColumn += columnStep;
			}
			if (blockers.length < 2) continue;
			const front = board.pieceAt(blockers[0]);
			const rear = board.pieceAt(blockers[1]);
			if (!front || !rear || board.colorOf(front) !== opponent || board.colorOf(rear) !== opponent) continue;
			const frontValue = String(front).toUpperCase() === "K" ? 100 : board.pieceValue(front);
			const rearValue = String(rear).toUpperCase() === "K" ? 100 : board.pieceValue(rear);
			if (!(kind === "pin" ? rearValue > frontValue : frontValue > rearValue)) continue;
			return {
				pinner: pieceName(pinner),
				pinnerSquare: board.idxToSq(pinnerIndex),
				front: pieceName(front),
				frontSquare: board.idxToSq(blockers[0]),
				rear: pieceName(rear),
				rearSquare: board.idxToSq(blockers[1])
			};
		}
	}
	return null;
}
function rayTacticEvidence(detail, stepIndex, sanLine, kind) {
	const step = detail.steps?.[stepIndex];
	const fact = rayTacticFact(step, kind);
	const moveUci = cleanUci(step?.uci);
	if (!fact || !moveUci) return null;
	const display = moveDisplay(moveUci, sanLine, stepIndex);
	return kind === "pin" ? `${display} lets the ${fact.pinner} on ${fact.pinnerSquare} pin the ${fact.front} on ${fact.frontSquare} to the ${fact.rear} on ${fact.rearSquare}.` : `${display} lets the ${fact.pinner} on ${fact.pinnerSquare} skewer the ${fact.front} on ${fact.frontSquare}, exposing the ${fact.rear} on ${fact.rearSquare}.`;
}
function motifEvidence(detail, motifId, stepIndex, source, sanLine) {
	if (motifId === "fork") {
		const evidence = forkEvidence(detail, stepIndex, sanLine);
		if (evidence) return evidence;
	}
	if (motifId === "attackingF2F7") {
		const evidence = weakF2F7Evidence(detail, stepIndex, sanLine);
		if (evidence) return evidence;
	}
	if (motifId === "hangingPiece" || motifId === "attacking_undefended_piece") {
		const evidence = loosePieceEvidence(detail, stepIndex, sanLine);
		if (evidence) return evidence;
	}
	if (motifId === "pin" || motifId === "skewer") {
		const evidence = rayTacticEvidence(detail, stepIndex, sanLine, motifId);
		if (evidence) return evidence;
	}
	const moveUci = stepIndex >= 0 ? cleanUci(detail.steps?.[stepIndex]?.uci) : null;
	const label = tacticalMotifLabel(motifId);
	const lineLabel = source === "allowed" ? "opponent refutation" : source === "available" ? "current best line" : "missed best line";
	return moveUci ? `${label} appears on ${moveDisplay(moveUci, sanLine, stepIndex)} at ply ${stepIndex + 1} of the ${lineLabel}.` : `${label} is detected in the verified ${lineLabel}.`;
}
function toMotifEvidence(detailInput, source, sanLineInput) {
	const detail = detailInput && typeof detailInput === "object" ? detailInput : {};
	const steps = Array.isArray(detail.steps) ? detail.steps : [];
	const themeStepIndexByTheme = detail.themeStepIndexByTheme && typeof detail.themeStepIndexByTheme === "object" ? detail.themeStepIndexByTheme : {};
	const fallbackIndex = Number.isInteger(detail.themeStepIndex) ? Number(detail.themeStepIndex) : -1;
	const sanLine = Array.isArray(sanLineInput) ? sanLineInput : [];
	return normalizeThemeIds(detail.themes).map((id) => {
		const mappedIndex = themeStepIndexByTheme[id];
		const stepIndex = findEvidenceStepIndex(detail, id, Number.isInteger(mappedIndex) ? mappedIndex : fallbackIndex);
		const moveUci = stepIndex >= 0 ? cleanUci(steps[stepIndex]?.uci) : null;
		const weakSquare = id === "attackingF2F7" ? moveUci?.slice(2, 4) : null;
		const label = weakSquare === "f2" || weakSquare === "f7" ? `Weak ${weakSquare}` : tacticalMotifLabel(id);
		const evidence = motifEvidence(detail, id, stepIndex, source, sanLine);
		return {
			id,
			label,
			confidence: motifConfidence(detail, id, stepIndex),
			evidence,
			source,
			ply: stepIndex >= 0 ? stepIndex + 1 : null,
			moveUci
		};
	});
}
var IMPORTANT_TACTICAL_THEME_IDS = new Set([
	"fork",
	"pin",
	"skewer",
	"discoveredAttack",
	"discoveredCheck",
	"doubleCheck",
	"hangingPiece",
	"trappedPiece",
	"sacrifice",
	"backRank",
	"backRankMate",
	"promotion",
	"underPromotion",
	"mateThreat",
	"deflection",
	"attraction",
	"interference",
	"selfInterference",
	"intermezzo",
	"clearance",
	"xRayAttack",
	"zugzwang",
	"capturingDefender",
	"attacking_undefended_piece",
	"attackingF2F7"
]);
var MOTIF_IMPORTANCE = {
	backRankMate: 1,
	doubleCheck: 5,
	fork: 10,
	skewer: 11,
	pin: 12,
	deflection: 14,
	interference: 15,
	selfInterference: 16,
	attraction: 17,
	capturingDefender: 18,
	discoveredCheck: 19,
	discoveredAttack: 20,
	hangingPiece: 22,
	attacking_undefended_piece: 23,
	attackingF2F7: 25,
	intermezzo: 27,
	sacrifice: 29,
	trappedPiece: 31,
	xRayAttack: 32,
	mateThreat: 34,
	backRank: 35,
	promotion: 36,
	underPromotion: 37,
	zugzwang: 38,
	clearance: 45
};
function motifImportance(id) {
	if (id !== "backRankMate" && /Mate$/.test(id)) return 0;
	if (/^mateIn\d+$/.test(id)) return 2;
	if (id === "mate") return 3;
	return MOTIF_IMPORTANCE[id] ?? 100;
}
function isImportantTacticalTheme(id) {
	return IMPORTANT_TACTICAL_THEME_IDS.has(id) || MATE_MOTIF_PATTERN.test(id);
}
function selectImportantTacticalMotifs(motifs, limit = 3) {
	const unique = /* @__PURE__ */ new Map();
	for (const motif of motifs) {
		if (!isImportantTacticalTheme(motif.id) || unique.has(motif.id)) continue;
		unique.set(motif.id, motif);
	}
	const fork = unique.get("fork");
	if (fork) for (const redundantId of ["clearance", "trappedPiece"]) {
		const redundant = unique.get(redundantId);
		if (redundant && redundant.moveUci === fork.moveUci) unique.delete(redundantId);
	}
	const hasNamedMate = [...unique.keys()].some((id) => id !== "backRankMate" && /Mate$/.test(id));
	const hasMateDistance = [...unique.keys()].some((id) => /^mateIn\d+$/.test(id));
	if (hasNamedMate || hasMateDistance) unique.delete("mate");
	if (unique.has("backRankMate")) unique.delete("backRank");
	return [...unique.values()].sort((left, right) => motifImportance(left.id) - motifImportance(right.id) || (left.ply ?? Number.MAX_SAFE_INTEGER) - (right.ply ?? Number.MAX_SAFE_INTEGER) || left.label.localeCompare(right.label)).slice(0, Math.max(0, limit));
}
function cacheKey(input) {
	return JSON.stringify([
		MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
		input.fen ?? "",
		input.bestMoveUci ?? input.bestMoveSan ?? "",
		input.playedMoveUci ?? input.playedMoveSan ?? "",
		cleanUciLine(input.pvUci).join(" "),
		(input.pvSan ?? []).map((move) => String(move).trim()).join(" "),
		cleanUciLine(input.refutationUci).join(" "),
		(input.refutationSan ?? []).map((move) => String(move).trim()).join(" "),
		input.cpLoss ?? null,
		input.cpBefore ?? null,
		input.cpAfter ?? null
	]);
}
function classifyMistakeReviewMotifs(input) {
	const key = cacheKey(input);
	const cached = motifCache.get(key);
	if (cached) return cached;
	const fen = String(input.fen ?? "").trim();
	const bestMoveUci = cleanUci(input.bestMoveUci) ?? cleanUci(input.pvUci?.[0]);
	const playedMoveUci = cleanUci(input.playedMoveUci);
	const bestLine = normalizeLine(bestMoveUci, input.pvUci);
	const refutationLine = cleanUciLine(input.refutationUci);
	const fenAfterPlayedMove = deriveFenAfterMove(fen, playedMoveUci);
	let missedDetail = null;
	let allowedDetail = null;
	if (fen && bestMoveUci && bestLine.length) try {
		missedDetail = detectThemesDetailed({
			fen,
			side: fenSide(fen),
			best: bestMoveUci,
			bestLine,
			_analysisMode: "engine-pv",
			deltaCp: typeof input.cpLoss === "number" ? input.cpLoss : null,
			cpBefore: typeof input.cpBefore === "number" ? input.cpBefore : null,
			cpAfter: typeof input.cpAfter === "number" ? input.cpAfter : null
		});
	} catch {
		missedDetail = null;
	}
	if (fenAfterPlayedMove && playedMoveUci && refutationLine.length) try {
		allowedDetail = detectAllowedThemesDetailedWithOptions(fenAfterPlayedMove, refutationLine, fenSide(fenAfterPlayedMove), {
			deltaCp: typeof input.cpLoss === "number" ? input.cpLoss : null,
			previousFen: fen,
			playedMove: playedMoveUci,
			cpBefore: typeof input.cpAfter === "number" ? input.cpAfter : null,
			_sacrificeIntentCp: typeof input.cpAfter === "number" ? input.cpAfter : null,
			analysisMode: "engine-pv"
		});
	} catch {
		allowedDetail = null;
	}
	const classification = {
		allowedMotifs: selectImportantTacticalMotifs(toMotifEvidence(allowedDetail, "allowed", input.refutationSan)),
		missedMotifs: selectImportantTacticalMotifs(toMotifEvidence(missedDetail, "missed", input.pvSan)),
		motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION
	};
	motifCache.set(key, classification);
	if (motifCache.size > MOTIF_CACHE_LIMIT) {
		const oldestKey = motifCache.keys().next().value;
		if (oldestKey) motifCache.delete(oldestKey);
	}
	return classification;
}
function tacticalMotifLabel(idInput) {
	const id = String(idInput ?? "").trim();
	const label = THEME_LABELS[id];
	if (label) return label;
	return id.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Tactical motif";
}
var DAY = 864e5;
function playerKey(name) {
	return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(" ");
}
function reviewGameKey(game) {
	const content = [
		playerKey(game.white),
		playerKey(game.black),
		game.date,
		game.moves[0]?.fenBefore,
		...game.moves.map((m) => m.uci ?? m.san)
	].join("|");
	let hash = 2166136261;
	for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
	return (hash >>> 0).toString(36);
}
function reviewScanKey(game, player) {
	return `1:${reviewGameKey(game)}:${playerKey(player)}`;
}
function reviewPlayerColor(game, player) {
	const name = playerKey(player);
	if (!name) return null;
	const white = playerKey(game.white) === name;
	return white === (playerKey(game.black) === name) ? null : white ? "white" : "black";
}
function reviewCp(score, color) {
	return (score.type === "mate" ? score.value >= 0 ? 1e4 : -1e4 : score.value) * (color === "white" ? 1 : -1);
}
function reviewChance(cp) {
	return 100 / (1 + Math.exp(-.00368208 * cp));
}
function usefulReviewSwing(before, after) {
	return Number.isFinite(before) && Number.isFinite(after) && before - after >= 12 && before >= 15 && after <= 85;
}
function createPhoneReviewCard(game, index, player, best, reply, now = Date.now()) {
	const move = game.moves[index], color = reviewPlayerColor(game, player);
	if (!color || move.color !== color || !move.uci || !best.uciMoves[0] || best.uciMoves[0] === move.uci || Math.min(best.depth, reply.depth) < 14) return null;
	const cpBefore = reviewCp(best.score, color), cpAfter = reviewCp(reply.score, color);
	const before = reviewChance(cpBefore), after = reviewChance(cpAfter);
	if (!usefulReviewSwing(before, after)) return null;
	const motifs = classifyMistakeReviewMotifs({
		fen: move.fenBefore,
		bestMoveUci: best.uciMoves[0],
		bestMoveSan: best.sanMoves[0],
		playedMoveUci: move.uci,
		playedMoveSan: move.san,
		pvUci: best.uciMoves,
		refutationUci: reply.uciMoves,
		cpBefore,
		cpAfter,
		cpLoss: cpBefore - cpAfter,
		winProbabilityDrop: before - after,
		reachedDepth: Math.min(best.depth, reply.depth)
	});
	const motif = motifs.allowedMotifs[0] ?? motifs.missedMotifs[0];
	const gameKey = reviewGameKey(game);
	return {
		id: `${gameKey}:${index}:${playerKey(player)}`,
		gameKey,
		gameTitle: `${game.white} – ${game.black}`,
		gameDate: game.date,
		player,
		fen: move.fenBefore,
		color,
		ply: index + 1,
		played: move.san,
		best: best.uciMoves[0],
		bestSan: best.sanMoves[0] ?? best.uciMoves[0],
		pv: best.uciMoves.slice(0, 8),
		pvSan: best.sanMoves.slice(0, 8),
		refutation: reply.sanMoves.slice(0, 6),
		before,
		after,
		drop: before - after,
		explanation: motif ? `${motif.label}: ${motif.evidence}` : `Keep the position's chances with ${best.sanMoves[0] ?? best.uciMoves[0]}. Compare the best line with the reply to ${move.san}.`,
		createdAt: now,
		due: now,
		streak: 0,
		reviews: 0
	};
}
function selectGameReviewCards(cards) {
	const chosen = [];
	for (const card of [...cards].sort((a, b) => b.drop - a.drop || a.ply - b.ply)) {
		if (chosen.some((c) => Math.abs(c.ply - card.ply) < 4 || normalizeWebFen(c.fen) === normalizeWebFen(card.fen))) continue;
		chosen.push(card);
		if (chosen.length === 3) break;
	}
	return chosen;
}
function localReviewDay(now) {
	const d = new Date(now);
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function selectDailyReview(cards, now = Date.now(), player) {
	const relevant = cards.filter((c) => !player || playerKey(c.player) === playerKey(player));
	const today = localReviewDay(now);
	const done = relevant.filter((c) => c.lastReviewed && localReviewDay(c.lastReviewed) === today);
	const remaining = Math.max(0, 5 - done.length);
	const score = (c) => c.drop + Math.max(0, 20 - (now - (Date.parse(c.gameDate.replaceAll(".", "-")) || c.createdAt)) / DAY / 7);
	const eligible = relevant.filter((c) => !c.hidden && c.due <= now && !done.includes(c));
	const due = eligible.filter((c) => c.reviews > 0).sort((a, b) => a.due - b.due || score(b) - score(a));
	const fresh = eligible.filter((c) => c.reviews === 0).sort((a, b) => score(b) - score(a));
	const result = [];
	const ordered = [
		...due.slice(0, 3),
		...fresh.slice(0, 2),
		...due.slice(3),
		...fresh.slice(2)
	];
	const seen = new Set(done.map((c) => normalizeWebFen(c.fen)));
	for (const c of ordered) {
		if (result.length >= remaining) break;
		if (seen.has(normalizeWebFen(c.fen)) || [...done, ...result].filter((p) => p.gameKey === c.gameKey).length >= 2) continue;
		result.push(c);
		seen.add(normalizeWebFen(c.fen));
	}
	return result;
}
function gradePhoneReview(card, grade, now = Date.now()) {
	const streak = grade === "again" ? 0 : card.streak + (grade === "easy" ? 2 : 1);
	const days = grade === "again" ? 1 : [
		1,
		3,
		7,
		14,
		30,
		60
	][Math.min(streak - 1, 5)];
	return {
		...card,
		hidden: grade === "hide" || card.hidden,
		streak,
		reviews: card.reviews + 1,
		lastReviewed: now,
		due: now + days * DAY
	};
}
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/alea.js
var require_alea = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$6, define) {
		function Alea(seed) {
			var me = this, mash = Mash();
			me.next = function() {
				var t = 2091639 * me.s0 + me.c * 23283064365386963e-26;
				me.s0 = me.s1;
				me.s1 = me.s2;
				return me.s2 = t - (me.c = t | 0);
			};
			me.c = 1;
			me.s0 = mash(" ");
			me.s1 = mash(" ");
			me.s2 = mash(" ");
			me.s0 -= mash(seed);
			if (me.s0 < 0) me.s0 += 1;
			me.s1 -= mash(seed);
			if (me.s1 < 0) me.s1 += 1;
			me.s2 -= mash(seed);
			if (me.s2 < 0) me.s2 += 1;
			mash = null;
		}
		function copy(f, t) {
			t.c = f.c;
			t.s0 = f.s0;
			t.s1 = f.s1;
			t.s2 = f.s2;
			return t;
		}
		function impl(seed, opts) {
			var xg = new Alea(seed), state = opts && opts.state, prng = xg.next;
			prng.int32 = function() {
				return xg.next() * 4294967296 | 0;
			};
			prng.double = function() {
				return prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
			};
			prng.quick = prng;
			if (state) {
				if (typeof state == "object") copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		function Mash() {
			var n = 4022871197;
			var mash = function(data) {
				data = String(data);
				for (var i = 0; i < data.length; i++) {
					n += data.charCodeAt(i);
					var h = .02519603282416938 * n;
					n = h >>> 0;
					h -= n;
					h *= n;
					n = h >>> 0;
					h -= n;
					n += h * 4294967296;
				}
				return (n >>> 0) * 23283064365386963e-26;
			};
			return mash;
		}
		if (module$6 && module$6.exports) module$6.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.alea = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/xor128.js
var require_xor128 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$5, define) {
		function XorGen(seed) {
			var me = this, strseed = "";
			me.x = 0;
			me.y = 0;
			me.z = 0;
			me.w = 0;
			me.next = function() {
				var t = me.x ^ me.x << 11;
				me.x = me.y;
				me.y = me.z;
				me.z = me.w;
				return me.w ^= me.w >>> 19 ^ t ^ t >>> 8;
			};
			if (seed === (seed | 0)) me.x = seed;
			else strseed += seed;
			for (var k = 0; k < strseed.length + 64; k++) {
				me.x ^= strseed.charCodeAt(k) | 0;
				me.next();
			}
		}
		function copy(f, t) {
			t.x = f.x;
			t.y = f.y;
			t.z = f.z;
			t.w = f.w;
			return t;
		}
		function impl(seed, opts) {
			var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
				return (xg.next() >>> 0) / 4294967296;
			};
			prng.double = function() {
				do
					var result = ((xg.next() >>> 11) + (xg.next() >>> 0) / 4294967296) / (1 << 21);
				while (result === 0);
				return result;
			};
			prng.int32 = xg.next;
			prng.quick = prng;
			if (state) {
				if (typeof state == "object") copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		if (module$5 && module$5.exports) module$5.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.xor128 = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/xorwow.js
var require_xorwow = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$4, define) {
		function XorGen(seed) {
			var me = this, strseed = "";
			me.next = function() {
				var t = me.x ^ me.x >>> 2;
				me.x = me.y;
				me.y = me.z;
				me.z = me.w;
				me.w = me.v;
				return (me.d = me.d + 362437 | 0) + (me.v = me.v ^ me.v << 4 ^ (t ^ t << 1)) | 0;
			};
			me.x = 0;
			me.y = 0;
			me.z = 0;
			me.w = 0;
			me.v = 0;
			if (seed === (seed | 0)) me.x = seed;
			else strseed += seed;
			for (var k = 0; k < strseed.length + 64; k++) {
				me.x ^= strseed.charCodeAt(k) | 0;
				if (k == strseed.length) me.d = me.x << 10 ^ me.x >>> 4;
				me.next();
			}
		}
		function copy(f, t) {
			t.x = f.x;
			t.y = f.y;
			t.z = f.z;
			t.w = f.w;
			t.v = f.v;
			t.d = f.d;
			return t;
		}
		function impl(seed, opts) {
			var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
				return (xg.next() >>> 0) / 4294967296;
			};
			prng.double = function() {
				do
					var result = ((xg.next() >>> 11) + (xg.next() >>> 0) / 4294967296) / (1 << 21);
				while (result === 0);
				return result;
			};
			prng.int32 = xg.next;
			prng.quick = prng;
			if (state) {
				if (typeof state == "object") copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		if (module$4 && module$4.exports) module$4.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.xorwow = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/xorshift7.js
var require_xorshift7 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$3, define) {
		function XorGen(seed) {
			var me = this;
			me.next = function() {
				var X = me.x, i = me.i, t = X[i], v;
				t ^= t >>> 7;
				v = t ^ t << 24;
				t = X[i + 1 & 7];
				v ^= t ^ t >>> 10;
				t = X[i + 3 & 7];
				v ^= t ^ t >>> 3;
				t = X[i + 4 & 7];
				v ^= t ^ t << 7;
				t = X[i + 7 & 7];
				t = t ^ t << 13;
				v ^= t ^ t << 9;
				X[i] = v;
				me.i = i + 1 & 7;
				return v;
			};
			function init(me, seed) {
				var j, X = [];
				if (seed === (seed | 0)) X[0] = seed;
				else {
					seed = "" + seed;
					for (j = 0; j < seed.length; ++j) X[j & 7] = X[j & 7] << 15 ^ seed.charCodeAt(j) + X[j + 1 & 7] << 13;
				}
				while (X.length < 8) X.push(0);
				for (j = 0; j < 8 && X[j] === 0; ++j);
				if (j == 8) X[7] = -1;
				else X[j];
				me.x = X;
				me.i = 0;
				for (j = 256; j > 0; --j) me.next();
			}
			init(me, seed);
		}
		function copy(f, t) {
			t.x = f.x.slice();
			t.i = f.i;
			return t;
		}
		function impl(seed, opts) {
			if (seed == null) seed = +/* @__PURE__ */ new Date();
			var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
				return (xg.next() >>> 0) / 4294967296;
			};
			prng.double = function() {
				do
					var result = ((xg.next() >>> 11) + (xg.next() >>> 0) / 4294967296) / (1 << 21);
				while (result === 0);
				return result;
			};
			prng.int32 = xg.next;
			prng.quick = prng;
			if (state) {
				if (state.x) copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		if (module$3 && module$3.exports) module$3.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.xorshift7 = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/xor4096.js
var require_xor4096 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$2, define) {
		function XorGen(seed) {
			var me = this;
			me.next = function() {
				var w = me.w, X = me.X, i = me.i, t, v;
				me.w = w = w + 1640531527 | 0;
				v = X[i + 34 & 127];
				t = X[i = i + 1 & 127];
				v ^= v << 13;
				t ^= t << 17;
				v ^= v >>> 15;
				t ^= t >>> 12;
				v = X[i] = v ^ t;
				me.i = i;
				return v + (w ^ w >>> 16) | 0;
			};
			function init(me, seed) {
				var t, v, i, j, w, X = [], limit = 128;
				if (seed === (seed | 0)) {
					v = seed;
					seed = null;
				} else {
					seed = seed + "\0";
					v = 0;
					limit = Math.max(limit, seed.length);
				}
				for (i = 0, j = -32; j < limit; ++j) {
					if (seed) v ^= seed.charCodeAt((j + 32) % seed.length);
					if (j === 0) w = v;
					v ^= v << 10;
					v ^= v >>> 15;
					v ^= v << 4;
					v ^= v >>> 13;
					if (j >= 0) {
						w = w + 1640531527 | 0;
						t = X[j & 127] ^= v + w;
						i = 0 == t ? i + 1 : 0;
					}
				}
				if (i >= 128) X[(seed && seed.length || 0) & 127] = -1;
				i = 127;
				for (j = 512; j > 0; --j) {
					v = X[i + 34 & 127];
					t = X[i = i + 1 & 127];
					v ^= v << 13;
					t ^= t << 17;
					v ^= v >>> 15;
					t ^= t >>> 12;
					X[i] = v ^ t;
				}
				me.w = w;
				me.X = X;
				me.i = i;
			}
			init(me, seed);
		}
		function copy(f, t) {
			t.i = f.i;
			t.w = f.w;
			t.X = f.X.slice();
			return t;
		}
		function impl(seed, opts) {
			if (seed == null) seed = +/* @__PURE__ */ new Date();
			var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
				return (xg.next() >>> 0) / 4294967296;
			};
			prng.double = function() {
				do
					var result = ((xg.next() >>> 11) + (xg.next() >>> 0) / 4294967296) / (1 << 21);
				while (result === 0);
				return result;
			};
			prng.int32 = xg.next;
			prng.quick = prng;
			if (state) {
				if (state.X) copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		if (module$2 && module$2.exports) module$2.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.xor4096 = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/lib/tychei.js
var require_tychei = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, module$1, define) {
		function XorGen(seed) {
			var me = this, strseed = "";
			me.next = function() {
				var b = me.b, c = me.c, d = me.d, a = me.a;
				b = b << 25 ^ b >>> 7 ^ c;
				c = c - d | 0;
				d = d << 24 ^ d >>> 8 ^ a;
				a = a - b | 0;
				me.b = b = b << 20 ^ b >>> 12 ^ c;
				me.c = c = c - d | 0;
				me.d = d << 16 ^ c >>> 16 ^ a;
				return me.a = a - b | 0;
			};
			me.a = 0;
			me.b = 0;
			me.c = -1640531527;
			me.d = 1367130551;
			if (seed === Math.floor(seed)) {
				me.a = seed / 4294967296 | 0;
				me.b = seed | 0;
			} else strseed += seed;
			for (var k = 0; k < strseed.length + 20; k++) {
				me.b ^= strseed.charCodeAt(k) | 0;
				me.next();
			}
		}
		function copy(f, t) {
			t.a = f.a;
			t.b = f.b;
			t.c = f.c;
			t.d = f.d;
			return t;
		}
		function impl(seed, opts) {
			var xg = new XorGen(seed), state = opts && opts.state, prng = function() {
				return (xg.next() >>> 0) / 4294967296;
			};
			prng.double = function() {
				do
					var result = ((xg.next() >>> 11) + (xg.next() >>> 0) / 4294967296) / (1 << 21);
				while (result === 0);
				return result;
			};
			prng.int32 = xg.next;
			prng.quick = prng;
			if (state) {
				if (typeof state == "object") copy(state, xg);
				prng.state = function() {
					return copy(xg, {});
				};
			}
			return prng;
		}
		if (module$1 && module$1.exports) module$1.exports = impl;
		else if (define && define.amd) define(function() {
			return impl;
		});
		else this.tychei = impl;
	})(exports, typeof module == "object" && module, typeof define == "function" && define);
}));
//#endregion
//#region ../../en-croissant/node_modules/.pnpm/seedrandom@3.0.5/node_modules/seedrandom/seedrandom.js
var require_seedrandom$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(global, pool, math) {
		var width = 256, chunks = 6, digits = 52, rngname = "random", startdenom = math.pow(width, chunks), significance = math.pow(2, digits), overflow = significance * 2, mask = width - 1, nodecrypto;
		function seedrandom(seed, options, callback) {
			var key = [];
			options = options == true ? { entropy: true } : options || {};
			var shortseed = mixkey(flatten(options.entropy ? [seed, tostring(pool)] : seed == null ? autoseed() : seed, 3), key);
			var arc4 = new ARC4(key);
			var prng = function() {
				var n = arc4.g(chunks), d = startdenom, x = 0;
				while (n < significance) {
					n = (n + x) * width;
					d *= width;
					x = arc4.g(1);
				}
				while (n >= overflow) {
					n /= 2;
					d /= 2;
					x >>>= 1;
				}
				return (n + x) / d;
			};
			prng.int32 = function() {
				return arc4.g(4) | 0;
			};
			prng.quick = function() {
				return arc4.g(4) / 4294967296;
			};
			prng.double = prng;
			mixkey(tostring(arc4.S), pool);
			return (options.pass || callback || function(prng, seed, is_math_call, state) {
				if (state) {
					if (state.S) copy(state, arc4);
					prng.state = function() {
						return copy(arc4, {});
					};
				}
				if (is_math_call) {
					math[rngname] = prng;
					return seed;
				} else return prng;
			})(prng, shortseed, "global" in options ? options.global : this == math, options.state);
		}
		function ARC4(key) {
			var t, keylen = key.length, me = this, i = 0, j = me.i = me.j = 0, s = me.S = [];
			if (!keylen) key = [keylen++];
			while (i < width) s[i] = i++;
			for (i = 0; i < width; i++) {
				s[i] = s[j = mask & j + key[i % keylen] + (t = s[i])];
				s[j] = t;
			}
			(me.g = function(count) {
				var t, r = 0, i = me.i, j = me.j, s = me.S;
				while (count--) {
					t = s[i = mask & i + 1];
					r = r * width + s[mask & (s[i] = s[j = mask & j + t]) + (s[j] = t)];
				}
				me.i = i;
				me.j = j;
				return r;
			})(width);
		}
		function copy(f, t) {
			t.i = f.i;
			t.j = f.j;
			t.S = f.S.slice();
			return t;
		}
		function flatten(obj, depth) {
			var result = [], typ = typeof obj, prop;
			if (depth && typ == "object") for (prop in obj) try {
				result.push(flatten(obj[prop], depth - 1));
			} catch (e) {}
			return result.length ? result : typ == "string" ? obj : obj + "\0";
		}
		function mixkey(seed, key) {
			var stringseed = seed + "", smear, j = 0;
			while (j < stringseed.length) key[mask & j] = mask & (smear ^= key[mask & j] * 19) + stringseed.charCodeAt(j++);
			return tostring(key);
		}
		function autoseed() {
			try {
				var out;
				if (nodecrypto && (out = nodecrypto.randomBytes)) out = out(width);
				else {
					out = new Uint8Array(width);
					(global.crypto || global.msCrypto).getRandomValues(out);
				}
				return tostring(out);
			} catch (e) {
				var browser = global.navigator, plugins = browser && browser.plugins;
				return [
					+/* @__PURE__ */ new Date(),
					global,
					plugins,
					global.screen,
					tostring(pool)
				];
			}
		}
		function tostring(a) {
			return String.fromCharCode.apply(0, a);
		}
		mixkey(math.random(), pool);
		if (typeof module == "object" && module.exports) {
			module.exports = seedrandom;
			try {
				nodecrypto = __require("crypto");
			} catch (ex) {}
		} else if (typeof define == "function" && define.amd) define(function() {
			return seedrandom;
		});
		else math["seed" + rngname] = seedrandom;
	})(typeof self !== "undefined" ? self : exports, [], Math);
}));
(/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var alea = require_alea();
	var xor128 = require_xor128();
	var xorwow = require_xorwow();
	var xorshift7 = require_xorshift7();
	var xor4096 = require_xor4096();
	var tychei = require_tychei();
	var sr = require_seedrandom$1();
	sr.alea = alea;
	sr.xor128 = xor128;
	sr.xorwow = xorwow;
	sr.xorshift7 = xorshift7;
	sr.xor4096 = xor4096;
	sr.tychei = tychei;
	module.exports = sr;
})))();
var d = ((e) => (e[e.New = 0] = "New", e[e.Learning = 1] = "Learning", e[e.Review = 2] = "Review", e[e.Relearning = 3] = "Relearning", e))(d || {}), n = ((e) => (e[e.Manual = 0] = "Manual", e[e.Again = 1] = "Again", e[e.Hard = 2] = "Hard", e[e.Good = 3] = "Good", e[e.Easy = 4] = "Easy", e))(n || {});
Date.prototype.scheduler = function(e, t) {
	return y(this, e, t);
}, Date.prototype.diff = function(e, t) {
	return v(this, e, t);
}, Date.prototype.format = function() {
	return b(this);
}, Date.prototype.dueFormat = function(e, t, a) {
	return x(this, e, t, a);
};
function y(e, t, a) {
	return new Date(a ? u(e).getTime() + t * 24 * 60 * 60 * 1e3 : u(e).getTime() + t * 60 * 1e3);
}
function v(e, t, a) {
	if (!e || !t) throw new Error("Invalid date");
	const r = u(e).getTime() - u(t).getTime();
	let s = 0;
	switch (a) {
		case "days":
			s = Math.floor(r / (1440 * 60 * 1e3));
			break;
		case "minutes":
			s = Math.floor(r / (60 * 1e3));
			break;
	}
	return s;
}
function b(e) {
	const t = u(e), a = t.getFullYear(), r = t.getMonth() + 1, s = t.getDate(), i = t.getHours(), l = t.getMinutes(), o = t.getSeconds();
	return `${a}-${f(r)}-${f(s)} ${f(i)}:${f(l)}:${f(o)}`;
}
function f(e) {
	return e < 10 ? `0${e}` : `${e}`;
}
var p = [
	60,
	60,
	24,
	31,
	12
], g = [
	"second",
	"min",
	"hour",
	"day",
	"month",
	"year"
];
function x(e, t, a, r = g) {
	e = u(e), t = u(t), r.length !== g.length && (r = g);
	let s = e.getTime() - t.getTime(), i;
	for (s /= 1e3, i = 0; i < p.length && !(s < p[i]); i++) s /= p[i];
	return `${Math.floor(s)}${a ? r[i] : ""}`;
}
function u(e) {
	if (typeof e == "object" && e instanceof Date) return e;
	if (typeof e == "string") {
		const t = Date.parse(e);
		if (isNaN(t)) throw new Error(`Invalid date:[${e}]`);
		return new Date(t);
	} else if (typeof e == "number") return new Date(e);
	throw new Error(`Invalid date:[${e}]`);
}
n.Again, n.Hard, n.Good, n.Easy;
function k(e, t) {
	const a = {
		due: e ? u(e) : /* @__PURE__ */ new Date(),
		stability: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 0,
		lapses: 0,
		state: d.New,
		last_review: void 0
	};
	return t && typeof t == "function" ? t(a) : a;
}
//#endregion
//#region src/web/sharedReview.ts
var SHARED_REVIEW_NAME = "My online games";
var SHARED_REVIEW_FILE = "My online games.mistake-review.json";
var SHARED_REVIEW_SOURCE = "pc-online-review-v1";
function sharedReviewDeck(cards, enginePath = "", now = Date.now()) {
	return {
		version: 1,
		name: SHARED_REVIEW_NAME,
		source: SHARED_REVIEW_SOURCE,
		createdAt: Math.min(now, ...cards.map((c) => c.createdAt)),
		updatedAt: now,
		settings: {
			playerDb: "",
			playerId: 0,
			playerName: "My online accounts",
			enginePath,
			engineName: "Stockfish 18",
			analysisMode: "single",
			fastDepth: 16,
			deepDepth: 16,
			multiPv: 1,
			timeControls: [],
			dateRange: "all",
			thresholds: {
				inaccuracy: 50,
				mistake: 100,
				blunder: 200
			},
			includeSeverities: {
				inaccuracy: true,
				mistake: true,
				blunder: true
			},
			minWinProbabilityDrop: 12,
			timeManagement: {
				enabled: false,
				minMoveSeconds: 20
			}
		},
		daily: {
			reviewsPerDay: 5,
			newItemsPerDay: 2,
			gamePeriod: "all",
			minWinProbabilityDrop: 12,
			includeInaccuracies: true,
			includeMistakes: true,
			includeBlunders: true
		},
		positions: cards.map((c) => ({
			fen: c.fen,
			answer: c.bestSan,
			answerUci: c.best,
			sideToMove: c.color,
			source: "Mistake Review",
			reviewKey: `pc:${c.id}`,
			importedAt: c.createdAt,
			priority: c.drop,
			tags: c.hidden ? ["Hidden"] : ["Mistake Review"],
			reason: c.explanation,
			evidence: `${c.gameTitle} · ${c.gameDate}`,
			card: {
				...k(new Date(c.hidden ? "9999-01-01" : c.due)),
				reps: c.reviews,
				state: c.reviews ? 2 : 0,
				...c.lastReviewed ? { last_review: new Date(c.lastReviewed) } : {}
			},
			mistakeReview: {
				playerName: c.player,
				playerColor: c.color,
				playedMoveSan: c.played,
				bestMoveSan: c.bestSan,
				bestMoveUci: c.best,
				pvSan: c.pvSan,
				pvUci: c.pv,
				refutationSan: c.refutation,
				winProbabilityDrop: c.drop,
				cpBefore: chanceCp(c.before),
				cpAfter: chanceCp(c.after),
				cpLoss: chanceCp(c.before) - chanceCp(c.after),
				severity: c.drop >= 25 ? "blunder" : "mistake",
				date: c.gameDate,
				ply: c.ply,
				moveNumber: Math.ceil(c.ply / 2),
				occurrenceCount: 1,
				engineName: "Stockfish 18",
				enginePath,
				reachedDepth: 16
			}
		})),
		logs: []
	};
}
function chanceCp(chance) {
	const bounded = Math.max(1e-5, Math.min(99.99999, chance));
	return Math.round(-Math.log(100 / bounded - 1) / .00368208);
}
function mergeSharedProgress(cards, incoming) {
	const positions = new Map(incoming.positions.map((p) => [p.reviewKey, p]));
	return cards.map((c) => {
		const p = positions.get(`pc:${c.id}`);
		if (!p) return c;
		const last = p.card.last_review ? new Date(p.card.last_review).getTime() : 0;
		const due = new Date(p.card.due).getTime();
		if (!Number.isFinite(last) || !Number.isFinite(due) || last <= (c.lastReviewed ?? 0)) return c;
		return {
			...c,
			lastReviewed: last,
			due,
			reviews: Math.max(c.reviews, p.card.reps),
			streak: Math.max(0, p.card.reps - p.card.lapses)
		};
	});
}
//#endregion
//#region scripts/shared-review-service.ts
var readJson = async (path, fallback = null) => {
	try {
		return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
	} catch (e) {
		if (e.code === "ENOENT") return fallback;
		throw e;
	}
};
async function atomicJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.next`;
	await writeFile(temp, JSON.stringify(value));
	await rename(temp, path);
}
var SharedReviewService = class {
	constructor(options) {
		this.options = options;
		this.data = {
			cards: [],
			scanned: [],
			skipped: [],
			updatedAt: 0
		};
		this.status = {
			state: "starting",
			reviewedGames: 0
		};
		this.accounts = {};
		this.busy = false;
		this.stopped = false;
		this.enabled = true;
		this.writes = Promise.resolve();
		this.enginePath = "";
		this.lastFetch = 0;
		this.archive = [];
		this.failures = /* @__PURE__ */ new Map();
		this.storePath = join(options.root, "review-store.json");
		this.deckPath = join(options.documentsRoot, SHARED_REVIEW_FILE);
	}
	async initialize(start = true) {
		await mkdir(this.options.root, { recursive: true });
		this.data = await readJson(this.storePath, this.data);
		this.accounts = (await readJson(join(this.options.root, "config.json"), {})).accounts ?? {};
		if (!Object.values(this.accounts).some(Boolean)) {
			this.enabled = false;
			this.status = {
				state: "unconfigured",
				savedAnalysisSummaries: 0,
				error: null
			};
			return;
		}
		const existing = await readJson(this.deckPath);
		if (existing && existing.source !== "pc-online-review-v1") throw new Error("The online review filename is already used by another collection.");
		this.enabled = (await readJson(join(this.options.root, "review-settings.json"), { enabled: true })).enabled !== false;
		this.enginePath = (await readJson(this.options.engineConfigPath, {})).enginePath ?? "";
		const old = await readJson(join(this.options.root, "games.json"), { games: [] });
		const fresh = await readJson(join(this.options.root, "review-games.json"), []);
		this.archive = mergeArchive(old.games, fresh);
		const summaries = await readJson(join(this.options.root, "entries.json"), { entries: [] });
		this.status = {
			state: this.enabled ? "idle" : "paused",
			savedAnalysisSummaries: summaries.entries.length,
			lastCheckedAt: 0,
			error: null
		};
		this.cache = new DatabaseSync(join(this.options.root, "review-evaluations.sqlite"));
		this.cache.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS evaluations (fen TEXT PRIMARY KEY, line TEXT NOT NULL)");
		await this.persist();
		if (start) {
			this.timer = setInterval(() => void this.run(), 6e4);
			this.timer.unref();
			this.run();
		}
	}
	snapshot() {
		return {
			...this.status,
			enabled: this.enabled,
			running: this.busy,
			accounts: this.accounts,
			cards: this.data.cards,
			reviewedGames: this.data.scanned.length,
			skippedGames: this.data.skipped.length,
			archivedGames: this.archive.length,
			updatedAt: this.data.updatedAt,
			policy: "Checks online accounts every five minutes; prepares missing review positions at depth 16 using stored evaluations first."
		};
	}
	phoneSnapshot() {
		return {
			...this.snapshot(),
			cards: selectDailyReview(this.data.cards),
			usefulPositionsCount: this.data.cards.filter((c) => !c.hidden).length
		};
	}
	fail(error) {
		this.stopped = true;
		this.enabled = false;
		this.status = {
			state: "error",
			error: "PC review data could not be loaded. Other app features remain available."
		};
		this.options.log?.(String(error));
	}
	async deck() {
		await this.writes;
		return this.makeDeck();
	}
	async makeDeck() {
		const fresh = sharedReviewDeck(this.data.cards, this.enginePath, this.data.updatedAt || Date.now());
		const previous = await readJson(this.deckPath);
		if (!previous) return fresh;
		const byKey = new Map(previous.positions.map((p) => [p.reviewKey, p]));
		return {
			...fresh,
			createdAt: previous.createdAt,
			logs: previous.logs ?? [],
			positions: fresh.positions.map((p) => {
				const old = byKey.get(p.reviewKey);
				return old ? {
					...p,
					...old,
					tags: p.tags,
					card: !p.tags?.includes("Hidden") && new Date(old.card.last_review ?? 0).getTime() >= new Date(p.card.last_review ?? 0).getTime() ? old.card : p.card
				} : p;
			})
		};
	}
	transact(action) {
		const run = this.writes.then(action);
		this.writes = run.catch(() => {});
		return run;
	}
	async grade(id, grade, expectedReviews) {
		if (![
			"again",
			"good",
			"easy",
			"hide"
		].includes(grade)) throw new Error("Invalid review grade.");
		await this.transact(async () => {
			const card = this.data.cards.find((c) => c.id === id);
			if (!card) throw new Error("Review position not found.");
			if (card.reviews !== expectedReviews) return;
			this.data.cards = this.data.cards.map((c) => c.id === id ? gradePhoneReview(c, grade) : c);
			await this.persist();
		});
		return this.snapshot();
	}
	async saveDeck(deck) {
		if (!Array.isArray(deck?.positions) || !Array.isArray(deck?.logs)) throw new Error("Invalid review collection.");
		await this.transact(async () => {
			this.data.cards = mergeSharedProgress(this.data.cards, deck);
			const previous = await this.makeDeck();
			const incoming = new Map(deck.positions.map((p) => [p.reviewKey, p]));
			const logs = new Map([...previous.logs, ...deck.logs].map((l) => [JSON.stringify(l), l]));
			await atomicJson(this.deckPath, {
				...previous,
				logs: [...logs.values()],
				positions: previous.positions.map((p) => {
					const next = incoming.get(p.reviewKey);
					return next ? {
						...p,
						comment: next.comment,
						annotations: next.annotations,
						shapes: next.shapes,
						reviewTree: next.reviewTree,
						card: new Date(next.card.last_review ?? 0).getTime() >= new Date(p.card.last_review ?? 0).getTime() ? next.card : p.card
					} : p;
				})
			});
			await this.persist();
		});
		return this.deck();
	}
	async setEnabled(enabled) {
		this.enabled = enabled;
		await atomicJson(join(this.options.root, "review-settings.json"), { enabled });
		if (!enabled) this.engine?.close();
		this.status.state = enabled ? "idle" : "paused";
		if (enabled) this.run();
		return this.snapshot();
	}
	async persist() {
		const existingDeck = await readJson(this.deckPath);
		if (existingDeck) this.data.cards = mergeSharedProgress(this.data.cards, existingDeck);
		this.data.updatedAt = Date.now();
		await atomicJson(this.storePath, this.data);
		await atomicJson(this.deckPath, await this.makeDeck());
	}
	async run() {
		if (this.busy || this.stopped || !this.enabled) return;
		this.busy = true;
		try {
			await this.transact(() => this.persist());
			await this.discover();
			const seen = new Set([...this.data.scanned, ...this.data.skipped]);
			const processed = new Set(this.data.processed ?? []);
			const games = [];
			let examined = 0;
			for (const item of [...this.archive].sort((a, b) => (b.end ?? b.playedAt / 1e3) - (a.end ?? a.playedAt / 1e3))) {
				const player = this.accounts[item.source];
				if (!player || !item.pgn) continue;
				if (/\[Result\s+"\*"\]/i.test(item.pgn)) continue;
				const archiveKey = `${item.source}:${player.toLowerCase()}:${item.url || item.pgn}`;
				if (processed.has(archiveKey) || (this.failures.get(archiveKey) ?? 0) > Date.now()) continue;
				if (++examined % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
				try {
					const game = parsePgnDatabase("Online games", item.pgn).games[0];
					if (!game || !reviewPlayerColor(game, player)) {
						processed.add(archiveKey);
						continue;
					}
					const key = reviewScanKey(game, player);
					if (seen.has(key)) {
						processed.add(archiveKey);
						continue;
					}
					seen.add(key);
					if (game.moves.length) games.push({
						game,
						player,
						key,
						archiveKey
					});
					else {
						this.data.skipped.push(key);
						processed.add(archiveKey);
					}
				} catch {}
				if (games.length >= 10) break;
			}
			this.data.processed = [...processed];
			this.status.pendingGames = Math.max(0, this.archive.length - processed.size);
			for (const { game, player, key, archiveKey } of games) {
				if (this.stopped || !this.enabled) break;
				this.status.state = "analyzing";
				this.status.currentGame = `${game.white} – ${game.black}`;
				this.status.currentDate = game.date;
				this.status.error = null;
				try {
					const cards = [];
					for (let i = 0; i < game.moves.length; i++) {
						if (this.stopped || !this.enabled) throw new Error("Analysis paused.");
						const move = game.moves[i];
						if (move.color !== reviewPlayerColor(game, player)) continue;
						this.status.currentPly = i + 1;
						const best = await this.evaluate(move.fenBefore);
						if (move.uci === best.uciMoves[0]) continue;
						const reply = await this.evaluate(move.fenAfter);
						const card = createPhoneReviewCard(game, i, player, best, reply);
						if (card) cards.push(card);
					}
					await this.transact(async () => {
						const ids = new Set(this.data.cards.map((c) => c.id));
						this.data.cards.push(...selectGameReviewCards(cards).filter((c) => !ids.has(c.id)));
						this.data.scanned.push(key);
						this.data.processed.push(archiveKey);
						await this.persist();
					});
					this.status.pendingGames--;
				} catch (e) {
					this.failures.set(archiveKey, Date.now() + 36e5);
					this.status.error = String(e.message ?? e);
					this.engine?.close();
					this.engine = void 0;
					if (!this.enabled || this.stopped) break;
				}
				if (Date.now() - this.lastFetch >= 3e5) break;
			}
			this.status.state = this.enabled ? this.status.error ? "error" : "idle" : "paused";
		} catch (e) {
			this.status.state = this.enabled ? "error" : "paused";
			this.status.error = String(e.message ?? e);
			this.options.log?.(`Review preparation: ${this.status.error}`);
		} finally {
			this.engine?.close();
			this.engine = void 0;
			this.busy = false;
			await atomicJson(join(this.options.root, "review-status.json"), {
				...this.status,
				updatedAt: Date.now()
			});
			if (this.stopped) {
				this.cache?.close();
				this.cache = void 0;
			}
		}
	}
	async discover() {
		if (Date.now() - this.lastFetch < 3e5) return;
		this.lastFetch = Date.now();
		this.status.state = "checking";
		const fresh = await readJson(join(this.options.root, "review-games.json"), []);
		const byUrl = new Map(fresh.map((g) => [`${g.source}:${g.url}`, g]));
		const errors = [];
		const cursors = await readJson(join(this.options.root, "review-cursors.json"), {});
		for (const source of ["chesscom", "lichess"]) {
			const username = this.accounts[source];
			if (!username) continue;
			try {
				const cursorKey = `${source}:${username.toLowerCase()}`;
				const knownEnds = this.archive.filter((g) => g.source === source).map((g) => g.end ? g.end * 1e3 : g.playedAt ?? 0);
				const lastKnown = Math.max(0, ...knownEnds);
				const since = (cursors[cursorKey] ?? (lastKnown || Date.now() - 365 * 864e5)) - 864e5;
				const checkedAt = Date.now();
				const games = await (this.options.fetchGames ?? fetchWebOnlineGamesSince)({
					source,
					username,
					since,
					signal: AbortSignal.timeout(12e4)
				});
				for (const g of games) byUrl.set(`${source}:${g.url}`, g);
				await atomicJson(join(this.options.root, "review-games.json"), [...byUrl.values()]);
				cursors[cursorKey] = checkedAt;
				await atomicJson(join(this.options.root, "review-cursors.json"), cursors);
			} catch (e) {
				errors.push(`${source}: ${e.message}`);
			}
		}
		await atomicJson(join(this.options.root, "review-games.json"), [...byUrl.values()]);
		this.archive = mergeArchive((await readJson(join(this.options.root, "games.json"), { games: [] })).games, [...byUrl.values()]);
		this.status.lastCheckedAt = Date.now();
		this.status.discoveryError = errors.join("; ") || null;
	}
	async evaluate(fen) {
		const outcome = positionFromFen(fen)[0]?.outcome();
		if (outcome) return engineLine(fen, 99, {
			type: "cp",
			value: outcome.winner ? outcome.winner === "white" ? 1e4 : -1e4 : 0
		}, []);
		const key = normalizeWebFen(fen);
		const cached = this.cache.prepare("SELECT line FROM evaluations WHERE fen = ?").get(key);
		if (cached) return JSON.parse(cached.line);
		const cloud = await this.options.lookup(fen);
		let line;
		if (cloud?.depth >= 16 && cloud.pvs?.[0]?.moves && (Number.isFinite(cloud.pvs[0].cp) || Number.isFinite(cloud.pvs[0].mate))) {
			const pv = cloud.pvs[0];
			line = engineLine(fen, cloud.depth, Number.isFinite(pv.cp) ? {
				type: "cp",
				value: pv.cp
			} : {
				type: "mate",
				value: pv.mate
			}, pv.moves.split(/\s+/));
			line.source = "lichess-cloud";
			if (!line.uciMoves.length) line = void 0;
		}
		if (!line) {
			if (!this.engine) this.engine = new BackgroundEngine(this.enginePath);
			line = await this.engine.analyze(fen);
		}
		if (line.depth < 14) throw new Error("Engine did not reach the required review depth.");
		this.cache.prepare("INSERT OR REPLACE INTO evaluations VALUES (?, ?)").run(key, JSON.stringify(line));
		return line;
	}
	close() {
		this.stopped = true;
		clearInterval(this.timer);
		this.engine?.close();
		if (!this.busy) {
			this.cache?.close();
			this.cache = void 0;
		}
	}
};
function mergeArchive(old, fresh) {
	return [...new Map([...old, ...fresh].map((g) => [`${g.source}:${g.url || g.pgn}`, g])).values()];
}
function engineLine(fen, depth, score, uciMoves) {
	const sanMoves = [], legalMoves = [];
	for (const uci of uciMoves) {
		const move = playUciMove(fen, uci);
		if (!move) break;
		legalMoves.push(uci);
		sanMoves.push(move.san);
		fen = move.fenAfter;
	}
	return {
		source: "stockfish",
		multipv: 1,
		depth,
		score,
		uciMoves: legalMoves,
		sanMoves
	};
}
var BackgroundEngine = class {
	constructor(path) {
		if (!path) throw new Error("The PC Stockfish path is not configured.");
		this.child = spawn(path, [], {
			windowsHide: true,
			stdio: "pipe"
		});
		this.child.on("spawn", () => {
			try {
				setPriority(this.child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
			} catch {}
		});
		this.child.on("error", (e) => this.waiting?.reject(e));
		this.child.on("exit", () => this.waiting?.reject(/* @__PURE__ */ new Error("Background engine exited; preparation will retry.")));
		this.child.stderr.resume();
		createInterface({ input: this.child.stdout }).on("line", (l) => this.waiting?.line(l));
		this.ready = this.exchange("uci", (l) => l === "uciok" ? { result: void 0 } : null).then(() => this.exchange("setoption name Threads value 1\nsetoption name Hash value 64\nisready", (l) => l === "readyok" ? { result: void 0 } : null));
	}
	exchange(command, accept) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.close();
				finish(/* @__PURE__ */ new Error("Background engine timed out."));
			}, 3e4);
			const finish = (error, value) => {
				clearTimeout(timer);
				this.waiting = void 0;
				if (error) reject(error);
				else resolve(value);
			};
			this.waiting = {
				reject: (e) => finish(e),
				line: (l) => {
					try {
						const result = accept(l);
						if (result) finish(void 0, result.result);
					} catch (e) {
						finish(e);
					}
				}
			};
			this.child.stdin.write(`${command}\n`);
		});
	}
	async analyze(fen) {
		await this.ready;
		let best;
		return this.exchange(`position fen ${fen}\ngo depth 16`, (l) => {
			if (l.startsWith("info ") && !/\b(?:lowerbound|upperbound)\b/.test(l)) {
				const score = l.match(/\bscore (cp|mate) (-?\d+)/), depth = l.match(/\bdepth (\d+)/), pv = l.match(/\bpv (.+)/);
				if (score && depth && pv) best = engineLine(fen, Number(depth[1]), {
					type: score[1],
					value: Number(score[2]) * (fen.split(" ")[1] === "b" ? -1 : 1)
				}, pv[1].trim().split(/\s+/));
			}
			if (l.startsWith("bestmove")) {
				if (!best) throw new Error("Engine returned no evaluation.");
				return { result: best };
			}
			return null;
		});
	}
	close() {
		this.child.stdin.end("quit\n");
		this.child.kill();
	}
};
//#endregion
export { SharedReviewService, engineLine };
