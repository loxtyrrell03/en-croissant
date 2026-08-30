/**
 * chess-primitives.js — Rich chess board query layer
 *
 * Standalone module that parses FEN and provides attack / pin / ray
 * primitives needed by theme-detector.js.  Uses the same 64-index
 * layout as ChessLite (index 0 = a8, index 63 = h1).
 *
 * Adapted from lichess-puzzler util.py piece-value and attack helpers.
 */

const FILES = 'abcdefgh';

const PIECE_VALUES = {
  P:1, p:1, N:3, n:3, B:3, b:3, R:5, r:5, Q:9, q:9, K:99, k:99
};

const KNIGHT_OFFSETS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const DIAG_DIRS       = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ORTH_DIRS       = [[-1,0],[1,0],[0,-1],[0,1]];
const ALL_DIRS        = DIAG_DIRS.concat(ORTH_DIRS);

/* ------------------------------------------------------------------ */
/*  Constructor                                                        */
/* ------------------------------------------------------------------ */

export function ChessPrimitives(fen) {
  const board = new Array(64).fill(null);
  let side = 'w';
  let epIdx = -1;

  /* helpers -------------------------------------------------------- */
  function rcOf(i)        { return { r: Math.floor(i / 8), c: i % 8 }; }
  function idxOf(r, c)    { return r * 8 + c; }
  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function idxToSq(i)     { return FILES[i % 8] + (8 - Math.floor(i / 8)); }
  function sqToIdx(sq)    { return (7 - (parseInt(sq[1], 10) - 1)) * 8 + FILES.indexOf(sq[0]); }

  function colorOf(pc) {
    if (!pc) return null;
    return pc === pc.toUpperCase() ? 'w' : 'b';
  }
  function typeOf(pc) {
    if (!pc) return null;
    return pc.toUpperCase();          // P, N, B, R, Q, K
  }

  /* FEN parser ----------------------------------------------------- */
  function loadFEN(f) {
    board.fill(null);
    const parts = f.trim().split(/\s+/);
    const rows  = parts[0].split('/');
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) file += parseInt(ch, 10);
        else { board[r * 8 + file] = ch; file++; }
      }
    }
    side  = parts[1] || 'w';
    epIdx = (parts[3] && parts[3] !== '-') ? sqToIdx(parts[3]) : -1;
  }

  /* board queries -------------------------------------------------- */
  function pieceAt(idx)  { return board[idx]; }
  function valueOf(idx)  { return PIECE_VALUES[board[idx]] || 0; }
  function pieceValue(pc){ return PIECE_VALUES[pc] || 0; }

  function kingIdx(color) {
    const k = color === 'w' ? 'K' : 'k';
    for (let i = 0; i < 64; i++) if (board[i] === k) return i;
    return -1;
  }

  /* ----------------------------------------------------------------
   * attacks(fromIdx) — squares attacked by the piece at fromIdx
   * Returns array of board indices (pseudo-legal, ignores pins).
   * ---------------------------------------------------------------- */
  function attacks(fromIdx) {
    const pc = board[fromIdx];
    if (!pc) return [];
    const t = pc.toUpperCase();
    const clr = colorOf(pc);
    const { r, c } = rcOf(fromIdx);
    const out = [];

    if (t === 'P') {
      const dir = clr === 'w' ? -1 : 1;
      if (inBounds(r + dir, c - 1)) out.push(idxOf(r + dir, c - 1));
      if (inBounds(r + dir, c + 1)) out.push(idxOf(r + dir, c + 1));
    } else if (t === 'N') {
      for (const [dr, dc] of KNIGHT_OFFSETS) {
        if (inBounds(r + dr, c + dc)) out.push(idxOf(r + dr, c + dc));
      }
    } else if (t === 'K') {
      for (const [dr, dc] of ALL_DIRS) {
        if (inBounds(r + dr, c + dc)) out.push(idxOf(r + dr, c + dc));
      }
    } else {
      // sliding pieces
      const dirs = (t === 'B') ? DIAG_DIRS : (t === 'R') ? ORTH_DIRS : ALL_DIRS;
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc)) {
          out.push(idxOf(rr, cc));
          if (board[idxOf(rr, cc)]) break;   // blocked
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }

  /* ----------------------------------------------------------------
   * attackers(color, targetIdx) — all piece indices of `color` that
   * attack `targetIdx`.  Reverse-ray search.
   * ---------------------------------------------------------------- */
  function attackers(color, targetIdx) {
    const { r, c } = rcOf(targetIdx);
    const out = [];

    // pawns
    const pawnDir = color === 'w' ? 1 : -1;          // reverse: look where pawn WOULD be
    const pawnChar = color === 'w' ? 'P' : 'p';
    for (const dc of [-1, 1]) {
      const pr = r + pawnDir, pc2 = c + dc;
      if (inBounds(pr, pc2) && board[idxOf(pr, pc2)] === pawnChar) out.push(idxOf(pr, pc2));
    }

    // knights
    const knightChar = color === 'w' ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc) && board[idxOf(rr, cc)] === knightChar) out.push(idxOf(rr, cc));
    }

    // king
    const kingChar = color === 'w' ? 'K' : 'k';
    for (const [dr, dc] of ALL_DIRS) {
      if (inBounds(r + dr, c + dc) && board[idxOf(r + dr, c + dc)] === kingChar) out.push(idxOf(r + dr, c + dc));
    }

    // sliding (bishop/queen on diags, rook/queen on ortho)
    const bishopChar = color === 'w' ? 'B' : 'b';
    const rookChar   = color === 'w' ? 'R' : 'r';
    const queenChar  = color === 'w' ? 'Q' : 'q';

    for (const [dr, dc] of DIAG_DIRS) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const p = board[idxOf(rr, cc)];
        if (p) {
          if (p === bishopChar || p === queenChar) out.push(idxOf(rr, cc));
          break;
        }
        rr += dr; cc += dc;
      }
    }
    for (const [dr, dc] of ORTH_DIRS) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const p = board[idxOf(rr, cc)];
        if (p) {
          if (p === rookChar || p === queenChar) out.push(idxOf(rr, cc));
          break;
        }
        rr += dr; cc += dc;
      }
    }

    return out;
  }

  /* ----------------------------------------------------------------
   * squaresBetween(idx1, idx2) — indices strictly between two squares
   * on the same rank/file/diagonal.  Empty array if not aligned.
   * ---------------------------------------------------------------- */
  function squaresBetween(idx1, idx2) {
    const { r: r1, c: c1 } = rcOf(idx1);
    const { r: r2, c: c2 } = rcOf(idx2);
    const dr = Math.sign(r2 - r1);
    const dc = Math.sign(c2 - c1);
    if (dr === 0 && dc === 0) return [];
    // must be on same rank, file, or diagonal
    if (dr !== 0 && dc !== 0 && Math.abs(r2 - r1) !== Math.abs(c2 - c1)) return [];
    const out = [];
    let rr = r1 + dr, cc = c1 + dc;
    while (rr !== r2 || cc !== c2) {
      out.push(idxOf(rr, cc));
      rr += dr; cc += dc;
    }
    return out;
  }

  /* ----------------------------------------------------------------
   * isPinned(squareIdx) — is the piece at squareIdx pinned to its
   * king?  Returns the pinner's board index, or null.
   * ---------------------------------------------------------------- */
  function isPinned(squareIdx) {
    const pc = board[squareIdx];
    if (!pc) return null;
    const clr = colorOf(pc);
    const ki  = kingIdx(clr);
    if (ki < 0) return null;

    const { r: kr, c: kc } = rcOf(ki);
    const { r: sr, c: sc } = rcOf(squareIdx);
    const dr = Math.sign(sr - kr);
    const dc = Math.sign(sc - kc);
    if (dr === 0 && dc === 0) return null;
    // check alignment
    if (dr !== 0 && dc !== 0 && Math.abs(sr - kr) !== Math.abs(sc - kc)) return null;
    if (dr === 0 && sr !== kr) return null;
    if (dc === 0 && sc !== kc) return null;

    // walk from king toward piece — must be no blockers between
    let rr = kr + dr, cc = kc + dc;
    while ((rr !== sr || cc !== sc) && inBounds(rr, cc)) {
      if (board[idxOf(rr, cc)]) return null;   // another piece blocks
      rr += dr; cc += dc;
    }

    // walk past the piece — find the first piece
    rr = sr + dr; cc = sc + dc;
    while (inBounds(rr, cc)) {
      const p = board[idxOf(rr, cc)];
      if (p) {
        if (colorOf(p) === clr) return null;    // friendly piece, no pin
        const t = p.toUpperCase();
        const isDiag = (dr !== 0 && dc !== 0);
        if (isDiag && (t === 'B' || t === 'Q')) return idxOf(rr, cc);
        if (!isDiag && (t === 'R' || t === 'Q')) return idxOf(rr, cc);
        return null;                             // wrong piece type
      }
      rr += dr; cc += dc;
    }
    return null;
  }

  /* ----------------------------------------------------------------
   * isHanging(squareIdx) — attacked by opponent and not defended
   * ---------------------------------------------------------------- */
  function isHanging(squareIdx) {
    const pc = board[squareIdx];
    if (!pc) return false;
    const clr = colorOf(pc);
    const opp = clr === 'w' ? 'b' : 'w';
    return attackers(opp, squareIdx).length > 0 && attackers(clr, squareIdx).length === 0;
  }

  /* ----------------------------------------------------------------
   * canBeTakenByLower(squareIdx) — attacked by a lower-value piece
   * ---------------------------------------------------------------- */
  function canBeTakenByLower(squareIdx) {
    const pc = board[squareIdx];
    if (!pc) return false;
    const clr = colorOf(pc);
    const opp = clr === 'w' ? 'b' : 'w';
    const val = PIECE_VALUES[pc];
    for (const ai of attackers(opp, squareIdx)) {
      const ap = board[ai];
      if (ap && ap.toUpperCase() !== 'K' && PIECE_VALUES[ap] < val) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------
   * isInBadSpot(squareIdx) — under attack AND (hanging or capturable
   * by lower).  Matches lichess util.py is_in_bad_spot.
   * ---------------------------------------------------------------- */
  function isInBadSpot(squareIdx) {
    const pc = board[squareIdx];
    if (!pc) return false;
    const opp = colorOf(pc) === 'w' ? 'b' : 'w';
    if (attackers(opp, squareIdx).length === 0) return false;
    return isHanging(squareIdx) || canBeTakenByLower(squareIdx);
  }

  /* ----------------------------------------------------------------
   * checkerCount(color) — how many pieces of the opposing side are
   * giving check to `color`'s king.
   * ---------------------------------------------------------------- */
  function checkerCount(color) {
    const ki = kingIdx(color);
    if (ki < 0) return 0;
    const opp = color === 'w' ? 'b' : 'w';
    return attackers(opp, ki).length;
  }

  /* ----------------------------------------------------------------
   * revealsAttack(fromIdx, toIdx, attackerColor) — after moving the
   * piece from `fromIdx` to `toIdx`, does a ray piece of
   * `attackerColor` now have a clear line through `fromIdx` to an
   * enemy piece?
   * ---------------------------------------------------------------- */
  function revealsAttack(fromIdx, toIdx, attackerColor) {
    const oppColor = attackerColor === 'w' ? 'b' : 'w';
    const { r: fr, c: fc } = rcOf(fromIdx);

    // temporarily remove the moving piece and place at destination
    const origFrom = board[fromIdx];
    const origTo   = board[toIdx];
    board[fromIdx] = null;
    board[toIdx]   = origFrom;

    let found = false;

    // check all 8 ray directions from fromIdx
    for (const [dr, dc] of ALL_DIRS) {
      // walk one direction to find attacker
      let attackerIdx = -1;
      let rr = fr + dr, cc = fc + dc;
      while (inBounds(rr, cc)) {
        const p = board[idxOf(rr, cc)];
        if (p) {
          if (colorOf(p) === attackerColor) {
            const t = p.toUpperCase();
            const isDiag = (dr !== 0 && dc !== 0);
            if ((isDiag && (t === 'B' || t === 'Q')) || (!isDiag && (t === 'R' || t === 'Q'))) {
              attackerIdx = idxOf(rr, cc);
            }
          }
          break;
        }
        rr += dr; cc += dc;
      }
      if (attackerIdx < 0) continue;

      // walk opposite direction from fromIdx to find target
      rr = fr - dr; cc = fc - dc;
      while (inBounds(rr, cc)) {
        const p = board[idxOf(rr, cc)];
        if (p) {
          if (colorOf(p) === oppColor && p.toUpperCase() !== 'P') {
            found = true;
          }
          break;
        }
        rr -= dr; cc -= dc;
      }
      if (found) break;
    }

    // restore board
    board[fromIdx] = origFrom;
    board[toIdx]   = origTo;
    return found;
  }

  /* init ----------------------------------------------------------- */
  if (fen) loadFEN(fen);

  return {
    loadFEN, pieceAt, valueOf, pieceValue, colorOf, typeOf, kingIdx,
    attacks, attackers, isPinned, squaresBetween,
    isHanging, canBeTakenByLower, isInBadSpot,
    checkerCount, revealsAttack,
    idxToSq, sqToIdx, rcOf,
    PIECE_VALUES,
    side: () => side,
    epIndex: () => epIdx
  };
}
