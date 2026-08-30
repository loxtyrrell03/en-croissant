/**
 * Named checkmate-pattern detection for final FEN positions.
 *
 * This module is deliberately self-contained: it has no DOM, storage, engine,
 * or application dependencies, so the site classifier and En Croissant can
 * share it. Detection is gated behind a legal checkmate check. Pattern rules
 * then use conservative piece geometry; a familiar-looking position which is
 * merely check, stalemate, or an illegal FEN never receives a named-mate tag.
 */

export const NAMED_MATE_PATTERN_IDS = Object.freeze([
  'anastasiaMate',
  'arabianMate',
  'backRankMate',
  'balestraMate',
  'blindSwineMate',
  'bodenMate',
  'cornerMate',
  'doubleBishopMate',
  'dovetailMate',
  'epauletteMate',
  'hookMate',
  'killBoxMate',
  'pillsburysMate',
  'morphysMate',
  'operaMate',
  'swallowstailMate',
  'triangleMate',
  'vukovicMate',
  'smotheredMate',
]);

const FILES = 'abcdefgh';
const PIECES = new Set('prnbqkPRNBQK');
const KNIGHT_STEPS = Object.freeze([
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
]);
const DIAGONALS = Object.freeze([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
const ORTHOGONALS = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);
const KING_STEPS = Object.freeze([...DIAGONALS, ...ORTHOGONALS]);

function indexOf(row, col) {
  return row * 8 + col;
}

function rowOf(square) {
  return Math.floor(square / 8);
}

function colOf(square) {
  return square % 8;
}

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function offsetSquare(square, dr, dc) {
  const row = rowOf(square) + dr;
  const col = colOf(square) + dc;
  return inBounds(row, col) ? indexOf(row, col) : -1;
}

function squareName(square) {
  return `${FILES[colOf(square)]}${8 - rowOf(square)}`;
}

function squareIndex(name) {
  if (!/^[a-h][1-8]$/.test(name || '')) return -1;
  return indexOf(8 - Number(name[1]), FILES.indexOf(name[0]));
}

function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

function typeOf(piece) {
  return piece ? piece.toUpperCase() : null;
}

function otherColor(color) {
  return color === 'w' ? 'b' : 'w';
}

function parseFen(fen) {
  if (typeof fen !== 'string' || !fen.trim()) {
    throw new Error('FEN must be a non-empty string');
  }

  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2 || fields.length > 6) {
    throw new Error('FEN must contain between two and six fields');
  }

  const ranks = fields[0].split('/');
  if (ranks.length !== 8) throw new Error('FEN board must contain eight ranks');

  const board = new Array(64).fill(null);
  for (let row = 0; row < 8; row += 1) {
    let col = 0;
    for (const token of ranks[row]) {
      if (/^[1-8]$/.test(token)) {
        col += Number(token);
      } else if (PIECES.has(token)) {
        if (col >= 8) throw new Error(`FEN rank ${8 - row} is too wide`);
        board[indexOf(row, col)] = token;
        col += 1;
      } else {
        throw new Error(`Invalid FEN piece token: ${token}`);
      }
    }
    if (col !== 8) throw new Error(`FEN rank ${8 - row} does not contain eight files`);
  }

  const turn = fields[1];
  if (turn !== 'w' && turn !== 'b') throw new Error('FEN active color must be w or b');

  const castling = fields[2] || '-';
  if (castling !== '-' && !/^(?!.*(.).*\1)[KQkq]+$/.test(castling)) {
    throw new Error('Invalid FEN castling field');
  }

  const ep = fields[3] || '-';
  if (ep !== '-' && !/^[a-h][36]$/.test(ep)) throw new Error('Invalid FEN en-passant field');

  const halfmove = fields[4] === undefined ? 0 : Number(fields[4]);
  const fullmove = fields[5] === undefined ? 1 : Number(fields[5]);
  if (!Number.isInteger(halfmove) || halfmove < 0) throw new Error('Invalid FEN halfmove clock');
  if (!Number.isInteger(fullmove) || fullmove < 1) throw new Error('Invalid FEN fullmove number');

  return {
    board,
    turn,
    castling,
    epSquare: ep === '-' ? -1 : squareIndex(ep),
    halfmove,
    fullmove,
  };
}

function piecesOf(board, color, type = null) {
  const result = [];
  for (let square = 0; square < 64; square += 1) {
    const piece = board[square];
    if (piece && colorOf(piece) === color && (!type || typeOf(piece) === type)) {
      result.push(square);
    }
  }
  return result;
}

function kingSquare(board, color) {
  const kings = piecesOf(board, color, 'K');
  return kings.length === 1 ? kings[0] : -1;
}

/** Return pseudo-attackers. Pins intentionally do not erase attacks. */
function attackers(board, target, color) {
  const result = [];
  const row = rowOf(target);
  const col = colOf(target);

  const pawn = color === 'w' ? 'P' : 'p';
  const pawnSourceDr = color === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const sourceRow = row + pawnSourceDr;
    const sourceCol = col + dc;
    if (inBounds(sourceRow, sourceCol)) {
      const source = indexOf(sourceRow, sourceCol);
      if (board[source] === pawn) result.push(source);
    }
  }

  const knight = color === 'w' ? 'N' : 'n';
  for (const [dr, dc] of KNIGHT_STEPS) {
    const sourceRow = row + dr;
    const sourceCol = col + dc;
    if (inBounds(sourceRow, sourceCol)) {
      const source = indexOf(sourceRow, sourceCol);
      if (board[source] === knight) result.push(source);
    }
  }

  const king = color === 'w' ? 'K' : 'k';
  for (const [dr, dc] of KING_STEPS) {
    const sourceRow = row + dr;
    const sourceCol = col + dc;
    if (inBounds(sourceRow, sourceCol)) {
      const source = indexOf(sourceRow, sourceCol);
      if (board[source] === king) result.push(source);
    }
  }

  const bishop = color === 'w' ? 'B' : 'b';
  const rook = color === 'w' ? 'R' : 'r';
  const queen = color === 'w' ? 'Q' : 'q';
  for (const [dr, dc] of DIAGONALS) {
    let scanRow = row + dr;
    let scanCol = col + dc;
    while (inBounds(scanRow, scanCol)) {
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
    while (inBounds(scanRow, scanCol)) {
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
    moves.push({ from, to, epCapture });
    return;
  }
  for (const promotion of ['Q', 'R', 'B', 'N']) {
    moves.push({ from, to, epCapture, promotion });
  }
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

    if (type === 'P') {
      const direction = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      const promotionRow = turn === 'w' ? 0 : 7;
      const oneRow = row + direction;
      if (inBounds(oneRow, col)) {
        const one = indexOf(oneRow, col);
        if (!board[one]) {
          addPawnMove(moves, from, one, promotionRow);
          const twoRow = row + 2 * direction;
          if (row === startRow && inBounds(twoRow, col)) {
            const two = indexOf(twoRow, col);
            if (!board[two]) moves.push({ from, to: two, epCapture: -1 });
          }
        }
      }
      for (const dc of [-1, 1]) {
        const targetRow = row + direction;
        const targetCol = col + dc;
        if (!inBounds(targetRow, targetCol)) continue;
        const to = indexOf(targetRow, targetCol);
        const targetPiece = board[to];
        if (targetPiece && colorOf(targetPiece) !== turn && typeOf(targetPiece) !== 'K') {
          addPawnMove(moves, from, to, promotionRow);
        } else if (to === epSquare && !targetPiece) {
          const captured = indexOf(row, targetCol);
          const expectedPawn = turn === 'w' ? 'p' : 'P';
          if (board[captured] === expectedPawn) {
            addPawnMove(moves, from, to, promotionRow, captured);
          }
        }
      }
      continue;
    }

    if (type === 'N' || type === 'K') {
      const steps = type === 'N' ? KNIGHT_STEPS : KING_STEPS;
      for (const [dr, dc] of steps) {
        const targetRow = row + dr;
        const targetCol = col + dc;
        if (!inBounds(targetRow, targetCol)) continue;
        const to = indexOf(targetRow, targetCol);
        const target = board[to];
        if (!target || (colorOf(target) !== turn && typeOf(target) !== 'K')) {
          moves.push({ from, to, epCapture: -1 });
        }
      }
      continue;
    }

    const directions = type === 'B' ? DIAGONALS : type === 'R' ? ORTHOGONALS : KING_STEPS;
    for (const [dr, dc] of directions) {
      let targetRow = row + dr;
      let targetCol = col + dc;
      while (inBounds(targetRow, targetCol)) {
        const to = indexOf(targetRow, targetCol);
        const target = board[to];
        if (!target) {
          moves.push({ from, to, epCapture: -1 });
        } else {
          if (colorOf(target) !== turn && typeOf(target) !== 'K') {
            moves.push({ from, to, epCapture: -1 });
          }
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
  next[move.to] = move.promotion
    ? (moverColor === 'w' ? move.promotion : move.promotion.toLowerCase())
    : piece;
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
  // Castling is intentionally absent: a side currently in check may not castle.
  return false;
}

function validatePosition(position) {
  const { board, turn } = position;
  const whiteKings = piecesOf(board, 'w', 'K');
  const blackKings = piecesOf(board, 'b', 'K');
  if (whiteKings.length !== 1 || blackKings.length !== 1) {
    return 'A legal position must contain exactly one king of each color';
  }

  const whiteKing = whiteKings[0];
  const blackKing = blackKings[0];
  if (Math.max(
    Math.abs(rowOf(whiteKing) - rowOf(blackKing)),
    Math.abs(colOf(whiteKing) - colOf(blackKing)),
  ) <= 1) {
    return 'Kings may not occupy adjacent squares';
  }

  for (let col = 0; col < 8; col += 1) {
    if (typeOf(board[indexOf(0, col)]) === 'P' || typeOf(board[indexOf(7, col)]) === 'P') {
      return 'An unpromoted pawn may not occupy the first or eighth rank';
    }
  }

  // The player who made the preceding move may not have left their own king attacked.
  const attacker = otherColor(turn);
  const attackerKing = kingSquare(board, attacker);
  if (attackers(board, attackerKing, turn).length > 0) {
    return 'The side not to move has its king in check';
  }
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
  return { dr: rowOf(to) - rowOf(from), dc: colOf(to) - colOf(from) };
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
  const protectedBy = (square, excludedType = null) => attackers(position.board, square, attacker)
    .filter((source) => source !== square && (!excludedType || typeOf(position.board[source]) !== excludedType));

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
    protectedBy,
  };
}

function hasAnastasiaMate(ctx) {
  if (isCorner(ctx.king) || !isOnEdge(ctx.king)) return false;
  const edgeRules = [];
  const row = rowOf(ctx.king);
  const col = colOf(ctx.king);
  if (col === 0) edgeRules.push({ nr: 0, nc: 1, sameAxis: (sq) => colOf(sq) === col });
  if (col === 7) edgeRules.push({ nr: 0, nc: -1, sameAxis: (sq) => colOf(sq) === col });
  if (row === 0) edgeRules.push({ nr: 1, nc: 0, sameAxis: (sq) => rowOf(sq) === row });
  if (row === 7) edgeRules.push({ nr: -1, nc: 0, sameAxis: (sq) => rowOf(sq) === row });

  for (const rule of edgeRules) {
    const inner = offsetSquare(ctx.king, rule.nr, rule.nc);
    if (inner < 0 || colorOf(ctx.board[inner]) !== ctx.defender) continue;
    const diagonalEscapes = rule.nr === 0
      ? [offsetSquare(ctx.king, -1, rule.nc), offsetSquare(ctx.king, 1, rule.nc)]
      : [offsetSquare(ctx.king, rule.nr, -1), offsetSquare(ctx.king, rule.nr, 1)];
    if (diagonalEscapes.some((square) => square < 0)) continue;
    const knight = ctx.byType('N').some((square) => (
      diagonalEscapes.every((target) => pieceAttacks(ctx.board, square, target))
    ));
    const rookChecker = ctx.checkerType('R').some(rule.sameAxis);
    if (knight && rookChecker) return true;
  }
  return false;
}

function hasArabianMate(ctx) {
  if (!isCorner(ctx.king)) return false;
  const orthogonalRing = ORTHOGONALS
    .map(([dr, dc]) => offsetSquare(ctx.king, dr, dc))
    .filter((square) => square >= 0);
  for (const rook of ctx.checkerType('R')) {
    if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
    const otherEscape = orthogonalRing.find((square) => square !== rook);
    if (otherEscape < 0) continue;
    if (ctx.byType('N').some((knight) => (
      pieceAttacks(ctx.board, knight, rook)
      && pieceAttacks(ctx.board, knight, otherEscape)
    ))) return true;
  }
  return false;
}

function hasBackRankMate(ctx) {
  const homeRow = ctx.defender === 'w' ? 7 : 0;
  if (rowOf(ctx.king) !== homeRow) return false;
  const inward = ctx.defender === 'w' ? -1 : 1;
  const blockers = [-1, 0, 1]
    .map((dc) => offsetSquare(ctx.king, inward, dc))
    .filter((square) => square >= 0);
  if (blockers.length < 2 || blockers.some((square) => colorOf(ctx.board[square]) !== ctx.defender)) {
    return false;
  }
  return ctx.checkers.some((checker) => {
    const type = typeOf(ctx.board[checker]);
    return (type === 'R' || type === 'Q') && rowOf(checker) === homeRow;
  });
}

function hasBalestraMate(ctx) {
  if (ctx.checkerType('B').length === 0) return false;
  return ctx.byType('Q').some((queen) => {
    if (ctx.checkers.includes(queen)) return false;
    const { dr, dc } = relative(ctx.king, queen);
    const distances = [Math.abs(dr), Math.abs(dc)].sort((a, b) => a - b);
    return distances[0] === 1 && distances[1] === 2 && ctx.controlsRing(queen).length >= 2;
  });
}

function hasBlindSwineMate(ctx) {
  for (const rook of ctx.checkerType('R')) {
    if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
    const { dr, dc } = relative(ctx.king, rook);
    const perpendiculars = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    for (const [pr, pc] of perpendiculars) {
      const partner = offsetSquare(rook, pr, pc);
      if (
        partner >= 0
        && ctx.board[partner]
        && colorOf(ctx.board[partner]) === ctx.attacker
        && typeOf(ctx.board[partner]) === 'R'
        && isDiagonallyAdjacent(partner, ctx.king)
      ) return true;
    }
  }
  return false;
}

function hasBodenMate(ctx) {
  if (ctx.ownBlockers.length < 2) return false;
  for (const checker of ctx.checkerType('B')) {
    const checkerFamily = diagonalFamily(checker, ctx.king);
    for (const bishop of ctx.byType('B')) {
      if (bishop === checker) continue;
      if (ctx.ring.some((target) => (
        pieceAttacks(ctx.board, bishop, target)
        && diagonalFamily(bishop, target) === -checkerFamily
      ))) return true;
    }
  }
  return false;
}

function hasDoubleBishopMate(ctx) {
  if (ctx.ownBlockers.length < 1) return false;
  for (const checker of ctx.checkerType('B')) {
    for (const bishop of ctx.byType('B')) {
      if (bishop === checker) continue;
      // The characteristic parallel diagonals are formed by bishops on
      // neighboring files/ranks. The second ray may terminate on one of the
      // mated side's blockers, so testing only currently reachable flights
      // would incorrectly discard the textbook geometry.
      if (isOrthogonallyAdjacent(checker, bishop)) return true;
    }
  }
  return false;
}

function hasDovetailMate(ctx) {
  for (const queen of ctx.checkerType('Q')) {
    if (!isDiagonallyAdjacent(queen, ctx.king)) continue;
    const { dr, dc } = relative(ctx.king, queen);
    const blockers = [
      offsetSquare(ctx.king, -dr, 0),
      offsetSquare(ctx.king, 0, -dc),
    ];
    if (blockers.every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender)) {
      return true;
    }
  }
  return false;
}

function hasEpauletteMate(ctx) {
  for (const checker of ctx.checkers) {
    const type = typeOf(ctx.board[checker]);
    if (type !== 'R' && type !== 'Q') continue;
    const { dr, dc } = relative(checker, ctx.king);
    if (dr !== 0 && dc !== 0) continue;
    const flanks = dr === 0
      ? [offsetSquare(ctx.king, -1, 0), offsetSquare(ctx.king, 1, 0)]
      : [offsetSquare(ctx.king, 0, -1), offsetSquare(ctx.king, 0, 1)];
    if (flanks.every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender)) {
      return true;
    }
  }
  return false;
}

function hasHookMate(ctx) {
  const defenderPawnInRing = ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) === 'P');
  if (!defenderPawnInRing) return false;
  for (const rook of ctx.checkerType('R')) {
    if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
    for (const knight of ctx.byType('N')) {
      if (!pieceAttacks(ctx.board, knight, rook)) continue;
      for (const pawn of ctx.byType('P')) {
        if (
          pieceAttacks(ctx.board, pawn, knight)
          && ctx.ring.some((target) => pieceAttacks(ctx.board, pawn, target))
        ) return true;
      }
    }
  }
  return false;
}

function hasKillBoxMate(ctx) {
  for (const rook of ctx.checkerType('R')) {
    if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
    for (const queen of ctx.byType('Q')) {
      const { dr, dc } = relative(queen, rook);
      if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) continue;
      const middle = offsetSquare(queen, dr / 2, dc / 2);
      if (!ctx.board[middle] && pieceAttacks(ctx.board, queen, rook)) return true;
    }
  }
  return false;
}

function hasMorphyMate(ctx) {
  if (ctx.checkers.length !== 1 || ctx.checkerType('B').length !== 1) return false;
  const pawnBlocker = ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) === 'P');
  return pawnBlocker && ctx.byType('R').some((rook) => ctx.controlsRing(rook).length >= 1);
}

function hasOperaMate(ctx) {
  const nonKnightBlocker = ctx.ownBlockers.some((square) => typeOf(ctx.board[square]) !== 'N');
  if (!nonKnightBlocker) return false;
  return ctx.checkerType('R').some((rook) => (
    isOrthogonallyAdjacent(rook, ctx.king)
    && ctx.byType('B').some((bishop) => pieceAttacks(ctx.board, bishop, rook))
  ));
}

function hasPillsburysMate(ctx) {
  if (!isOnEdge(ctx.king)) return false;
  return ctx.checkerType('R').some((rook) => ctx.byType('B').some((bishop) => (
    !pieceAttacks(ctx.board, bishop, rook)
    && ctx.controlsRing(bishop).some((square) => square !== ctx.king)
  )));
}

function hasSwallowsTailMate(ctx) {
  for (const queen of ctx.checkerType('Q')) {
    if (!isOrthogonallyAdjacent(queen, ctx.king)) continue;
    const { dr, dc } = relative(ctx.king, queen);
    const blockers = dr !== 0
      ? [offsetSquare(ctx.king, -dr, -1), offsetSquare(ctx.king, -dr, 1)]
      : [offsetSquare(ctx.king, -1, -dc), offsetSquare(ctx.king, 1, -dc)];
    if (
      blockers.every((square) => square >= 0 && colorOf(ctx.board[square]) === ctx.defender)
      && ctx.protectedBy(queen).length > 0
    ) return true;
  }
  return false;
}

function hasTriangleMate(ctx) {
  for (const queen of ctx.checkerType('Q')) {
    if (!isDiagonallyAdjacent(queen, ctx.king)) continue;
    for (const rook of ctx.byType('R')) {
      const { dr, dc } = relative(queen, rook);
      const alignedTwoAway = (Math.abs(dr) === 2 && dc === 0) || (dr === 0 && Math.abs(dc) === 2);
      if (!alignedTwoAway) continue;
      const middle = offsetSquare(queen, Math.sign(dr), Math.sign(dc));
      if (!ctx.board[middle] && pieceAttacks(ctx.board, rook, queen)) return true;
    }
  }
  return false;
}

function hasVukovicMate(ctx) {
  if (!isOnEdge(ctx.king)) return false;
  for (const rook of ctx.checkerType('R')) {
    if (!isOrthogonallyAdjacent(rook, ctx.king)) continue;
    // In this pattern the knight covers the flights; a king, pawn, bishop,
    // queen, or second rook protects the mating rook. Requiring a non-knight
    // protector prevents the Arabian pattern from being double-labelled.
    const nonMinorProtector = ctx.protectedBy(rook).some((protector) => {
      const type = typeOf(ctx.board[protector]);
      return type !== 'N' && type !== 'B';
    });
    if (!nonMinorProtector) continue;
    for (const knight of ctx.byType('N')) {
      const coversRemainingFlight = ctx.ring.some((target) => (
        !pieceAttacks(ctx.board, rook, target)
        && pieceAttacks(ctx.board, knight, target)
      ));
      if (coversRemainingFlight) return true;
    }
  }
  return false;
}

function hasSmotheredMate(ctx) {
  return ctx.checkers.length === 1
    && ctx.checkerType('N').length === 1
    && ctx.ring.every((square) => colorOf(ctx.board[square]) === ctx.defender);
}

function hasCornerMate(ctx, specific) {
  if (specific) return false;
  if (ctx.checkers.length !== 1) return false;
  const checkerType = typeOf(ctx.board[ctx.checkers[0]]);
  if (checkerType !== 'N' && checkerType !== 'B') return false;
  if (ctx.ownBlockers.length < 1) return false;
  return [...ctx.byType('R'), ...ctx.byType('Q')]
    .some((piece) => ctx.controlsRing(piece).length >= 1);
}

function classifyMate(ctx) {
  const detected = new Set();
  const add = (id, condition) => { if (condition) detected.add(id); };

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
  // Morphy's bishop check can also form two crossing bishop rays, but its
  // defining rook-and-defender-pawn confinement is the more specific name.
  const boden = bodenCandidate && !morphy;
  const opera = hasOperaMate(ctx);
  const pillsbury = !backRank && hasPillsburysMate(ctx);
  const swallowsTail = hasSwallowsTailMate(ctx);
  const triangle = hasTriangleMate(ctx);
  const vukovic = hasVukovicMate(ctx);
  const smothered = hasSmotheredMate(ctx);
  const corner = hasCornerMate(
    ctx,
    balestra || boden || doubleBishop || morphy || smothered,
  );

  add('anastasiaMate', anastasia);
  add('arabianMate', arabian);
  add('backRankMate', backRank);
  add('balestraMate', balestra);
  add('blindSwineMate', blindSwine);
  add('bodenMate', boden);
  add('cornerMate', corner);
  add('doubleBishopMate', doubleBishop);
  add('dovetailMate', dovetail);
  add('epauletteMate', epaulette);
  add('hookMate', hook);
  add('killBoxMate', killBox);
  add('pillsburysMate', pillsbury);
  add('morphysMate', morphy);
  add('operaMate', opera);
  add('swallowstailMate', swallowsTail);
  add('triangleMate', triangle);
  add('vukovicMate', vukovic);
  add('smotheredMate', smothered);

  return NAMED_MATE_PATTERN_IDS.filter((id) => detected.has(id));
}

/**
 * Analyze a final FEN. Invalid positions are reported, rather than thrown,
 * which keeps imports and background retagging robust against bad source data.
 */
export function analyzeNamedMatePatterns(fen) {
  let position;
  try {
    position = parseFen(fen);
  } catch (error) {
    return {
      valid: false,
      isCheckmate: false,
      patterns: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const invalidReason = validatePosition(position);
  if (invalidReason) {
    return {
      valid: false,
      isCheckmate: false,
      patterns: [],
      reason: invalidReason,
    };
  }

  const defender = position.turn;
  const attacker = otherColor(defender);
  const king = kingSquare(position.board, defender);
  const checkingSquares = attackers(position.board, king, attacker);
  const inCheck = checkingSquares.length > 0;
  const isCheckmate = inCheck && !hasLegalMove(position);
  if (!isCheckmate) {
    return {
      valid: true,
      isCheckmate: false,
      patterns: [],
      sideToMove: defender,
      checkingSquares: checkingSquares.map(squareName),
      reason: inCheck ? 'The checked side has a legal evasion' : 'The side to move is not in check',
    };
  }

  const patterns = classifyMate(makeContext(position));
  return {
    valid: true,
    isCheckmate: true,
    patterns,
    sideToMove: defender,
    matedKing: squareName(king),
    checkingSquares: checkingSquares.map(squareName),
    reason: null,
  };
}

/** Return only the pinned Lichess-compatible motif IDs for a final FEN. */
export function detectNamedMatePatterns(fen) {
  return analyzeNamedMatePatterns(fen).patterns;
}

/** Short alias for consumers which already live in a mate-pattern namespace. */
export const detectMatePatterns = detectNamedMatePatterns;

export function isLegalCheckmateFen(fen) {
  const result = analyzeNamedMatePatterns(fen);
  return result.valid && result.isCheckmate;
}

export default detectNamedMatePatterns;
