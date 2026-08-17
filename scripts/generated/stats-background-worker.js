import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
//#region node_modules/.pnpm/@badrap+result@0.2.13/node_modules/@badrap/result/dist/index.modern.mjs
var r = class {
	unwrap(r, t) {
		const e = this._chain((t) => n.ok(r ? r(t) : t), (r) => t ? n.ok(t(r)) : n.err(r));
		if (e.isErr) throw e.error;
		return e.value;
	}
	map(r, t) {
		return this._chain((t) => n.ok(r(t)), (r) => n.err(t ? t(r) : r));
	}
	chain(r, t) {
		return this._chain(r, t || ((r) => n.err(r)));
	}
};
var t = class extends r {
	constructor(r) {
		super(), this.value = void 0, this.isOk = !0, this.isErr = !1, this.value = r;
	}
	_chain(r, t) {
		return r(this.value);
	}
};
var e = class extends r {
	constructor(r) {
		super(), this.error = void 0, this.isOk = !1, this.isErr = !0, this.error = r;
	}
	_chain(r, t) {
		return t(this.error);
	}
};
var n;
(function(r) {
	r.ok = function(r) {
		return new t(r);
	}, r.err = function(r) {
		return new e(r || /* @__PURE__ */ new Error());
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
})(n || (n = {}));
//#endregion
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/squareSet.js
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
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/types.js
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
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/util.js
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
/**
* Converts a move to UCI notation, like `g1f3` for a normal move,
* `a7a8q` for promotion to a queen, and `Q@f7` for a Crazyhouse drop.
*/
var makeUci = (move) => isDrop(move) ? `${roleToChar(move.role).toUpperCase()}@${makeSquare(move.to)}` : makeSquare(move.from) + makeSquare(move.to) + (move.promotion ? roleToChar(move.promotion) : "");
var kingCastlesTo = (color, side) => color === "white" ? side === "a" ? 2 : 6 : side === "a" ? 58 : 62;
var rookCastlesTo = (color, side) => color === "white" ? side === "a" ? 3 : 5 : side === "a" ? 59 : 61;
//#endregion
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/attacks.js
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
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/board.js
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
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/chess.js
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
		if (this.board.occupied.isEmpty()) return n.err(new PositionError(IllegalSetup.Empty));
		if (this.board.king.size() !== 2) return n.err(new PositionError(IllegalSetup.Kings));
		if (!defined(this.board.kingOf(this.turn))) return n.err(new PositionError(IllegalSetup.Kings));
		const otherKing = this.board.kingOf(opposite(this.turn));
		if (!defined(otherKing)) return n.err(new PositionError(IllegalSetup.Kings));
		if (this.kingAttackers(otherKing, this.turn, this.board.occupied).nonEmpty()) return n.err(new PositionError(IllegalSetup.OppositeCheck));
		if (SquareSet.backranks().intersects(this.board.pawn)) return n.err(new PositionError(IllegalSetup.PawnsOnBackrank));
		return n.ok(void 0);
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
			return dests.has(move.to) || dests.has(normalizeMove(this, move).to);
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
var castlingSide = (pos, move) => {
	if (isDrop(move)) return;
	const delta = move.to - move.from;
	if (Math.abs(delta) !== 2 && !pos.board[pos.turn].has(move.to)) return;
	if (!pos.board.king.has(move.from)) return;
	return delta > 0 ? "h" : "a";
};
var normalizeMove = (pos, move) => {
	const side = castlingSide(pos, move);
	if (!side) return move;
	const rookFrom = pos.castles.rook[pos.turn][side];
	return {
		from: move.from,
		to: defined(rookFrom) ? rookFrom : move.to
	};
};
var INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/pgn.js
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
var DRAW_RESULTS = new Set([
	"agreed",
	"repetition",
	"stalemate",
	"insufficient",
	"50move",
	"timevsinsufficient"
]);
var CHESSCOM_API_URL = "https://api.chess.com/pub/player";
var LICHESS_API_URL = "https://lichess.org/api";
async function fetchStatsGames(opts) {
	const username = opts.username.trim();
	if (!username || opts.maxGames <= 0) return [];
	return opts.source === "chesscom" ? fetchChessComStatsGames({
		...opts,
		username
	}) : fetchLichessStatsGames({
		...opts,
		username
	});
}
async function fetchChessComStatsGames(opts) {
	const cutoff = Math.floor(Date.now() / 1e3) - opts.maxDays * 86400;
	const monthsCap = opts.monthsCap ?? Math.ceil(opts.maxDays / 28) + 1;
	const archiveIndex = await getChessComJson(`${CHESSCOM_API_URL}/${encodeURIComponent(opts.username)}/games/archives`, opts.signal);
	const archives = Array.isArray(archiveIndex.archives) ? archiveIndex.archives : [];
	const collected = [];
	let monthsFetched = 0;
	for (let i = archives.length - 1; i >= 0 && monthsFetched < monthsCap; i -= 1) {
		const archive = await getChessComJson(archives[i], opts.signal);
		monthsFetched += 1;
		const monthGames = normalizeChessComArchiveGames(archive.games, opts.username, opts.timeClass, opts.ratedFilter);
		const hasOlderGames = monthGames.some((game) => game.end < cutoff);
		for (const game of monthGames) if (game.end >= cutoff) collected.push(game);
		if (collected.length >= opts.maxGames || hasOlderGames) break;
	}
	collected.sort((a, b) => a.end - b.end);
	return collected.slice(-opts.maxGames);
}
async function getChessComJson(url, signal) {
	const response = await fetch(url, signal ? { signal } : void 0);
	if (!response.ok) throw new Error(`Chess.com request failed (${response.status}): ${url}`);
	return response.json();
}
function normalizeChessComArchiveGames(archiveGames, username, timeClass, ratedFilter) {
	const wantedUser = username.toLowerCase();
	const normalized = [];
	for (const game of Array.isArray(archiveGames) ? archiveGames : []) {
		if (!game || game.rules !== "chess" || game.time_class !== timeClass) continue;
		const isRated = game.rated === true;
		if (ratedFilter === "rated" && !isRated) continue;
		if (ratedFilter === "casual" && isRated) continue;
		const whiteName = game.white && typeof game.white.username === "string" ? game.white.username.toLowerCase() : "";
		const blackName = game.black && typeof game.black.username === "string" ? game.black.username.toLowerCase() : "";
		const mine = whiteName === wantedUser ? game.white : blackName === wantedUser ? game.black : null;
		if (!mine || typeof mine.rating !== "number" || typeof game.end_time !== "number") continue;
		const opponent = mine === game.white ? game.black : game.white;
		const oppRating = opponent && typeof opponent.rating === "number" && Number.isFinite(opponent.rating) ? opponent.rating : null;
		const pgn = typeof game.pgn === "string" ? game.pgn : null;
		const url = typeof game.url === "string" && game.url ? game.url : null;
		const color = mine === game.white ? "w" : "b";
		const myAccuracy = color === "w" ? game.accuracies?.white : game.accuracies?.black;
		const opponentAccuracy = color === "w" ? game.accuracies?.black : game.accuracies?.white;
		normalized.push({
			source: "chesscom",
			id: url ?? `chesscom-${game.end_time}-${wantedUser}`,
			url,
			end: game.end_time,
			start: parsePgnStart(pgn),
			rating: mine.rating,
			result: normalizeChessComResult(mine.result),
			termination: getChessComTermination(mine.result, opponent?.result),
			opp: oppRating,
			oppName: opponent && typeof opponent.username === "string" ? opponent.username : null,
			rated: isRated,
			color,
			timeClass: game.time_class,
			timeControl: parseChessComTimeControl(game.time_control),
			eco: getPgnHeader(pgn, "ECO"),
			openingName: getChessComOpeningName(pgn),
			pgn,
			...typeof myAccuracy === "number" && Number.isFinite(myAccuracy) ? { providerQuality: {
				provider: "chesscom",
				accuracy: myAccuracy,
				acpl: null,
				inaccuracies: null,
				mistakes: null,
				blunders: null
			} } : {},
			...typeof opponentAccuracy === "number" && Number.isFinite(opponentAccuracy) ? { opponentProviderQuality: {
				provider: "chesscom",
				accuracy: opponentAccuracy,
				acpl: null,
				inaccuracies: null,
				mistakes: null,
				blunders: null
			} } : {}
		});
	}
	normalized.sort((a, b) => a.end - b.end);
	return normalized;
}
function normalizeChessComResult(result) {
	if (result === "win") return "win";
	if (result !== void 0 && DRAW_RESULTS.has(result)) return "draw";
	return "loss";
}
function getChessComTermination(myResult, oppResult) {
	if (myResult === "win") return getChessComEndCode(oppResult);
	if (myResult !== void 0 && DRAW_RESULTS.has(myResult)) return "draw";
	return getChessComEndCode(myResult);
}
function getChessComEndCode(code) {
	if (code === "checkmated") return "checkmate";
	if (code === "resigned") return "resign";
	if (code === "timeout") return "timeout";
	if (code === "abandoned") return "abandon";
	if (code !== void 0 && DRAW_RESULTS.has(code)) return "draw";
	return "other";
}
function parseChessComTimeControl(value) {
	if (typeof value !== "string" || !value) return null;
	const daily = value.match(/^\d+\/(\d+)$/);
	if (daily) return {
		base: Number(daily[1]),
		inc: 0
	};
	const live = value.match(/^(\d+)(?:\+(\d+))?$/);
	if (!live) return null;
	return {
		base: Number(live[1]),
		inc: live[2] ? Number(live[2]) : 0
	};
}
function getChessComOpeningName(pgn) {
	const explicit = getPgnHeader(pgn, "Opening");
	if (explicit) return explicit;
	const ecoUrl = getPgnHeader(pgn, "ECOUrl");
	if (!ecoUrl) return null;
	const slug = ecoUrl.split("/").filter(Boolean).pop();
	if (!slug) return null;
	try {
		const name = decodeURIComponent(slug).replace(/-/g, " ").split(/\.{3}|\s\d+\.|^\d+\./)[0]?.trim() ?? "";
		if (!name || /^undefined$/i.test(name)) return null;
		return name;
	} catch {
		return null;
	}
}
function parsePgnStart(pgn) {
	if (typeof pgn !== "string") return null;
	const date = pgn.match(/\[UTCDate\s+"(\d{4})\.(\d{2})\.(\d{2})"\]/);
	const time = pgn.match(/\[UTCTime\s+"(\d{2}):(\d{2}):(\d{2})"\]/);
	if (!date || !time) return null;
	const value = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]), Number(time[3]));
	return Number.isNaN(value) ? null : value / 1e3;
}
function getPgnHeader(pgn, name) {
	if (typeof pgn !== "string") return null;
	return pgn.match(new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, "m"))?.[1] ?? null;
}
async function fetchLichessStatsGames(opts) {
	const cutoff = Math.floor(Date.now() / 1e3) - opts.maxDays * 86400;
	const url = new URL(`${LICHESS_API_URL}/games/user/${encodeURIComponent(opts.username)}`);
	url.searchParams.set("max", String(opts.maxGames));
	url.searchParams.set("perfType", opts.timeClass === "daily" ? "correspondence" : opts.timeClass);
	url.searchParams.set("sort", "dateDesc");
	url.searchParams.set("since", String(cutoff * 1e3));
	url.searchParams.set("pgnInJson", "true");
	url.searchParams.set("clocks", "true");
	url.searchParams.set("evals", "true");
	url.searchParams.set("accuracy", "true");
	url.searchParams.set("division", "true");
	url.searchParams.set("opening", "true");
	if (opts.ratedFilter === "rated") url.searchParams.set("rated", "true");
	const headers = { Accept: "application/x-ndjson" };
	if (opts.lichessToken) headers.Authorization = `Bearer ${opts.lichessToken}`;
	const response = await fetch(url.toString(), {
		headers,
		...opts.signal ? { signal: opts.signal } : {}
	});
	if (!response.ok) throw new Error(`Lichess request failed (${response.status}) for ${opts.username}.`);
	const games = [];
	for (const line of (await response.text()).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let raw;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const game = normalizeLichessGame(raw, opts.username, opts.timeClass);
		if (!game) continue;
		if (opts.ratedFilter === "casual" && game.rated) continue;
		if (opts.ratedFilter === "rated" && !game.rated) continue;
		if (game.end < cutoff) continue;
		games.push(game);
	}
	games.sort((a, b) => a.end - b.end);
	return games.slice(-opts.maxGames);
}
function normalizeLichessGame(game, username, requestedTimeClass) {
	if (!game || typeof game.id !== "string" || !game.id) return null;
	if (game.variant !== void 0 && game.variant !== "standard") return null;
	const wantedUser = username.toLowerCase();
	const white = game.players?.white;
	const black = game.players?.black;
	const whiteName = typeof white?.user?.name === "string" ? white.user.name.toLowerCase() : "";
	const blackName = typeof black?.user?.name === "string" ? black.user.name.toLowerCase() : "";
	const color = whiteName === wantedUser ? "w" : blackName === wantedUser ? "b" : null;
	if (!color) return null;
	const mine = color === "w" ? white : black;
	const opponent = color === "w" ? black : white;
	if (!mine || typeof mine.rating !== "number" || !Number.isFinite(mine.rating)) return null;
	const endMs = typeof game.lastMoveAt === "number" ? game.lastMoveAt : game.createdAt;
	if (typeof endMs !== "number" || !Number.isFinite(endMs)) return null;
	const result = game.winner === void 0 ? "draw" : game.winner === (color === "w" ? "white" : "black") ? "win" : "loss";
	const providerQuality = normalizeLichessProviderQuality(mine.analysis);
	const opponentProviderQuality = normalizeLichessProviderQuality(opponent?.analysis);
	return {
		source: "lichess",
		id: game.id,
		url: `https://lichess.org/${game.id}`,
		end: Math.floor(endMs / 1e3),
		start: typeof game.createdAt === "number" ? Math.floor(game.createdAt / 1e3) : null,
		rating: mine.rating + (typeof mine.ratingDiff === "number" ? mine.ratingDiff : 0),
		result,
		termination: getLichessTermination(game.status),
		opp: opponent && typeof opponent.rating === "number" && Number.isFinite(opponent.rating) ? opponent.rating : null,
		oppName: opponent && typeof opponent.user?.name === "string" ? opponent.user.name : null,
		rated: game.rated === true,
		color,
		timeClass: getLichessTimeClass(game.speed, requestedTimeClass),
		timeControl: typeof game.clock?.initial === "number" ? {
			base: game.clock.initial,
			inc: game.clock.increment ?? 0
		} : null,
		eco: typeof game.opening?.eco === "string" ? game.opening.eco : null,
		openingName: typeof game.opening?.name === "string" ? game.opening.name : null,
		pgn: typeof game.pgn === "string" ? game.pgn : null,
		...providerQuality ? { providerQuality } : {},
		...opponentProviderQuality ? { opponentProviderQuality } : {},
		...game.division ? { division: {
			middlegamePly: finiteOptionalNumber(game.division.middle),
			endgamePly: finiteOptionalNumber(game.division.end)
		} } : {}
	};
}
function normalizeLichessProviderQuality(value) {
	if (!value) return null;
	const accuracy = finiteOptionalNumber(value.accuracy);
	const acpl = finiteOptionalNumber(value.acpl);
	const inaccuracies = finiteOptionalNumber(value.inaccuracy);
	const mistakes = finiteOptionalNumber(value.mistake);
	const blunders = finiteOptionalNumber(value.blunder);
	if (accuracy === null && acpl === null && inaccuracies === null && mistakes === null && blunders === null) return null;
	return {
		provider: "lichess",
		accuracy,
		acpl,
		inaccuracies,
		mistakes,
		blunders
	};
}
function finiteOptionalNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function getLichessTermination(status) {
	if (status === "mate") return "checkmate";
	if (status === "resign") return "resign";
	if (status === "outoftime" || status === "timeout") return "timeout";
	if (status === "draw" || status === "stalemate") return "draw";
	if (status === "aborted") return "abandon";
	return "other";
}
function getLichessTimeClass(speed, requestedTimeClass) {
	if (speed === "ultraBullet" || speed === "bullet") return "bullet";
	if (speed === "blitz") return "blitz";
	if (speed === "rapid") return "rapid";
	if (speed === "classical") return "classical";
	if (speed === "correspondence") return "daily";
	return requestedTimeClass;
}
//#endregion
//#region node_modules/.pnpm/chessops@0.14.0/node_modules/chessops/dist/esm/san.js
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
//#region src/web/statsOpeningBook.ts
var bookPromise = null;
async function getOpeningBook() {
	if (!bookPromise) bookPromise = import("./statsOpeningBookData-pKi_zBsq.js").then((module) => module.default);
	return bookPromise;
}
var bookIndexCache = /* @__PURE__ */ new WeakMap();
function getBookIndex(book) {
	const cached = bookIndexCache.get(book);
	if (cached) return cached;
	const index = {
		prefixes: /* @__PURE__ */ new Set(),
		lines: /* @__PURE__ */ new Map()
	};
	for (const [eco, name, line] of book) {
		const sans = line.split(" ");
		let prefix = "";
		for (let i = 0; i < sans.length; i++) {
			prefix = i === 0 ? sans[0] : `${prefix} ${sans[i]}`;
			index.prefixes.add(prefix);
		}
		index.lines.set(line, {
			eco,
			name
		});
	}
	bookIndexCache.set(book, index);
	return index;
}
function matchBook(sans, book) {
	const index = getBookIndex(book);
	let plies = 0;
	let opening = null;
	let prefix = "";
	for (let i = 0; i < sans.length; i++) {
		prefix = i === 0 ? sans[0] : `${prefix} ${sans[i]}`;
		if (!index.prefixes.has(prefix)) break;
		plies = i + 1;
		const hit = index.lines.get(prefix);
		if (hit) opening = hit;
	}
	return {
		plies,
		eco: opening ? opening.eco : null,
		name: opening ? opening.name : null
	};
}
//#endregion
//#region src/web/statsStrength.ts
var CP_CEIL = 1e3;
function scoreToCp(score) {
	if (!score) return 0;
	if (typeof score.mate === "number") {
		if (score.mate === 0) return 0;
		return score.mate > 0 ? CP_CEIL : -CP_CEIL;
	}
	return Math.max(-CP_CEIL, Math.min(CP_CEIL, score.cp || 0));
}
function winPctWhite(score) {
	if (score && typeof score.mate === "number" && score.mate !== 0) return score.mate > 0 ? 100 : 0;
	const cp = scoreToCp(score);
	return 50 + 50 * (2 / (1 + Math.exp(-.00368208 * cp)) - 1);
}
function winPctFor(score, color) {
	const w = winPctWhite(score);
	return color === "w" ? w : 100 - w;
}
function moveAccuracy(drop) {
	if (drop <= 0) return 100;
	const raw = 103.1668 * Math.exp(-.04354 * drop) - 3.1669 + 1;
	return Math.max(0, Math.min(100, raw));
}
function stdev(values) {
	if (!values.length) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
	return Math.sqrt(variance);
}
function volatilityWeights(winPcts) {
	const n = Math.max(winPcts.length - 1, 1);
	const windowSize = Math.max(2, Math.min(8, Math.ceil(n / 10)));
	const weights = [];
	for (let k = 0; k < winPcts.length - 1; k++) {
		const from = Math.max(0, k + 2 - windowSize);
		const win = winPcts.slice(from, k + 2);
		weights.push(Math.max(.5, Math.min(12, stdev(win))));
	}
	return weights;
}
function gameAccuracy(accuracies, weights) {
	if (!accuracies.length) return null;
	let wSum = 0;
	let wTotal = 0;
	let hSum = 0;
	for (let i = 0; i < accuracies.length; i++) {
		const w = weights[i] || 1;
		wSum += accuracies[i] * w;
		wTotal += w;
		hSum += 1 / Math.max(accuracies[i], 1);
	}
	const weighted = wSum / wTotal;
	const harmonic = accuracies.length / hSum;
	return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
}
function majorMinorCount(fen) {
	const placement = fen.split(" ")[0];
	let count = 0;
	for (const ch of placement) if (/[nbrq]/i.test(ch)) count++;
	return count;
}
function assignPhases(fens, bookPlies) {
	const phases = [];
	let phase = "opening";
	const openingLimit = Math.max(bookPlies, 20);
	for (let i = 0; i < fens.length - 1; i++) {
		const count = majorMinorCount(fens[i]);
		if (count <= 6) phase = "endgame";
		else if (phase === "opening" && (count <= 10 || i >= openingLimit)) phase = "middlegame";
		phases.push(phase);
	}
	return phases;
}
function countLegalMoves(position) {
	let count = 0;
	for (const [from, dests] of position.allDests()) {
		const promotes = position.board.get(from)?.role === "pawn";
		for (const to of dests) {
			const rank = squareRank(to);
			count += promotes && (rank === 0 || rank === 7) ? 4 : 1;
		}
	}
	return count;
}
function standardUci(position, move) {
	if (!isNormal(move)) return null;
	const side = castlingSide(position, move);
	if (side) return makeUci({
		from: move.from,
		to: kingCastlesTo(position.turn, side)
	});
	return makeUci(move);
}
function replayGame(sans) {
	const position = Chess.default();
	const fens = [makeFen(position.toSetup())];
	const legalCounts = [countLegalMoves(position)];
	const uciMoves = [];
	const normalizedSans = [];
	for (const san of sans) {
		const move = parseSan(position, san);
		if (!move) return null;
		const uci = standardUci(position, move);
		if (!uci) return null;
		normalizedSans.push(makeSan(position, move));
		uciMoves.push(uci);
		position.play(move);
		fens.push(makeFen(position.toSetup()));
		legalCounts.push(countLegalMoves(position));
	}
	return {
		fens,
		legalCounts,
		uciMoves,
		sans: normalizedSans,
		terminalCheckmate: position.isCheckmate()
	};
}
function replayGamePositions(sans) {
	const replay = replayGame(sans);
	if (!replay) return null;
	return {
		fens: replay.fens,
		legalCounts: replay.legalCounts,
		uciMoves: replay.uciMoves
	};
}
function clockFeaturesForSide(sans, clocks, tc, bookPlies, color) {
	const threshold = Math.max(.8, tc.base * .015);
	const offset = color === "w" ? 0 : 1;
	let prev = tc.base;
	let considered = 0;
	let fast = 0;
	let scramble = 0;
	for (let i = offset; i < sans.length; i += 2) {
		const clk = clocks[i];
		if (clk === null || clk === void 0) {
			prev = null;
			continue;
		}
		if (prev !== null && i >= bookPlies) {
			considered++;
			if (prev - clk + tc.inc <= threshold) fast++;
			if (clk < tc.base * .12) scramble++;
		}
		prev = clk;
	}
	return considered >= 8 ? {
		fastRate: fast / considered,
		scramble: scramble / considered
	} : {
		fastRate: null,
		scramble: null
	};
}
function newBucket() {
	return {
		accs: [],
		accWeights: [],
		losses: [],
		complexitySum: 0
	};
}
function newDecisionBucket() {
	return {
		moves: 0,
		errors: 0,
		accuracySum: 0
	};
}
function addDecision(bucket, accuracy, isError) {
	bucket.moves += 1;
	bucket.accuracySum += accuracy;
	if (isError) bucket.errors += 1;
}
function decisionBucketStats(bucket) {
	return {
		moves: bucket.moves,
		errors: bucket.errors,
		accuracy: bucket.moves > 0 ? bucket.accuracySum / bucket.moves : null
	};
}
function bucketStats(bucket) {
	const n = bucket.accs.length;
	return {
		accuracy: n ? gameAccuracy(bucket.accs, bucket.accWeights) : null,
		acpl: n ? bucket.losses.reduce((a, b) => a + b, 0) / n : null,
		scoredCount: n,
		complexity: n ? bucket.complexitySum / n : 4.5
	};
}
async function buildGameQualityStats(input) {
	const { sans, evals, bestMoves, color, timeControl, clocks, analysisDepth, result } = input;
	if (!sans.length) return null;
	const replay = replayGame(sans);
	if (!replay) return null;
	const { fens, legalCounts, uciMoves, terminalCheckmate } = replay;
	const book = await getOpeningBook();
	const bookPlies = matchBook(replay.sans, book).plies;
	const n = sans.length;
	const scores = [];
	for (let i = 0; i <= n; i++) scores.push(evals[i] ?? null);
	if (!scores[n]) if (terminalCheckmate) scores[n] = { mate: ((n - 1) % 2 === 0 ? "w" : "b") === "w" ? 1 : -1 };
	else scores[n] = { cp: 0 };
	const fallbackScoreNear = (idx) => {
		const exact = scores[idx];
		if (exact) return exact;
		for (let d = 1; d <= n; d++) {
			const after = idx + d <= n ? scores[idx + d] : null;
			if (after) return after;
			const before = idx - d >= 0 ? scores[idx - d] : null;
			if (before) return before;
		}
		return { cp: 0 };
	};
	const winPcts = [];
	for (let i = 0; i <= n; i++) winPcts.push(winPctWhite(fallbackScoreNear(i)));
	const weights = volatilityWeights(winPcts);
	const movePhases = assignPhases(fens, bookPlies);
	const side = newBucket();
	const phaseBuckets = {
		opening: newBucket(),
		middlegame: newBucket(),
		endgame: newBucket()
	};
	const counts = {
		inaccuracy: 0,
		mistake: 0,
		blunder: 0
	};
	const phaseBlunders = {
		opening: 0,
		middlegame: 0,
		endgame: 0
	};
	const decisionBuckets = {
		advantage: newDecisionBucket(),
		defence: newDecisionBucket(),
		balanced: newDecisionBucket(),
		critical: newDecisionBucket(),
		fast: newDecisionBucket(),
		longThink: newDecisionBucket(),
		timeTrouble: newDecisionBucket()
	};
	let bookCount = 0;
	let blunders = 0;
	let hadWinningPosition = false;
	let hadLosingPosition = false;
	for (let i = 0; i < n; i++) {
		const moverColor = i % 2 === 0 ? "w" : "b";
		const isBook = i < bookPlies;
		const isForced = legalCounts[i] === 1;
		const posBefore = scores[i];
		const posAfter = scores[i + 1];
		if (!posBefore || !posAfter) {
			if (isBook && moverColor === color) bookCount += 1;
			continue;
		}
		if (moverColor === color) {
			const evalBeforeCp = moverColor === "w" ? scoreToCp(posBefore) : -scoreToCp(posBefore);
			if (evalBeforeCp >= 300) hadWinningPosition = true;
			if (evalBeforeCp <= -300) hadLosingPosition = true;
		}
		if (isBook || isForced) {
			if (isBook && moverColor === color) bookCount += 1;
			continue;
		}
		if (moverColor !== color) continue;
		const before = winPctFor(posBefore, moverColor);
		const after = winPctFor(posAfter, moverColor);
		const rawDrop = Math.max(0, before - after);
		const best = bestMoves?.[i] ?? null;
		const playedIsBest = best !== null && best === uciMoves[i] && rawDrop <= 6;
		const drop = playedIsBest ? 0 : rawDrop;
		const acc = moveAccuracy(drop);
		const isError = drop > 10;
		const cpBefore = moverColor === "w" ? scoreToCp(posBefore) : -scoreToCp(posBefore);
		const cpAfter = moverColor === "w" ? scoreToCp(posAfter) : -scoreToCp(posAfter);
		const cpLoss = playedIsBest ? 0 : Math.max(0, Math.min(CP_CEIL, cpBefore - cpAfter));
		const phase = movePhases[i];
		if (drop >= 20) {
			blunders += 1;
			counts.blunder += 1;
			phaseBlunders[phase] += 1;
		} else if (drop > 10) counts.mistake += 1;
		else if (drop > 5) counts.inaccuracy += 1;
		if (cpBefore >= 150) addDecision(decisionBuckets.advantage, acc, isError);
		else if (cpBefore <= -150) addDecision(decisionBuckets.defence, acc, isError);
		else addDecision(decisionBuckets.balanced, acc, isError);
		if ((weights[i] || 1) >= 3) addDecision(decisionBuckets.critical, acc, isError);
		if (timeControl) {
			const previousClock = i >= 2 ? clocks[i - 2] : timeControl.base;
			const currentClock = clocks[i];
			if (previousClock != null && currentClock != null) {
				const thinkSeconds = Math.max(0, previousClock + timeControl.inc - currentClock);
				const fastThreshold = Math.max(.8, timeControl.base * .015);
				const longThinkThreshold = Math.max(8, timeControl.base * .08);
				if (thinkSeconds <= fastThreshold) addDecision(decisionBuckets.fast, acc, isError);
				if (thinkSeconds >= longThinkThreshold) addDecision(decisionBuckets.longThink, acc, isError);
				if (previousClock <= timeControl.base * .12) addDecision(decisionBuckets.timeTrouble, acc, isError);
			}
		}
		side.accs.push(acc);
		side.accWeights.push(weights[i] || 1);
		side.losses.push(cpLoss);
		side.complexitySum += weights[i] || 1;
		const phaseBucket = phaseBuckets[phase];
		phaseBucket.accs.push(acc);
		phaseBucket.accWeights.push(weights[i] || 1);
		phaseBucket.losses.push(cpLoss);
		phaseBucket.complexitySum += weights[i] || 1;
	}
	let fastRate = null;
	let scramble = null;
	if (timeControl) {
		const clockFeatures = clockFeaturesForSide(sans, clocks, timeControl, bookPlies, color);
		fastRate = clockFeatures.fastRate;
		scramble = clockFeatures.scramble;
	}
	const base = bucketStats(side);
	const stats = {
		accuracy: base.accuracy,
		acpl: base.acpl,
		scoredCount: base.scoredCount,
		complexity: base.complexity,
		bookMoves: bookCount,
		blunderRate: base.scoredCount ? blunders / base.scoredCount : 0,
		fastRate,
		scramble,
		analysisDepth
	};
	const phases = {
		opening: bucketStats(phaseBuckets.opening),
		middlegame: bucketStats(phaseBuckets.middlegame),
		endgame: bucketStats(phaseBuckets.endgame)
	};
	let openingExitWinPct = null;
	for (let index = movePhases.length - 1; index >= 0; index -= 1) {
		if (movePhases[index] !== "opening") continue;
		openingExitWinPct = winPctFor(fallbackScoreNear(index + 1), color);
		break;
	}
	const move15Score = n >= 30 ? fallbackScoreNear(30) : null;
	const move15EvalCp = move15Score ? color === "w" ? scoreToCp(move15Score) : -scoreToCp(move15Score) : null;
	const endgameEntryIndex = movePhases.findIndex((phase) => phase === "endgame");
	const endgameEntryScore = endgameEntryIndex >= 0 ? fallbackScoreNear(endgameEntryIndex) : null;
	const endgameEntryEvalCp = endgameEntryScore ? color === "w" ? scoreToCp(endgameEntryScore) : -scoreToCp(endgameEntryScore) : null;
	return {
		stats,
		phases,
		counts,
		phaseBlunders,
		advanced: {
			advantage: decisionBucketStats(decisionBuckets.advantage),
			defence: decisionBucketStats(decisionBuckets.defence),
			balanced: decisionBucketStats(decisionBuckets.balanced),
			critical: decisionBucketStats(decisionBuckets.critical),
			fast: decisionBucketStats(decisionBuckets.fast),
			longThink: decisionBucketStats(decisionBuckets.longThink),
			timeTrouble: decisionBucketStats(decisionBuckets.timeTrouble),
			hadWinningPosition,
			convertedWinningPosition: hadWinningPosition && result ? result === "win" : null,
			hadLosingPosition,
			savedLosingPosition: hadLosingPosition && result ? result !== "loss" : null,
			openingExitWinPct,
			move15EvalCp,
			endgameEntryEvalCp
		},
		plies: n
	};
}
//#endregion
//#region scripts/stats-background-worker.ts
var args = parseArgs(process.argv.slice(2));
var configPath = requiredArg("config");
var gamesPath = requiredArg("games");
var entriesPath = requiredArg("entries");
var statusPath = requiredArg("status");
var backend = new URL(args.get("backend") || "http://127.0.0.1:38419");
var config = normalizeConfig(await readJson(configPath));
var existing = await readJson(entriesPath);
var entriesByKey = new Map((Array.isArray(existing?.entries) ? existing.entries : []).map((entry) => [entry.key, entry]));
var totalCloudHits = 0;
var totalPcPositions = 0;
var totalPcNodes = 0;
var gamesWithCloudCoverage = 0;
await writeStatus({
	state: "fetching",
	startedAt: Date.now(),
	depth: config.depth,
	nodesPerPosition: config.nodesPerPosition || null,
	cloudPolicy: "lichess-local-until-first-miss-then-pc"
});
try {
	const cloudStore = await requireLocalCloudStore();
	await writeStatus({
		state: "fetching",
		depth: config.depth,
		cloudStore
	});
	const games = await fetchAllGames(config);
	await atomicJson(gamesPath, {
		v: 1,
		updatedAt: Date.now(),
		games
	});
	const skipped = games.map((game) => ({
		game,
		reason: statsAnalysisSkipReason(game)
	})).filter((item) => Boolean(item.reason));
	const skippedKeys = new Set(skipped.map(({ game }) => gameKey(game)));
	const eligibleGames = games.filter((game) => !skippedKeys.has(gameKey(game)));
	const skippedReasons = Object.fromEntries(Array.from(new Set(skipped.map(({ reason }) => reason))).map((reason) => [reason, skipped.filter((item) => item.reason === reason).length]));
	const candidates = eligibleGames.filter((game) => !hasCompletedBatch(entriesByKey.get(gameKey(game)))).sort((a, b) => b.end - a.end);
	let completed = 0;
	let failed = 0;
	for (const game of candidates) {
		await writeStatus({
			state: "analyzing",
			startedAt: Number((await readJson(statusPath))?.startedAt) || Date.now(),
			depth: config.depth,
			totalGames: games.length,
			eligibleGames: eligibleGames.length,
			skippedGames: skipped.length,
			skippedReasons,
			queuedGames: candidates.length,
			completedGames: completed,
			failedGames: failed,
			analysis: analysisProgress(),
			current: {
				key: gameKey(game),
				opponent: game.oppName,
				end: game.end
			}
		});
		try {
			const entry = await analyzeGame(game, config.depth, config.nodesPerPosition);
			if (entry) {
				entriesByKey.set(entry.key, entry);
				await saveEntries();
			} else failed += 1;
		} catch (error) {
			failed += 1;
			await writeStatus({
				state: "analyzing",
				depth: config.depth,
				totalGames: games.length,
				queuedGames: candidates.length,
				completedGames: completed,
				failedGames: failed,
				analysis: analysisProgress(),
				lastError: publicError(error)
			});
		}
		completed += 1;
	}
	await saveEntries();
	const eligibleAnalyzedGames = eligibleGames.filter((game) => hasCompletedBatch(entriesByKey.get(gameKey(game)))).length;
	await writeStatus({
		state: "idle",
		finishedAt: Date.now(),
		depth: config.depth,
		totalGames: games.length,
		analyzedGames: entriesByKey.size,
		eligibleGames: eligibleGames.length,
		eligibleAnalyzedGames,
		skippedGames: skipped.length,
		skippedReasons,
		analysisComplete: eligibleAnalyzedGames === eligibleGames.length && failed === 0,
		queuedGames: 0,
		completedGames: completed,
		failedGames: failed,
		analysis: analysisProgress()
	});
} catch (error) {
	await writeStatus({
		state: "error",
		finishedAt: Date.now(),
		error: publicError(error)
	});
	throw error;
}
function hasCompletedBatch(entry) {
	return Boolean(entry?.advanced && entry.opponentQuality?.advanced && (entry.batchAnalysis?.targetDepth || 0) >= config.depth && (entry.batchAnalysis?.nodeLimit === null || (entry.batchAnalysis?.nodeLimit || 0) >= config.nodesPerPosition) && entry.batchAnalysis?.policy === "lichess-local-until-first-miss-then-pc");
}
function statsAnalysisSkipReason(game) {
	if (!game.pgn?.trim()) return "missing-pgn";
	if (/\[\s*SetUp\s+"1"\s*\]/i.test(game.pgn) && /\[\s*FEN\s+"/i.test(game.pgn)) return "custom-start-position";
	try {
		return extractPgnMoves(game.pgn).sans.length > 0 ? null : "no-moves";
	} catch {
		return "invalid-pgn";
	}
}
async function fetchAllGames(workerConfig) {
	const collected = [];
	for (const source of ["chesscom", "lichess"]) {
		const username = workerConfig.accounts[source]?.trim();
		if (!username) continue;
		const timeClasses = source === "chesscom" ? [
			"bullet",
			"blitz",
			"rapid",
			"daily"
		] : [
			"bullet",
			"blitz",
			"rapid",
			"classical",
			"daily"
		];
		for (const timeClass of timeClasses) {
			const games = await fetchStatsGames({
				source,
				username,
				timeClass,
				ratedFilter: "both",
				maxGames: 5e3,
				maxDays: workerConfig.historyDays,
				monthsCap: Math.ceil(workerConfig.historyDays / 28) + 1
			});
			collected.push(...games);
		}
	}
	const unique = /* @__PURE__ */ new Map();
	for (const game of collected) unique.set(gameKey(game), game);
	return Array.from(unique.values()).sort((a, b) => a.end - b.end);
}
async function requireLocalCloudStore() {
	const response = await fetch(new URL("/v1/health", backend), { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`Stockfish health check returned HTTP ${response.status}.`);
	const data = await response.json();
	if (!data.localEvals?.available) throw new Error(data.localEvals?.error || "The complete local Lichess cloud-eval store is not ready yet.");
	return {
		available: true,
		positions: Math.max(0, Number(data.localEvals.positions) || 0),
		builtAt: Number(data.localEvals.builtAt) || null
	};
}
async function analyzeGame(game, depth, nodesPerPosition) {
	if (!game.pgn) return null;
	const { sans, clocks } = extractPgnMoves(game.pgn);
	if (!sans.length) return null;
	const evaluated = await evaluatePositions(sans, depth, nodesPerPosition);
	if (!evaluated) return null;
	const { evals, bestMoves, analysisDepth } = evaluated;
	totalCloudHits += evaluated.cloudHits;
	totalPcPositions += evaluated.pcPositions;
	totalPcNodes += evaluated.pcNodes;
	if (evaluated.cloudHits > 0) gamesWithCloudCoverage += 1;
	const quality = await buildGameQualityStats({
		sans,
		evals,
		bestMoves,
		color: game.color,
		timeControl: game.timeControl,
		clocks,
		analysisDepth,
		result: game.result
	});
	const opponentQuality = await buildGameQualityStats({
		sans,
		evals,
		bestMoves,
		color: game.color === "w" ? "b" : "w",
		timeControl: game.timeControl,
		clocks,
		analysisDepth,
		result: game.result === "win" ? "loss" : game.result === "loss" ? "win" : "draw"
	});
	if (!quality || !opponentQuality) return null;
	return {
		v: 2,
		ts: Date.now(),
		key: gameKey(game),
		end: game.end,
		source: game.source,
		url: game.url,
		timeControl: game.timeControl,
		color: game.color,
		opponent: game.oppName,
		opp: game.opp,
		result: game.result,
		plies: quality.plies,
		eco: game.eco,
		openingName: game.openingName,
		stats: quality.stats,
		phases: quality.phases,
		counts: quality.counts,
		phaseBlunders: quality.phaseBlunders,
		advanced: quality.advanced,
		batchAnalysis: {
			targetDepth: depth,
			nodeLimit: nodesPerPosition || null,
			cloudHits: evaluated.cloudHits,
			firstCloudMissPly: evaluated.firstCloudMissPly,
			pcPositions: evaluated.pcPositions,
			pcNodes: evaluated.pcNodes,
			policy: "lichess-local-until-first-miss-then-pc"
		},
		opponentQuality: {
			stats: opponentQuality.stats,
			phases: opponentQuality.phases,
			counts: opponentQuality.counts,
			phaseBlunders: opponentQuality.phaseBlunders,
			advanced: opponentQuality.advanced
		}
	};
}
async function evaluatePositions(sans, depth, nodesPerPosition) {
	const replay = replayGamePositions(sans);
	if (!replay) return null;
	const fens = replay.fens.length === sans.length + 1 ? replay.fens : [INITIAL_FEN, ...replay.fens];
	if (fens.length !== sans.length + 1) return null;
	const evals = new Array(fens.length).fill(null);
	const bestMoves = new Array(fens.length).fill(null);
	let minimumDepth = Number.POSITIVE_INFINITY;
	let useCloud = true;
	let cloudHits = 0;
	let firstCloudMissPly = null;
	let pcPositions = 0;
	let pcNodes = 0;
	for (let index = 0; index < fens.length; index += 1) {
		if (useCloud) {
			const cloud = await lookupStoredCloudPosition(fens[index]);
			if (cloud) {
				evals[index] = cloud.score;
				bestMoves[index] = cloud.bestMove;
				minimumDepth = Math.min(minimumDepth, cloud.depth);
				cloudHits += 1;
				continue;
			}
			useCloud = false;
			firstCloudMissPly = index;
		}
		const line = await analyzePosition(fens[index], depth, nodesPerPosition);
		if (!line) continue;
		evals[index] = line.score;
		bestMoves[index] = line.bestMove;
		minimumDepth = Math.min(minimumDepth, line.depth);
		pcPositions += 1;
		pcNodes += line.nodes;
	}
	if (!Number.isFinite(minimumDepth)) return null;
	return {
		evals,
		bestMoves,
		analysisDepth: minimumDepth,
		cloudHits,
		firstCloudMissPly,
		pcPositions,
		pcNodes
	};
}
async function lookupStoredCloudPosition(fen) {
	const url = new URL("/v1/cloud-eval", backend);
	url.searchParams.set("fen", fen);
	url.searchParams.set("multipv", "1");
	const response = await fetch(url, { headers: { accept: "application/json" } });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Stored Lichess cloud eval returned HTTP ${response.status}.`);
	const data = await response.json();
	const pv = data.pvs?.[0];
	const depth = Math.max(0, Math.round(Number(data.depth) || 0));
	const bestMove = String(pv?.moves || "").trim().split(/\s+/)[0] || null;
	const score = Number.isFinite(pv?.cp) ? { cp: Number(pv?.cp) } : Number.isFinite(pv?.mate) ? { mate: Number(pv?.mate) } : null;
	if (!score || !bestMove || depth < 1) return null;
	return {
		score,
		bestMove,
		depth,
		nodes: Math.max(0, Number(data.knodes) || 0) * 1e3
	};
}
async function analyzePosition(fen, depth, nodesPerPosition) {
	const response = await fetch(new URL("/v1/analyze", backend), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/x-ndjson"
		},
		body: JSON.stringify({
			fen,
			multipv: 1,
			depth,
			...nodesPerPosition > 0 ? { nodes: nodesPerPosition } : {}
		})
	});
	if (!response.ok) throw new Error(`Stockfish returned HTTP ${response.status}.`);
	let result = null;
	for (const raw of (await response.text()).split(/\r?\n/)) {
		if (!raw.trim()) continue;
		let event;
		try {
			event = JSON.parse(raw);
		} catch {
			continue;
		}
		if (event.type !== "uci" || !event.line?.startsWith("info ")) continue;
		const tokens = event.line.trim().split(/\s+/);
		const scoreAt = tokens.indexOf("score");
		const pvAt = tokens.indexOf("pv");
		if (scoreAt < 0 || pvAt < 0) continue;
		const value = Number.parseInt(tokens[scoreAt + 2] || "", 10);
		const lineDepth = Number.parseInt(tokens[tokens.indexOf("depth") + 1] || "0", 10);
		const lineNodes = Number.parseInt(tokens[tokens.indexOf("nodes") + 1] || "0", 10);
		if (!Number.isFinite(value) || !Number.isFinite(lineDepth)) continue;
		const normalized = fen.split(/\s+/)[1] !== "b" ? value : -value;
		result = {
			score: tokens[scoreAt + 1] === "mate" ? { mate: normalized } : { cp: normalized },
			bestMove: tokens[pvAt + 1] || null,
			depth: lineDepth,
			nodes: Number.isFinite(lineNodes) ? lineNodes : 0
		};
	}
	return result;
}
function extractPgnMoves(pgn) {
	const sans = [];
	const clocks = [];
	for (const node of mainlineNodes(pgn)) {
		sans.push(node.data.san);
		let clock = null;
		for (const comment of node.data.comments || []) {
			const parsed = parseComment(comment).clock;
			if (typeof parsed === "number" && Number.isFinite(parsed)) clock = parsed;
		}
		clocks.push(clock);
	}
	return {
		sans,
		clocks
	};
}
function mainlineNodes(pgn) {
	const parsed = parsePgn(pgn)[0];
	if (!parsed) return [];
	const nodes = [];
	let node = parsed.moves.children[0];
	while (node) {
		nodes.push(node);
		node = node.children[0];
	}
	return nodes;
}
async function saveEntries() {
	const entries = Array.from(entriesByKey.values()).sort((a, b) => b.end - a.end);
	await atomicJson(entriesPath, {
		v: 1,
		updatedAt: Date.now(),
		entries
	});
}
async function writeStatus(value) {
	await atomicJson(statusPath, {
		...await readJson(statusPath) || {},
		...value,
		pid: process.pid,
		updatedAt: Date.now()
	});
}
function analysisProgress() {
	return {
		targetDepth: config.depth,
		nodeLimit: config.nodesPerPosition || null,
		cloudPolicy: "lichess-local-until-first-miss-then-pc",
		cloudHits: totalCloudHits,
		gamesWithCloudCoverage,
		pcPositions: totalPcPositions,
		pcNodes: totalPcNodes
	};
}
async function atomicJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
	await rename(temporary, path).catch(async () => {
		await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
	});
}
async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}
function normalizeConfig(value) {
	return {
		accounts: {
			chesscom: String(value?.accounts?.chesscom || "").trim(),
			lichess: String(value?.accounts?.lichess || "").trim()
		},
		historyDays: Math.max(1, Math.min(3650, Math.round(value?.historyDays || 365))),
		depth: Math.max(8, Math.min(30, Math.round(value?.depth || 16))),
		nodesPerPosition: Math.max(0, Math.min(2e9, Math.round(value?.nodesPerPosition ?? 1e6)))
	};
}
function gameKey(game) {
	return `${game.source}|${game.id}`;
}
function parseArgs(values) {
	const parsed = /* @__PURE__ */ new Map();
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index]?.replace(/^--/, "");
		if (key) parsed.set(key, values[index + 1] || "");
	}
	return parsed;
}
function requiredArg(name) {
	const value = args.get(name);
	if (!value) throw new Error(`Missing --${name}.`);
	return value;
}
function publicError(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export {};
