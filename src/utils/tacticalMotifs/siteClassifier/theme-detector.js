/**
 * theme-detector.js  Tactical theme detection for chess mistakes
 *
 * Adapted from lichess-puzzler cook.py for single-position analysis.
 * Given a mistake { fen, side, best, played }, determines what tactical
 * theme the best move achieves (i.e. what the player missed).
 *
 * Input:  mistake object with at least { fen, side, best }
 * Output: string[] of theme tag strings
 */

import { ChessPrimitives } from './chess-primitives.js';
import { ChessLite }       from './analysis.js';
import { detectNamedMatePatterns } from './mate-pattern-detector.js';

export const THEME_DETECTOR_VERSION = 55;
export const TRAINER_PRIMARY_VERSION = 3;

// Keep trapped-piece detection enabled; performance is controlled via
// narrower guards inside detectTrappedPiece.
const ENABLE_TRAPPED_PIECE_DETECTION = true;

/* ================================================================== */
/*  Theme constants                                                    */
/* ================================================================== */

export const THEMES = {
  FORK:               'fork',
  PIN:                'pin',
  SKEWER:             'skewer',
  DISCOVERED_ATTACK:  'discoveredAttack',
  DOUBLE_CHECK:       'doubleCheck',
  HANGING_PIECE:      'hangingPiece',
  TRAPPED_PIECE:      'trappedPiece',
  SACRIFICE:          'sacrifice',
  BACK_RANK:          'backRank',
  BACK_RANK_MATE:     'backRankMate',
  PROMOTION:          'promotion',
  EN_PASSANT:         'enPassant',
  CASTLING:           'castling',
  CHECK:              'check',
  CAPTURE:            'capture',
  QUIET_MOVE:         'quietMove',
  // Phase 2: Mate patterns
  MATE:               'mate',
  MATE_IN_1:          'mateIn1',
  MATE_IN_2:          'mateIn2',
  MATE_IN_3:          'mateIn3',
  MATE_IN_4:          'mateIn4',
  MATE_IN_5:          'mateIn5',
  MATE_THREAT:        'mateThreat',
  SMOTHERED_MATE:     'smotheredMate',
  ANASTASIA_MATE:     'anastasiaMate',
  HOOK_MATE:          'hookMate',
  ARABIAN_MATE:       'arabianMate',
  BODEN_MATE:         'bodenMate',
  DOUBLE_BISHOP_MATE: 'doubleBishopMate',
  DOVETAIL_MATE:      'dovetailMate',
  BALESTRA_MATE:       'balestraMate',
  BLIND_SWINE_MATE:    'blindSwineMate',
  CORNER_MATE:         'cornerMate',
  EPAULETTE_MATE:      'epauletteMate',
  KILL_BOX_MATE:       'killBoxMate',
  MORPHYS_MATE:        'morphysMate',
  OPERA_MATE:          'operaMate',
  PILLSBURYS_MATE:     'pillsburysMate',
  SWALLOWSTAIL_MATE:   'swallowstailMate',
  TRIANGLE_MATE:       'triangleMate',
  VUKOVIC_MATE:        'vukovicMate',
  // Phase 3: PV-relational
  DEFLECTION:         'deflection',
  ATTRACTION:         'attraction',
  INTERFERENCE:       'interference',
  SELF_INTERFERENCE:  'selfInterference',
  INTERMEZZO:         'intermezzo',
  CLEARANCE:          'clearance',
  X_RAY_ATTACK:       'xRayAttack',
  COLLINEAR_MOVE:     'collinearMove',
  DISCOVERED_CHECK:   'discoveredCheck',
  ZUGZWANG:           'zugzwang',
  CAPTURING_DEFENDER: 'capturingDefender',
  DEFENSIVE_MOVE:     'defensiveMove',
  // Phase 4: Metadata / classification
  CRUSHING:           'crushing',
  ADVANTAGE:          'advantage',
  EQUALITY:           'equality',
  ONE_MOVE:           'oneMove',
  SHORT:              'short',
  LONG:               'long',
  VERY_LONG:          'veryLong',
  PAWN_ENDGAME:       'pawnEndgame',
  ROOK_ENDGAME:       'rookEndgame',
  BISHOP_ENDGAME:     'bishopEndgame',
  KNIGHT_ENDGAME:     'knightEndgame',
  QUEEN_ENDGAME:      'queenEndgame',
  QUEEN_ROOK_ENDGAME: 'queenRookEndgame',
  KINGSIDE_ATTACK:    'kingsideAttack',
  QUEENSIDE_ATTACK:   'queensideAttack',
  EXPOSED_KING:       'exposedKing',
  ADVANCED_PAWN:      'advancedPawn',
  UNDER_PROMOTION:    'underPromotion',
  ATTACKING_F2F7:     'attackingF2F7',
  ATTACKING_UNDEFENDED_PIECE: 'attacking_undefended_piece',
};

const TACTICAL_THEMES = new Set([
  THEMES.FORK, THEMES.PIN, THEMES.SKEWER,
  THEMES.DISCOVERED_ATTACK, THEMES.DOUBLE_CHECK,
  THEMES.HANGING_PIECE, THEMES.TRAPPED_PIECE,
  THEMES.SACRIFICE, THEMES.BACK_RANK,
  THEMES.BACK_RANK_MATE,
  THEMES.DEFLECTION, THEMES.ATTRACTION,
  THEMES.INTERFERENCE, THEMES.INTERMEZZO,
  THEMES.CLEARANCE, THEMES.CAPTURING_DEFENDER,
  THEMES.X_RAY_ATTACK, THEMES.COLLINEAR_MOVE,
  THEMES.DISCOVERED_CHECK, THEMES.DEFENSIVE_MOVE,
  THEMES.ZUGZWANG,
  THEMES.MATE, THEMES.MATE_IN_1, THEMES.MATE_IN_2,
  THEMES.MATE_IN_3, THEMES.MATE_IN_4, THEMES.MATE_IN_5,
  THEMES.MATE_THREAT,
  THEMES.CHECK, THEMES.SMOTHERED_MATE, THEMES.ANASTASIA_MATE,
  THEMES.HOOK_MATE, THEMES.ARABIAN_MATE, THEMES.BODEN_MATE,
  THEMES.DOUBLE_BISHOP_MATE, THEMES.DOVETAIL_MATE,
  THEMES.BALESTRA_MATE, THEMES.BLIND_SWINE_MATE,
  THEMES.CORNER_MATE, THEMES.EPAULETTE_MATE,
  THEMES.KILL_BOX_MATE, THEMES.MORPHYS_MATE,
  THEMES.OPERA_MATE, THEMES.PILLSBURYS_MATE,
  THEMES.SWALLOWSTAIL_MATE, THEMES.TRIANGLE_MATE,
  THEMES.VUKOVIC_MATE,
  THEMES.PROMOTION, THEMES.UNDER_PROMOTION,
  THEMES.EN_PASSANT, THEMES.CASTLING, THEMES.QUIET_MOVE,
  THEMES.ADVANCED_PAWN, THEMES.ATTACKING_F2F7,
  THEMES.EXPOSED_KING, THEMES.KINGSIDE_ATTACK,
  THEMES.QUEENSIDE_ATTACK,
  THEMES.ATTACKING_UNDEFENDED_PIECE,
]);

export const THEME_LABELS = {
  fork:              'Fork',
  pin:               'Pin',
  skewer:            'Skewer',
  discoveredAttack:  'Discovered Attack',
  doubleCheck:       'Double Check',
  hangingPiece:      'Hanging Piece',
  trappedPiece:      'Trapped Piece',
  sacrifice:         'Sacrifice',
  backRank:          'Back Rank',
  backRankMate:      'Back Rank Mate',
  promotion:         'Promotion',
  enPassant:         'En Passant',
  castling:          'Castling',
  check:             'Check',
  capture:           'Capture',
  quietMove:         'Quiet Move',
  mate:              'Mate',
  mateIn1:           'Mate in 1',
  mateIn2:           'Mate in 2',
  mateIn3:           'Mate in 3',
  mateIn4:           'Mate in 4',
  mateIn5:           'Mate in 5',
  mateThreat:        'Mate Threat',
  smotheredMate:     'Smothered Mate',
  anastasiaMate:     'Anastasia Mate',
  hookMate:          'Hook Mate',
  arabianMate:       'Arabian Mate',
  bodenMate:         'Boden Mate',
  doubleBishopMate:  'Double Bishop Mate',
  dovetailMate:      'Dovetail Mate',
  balestraMate:      'Balestra Mate',
  blindSwineMate:    'Blind Swine Mate',
  cornerMate:        'Corner Mate',
  epauletteMate:     'Epaulette Mate',
  killBoxMate:       'Kill Box Mate',
  morphysMate:       "Morphy's Mate",
  operaMate:         'Opera Mate',
  pillsburysMate:    "Pillsbury's Mate",
  swallowstailMate:  "Swallow's Tail Mate",
  triangleMate:      'Triangle Mate',
  vukovicMate:       'Vukovic Mate',
  deflection:        'Deflection',
  attraction:        'Attraction',
  interference:      'Interference',
  selfInterference:  'Self-Interference',
  intermezzo:        'Intermezzo',
  clearance:         'Clearance Sacrifice',
  xRayAttack:        'X-Ray Attack',
  collinearMove:     'Collinear Move',
  discoveredCheck:   'Discovered Check',
  zugzwang:          'Zugzwang',
  capturingDefender: 'Removing the Defender',
  defensiveMove:     'Defensive Move',
  crushing:          'Crushing',
  advantage:         'Advantage',
  equality:          'Equality',
  oneMove:           'One Move',
  short:             'Short',
  long:              'Long',
  veryLong:          'Very Long',
  pawnEndgame:       'Pawn Endgame',
  rookEndgame:       'Rook Endgame',
  bishopEndgame:     'Bishop Endgame',
  knightEndgame:     'Knight Endgame',
  queenEndgame:      'Queen Endgame',
  queenRookEndgame:  'Queen+Rook Endgame',
  kingsideAttack:    'Kingside Attack',
  queensideAttack:   'Queenside Attack',
  exposedKing:       'Exposed King',
  advancedPawn:      'Advanced Pawn',
  underPromotion:    'Under-Promotion',
  attackingF2F7:     'Attacking f2/f7',
  attacking_undefended_piece: 'Threatening a Piece',
};

export const THEME_COLORS = {
  fork:              '#e74c3c',
  pin:               '#9b59b6',
  skewer:            '#8e44ad',
  discoveredAttack:  '#e67e22',
  doubleCheck:       '#c0392b',
  hangingPiece:      '#f39c12',
  trappedPiece:      '#d35400',
  sacrifice:         '#2ecc71',
  backRank:          '#e74c3c',
  backRankMate:      '#e74c3c',
  promotion:         '#3498db',
  enPassant:         '#1abc9c',
  castling:          '#95a5a6',
  check:             '#e74c3c',
  capture:           '#f1c40f',
  quietMove:         '#7f8c8d',
  mate:              '#c0392b',
  mateIn1:           '#c0392b',
  mateIn2:           '#c0392b',
  mateIn3:           '#c0392b',
  mateIn4:           '#c0392b',
  mateIn5:           '#c0392b',
  mateThreat:        '#d35400',
  smotheredMate:     '#8e44ad',
  anastasiaMate:     '#8e44ad',
  hookMate:          '#8e44ad',
  arabianMate:       '#8e44ad',
  bodenMate:         '#8e44ad',
  doubleBishopMate:  '#8e44ad',
  dovetailMate:      '#8e44ad',
  balestraMate:      '#8e44ad',
  blindSwineMate:    '#8e44ad',
  cornerMate:        '#8e44ad',
  epauletteMate:     '#8e44ad',
  killBoxMate:       '#8e44ad',
  morphysMate:       '#8e44ad',
  operaMate:         '#8e44ad',
  pillsburysMate:    '#8e44ad',
  swallowstailMate:  '#8e44ad',
  triangleMate:      '#8e44ad',
  vukovicMate:       '#8e44ad',
  deflection:        '#e67e22',
  attraction:        '#e67e22',
  interference:      '#e67e22',
  selfInterference:  '#e67e22',
  intermezzo:        '#e67e22',
  clearance:         '#e67e22',
  xRayAttack:        '#e67e22',
  collinearMove:     '#e67e22',
  discoveredCheck:   '#e67e22',
  zugzwang:          '#e67e22',
  capturingDefender: '#e67e22',
  defensiveMove:     '#3498db',
  crushing:          '#2ecc71',
  advantage:         '#f39c12',
  equality:          '#95a5a6',
  oneMove:           '#7f8c8d',
  short:             '#7f8c8d',
  long:              '#7f8c8d',
  veryLong:          '#7f8c8d',
  pawnEndgame:       '#95a5a6',
  rookEndgame:       '#95a5a6',
  bishopEndgame:     '#95a5a6',
  knightEndgame:     '#95a5a6',
  queenEndgame:      '#95a5a6',
  queenRookEndgame:  '#95a5a6',
  kingsideAttack:    '#e74c3c',
  queensideAttack:   '#e74c3c',
  exposedKing:       '#e74c3c',
  advancedPawn:      '#3498db',
  underPromotion:    '#3498db',
  attackingF2F7:     '#e74c3c',
  attacking_undefended_piece: '#16a085',
};

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

/** Normalise a move field to lowercase UCI (e.g. "e2e4"). */
function normalizeMove(fen, move) {
  if (!move) return null;
  if (typeof move === 'object') {
    const uci = (typeof move.uci === 'string' && move.uci)
      ? String(move.uci)
      : ((typeof move.from === 'string' && typeof move.to === 'string')
        ? `${move.from}${move.to}${typeof move.promotion === 'string' ? move.promotion : ''}`
        : '');
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) return uci.toLowerCase();
    if (typeof move.san === 'string') {
      move = move.san;
    } else {
      return null;
    }
  }
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move)) return move.toLowerCase();
  try {
    const cl = ChessLite();
    cl.loadFEN(fen);
    const uci = cl.parseSANtoMove(move);
    return uci ? uci.toLowerCase() : null;
  } catch { return null; }
}

function normalizeBestMove(mistake) {
  return normalizeMove(mistake.fen, mistake.best);
}

function coerceMoveToUci(cl, moveLike) {
  if (!moveLike) return null;
  if (typeof moveLike === 'string') {
    const mm = moveLike.trim();
    if (!mm) return null;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(mm)) return mm.toLowerCase();
    try {
      const parsed = cl.parseSANtoMove(mm);
      if (parsed && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(parsed)) {
        return String(parsed).toLowerCase();
      }
    } catch {}
    return null;
  }
  if (moveLike && typeof moveLike === 'object') {
    if (typeof moveLike.uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(moveLike.uci)) {
      return String(moveLike.uci).toLowerCase();
    }
    if (typeof moveLike.from === 'string' && typeof moveLike.to === 'string') {
      const promo = (typeof moveLike.promotion === 'string' && /^[qrbn]$/i.test(moveLike.promotion))
        ? String(moveLike.promotion).toLowerCase()
        : '';
      const candidate = `${moveLike.from}${moveLike.to}${promo}`;
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(candidate)) return candidate.toLowerCase();
    }
  }
  return null;
}

function normalizeSide(side, fen) {
  const raw = String(side || '').trim().toLowerCase();
  if (raw === 'w' || raw === 'white') return 'w';
  if (raw === 'b' || raw === 'black') return 'b';
  try {
    const turn = String(fen || '').trim().split(/\s+/)[1];
    if (turn === 'w' || turn === 'b') return turn;
  } catch {}
  return 'w';
}

function shouldSuppressExchangeRecaptureHanging(step, mistake, steps = null) {
  if (!step || !step.uci || !step.capturedPiece) return false;
  const currentTo = step.uci.slice(2, 4);

  // Preferred path: reconstruct the prior move from mistake context.
  if (mistake) {
    const prevFen = mistake._prevFen;
    const prevPlayed = mistake._prevPlayedMove;
    if (!prevFen || !prevPlayed) return false;

    const prevUci = normalizeMove(prevFen, prevPlayed);
    if (!prevUci) return false;

    // Current capture must be on the destination square of the previous move.
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

      // En-passant edge case: destination square is empty before the move.
      if (!capturedPrev && movedPrev && String(movedPrev).toUpperCase() === 'P' && prevFromIdx >= 0 && prevToIdx >= 0) {
        const from = rcOf(prevFromIdx);
        const to = rcOf(prevToIdx);
        const movedSide = prevBoard.colorOf(movedPrev);
        const isDiagonalPawnCapture = from.c !== to.c;
        if (isDiagonalPawnCapture && (movedSide === 'w' || movedSide === 'b')) {
          const epCapturedIdx = prevToIdx + (movedSide === 'w' ? 8 : -8);
          if (epCapturedIdx >= 0 && epCapturedIdx < 64) {
            const epPiece = prevBoard.pieceAt(epCapturedIdx);
            if (epPiece && prevBoard.colorOf(epPiece) !== movedSide && String(epPiece).toUpperCase() === 'P') {
              capturedPrev = epPiece;
            }
          }
        }
      }
    } catch {
      return false;
    }
    if (!movedPrev || !capturedPrev) return false;

    // Must be taking back the same moved piece from the prior capture.
    if (String(step.capturedPiece).toUpperCase() !== String(movedPrev).toUpperCase()) return false;

    const movedPrevVal = PIECE_VAL[movedPrev] || 0;
    const capturedPrevVal = PIECE_VAL[capturedPrev] || 0;
    const exchangeSwing = capturedPrevVal - movedPrevVal;

    // Equal-value capture-recapture is just a plain trade.
    if (exchangeSwing === 0) return true;
    // If the prior capture won material, do not suppress hanging-piece.
    if (exchangeSwing > 0) return false;

    // If the prior capture loses material, only keep suppression for low
    // eval-drop cases (likely intentional exchange sacrifices). For real
    // mistakes (>=100cp), allow hanging-piece tagging.
    const deltaCp = typeof mistake.deltaCp === 'number' ? Math.abs(mistake.deltaCp) : null;
    if (deltaCp !== null && deltaCp >= 100) return false;

    return true;
  }

  // Fallback path: infer an immediate recapture directly from PV steps.
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

    const movedPrevVal = PIECE_VAL[prev.movedPiece] || 0;
    const capturedPrevVal = PIECE_VAL[prev.capturedPiece] || 0;
    // With step-only context, suppress only pure equal-value recaptures.
    return movedPrevVal === capturedPrevVal;
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
  const opponent = moverSide === 'w' ? 'b' : 'w';
  if (isImmediatelyRecapturedOnDestination(steps, step, opponent)) return true;

  // If the PV is truncated right after this move, still suppress one-ply
  // transient pins when the destination piece can be recaptured at once.
  const idx = steps.indexOf(step);
  const hasVisibleReply = idx >= 0 && idx + 1 < steps.length;
  if (hasVisibleReply) return false;

  const toSq = String(step.uci || '').slice(2, 4);
  if (!/^[a-h][1-8]$/.test(toSq)) return false;
  const toIdx = step?.boardAfter?.sqToIdx?.(toSq);
  if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) return false;

  const movedAfter = step.boardAfter.pieceAt(toIdx);
  if (!movedAfter || step.boardAfter.colorOf(movedAfter) !== moverSide) return false;

  const bestRecaptureGain = bestLegalCaptureGainOnSquare(
    step.boardAfter,
    moverSide,
    toIdx,
    movedAfter
  );
  if (!Number.isFinite(bestRecaptureGain)) return false;
  return bestRecaptureGain >= 0;
}

/**
 * True if the side opposite `moverSide` has any legal recapture on target.
 */
function hasLegalRecapture(boardAfter, moverSide, targetIdx) {
  if (!boardAfter || !moverSide) return false;
  const opponent = moverSide === 'w' ? 'b' : 'w';
  const recapturers = boardAfter.attackers(opponent, targetIdx);

  for (const di of recapturers) {
    const dp = boardAfter.pieceAt(di);
    if (!dp || boardAfter.colorOf(dp) !== opponent) continue;

    const dt = dp.toUpperCase();
    let canRecapture = true;
    if (dt === 'K') {
      // King recapture must not move onto an attacked square.
      const attackersByMover = boardAfter.attackers(moverSide, targetIdx).filter(ai => ai !== di);
      canRecapture = attackersByMover.length === 0;
    } else if (pinnedDefenderCannotCapture(boardAfter, di, targetIdx)) {
      canRecapture = false;
    }

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
  if (!boardAfter || !moverSide || !Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) {
    return null;
  }

  const opponent = moverSide === 'w' ? 'b' : 'w';
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
    if (dt === 'K') {
      // King capture must not move onto an attacked square.
      const attackersByMover = boardAfter.attackers(moverSide, targetIdx).filter(ai => ai !== di);
      canRecapture = attackersByMover.length === 0;
    } else if (pinnedDefenderCannotCapture(boardAfter, di, targetIdx)) {
      canRecapture = false;
    }
    if (!canRecapture) continue;

    found = true;
    const capturerVal = effectivePieceValue(dp, di);
    const gain = targetVal - capturerVal;
    if (gain > bestGain) bestGain = gain;
  }

  return found ? bestGain : null;
}

function shouldSuppressCustomThreatRecapture(step, playerSide, steps = null) {
  if (!step || !step.boardAfter || !step.uci || !step.movedPiece) return false;
  if (step.capturedPiece) return false;

  const moverSide = step.side === 'w' || step.side === 'b'
    ? step.side
    : (playerSide === 'w' || playerSide === 'b' ? playerSide : null);
  if (!moverSide) return false;

  const opponent = moverSide === 'w' ? 'b' : 'w';
  if (Array.isArray(steps) && isImmediatelyRecapturedOnDestination(steps, step, opponent)) {
    return true;
  }

  const toSq = step.uci.slice(2, 4);
  if (!/^[a-h][1-8]$/.test(toSq)) return false;
  const toIdx = step.boardAfter.sqToIdx(toSq);
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;

  // Suppress only when the opponent can recapture without losing material
  // immediately. If recapture is a clearly losing trade (e.g. Qxg4 hxg4),
  // keep threat detection enabled.
  const bestRecaptureGain = bestLegalCaptureGainOnSquare(
    step.boardAfter,
    moverSide,
    toIdx,
    step.movedPiece
  );
  if (!Number.isFinite(bestRecaptureGain)) return false;
  return bestRecaptureGain >= 0;
}

function shouldSuppressAttackingUndefendedPieceOnImmediateTrade(steps, step, playerSide = null) {
  if (!Array.isArray(steps) || !step || !step.uci || !step.movedPiece) return false;
  const moverSide = (step.side === 'w' || step.side === 'b')
    ? step.side
    : (playerSide === 'w' || playerSide === 'b' ? playerSide : null);
  if (!moverSide) return false;
  const opponent = moverSide === 'w' ? 'b' : 'w';
  if (!isImmediatelyRecapturedOnDestination(steps, step, opponent)) return false;
  const toIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(2, 4));
  const fromIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(0, 2));
  const capturedVal = step.capturedPiece
    ? effectivePieceValue(step.capturedPiece, Number.isInteger(toIdx) ? toIdx : null)
    : 0;
  const movedVal = effectivePieceValue(step.movedPiece, Number.isInteger(fromIdx) ? fromIdx : null);
  return (capturedVal - movedVal) <= 0;
}

function filterToTactical(themes) {
  let arr = [];
  try {
    if (Array.isArray(themes)) arr = themes;
    else if (themes && typeof themes[Symbol.iterator] === 'function') arr = [...themes];
  } catch {}
  return [...new Set(arr)].filter(t => TACTICAL_THEMES.has(t));
}

const FILES = 'abcdefgh';
const PIECE_VAL = { P:1,p:1,N:3,n:3,B:3,b:3,R:5,r:5,Q:9,q:9,K:0,k:0 };
const DIAG_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ORTH_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
const ALL_DIRS  = DIAG_DIRS.concat(ORTH_DIRS);

function rcOf(i) { return { r: Math.floor(i / 8), c: i % 8 }; }
function idxOf(r, c) { return r * 8 + c; }
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function sqToIdx(sq) { return (7 - (parseInt(sq[1], 10) - 1)) * 8 + FILES.indexOf(sq[0]); }
function idxToSq(i) { return FILES[i % 8] + (8 - Math.floor(i / 8)); }
function dist(i1, i2) {
  const { r: r1, c: c1 } = rcOf(i1);
  const { r: r2, c: c2 } = rcOf(i2);
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

function effectivePieceValue(piece, idx = null) {
  const base = PIECE_VAL[piece] || 0;
  if (!piece || base <= 0) return 0;
  const type = String(piece).toUpperCase();
  if (type !== 'P') return base;
  if (!Number.isInteger(idx) || idx < 0 || idx > 63) return base;
  const { r } = rcOf(idx);
  const isWhitePawn = piece === type;
  const distToPromotion = isWhitePawn ? r : (7 - r);
  // Near-promotion pawns are materially/practically stronger.
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
  } catch { return []; }
}

/** Check if position is checkmate */
function isCheckmate(fen) {
  try {
    const cl = ChessLite();
    cl.loadFEN(fen);
    const loser = cl.turn();
    if (!cl.inCheck(loser)) return false;
    return cl.moves().length === 0;
  } catch { return false; }
}

/** Check if position is in check */
function positionInCheck(fen) {
  try {
    const cl = ChessLite();
    cl.loadFEN(fen);
    return cl.inCheck(cl.turn());
  } catch { return false; }
}

/* ================================================================== */
/*  Individual detectors (all operate on pre-computed state)           */
/* ================================================================== */

/**
 * FORK  after the best move, the moved piece attacks 2+ opponent
 * pieces that are either higher-value or hanging (pawn targets excluded).
 * King never forks. Piece must not be in bad spot.
 * King can be counted as a valid fork target for all attacker types.
 */
function detectFork(boardAfter, toIdx, movedPieceChar, opponent) {
  if (!movedPieceChar) return false;
  const movedType = movedPieceChar.toUpperCase();
  if (movedType === 'K') return false;

  if (boardAfter.isInBadSpot(toIdx)) return false;

  const movedVal = boardAfter.pieceValue(movedPieceChar);
  const attackedSquares = boardAfter.attacks(toIdx);
  const oppKingIdx = boardAfter.kingIdx(opponent);
  const givesDirectCheck = oppKingIdx >= 0 && attackedSquares.includes(oppKingIdx);
  let count = givesDirectCheck ? 1 : 0; // king is a valid fork target when directly checked

  for (const atkIdx of attackedSquares) {
    const target = boardAfter.pieceAt(atkIdx);
    if (!target) continue;
    if (boardAfter.colorOf(target) !== opponent) continue;
    if (target.toUpperCase() === 'P') continue;
    if (target.toUpperCase() === 'K') continue;

    const targetVal = boardAfter.PIECE_VALUES[target];
    if (targetVal > movedVal) {
      count++;
    } else if (boardAfter.isHanging(atkIdx)) {
      const defenders = boardAfter.attackers(opponent, toIdx);
      if (!defenders.includes(atkIdx)) count++;
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

  // Only minor pieces (N, B) can create functional pins.
  // Rooks/queens attacking a higher-value piece is just a normal attack.
  if (movedType !== 'N' && movedType !== 'B') return false;

  for (const atkIdx of attacks) {
    const target = boardAfter.pieceAt(atkIdx);
    if (!target) continue;
    if (boardAfter.colorOf(target) !== opponent) continue;
    const tt = target.toUpperCase();
    if (tt === 'P' || tt === 'K') continue;
    const targetVal = PIECE_VAL[target] || 0;
    if (targetVal <= movedVal) continue; // must attack a higher-value piece

    // Check if this piece is captured on the SAME square in a later player move
    // AND verify the piece doesn't move in between (truly stuck)
    const atkSq = idxToSq(atkIdx);

    // Find the index of the current step in the full _steps array
    const stepIdxInAll = _steps.indexOf(step);
    if (stepIdxInAll < 0) continue;

    // Check all intermediate steps for the target piece moving away
    let targetMoved = false;
    for (let si = stepIdxInAll + 1; si < _steps.length; si++) {
      const s = _steps[si];
      // If an opponent move originates from the attacked square, the piece moved
      if (s.side === opponent && s.uci.slice(0, 2) === atkSq) {
        targetMoved = true;
        break;
      }
      // If a player move captures on that square, check if it's the target
      if (s.side === _side && s.uci.slice(2, 4) === atkSq && s.capturedPiece) {
        if (!targetMoved) return true; // piece never moved   functionally pinned
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
  if (pinned.toUpperCase() === 'K') return false;

  const pType = pinner.toUpperCase();
  if (pType !== 'B' && pType !== 'R' && pType !== 'Q') return false;

  const a = rcOf(pinnerIdx);
  const b = rcOf(pinnedIdx);
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  if (dr === 0 && dc === 0) return false;

  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);
  const orth = (stepR === 0 || stepC === 0);
  const diag = Math.abs(dr) === Math.abs(dc);
  if (!orth && !diag) return false;
  if (pType === 'B' && !diag) return false;
  if (pType === 'R' && !orth) return false;

  // pinned must be first blocker from pinner.
  let rr = a.r + stepR;
  let cc = a.c + stepC;
  while (inBounds(rr, cc)) {
    const idx = idxOf(rr, cc);
    const pc = board.pieceAt(idx);
    if (pc) {
      if (idx !== pinnedIdx) return false;
      break;
    }
    rr += stepR;
    cc += stepC;
  }
  if (!inBounds(rr, cc)) return false;

  // behind must be next blocker after pinned.
  rr += stepR;
  cc += stepC;
  while (inBounds(rr, cc)) {
    const idx = idxOf(rr, cc);
    const pc = board.pieceAt(idx);
    if (pc) {
      if (idx !== behindIdx) return false;
      const behindType = behind.toUpperCase();
      const behindVal = board.PIECE_VALUES[behind] || 0;
      const pinnedVal = board.PIECE_VALUES[pinned] || 0;
      if (behindType === 'K') return true;
      if (behindVal > pinnedVal) return true;
      return isEqualOrLowerPinWithUndefendedScreen(
        board, behind, behindVal, pinnedVal, behindIdx, opponent, side, pinnedIdx, pinnerIdx
      );
    }
    rr += stepR;
    cc += stepC;
  }
  return false;
}

function isMeaningfulRelativePin(behindVal, pinnedVal, pinnerVal) {
  if (!Number.isFinite(behindVal) || !Number.isFinite(pinnedVal) || !Number.isFinite(pinnerVal)) {
    return false;
  }
  if (behindVal <= pinnedVal) return false;
  // If the pinner is equal/more valuable than the piece behind,
  // this is usually symmetric pressure rather than a tactical pin motif.
  if (behindVal <= pinnerVal) return false;
  return true;
}

function isLegalKingCaptureFromFen(fen, fromIdx, targetIdx) {
  if (typeof fen !== 'string' || !fen.trim()) return false;
  if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) return false;
  if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return false;
  const fromSq = idxToSq(fromIdx);
  const toSq = idxToSq(targetIdx);
  if (!/^[a-h][1-8]$/.test(fromSq) || !/^[a-h][1-8]$/.test(toSq)) return false;
  try {
    const cl = ChessLite();
    cl.loadFEN(fen);
    const mv = cl.moveUci(`${fromSq}${toSq}`);
    return !!mv?.ok;
  } catch {
    return false;
  }
}

function withFenTurn(fen, side) {
  if (typeof fen !== 'string' || !fen.trim()) return null;
  if (side !== 'w' && side !== 'b') return null;
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 2) return null;
  parts[1] = side;
  return parts.join(' ');
}

function tryApplyUciWithPromotionFallback(cl, uci, movedPiece, targetSq) {
  if (!cl || !uci) return null;
  let applied = null;
  try { applied = cl.moveUci(uci); } catch {}
  if (applied?.ok) return applied;

  const movedType = String(movedPiece || '').toUpperCase();
  if (movedType !== 'P') return null;
  if (!/^[a-h][18]$/.test(String(targetSq || ''))) return null;
  if (uci.length !== 4) return null;

  for (const promo of ['q', 'r', 'b', 'n']) {
    try {
      const p = cl.moveUci(`${uci}${promo}`);
      if (p?.ok) return p;
    } catch {}
  }
  return null;
}

function canKingRecaptureAfterSingleCapture(fen, board, defenderSide, attackerSide, kingIdx, targetIdx) {
  if (!board) return false;
  if (!Number.isInteger(kingIdx) || kingIdx < 0 || kingIdx > 63) return false;
  if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return false;
  if (defenderSide !== 'w' && defenderSide !== 'b') return false;
  if (attackerSide !== 'w' && attackerSide !== 'b') return false;

  const fenAttackerTurn = withFenTurn(fen, attackerSide);
  if (!fenAttackerTurn) return false;
  const targetSq = idxToSq(targetIdx);
  const attackerCandidates = board.attackers(attackerSide, targetIdx) || [];

  for (const ai of attackerCandidates) {
    const ap = board.pieceAt(ai);
    if (!ap || board.colorOf(ap) !== attackerSide) continue;
    if (String(ap).toUpperCase() === 'K') continue;
    if (pinnedDefenderCannotCapture(board, ai, targetIdx)) continue;

    const fromSq = idxToSq(ai);
    const captureUci = `${fromSq}${targetSq}`;

    let fenAfterCapture = null;
    try {
      const clCap = ChessLite();
      clCap.loadFEN(fenAttackerTurn);
      const cap = tryApplyUciWithPromotionFallback(clCap, captureUci, ap, targetSq);
      if (!cap?.ok) continue;
      fenAfterCapture = clCap.fen();
    } catch {
      continue;
    }
    if (!fenAfterCapture) continue;

    try {
      const boardAfterCap = ChessPrimitives(fenAfterCapture);
      const kingAfterIdx = boardAfterCap.kingIdx(defenderSide);
      if (!Number.isInteger(kingAfterIdx) || kingAfterIdx < 0) continue;
      const recaptureUci = `${idxToSq(kingAfterIdx)}${targetSq}`;
      const clRecap = ChessLite();
      clRecap.loadFEN(fenAfterCapture);
      const recap = clRecap.moveUci(recaptureUci);
      if (recap?.ok) return true;
    } catch {}
  }

  return false;
}

function countEffectiveCapturers(board, capturerSide, opposingSide, targetIdx, options = null) {
  if (!board || !Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 63) return 0;
  const excludeIdx = options && Number.isInteger(options.excludeIdx) ? options.excludeIdx : -1;
  const fen = options && typeof options.fen === 'string' ? options.fen : null;

  const candidates = board.attackers(capturerSide, targetIdx);
  if (!Array.isArray(candidates) || !candidates.length) return 0;

  let count = 0;
  for (const ci of candidates) {
    if (ci === excludeIdx) continue;
    const cp = board.pieceAt(ci);
    if (!cp || board.colorOf(cp) !== capturerSide) continue;

    const ct = cp.toUpperCase();
    if (ct === 'K') {
      // Prefer legal-move validation when FEN is available. Static attacked-square
      // checks can miscount king defenders in some tactical snapshots.
      if (fen) {
        if (isLegalKingCaptureFromFen(fen, ci, targetIdx)) {
          count++;
          continue;
        }
        // If target is occupied by own piece, allow king as an effective defender
        // when the king can legally recapture after a plausible enemy capture.
        const targetPiece = board.pieceAt(targetIdx);
        const ownTargetPiece = !!targetPiece && board.colorOf(targetPiece) === capturerSide;
        if (ownTargetPiece && canKingRecaptureAfterSingleCapture(fen, board, capturerSide, opposingSide, ci, targetIdx)) {
          count++;
          continue;
        }
        continue;
      } else {
        const enemyAttackers = board.attackers(opposingSide, targetIdx).filter(ei => ei !== ci);
        if (enemyAttackers.length > 0) continue;
      }
      count++;
      continue;
    }

    if (pinnedDefenderCannotCapture(board, ci, targetIdx)) continue;
    count++;
  }

  return count;
}

function isEffectivelyUnderdefended(board, targetIdx, defenderSide, attackerSide, options = null) {
  const excludeDefenderIdx = options && Number.isInteger(options.excludeDefenderIdx)
    ? options.excludeDefenderIdx
    : -1;
  const extraAttackers = options && Number.isInteger(options.extraAttackers)
    ? Math.max(0, options.extraAttackers)
    : 0;
  const fen = options && typeof options.fen === 'string' ? options.fen : null;

  const attackers = countEffectiveCapturers(board, attackerSide, defenderSide, targetIdx, { fen }) + extraAttackers;
  const defenders = countEffectiveCapturers(board, defenderSide, attackerSide, targetIdx, {
    excludeIdx: excludeDefenderIdx,
    fen,
  });
  return attackers > defenders;
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
  const orth = (stepR === 0 || stepC === 0);
  const diag = Math.abs(dr) === Math.abs(dc);
  if (!orth && !diag) return 0;

  const pinnerType = String(pinner).toUpperCase();
  if (diag && pinnerType !== 'B' && pinnerType !== 'Q') return 0;
  if (orth && pinnerType !== 'R' && pinnerType !== 'Q') return 0;

  // Only the nearest friendly slider behind the pinner is immediate support.
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
    const isSupportingSlider = diag
      ? (type === 'B' || type === 'Q')
      : (type === 'R' || type === 'Q');
    return isSupportingSlider ? 1 : 0;
  }
  return 0;
}

function isEqualOrLowerPinWithUndefendedScreen(
  board, behindPiece, behindVal, pinnedVal, behindIdx, defenderSide, attackerSide, pinnedIdx, pinnerIdx = -1
) {
  if (!Number.isFinite(behindVal) || !Number.isFinite(pinnedVal)) return false;
  if (!behindPiece || String(behindPiece).toUpperCase() === 'P') return false;
  // Intentionally do NOT require behindVal <= pinnedVal here.
  // This branch also handles cases where a high-value screened piece is
  // still tactically loose/overloaded despite the pinner being expensive
  // (e.g. Q pins N to an undefended R).

  // If the pinned piece moves, the pinner gains a direct attack on the screened piece.
  const currentAttackers = board.attackers(attackerSide, behindIdx);
  const pinnerAlreadyAttacks = Array.isArray(currentAttackers) && currentAttackers.includes(pinnerIdx);
  const pinnerAsNewAttacker = (pinnerIdx >= 0 && !pinnerAlreadyAttacks) ? 1 : 0;
  const xraySupport = pinnerIdx >= 0
    ? countXRaySupportBehindPinner(board, attackerSide, pinnerIdx, behindIdx)
    : 0;
  const extraAttackers = pinnerAsNewAttacker + xraySupport;

  return isEffectivelyUnderdefended(board, behindIdx, defenderSide, attackerSide, {
    excludeDefenderIdx: pinnedIdx,
    extraAttackers,
  });
}

/**
 * Borderline pin probe: if the defender "accepts" by moving the pinned piece,
 * can the attacker immediately win the screened piece?
 *
 * This targets conditional pin motifs (like moving a blocker that opens a
 * tactical capture), without running expensive multipv analysis.
 */
function detectAcceptedPinConsequence(
  fenAfter, boardAfter, attackerSide, defenderSide, pinnedIdx, screenedIdx, pinnerIdx
) {
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
  if (String(screenedPiece).toUpperCase() === 'K') return false;
  if ((PIECE_VAL[screenedPiece] || 0) < 2) return false;

  // Must be the defender to move in this probing position.
  try {
    const turn = String(fenAfter).trim().split(/\s+/)[1];
    if (turn !== defenderSide) return false;
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
      // Capturing the pinner is not an "accepted pin" branch.
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
    try { boardAccepted = ChessPrimitives(fenAccepted); } catch { continue; }

    const pinnerNowIdx = boardAccepted.sqToIdx(pinnerSq);
    const pinnerNow = boardAccepted.pieceAt(pinnerNowIdx);
    if (!pinnerNow || boardAccepted.colorOf(pinnerNow) !== attackerSide) continue;
    if (String(pinnerNow).toUpperCase() !== pinnerType) continue;

    const screenedNowIdx = boardAccepted.sqToIdx(screenedSq);
    const screenedNow = boardAccepted.pieceAt(screenedNowIdx);
    if (!screenedNow || boardAccepted.colorOf(screenedNow) !== defenderSide) continue;
    if (String(screenedNow).toUpperCase() !== screenedType) continue;

    // The pinner must have a direct line/attack to the screened piece now.
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
    try { boardAfterCapture = ChessPrimitives(fenAfterCapture); } catch { continue; }

    const captureIdx = boardAfterCapture.sqToIdx(screenedSq);
    const recaptured = hasLegalRecapture(boardAfterCapture, attackerSide, captureIdx);
    const capturedVal = PIECE_VAL[screenedNow] || 0;
    const pinnerVal = PIECE_VAL[pinnerNow] || 0;

    const favorablePrimaryCapture = capturedVal > pinnerVal;
    if (!recaptured && favorablePrimaryCapture && capturedVal >= 2) return true;
    if (recaptured && favorablePrimaryCapture && (capturedVal - pinnerVal) >= 2) return true;

    // One extra exchange cycle: capture -> recapture -> recapture.
    // This catches motifs where the first recapture exists, but is itself
    // tactically punished on the same square.
    if (recaptured) {
      const defenderRecapturers = boardAfterCapture.attackers(defenderSide, captureIdx) || [];
      for (const di of defenderRecapturers) {
        const dp = boardAfterCapture.pieceAt(di);
        if (!dp || boardAfterCapture.colorOf(dp) !== defenderSide) continue;

        const dt = String(dp).toUpperCase();
        let canRecapture = true;
        if (dt === 'K') {
          const attackersByAttacker = boardAfterCapture.attackers(attackerSide, captureIdx).filter(ai => ai !== di);
          canRecapture = attackersByAttacker.length === 0;
        } else if (pinnedDefenderCannotCapture(boardAfterCapture, di, captureIdx)) {
          canRecapture = false;
        }
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
        try { boardAfterRecapture = ChessPrimitives(fenAfterRecapture); } catch { continue; }

        const canAttackerRecapture = hasLegalRecapture(
          boardAfterRecapture,
          defenderSide,
          boardAfterRecapture.sqToIdx(screenedSq)
        );
        if (!canAttackerRecapture) continue;

        const recapturerVal = PIECE_VAL[dp] || 0;
        if (favorablePrimaryCapture && (capturedVal - pinnerVal + recapturerVal) >= 2) return true;
      }
    }
  }

  return false;
}

function hasLegalMoveFromSquare(fen, fromSq, options = null) {
  if (!fen || !/^[a-h][1-8]$/.test(String(fromSq || ''))) return false;
  const excludeToSquare = /^[a-h][1-8]$/.test(String(options?.excludeToSquare || ''))
    ? String(options.excludeToSquare)
    : null;
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
  const screenedSq = Number.isInteger(screenedIdx) && screenedIdx >= 0 && screenedIdx <= 63
    ? idxToSq(screenedIdx)
    : null;
  const maxIdx = Math.min(steps.length - 1, stepIndex + 3);
  for (let i = stepIndex + 1; i <= maxIdx; i++) {
    const step = steps[i];
    if (!step || !step.uci || !step.capturedPiece) continue;
    const stepSide = normalizeSide(step.side, step.fenBefore);
    if (stepSide !== attackerSide) continue;
    const toSq = step.uci.slice(2, 4);
    if (toSq === pinnedSq || (screenedSq && toSq === screenedSq)) return true;
  }
  return false;
}

function detectPin(boardAfter, toIdx, side, opponent, boardBefore, fromIdxHint = null) {
  const fromIdx = Number.isInteger(fromIdxHint) && fromIdxHint >= 0
    ? fromIdxHint
    : (boardBefore ? _findFromIdx(boardAfter, boardBefore, side, toIdx) : -1);

  // Scan all friendly ray pieces for pins
  for (let i = 0; i < 64; i++) {
    const pc = boardAfter.pieceAt(i);
    if (!pc) continue;
    if (boardAfter.colorOf(pc) !== side) continue;
    const t = pc.toUpperCase();
    if (t !== 'B' && t !== 'R' && t !== 'Q') continue;

    const dirs = (t === 'B') ? DIAG_DIRS
               : (t === 'R') ? ORTH_DIRS
               :               ALL_DIRS;

    const { r: pr, c: pCol } = rcOf(i);

    for (const [dr, dc] of dirs) {
      let rr = pr + dr, cc = pCol + dc;
      let firstPiece = null, firstIdx = -1;
      let raySquares = []; // squares on the ray between pinner and pinned

      while (inBounds(rr, cc)) {
        const idx = idxOf(rr, cc);
        const p = boardAfter.pieceAt(idx);
        if (p) { firstPiece = p; firstIdx = idx; break; }
        raySquares.push(idx);
        rr += dr; cc += dc;
      }
      if (!firstPiece || boardAfter.colorOf(firstPiece) !== opponent) continue;
      if (firstPiece.toUpperCase() === 'K') continue;

      // continue along ray to find what's behind
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
            const pinnerVal = boardAfter.PIECE_VALUES[pc] || 0;
            const highValuePin = isMeaningfulRelativePin(behindVal, pinnedVal, pinnerVal);
            const undefendedEqualOrLowerPin = isEqualOrLowerPinWithUndefendedScreen(
              boardAfter, p, behindVal, pinnedVal, idx, opponent, side, firstIdx, i
            );
            // pin exists if piece behind is king, meaningful high-value, or tactically underdefended.
            if (behindType === 'K' || highValuePin || undefendedEqualOrLowerPin) {
              // Relative pawn pins are noisy when only "created"; require
              // explicit exploitation (pressure/capture) via pin-exploitation.
              if (pinnedType === 'P' && behindType !== 'K') break;

              // Check this pin is CAUSED by the move:
              // (a) The pinner IS the moved piece (it just arrived at square i = toIdx)
              const pinnerIsMoved = (i === toIdx);
              // (b) The move cleared a square on the pin ray (discovered pin)
              const moveCleared = fromIdx >= 0 &&
                (raySquares.includes(fromIdx) || behindRaySquares.includes(fromIdx));

              if (!pinnerIsMoved && !moveCleared) break; // incidental pin, skip

              // Also verify pin is NEW (didn't exist before)
              if (boardBefore) {
                const pinnerBefore = boardBefore.pieceAt(i);
                const pinnedBefore = boardBefore.pieceAt(firstIdx);
                const behindBefore = boardBefore.pieceAt(idx);
                if (pinnerBefore && boardBefore.colorOf(pinnerBefore) === side &&
                    pinnerBefore.toUpperCase() === t &&
                    pinnedBefore && pinnedBefore === firstPiece &&
                    behindBefore && behindBefore === p) {
                  break;
                }

                // Pin already existed with the same moved ray piece from its
                // previous square (just maintained after sliding).
                if (pinnerIsMoved && fromIdx >= 0) {
                  const movedBefore = boardBefore.pieceAt(fromIdx);
                  if (movedBefore && movedBefore === pc) {
                    if (hasPinGeometry(boardBefore, fromIdx, firstIdx, idx, side, opponent)) {
                      break;
                    }
                  }
                }
              }
              return true;
            }
          }
          break;
        }
        behindRaySquares.push(idx);
        rr += dr; cc += dc;
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
  if (pinnerIdx === null || pinnerIdx === undefined) return false;

  // Capturing the pinner itself can be legal, so don't treat that as blocked.
  if (targetIdx === pinnerIdx) return false;

  const clr = boardAfter.colorOf(defender);
  const ki = boardAfter.kingIdx(clr);
  if (ki < 0) return false;

  // If target is not on the king<->pinner line, the pinned piece cannot move there.
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

    const dt = dp.toUpperCase();
    // A king failing to capture a protected square is a normal check/tempo
    // motif, not pin exploitation. Ignore kings for this detector.
    if (dt === 'K') continue;

    consideredDefenders++;
    const canCapture = !pinnedDefenderCannotCapture(boardAfter, di, toIdx);

    if (canCapture) legalCapturers++;
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
    if (pinned.toUpperCase() === 'K') return null;

    const absolutePinner = board.isPinned(pinnedIdx);
    if (absolutePinner !== null && absolutePinner !== undefined) {
      return {
        ok: true,
        isAbsolute: true,
        pinnedType: pinned.toUpperCase(),
        behindType: 'K',
        pinnerIdx: absolutePinner,
        screenedIdx: board.kingIdx(opponent),
      };
    }

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
            const isOrth = !isDiag;
            hasAttackingSlider = (isDiag && (type === 'B' || type === 'Q')) ||
              (isOrth && (type === 'R' || type === 'Q'));
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
            if (behindType === 'K') {
              return {
                ok: true,
                isAbsolute: true,
                pinnedType: pinned.toUpperCase(),
                behindType,
                pinnerIdx: attackingSliderIdx,
                screenedIdx: idx,
              };
            }
            const highValuePin = isMeaningfulRelativePin(behindVal, pinnedVal, attackingSliderVal);
            const undefendedEqualOrLowerPin = isEqualOrLowerPinWithUndefendedScreen(
              board, piece, behindVal, pinnedVal, idx, opponent, side, pinnedIdx, attackingSliderIdx
            );
            const acceptedPinProbe = (!highValuePin && !undefendedEqualOrLowerPin)
              ? detectAcceptedPinConsequence(
                  fenContext, board, side, opponent, pinnedIdx, idx, attackingSliderIdx
                )
              : false;
            if (highValuePin || undefendedEqualOrLowerPin || acceptedPinProbe) {
              return {
                ok: true,
                isAbsolute: false,
                pinnedType: pinned.toUpperCase(),
                behindType,
                pinnerIdx: attackingSliderIdx,
                screenedIdx: idx,
              };
            }
          }
          break;
        }
        rr -= dr;
        cc -= dc;
      }
    }

    return null;
  }

  // Do NOT classify "captured a previously pinned piece" as a pin motif.
  // We only keep pin themes when the move creates or increases pin pressure.

  // Or the moved piece now attacks a pinned opponent piece.
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

    // Relative pawn pins are only relevant when pressure is concrete.
    // Require at least two attackers after the move.
    if (!pinInfoAfter.isAbsolute && pinInfoAfter.pinnedType === 'P') {
      const afterAttackers = boardAfter.attackers(side, atkIdx).length;
      if (afterAttackers < 2) continue;
    }

    // Absolute pinned pawns can still move along the pin line (e.g. b2-b4).
    // Treat as pin only when there is concrete near-term payoff in the PV.
    if (pinInfoAfter.isAbsolute && pinInfoAfter.pinnedType === 'P') {
      const pinnedSq = idxToSq(atkIdx);
      const pinnerSq = Number.isInteger(pinInfoAfter.pinnerIdx) ? idxToSq(pinInfoAfter.pinnerIdx) : null;
      const hasReleaseMove = hasLegalMoveFromSquare(fenAfter, pinnedSq, { excludeToSquare: pinnerSq });
      if (hasReleaseMove) {
        const hasConcretePayoff = hasImmediatePinPayoffInSteps(
          options?.steps,
          options?.stepIndex,
          side,
          atkIdx,
          pinInfoAfter.screenedIdx
        );
        if (!hasConcretePayoff) continue;
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
  try { if (detectPinnedDefenderExploitation(boardAfter, toIdx, side, opponent)) return true; } catch {}
  try {
    if (detectPinnedPiecePressure(boardBefore, boardAfter, toIdx, side, opponent, fenAfter, options)) return true;
  } catch {}
  return false;
}

/** Helper: find the from-square index by comparing boards */
function _findFromIdx(boardAfter, boardBefore, side, toIdx) {
  // The piece at toIdx in boardAfter was somewhere else in boardBefore
  const pc = boardAfter.pieceAt(toIdx);
  if (!pc) return -1;
  // Check if this piece was at toIdx before (not a new arrival)
  const pcBefore = boardBefore.pieceAt(toIdx);
  if (pcBefore === pc) return -1; // piece didn't move here
  // Find where this piece came from: look for same piece in boardBefore that's gone in boardAfter
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
  if (t !== 'B' && t !== 'R' && t !== 'Q') return false;

  const dirs = (t === 'B') ? DIAG_DIRS
             : (t === 'R') ? ORTH_DIRS
             :               ALL_DIRS;

  const { r: pr, c: pCol } = rcOf(toIdx);

  for (const [dr, dc] of dirs) {
    let rr = pr + dr, cc = pCol + dc;
    let firstPiece = null, firstIdx = -1;

    while (inBounds(rr, cc)) {
      const idx = idxOf(rr, cc);
      const p = boardAfter.pieceAt(idx);
      if (p) { firstPiece = p; firstIdx = idx; break; }
      rr += dr; cc += dc;
    }
    if (!firstPiece || boardAfter.colorOf(firstPiece) !== opponent) continue;
    // Front piece must be KING (forced to move, making skewer genuine).
    // Q/R as front piece is too prone to false positives (not forced to move).
    const ft = firstPiece.toUpperCase();
    if (ft !== 'K') continue;

    // continue to find piece behind the king
    rr = rcOf(firstIdx).r + dr;
    cc = rcOf(firstIdx).c + dc;
    while (inBounds(rr, cc)) {
      const idx = idxOf(rr, cc);
      const p = boardAfter.pieceAt(idx);
      if (p) {
        if (boardAfter.colorOf(p) === opponent) {
          // Back piece must be worth something (no pawns)
          if (p.toUpperCase() === 'P') break;
          return true;
        }
        break;
      }
      rr += dr; cc += dc;
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
  const opponent = side === 'w' ? 'b' : 'w';
  const { r: fr, c: fc } = rcOf(openedIdx);

  for (const [dr, dc] of ALL_DIRS) {
    // Find the nearest friendly ray piece behind the newly opened square.
    let attackerIdx = -1;
    let attackerPiece = null;
    let rr = fr + dr, cc = fc + dc;
    while (inBounds(rr, cc)) {
      const idx = idxOf(rr, cc);
      const p = boardAfter.pieceAt(idx);
      if (p) {
        if (boardAfter.colorOf(p) === side) {
          const t = p.toUpperCase();
          const isDiag = (dr !== 0 && dc !== 0);
          if ((isDiag && (t === 'B' || t === 'Q')) || (!isDiag && (t === 'R' || t === 'Q'))) {
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

    // Find the first enemy piece on the opposite ray.
    let targetIdx = -1;
    let targetPiece = null;
    rr = fr - dr;
    cc = fc - dc;
    while (inBounds(rr, cc)) {
      const idx = idxOf(rr, cc);
      const p = boardAfter.pieceAt(idx);
      if (p) {
        if (boardAfter.colorOf(p) === opponent && p.toUpperCase() !== 'P') {
          targetIdx = idx;
          targetPiece = p;
        }
        break;
      }
      rr -= dr;
      cc -= dc;
    }
    if (targetIdx < 0 || !targetPiece) continue;

    // Must be newly revealed by the move (attacker was not attacking it before).
    const attackersBefore = boardBefore.attackers(side, targetIdx);
    if (attackersBefore.includes(attackerIdx)) continue;

    return { attackerIdx, attackerPiece, targetIdx, targetPiece };
  }

  return null;
}

function isRelevantDiscoveredHit(boardAfter, hit) {
  if (!hit || !hit.targetPiece || !hit.attackerPiece) return false;
  const targetType = hit.targetPiece.toUpperCase();

  // Discovered check is always tactically relevant.
  if (targetType === 'K') return true;

  // Immediate tactical pressure on the target.
  if (boardAfter.isInBadSpot(hit.targetIdx)) return true;
  if (boardAfter.isPinned(hit.targetIdx)) return true;

  // Materially sensible pressure: discovered attacker should target
  // something more valuable, unless the square is overloaded.
  const attackerVal = PIECE_VAL[hit.attackerPiece] || 0;
  const targetVal = PIECE_VAL[hit.targetPiece] || 0;
  if (targetVal > attackerVal) return true;
  if (targetVal < attackerVal) return false;

  const side = boardAfter.colorOf(hit.attackerPiece);
  if (side !== 'w' && side !== 'b') return false;
  const opponent = side === 'w' ? 'b' : 'w';
  const attackers = boardAfter.attackers(side, hit.targetIdx).length;
  const defenders = boardAfter.attackers(opponent, hit.targetIdx).length;
  return attackers > defenders;
}

function detectDiscoveredAttack(boardBefore, boardAfter, fromIdx, toIdx, side, isEp) {
  // Promotion should not be classified as discovered attack: the tactical
  // identity is the promotion itself, and line-opening side effects are noisy.
  try {
    const movedBefore = boardBefore?.pieceAt?.(fromIdx);
    if (movedBefore && String(movedBefore).toUpperCase() === 'P') {
      const toRow = rcOf(toIdx).r;
      if (toRow === 0 || toRow === 7) return false;
    }
  } catch {}

  const primary = findRevealedRayAttack(boardBefore, boardAfter, fromIdx, side);
  if (isRelevantDiscoveredHit(boardAfter, primary)) return true;

  // En passant can open a second line through the removed pawn square.
  if (isEp) {
    const epCapturedRow = rcOf(fromIdx).r;
    const epCapturedCol = rcOf(toIdx).c;
    const epCapturedIdx = idxOf(epCapturedRow, epCapturedCol);
    const epHit = findRevealedRayAttack(boardBefore, boardAfter, epCapturedIdx, side);
    if (isRelevantDiscoveredHit(boardAfter, epHit)) return true;
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
  const side = opponent === 'w' ? 'b' : 'w';
  if (!boardAfter) return false;
  if (!ENABLE_TRAPPED_PIECE_DETECTION) return false;
  const DEFERRED_TRAP_LOOKAHEAD_PLIES = 5;
  const DEFERRED_TRAP_MIN_GAIN = 2;
  // TEMP performance kill-switch: keep logic in code but disable deep
  // branch-proof search until we rework it with a lower-cost approach.
  const ENABLE_TRAPPED_BRANCH_PROOF = false;
  // TEMP performance mode: disable escape-concession sub-search paths.
  // This keeps fast trapped-piece heuristics active while removing the
  // expensive branchy checks that can freeze large datasets.
  const ENABLE_TRAPPED_ESCAPE_CONCESSION = false;
  const BRANCH_PROOF_MAX_NODES = 180;
  const BRANCH_PROOF_MAX_MS = 6;

  // In checking positions, legal move lists are constrained to check evasions,
  // which creates noisy trapped-piece false positives on unrelated pieces.
  if (typeof _fenAfter === 'string' && _fenAfter.trim() && positionInCheck(_fenAfter)) return false;

  function moveFromSq(m) {
    if (!m) return null;
    if (typeof m === 'string') return m.slice(0, 2);
    if (typeof m.from === 'string') return m.from;
    if (typeof m.uci === 'string') return m.uci.slice(0, 2);
    return null;
  }

  function moveToUci(m) {
    if (!m) return null;
    if (typeof m === 'string') return m.toLowerCase();
    if (typeof m.uci === 'string') return m.uci.toLowerCase();
    if (typeof m.from === 'string' && typeof m.to === 'string') {
      const promo = (typeof m.promotion === 'string' && m.promotion) ? m.promotion.toLowerCase() : '';
      return `${m.from}${m.to}${promo}`;
    }
    return null;
  }

  function simulateFenAfterMove(startFen, move) {
    const uci = moveToUci(move);
    if (!uci || typeof startFen !== 'string' || !startFen.trim()) return null;
    try {
      const cl = ChessLite();
      cl.loadFEN(startFen);
      const mv = cl.moveUci(uci);
      if (!mv?.ok) return null;
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
        if (typeof fenContext !== 'string' || !fenContext.trim()) return null;
        const parts = fenContext.trim().split(/\s+/);
        if (parts.length < 2) return fenContext.trim();
        const turn = String(parts[1] || '').toLowerCase();
        if (turn === ownSide) return parts.join(' ');
        parts[1] = ownSide;
        return parts.join(' ');
      } catch {
        return null;
      }
    })();
    const canSimulate = typeof simFen === 'string' && !!simFen.trim();

    for (const dst of attacks) {
      const occ = board.pieceAt(dst);
      if (occ && board.colorOf(occ) === ownSide) continue;
      let legal = true;
      let attackedByEnemy = false;
      if (canSimulate) {
        const dstSq = idxToSq(dst);
        const fenAfterCandidate = simulateFenAfterMove(simFen, `${fromSq}${dstSq}`);
        if (!fenAfterCandidate) {
          legal = false;
        } else {
          try {
            const boardAfterCandidate = ChessPrimitives(fenAfterCandidate);
            const movedNow = boardAfterCandidate.pieceAt(dst);
            if (!movedNow || boardAfterCandidate.colorOf(movedNow) !== ownSide) {
              legal = false;
            } else {
              attackedByEnemy = (boardAfterCandidate.attackers(enemySide, dst) || []).length > 0;
            }
          } catch {
            legal = false;
          }
        }
      } else {
        attackedByEnemy = (board.attackers(enemySide, dst) || []).length > 0;
      }
      if (!legal) continue;
      legalSquares.push(dst);

      if (occ && board.colorOf(occ) === enemySide) {
        const capVal = PIECE_VAL[occ] || 0;
        if (capVal >= pieceVal) canTradeUpCapture = true;
      }

      if (!attackedByEnemy) safeSquares.push(dst);
    }

    const attackedNow = (board.attackers(enemySide, pieceIdx) || []).length > 0;
    return {
      piece,
      pieceVal,
      attackedNow,
      legalSquares,
      safeSquares,
      canTradeUpCapture,
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

    const opponentSide = ownSide === 'w' ? 'b' : 'w';
    let captureGain = bestLegalCaptureGainOnSquare(defendedBoard, ownSide, toIdx, movedAfter);
    // Prefer legal-move validation when we have FEN: this catches practical
    // "escape" moves where the piece can still be won immediately (e.g. N->g6, fxg6).
    if (typeof defendedFen === 'string' && defendedFen.trim()) {
      try {
        const legalReplies = getLegalMoves(defendedFen) || [];
        const toSq = idxToSq(toIdx);
        const mover = ownSide === 'w' ? 'b' : 'w';
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
        if (foundLegalCapture && (!Number.isFinite(captureGain) || legalBestGain > captureGain)) {
          captureGain = legalBestGain;
        }
      } catch {}
    }
    if (Number.isFinite(captureGain) && captureGain >= MIN_CONCESSION_GAIN) {
      return true;
    }

    // Also treat "save queen by hanging a minor/major piece" as too costly,
    // even if immediate capture gain isn't strictly large by the heuristic.
    if (movedVal >= MIN_MAJOR_PIECE_VALUE) {
      const enemyAttackers = (defendedBoard.attackers(opponentSide, toIdx) || []).length;
      const ownDefenders = (defendedBoard.attackers(ownSide, toIdx) || []).length;
      if (enemyAttackers > ownDefenders) return true;
      if (enemyAttackers > 0 && ownDefenders === 0 && defendedBoard.isInBadSpot(toIdx)) return true;
    }

    return false;
  }

  function isPieceForcedLostInShortBranch(
    fen,
    trackedIdx,
    trackedType,
    ownSide,
    enemySide,
    pliesLeft,
    cache = null,
    branchGuard = null
  ) {
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
    try { board = ChessPrimitives(fen); } catch {
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
      const seenAttackerCandidate = new Set();
      const addAttackerCandidate = (mv, priority = 99) => {
        const key = moveToUci(mv);
        if (!key || seenAttackerCandidate.has(key)) return;
        seenAttackerCandidate.add(key);
        attackerCandidates.push({ mv, priority });
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
          if (capturedBefore && board.colorOf(capturedBefore) === ownSide) {
            addAttackerCandidate(mv, 4);
          }
        } catch {}
      }

      const MAX_ATTACKER_BRANCHES = 14;
      const attackerMoves = attackerCandidates.length
        ? attackerCandidates
            .sort((a, b) => a.priority - b.priority)
            .slice(0, MAX_ATTACKER_BRANCHES)
            .map((entry) => entry.mv)
        : legalMoves;

      for (const mv of attackerMoves) {
        const uci = moveToUci(mv);
        if (!uci || uci.length < 4) continue;
        const fromIdx = board.sqToIdx(uci.slice(0, 2));
        const toIdx = board.sqToIdx(uci.slice(2, 4));
        if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx > 63) continue;
        if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;

        const fenNext = simulateFenAfterMove(fen, mv);
        if (!fenNext) continue;

        // If attacker captures the tracked piece now, require net gain and
        // reject if immediate recapture fully offsets the swing.
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

        if (isPieceForcedLostInShortBranch(
          fenNext,
          trackedIdx,
          trackedType,
          ownSide,
          enemySide,
          pliesLeft - 1,
          cache,
          branchGuard
        )) {
          if (cache) cache.set(key, true);
          return true;
        }
      }
      if (cache) cache.set(key, false);
      return false;
    }

    // Defender-to-move: if any legal reply avoids forced loss, the piece is
    // not forced to be lost in this branch.
    const currentAttackers = board.attackers(enemySide, trackedIdx) || [];
    const defendersBefore = (board.attackers(ownSide, trackedIdx) || []).length;
    const attackersBefore = currentAttackers.length;
    const defenderCandidates = [];
    const seenDefenderCandidate = new Set();
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
        if (defendersAfter > defendersBefore || attackersAfter < attackersBefore) {
          addDefenderCandidate(mv);
        }
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
        if (!movedPiece || board.colorOf(movedPiece) !== ownSide || String(movedPiece).toUpperCase() !== trackedType) {
          continue;
        }
        nextTrackedIdx = toIdx;
      }

      if (!isPieceForcedLostInShortBranch(
        fenNext,
        nextTrackedIdx,
        trackedType,
        ownSide,
        enemySide,
        pliesLeft - 1,
        cache,
        branchGuard
      )) {
        if (cache) cache.set(key, false);
        return false;
      }
    }

    if (cache) cache.set(key, true);
    return true;
  }

  function pieceEscapesOnlyWithConcession(defendedBoard, defendedFen, pieceIdx, ownSide, options = null) {
    const MIN_ESCAPE_CONCESSION_GAIN = 2;
    const enableBranchProof = !!(options && typeof options === 'object' && options.branchAware);
    const branchPlies = enableBranchProof && Number.isFinite(Number(options.branchPlies))
      ? Math.max(1, Math.min(6, Number(options.branchPlies)))
      : 3;
    const branchCache = enableBranchProof ? new Map() : null;
    const branchGuard = enableBranchProof
      ? { nodes: 0, startedAt: Date.now(), aborted: false }
      : null;

    if (!defendedBoard || typeof defendedFen !== 'string' || !defendedFen.trim()) return false;
    if (!Number.isInteger(pieceIdx) || pieceIdx < 0 || pieceIdx > 63) return false;
    const pieceSq = idxToSq(pieceIdx);
    const legalReplies = getLegalMoves(defendedFen) || [];
    const pieceMoves = legalReplies.filter((mv) => moveFromSq(mv) === pieceSq);
    if (!pieceMoves.length) return true;

    for (const mv of pieceMoves) {
      const uci = moveToUci(mv);
      if (!uci || uci.length < 4) continue;
      const fenAfterPieceMove = simulateFenAfterMove(defendedFen, mv);
      if (!fenAfterPieceMove) continue;
      let boardAfterPieceMove = null;
      try { boardAfterPieceMove = ChessPrimitives(fenAfterPieceMove); } catch { continue; }
      const toIdx = boardAfterPieceMove.sqToIdx(uci.slice(2, 4));
      if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > 63) continue;
      const movedNow = boardAfterPieceMove.pieceAt(toIdx);
      if (!movedNow || boardAfterPieceMove.colorOf(movedNow) !== ownSide) continue;

      // Strict material check: escape must concede >=2 points to count as trapped.
      let immediateLoss = null;
      try {
        const enemySide = ownSide === 'w' ? 'b' : 'w';
        const movedVal = PIECE_VAL[movedNow] || 0;
        if (movedVal > 0) {
          const attackers = boardAfterPieceMove.attackers(enemySide, toIdx) || [];
          let best = Number.NEGATIVE_INFINITY;
          let found = false;
          for (const ai of attackers) {
            const capturer = boardAfterPieceMove.pieceAt(ai);
            if (!capturer) continue;
            if (boardAfterPieceMove.colorOf(capturer) !== enemySide) continue;
            const capturerVal = PIECE_VAL[capturer] || 0;
            const gain = movedVal - capturerVal;
            found = true;
            if (gain > best) best = gain;
          }
          if (found) immediateLoss = best;
        }
      } catch {}
      if (!Number.isFinite(immediateLoss) || immediateLoss < MIN_ESCAPE_CONCESSION_GAIN) {
        if (!enableBranchProof) {
          // Found at least one practical escape that doesn't lose significant material.
          return false;
        }
        const enemySide = ownSide === 'w' ? 'b' : 'w';
        const escapeState = analyzePieceState(boardAfterPieceMove, toIdx, ownSide, enemySide, fenAfterPieceMove);
        const hasRobustSafeEscape = !!escapeState
          && !escapeState.attackedNow
          && Array.isArray(escapeState.safeSquares)
          && escapeState.safeSquares.length >= 4;
        if (hasRobustSafeEscape) {
          const trackedType = String(movedNow).toUpperCase();
          const forcedBranchLoss = isPieceForcedLostInShortBranch(
            fenAfterPieceMove,
            toIdx,
            trackedType,
            ownSide,
            enemySide,
            branchPlies,
            branchCache,
            branchGuard
          );
          if (!forcedBranchLoss) return false;
          continue;
        }
        // Low-mobility "escapes" are treated as non-robust unless a separate
        // robust branch proof disproves the trap.
        continue;
      }
    }

    return true;
  }

  function pieceForcedLossAfterEscapeInShownLine(steps, stepIndex, ownSide, enemySide, startIdx, pieceType) {
    if (!Array.isArray(steps) || !steps.length) return false;
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) return false;
    if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx > 63) return false;
    const trackedType = String(pieceType || '').toUpperCase();
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
        const movedType = String(step.movedPiece || '').toUpperCase();
        if (fromIdx === trackedIdx && movedType === trackedType) {
          trackedIdx = toIdx;
          escapedByOwner = true;
        }
        continue;
      }

      const capturedType = String(step.capturedPiece || '').toUpperCase();
      if (toIdx !== trackedIdx || capturedType !== trackedType) continue;
      if (!escapedByOwner) continue;

      const capturedVal = PIECE_VAL[step.capturedPiece] || 0;
      const capturerVal = PIECE_VAL[step.movedPiece] || 0;
      const gain = capturedVal - capturerVal;
      if (!Number.isFinite(gain) || gain < DEFERRED_TRAP_MIN_GAIN) continue;

      // Immediate recapture only invalidates trap proof if it fully offsets
      // (or exceeds) the material swing of the capture that won the tracked piece.
      const next = steps[i + 1];
      if (next && normalizeSide(next.side, next.fenBefore) === ownSide && next.uci) {
        const nextTo = String(next.uci).slice(2, 4);
        const thisTo = String(step.uci).slice(2, 4);
        if (nextTo === thisTo && next.capturedPiece && step.movedPiece) {
          const recapCapturedVal = PIECE_VAL[next.capturedPiece] || 0;
          const recapMoverVal = PIECE_VAL[next.movedPiece] || 0;
          const recapGain = recapCapturedVal - recapMoverVal;
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
    const trackedType = String(pieceType || '').toUpperCase();
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
        const movedType = String(step.movedPiece || '').toUpperCase();
        if (fromIdx === trackedIdx && movedType === trackedType) {
          trackedIdx = toIdx;
        }
        continue;
      }

      const capturedType = String(step.capturedPiece || '').toUpperCase();
      if (toIdx !== trackedIdx || capturedType !== trackedType) continue;

      const capturedVal = PIECE_VAL[step.capturedPiece] || 0;
      const capturerVal = PIECE_VAL[step.movedPiece] || 0;
      const gain = capturedVal - capturerVal;
      if (!Number.isFinite(gain) || gain < DEFERRED_TRAP_MIN_GAIN) continue;

      // Immediate recapture only invalidates trap proof if it fully offsets
      // (or exceeds) the material swing of the capture that won the tracked piece.
      const next = steps[i + 1];
      if (next && normalizeSide(next.side, next.fenBefore) === ownSide && next.uci) {
        const nextTo = String(next.uci).slice(2, 4);
        const thisTo = String(step.uci).slice(2, 4);
        if (nextTo === thisTo && next.capturedPiece && step.movedPiece) {
          const recapCapturedVal = PIECE_VAL[next.capturedPiece] || 0;
          const recapMoverVal = PIECE_VAL[next.movedPiece] || 0;
          const recapGain = recapCapturedVal - recapMoverVal;
          if (Number.isFinite(recapGain) && recapGain >= gain) continue;
        }
      }

      return true;
    }

    return false;
  }


  const legalMovesAfter = (typeof _fenAfter === 'string' && _fenAfter.trim())
    ? getLegalMoves(_fenAfter)
    : [];
  const stepsContext = Array.isArray(options?.steps) ? options.steps : [];
  const stepContextIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : -1;

  for (let pieceIdx = 0; pieceIdx < 64; pieceIdx++) {
    const piece = boardAfter.pieceAt(pieceIdx);
    if (!piece) continue;
    if (boardAfter.colorOf(piece) !== opponent) continue;
    const type = piece.toUpperCase();
    if (type !== 'N' && type !== 'B' && type !== 'R' && type !== 'Q') continue;
    if (boardAfter.isPinned(pieceIdx)) continue; // Pin > Trap hierarchy

    const afterState = analyzePieceState(boardAfter, pieceIdx, opponent, side, _fenAfter);
    if (!afterState) continue;

    const noSafeAfter = afterState.safeSquares.length === 0;
    const noLegalAfter = afterState.legalSquares.length === 0;
    const hotTrapAfter = afterState.attackedNow && noSafeAfter;
    const coffinTrapAfter = !afterState.attackedNow && noLegalAfter;
    let badSpotAfter = false;
    try { badSpotAfter = !!boardAfter.isInBadSpot(pieceIdx); } catch {}
    const pressureAfter = afterState.attackedNow || badSpotAfter;
    const forcedConcessionTrapAfter = ENABLE_TRAPPED_ESCAPE_CONCESSION
      && pressureAfter
      && noSafeAfter
      && pieceEscapesOnlyWithConcession(
      boardAfter,
      _fenAfter,
      pieceIdx,
      opponent
    );
    const immediateTrapAfter = hotTrapAfter || coffinTrapAfter || forcedConcessionTrapAfter;

    let beforeState = null;
    let beforeBadSpot = false;
    let becameTrapped = true;
    let wasCoffinBefore = false;
    let pressureIntroducedByMove = false;
    if (boardBefore) {
      const beforePiece = boardBefore.pieceAt(pieceIdx);
      if (!beforePiece || boardBefore.colorOf(beforePiece) !== opponent || beforePiece.toUpperCase() !== type) {
        continue;
      }
      beforeState = analyzePieceState(boardBefore, pieceIdx, opponent, side, _fenBefore);
      if (!beforeState) continue;
      try { beforeBadSpot = !!boardBefore.isInBadSpot(pieceIdx); } catch {}
      const noSafeBefore = beforeState.safeSquares.length === 0;
      const noLegalBefore = beforeState.legalSquares.length === 0;
      const hotTrapBefore = beforeState.attackedNow && noSafeBefore;
      const coffinTrapBefore = !beforeState.attackedNow && noLegalBefore;
      wasCoffinBefore = coffinTrapBefore;
      becameTrapped = !hotTrapBefore && !coffinTrapBefore;
      pressureIntroducedByMove =
        (afterState.attackedNow && !beforeState.attackedNow)
        || (badSpotAfter && !beforeBadSpot);
    }

    let deferredLineTrapAfter = false;
    if (ENABLE_TRAPPED_ESCAPE_CONCESSION && !immediateTrapAfter) {
      const hasLimitedSafeEscapes = afterState.safeSquares.length <= 1;
      let noPracticalEscape = false;
      if (hasLimitedSafeEscapes) {
        const useBranchAwareEscapeProof = ENABLE_TRAPPED_BRANCH_PROOF && afterState.safeSquares.length === 1;
        noPracticalEscape = pieceEscapesOnlyWithConcession(
          boardAfter,
          _fenAfter,
          pieceIdx,
          opponent,
          useBranchAwareEscapeProof ? { branchAware: true, branchPlies: 2 } : null
        );
      }
      const pressureCreated = !beforeState
        ? true
        : (
            (afterState.attackedNow && !beforeState.attackedNow)
            || (badSpotAfter && !beforeBadSpot)
            || (afterState.safeSquares.length < beforeState.safeSquares.length)
          );
      if (hasLimitedSafeEscapes && noPracticalEscape && pressureCreated && Array.isArray(stepsContext) && stepContextIndex >= 0) {
        deferredLineTrapAfter = pieceForcedLossAfterEscapeInShownLine(
          stepsContext,
          stepContextIndex,
          opponent,
          side,
          pieceIdx,
          type
        );
      }
    }
    if (!immediateTrapAfter && !deferredLineTrapAfter) continue;
    const usingDeferredPath = !immediateTrapAfter && deferredLineTrapAfter;

    // Desperado/trade-up filter.
    if (afterState.canTradeUpCapture) continue;

    // Capture sanity signals used by targeted false-positive filters.
    let immediateTrapGain = Number.NEGATIVE_INFINITY;
    try {
      immediateTrapGain = bestLegalCaptureGainOnSquare(boardAfter, opponent, pieceIdx, piece);
    } catch {}

    // Freshness (delta): the move should create the trapped state.
    // Also allow "activated coffin" cases where the piece had no legal
    // moves before, and this move newly introduces winning pressure.
    let activatedCoffinTrap = false;
    if (!becameTrapped && wasCoffinBefore && pressureIntroducedByMove) {
      activatedCoffinTrap = Number.isFinite(immediateTrapGain) && immediateTrapGain >= DEFERRED_TRAP_MIN_GAIN;
    }
    let lineProvesPieceLoss = false;
    if (
      Array.isArray(stepsContext)
      && stepContextIndex >= 0
      && (
        activatedCoffinTrap
        || (Number.isFinite(immediateTrapGain) && immediateTrapGain < 0)
      )
    ) {
      lineProvesPieceLoss =
        pieceForcedLossInShownLine(
          stepsContext,
          stepContextIndex,
          opponent,
          side,
          pieceIdx,
          type
        )
        || pieceForcedLossAfterEscapeInShownLine(
          stepsContext,
          stepContextIndex,
          opponent,
          side,
          pieceIdx,
          type
        );
    }

    // "Make space" filter: if another legal move immediately relieves pressure
    // or opens a safe square, do not tag as trapped.
    let hasRelief = false;
    if (Array.isArray(legalMovesAfter) && legalMovesAfter.length && typeof _fenAfter === 'string' && _fenAfter.trim()) {
      const pieceSq = idxToSq(pieceIdx);
      for (const mv of legalMovesAfter) {
        if (moveFromSq(mv) === pieceSq) continue;
        const fenAfterDefense = simulateFenAfterMove(_fenAfter, mv);
        if (!fenAfterDefense) continue;

        let boardAfterDefense = null;
        try { boardAfterDefense = ChessPrimitives(fenAfterDefense); } catch { continue; }
        const stillThere = boardAfterDefense.pieceAt(pieceIdx);
        if (!stillThere || boardAfterDefense.colorOf(stillThere) !== opponent) continue;
        if (stillThere.toUpperCase() !== type) continue;

        const defenseState = analyzePieceState(boardAfterDefense, pieceIdx, opponent, side, fenAfterDefense);
        if (!defenseState) continue;
        if (!defenseState.attackedNow || defenseState.safeSquares.length > 0 || defenseState.canTradeUpCapture) {
          // A "relief" move is not valid if the pressured piece can still be
          // won immediately before it gets to use any newly-opened escapes.
          const immediateLossAfterDefense = bestLegalCaptureGainOnSquare(
            boardAfterDefense,
            opponent,
            pieceIdx,
            stillThere
          );
          if (
            Number.isFinite(immediateLossAfterDefense) &&
            immediateLossAfterDefense >= DEFERRED_TRAP_MIN_GAIN
          ) {
            continue;
          }
          if (usingDeferredPath || lineProvesPieceLoss) {
            continue;
          }
          if (
            ENABLE_TRAPPED_ESCAPE_CONCESSION
            && pieceEscapesOnlyWithConcession(boardAfterDefense, fenAfterDefense, pieceIdx, opponent)
          ) {
            continue;
          }
          if (reliefMoveConcedesTooMuch(boardAfter, boardAfterDefense, mv, opponent, fenAfterDefense)) {
            continue;
          }
          hasRelief = true;
          break;
        }
      }
    }
    if (hasRelief) continue;

    // Targeted false-positive guard:
    // If the "trap" is only pressure from higher-value attackers against
    // an already-defended piece, and immediate capture is a losing trade,
    // suppress unless the shown line proves the piece is still won.
    let defendedByOwnSide = false;
    let onlyHigherValueAttackers = false;
    try {
      const defenders = boardAfter.attackers(opponent, pieceIdx) || [];
      defendedByOwnSide = defenders.length > 0;

      const attackers = boardAfter.attackers(side, pieceIdx) || [];
      const targetVal = effectivePieceValue(piece, pieceIdx);
      let seenAttacker = false;
      let allHigher = true;
      for (const ai of attackers) {
        const attackerPiece = boardAfter.pieceAt(ai);
        if (!attackerPiece || boardAfter.colorOf(attackerPiece) !== side) continue;
        seenAttacker = true;
        const attackerVal = effectivePieceValue(attackerPiece, ai);
        if (attackerVal <= targetVal) {
          allHigher = false;
          break;
        }
      }
      onlyHigherValueAttackers = seenAttacker && allHigher;
    } catch {}
    const immediateCaptureIsLosingTrade = Number.isFinite(immediateTrapGain) && immediateTrapGain < 0;
    if (
      defendedByOwnSide
      && onlyHigherValueAttackers
      && immediateCaptureIsLosingTrade
      && !usingDeferredPath
      && !lineProvesPieceLoss
    ) {
      continue;
    }

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
  const meta = options && typeof options === 'object'
    ? (options.mistake && typeof options.mistake === 'object' ? options.mistake : options)
    : null;
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
      const color = rootBoard.colorOf(piece);
      if (color === playerSide) playerMaterial += value;
      else opponentMaterial += value;
    }
    return Math.max(0, opponentMaterial - playerMaterial);
  }

  function isSacrificeLikeTrigger(step) {
    if (!step || !step.movedPiece) return false;
    if (String(step.movedPiece).toUpperCase() === 'K') return false;
    if (!step.capturedPiece) return true;
    const movedVal = PIECE_VAL[step.movedPiece] || 0;
    const capVal = PIECE_VAL[step.capturedPiece] || 0;
    // A trigger that wins/equalizes material immediately is usually not
    // the sacrificial commitment point.
    return capVal < movedVal;
  }

  function isForcedKingDefense(step) {
    if (!step || !step.movedPiece || !step.fenBefore) return false;
    if (String(step.movedPiece).toUpperCase() !== 'K') return false;
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
    const triggerFrom = triggerStep.uci.slice(0, 2);
    if (triggerFrom === lossSquare) return false;

    const lossIdx = triggerStep.boardBefore.sqToIdx(lossSquare);
    if (lossIdx < 0) return false;
    const prePiece = triggerStep.boardBefore.pieceAt(lossIdx);
    if (!prePiece) return false;
    if (triggerStep.boardBefore.colorOf(prePiece) !== playerSide) return false;
    if (String(prePiece).toUpperCase() !== String(lossStep.capturedPiece).toUpperCase()) return false;

    // Piece was already tactically vulnerable before the trigger move,
    // so this is likely a forced loss, not a voluntary sacrifice.
    return triggerStep.boardBefore.isInBadSpot(lossIdx);
  }

  function isTriggerCapturedSoon(triggerStepIndex, lookAheadPly = 4) {
    if (!Number.isInteger(triggerStepIndex) || triggerStepIndex < 0 || triggerStepIndex >= steps.length) return false;
    const triggerStep = steps[triggerStepIndex];
    if (!triggerStep || !triggerStep.uci || !triggerStep.movedPiece) return false;
    const triggerTo = triggerStep.uci.slice(2, 4);
    const movedType = String(triggerStep.movedPiece).toUpperCase();
    if (!triggerTo || !movedType) return false;

    const opponent = playerSide === 'w' ? 'b' : 'w';
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
    if (!steps.length) return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
    const opponent = playerSide === 'w' ? 'b' : 'w';
    const finalCumulative = Number(steps[steps.length - 1]?.cumulativeDelta) || 0;

    for (let i = 0; i + 1 < steps.length; i++) {
      const step = steps[i];
      if (!step || step.side !== playerSide || !step.boardAfter || !step.uci || !step.movedPiece) continue;
      if (!isSacrificeLikeTrigger(step)) continue;
      if (isForcedKingDefense(step)) continue;
      const triggerPlayerPly = countPlayerPlyAtIndex(steps, i, playerSide);
      if (triggerPlayerPly > MAX_DECLINED_TRIGGER_PLAYER_PLY) continue;
      const preExistingAdvantage = Number(step.cumulativeDelta) || 0;
      // If the side is already clearly ahead, "declined sacrifice" signals
      // become noisy (often just conversion choices in winning lines).
      if (preExistingAdvantage > MAX_PRE_EXISTING_ADVANTAGE_FOR_DECLINED) continue;
      // Conservative gate: declined-sacrifice detection should only trigger
      // on forcing ideas (capture/check), not quiet maneuvering motifs.
      const isForcingTrigger = !!step.capturedPiece || positionInCheck(step.fenAfter);
      if (!isForcingTrigger) continue;

      const movedVal = PIECE_VAL[step.movedPiece] || 0;
      if (movedVal < MIN_MATERIAL_LOSS) continue;

      const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
      if (!Number.isInteger(toIdx) || toIdx < 0) continue;

      const bestGain = bestLegalCaptureGainOnSquare(step.boardAfter, playerSide, toIdx, step.movedPiece);
      if (!Number.isFinite(bestGain) || bestGain < MIN_MATERIAL_LOSS) continue;

      const next = steps[i + 1];
      if (!next || next.side !== opponent) continue;
      if (isDirectTriggerRecapture(step, next)) continue;
      if (isTriggerCapturedSoon(i, 4)) continue;

      // Declined sacrifice should keep enough compensation in the shown line.
      if (finalCumulative <= -MIN_MATERIAL_LOSS) continue;

      return { isSacrifice: true, triggerStepIndex: i, deficitStepIndex: -1 };
    }

    return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
  }

  const deltaAbs = (meta && typeof meta.deltaCp === 'number' && Number.isFinite(meta.deltaCp))
    ? Math.abs(meta.deltaCp)
    : null;
  // Forcing declined sacrifices can still be valid around mistake-level drops.
  if (deltaAbs !== null && deltaAbs < MIN_DECLINED_DELTA_CP) {
    return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
  }
  const allowAcceptedSacPath = (deltaAbs === null) || (deltaAbs >= MIN_ACCEPTED_DELTA_CP);

  const intentCp = resolveIntentCp();
  const forcingPayoff = hasForcingPayoff();
  if (intentCp !== null && intentCp < MIN_INTENT_CP && !forcingPayoff) {
    return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
  }
  if (intentCp === null) {
    const rootMaterialDeficit = resolveRootMaterialDeficit();
    if (rootMaterialDeficit !== null && rootMaterialDeficit >= MIN_DESPERATION_MATERIAL_DEFICIT && !forcingPayoff) {
      return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
    }
  }

  let hasPlayerPromotion = false;
  for (const step of steps) {
    if (step.promotion && step.side === playerSide) hasPlayerPromotion = true;
  }
  if (hasPlayerPromotion) return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };

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
        // Allow a slightly longer exchange cycle (up to 4 plies) so
        // temporary tactical imbalances are not mislabeled as sacrifice.
        for (let j = i + 1; j < Math.min(i + 5, steps.length); j++) {
          if (steps[j].capturedPiece) {
            const cVal = PIECE_VAL[steps[j].capturedPiece] || 0;
            if (steps[j].side === playerSide) lookAheadMat += cVal;
            else lookAheadMat -= cVal;
          }
          // If the immediate exchange cycle brings the player back to within
          // one pawn, treat it as an exchange sequence, not a sacrifice.
          if (steps[j].side === playerSide && lookAheadMat > -MIN_MATERIAL_LOSS) {
            recovered = true;
            break;
          }
        }
        if (recovered) continue;

        let triggerStepIndex = -1;
        for (let k = i - 1; k >= 0; k--) {
          if (steps[k].side === playerSide) {
            triggerStepIndex = k;
            break;
          }
        }
        if (triggerStepIndex < 0) continue;
        const triggerStep = steps[triggerStepIndex];
        if (!isSacrificeLikeTrigger(triggerStep)) continue;
        if (isForcedKingDefense(triggerStep)) continue;
        if (!isDirectTriggerRecapture(triggerStep, step)) continue;
        const movedVal = PIECE_VAL[triggerStep.movedPiece] || 0;
        const triggerCaptureVal = PIECE_VAL[triggerStep.capturedPiece] || 0;
        if ((movedVal - triggerCaptureVal) < MIN_MATERIAL_LOSS) continue;
        if (isLikelyForcedLoss(triggerStepIndex, i)) continue;
        return { isSacrifice: true, triggerStepIndex, deficitStepIndex: i };
      }
    }
  }

  // Path 2: opponent declines a legal material-winning capture.
  const declined = detectDeclinedSacrifice();
  if (declined.isSacrifice) return declined;

  return { isSacrifice: false, triggerStepIndex: -1, deficitStepIndex: -1 };
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
  if (movedPiece && movedPiece.toUpperCase() === 'K') return false;
  if (!boardAfter || !movedPiece) return boardBefore.isHanging(toIdx);

  const moverSide = boardAfter.colorOf(movedPiece);
  if (!moverSide) return false;

  // Any legal recapture means this is a trade/exchange, not hanging piece.
  if (hasLegalRecapture(boardAfter, moverSide, toIdx)) return false;

  return true;
}

/**
 * A material-winning capture can still be a hanging-piece punishment even
 * when a legal recapture exists (e.g., winning an exchange).
 */
function detectMaterialWinningCapture(step) {
  if (!step || !step.capturedPiece || !step.movedPiece) return false;
  if (String(step.movedPiece).toUpperCase() === 'K') return false;
  const toIdx = step?.boardBefore?.sqToIdx?.(String(step.uci || '').slice(2, 4));
  const fromIdx = step?.boardBefore?.sqToIdx?.(String(step.uci || '').slice(0, 2));
  const captureVal = effectivePieceValue(step.capturedPiece, Number.isInteger(toIdx) ? toIdx : null);
  const movedVal = effectivePieceValue(step.movedPiece, Number.isInteger(fromIdx) ? fromIdx : null);
  return captureVal - movedVal >= 2;
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
  if (String(step.movedPiece).toUpperCase() === 'K') return false;

  const side = step.side === 'w' || step.side === 'b' ? step.side : null;
  if (!side) return false;
  const opponent = side === 'w' ? 'b' : 'w';

  const toSq = String(step.uci).slice(2, 4);
  const toIdx = step.boardBefore.sqToIdx(toSq);
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;

  const capturedVal = effectivePieceValue(step.capturedPiece, toIdx);
  if (capturedVal <= 0) return false;

  // Before the capture, the target must already be effectively loose.
  const underdefendedBefore = isEffectivelyUnderdefended(
    step.boardBefore,
    toIdx,
    opponent,
    side,
    { fen: step.fenBefore }
  );
  if (!underdefendedBefore) return false;

  // If defender's best immediate recapture wins material, do not classify as hanging.
  const bestRecaptureGain = bestLegalCaptureGainOnSquare(
    step.boardAfter,
    side,
    toIdx,
    step.movedPiece
  );
  if (Number.isFinite(bestRecaptureGain) && bestRecaptureGain > 0) return false;

  return true;
}

/**
 * Rule 2 (conceded path):
 * The bad move hangs a piece (on its destination square), and the opponent
 * captures that exact piece later in the refutation PV.
 */
function detectHungPiecePunishInPv(steps, side, mistake) {
  if (!Array.isArray(steps) || !steps.length || !mistake?._prevFen || !mistake?._prevPlayedMove) {
    return false;
  }

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
    if (step.movedPiece && step.movedPiece.toUpperCase() === 'K') continue;
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
function detectAttackingUndefendedPiece(
  boardBefore, boardAfter, fromIdx, toIdx, opponent, movedPiece, capturedPiece, fenBefore = null, fenAfter = null
) {
  if (!boardAfter || !movedPiece || capturedPiece) return false;
  if (String(movedPiece).toUpperCase() === 'K') return false;
  const side = opponent === 'w' ? 'b' : 'w';
  const movedVal = effectivePieceValue(movedPiece, Number.isInteger(toIdx) ? toIdx : null);

  const afterAttacks = boardAfter.attacks(toIdx) || [];
  const beforeAttacks = (boardBefore && Number.isInteger(fromIdx) && fromIdx >= 0)
    ? (boardBefore.attacks(fromIdx) || [])
    : [];

  for (const targetIdx of afterAttacks) {
    const targetPiece = boardAfter.pieceAt(targetIdx);
    if (!targetPiece) continue;
    if (boardAfter.colorOf(targetPiece) !== opponent) continue;
    if (String(targetPiece).toUpperCase() === 'K') continue;

    const attackedBeforeByMovedPiece = Array.isArray(beforeAttacks) && beforeAttacks.includes(targetIdx);
    const targetVal = effectivePieceValue(targetPiece, targetIdx);
    if (boardAfter.isHanging(targetIdx)) {
      const hangingBefore = !!(boardBefore && boardBefore.isHanging(targetIdx));
      // Require fresh relevance: newly attacked by the moved piece, or newly loose.
      if (!hangingBefore || !attackedBeforeByMovedPiece) return true;
      continue;
    }

    // Also treat fresh attacks on much higher-value pieces as concrete threats
    // even when defended (e.g., pawn attacking queen).
    // Use base piece values here (not promotion-adjusted effective values),
    // so advanced pawns still count as "little piece threatening bigger piece".
    const movedBaseVal = (PIECE_VAL[movedPiece] || movedVal);
    const targetBaseVal = (PIECE_VAL[targetPiece] || targetVal);
    if (!attackedBeforeByMovedPiece && (targetBaseVal - movedBaseVal) >= 2) {
      return true;
    }

    // Shared "underdefended" concept: effective attackers > effective defenders.
    // We tag it when this move creates the imbalance or adds fresh pressure.
    const underAfter = isEffectivelyUnderdefended(boardAfter, targetIdx, opponent, side, { fen: fenAfter });
    if (!underAfter) continue;

    const underBefore = boardBefore
      ? isEffectivelyUnderdefended(boardBefore, targetIdx, opponent, side, { fen: fenBefore })
      : false;
    if (!underBefore || !attackedBeforeByMovedPiece) return true;
  }

  return false;
}

function detectBackRank(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const side = opponent === 'w' ? 'b' : 'w';

  // Back rank: white's back rank is row 7 (rank 1), black's back rank is row 0 (rank 8)
  const backRank = opponent === 'w' ? 7 : 0;
  const { r: kr, c: kc } = rcOf(ki);
  if (kr !== backRank) return false;

  // must be in check
  if (boardAfter.checkerCount(opponent) === 0) return false;

  // Checker must be a rook or queen on the back rank (checking along the rank)
  const checkers = boardAfter.attackers(side, ki);
  let hasRankChecker = false;
  for (const ci of checkers) {
    const cp = boardAfter.pieceAt(ci);
    if (!cp) continue;
    const ct = cp.toUpperCase();
    if ((ct === 'R' || ct === 'Q') && rcOf(ci).r === backRank) {
      hasRankChecker = true;
      break;
    }
  }
  if (!hasRankChecker) return false;

  // The key feature of back rank: the king can't escape FORWARD
  // because of own pieces (typically pawns). Check that the forward rank
  // has own pieces blocking ALL adjacent forward squares.
  const forwardDir = opponent === 'w' ? -1 : 1;  // toward center
  const forwardRow = kr + forwardDir;
  let forwardBlockedCount = 0;
  let forwardSquareCount = 0;
  if (inBounds(forwardRow, 0)) {
    for (let dc = -1; dc <= 1; dc++) {
      const nc = kc + dc;
      if (!inBounds(forwardRow, nc)) continue;
      forwardSquareCount++;
      const idx = idxOf(forwardRow, nc);
      const p = boardAfter.pieceAt(idx);
      if (p && boardAfter.colorOf(p) === opponent) {
        forwardBlockedCount++;
      }
    }
  }
  // All forward squares must be blocked by own pieces
  if (forwardBlockedCount < forwardSquareCount) return false;

  return true;
}

/* ================================================================== */
/*  Phase 2: Mate pattern detectors                                    */
/* ================================================================== */

/**
 * SMOTHERED MATE  Knight delivers checkmate. Every square at distance 1
 * from king is occupied by the king's own pieces (no empty squares adjacent).
 */
function detectSmotheredMate(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const { r: kr, c: kc } = rcOf(ki);

  // Find checker  must be exactly 1 checker and it must be a knight
  const side = opponent === 'w' ? 'b' : 'w';
  const checkers = boardAfter.attackers(side, ki);
  if (checkers.length !== 1) return false;
  const checker = boardAfter.pieceAt(checkers[0]);
  if (!checker || checker.toUpperCase() !== 'N') return false;

  // Every adjacent square must be occupied by own pieces
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = kr + dr, nc = kc + dc;
      if (!inBounds(nr, nc)) continue;
      const idx = idxOf(nr, nc);
      const p = boardAfter.pieceAt(idx);
      if (!p) return false; // empty square = not smothered
      if (boardAfter.colorOf(p) !== opponent) return false; // enemy piece (king could capture)
    }
  }
  return true;
}

/**
 * ANASTASIA MATE  King on file a or h (not corner). Checker is Q or R on same file.
 * Square toward center has friendly blocker. Knight of solver 3 squares from king.
 */
function detectAnastasiaMate(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const { r: kr, c: kc } = rcOf(ki);
  const side = opponent === 'w' ? 'b' : 'w';

  // King must be on file a or h (columns 0 or 7) but not in corner
  if (kc !== 0 && kc !== 7) return false;
  if ((kr === 0 || kr === 7)) return false; // corner

  const checkers = boardAfter.attackers(side, ki);
  if (checkers.length === 0) return false;

  // One checker must be Q or R on same file as king
  let hasRayChecker = false;
  for (const ci of checkers) {
    const cp = boardAfter.pieceAt(ci);
    if (!cp) continue;
    const ct = cp.toUpperCase();
    if ((ct === 'Q' || ct === 'R') && rcOf(ci).c === kc) {
      hasRayChecker = true;
      break;
    }
  }
  if (!hasRayChecker) return false;

  // Square toward center from king has friendly (opponent's) blocker
  const centerDir = kc === 0 ? 1 : -1;
  const blockIdx = idxOf(kr, kc + centerDir);
  const blocker = boardAfter.pieceAt(blockIdx);
  if (!blocker || boardAfter.colorOf(blocker) !== opponent) return false;

  // Knight of solver within distance of 3 from king (Chebyshev)
  for (let i = 0; i < 64; i++) {
    const p = boardAfter.pieceAt(i);
    if (!p || boardAfter.colorOf(p) !== side || p.toUpperCase() !== 'N') continue;
    if (dist(i, ki) <= 3) return true;
  }
  return false;
}

/**
 * HOOK MATE  Checker is Rook at distance 1. Rook defended by Knight
 * at distance 1 from king. Knight defended by pawn.
 */
function detectHookMate(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const side = opponent === 'w' ? 'b' : 'w';

  const checkers = boardAfter.attackers(side, ki);

  for (const ci of checkers) {
    const cp = boardAfter.pieceAt(ci);
    if (!cp || cp.toUpperCase() !== 'R') continue;
    if (dist(ci, ki) !== 1) continue;

    // Rook must be defended by a knight
    const rookDefenders = boardAfter.attackers(side, ci);
    for (const di of rookDefenders) {
      const dp = boardAfter.pieceAt(di);
      if (!dp || dp.toUpperCase() !== 'N') continue;
      if (dist(di, ki) !== 1) continue;

      // Knight must be defended by a pawn
      const knightDefenders = boardAfter.attackers(side, di);
      for (const ki2 of knightDefenders) {
        const kp = boardAfter.pieceAt(ki2);
        if (kp && kp.toUpperCase() === 'P') return true;
      }
    }
  }
  return false;
}

/**
 * ARABIAN MATE  King in corner. Checker is Rook at distance 1.
 * Knight defends rook, positioned with |rank_diff|=2 and |file_diff|=2 from king.
 */
function detectArabianMate(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const { r: kr, c: kc } = rcOf(ki);
  const side = opponent === 'w' ? 'b' : 'w';

  // King must be in corner
  if (!((kr === 0 || kr === 7) && (kc === 0 || kc === 7))) return false;

  const checkers = boardAfter.attackers(side, ki);
  for (const ci of checkers) {
    const cp = boardAfter.pieceAt(ci);
    if (!cp || cp.toUpperCase() !== 'R') continue;
    if (dist(ci, ki) !== 1) continue;

    // Rook defended by knight with specific geometry
    const rookDefenders = boardAfter.attackers(side, ci);
    for (const di of rookDefenders) {
      const dp = boardAfter.pieceAt(di);
      if (!dp || dp.toUpperCase() !== 'N') continue;
      const { r: nr, c: nc } = rcOf(di);
      if (Math.abs(nr - kr) === 2 && Math.abs(nc - kc) === 2) return true;
    }
  }
  return false;
}

/**
 * BODEN MATE / DOUBLE BISHOP MATE  Checkmate with 2 bishops.
 * If bishops are on opposite sides of king   boden, else   doubleBishop.
 */
function detectBishopMates(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return { boden: false, doubleBishop: false };
  const { r: kr, c: kc } = rcOf(ki);
  const side = opponent === 'w' ? 'b' : 'w';

  const checkers = boardAfter.attackers(side, ki);
  // All checkers near king must be bishops
  const bishopCheckers = [];
  for (const ci of checkers) {
    const cp = boardAfter.pieceAt(ci);
    if (!cp) continue;
    if (cp.toUpperCase() !== 'B') return { boden: false, doubleBishop: false };
    bishopCheckers.push(ci);
  }

  if (bishopCheckers.length < 2) return { boden: false, doubleBishop: false };

  // Check if bishops are on opposite sides of king
  const b1 = rcOf(bishopCheckers[0]);
  const b2 = rcOf(bishopCheckers[1]);
  const onOppositeSides = (b1.c < kc && b2.c > kc) || (b1.c > kc && b2.c < kc) ||
                          (b1.r < kr && b2.r > kr) || (b1.r > kr && b2.r < kr);

  return {
    boden: onOppositeSides,
    doubleBishop: !onOppositeSides
  };
}

/**
 * DOVETAIL MATE  Queen mates non-edge king diagonally (distance 1, not same file/rank).
 * All king escape squares blocked uniquely.
 */
function detectDovetailMate(boardAfter, opponent) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return false;
  const { r: kr, c: kc } = rcOf(ki);
  const side = opponent === 'w' ? 'b' : 'w';

  // King must not be on edge
  if (kr === 0 || kr === 7 || kc === 0 || kc === 7) return false;

  const checkers = boardAfter.attackers(side, ki);
  if (checkers.length !== 1) return false;

  const checker = boardAfter.pieceAt(checkers[0]);
  if (!checker || checker.toUpperCase() !== 'Q') return false;

  // Queen must be diagonal to king (distance 1, not same file/rank)
  const { r: qr, c: qc } = rcOf(checkers[0]);
  if (Math.abs(qr - kr) !== 1 || Math.abs(qc - kc) !== 1) return false;

  return true;
}

/* ================================================================== */
/*  En passant / castling helpers                                      */
/* ================================================================== */

function isEnPassant(boardBefore, fromIdx, toIdx, movedPiece) {
  if (!movedPiece || movedPiece.toUpperCase() !== 'P') return false;
  const fc = fromIdx % 8;
  const tc = toIdx % 8;
  if (fc === tc) return false;
  return !boardBefore.pieceAt(toIdx);
}

function isCastling(movedPiece, fromIdx, toIdx) {
  if (!movedPiece || movedPiece.toUpperCase() !== 'K') return false;
  const fc = fromIdx % 8;
  const tc = toIdx % 8;
  return Math.abs(fc - tc) >= 2;
}

/* ================================================================== */
/*  PV walking  find the material-swing moment                        */
/* ================================================================== */

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
    const toIdx   = boardBefore.sqToIdx(uci.slice(2, 4));
    const movedPiece  = boardBefore.pieceAt(fromIdx);
    const capturedPiece = boardBefore.pieceAt(toIdx);
    const isEp = movedPiece && movedPiece.toUpperCase() === 'P' &&
                 fromIdx % 8 !== toIdx % 8 && !capturedPiece;
    const epCaptured = isEp ? (side === 'w' ? 'p' : 'P') : null;
    const captured = capturedPiece || epCaptured;

    const mv = cl.moveUci(uci);
    if (!mv || !mv.ok) break;
    const fenAfter = cl.fen();

    let capturedIdx = toIdx;
    if (isEp && Number.isInteger(toIdx)) {
      capturedIdx = side === 'w' ? (toIdx + 8) : (toIdx - 8);
    }
    const captureVal = captured ? effectivePieceValue(captured, Number.isInteger(capturedIdx) ? capturedIdx : null) : 0;
    const delta = (side === playerSide) ? captureVal : -captureVal;
    cumulative += delta;

    steps.push({
      uci, fenBefore, fenAfter, movedPiece, capturedPiece: captured,
      materialDelta: delta, cumulativeDelta: cumulative,
      side, boardBefore, boardAfter: ChessPrimitives(fenAfter),
      isEp, promotion: uci.length > 4 ? uci[4] : null
    });
  }
  return steps;
}

/**
 * Find the "payoff step"  the first step in the PV where playerSide
 * achieves a net material gain (cumulative > 0).
 */
function findPayoffStep(steps) {
  for (const step of steps) {
    if (step.cumulativeDelta > 0) return step;
  }
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
  return (
    detectHangingPiece(step.boardBefore, step.capturedPiece, toIdx, step.movedPiece, step.boardAfter) ||
    detectMaterialWinningCapture(step) ||
    detectUnderdefendedWinningCapture(step)
  );
}

function isNonIgnorableInterferenceMove(step, playerSide) {
  if (!step || !step.boardAfter || !step.uci || !step.movedPiece) return false;
  if (positionInCheck(step.fenAfter)) return true;
  if (step.capturedPiece) return true;

  const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;
  if (!step.boardAfter.isInBadSpot(toIdx)) return true;

  // Allow intentional interference sacrifices for meaningful pieces.
  const movedVal = PIECE_VAL[step.movedPiece] || 0;
  const bestCounterGain = bestLegalCaptureGainOnSquare(step.boardAfter, playerSide, toIdx, step.movedPiece);
  return Number.isFinite(bestCounterGain) && bestCounterGain > 0 && movedVal >= 3;
}

function findFreshHighValueThreat(step, threatenedSide, minPieceValue = 4) {
  if (!step || !step.boardBefore || !step.boardAfter) return null;
  if (threatenedSide !== 'w' && threatenedSide !== 'b') return null;

  const attackerSide = threatenedSide === 'w' ? 'b' : 'w';
  const before = step.boardBefore;
  const after = step.boardAfter;
  let best = null;

  for (let idx = 0; idx < 64; idx++) {
    const piece = after.pieceAt(idx);
    if (!piece || after.colorOf(piece) !== threatenedSide) continue;
    if (String(piece).toUpperCase() === 'K') continue;
    const value = PIECE_VAL[piece] || 0;
    if (value < minPieceValue) continue;

    const attackersBefore = before.attackers(attackerSide, idx) || [];
    const attackersAfter = after.attackers(attackerSide, idx) || [];
    if (!attackersAfter.length) continue;
    const freshAttackers = attackersAfter.filter((sq) => !attackersBefore.includes(sq));
    const hasFreshPressure = freshAttackers.length > 0 || attackersAfter.length > attackersBefore.length;
    if (!hasFreshPressure) continue;

    const hangingAfter = after.isHanging(idx);
    const underAfter = isEffectivelyUnderdefended(after, idx, threatenedSide, attackerSide, { fen: step.fenAfter });
    if (!hangingAfter && !underAfter && freshAttackers.length === 0) continue;

    const score = (value * 100)
      + (freshAttackers.length * 10)
      + (hangingAfter ? 8 : 0)
      + (underAfter ? 6 : 0)
      + Math.max(0, attackersAfter.length - attackersBefore.length);

    if (!best || score > best.score) {
      best = {
        targetIdx: idx,
        targetSq: idxToSq(idx),
        targetPiece: piece,
        targetValue: value,
        attackerSide,
        attackerSquares: attackersAfter,
        score,
      };
    }
  }

  return best;
}

function findCurrentHighValueThreat(board, threatenedSide, fen = null, minPieceValue = 4, includePawns = false) {
  if (!board) return null;
  if (threatenedSide !== 'w' && threatenedSide !== 'b') return null;
  const attackerSide = threatenedSide === 'w' ? 'b' : 'w';
  let best = null;

  for (let idx = 0; idx < 64; idx += 1) {
    const info = getOwnPieceVulnerability(board, idx, threatenedSide, fen, includePawns);
    if (!info || !info.vulnerable) continue;
    const value = Number(info.value) || 0;
    if (value < minPieceValue) continue;

    const pressure = Math.max(0, (Number(info.attackers) || 0) - (Number(info.defenders) || 0));
    const score = (value * 100)
      + (info.hanging ? 12 : 0)
      + (info.under ? 8 : 0)
      + pressure;

    if (!best || score > best.score) {
      best = {
        targetIdx: idx,
        targetSq: idxToSq(idx),
        targetPiece: info.piece,
        targetValue: value,
        attackerSide,
        attackerSquares: board.attackers(attackerSide, idx) || [],
        score,
      };
    }
  }

  return best;
}

function moveAddressesThreatDirectly(step, threat) {
  if (!step || !threat || !step.uci || !step.boardAfter) return false;
  const fromSq = step.uci.slice(0, 2);
  if (fromSq === threat.targetSq) return true;

  const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
  if (step.capturedPiece && Number.isInteger(toIdx) && toIdx >= 0 && threat.attackerSquares.includes(toIdx)) {
    return true;
  }

  const attackersAfter = step.boardAfter.attackers(threat.attackerSide, threat.targetIdx) || [];
  return attackersAfter.length === 0;
}

function isThreatResolvedAfterPlayerMove(step, threat, playerSide) {
  if (!step || !threat || !step.uci || !step.boardAfter) return false;
  const fromSq = step.uci.slice(0, 2);
  if (fromSq === threat.targetSq) return true;

  const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
  if (step.capturedPiece && Number.isInteger(toIdx) && toIdx >= 0 && threat.attackerSquares.includes(toIdx)) {
    return true;
  }

  const pieceOnThreatSq = step.boardAfter.pieceAt(threat.targetIdx);
  if (!pieceOnThreatSq || step.boardAfter.colorOf(pieceOnThreatSq) !== playerSide) return true;

  const attackersAfter = step.boardAfter.attackers(threat.attackerSide, threat.targetIdx) || [];
  if (!attackersAfter.length) return true;

  const underAfter = isEffectivelyUnderdefended(step.boardAfter, threat.targetIdx, playerSide, threat.attackerSide, {
    fen: step.fenAfter
  });
  return !underAfter;
}

/* ================================================================== */
/*  Phase 3: PV-relational detectors                                   */
/* ================================================================== */

/**
 * DEFLECTION  Player captures/attacks a piece. Opponent piece moves away
 * from a square it was defending. Player captures on the now-undefended square.
 */
function findDeflectionAnchorIndex(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i < steps.length - 2; i++) {
    const s1 = steps[i];     // player move
    const s2 = steps[i + 1]; // opponent response
    const s3 = steps[i + 2]; // player follow-up

    if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) continue;

    // s2: opponent moves a piece from somewhere
    const deflectedFrom = sqToIdx(s2.uci.slice(0, 2));
    const deflectedTo = sqToIdx(s2.uci.slice(2, 4));
    // s3: player captures on a square
    if (!s3.capturedPiece) continue;
    const captureTarget = sqToIdx(s3.uci.slice(2, 4));
    if (!Number.isInteger(deflectedFrom) || deflectedFrom < 0) continue;
    if (!Number.isInteger(deflectedTo) || deflectedTo < 0) continue;
    if (!Number.isInteger(captureTarget) || captureTarget < 0) continue;
    if (!s1.boardBefore || !s1.boardAfter || !s2.boardBefore || !s2.boardAfter) continue;

    // Deflection: the follow-up target must be a DIFFERENT square.
    // If we just capture the moved defender on its arrival square, this is
    // usually an exchange/trade sequence, not a true deflection motif.
    if (captureTarget === deflectedTo) continue;

    // Was the deflected piece defending the capture target before it moved?
    const defendersBefore = s2.boardBefore.attackers(opponent, captureTarget);
    if (defendersBefore.includes(deflectedFrom)) {
      // After deflection, is it still defended?
      const defendersAfter = s2.boardAfter.attackers(opponent, captureTarget);
      if (defendersAfter.includes(deflectedTo)) continue;

      // The first move should apply fresh pressure on the deflected piece/square,
      // otherwise this is often just a normal improving move.
      //
      // Also allow a "decoy sacrifice" trigger:
      // player offers a piece/pawn on a square, defender captures it, and that
      // capture is exactly what deflects the defender from the critical square.
      const atkBefore = s1.boardBefore.attackers(playerSide, deflectedFrom).length;
      const atkAfter = s1.boardAfter.attackers(playerSide, deflectedFrom).length;
      let decoySacTrigger = false;
      try {
        const s1To = s1.uci.slice(2, 4);
        const s2To = s2.uci.slice(2, 4);
        const s2Captured = String(s2.capturedPiece || '').toUpperCase();
        const s1Moved = String(s1.movedPiece || '').toUpperCase();
        decoySacTrigger = !!s1To && !!s2To && s1To === s2To && !!s2Captured && !!s1Moved && s2Captured === s1Moved;
      } catch {}
      const forcingTrigger =
        (atkAfter > atkBefore) ||
        !!s1.capturedPiece ||
        positionInCheck(s1.fenAfter) ||
        decoySacTrigger;
      if (!forcingTrigger) continue;

      // Require that this genuinely changed the tactical status of the final target.
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
  const opponent = playerSide === 'w' ? 'b' : 'w';
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
    THEMES.MATE_IN_5,
  ]);
  for (let i = 0; i < steps.length - 2; i++) {
    const s1 = steps[i];     // player move (sacrifice)
    const s2 = steps[i + 1]; // opponent captures (attracted)
    const s3 = steps[i + 2]; // player follow-up

    if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) continue;

    // Player's piece lands on a square
    const sacSquare = s1.uci.slice(2, 4);
    // Opponent captures on that square
    if (s2.uci.slice(2, 4) !== sacSquare) continue;
    if (!s2.capturedPiece) continue;

    // The capturing piece must be K, Q, or R
    const attractor = s2.movedPiece;
    if (!attractor) continue;
    const at = attractor.toUpperCase();
    if (at !== 'K' && at !== 'Q' && at !== 'R') continue;

    // Player must have committed material or accepted tactical risk on s1.
    const movedVal = PIECE_VAL[s1.movedPiece] || 0;
    const capVal = s1.capturedPiece ? (PIECE_VAL[s1.capturedPiece] || 0) : 0;
    const isSacLike = s1.capturedPiece ? (movedVal > capVal) : (movedVal >= 3);
    if (!isSacLike) continue;

    const attractorTo = s2.uci.slice(2, 4);
    const attractorFromIdx = s2.boardBefore.sqToIdx(s2.uci.slice(0, 2));
    const attractorToIdx = s2.boardAfter.sqToIdx(attractorTo);
    if (!Number.isInteger(attractorToIdx) || attractorToIdx < 0) continue;

    // Plain recapture on the lure square is usually an exchange,
    // not a true attraction tactic.
    const s3To = s3.uci.slice(2, 4);
    if (s3To === attractorTo) continue;

    let s3Themes = [];
    try {
      s3Themes = detectTacticsAtStep(s3, playerSide, { steps });
    } catch {}
    const hasStrictMotif = s3Themes.some((theme) => STRICT_ATTRACTION_MOTIFS.has(theme));

    const pressureBefore = s1.boardBefore.attackers(playerSide, attractorToIdx).length;
    const pressureAfter = s3.boardAfter.attackers(playerSide, attractorToIdx).length;
    const newlyPressured = pressureAfter > pressureBefore;
    const capturedSoon = hasPlayerCaptureOnSquareWithin(steps, i + 2, playerSide, attractorTo, 4);

    // King attraction should lead to a forcing continuation immediately.
    if (at === 'K') {
      if (positionInCheck(s3.fenAfter) && (newlyPressured || hasStrictMotif)) return true;
      continue;
    }

    // For Q/R attraction, require a tactical continuation linked to the lured square.
    if (!hasStrictMotif || (!newlyPressured && !capturedSoon)) continue;

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
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.side !== playerSide) continue;
    if (!isNonIgnorableInterferenceMove(step, playerSide)) continue;

    const toIdx2 = sqToIdx(step.uci.slice(2, 4));
    const boardA = step.boardAfter;
    const boardB = step.boardBefore;

    // Check if the moved piece landed between two opponent pieces, cutting a defense line
    for (const [dr, dc] of ALL_DIRS) {
      const { r: tr, c: tc } = rcOf(toIdx2);
      // Look in one direction for an opponent piece
      let rr = tr + dr, cc = tc + dc;
      let piece1Idx = -1;
      while (inBounds(rr, cc)) {
        const idx = idxOf(rr, cc);
        const p = boardA.pieceAt(idx);
        if (p) {
          if (boardA.colorOf(p) === opponent) piece1Idx = idx;
          break;
        }
        rr += dr; cc += dc;
      }
      if (piece1Idx < 0) continue;

      // Look in opposite direction for another opponent piece (the defender)
      rr = tr - dr; cc = tc - dc;
      let piece2Idx = -1;
      while (inBounds(rr, cc)) {
        const idx = idxOf(rr, cc);
        const p = boardA.pieceAt(idx);
        if (p) {
          if (boardA.colorOf(p) === opponent) {
            const pt = p.toUpperCase();
            const isDiag = (dr !== 0 && dc !== 0);
            if ((isDiag && (pt === 'B' || pt === 'Q')) || (!isDiag && (pt === 'R' || pt === 'Q'))) {
              piece2Idx = idx;
            }
          }
          break;
        }
        rr -= dr; cc -= dc;
      }
      if (piece2Idx < 0) continue;

      // Before the move, was piece2 defending piece1?
      const defendersBefore = boardB.attackers(opponent, piece1Idx);
      if (defendersBefore.includes(piece2Idx)) {
        // Require tactical consequence: piece1 should become newly loose and
        // be capturable shortly after the interference move.
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
 * SELF-INTERFERENCE  player move cuts own defensive line, creating
 * immediate tactical looseness of a friendly piece.
 */
function detectSelfInterference(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (const step of steps) {
    if (!step || step.side !== playerSide) continue;
    const before = step.boardBefore;
    const after = step.boardAfter;
    if (!before || !after) continue;

    for (let idx = 0; idx < 64; idx++) {
      const pBefore = before.pieceAt(idx);
      const pAfter = after.pieceAt(idx);
      if (!pBefore || !pAfter) continue;
      if (before.colorOf(pBefore) !== playerSide) continue;
      if (after.colorOf(pAfter) !== playerSide) continue;
      if (pBefore.toUpperCase() === 'K') continue;
      if (pAfter.toUpperCase() !== pBefore.toUpperCase()) continue;

      const attackedBefore = before.attackers(opponent, idx).length;
      const attackedAfter = after.attackers(opponent, idx).length;
      if (attackedAfter === 0 || attackedAfter < attackedBefore) continue;

      const underBefore = isEffectivelyUnderdefended(before, idx, playerSide, opponent, {
        fen: step.fenBefore,
      });
      const underAfter = isEffectivelyUnderdefended(after, idx, playerSide, opponent, {
        fen: step.fenAfter,
      });
      if (!underBefore && underAfter) return true;
    }
  }
  return false;
}

/**
 * INTERMEZZO (Zwischenzug)  Instead of recapturing, player inserts
 * a forcing intermediate move (usually a check), then recaptures later.
 */
function detectIntermezzo(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i < steps.length - 2; i++) {
    const s1 = steps[i];     // opponent move creating tactical pressure
    const s2 = steps[i + 1]; // player's in-between move

    if (s1.side !== opponent || s2.side !== playerSide) continue;

    // Branch A: classic recapture-style intermezzo.
    if (s1.capturedPiece) {
      const captureSquare = s1.uci.slice(2, 4);
      const captureIdx = s1.boardAfter.sqToIdx(captureSquare);
      if (Number.isInteger(captureIdx) && captureIdx >= 0) {
        if (hasLegalRecapture(s1.boardAfter, opponent, captureIdx)) {
          if (s2.uci.slice(2, 4) !== captureSquare) {
            const isCheck = positionInCheck(s2.fenAfter);
            const capVal = s2.capturedPiece ? (PIECE_VAL[s2.capturedPiece] || 0) : 0;
            const moveVal = s2.movedPiece ? (PIECE_VAL[s2.movedPiece] || 0) : 0;
            const forcingCapture = !!s2.capturedPiece && capVal >= moveVal;
            if (isCheck || forcingCapture) {
              if (hasPlayerCaptureOnSquareWithin(steps, i + 2, playerSide, captureSquare, 6)) return true;
            }
          }
        }
      }
    }

    // Branch B: defensive intermezzo.
    const threat = findFreshHighValueThreat(s1, playerSide, 4);
    if (!threat) continue;
    if (moveAddressesThreatDirectly(s2, threat)) continue;

    // Desperado branch: the threatened piece cashes itself in and is then lost.
    // This is still a valid intermezzo even without later "resolving" the threat.
    const movedFrom = s2.uci.slice(0, 2);
    const movedWasThreatenedPiece = movedFrom === threat.targetSq;
    const desperadoGain = s2.capturedPiece ? (PIECE_VAL[s2.capturedPiece] || 0) : 0;
    if (movedWasThreatenedPiece && desperadoGain > 0) {
      if (isMovedPiecePickedOffSoon(steps, i + 2, s2, playerSide, 3)) return true;
    }

    const s2IsCheck = positionInCheck(s2.fenAfter);
    const s2CaptureVal = s2.capturedPiece ? (PIECE_VAL[s2.capturedPiece] || 0) : 0;
    const createsHigherThreat = s2IsCheck || s2CaptureVal >= threat.targetValue;
    if (!createsHigherThreat) continue;

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
  if (!Number.isInteger(index) || index < 0 || (index + 1) >= steps.length) return false;
  const opponent = playerSide === 'w' ? 'b' : 'w';
  const s1 = steps[index];
  const s2 = steps[index + 1];
  if (!s1 || !s2 || s1.side !== playerSide || s2.side !== opponent) return false;
  if (!s1.fenAfter || !s2.fenAfter) return false;
  if (isCheckmate(s1.fenAfter)) return false;
  // "Mate threat" should be a threat, not a checking move.
  // If the move already gives check, classify it via check/mate motifs instead.
  if (positionInCheck(s1.fenAfter)) return false;

  const threatenedMate = hasMateInOneFn(s1.fenAfter, playerSide);
  if (!threatenedMate) return false;

  const stillMateThreat = hasMateInOneFn(s2.fenAfter, playerSide);
  return !stillMateThreat;
}

function findMateThreatStepIndex(steps, playerSide) {
  if (!Array.isArray(steps) || steps.length < 2) return -1;
  // Keep this bounded for performance: mate threats are most relevant
  // near the start of the tactical sequence.
  const maxScan = Math.min(steps.length - 1, 5);
  const memo = new Map();
  const hasMateCached = (fen, side) => {
    const keyFen = withFenTurn(fen, side) || '';
    const key = `${side}|${keyFen}`;
    if (memo.has(key)) return memo.get(key);
    const value = hasMateInOneIfSideToMove(fen, side);
    memo.set(key, value);
    return value;
  };
  for (let i = 0; i < maxScan; i++) {
    if (hasMateThreatAtIndex(steps, i, playerSide, hasMateCached)) return i;
  }
  return -1;
}

function detectMateThreat(steps, playerSide) {
  const idx = findMateThreatStepIndex(steps, playerSide);
  return Number.isInteger(idx) && idx >= 0;
}

function isSliderPieceType(piece) {
  const t = String(piece || '').toUpperCase();
  return t === 'B' || t === 'R' || t === 'Q';
}

function isLikelyForcedClearanceReply(s1, s2, clearedTo) {
  if (!s1 || !s2 || !s2.uci) return false;
  if (positionInCheck(s1.fenAfter)) return true;
  if (!s2.capturedPiece) return false;
  const replyTo = sqToIdx(s2.uci.slice(2, 4));
  if (!Number.isInteger(replyTo) || replyTo < 0) return false;
  if (replyTo !== clearedTo) return false;
  return String(s2.capturedPiece).toUpperCase() === String(s1.movedPiece || '').toUpperCase();
}

function isClearanceSacrificeTrigger(s1, playerSide, minLoss = 2) {
  if (!s1 || !s1.uci || !s1.boardAfter || !s1.movedPiece) return false;
  const movedType = String(s1.movedPiece).toUpperCase();
  if (movedType === 'K') return false;

  const toIdx = s1.boardAfter.sqToIdx(s1.uci.slice(2, 4));
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;

  const bestGain = bestLegalCaptureGainOnSquare(
    s1.boardAfter,
    playerSide,
    toIdx,
    s1.movedPiece
  );
  return Number.isFinite(bestGain) && bestGain >= minLoss;
}

function classifyClearanceUsage(s1, s3, playerSide, clearedFrom, movedFrom, movedTo) {
  if (!s1?.boardBefore || !s3?.boardBefore || !s3?.movedPiece) return null;
  const clearerBefore = s1.boardBefore.pieceAt(clearedFrom);
  if (!clearerBefore || s1.boardBefore.colorOf(clearerBefore) !== playerSide) return null;

  // The follower piece should already exist before Move 1.
  const followerBefore = s1.boardBefore.pieceAt(movedFrom);
  if (!followerBefore || s1.boardBefore.colorOf(followerBefore) !== playerSide) return null;
  if (String(followerBefore).toUpperCase() !== String(s3.movedPiece).toUpperCase()) return null;

  // Type A: square clearance (vacating) - follower occupies the vacated square.
  if (movedTo === clearedFrom && movedFrom !== clearedFrom) {
    // "Impossible before" filter: own clearer occupied the destination.
    return { type: 'square' };
  }

  // Type B: line clearance - follower moves through the vacated square.
  if (!isSliderPieceType(s3.movedPiece)) return null;
  const betweenNow = s3.boardBefore.squaresBetween(movedFrom, movedTo) || [];
  if (!betweenNow.includes(clearedFrom)) return null;

  // "Impossible before" filter: the same line was blocked by the clearer.
  const betweenBefore = s1.boardBefore.squaresBetween(movedFrom, movedTo) || [];
  if (!betweenBefore.includes(clearedFrom)) return null;
  return { type: 'line' };
}

function hasDecisiveClearanceEntry(s1, s3, playerSide, opponent, requireForcingPayoff) {
  // Immediate forcing payoff: check.
  if (positionInCheck(s3.fenAfter)) return true;

  // Immediate forcing payoff: winning/value capture.
  if (s3.capturedPiece) {
    const capVal = PIECE_VAL[s3.capturedPiece] || 0;
    const moverVal = PIECE_VAL[s3.movedPiece] || 0;
    if (isFreeOrWinningCaptureStep(s3)) return true;
    if (!requireForcingPayoff && capVal >= Math.max(moverVal, 3)) return true;
  }

  // Immediate forcing payoff: discovered tactical hit.
  const fromIdx3 = s3.boardBefore.sqToIdx(s3.uci.slice(0, 2));
  const toIdx3 = s3.boardBefore.sqToIdx(s3.uci.slice(2, 4));
  try {
    if (detectDiscoveredAttack(s3.boardBefore, s3.boardAfter, fromIdx3, toIdx3, playerSide, s3.isEp)) {
      return true;
    }
  } catch {}

  // Non-forcing branch: Move 3 must create a stronger fresh threat than Move 1.
  const step3Threat = findFreshHighValueThreat(s3, opponent, 3);
  if (!step3Threat) return false;
  const step1Threat = findFreshHighValueThreat(s1, opponent, 3);
  if (!step1Threat) return step3Threat.targetValue >= 4;

  const strongerByValue = step3Threat.targetValue > step1Threat.targetValue;
  const strongerByPressure = step3Threat.score >= (step1Threat.score + 10);
  if (strongerByValue || strongerByPressure) return true;
  if (!requireForcingPayoff && step3Threat.score > step1Threat.score) return true;
  return false;
}

function isMovedPiecePickedOffSoon(steps, startIdx, moveStep, moverSide, maxPlies = 3) {
  if (!Array.isArray(steps) || !moveStep || !moveStep.uci || !moveStep.movedPiece) return false;
  if (moverSide !== 'w' && moverSide !== 'b') return false;
  const opponent = moverSide === 'w' ? 'b' : 'w';
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
  if (!fen || (sideToMove !== 'w' && sideToMove !== 'b')) return false;
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
      const played = cl2.moveUci(uci);
      if (!played?.ok) continue;
      // Fast checkmate test on the already-applied board.
      const defender = cl2.turn();
      if (cl2.inCheck(defender) && (cl2.moves() || []).length === 0) return true;
    }
  } catch {}
  return false;
}

function isClearanceTriggerAtIndex(steps, index, playerSide) {
  if (!Array.isArray(steps) || index < 0 || (index + 2) >= steps.length) return false;
  const opponent = playerSide === 'w' ? 'b' : 'w';
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

  // Clearance Sacrifice: the clearing move must concede material if captured.
  // For pawn sacrifices, allow equal-value captures (e.g. ...pxp) as a valid
  // sac trigger, because the pawn is still being intentionally offered to
  // clear the route for the follow-up tactic.
  const movedType = String(s1.movedPiece || '').toUpperCase();
  const minSacLoss = movedType === 'P' ? 0 : 2;
  if (!isClearanceSacrificeTrigger(s1, playerSide, minSacLoss)) return false;

  if (movedFrom === clearedTo) return false;

  const usage = classifyClearanceUsage(s1, s3, playerSide, clearedFrom, movedFrom, movedTo);
  if (!usage) return false;

  const responseLikelyForced = isLikelyForcedClearanceReply(s1, s2, clearedTo);
  const requireForcingPayoff = !responseLikelyForced;
  if (!hasDecisiveClearanceEntry(s1, s3, playerSide, opponent, requireForcingPayoff)) return false;
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
  for (let i = 0; i < steps.length - 2; i++) {
    if (isClearanceTriggerAtIndex(steps, i, playerSide)) {
      return true;
    }
  }
  return false;
}

/**
 * X-RAY ATTACK  Recapture chain where player attacks "through" an opponent piece.
 */
function detectXRayAttack(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i < steps.length - 2; i++) {
    const s1 = steps[i];     // player captures
    const s2 = steps[i + 1]; // opponent recaptures
    const s3 = steps[i + 2]; // player recaptures

    if (s1.side !== playerSide || s2.side !== opponent || s3.side !== playerSide) continue;
    if (!s1.capturedPiece || !s2.capturedPiece || !s3.capturedPiece) continue;

    const sq1 = s1.uci.slice(2, 4);
    const sq2 = s2.uci.slice(2, 4);
    const sq3 = s3.uci.slice(2, 4);

    // All captures on the same square (exchange)
    if (sq1 === sq2 && sq2 === sq3) {
      // The third capture is through the opponent piece (x-ray)
      return true;
    }
  }
  return false;
}

/**
 * CAPTURING DEFENDER  Player captures a piece that was defending another target.
 * Returns the trigger step index (capturing the defender), or -1 if absent.
 */
function findCapturingDefenderAnchorIndex(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i < steps.length - 1; i++) {
    const s1 = steps[i]; // player captures the defender
    if (s1.side !== playerSide || !s1.capturedPiece || !s1.boardBefore || !s1.boardAfter || !s1.uci) continue;

    const capturedDefenderSquare = sqToIdx(s1.uci.slice(2, 4));
    if (!Number.isInteger(capturedDefenderSquare) || capturedDefenderSquare < 0) continue;

    const candidateTargets = [];
    for (let targetIdx = 0; targetIdx < 64; targetIdx++) {
      if (targetIdx === capturedDefenderSquare) continue;
      const targetPiece = s1.boardAfter.pieceAt(targetIdx);
      if (!targetPiece || s1.boardAfter.colorOf(targetPiece) !== opponent) continue;
      if (String(targetPiece).toUpperCase() === 'K') continue;

      const defendersBefore = s1.boardBefore.attackers(opponent, targetIdx) || [];
      if (!defendersBefore.includes(capturedDefenderSquare)) continue;

      const defendersAfter = s1.boardAfter.attackers(opponent, targetIdx) || [];
      if (defendersAfter.length >= defendersBefore.length) continue;

      const soleCriticalDefender = defendersBefore.length === 1;
      const underBefore = isEffectivelyUnderdefended(s1.boardBefore, targetIdx, opponent, playerSide, {
        fen: s1.fenBefore,
      });
      const underAfter = isEffectivelyUnderdefended(s1.boardAfter, targetIdx, opponent, playerSide, {
        fen: s1.fenAfter,
      });
      const hangingAfter = s1.boardAfter.isHanging(targetIdx);
      const becameLooseNow = (!underBefore && underAfter) || hangingAfter;

      candidateTargets.push({
        idx: targetIdx,
        sq: idxToSq(targetIdx),
        soleCriticalDefender,
        underBefore,
        becameLooseNow,
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

      const underAtFollowup = isEffectivelyUnderdefended(
        sFollow.boardBefore,
        match.idx,
        opponent,
        playerSide,
        { fen: sFollow.fenBefore }
      );
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
  if (!Array.isArray(steps) || !Number.isInteger(followupIndex) || followupIndex < 0 || followupIndex >= steps.length) {
    return false;
  }
  const followup = steps[followupIndex];
  if (!followup || followup.side !== playerSide) return false;

  const baseline = followupIndex > 0
    ? (Number(steps[followupIndex - 1]?.cumulativeDelta) || 0)
    : 0;
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
  return bestAfterReply >= (baseline + Math.max(1, Number(minGain) || 1));
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
  if (mt === 'K') return false;

  // Promotions are not quiet moves
  if (step.promotion) return false;

  // Non-pawn pieces giving check are not quiet
  if (mt !== 'P' && positionInCheck(step.fenAfter)) return false;

  // Not an advanced pawn (7th rank)
  if (mt === 'P') {
    const toR = rcOf(sqToIdx(step.uci.slice(2, 4))).r;
    const side = step.side;
    const seventhRank = side === 'w' ? 1 : 6;
    if (toR === seventhRank) return false;
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
  try { endgameType = detectEndgameType(fen); } catch {}
  return !!endgameType;
}

function isDefensiveVulnerabilityCandidate(piece, includePawns) {
  if (!piece) return false;
  const t = String(piece).toUpperCase();
  if (t === 'K') return false;
  if (t === 'P') return !!includePawns;
  return (PIECE_VAL[piece] || 0) >= 3;
}

function getOwnPieceVulnerability(board, idx, side, fen = null, includePawns = false) {
  if (!board || !Number.isInteger(idx) || idx < 0 || idx > 63) return null;
  if (side !== 'w' && side !== 'b') return null;
  const piece = board.pieceAt(idx);
  if (!piece || board.colorOf(piece) !== side) return null;
  if (!isDefensiveVulnerabilityCandidate(piece, includePawns)) return null;

  const opponent = side === 'w' ? 'b' : 'w';
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
    vulnerable,
  };
}

function countVulnerableOwnPieces(board, side, fen = null, includePawns = false) {
  if (!board || (side !== 'w' && side !== 'b')) return 0;
  let count = 0;
  for (let idx = 0; idx < 64; idx++) {
    const info = getOwnPieceVulnerability(board, idx, side, fen, includePawns);
    if (info && info.vulnerable) count++;
  }
  return count;
}

function sameFenPlacementTurnCastlingEp(fenA, fenB) {
  try {
    const a = String(fenA || '').trim().split(/\s+/);
    const b = String(fenB || '').trim().split(/\s+/);
    if (a.length < 4 || b.length < 4) return false;
    return a.slice(0, 4).join(' ') === b.slice(0, 4).join(' ');
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
    const isEp = movedPiece && movedPiece.toUpperCase() === 'P' &&
      fromIdx % 8 !== toIdx % 8 && !capturedPiece;
    const epCaptured = isEp ? (side === 'w' ? 'p' : 'P') : null;
    const captured = capturedPiece || epCaptured;

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
      promotion: uci.length > 4 ? uci[4] : null,
    };
  } catch {
    return null;
  }
}

function resolvePreviousOpponentStepForDefense(step, options = null) {
  if (!step || !step.uci) return null;
  const side = step.side === 'w' || step.side === 'b' ? step.side : null;
  if (!side) return null;
  const opponent = side === 'w' ? 'b' : 'w';

  const steps = options && Array.isArray(options.steps) ? options.steps : null;
  const stepIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : -1;
  if (steps && stepIndex > 0 && stepIndex < steps.length) {
    const prev = steps[stepIndex - 1];
    if (prev && prev.side === opponent && prev.boardBefore && prev.boardAfter) {
      return prev;
    }
  }

  const explicitPrev = options && options.previousStep;
  if (explicitPrev && explicitPrev.side === opponent && explicitPrev.boardBefore && explicitPrev.boardAfter) {
    return explicitPrev;
  }

  const previousFen = typeof options?.previousFen === 'string' ? options.previousFen : null;
  const previousMove = typeof options?.previousMove === 'string' ? options.previousMove : null;
  if (!previousFen || !previousMove) return null;
  const rebuilt = buildStepFromFenAndMove(previousFen, previousMove);
  if (!rebuilt || rebuilt.side !== opponent) return null;
  if (step.fenBefore && !sameFenPlacementTurnCastlingEp(rebuilt.fenAfter, step.fenBefore)) return null;
  return rebuilt;
}

function moveDefensivelyResolvesThreat(step, threat, side, includePawns) {
  if (!step || !threat || !step.boardBefore || !step.boardAfter || !step.uci) return false;
  const opponent = side === 'w' ? 'b' : 'w';
  const threatIdx = threat.targetIdx;
  if (!Number.isInteger(threatIdx) || threatIdx < 0 || threatIdx > 63) return false;

  const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
  const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
  if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx)) return false;

  const beforeInfo = getOwnPieceVulnerability(step.boardBefore, threatIdx, side, step.fenBefore, includePawns);
  if (!beforeInfo || !beforeInfo.vulnerable) return false;

  const pieceAfterOnThreat = step.boardAfter.pieceAt(threatIdx);
  const sameOwnPieceStillOnThreat = pieceAfterOnThreat && step.boardAfter.colorOf(pieceAfterOnThreat) === side;
  const afterInfoOnThreat = sameOwnPieceStillOnThreat
    ? getOwnPieceVulnerability(step.boardAfter, threatIdx, side, step.fenAfter, includePawns)
    : null;

  const movedThreatenedPiece = fromIdx === threatIdx && toIdx !== threatIdx;
  const movedThreatenedResolved = movedThreatenedPiece && (() => {
    const infoAtNewSq = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
    return !infoAtNewSq || !infoAtNewSq.vulnerable;
  })();

  const attackersBefore = step.boardBefore.attackers(opponent, threatIdx) || [];
  const attackersAfter = step.boardAfter.attackers(opponent, threatIdx) || [];
  const defendersBefore = step.boardBefore.attackers(side, threatIdx) || [];
  const defendersAfter = step.boardAfter.attackers(side, threatIdx) || [];

  const movedPieceDefendsThreatAfter = defendersAfter.includes(toIdx);
  const movedPieceDefendedThreatBefore = defendersBefore.includes(fromIdx);
  const guardArrived = sameOwnPieceStillOnThreat &&
    !!afterInfoOnThreat && !afterInfoOnThreat.vulnerable &&
    movedPieceDefendsThreatAfter && !movedPieceDefendedThreatBefore &&
    defendersAfter.length > defendersBefore.length;

  const removedAttackers = attackersBefore.filter((ai) => !attackersAfter.includes(ai));
  let lineBlocked = false;
  if (sameOwnPieceStillOnThreat && !!afterInfoOnThreat && !afterInfoOnThreat.vulnerable && removedAttackers.length) {
    for (const ai of removedAttackers) {
      const between = step.boardBefore.squaresBetween(ai, threatIdx) || [];
      if (between.includes(toIdx)) {
        lineBlocked = true;
        break;
      }
    }
  }

  return movedThreatenedResolved || guardArrived || lineBlocked;
}

function estimateDefensiveAlternativeDropCp(step, threat, side, includePawns) {
  if (!step || !threat || !step.boardBefore || !step.boardAfter || !step.uci) return Number.POSITIVE_INFINITY;
  if (positionInCheck(step.fenAfter)) return 220;

  const opponent = side === 'w' ? 'b' : 'w';
  const resolvesThreat = moveDefensivelyResolvesThreat(step, threat, side, includePawns);
  const beforeVulnerable = countVulnerableOwnPieces(step.boardBefore, side, step.fenBefore, includePawns);
  const afterVulnerable = countVulnerableOwnPieces(step.boardAfter, side, step.fenAfter, includePawns);
  const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
  const movedPieceVuln = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
  const createdCounterThreat = findFreshHighValueThreat(step, opponent, includePawns ? 1 : 3);

  let drop = 0;
  if (!resolvesThreat) {
    drop += 130;
  }
  if (afterVulnerable > beforeVulnerable) {
    drop += Math.min(90, (afterVulnerable - beforeVulnerable) * 24);
  } else if (afterVulnerable === beforeVulnerable) {
    drop += 70;
  }
  if (movedPieceVuln && movedPieceVuln.vulnerable) {
    drop += 45;
  }
  if (createdCounterThreat && createdCounterThreat.targetValue >= threat.targetValue) {
    drop = Math.max(0, drop - 20);
  }
  return Math.max(0, drop);
}

function detectDefensiveMove(step, options = null) {
  if (!step || !step.boardBefore || !step.boardAfter || !step.uci) return false;
  const side = step.side === 'w' || step.side === 'b' ? step.side : null;
  if (!side) return false;
  const opponent = side === 'w' ? 'b' : 'w';

  // Gate 2: non-forcing and not king-safety-only survival.
  if (step.capturedPiece) return false;
  if (positionInCheck(step.fenAfter)) return false;
  if (positionInCheck(step.fenBefore)) return false;
  if (step.movedPiece && String(step.movedPiece).toUpperCase() === 'K') return false;
  const legalMovesRaw = getLegalMoves(step.fenBefore);
  const legalMoveUcis = [];
  const seenLegal = new Set();
  for (const rawMove of (Array.isArray(legalMovesRaw) ? legalMovesRaw : [])) {
    const uci = normalizeMove(step.fenBefore, rawMove);
    if (!uci || seenLegal.has(uci)) continue;
    seenLegal.add(uci);
    legalMoveUcis.push(uci);
  }
  if (!legalMoveUcis.length) return false;
  const chosenUci = String(step.uci || '').toLowerCase();
  const alternativeUcis = legalMoveUcis.filter((uci) => uci !== chosenUci);
  if (!alternativeUcis.length) return false;

  // Optional significance guard: tiny eval swings usually aren't thematic defense.
  const deltaCpAbs = Number.isFinite(Number(options?.deltaCp))
    ? Math.abs(Number(options.deltaCp))
    : null;
  if (deltaCpAbs !== null && deltaCpAbs < 80) return false;

  // Gate 1: threat context. Prefer fresh threats from opponent's last move,
  // but fall back to current-board high-value threat state when prior context
  // is unavailable (common in single-ply best-line datasets).
  const previousOpponentStep = resolvePreviousOpponentStepForDefense(step, options);
  const includePawns = isEndgameForDefensivePawnCounting(step.fenBefore);
  const minThreatValue = includePawns ? 1 : 3;
  let freshThreat = previousOpponentStep
    ? findFreshHighValueThreat(previousOpponentStep, side, minThreatValue)
    : null;
  if (!freshThreat) {
    freshThreat = findCurrentHighValueThreat(step.boardBefore, side, step.fenBefore, minThreatValue, includePawns);
  }
  if (!freshThreat) return false;

  // Gate 3: this move must resolve that specific fresh threat directly.
  if (!moveDefensivelyResolvesThreat(step, freshThreat, side, includePawns)) return false;

  // Gate 4: board safety improves and the moved piece does not blunder itself.
  const beforeVulnerable = countVulnerableOwnPieces(step.boardBefore, side, step.fenBefore, includePawns);
  if (beforeVulnerable <= 0) return false;
  const afterVulnerable = countVulnerableOwnPieces(step.boardAfter, side, step.fenAfter, includePawns);
  if (afterVulnerable >= beforeVulnerable) return false;

  const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
  const movedPieceVuln = getOwnPieceVulnerability(step.boardAfter, toIdx, side, step.fenAfter, includePawns);
  if (movedPieceVuln && movedPieceVuln.vulnerable) return false;

  // Keep this theme defensive (not a hidden counter-attack label).
  const createdCounterThreat = findFreshHighValueThreat(step, opponent, includePawns ? 1 : 3);
  if (createdCounterThreat && createdCounterThreat.targetValue >= freshThreat.targetValue) return false;

  // Keep the "only move" spirit:
  // 1) no other legal move should also solve the same defensive problem
  // 2) non-defensive alternatives should be clearly worse (default 70cp)
  const minAltDropCp = Number.isFinite(Number(options?.defensiveAlternativeDropCpMin))
    ? Number(options.defensiveAlternativeDropCpMin)
    : 70;
  let consideredAlternatives = 0;
  let bestAlternativeDropCp = Number.POSITIVE_INFINITY;
  for (const altUci of alternativeUcis) {
    const altStep = buildStepFromFenAndMove(step.fenBefore, altUci);
    if (!altStep || altStep.side !== side) continue;
    // If another legal move also resolves the same fresh threat,
    // this is not an "only move" defensive tactic.
    if (moveDefensivelyResolvesThreat(altStep, freshThreat, side, includePawns)) return false;
    consideredAlternatives += 1;
    const altDropCp = estimateDefensiveAlternativeDropCp(altStep, freshThreat, side, includePawns);
    if (Number.isFinite(altDropCp)) {
      bestAlternativeDropCp = Math.min(bestAlternativeDropCp, altDropCp);
    }
  }
  if (consideredAlternatives <= 0) return false;
  if (!Number.isFinite(bestAlternativeDropCp)) return false;
  if (bestAlternativeDropCp < minAltDropCp) return false;

  return true;
}

function detectDefensiveMoveInPV(steps, playerSide, options = null) {
  if (!Array.isArray(steps) || !steps.length) return false;
  const seedPrev = (
    options &&
    typeof options.previousFen === 'string' &&
    typeof options.previousMove === 'string'
  ) ? buildStepFromFenAndMove(options.previousFen, options.previousMove) : null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || step.side !== playerSide) continue;
    const prevStep = (i > 0) ? steps[i - 1] : seedPrev;
    if (prevStep && prevStep.side === playerSide) continue;
    if (detectDefensiveMove(step, { ...(options || {}), steps, stepIndex: i, previousStep: prevStep })) {
      return true;
    }
  }
  return false;
}

/* ================================================================== */
/*  Detect tactics at a specific step                                  */
/* ================================================================== */

const DETECT_TACTICS_STEP_CACHE_LIMIT = 3000;
const DETECT_TACTICS_STEP_CACHE = new Map();

function detectTacticsCacheStepKey(step) {
  if (!step || typeof step !== 'object') return '';
  const fenBefore = String(step.fenBefore || '').trim();
  const fenAfter = String(step.fenAfter || '').trim();
  const uci = String(step.uci || '').trim().toLowerCase();
  if (!fenBefore || !fenAfter || !uci) return '';
  return [
    fenBefore,
    uci,
    fenAfter,
    String(step.side || ''),
    String(step.movedPiece || ''),
    String(step.capturedPiece || '')
  ].join('|');
}

function buildDetectTacticsCacheKey(step, playerSide, options = null) {
  try {
    const base = detectTacticsCacheStepKey(step);
    if (!base) return '';
    const contextSteps = options && Array.isArray(options.steps) ? options.steps : null;
    const explicitIndex = Number.isInteger(options?.stepIndex) ? options.stepIndex : null;
    const stepIndex = explicitIndex !== null
      ? explicitIndex
      : (contextSteps ? contextSteps.indexOf(step) : -1);
    const prevStep = (contextSteps && stepIndex > 0) ? contextSteps[stepIndex - 1] : null;
    const nextStep = (contextSteps && stepIndex >= 0 && (stepIndex + 1) < contextSteps.length)
      ? contextSteps[stepIndex + 1]
      : null;
    const previousFen = typeof options?.previousFen === 'string'
      ? options.previousFen
      : (typeof step?._prevFen === 'string' ? step._prevFen : '');
    const previousMove = typeof options?.previousMove === 'string'
      ? options.previousMove
      : (typeof step?._prevPlayedMove === 'string' ? step._prevPlayedMove : '');
    const directDelta = Number(options?.deltaCp);
    const mistakeDelta = Number(options?.mistake?.deltaCp);
    const suppressionDelta = Number.isFinite(directDelta)
      ? directDelta
      : (Number.isFinite(mistakeDelta) ? mistakeDelta : '');
    const prevKey = prevStep
      ? `${String(prevStep.uci || '').trim().toLowerCase()}:${String(prevStep.side || '')}`
      : '';
    const nextKey = nextStep
      ? `${String(nextStep.uci || '').trim().toLowerCase()}:${String(nextStep.side || '')}`
      : '';
    return [
      String(THEME_DETECTOR_VERSION || 0),
      String(playerSide || ''),
      base,
      String(stepIndex),
      prevKey,
      nextKey,
      String(previousFen || ''),
      String(previousMove || '').trim().toLowerCase(),
      String(suppressionDelta)
    ].join('||');
  } catch {
    return '';
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
  const opponent = playerSide === 'w' ? 'b' : 'w';
  const contextSteps = options && Array.isArray(options.steps) ? options.steps : null;
  const previousFen = typeof options?.previousFen === 'string'
    ? options.previousFen
    : (typeof step?._prevFen === 'string' ? step._prevFen : null);
  const previousMove = typeof options?.previousMove === 'string'
    ? options.previousMove
    : (typeof step?._prevPlayedMove === 'string' ? step._prevPlayedMove : null);
  const { boardBefore, boardAfter, uci, movedPiece } = step;

  const toIdx = boardAfter.sqToIdx(uci.slice(2, 4));
  const fromIdx = boardBefore.sqToIdx(uci.slice(0, 2));

  if (step.side === playerSide) {
    try { if (detectFork(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.FORK); } catch {}
    try {
      const isPin = detectPin(boardAfter, toIdx, playerSide, opponent, boardBefore, fromIdx) ||
                    detectPinExploitation(
                      boardBefore,
                      boardAfter,
                      toIdx,
                      playerSide,
                      opponent,
                      step.fenAfter,
                      {
                        steps: contextSteps,
                        stepIndex: contextSteps ? contextSteps.indexOf(step) : -1,
                      }
                    );
      const suppressPin = contextSteps ? shouldSuppressPinOnImmediateTrade(contextSteps, step, playerSide) : false;
      if (isPin && !suppressPin) themes.push(THEMES.PIN);
    } catch {}
    try { if (detectSkewer(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.SKEWER); } catch {}
    try { if (detectDiscoveredAttack(boardBefore, boardAfter, fromIdx, toIdx, playerSide)) themes.push(THEMES.DISCOVERED_ATTACK); } catch {}
    try { if (detectDoubleCheck(boardAfter, opponent)) themes.push(THEMES.DOUBLE_CHECK); } catch {}
    try {
      const stepIndex = Number.isInteger(options?.stepIndex)
        ? options.stepIndex
        : (contextSteps ? contextSteps.indexOf(step) : -1);
      if (detectTrappedPiece(
        boardBefore,
        boardAfter,
        toIdx,
        opponent,
        step.fenAfter,
        step.fenBefore,
        { steps: contextSteps, stepIndex }
      )) {
        themes.push(THEMES.TRAPPED_PIECE);
      }
    } catch {}
    try {
      let suppressionMistake = (options && typeof options.mistake === 'object')
        ? options.mistake
        : null;
      if ((!suppressionMistake || typeof suppressionMistake !== 'object') && previousFen && previousMove) {
        suppressionMistake = {
          _prevFen: previousFen,
          _prevPlayedMove: previousMove,
        };
      }
      if (suppressionMistake && typeof suppressionMistake === 'object') {
        const deltaCp = Number(options?.deltaCp);
        if (!Number.isFinite(Number(suppressionMistake.deltaCp)) && Number.isFinite(deltaCp)) {
          suppressionMistake.deltaCp = deltaCp;
        }
      }
      const isExchangeRecapture = shouldSuppressExchangeRecaptureHanging(
        step,
        suppressionMistake,
        contextSteps
      );
      if (!isExchangeRecapture) {
        const isFreeCapture = detectHangingPiece(boardBefore, step.capturedPiece, toIdx, movedPiece, boardAfter);
        const isMaterialWinning = detectMaterialWinningCapture(step);
        const isUnderdefendedWin = detectUnderdefendedWinningCapture(step);
        if (isFreeCapture || isMaterialWinning || isUnderdefendedWin) {
          themes.push(THEMES.HANGING_PIECE);
        }
      }
    } catch {}
    try { if (detectBackRank(boardAfter, opponent)) themes.push(THEMES.BACK_RANK); } catch {}
    try {
      if (contextSteps) {
        const stepIndex = Number.isInteger(options?.stepIndex)
          ? options.stepIndex
          : contextSteps.indexOf(step);
        if (stepIndex >= 0 && hasMateThreatAtIndex(contextSteps, stepIndex, playerSide)) {
          themes.push(THEMES.MATE_THREAT);
        }
      }
    } catch {}
    const suppressCustomThreat = shouldSuppressCustomThreatRecapture(step, playerSide, contextSteps);
    const suppressAupTrade = shouldSuppressAttackingUndefendedPieceOnImmediateTrade(contextSteps, step, playerSide);
    if (!suppressCustomThreat && !suppressAupTrade) {
      try {
        if (detectAttackingUndefendedPiece(
          boardBefore, boardAfter, fromIdx, toIdx, opponent, movedPiece, step.capturedPiece, step.fenBefore, step.fenAfter
        )) {
          themes.push(THEMES.ATTACKING_UNDEFENDED_PIECE);
        }
      } catch {}
    }
    if (contextSteps) {
      try {
        const stepIndex = contextSteps.indexOf(step);
        if (stepIndex >= 0 && isClearanceTriggerAtIndex(contextSteps, stepIndex, playerSide)) {
          themes.push(THEMES.CLEARANCE);
        }
      } catch {}
      try {
        const stepIndex = contextSteps.indexOf(step);
        if (stepIndex >= 0 && detectDefensiveMove(step, {
          steps: contextSteps,
          stepIndex,
          previousFen,
          previousMove,
        })) {
          themes.push(THEMES.DEFENSIVE_MOVE);
        }
      } catch {}
    }
  }

  const uniqueThemes = Array.from(new Set(themes));
  setDetectTacticsCache(cacheKey, uniqueThemes);
  return uniqueThemes;
}

/* ================================================================== */
/*  Phase 4: Metadata / classification themes                          */
/* ================================================================== */

function detectEndgameType(fen) {
  const board = ChessPrimitives(fen);
  const pieces = { w: {}, b: {} };

  for (let i = 0; i < 64; i++) {
    const p = board.pieceAt(i);
    if (!p) continue;
    const color = board.colorOf(p);
    const type = p.toUpperCase();
    if (type === 'K') continue;
    pieces[color][type] = (pieces[color][type] || 0) + 1;
  }

  const wTypes = Object.keys(pieces.w).filter(t => t !== 'P');
  const bTypes = Object.keys(pieces.b).filter(t => t !== 'P');
  const wPieces = wTypes.reduce((s, t) => s + pieces.w[t], 0);
  const bPieces = bTypes.reduce((s, t) => s + pieces.b[t], 0);

  // Count total non-king non-pawn pieces
  const totalPieces = wPieces + bPieces;

  // Pawn endgame: only kings and pawns
  if (totalPieces === 0) return THEMES.PAWN_ENDGAME;

  // Single-type endgames (at most one piece type per side, besides pawns)
  if (totalPieces <= 3) {
    const allTypes = new Set([...wTypes, ...bTypes]);
    if (allTypes.size === 1) {
      const t = [...allTypes][0];
      if (t === 'R') return THEMES.ROOK_ENDGAME;
      if (t === 'B') return THEMES.BISHOP_ENDGAME;
      if (t === 'N') return THEMES.KNIGHT_ENDGAME;
      if (t === 'Q') return THEMES.QUEEN_ENDGAME;
    }
    // Queen + Rook endgame
    if (allTypes.size === 2 && allTypes.has('Q') && allTypes.has('R')) {
      return THEMES.QUEEN_ROOK_ENDGAME;
    }
  }

  return null;
}

function detectKingsideQueensideAttack(boardAfter, opponent, playerSide) {
  const ki = boardAfter.kingIdx(opponent);
  if (ki < 0) return null;
  const { r: kr, c: kc } = rcOf(ki);

  // King must be on back rank
  const backRank = opponent === 'w' ? 0 : 7;
  if (kr !== backRank) return null;

  // Need enough pieces on board (20+)
  if (countPieces(boardAfter) < 20) return null;

  // Must be in check
  if (boardAfter.checkerCount(opponent) === 0) return null;

  // Count attack score near king's corner
  let attackScore = 0;
  const cornerR = backRank;
  const cornerC = kc <= 3 ? 0 : 7;
  for (let r = Math.max(0, cornerR - 1); r <= Math.min(7, cornerR + 1); r++) {
    for (let c = Math.max(0, cornerC - 1); c <= Math.min(7, cornerC + 2); c++) {
      const idx = idxOf(r, c);
      if (boardAfter.attackers(playerSide, idx).length > 0) attackScore++;
    }
  }
  if (attackScore < 2) return null;

  if (kc >= 6) return THEMES.KINGSIDE_ATTACK;   // g/h file
  if (kc <= 2) return THEMES.QUEENSIDE_ATTACK;  // a/b/c file
  return null;
}

/* ================================================================== */
/*  Sequence-aware motif contract                                      */
/* ================================================================== */

/*
 * These detectors intentionally use the same observable evidence as a
 * puzzle author: the legal solution line, the position before each move,
 * and the resulting position.  Static geometry alone is not enough for
 * motifs such as skewers, clearance and interference; it tends to label
 * incidental alignments that never become the point of the tactic.
 */

function isRayPieceType(piece) {
  const type = String(piece || '').toUpperCase();
  return type === 'B' || type === 'R' || type === 'Q';
}

function isVeryAdvancedPawnStep(step) {
  if (!step || String(step.movedPiece || '').toUpperCase() !== 'P') return false;
  const toIdx = step.boardAfter?.sqToIdx?.(String(step.uci || '').slice(2, 4));
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;
  const { r } = rcOf(toIdx);
  return step.side === 'w' ? r <= 1 : r >= 6;
}

function isAdvancedPawnStep(step) {
  if (!step || String(step.movedPiece || '').toUpperCase() !== 'P') return false;
  if (step.promotion) return true;
  const toIdx = step.boardAfter?.sqToIdx?.(String(step.uci || '').slice(2, 4));
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;
  const { r } = rcOf(toIdx);
  return step.side === 'w' ? r <= 2 : r >= 5;
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
  const result = new Set();
  for (const move of getLegalMoves(fen)) {
    const uci = normalizeMove(fen, move);
    if (uci) result.add(uci);
  }
  return result;
}

function areCollinearIndices(a, b, c) {
  if (![a, b, c].every(i => Number.isInteger(i) && i >= 0 && i < 64)) return false;
  const p1 = rcOf(a), p2 = rcOf(b), p3 = rcOf(c);
  if (p1.r === p2.r && p2.r === p3.r) return true;
  if (p1.c === p2.c && p2.c === p3.c) return true;
  if ((p1.r - p1.c) === (p2.r - p2.c) && (p2.r - p2.c) === (p3.r - p3.c)) return true;
  return (p1.r + p1.c) === (p2.r + p2.c) && (p2.r + p2.c) === (p3.r + p3.c);
}

function rayPieceSupportsLine(piece, a, b) {
  const type = String(piece || '').toUpperCase();
  const p1 = rcOf(a), p2 = rcOf(b);
  const orthogonal = p1.r === p2.r || p1.c === p2.c;
  if (type === 'Q') return true;
  if (type === 'R') return orthogonal;
  if (type === 'B') return !orthogonal && Math.abs(p1.r - p2.r) === Math.abs(p1.c - p2.c);
  return false;
}

function detectSequenceAdvancedPawn(steps, playerSide) {
  return steps.some(step => step.side === playerSide && isVeryAdvancedPawnStep(step));
}

function detectSequenceAttackingF2F7(steps, playerSide) {
  const targetSquare = playerSide === 'w' ? 'f7' : 'f2';
  const kingSquare = playerSide === 'w' ? 'e8' : 'e1';
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (const step of steps) {
    if (step.side !== playerSide || !step.capturedPiece) continue;
    if (step.uci.slice(2, 4) !== targetSquare) continue;
    const kingIdx = step.boardAfter.sqToIdx(kingSquare);
    const king = step.boardAfter.pieceAt(kingIdx);
    if (king && String(king).toUpperCase() === 'K' && step.boardAfter.colorOf(king) === opponent) {
      return true;
    }
  }
  return false;
}

function detectSequenceDiscoveredCheck(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (const step of steps) {
    if (step.side !== playerSide) continue;
    const kingIdx = step.boardAfter.kingIdx(opponent);
    const movedTo = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
    if (kingIdx < 0 || movedTo < 0) continue;
    const checkers = step.boardAfter.attackers(playerSide, kingIdx) || [];
    if (checkers.length && checkers.some(square => square !== movedTo)) return true;
  }
  return false;
}

function detectSequenceFork(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  const playerSteps = steps.filter(step => step.side === playerSide);
  // A fork needs a visible continuation; geometry on the final move has no
  // demonstrated double-threat payoff and is a common source of noise.
  for (const step of playerSteps.slice(0, -1)) {
    const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
    if (detectFork(step.boardAfter, toIdx, step.movedPiece, opponent)) return true;
  }

  /*
   * Fixed-depth engine PVs may stop after the opponent's reply, before the
   * forking side's payoff capture is printed. Accept that truncated shape
   * only when the reply has already been played and the same forking piece
   * still attacks two sound targets afterward. This avoids endpoint-dependent
   * false negatives without trusting bare one-move geometry.
   */
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const reply = steps[i + 1];
    if (!step?.uci || !step.boardAfter || step.side !== playerSide) continue;
    if (!reply?.boardAfter || reply.side === playerSide) continue;
    if (steps.slice(i + 1).some(candidate => candidate?.side === playerSide)) continue;

    const attackerSquare = step.uci.slice(2, 4);
    const attackerIdx = reply.boardAfter.sqToIdx(attackerSquare);
    const survivor = reply.boardAfter.pieceAt(attackerIdx);
    if (!survivor || reply.boardAfter.colorOf(survivor) !== playerSide) continue;
    if (String(survivor).toUpperCase() !== String(step.movedPiece || '').toUpperCase()) continue;
    if (detectFork(reply.boardAfter, attackerIdx, survivor, opponent)) return true;

    // `isInBadSpot` uses pseudo-attacks and can therefore count an enemy king
    // as a capturer even when that king cannot legally take the protected
    // forking piece. Once the engine PV has shown that the piece survives the
    // reply, two higher-value targets are enough stable evidence of a fork.
    const survivorValue = reply.boardAfter.pieceValue(survivor);
    const higherValueTargets = (reply.boardAfter.attacks(attackerIdx) || []).filter(targetIdx => {
      const target = reply.boardAfter.pieceAt(targetIdx);
      if (!target || reply.boardAfter.colorOf(target) !== opponent) return false;
      const targetType = String(target).toUpperCase();
      if (targetType === 'K' || targetType === 'P') return false;
      return reply.boardAfter.pieceValue(target) > survivorValue;
    });
    if (higherValueTargets.length >= 2) return true;
  }

  /*
   * A checking fork can be sound even when the forking piece is nominally
   * attacked.  The check gives it time to take the second target (and that
   * target may itself be the apparent capturer).  Accept this less common
   * shape only when the legal PV demonstrates the same piece collecting one
   * of the non-pawn targets within its next two turns.
   */
  for (let i = 0; i < steps.length - 2; i++) {
    const step = steps[i];
    if (!step || step.side !== playerSide || !step.boardAfter || !step.uci) continue;
    if (String(step.movedPiece || '').toUpperCase() === 'K') continue;

    const attackerTo = step.uci.slice(2, 4);
    const attackerIdx = step.boardAfter.sqToIdx(attackerTo);
    const kingIdx = step.boardAfter.kingIdx(opponent);
    if (attackerIdx < 0 || kingIdx < 0) continue;
    const attacks = step.boardAfter.attacks(attackerIdx) || [];
    if (!attacks.includes(kingIdx)) continue;

    const targetSquares = new Set();
    for (const targetIdx of attacks) {
      const target = step.boardAfter.pieceAt(targetIdx);
      if (!target || step.boardAfter.colorOf(target) !== opponent) continue;
      const type = String(target).toUpperCase();
      if (type === 'K' || type === 'P') continue;
      // This fallback is specifically for the apparent refutation of the
      // checking fork: the second target attacks the forking piece, but cannot
      // take it profitably and is won instead. Ordinary safe checking forks
      // remain governed by detectFork above.
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
        // The target escaped, or the forking piece was removed before it
        // could realise the double threat.
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
  const opponent = victimSide === 'w' ? 'b' : 'w';
  for (const attackerIdx of board.attackers(opponent, targetIdx) || []) {
    const attacker = board.pieceAt(attackerIdx);
    if (!isRayPieceType(attacker)) continue;
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
    if (!piece || String(piece).toUpperCase() === 'K') continue;
    const value = PIECE_VAL[piece] || 0;
    balance += board.colorOf(piece) === side ? value : -value;
  }
  return balance;
}

function detectSequenceHangingPiece(steps, playerSide, mistake) {
  const first = steps.find(step => step.side === playerSide);
  if (!first || !first.capturedPiece) return false;
  const toIdx = first.boardBefore.sqToIdx(first.uci.slice(2, 4));
  const opponent = playerSide === 'w' ? 'b' : 'w';
  if (!Number.isInteger(toIdx) || toIdx < 0) return false;

  const targetIsLoose = isSequenceHanging(first.boardBefore, toIdx, opponent);
  const hasImmediateRecapture = hasLegalRecapture(first.boardAfter, playerSide, toIdx);
  const capturedType = String(first.capturedPiece).toUpperCase();
  let freeCapture = targetIsLoose && !hasImmediateRecapture && capturedType !== 'P';

  /*
   * A pawn can be the hung unit, but an incidental free pawn at the start of
   * a combination is too common to be a useful hanging-piece label. Require
   * one of two concrete payoffs: the preceding mistake placed that pawn on
   * the capture square for a non-pawn to take, or the same capturer uses the
   * pawn as an entry capture and wins an equal-or-more-valuable piece on its
   * next turn. Checks and en-passant retain their more specific motifs.
   */
  if (capturedType === 'P' && targetIsLoose && !hasImmediateRecapture &&
      !first.isEp && !positionInCheck(first.fenAfter)) {
    let capturesJustMovedPawn = false;
    if (mistake && typeof mistake._prevFen === 'string' && typeof mistake._prevPlayedMove === 'string' &&
        String(first.movedPiece || '').toUpperCase() !== 'P' &&
        String(first.movedPiece || '').toUpperCase() !== 'K') {
      const previous = buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove);
      capturesJustMovedPawn = !!previous && previous.uci.slice(2, 4) === first.uci.slice(2, 4) &&
        String(previous.movedPiece || '').toUpperCase() === 'P';
    }

    const firstIndex = steps.indexOf(first);
    const nextPlayerStep = firstIndex >= 0
      ? steps.slice(firstIndex + 1).find(step => step?.side === playerSide)
      : null;
    const entryCaptureWinsMaterial = !!nextPlayerStep?.capturedPiece &&
      nextPlayerStep.uci.slice(0, 2) === first.uci.slice(2, 4) &&
      (PIECE_VAL[nextPlayerStep.capturedPiece] || 0) >= (PIECE_VAL[first.movedPiece] || 0);

    freeCapture = capturesJustMovedPawn || entryCaptureWinsMaterial;
  }

  // Lichess' hanging-piece contract also includes an insufficiently defended
  // unit.  A lower-value piece taking a unit worth at least two pawns more is
  // strong evidence, but only if the PV shows the capturer surviving the
  // opponent's immediate reply.  This avoids calling ordinary exchanges or
  // take-backs hanging pieces.
  let favorableLooseCapture = false;
  if (capturedType !== 'P' && detectMaterialWinningCapture(first)) {
    const firstIndex = steps.indexOf(first);
    const reply = firstIndex >= 0 ? steps[firstIndex + 1] : null;
    if (!reply || reply.side === playerSide) {
      favorableLooseCapture = true;
    } else {
      const survivor = reply.boardAfter?.pieceAt?.(reply.boardAfter.sqToIdx(first.uci.slice(2, 4)));
      favorableLooseCapture = !!survivor &&
        reply.boardAfter.colorOf(survivor) === playerSide &&
        String(survivor).toUpperCase() === String(first.movedPiece || '').toUpperCase();
    }
  }

  if (!freeCapture && !favorableLooseCapture) return false;

  // A capture on the preceding move followed by a take-back is an exchange,
  // not a newly hanging piece, when the preceding capture took at least the
  // value of the unit now being recaptured.
  if (mistake && typeof mistake._prevFen === 'string' && typeof mistake._prevPlayedMove === 'string') {
    const previous = buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove);
    if (previous?.capturedPiece && previous.uci.slice(2, 4) === first.uci.slice(2, 4) &&
        (PIECE_VAL[previous.capturedPiece] || 0) >= (PIECE_VAL[first.capturedPiece] || 0)) {
      return false;
    }
  }

  if (steps.length < 3) return true;
  if (favorableLooseCapture) {
    return standardMaterialBalance(steps[2].boardAfter, playerSide) >
      standardMaterialBalance(first.boardBefore, playerSide);
  }
  return standardMaterialBalance(steps[2].boardAfter, playerSide) >=
    standardMaterialBalance(first.boardAfter, playerSide);
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
    const frontValue = String(previous.movedPiece || '').toUpperCase() === 'K'
      ? 99
      : (PIECE_VAL[previous.movedPiece] || 0);
    const capturedValue = PIECE_VAL[step.capturedPiece] || 0;
    if (frontValue <= capturedValue) continue;
    if (step.boardBefore.isInBadSpot(toIdx)) return true;
  }
  return false;
}

function pieceTypeOrdinal(piece) {
  return ({ P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6 })[String(piece || '').toUpperCase()] || 0;
}

function detectSequenceDeflection(steps, playerSide) {
  const playerIndices = [];
  for (let i = 0; i < steps.length; i++) if (steps[i].side === playerSide) playerIndices.push(i);
  for (const i of playerIndices.slice(1)) {
    const current = steps[i], opponentMove = steps[i - 1], previousPlayer = steps[i - 2];
    if (!current || !opponentMove || !previousPlayer || (!current.capturedPiece && !current.promotion)) continue;
    if (current.capturedPiece) {
      const capturedValue = String(current.capturedPiece).toUpperCase() === 'K' ? 99 : (PIECE_VAL[current.capturedPiece] || 0);
      const moverValue = String(current.movedPiece).toUpperCase() === 'K' ? 99 : (PIECE_VAL[current.movedPiece] || 0);
      if (capturedValue > moverValue) continue;
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
    const promotionDeflection = current.promotion &&
      targetSquare[0] === opponentMove.uci.slice(0, 2)[0] &&
      (beforeReply.attacks(opponentFrom) || []).includes(beforeReply.sqToIdx(current.uci.slice(0, 2)));
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
    if (String(previousOpponent.movedPiece || '').toUpperCase() === 'K') continue;
    const fromIdx = current.boardBefore.sqToIdx(current.uci.slice(0, 2));
    const toIdx = current.boardBefore.sqToIdx(target);
    const blockerFrom = current.boardBefore.sqToIdx(previousOpponent.uci.slice(0, 2));
    if ((current.boardBefore.squaresBetween(fromIdx, toIdx) || []).includes(blockerFrom)) return true;
  }
  return false;
}

function detectSequenceDiscoveredAttack(steps, playerSide) {
  if (detectSequenceDiscoveredCheck(steps, playerSide)) return true;

  /*
   * First recognise the direct semantic shape: moving one piece uncovers a
   * different friendly slider's attack on an enemy non-pawn.  To keep this
   * conservative, equal-value revealed attacks need observable relevance:
   * the attacked piece immediately evades.  Materially favourable, pinned or
   * overloaded hits retain the existing relevance test.
   */
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
      // The revealed attacker must be a different piece. A move that lands on
      // the opened ray and attacks from there is an ordinary direct attack.
      if (hit.attackerIdx === toIdx) continue;
      const targetSquare = idxToSq(hit.targetIdx);
      if (!stepAttacksOpponentPiece(step, playerSide) || !reply || reply.side === playerSide ||
          reply.uci?.slice(0, 2) !== targetSquare) continue;

      const movedType = String(step.movedPiece || '').toUpperCase();
      const revealedType = String(hit.attackerPiece || '').toUpperCase();
      const targetType = String(hit.targetPiece || '').toUpperCase();
      const quietMinorDoubleThreat = !step.capturedPiece && !reply.capturedPiece &&
        (movedType === 'N' || movedType === 'B') &&
        (revealedType === 'N' || revealedType === 'B') &&
        (targetType === 'N' || targetType === 'B');

      // A pawn may uncover a slider while attacking the same high-value
      // target. The target's immediate capture of that pawn is observable
      // proof that the two attacks, rather than a routine line opening, drove
      // the reply.
      const targetCapturesVacatingPawn = movedType === 'P' && !step.isEp && !!step.capturedPiece &&
        !!reply.capturedPiece && reply.uci.slice(2, 4) === step.uci.slice(2, 4) &&
        (PIECE_VAL[hit.targetPiece] || 0) > (PIECE_VAL[step.movedPiece] || 0);

      if (quietMinorDoubleThreat || targetCapturesVacatingPawn) return true;
    }
  }

  // Longer payoff form: after the blocker vacates, the revealed slider wins
  // material later in the continuation.
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
  if (!board || (pinnedSide !== 'w' && pinnedSide !== 'b')) return null;
  const kingIdx = board.kingIdx(pinnedSide);
  if (kingIdx < 0 || pinnedIdx === kingIdx) return null;
  const king = rcOf(kingIdx), pinned = rcOf(pinnedIdx);
  const rawDr = pinned.r - king.r, rawDc = pinned.c - king.c;
  const aligned = rawDr === 0 || rawDc === 0 || Math.abs(rawDr) === Math.abs(rawDc);
  if (!aligned) return null;
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
  return { kingIdx, pinnedIdx, pinnerIdx, ray };
}

function hasPseudoEscapeOutsidePin(board, pinnedIdx, pinnedSide, ray) {
  const piece = board.pieceAt(pinnedIdx);
  if (!piece) return false;
  for (const targetIdx of board.attacks(pinnedIdx) || []) {
    if (ray.has(targetIdx)) continue;
    const occupant = board.pieceAt(targetIdx);
    if (!occupant || board.colorOf(occupant) !== pinnedSide) return true;
  }
  if (String(piece).toUpperCase() === 'P') {
    const { r, c } = rcOf(pinnedIdx);
    const dr = pinnedSide === 'w' ? -1 : 1;
    const oneR = r + dr;
    if (inBounds(oneR, c)) {
      const one = idxOf(oneR, c);
      if (!ray.has(one) && !board.pieceAt(one)) return true;
    }
  }
  return false;
}

function detectSequencePin(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (const step of steps) {
    if (step.side !== playerSide) continue;
    const board = step.boardAfter;
    for (let pinnedIdx = 0; pinnedIdx < 64; pinnedIdx++) {
      const pinnedPiece = board.pieceAt(pinnedIdx);
      if (!pinnedPiece || board.colorOf(pinnedPiece) !== opponent || String(pinnedPiece).toUpperCase() === 'K') continue;
      const pin = absolutePinRay(board, opponent, pinnedIdx);
      if (!pin) continue;
      const pinnedValue = PIECE_VAL[pinnedPiece] || 0;

      // The pin prevents this piece from taking a valuable or loose piece
      // outside the legal king-pinner ray.
      for (const targetIdx of board.attacks(pinnedIdx) || []) {
        if (pin.ray.has(targetIdx)) continue;
        const target = board.pieceAt(targetIdx);
        if (!target || board.colorOf(target) !== playerSide) continue;
        const targetValue = PIECE_VAL[target] || 0;
        if (targetValue > pinnedValue || board.isHanging(targetIdx)) return true;
      }

      // Or the pin prevents the attacked piece from escaping a cheaper
      // attacker along a pseudo-legal direction outside the ray.
      for (const attackerIdx of board.attackers(playerSide, pinnedIdx) || []) {
        if (!pin.ray.has(attackerIdx)) continue;
        const attacker = board.pieceAt(attackerIdx);
        if (!attacker) continue;
        const attackerValue = PIECE_VAL[attacker] || 0;
        if (pinnedValue > attackerValue) return true;
        const pinnedCannotTakeAttacker = !(board.attackers(opponent, attackerIdx) || []).includes(pinnedIdx);
        if (board.isHanging(pinnedIdx) && pinnedCannotTakeAttacker &&
            hasPseudoEscapeOutsidePin(board, pinnedIdx, opponent, pin.ray)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isSequenceTrapped(board, fen, square, victimSide) {
  if (!board || !fen || positionInCheck(fen) || absolutePinRay(board, victimSide, square)) return false;
  const piece = board.pieceAt(square);
  if (!piece || board.colorOf(piece) !== victimSide || ['P', 'K'].includes(String(piece).toUpperCase())) return false;
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
    if (!current?.capturedPiece || !previous || String(current.capturedPiece).toUpperCase() === 'P') continue;
    let trappedSquare = current.uci.slice(2, 4);
    if (previous.uci.slice(2, 4) === trappedSquare) trappedSquare = previous.uci.slice(0, 2);
    const board = previous.boardBefore;
    const square = board.sqToIdx(trappedSquare);
    const victimSide = playerSide === 'w' ? 'b' : 'w';
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
      const defender = initial.pieceAt(defenderIdx);
      if (!isRayPieceType(defender)) continue;
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
      const defender = initial.pieceAt(defenderIdx);
      if (!isRayPieceType(defender)) continue;
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
    const earlierOpponent = steps[i - 3] || (
      mistake && typeof mistake._prevFen === 'string' && typeof mistake._prevPlayedMove === 'string'
        ? buildStepFromFenAndMove(mistake._prevFen, mistake._prevPlayedMove)
        : null
    );
    if (!current?.capturedPiece || !opponentReply || !intermezzo || !earlierOpponent) continue;
    const captureSquare = current.uci.slice(2, 4);
    const replyFromIdx = intermezzo.boardAfter.sqToIdx(opponentReply.uci.slice(0, 2));
    const captureIdx = intermezzo.boardAfter.sqToIdx(captureSquare);
    if ((intermezzo.boardAfter.attackers(playerSide === 'w' ? 'b' : 'w', captureIdx) || []).includes(replyFromIdx)) continue;
    if (intermezzo.uci.slice(2, 4) === captureSquare) continue;
    if (earlierOpponent.uci.slice(2, 4) !== captureSquare || !earlierOpponent.capturedPiece) continue;
    if (legalUciSet(intermezzo.fenBefore).has(current.uci)) return true;
  }
  return false;
}

function detectSequenceAttraction(steps, playerSide) {
  const opponent = playerSide === 'w' ? 'b' : 'w';
  for (let i = 0; i + 2 < steps.length; i++) {
    const decoy = steps[i], reply = steps[i + 1], followUp = steps[i + 2];
    if (decoy.side !== playerSide || reply.side !== opponent || followUp.side !== playerSide) continue;
    const decoySquare = decoy.uci.slice(2, 4);
    if (!reply.capturedPiece || reply.uci.slice(2, 4) !== decoySquare) continue;
    const attractedType = String(reply.movedPiece || '').toUpperCase();
    if (!['K', 'Q', 'R'].includes(attractedType)) continue;
    const attractedIdx = followUp.boardAfter.sqToIdx(decoySquare);
    const followUpTo = followUp.boardAfter.sqToIdx(followUp.uci.slice(2, 4));
    if (!(followUp.boardAfter.attackers(playerSide, attractedIdx) || []).includes(followUpTo)) continue;
    if (attractedType === 'K') return true;
    const laterPlayer = steps[i + 4];
    if (laterPlayer && laterPlayer.side === playerSide && laterPlayer.capturedPiece &&
        laterPlayer.uci.slice(2, 4) === decoySquare) {
      return true;
    }
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
    if (positionInCheck(current.fenAfter) && String(opponentReply.movedPiece || '').toUpperCase() === 'K') continue;
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
    const currentQualifies = isCheckmate(current.fenAfter) || (
      captured && String(current.movedPiece || '').toUpperCase() !== 'K' &&
      (PIECE_VAL[captured] || 0) <= (PIECE_VAL[current.movedPiece] || 0) &&
      current.boardBefore.isHanging(targetIdx) &&
      opponentReply.uci.slice(2, 4) !== current.uci.slice(2, 4)
    );
    if (!currentQualifies || positionInCheck(removesDefender.fenAfter)) continue;
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
    if (String(step.movedPiece || '').toUpperCase() === 'K' || isAdvancedPawnStep(step)) continue;
    if (!stepAttacksOpponentPiece(step, playerSide)) return true;
  }
  return false;
}

function detectSequenceDefensiveMove(steps, playerSide) {
  if (!steps.length) return false;
  const final = steps[steps.length - 1];
  if (final.side === playerSide && !final.capturedPiece && !positionInCheck(final.fenAfter) &&
      !stepAttacksOpponentPiece(final, playerSide) && !isAdvancedPawnStep(final) &&
      legalUciSet(final.fenBefore).size >= 3) {
    return true;
  }
  for (const step of steps) {
    if (step.side !== playerSide || step.capturedPiece || positionInCheck(step.fenAfter)) continue;
    if (legalUciSet(step.fenBefore).size >= 3 && positionInCheck(step.fenBefore)) return true;
  }
  return false;
}

function detectSequenceSacrifice(steps, playerSide) {
  if (steps.some(step => step.side === playerSide && step.promotion)) return false;
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
  const opponent = playerSide === 'w' ? 'b' : 'w';
  const board = steps[0].boardBefore;
  const kingIdx = board.kingIdx(opponent);
  if (kingIdx < 0) return false;
  const { r, c } = rcOf(kingIdx);
  const nearHome = opponent === 'b' ? r <= 2 : r >= 5;
  if (!nearHome) return false;
  const towardCenter = opponent === 'b' ? 1 : -1;
  const shield = [[towardCenter, 0], [0, -1], [0, 1], [towardCenter, -1], [towardCenter, 1]];
  for (const [dr, dc] of shield) {
    const rr = r + dr, cc = c + dc;
    if (!inBounds(rr, cc)) continue;
    const piece = board.pieceAt(idxOf(rr, cc));
    if (piece && board.colorOf(piece) === opponent && String(piece).toUpperCase() === 'P') return false;
  }
  const playerSteps = steps.filter(step => step.side === playerSide);
  return playerSteps.slice(1, -1).some(step => positionInCheck(step.fenAfter));
}

function detectSequenceSideAttack(steps, playerSide, flank) {
  if (!steps.length) return false;
  const opponent = playerSide === 'w' ? 'b' : 'w';
  const board = steps[0].boardBefore;
  const kingIdx = board.kingIdx(opponent);
  if (kingIdx < 0) return false;
  const { r: kingRow, c: kingFile } = rcOf(kingIdx);
  const homeRow = opponent === 'b' ? 0 : 7;
  const files = flank === 'king' ? [6, 7] : [0, 1, 2];
  const minPieces = flank === 'king' ? 20 : 18;
  if (kingRow !== homeRow || !files.includes(kingFile) || countPieces(board) < minPieces) return false;
  const playerSteps = steps.filter(step => step.side === playerSide);
  if (!playerSteps.some(step => positionInCheck(step.fenAfter))) return false;
  const cornerIdx = idxOf(homeRow, flank === 'king' ? 7 : 0);
  let score = 0;
  for (const step of playerSteps) {
    const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
    const distance = dist(cornerIdx, toIdx);
    if (positionInCheck(step.fenAfter)) score += 1;
    if (step.capturedPiece && distance <= 3) score += 1;
    else if (distance >= 5) score -= 1;
  }
  return score >= 2;
}

function detectSequenceZugzwang(steps, playerSide) {
  const first = steps.find(step => step.side === playerSide);
  if (!first || first.capturedPiece || positionInCheck(first.fenBefore) || positionInCheck(first.fenAfter)) return false;
  if (isVeryAdvancedPawnStep(first)) return false;
  if (countPieces(first.boardBefore) > 10) return false;
  if (steps.some(step => step.promotion)) return false;
  const replyIndex = steps.indexOf(first) + 1;
  const reply = steps[replyIndex];
  if (!reply || reply.capturedPiece || positionInCheck(reply.fenAfter)) return false;
  // In sparse endgames a long, entirely non-forcing conversion after the
  // waiting move is strong zugzwang evidence even when one nominal capture
  // exists among the losing alternatives.
  if (steps.length >= 5) return true;
  const replies = legalUciSet(first.fenAfter);
  if (!replies.size || replies.size > 12) return false;
  // A conservative observable proxy: the constrained side has no forcing
  // capture or check available, and every legal choice is a waiting move.
  for (const uci of replies) {
    const alt = buildStepFromFenAndMove(first.fenAfter, uci);
    if (!alt || alt.capturedPiece || positionInCheck(alt.fenAfter)) return false;
  }
  return true;
}

function collectSequenceAlignedThemes(steps, playerSide, mistake) {
  const themes = new Set();
  const enginePvMode = mistake?._analysisMode === 'engine-pv';
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
  if (detectSequenceSelfInterference(steps, playerSide) || detectSequenceInterference(steps, playerSide)) {
    themes.add(THEMES.INTERFERENCE);
  }
  if (detectSequenceIntermezzo(steps, playerSide, mistake)) themes.add(THEMES.INTERMEZZO);
  if (detectSequenceAttraction(steps, playerSide)) themes.add(THEMES.ATTRACTION);
  if (detectSequenceClearance(steps, playerSide)) themes.add(THEMES.CLEARANCE);
  if (detectSequenceCapturingDefender(steps, playerSide)) themes.add(THEMES.CAPTURING_DEFENDER);
  // A fixed-depth engine PV has an arbitrary endpoint. Endpoint-based quiet
  // and defensive labels are useful for completed puzzle solutions but noisy
  // when an engine simply happens to stop on that move.
  if (!enginePvMode && detectSequenceQuietMove(steps, playerSide)) themes.add(THEMES.QUIET_MOVE);
  if (!enginePvMode && detectSequenceDefensiveMove(steps, playerSide)) themes.add(THEMES.DEFENSIVE_MOVE);
  if (detectSequenceSacrifice(steps, playerSide)) themes.add(THEMES.SACRIFICE);
  if (detectSequenceExposedKing(steps, playerSide)) themes.add(THEMES.EXPOSED_KING);
  if (detectSequenceSideAttack(steps, playerSide, 'king')) themes.add(THEMES.KINGSIDE_ATTACK);
  else if (detectSequenceSideAttack(steps, playerSide, 'queen')) themes.add(THEMES.QUEENSIDE_ATTACK);
  if (detectSequenceZugzwang(steps, playerSide)) themes.add(THEMES.ZUGZWANG);
  for (const step of steps) {
    if (step.side !== playerSide) continue;
    if (step.promotion) themes.add(THEMES.PROMOTION);
    if (step.promotion && step.promotion !== 'q') themes.add(THEMES.UNDER_PROMOTION);
    if (step.isEp) themes.add(THEMES.EN_PASSANT);
    const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
    const toIdx = step.boardBefore.sqToIdx(step.uci.slice(2, 4));
    if (isCastling(step.movedPiece, fromIdx, toIdx)) themes.add(THEMES.CASTLING);
  }
  return themes;
}

/* ================================================================== */
/*  Main entry point                                                   */
/* ================================================================== */

/**
 * Detect tactical themes for a mistake by walking the engine's best line.
 *
 * @param {object} mistake  { fen, side, best, bestLine?, deltaCp? }
 * @returns {string[]}  Array of theme tags
 */
export function detectThemes(mistake) {
  if (!mistake || !mistake.fen || !mistake.best) return [];

  const bestUci = normalizeBestMove(mistake);
  if (!bestUci) return [];

  const side     = normalizeSide(mistake.side, mistake.fen);
  const opponent = side === 'w' ? 'b' : 'w';
  const bestLine = Array.isArray(mistake.bestLine) && mistake.bestLine.length
    ? mistake.bestLine : null;

  /*  PV-based detection (preferred path)  */
  if (bestLine) {
    // Keep enough legal continuation to identify mate-in-five and longer
    // exchange motifs. The previous six-ply cap made mateIn4/mateIn5
    // unreachable and truncated several clearance/interference payoffs.
    const cappedLine = bestLine.slice(0, 20);
    const steps = walkPV(mistake.fen, cappedLine, side);
    if (!steps.length) return [];
    // The 20-ply window includes enough exchange cycles to avoid treating
    // short-lived material drops as real sacrifices.
    const sacrificePath = steps;
    const sacrificeIsMate = pvEndsMate(sacrificePath);

    const themes = new Set();
    const isMate = pvEndsMate(steps);
    const playerSteps = steps.filter(s => s.side === side);
    let hasDoubleCheck = false;
    let hasPinExploitation = false;
    let hasHangingPiece = false;
    let hasMaterialWinningHanging = false;
    const allowDeferredConcededTrap =
      !!mistake &&
      typeof mistake._prevFen === 'string' &&
      typeof mistake._prevPlayedMove === 'string';

    /*  Run tactical detectors on each player move  */
    for (let pi = 0; pi < playerSteps.length; pi++) {
      const step = playerSteps[pi];
      const toIdx = step.boardAfter.sqToIdx(step.uci.slice(2, 4));
      const fromIdx = step.boardBefore.sqToIdx(step.uci.slice(0, 2));
      const isFirstMove = (pi === 0);
      const isLastPlayerMove = (pi === playerSteps.length - 1);

      // Fork  check on all player moves (forks commonly appear later)
      try { if (detectFork(step.boardAfter, toIdx, step.movedPiece, opponent)) themes.add(THEMES.FORK); } catch {}

      // Pin exploitation  on all player moves.
      // Covers:
      // 1) occupying a square where would-be capturers are pinned,
      // 2) putting pressure on (or capturing) a pinned piece.
      try {
        const pinExploitation = detectPinExploitation(
          step.boardBefore,
          step.boardAfter,
          toIdx,
          side,
          opponent,
          step.fenAfter,
          { steps, stepIndex: steps.indexOf(step) }
        );
        const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
        if (pinExploitation && !suppressPin) {
          themes.add(THEMES.PIN);
          hasPinExploitation = true;
        }
      } catch {}

      // Intermezzo fork  player captures a MORE VALUABLE piece AND gives
      // check, but the capturing piece is in a bad spot (will be recaptured).
      // The capture+check buys time, then the next player move captures
      // another piece. This is a double-threat pattern (intermezzo fork).
      // Requires: capturing piece < captured piece (wins material on capture).
      if (!isLastPlayerMove && step.capturedPiece && step.capturedPiece.toUpperCase() !== 'P') {
        try {
          const capVal = PIECE_VAL[step.capturedPiece] || 0;
          const movVal = PIECE_VAL[step.movedPiece] || 0;
          if (capVal > movVal && step.boardAfter.checkerCount(opponent) > 0 && step.boardAfter.isInBadSpot(toIdx)) {
            const nextPS = playerSteps[pi + 1];
            if (nextPS && nextPS.capturedPiece && nextPS.capturedPiece.toUpperCase() !== 'P') {
              themes.add(THEMES.FORK);
            }
          }
        } catch {}
      }

      // Ray pin  ONLY on last player move (the final position).
      // Pass boardBefore to filter out pre-existing pins.
      if (isLastPlayerMove) {
        try {
          const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
          if (detectPin(step.boardAfter, toIdx, side, opponent, step.boardBefore, fromIdx) && !suppressPin) {
            themes.add(THEMES.PIN);
          }
        } catch {}
      }

      // Functional pin  on non-last player moves: a high-value piece is
      // attacked and stays put (captured later), meaning it was stuck/pinned.
      if (!isLastPlayerMove) {
        try {
          const suppressPin = shouldSuppressPinOnImmediateTrade(steps, step, side);
          if (detectFunctionalPin(steps, playerSteps, pi, side, opponent) && !suppressPin) {
            themes.add(THEMES.PIN);
          }
        } catch {}
      }

      // Skewer - evaluate on all player moves.
      try { if (detectSkewer(step.boardAfter, toIdx, step.movedPiece, opponent)) themes.add(THEMES.SKEWER); } catch {}

      // Discovered attack  check on ALL player moves
      try { if (detectDiscoveredAttack(step.boardBefore, step.boardAfter, fromIdx, toIdx, side, step.isEp)) themes.add(THEMES.DISCOVERED_ATTACK); } catch {}

      // Double check  check on all player moves
      try {
        if (detectDoubleCheck(step.boardAfter, opponent)) {
          themes.add(THEMES.DOUBLE_CHECK);
          hasDoubleCheck = true;
        }
      } catch {}

      // Back rank  only on LAST player move.
      // Intermediate back-rank checks (like Re8+ or Re1+ in a combination)
      // are not the "theme" of the puzzle.
      if (isLastPlayerMove) {
        try { if (detectBackRank(step.boardAfter, opponent)) themes.add(THEMES.BACK_RANK); } catch {}
      }

      // Hanging piece  only on first player move (Lichess spec)
      if (isFirstMove) {
        try {
          const isExchangeRecapture = shouldSuppressExchangeRecaptureHanging(step, mistake, steps);
          if (!isExchangeRecapture) {
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
      }

      // Trapped piece can be explicit on the second player move in the PV
      // (e.g. first move fixes escape squares, second move attacks and wins).
      const canTagTrappedPiece = (pi <= 1) || allowDeferredConcededTrap;
      if (canTagTrappedPiece) {
        try {
          const stepIndex = steps.indexOf(step);
          if (detectTrappedPiece(
            step.boardBefore,
            step.boardAfter,
            toIdx,
            opponent,
            step.fenAfter,
            step.fenBefore,
            { steps, stepIndex: Number.isInteger(stepIndex) ? stepIndex : -1 }
          )) {
            themes.add(THEMES.TRAPPED_PIECE);
          }
        } catch {}
      }

      // Custom threat patterns - only on first player move
      if (isFirstMove) {
        const suppressCustomThreat = shouldSuppressCustomThreatRecapture(step, side, steps);
        const suppressAupTrade = shouldSuppressAttackingUndefendedPieceOnImmediateTrade(steps, step, side);
        if (!suppressCustomThreat && !suppressAupTrade) {
          try {
            if (detectAttackingUndefendedPiece(
              step.boardBefore, step.boardAfter, fromIdx, toIdx, opponent, step.movedPiece, step.capturedPiece,
              step.fenBefore, step.fenAfter
            )) {
              themes.add(THEMES.ATTACKING_UNDEFENDED_PIECE);
            }
          } catch {}
        }
      }

      // Structural themes
      if (step.promotion) themes.add(THEMES.PROMOTION);
      if (step.isEp) themes.add(THEMES.EN_PASSANT);
      if (step.movedPiece && isCastling(step.movedPiece, fromIdx, toIdx)) {
        themes.add(THEMES.CASTLING);
      }

      // Under-promotion
      if (step.promotion && step.promotion !== 'q') {
        themes.add(THEMES.UNDER_PROMOTION);
      }
    }

    // Fallback: some real-game back-rank motifs are the first forcing move,
    // while the capped PV continues with conversion moves. If we didn't tag
    // back-rank on the final player move, allow the first player move to tag it.
    if (!themes.has(THEMES.BACK_RANK) && playerSteps.length > 0) {
      try {
        if (detectBackRank(playerSteps[0].boardAfter, opponent)) {
          themes.add(THEMES.BACK_RANK);
        }
      } catch {}
    }

    // Rule 2: the bad move hangs a piece and the opponent takes it in the PV.
    if (!hasHangingPiece) {
      try {
        if (detectHungPiecePunishInPv(steps, side, mistake)) {
          themes.add(THEMES.HANGING_PIECE);
          hasHangingPiece = true;
        }
      } catch {}
    }

    // Phase 3 relational themes (line-level motifs)
    try { if (detectDeflection(steps, side)) themes.add(THEMES.DEFLECTION); } catch {}
    try { if (detectAttraction(steps, side)) themes.add(THEMES.ATTRACTION); } catch {}
    try { if (detectInterference(steps, side)) themes.add(THEMES.INTERFERENCE); } catch {}
    try { if (detectIntermezzo(steps, side)) themes.add(THEMES.INTERMEZZO); } catch {}
    try { if (detectMateThreat(steps, side)) themes.add(THEMES.MATE_THREAT); } catch {}
    try { if (detectClearance(steps, side)) themes.add(THEMES.CLEARANCE); } catch {}
    try { if (detectCapturingDefender(steps, side)) themes.add(THEMES.CAPTURING_DEFENDER); } catch {}
    try {
      if (detectDefensiveMoveInPV(steps, side, {
        deltaCp: mistake.deltaCp,
        previousFen: typeof mistake._prevFen === 'string' ? mistake._prevFen : null,
        previousMove: typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null,
      })) {
        themes.add(THEMES.DEFENSIVE_MOVE);
      }
    } catch {}

    // If we found doubleCheck, remove discoveredAttack (it's redundant/subsumed)
    if (hasDoubleCheck) {
      themes.delete(THEMES.DISCOVERED_ATTACK);
    }

    /*  Theme suppression rules  */
    // trappedPiece is more specific than hangingPiece
    if (themes.has(THEMES.TRAPPED_PIECE)) themes.delete(THEMES.HANGING_PIECE);
    // backRank is the dominant theme when present
    if (themes.has(THEMES.BACK_RANK)) themes.delete(THEMES.HANGING_PIECE);
    // hangingPiece suppresses incidental discoveredAttack on same move
    if (themes.has(THEMES.HANGING_PIECE) && themes.has(THEMES.DISCOVERED_ATTACK)) {
      themes.delete(THEMES.DISCOVERED_ATTACK);
    }
    // castling suppresses incidental pin (from recapture after castling)
    if (themes.has(THEMES.CASTLING) && !hasPinExploitation) themes.delete(THEMES.PIN);
    // discoveredAttack suppresses incidental pin (pin in final position is a side-effect)
    if (themes.has(THEMES.DISCOVERED_ATTACK) && !hasPinExploitation) themes.delete(THEMES.PIN);
    // fork suppresses functional pin (the "stuck" piece is really just a fork target)
    if (themes.has(THEMES.FORK) && !hasPinExploitation) themes.delete(THEMES.PIN);
    // hangingPiece is more central than late incidental pin motifs.
    if (themes.has(THEMES.HANGING_PIECE) && !hasPinExploitation) themes.delete(THEMES.PIN);

    /*  Sacrifice: cumulative material across PV  */
    try {
      if (detectSacrificeInPV(sacrificePath, side, sacrificeIsMate, { mistake })) {
        // When PV ends in mate, sacrifice is suppressed if there's already
        // a specific tactical theme (like backRank, fork, etc.)  the sac
        // was just a clearance/enabler for the real tactic. But if sacrifice
        // is the only noteworthy theme, keep it.
        const STRUCTURAL_THEMES = new Set([
          THEMES.PROMOTION, THEMES.EN_PASSANT, THEMES.CASTLING,
          THEMES.UNDER_PROMOTION, THEMES.QUIET_MOVE
        ]);
        const hasTacticalTheme = [...themes].some(t => !STRUCTURAL_THEMES.has(t));
        if (sacrificeIsMate && hasTacticalTheme) {
          // Don't add sacrifice  the other tactical themes take precedence
        } else {
          themes.add(THEMES.SACRIFICE);
        }
      }
    } catch {}

    /*  Quiet move  */
    /* Check first player move. If no other themes found, also check */
    /* later moves (the puzzle might be about a quiet follow-up).   */
    {
      let foundQuiet = false;
      if (playerSteps.length > 0) {
        try { if (detectQuietMove(playerSteps[0])) foundQuiet = true; } catch {}
      }
      if (!foundQuiet && themes.size === 0) {
        // No tactical themes at all  check later moves for quiet
        for (let qi = 1; qi < playerSteps.length; qi++) {
          try { if (detectQuietMove(playerSteps[qi])) { foundQuiet = true; break; } } catch {}
        }
      }
      if (foundQuiet) themes.add(THEMES.QUIET_MOVE);
    }

    /*  Mate themes are multi-label. A mating fork is both a fork and mate. */
    if (isMate) {
      const MATE_PATTERN_THEMES = new Set([
        THEMES.BACK_RANK_MATE, THEMES.SMOTHERED_MATE,
        THEMES.ANASTASIA_MATE, THEMES.HOOK_MATE,
        THEMES.ARABIAN_MATE, THEMES.BODEN_MATE, THEMES.DOUBLE_BISHOP_MATE,
        THEMES.DOVETAIL_MATE, THEMES.BALESTRA_MATE,
        THEMES.BLIND_SWINE_MATE, THEMES.CORNER_MATE,
        THEMES.EPAULETTE_MATE, THEMES.KILL_BOX_MATE,
        THEMES.MORPHYS_MATE, THEMES.OPERA_MATE,
        THEMES.PILLSBURYS_MATE, THEMES.SWALLOWSTAIL_MATE,
        THEMES.TRIANGLE_MATE, THEMES.VUKOVIC_MATE,
      ]);

      // Named patterns are classified from the legally verified final mate
      // position. This single authoritative pass avoids overlapping legacy
      // geometry rules producing contradictory names.
      const lastStep = steps[steps.length - 1];
      for (const pattern of MATE_PATTERN_THEMES) themes.delete(pattern);
      themes.delete(THEMES.BACK_RANK);
      try {
        for (const pattern of detectNamedMatePatterns(lastStep.fenAfter)) {
          if (MATE_PATTERN_THEMES.has(pattern)) themes.add(pattern);
        }
      } catch {}

      themes.add(THEMES.MATE);
      const numPlayerMoves = playerSteps.length;
      if (numPlayerMoves === 1) themes.add(THEMES.MATE_IN_1);
      else if (numPlayerMoves === 2) themes.add(THEMES.MATE_IN_2);
      else if (numPlayerMoves === 3) themes.add(THEMES.MATE_IN_3);
      else if (numPlayerMoves === 4) themes.add(THEMES.MATE_IN_4);
      else if (numPlayerMoves >= 5) themes.add(THEMES.MATE_IN_5);

      const allNonMateThemes = [...themes].filter(t =>
        t !== THEMES.MATE && !t.startsWith('mateIn') && t !== THEMES.CHECK &&
        !MATE_PATTERN_THEMES.has(t)
      );
      if (allNonMateThemes.length === 0) {
        themes.add(THEMES.CHECK);
      }
    }

    /*
     * Replace broad static guesses with sequence-backed classifications.
     * The retained detectors (pin, trapped piece, attraction and deflection)
     * already require their own payoff evidence and are refined separately.
     */
    const sequenceAligned = collectSequenceAlignedThemes(steps, side, mistake);
    const sequenceOwnedThemes = new Set([
      THEMES.ADVANCED_PAWN, THEMES.ATTACKING_F2F7,
      THEMES.DISCOVERED_ATTACK, THEMES.DISCOVERED_CHECK,
      THEMES.FORK, THEMES.PIN, THEMES.HANGING_PIECE,
      THEMES.TRAPPED_PIECE, THEMES.SKEWER,
      THEMES.SACRIFICE, THEMES.ATTRACTION, THEMES.DEFLECTION,
      THEMES.INTERFERENCE, THEMES.INTERMEZZO,
      THEMES.CLEARANCE, THEMES.X_RAY_ATTACK, THEMES.COLLINEAR_MOVE,
      THEMES.CAPTURING_DEFENDER, THEMES.QUIET_MOVE,
      THEMES.DEFENSIVE_MOVE, THEMES.EXPOSED_KING,
      THEMES.KINGSIDE_ATTACK, THEMES.QUEENSIDE_ATTACK,
      THEMES.ZUGZWANG, THEMES.PROMOTION, THEMES.UNDER_PROMOTION,
      THEMES.EN_PASSANT, THEMES.CASTLING,
    ]);
    for (const theme of sequenceOwnedThemes) themes.delete(theme);
    for (const theme of sequenceAligned) themes.add(theme);

    // Lichess' published back-rank label is specifically a mate pattern,
    // rather than every tactic played on the back rank.
    if (!isMate) {
      themes.delete(THEMES.BACK_RANK);
      themes.delete(THEMES.BACK_RANK_MATE);
    }
    if (themes.has(THEMES.BACK_RANK_MATE) || themes.has(THEMES.FORK)) {
      themes.delete(THEMES.KINGSIDE_ATTACK);
      themes.delete(THEMES.QUEENSIDE_ATTACK);
    }

    /*  Endgame type (only pawn endgame)  */
    try {
      const egType = detectEndgameType(mistake.fen);
      if (egType === THEMES.PAWN_ENDGAME) themes.add(egType);
    } catch {}

    /*  Eval-drop gating  */
    /* When the eval drop is below "mistake" level (100cp), tactical   */
    /* themes in the PV are likely incidental. Only flag tactics on    */
    /* real mistakes and blunders.                                     */
    const deltaCp = typeof mistake.deltaCp === 'number' ? Math.abs(mistake.deltaCp) : null;
    if (deltaCp !== null && deltaCp < 100 && !isMate) {
      const TACTICAL_THEMES = new Set([
        THEMES.FORK, THEMES.PIN, THEMES.SKEWER,
        THEMES.DISCOVERED_ATTACK, THEMES.DOUBLE_CHECK,
        THEMES.HANGING_PIECE, THEMES.TRAPPED_PIECE,
        THEMES.SACRIFICE, THEMES.BACK_RANK,
        THEMES.DEFLECTION, THEMES.ATTRACTION,
        THEMES.INTERFERENCE, THEMES.INTERMEZZO,
        THEMES.CLEARANCE, THEMES.CAPTURING_DEFENDER,
        THEMES.MATE_THREAT,
      ]);
      for (const t of TACTICAL_THEMES) {
        if (t === THEMES.HANGING_PIECE && hasMaterialWinningHanging) continue;
        themes.delete(t);
      }
    }

    /*  Only return tactical themes  */
    return filterToTactical(themes);
  }

  /*  Legacy fallback (no PV data)  */
  const boardBefore = ChessPrimitives(mistake.fen);
  const cl = ChessLite();
  cl.loadFEN(mistake.fen);
  const mv = cl.moveUci(bestUci);
  if (!mv || !mv.ok) return [];
  const fenAfter = cl.fen();
  const boardAfter = ChessPrimitives(fenAfter);

  const fromIdx     = boardBefore.sqToIdx(bestUci.slice(0, 2));
  const toIdx       = boardBefore.sqToIdx(bestUci.slice(2, 4));
  const movedPiece  = boardBefore.pieceAt(fromIdx);
  const capturedPc  = boardBefore.pieceAt(toIdx);

  const themes = [];

  try { if (detectFork(boardAfter, toIdx, movedPiece, opponent)) themes.push(THEMES.FORK); } catch {}
  try { if (detectBackRank(boardAfter, opponent)) themes.push(THEMES.BACK_RANK); } catch {}
  try { if (detectDoubleCheck(boardAfter, opponent)) themes.push(THEMES.DOUBLE_CHECK); } catch {}
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
    const isExchangeRecapture = shouldSuppressExchangeRecaptureHanging(legacyStep, mistake, null);
    if (
      !isExchangeRecapture &&
      (
        detectHangingPiece(boardBefore, capturedPc, toIdx, movedPiece, boardAfter) ||
        detectMaterialWinningCapture(legacyStep) ||
        detectUnderdefendedWinningCapture(legacyStep)
      )
    ) {
      themes.push(THEMES.HANGING_PIECE);
    }
  } catch {}
  // IMPORTANT: when no PV exists we avoid line-intent motifs like
  // "attacking_undefended_piece". Without a continuation line, these are
  // often noisy and can create false positives in trainer-primary buckets.
  // Keep no-PV fallback limited to direct/tangible motifs.

  // Check for mate in 1 (legacy)
  if (isCheckmate(fenAfter)) {
    themes.push(THEMES.MATE);
    themes.push(THEMES.MATE_IN_1);
    if (!themes.some(t => t !== THEMES.MATE && t !== THEMES.MATE_IN_1)) {
      themes.push(THEMES.CHECK);
    }
  }

  // Quiet move detection for single move
  if (!capturedPc && movedPiece && movedPiece.toUpperCase() !== 'K' && !positionInCheck(fenAfter)) {
    themes.push(THEMES.QUIET_MOVE);
  }

  return filterToTactical(themes);
}

/**
 * Detect tactical themes that the OPPONENT gets after the player's bad move.
 */
export function detectAllowedThemes(fenAfterBadMove, refutationPV, opponentSide, options = null) {
  if (!fenAfterBadMove || !Array.isArray(refutationPV) || !refutationPV.length || !opponentSide) return [];
  const deltaCp = typeof options === 'number'
    ? options
    : (options && typeof options.deltaCp === 'number' ? options.deltaCp : null);
  const prevFen = options && typeof options === 'object' && typeof options.previousFen === 'string'
    ? options.previousFen
    : null;
  const prevPlayedMove = options && typeof options === 'object' && typeof options.playedMove === 'string'
    ? options.playedMove
    : null;
  const cpBefore = options && typeof options === 'object' && typeof options.cpBefore === 'number'
    ? options.cpBefore
    : null;
  const cpAfter = options && typeof options === 'object' && typeof options.cpAfter === 'number'
    ? options.cpAfter
    : null;
  const sacrificeIntentCp = options && typeof options === 'object' && typeof options._sacrificeIntentCp === 'number'
    ? options._sacrificeIntentCp
    : null;

  const syntheticMistake = {
    fen: fenAfterBadMove,
    side: normalizeSide(opponentSide, fenAfterBadMove),
    best: refutationPV[0],
    bestLine: refutationPV,
    deltaCp,
    _prevFen: prevFen,
    _prevPlayedMove: prevPlayedMove,
  };
  if (options && typeof options === 'object' && options.analysisMode === 'engine-pv') {
    syntheticMistake._analysisMode = 'engine-pv';
  }
  if (cpBefore !== null) syntheticMistake.cpBefore = cpBefore;
  if (cpAfter !== null) syntheticMistake.cpAfter = cpAfter;
  if (sacrificeIntentCp !== null) syntheticMistake._sacrificeIntentCp = sacrificeIntentCp;

  // Build a synthetic mistake object and delegate to detectThemes
  return detectThemes(syntheticMistake);
}

/* ================================================================== */
/*  Primary-theme resolver (shared across Stats/Train)                 */
/* ================================================================== */

const PRIMARY_THEME_SPECIFICITY = Object.freeze({
  [THEMES.MATE_IN_1]: 245,
  [THEMES.MATE_IN_2]: 235,
  [THEMES.MATE_IN_3]: 228,
  [THEMES.MATE_IN_4]: 220,
  [THEMES.MATE_IN_5]: 212,
  // Keep mate threats below core tactical motifs for primary-theme ranking.
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
  [THEMES.QUIET_MOVE]: 44,
});

const RECAPTURE_SENSITIVE_THEMES = new Set([
  THEMES.HANGING_PIECE,
  THEMES.TRAPPED_PIECE,
  THEMES.ATTACKING_UNDEFENDED_PIECE,
  THEMES.PIN,
]);

const TRAINER_PRIMARY_PLY_DECAY_BASE = 0.7;
const TRAINER_PRIMARY_ALLOWED_PRIORITY_BOOST = 1.45;
const TRAINER_PRIMARY_ALLOWED_PRIORITY_MAX_PLY = 2;
const TRAINER_PRIMARY_PHASE_ORDER = Object.freeze(['opening', 'middlegame', 'endgame']);
const TRAINER_PRIMARY_ACTIVE_TUNING_KEY = 'pmtt_trainer_primary_tuning_active_v1';
const TRAINER_PRIMARY_TUNING_HISTORY_KEY = 'pmtt_trainer_primary_tuning_history_v1';
const TRAINER_PRIMARY_TUNING_HISTORY_LIMIT = 32;
const TRAINER_PRIMARY_OPENING_MAX_FULLMOVE = 10;
const TRAINER_PRIMARY_ENDGAME_MIN_FULLMOVE = 31;
const TRAINER_PRIMARY_ENDGAME_NON_PAWN_MAX = 6;

function trainerPrimarySafeLsGet(key) {
  if (!key) return null;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function trainerPrimarySafeLsSet(key, value) {
  if (!key) return false;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function trainerPrimarySafeLsRemove(key) {
  if (!key) return false;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function trainerPrimaryClamp(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (Number.isFinite(min) && n < min) return min;
  if (Number.isFinite(max) && n > max) return max;
  return n;
}

function trainerPrimaryNormalizePhase(rawPhase) {
  const raw = String(rawPhase || '').trim().toLowerCase();
  return TRAINER_PRIMARY_PHASE_ORDER.includes(raw) ? raw : null;
}

function trainerPrimaryParseFenFullmove(fen) {
  try {
    const parts = String(fen || '').trim().split(/\s+/);
    if (parts.length < 6) return null;
    const fullmove = parseInt(parts[5], 10);
    return Number.isFinite(fullmove) ? fullmove : null;
  } catch {
    return null;
  }
}

function trainerPrimaryCountFenNonPawnPieces(fen) {
  try {
    const board = String(fen || '').trim().split(/\s+/)[0] || '';
    if (!board) return null;
    const matches = board.match(/[nbrqNBRQ]/g);
    return Array.isArray(matches) ? matches.length : 0;
  } catch {
    return null;
  }
}

function trainerPrimaryPhaseFromFen(fen) {
  const fullmove = trainerPrimaryParseFenFullmove(fen);
  if (Number.isFinite(fullmove) && fullmove <= TRAINER_PRIMARY_OPENING_MAX_FULLMOVE) {
    return 'opening';
  }
  const nonPawnPieces = trainerPrimaryCountFenNonPawnPieces(fen);
  if (
    (Number.isFinite(fullmove) && fullmove >= TRAINER_PRIMARY_ENDGAME_MIN_FULLMOVE) ||
    (Number.isFinite(nonPawnPieces) && nonPawnPieces <= TRAINER_PRIMARY_ENDGAME_NON_PAWN_MAX)
  ) {
    return 'endgame';
  }
  return 'middlegame';
}

function trainerPrimaryPhaseForMistake(mistake, options = null) {
  const phaseFromOptions = trainerPrimaryNormalizePhase(options?.phase);
  if (phaseFromOptions) return phaseFromOptions;
  const explicit = trainerPrimaryNormalizePhase(
    mistake?.phase || mistake?.gamePhase || mistake?.positionPhase
  );
  if (explicit) return explicit;
  return trainerPrimaryPhaseFromFen(mistake?.fen || '');
}

function trainerPrimaryBaseSpecificityMap() {
  return { ...PRIMARY_THEME_SPECIFICITY };
}

function trainerPrimaryNormalizeSpecificityMap(raw) {
  const out = {};
  const src = (raw && typeof raw === 'object') ? raw : {};
  const base = trainerPrimaryBaseSpecificityMap();
  for (const theme of Object.keys(base)) {
    const fallback = Number(base[theme] || 170);
    const parsed = Number(src[theme]);
    out[theme] = Number.isFinite(parsed)
      ? Math.round(trainerPrimaryClamp(parsed, 20, 320, fallback))
      : fallback;
  }
  return out;
}

function trainerPrimaryNormalizePhaseCpOffsetMap(raw) {
  const out = {};
  const src = (raw && typeof raw === 'object') ? raw : {};
  for (const phase of TRAINER_PRIMARY_PHASE_ORDER) {
    const value = trainerPrimaryClamp(src[phase], -120, 180, 0);
    out[phase] = Math.round(value);
  }
  return out;
}

function trainerPrimaryNormalizePhaseAbstainBiasMap(raw) {
  const out = {};
  const src = (raw && typeof raw === 'object') ? raw : {};
  for (const phase of TRAINER_PRIMARY_PHASE_ORDER) {
    out[phase] = trainerPrimaryClamp(src[phase], -0.35, 0.45, 0);
  }
  return out;
}

function trainerPrimaryBaseLineOptionsForMode(modeInput) {
  const mode = modeInput === 'allowed' ? 'allowed' : 'missed';
  const shared = {
    preferPlayerSide: true,
    margin: 10,
    abstainOnAmbiguous: false,
    abstainConfidenceMax: 0,
    abstainGapMax: 0,
    abstainLatePlyEnabled: false,
    abstainLatePlyMin: 4,
    phaseAbstainBiasByPhase: { opening: 0, middlegame: 0, endgame: 0 },
    playerSideBias: 52,
    opponentSidePenalty: -60,
    latePlyPenaltyEnabled: true,
    latePlyPenaltyFactor: 20,
    latePlyPenaltyGrowth: 2.5,
    latePlyPenaltyCap: 220,
    anchorBonus: 16,
    proximityBase: 12,
    proximityStepPenalty: 2,
    freshnessBonus: 14,
    staleThemePenalty: -18,
    forcingCheckBonus: 10,
    captureValueScale: 2,
    captureValueCap: 14,
    netMaterialScale: 4,
    netMaterialCap: 14,
    payoffScale: 3,
    payoffCap: 16,
    beforePayoffBonus: 8,
    afterPayoffPenalty: -4,
    immediateRecapturePenalty: 32
  };
  const modeSpecific = mode === 'allowed'
    ? { immediacyBase: 40, immediacyStepPenalty: 30, firstPlayerPlyBonus: 30 }
    : { immediacyBase: 36, immediacyStepPenalty: 30, firstPlayerPlyBonus: 18 };
  return { ...shared, ...modeSpecific };
}

function trainerPrimaryNormalizeLineOptions(modeInput, rawOptions = null, forcedSpecificityMap = null) {
  const mode = modeInput === 'allowed' ? 'allowed' : 'missed';
  const base = trainerPrimaryBaseLineOptionsForMode(mode);
  const src = (rawOptions && typeof rawOptions === 'object') ? rawOptions : {};
  const phaseAbstainBiasByPhase = trainerPrimaryNormalizePhaseAbstainBiasMap(
    src.phaseAbstainBiasByPhase || src.phaseAbstainByPhase || base.phaseAbstainBiasByPhase
  );
  const out = {
    preferPlayerSide: src.preferPlayerSide !== false,
    margin: trainerPrimaryClamp(src.margin, 0, 120, base.margin),
    abstainOnAmbiguous: src.abstainOnAmbiguous === true,
    abstainConfidenceMax: trainerPrimaryClamp(src.abstainConfidenceMax, 0, 0.95, base.abstainConfidenceMax),
    abstainGapMax: trainerPrimaryClamp(src.abstainGapMax, 0, 120, base.abstainGapMax),
    abstainLatePlyEnabled: src.abstainLatePlyEnabled === true,
    abstainLatePlyMin: Math.max(
      2,
      Math.min(10, Math.round(trainerPrimaryClamp(src.abstainLatePlyMin, 2, 10, base.abstainLatePlyMin)))
    ),
    phaseAbstainBiasByPhase,
    playerSideBias: trainerPrimaryClamp(src.playerSideBias, -100, 160, base.playerSideBias),
    opponentSidePenalty: trainerPrimaryClamp(src.opponentSidePenalty, -220, 80, base.opponentSidePenalty),
    immediacyBase: trainerPrimaryClamp(src.immediacyBase, 0, 120, base.immediacyBase),
    immediacyStepPenalty: trainerPrimaryClamp(src.immediacyStepPenalty, 0, 120, base.immediacyStepPenalty),
    firstPlayerPlyBonus: trainerPrimaryClamp(src.firstPlayerPlyBonus, -80, 120, base.firstPlayerPlyBonus),
    latePlyPenaltyEnabled: src.latePlyPenaltyEnabled !== false,
    latePlyPenaltyFactor: trainerPrimaryClamp(src.latePlyPenaltyFactor, 0, 140, base.latePlyPenaltyFactor),
    latePlyPenaltyGrowth: trainerPrimaryClamp(src.latePlyPenaltyGrowth, 1, 8, base.latePlyPenaltyGrowth),
    latePlyPenaltyCap: trainerPrimaryClamp(src.latePlyPenaltyCap, 0, 500, base.latePlyPenaltyCap),
    anchorBonus: trainerPrimaryClamp(src.anchorBonus, -40, 80, base.anchorBonus),
    proximityBase: trainerPrimaryClamp(src.proximityBase, 0, 60, base.proximityBase),
    proximityStepPenalty: trainerPrimaryClamp(src.proximityStepPenalty, 0, 12, base.proximityStepPenalty),
    freshnessBonus: trainerPrimaryClamp(src.freshnessBonus, -40, 60, base.freshnessBonus),
    staleThemePenalty: trainerPrimaryClamp(src.staleThemePenalty, -120, 40, base.staleThemePenalty),
    forcingCheckBonus: trainerPrimaryClamp(src.forcingCheckBonus, -30, 40, base.forcingCheckBonus),
    captureValueScale: trainerPrimaryClamp(src.captureValueScale, 0, 8, base.captureValueScale),
    captureValueCap: trainerPrimaryClamp(src.captureValueCap, 0, 40, base.captureValueCap),
    netMaterialScale: trainerPrimaryClamp(src.netMaterialScale, 0, 12, base.netMaterialScale),
    netMaterialCap: trainerPrimaryClamp(src.netMaterialCap, 0, 40, base.netMaterialCap),
    payoffScale: trainerPrimaryClamp(src.payoffScale, 0, 12, base.payoffScale),
    payoffCap: trainerPrimaryClamp(src.payoffCap, 0, 40, base.payoffCap),
    beforePayoffBonus: trainerPrimaryClamp(src.beforePayoffBonus, -20, 40, base.beforePayoffBonus),
    afterPayoffPenalty: trainerPrimaryClamp(src.afterPayoffPenalty, -40, 20, base.afterPayoffPenalty),
    immediateRecapturePenalty: trainerPrimaryClamp(src.immediateRecapturePenalty, 0, 120, base.immediateRecapturePenalty)
  };
  const specificityMap = (forcedSpecificityMap && typeof forcedSpecificityMap === 'object')
    ? forcedSpecificityMap
    : ((src.specificityMap && typeof src.specificityMap === 'object') ? src.specificityMap : null);
  if (specificityMap) {
    out.specificityMap = trainerPrimaryNormalizeSpecificityMap(specificityMap);
  }
  return out;
}

function trainerPrimaryApplyPhaseToLineOptions(modeInput, lineOptionsInput, phaseInput = null) {
  const mode = modeInput === 'allowed' ? 'allowed' : 'missed';
  const options = trainerPrimaryNormalizeLineOptions(mode, lineOptionsInput, lineOptionsInput?.specificityMap || null);
  const phase = trainerPrimaryNormalizePhase(phaseInput);
  if (!phase) return options;
  const biasMap = trainerPrimaryNormalizePhaseAbstainBiasMap(options?.phaseAbstainBiasByPhase || null);
  const phaseBias = Number(biasMap?.[phase] || 0);
  if (Math.abs(phaseBias) < 0.000001) return options;
  return trainerPrimaryNormalizeLineOptions(
    mode,
    {
      ...options,
      abstainConfidenceMax: trainerPrimaryClamp(
        Number(options.abstainConfidenceMax || 0) + (phaseBias * 0.28),
        0,
        0.95,
        options.abstainConfidenceMax || 0
      ),
      abstainGapMax: trainerPrimaryClamp(
        Number(options.abstainGapMax || 0) + (phaseBias * 32),
        0,
        120,
        options.abstainGapMax || 0
      )
    },
    options?.specificityMap || null
  );
}

function trainerPrimaryBaseTrainerOptions() {
  return {
    decayBase: TRAINER_PRIMARY_PLY_DECAY_BASE,
    allowedBoost: TRAINER_PRIMARY_ALLOWED_PRIORITY_BOOST,
    allowedPriorityMaxPly: TRAINER_PRIMARY_ALLOWED_PRIORITY_MAX_PLY,
    minCpDrop: 100,
    minCpDropOffsetByPhase: { opening: 0, middlegame: 0, endgame: 0 }
  };
}

function trainerPrimaryNormalizeTrainerOptions(rawOptions = null) {
  const base = trainerPrimaryBaseTrainerOptions();
  const src = (rawOptions && typeof rawOptions === 'object') ? rawOptions : {};
  const minCpDropOffsetByPhase = trainerPrimaryNormalizePhaseCpOffsetMap(
    src.minCpDropOffsetByPhase || src.phaseMinCpDropOffsets || base.minCpDropOffsetByPhase
  );
  return {
    decayBase: trainerPrimaryClamp(src.decayBase, 0.2, 0.95, base.decayBase),
    allowedBoost: trainerPrimaryClamp(src.allowedBoost, 1.0, 3.5, base.allowedBoost),
    allowedPriorityMaxPly: Math.max(
      1,
      Math.min(8, Math.round(trainerPrimaryClamp(src.allowedPriorityMaxPly, 1, 8, base.allowedPriorityMaxPly)))
    ),
    minCpDrop: Math.max(
      40,
      Math.min(260, Math.round(trainerPrimaryClamp(src.minCpDrop, 40, 260, base.minCpDrop)))
    ),
    minCpDropOffsetByPhase
  };
}

function trainerPrimaryResolveLineOptionsForMode(modeInput, tuningInput, phaseInput, overrideInput = null) {
  const mode = modeInput === 'allowed' ? 'allowed' : 'missed';
  const tuning = (tuningInput && typeof tuningInput === 'object') ? tuningInput : null;
  const override = (overrideInput && typeof overrideInput === 'object') ? overrideInput : {};
  const specificityMap = trainerPrimaryNormalizeSpecificityMap(
    override.specificityMap || tuning?.specificityMap || trainerPrimaryBaseSpecificityMap()
  );
  const tunedLine = (tuning?.line?.[mode] && typeof tuning.line[mode] === 'object')
    ? tuning.line[mode]
    : {};
  const raw = { ...tunedLine, ...override };
  const normalized = trainerPrimaryNormalizeLineOptions(mode, raw, specificityMap);
  return trainerPrimaryApplyPhaseToLineOptions(mode, normalized, phaseInput);
}

function trainerPrimaryCpDropAbs(mistake) {
  const cp = Number(mistake?.deltaCp);
  if (!Number.isFinite(cp)) return null;
  return Math.abs(cp);
}

function trainerPrimaryMinCpDropForPhase(trainerOptionsInput, phaseInput = null) {
  const trainerOptions = trainerPrimaryNormalizeTrainerOptions(trainerOptionsInput);
  const baseMin = Math.max(0, Math.round(Number(trainerOptions?.minCpDrop) || 100));
  const phase = trainerPrimaryNormalizePhase(phaseInput);
  if (!phase) return baseMin;
  const offsets = trainerPrimaryNormalizePhaseCpOffsetMap(trainerOptions?.minCpDropOffsetByPhase || null);
  const offset = Math.round(Number(offsets?.[phase] || 0));
  return Math.max(40, Math.min(360, baseMin + offset));
}

function trainerPrimaryIsEligibleMistake(mistake, trainerOptionsInput, phaseInput = null, options = null) {
  if (options?.enforceMinCpDrop === false) return true;
  const cpDrop = trainerPrimaryCpDropAbs(mistake);
  if (cpDrop === null) return true;
  const phase = trainerPrimaryNormalizePhase(phaseInput) || trainerPrimaryPhaseForMistake(mistake);
  return cpDrop >= trainerPrimaryMinCpDropForPhase(trainerOptionsInput, phase);
}

function trainerPrimaryNormalizeMetrics(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const robustObjective = trainerPrimaryClamp(
    src.robustObjective,
    -10,
    10,
    trainerPrimaryClamp(src.objective, -10, 10, 0)
  );
  return {
    lineAccuracy: trainerPrimaryClamp(src.lineAccuracy, 0, 1, 0),
    trainerAccuracy: trainerPrimaryClamp(src.trainerAccuracy, 0, 1, 0),
    robustObjective,
    objective: robustObjective,
    foldStdDev: trainerPrimaryClamp(src.foldStdDev, 0, 10, 0),
    foldCount: Math.max(0, Math.floor(Number(src.foldCount) || 0))
  };
}

function trainerPrimaryNormalizeTuningPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const specificityMap = trainerPrimaryNormalizeSpecificityMap(raw.specificityMap || trainerPrimaryBaseSpecificityMap());
  const line = {
    missed: trainerPrimaryNormalizeLineOptions(
      'missed',
      raw?.line?.missed || {},
      specificityMap
    ),
    allowed: trainerPrimaryNormalizeLineOptions(
      'allowed',
      raw?.line?.allowed || {},
      specificityMap
    )
  };
  const trainer = trainerPrimaryNormalizeTrainerOptions(raw.trainer || {});
  const metrics = trainerPrimaryNormalizeMetrics(raw.metrics || {});
  const trainedAt = String(raw.trainedAt || '').trim() || new Date().toISOString();
  return { specificityMap, line, trainer, metrics, trainedAt };
}

function trainerPrimaryVersionId() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `tp_${stamp}_${rand}`;
}

let TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_RAW = null;
let TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = null;

function trainerPrimaryNormalizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tuning = trainerPrimaryNormalizeTuningPayload(raw.tuning || null);
  if (!tuning) return null;
  const versionId = String(raw.versionId || '').trim() || trainerPrimaryVersionId();
  const savedAt = String(raw.savedAt || '').trim() || new Date().toISOString();
  const source = String(raw.source || '').trim() || 'stats-theme-tester';
  const note = String(raw.note || '').trim();
  const metrics = trainerPrimaryNormalizeMetrics(raw.metrics || tuning.metrics || {});
  return { versionId, savedAt, source, note, tuning, metrics };
}

function trainerPrimaryReadHistory() {
  const raw = trainerPrimarySafeLsGet(TRAINER_PRIMARY_TUNING_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    const seen = new Set();
    for (const item of parsed) {
      const entry = trainerPrimaryNormalizeHistoryEntry(item);
      if (!entry) continue;
      if (seen.has(entry.versionId)) continue;
      seen.add(entry.versionId);
      out.push(entry);
      if (out.length >= TRAINER_PRIMARY_TUNING_HISTORY_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

function trainerPrimaryWriteHistory(list) {
  const src = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const item of src) {
    const entry = trainerPrimaryNormalizeHistoryEntry(item);
    if (!entry) continue;
    if (seen.has(entry.versionId)) continue;
    seen.add(entry.versionId);
    out.push(entry);
    if (out.length >= TRAINER_PRIMARY_TUNING_HISTORY_LIMIT) break;
  }
  trainerPrimarySafeLsSet(TRAINER_PRIMARY_TUNING_HISTORY_KEY, JSON.stringify(out));
  return out;
}

function trainerPrimaryReadActiveEntry() {
  const raw = trainerPrimarySafeLsGet(TRAINER_PRIMARY_ACTIVE_TUNING_KEY);
  if (raw === TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_RAW) {
    return TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE;
  }
  TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_RAW = raw;
  if (!raw) {
    TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const entry = trainerPrimaryNormalizeHistoryEntry(parsed);
    TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = entry;
    return entry;
  } catch {
    TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = null;
    return null;
  }
}

function trainerPrimaryWriteActiveEntry(entryInput) {
  const entry = trainerPrimaryNormalizeHistoryEntry(entryInput);
  if (!entry) {
    TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_RAW = null;
    TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = null;
    trainerPrimarySafeLsRemove(TRAINER_PRIMARY_ACTIVE_TUNING_KEY);
    return null;
  }
  const raw = JSON.stringify(entry);
  TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_RAW = raw;
  TRAINER_PRIMARY_ACTIVE_ENTRY_CACHE_VALUE = entry;
  trainerPrimarySafeLsSet(TRAINER_PRIMARY_ACTIVE_TUNING_KEY, raw);
  return entry;
}

function trainerPrimaryResolveActiveTuning(options = null) {
  const explicit = trainerPrimaryNormalizeTuningPayload(options?.tuning || null);
  if (explicit) {
    return { tuning: explicit, versionId: String(options?.tuningVersion || '').trim() || null };
  }
  const active = trainerPrimaryReadActiveEntry();
  return {
    tuning: active?.tuning || null,
    versionId: String(active?.versionId || '').trim() || null
  };
}

export function getTrainerPrimaryTuningActiveEntry() {
  const active = trainerPrimaryReadActiveEntry();
  return active ? { ...active } : null;
}

export function listTrainerPrimaryTuningVersions() {
  return trainerPrimaryReadHistory().map((entry) => ({ ...entry }));
}

export function syncTrainerPrimaryTuningToMainSite(rawTuning, options = null) {
  const tuning = trainerPrimaryNormalizeTuningPayload(rawTuning);
  if (!tuning) {
    throw new Error('No valid tuning config to sync.');
  }
  const nowIso = new Date().toISOString();
  const entry = trainerPrimaryNormalizeHistoryEntry({
    versionId: String(options?.versionId || '').trim() || trainerPrimaryVersionId(),
    savedAt: String(options?.savedAt || '').trim() || nowIso,
    source: String(options?.source || '').trim() || 'stats-theme-tester',
    note: String(options?.note || '').trim(),
    metrics: trainerPrimaryNormalizeMetrics(options?.metrics || tuning.metrics || {}),
    tuning
  });
  if (!entry) throw new Error('Failed to normalize tuning config.');
  trainerPrimaryWriteActiveEntry(entry);
  const history = trainerPrimaryWriteHistory([entry, ...trainerPrimaryReadHistory()]);
  return {
    active: { ...entry },
    history: history.map((item) => ({ ...item }))
  };
}

export function restoreTrainerPrimaryTuningVersion(versionIdInput) {
  const versionId = String(versionIdInput || '').trim();
  if (!versionId) return null;
  const history = trainerPrimaryReadHistory();
  const found = history.find((entry) => String(entry?.versionId || '') === versionId) || null;
  if (!found) return null;
  const restored = trainerPrimaryWriteActiveEntry(found);
  return restored ? { ...restored } : null;
}

export function clearTrainerPrimaryTuningToDefaults() {
  trainerPrimaryWriteActiveEntry(null);
  return true;
}

function normalizePrimaryThemeValue(value) {
  const theme = String(value || '').trim();
  return theme || null;
}

function normalizePrimarySourceValue(value) {
  const source = String(value || '').trim();
  if (source === 'missed' || source === 'allowed' || source === 'both') return source;
  return null;
}

function normalizePrimaryPlyValue(value) {
  const ply = Number(value);
  if (!Number.isFinite(ply) || ply <= 0) return null;
  return Math.floor(ply);
}

function scoreTrainerPrimaryByPly(playerPlyRaw, decayBaseRaw = TRAINER_PRIMARY_PLY_DECAY_BASE) {
  const playerPly = Number(playerPlyRaw);
  if (!Number.isFinite(playerPly) || playerPly <= 0) return 0;
  const clampedBase = Math.max(0.2, Math.min(0.95, Number(decayBaseRaw)));
  return Math.pow(clampedBase, Math.max(0, Math.floor(playerPly) - 1));
}

function normalizeTacticalThemeList(rawThemes) {
  return Array.from(new Set(filterToTactical(rawThemes || [])));
}

function resolvePrimaryCandidateFromResolved(resolved, fallbackTheme = null, specificityMap = null) {
  const ranked = Array.isArray(resolved?.ranked) ? resolved.ranked : [];
  const resolvedTheme = normalizePrimaryThemeValue(resolved?.theme);
  const fallback = normalizePrimaryThemeValue(fallbackTheme);
  const theme = resolvedTheme || fallback || null;
  if (!theme) return { theme: null, playerPly: null, specificity: null };

  const rankedEntry = ranked.find((entry) => normalizePrimaryThemeValue(entry?.theme) === theme)
    || ranked[0]
    || null;
  const playerPly = normalizePrimaryPlyValue(rankedEntry?.playerPly);
  let specificity = null;
  try {
    const parts = Array.isArray(rankedEntry?.scoreParts) ? rankedEntry.scoreParts : [];
    const part = parts.find((p) => String(p?.key || '') === 'specificity');
    const parsed = Number(part?.value);
    if (Number.isFinite(parsed)) specificity = parsed;
  } catch {}
  if (!Number.isFinite(Number(specificity))) {
    const fallbackSpecificity = Number((specificityMap && typeof specificityMap === 'object')
      ? specificityMap[theme]
      : PRIMARY_THEME_SPECIFICITY[theme]);
    specificity = Number.isFinite(fallbackSpecificity) ? fallbackSpecificity : null;
  }
  return {
    theme,
    playerPly,
    specificity: Number.isFinite(Number(specificity)) ? Number(specificity) : null
  };
}

function resolveLinePrimaryCandidate(rawThemes, detail, side, resolverOptions, fallbackTheme = null) {
  const tactical = normalizeTacticalThemeList(rawThemes);
  if (!tactical.length) return { theme: null, playerPly: null, specificity: null };
  const resolved = resolvePrimaryThemeDetailed(
    tactical,
    detail || null,
    side,
    resolverOptions || null
  );
  return resolvePrimaryCandidateFromResolved(
    resolved,
    tactical[0] || fallbackTheme,
    resolverOptions?.specificityMap || null
  );
}

function chooseTrainerPrimaryCandidate(missedCandidate, allowedCandidate, trainerOptionsInput = null) {
  const trainerOptions = trainerPrimaryNormalizeTrainerOptions(trainerOptionsInput);
  const missedTheme = normalizePrimaryThemeValue(missedCandidate?.theme);
  const allowedTheme = normalizePrimaryThemeValue(allowedCandidate?.theme);
  if (allowedTheme && !missedTheme) return { theme: allowedTheme, source: 'allowed' };
  if (missedTheme && !allowedTheme) return { theme: missedTheme, source: 'missed' };
  if (!allowedTheme && !missedTheme) return { theme: null, source: null };
  if (allowedTheme && missedTheme && allowedTheme === missedTheme) return { theme: allowedTheme, source: 'both' };

  const missedPly = normalizePrimaryPlyValue(missedCandidate?.playerPly);
  const allowedPly = normalizePrimaryPlyValue(allowedCandidate?.playerPly);
  const allowedPriorityMaxPly = Math.max(
    1,
    Math.min(8, Math.round(Number(trainerOptions?.allowedPriorityMaxPly || TRAINER_PRIMARY_ALLOWED_PRIORITY_MAX_PLY)))
  );
  const allowedBoostValue = Math.max(1.0, Number(trainerOptions?.allowedBoost || TRAINER_PRIMARY_ALLOWED_PRIORITY_BOOST));
  const decayBaseValue = trainerPrimaryClamp(
    trainerOptions?.decayBase,
    0.2,
    0.95,
    TRAINER_PRIMARY_PLY_DECAY_BASE
  );
  const allowedBoost = (allowedPly !== null && allowedPly <= allowedPriorityMaxPly)
    ? allowedBoostValue
    : 1.0;
  const missedScore = scoreTrainerPrimaryByPly(missedPly, decayBaseValue);
  const allowedScore = scoreTrainerPrimaryByPly(allowedPly, decayBaseValue) * Math.max(1.0, allowedBoost);

  if (Math.abs(allowedScore - missedScore) <= 1e-9) {
    const missedSpecificity = Number(missedCandidate?.specificity);
    const allowedSpecificity = Number(allowedCandidate?.specificity);
    if (
      Number.isFinite(missedSpecificity) &&
      Number.isFinite(allowedSpecificity) &&
      missedSpecificity !== allowedSpecificity
    ) {
      return allowedSpecificity > missedSpecificity
        ? { theme: allowedTheme, source: 'allowed' }
        : { theme: missedTheme, source: 'missed' };
    }
    if (allowedPly === null || allowedPly > allowedPriorityMaxPly) {
      return { theme: missedTheme, source: 'missed' };
    }
  }
  return allowedScore >= missedScore
    ? { theme: allowedTheme, source: 'allowed' }
    : { theme: missedTheme, source: 'missed' };
}

function deriveFenAfterPlayedMoveForTrainer(mistake) {
  const explicit = String(mistake?.fenAfter || '').trim();
  if (explicit) return explicit;
  const fenBefore = String(mistake?.fen || '').trim();
  if (!fenBefore) return null;
  const played = normalizeMove(fenBefore, mistake?.playedUci || mistake?.played);
  if (!played) return null;
  try {
    const cl = ChessLite();
    cl.loadFEN(fenBefore);
    const mv = cl.moveUci(played);
    if (!mv || mv.ok === false) return null;
    return cl.fen();
  } catch {
    return null;
  }
}

export function resolveTrainerPrimaryMetadata(mistakeInput, options = null) {
  const mistake = (mistakeInput && typeof mistakeInput === 'object') ? mistakeInput : {};
  const opts = (options && typeof options === 'object') ? options : {};
  const computeMissingDetails = opts.computeMissingDetails !== false;
  const phase = trainerPrimaryPhaseForMistake(mistake, opts);
  const activeTuning = trainerPrimaryResolveActiveTuning(opts);
  const tuning = activeTuning?.tuning || null;
  const trainerOptions = trainerPrimaryNormalizeTrainerOptions(
    (opts.trainerOptions && typeof opts.trainerOptions === 'object')
      ? opts.trainerOptions
      : (tuning?.trainer || null)
  );
  const missedPrimaryOptions = trainerPrimaryResolveLineOptionsForMode(
    'missed',
    tuning,
    phase,
    (opts.missedPrimaryOptions && typeof opts.missedPrimaryOptions === 'object')
      ? opts.missedPrimaryOptions
      : null
  );
  const allowedPrimaryOptions = trainerPrimaryResolveLineOptionsForMode(
    'allowed',
    tuning,
    phase,
    (opts.allowedPrimaryOptions && typeof opts.allowedPrimaryOptions === 'object')
      ? opts.allowedPrimaryOptions
      : null
  );

  const missedSide = normalizeSide(opts.missedSide || mistake?.side, mistake?.fen);
  let allowedFenAfter = String(opts.allowedFenAfter || '').trim() || null;
  if (!allowedFenAfter) {
    allowedFenAfter = deriveFenAfterPlayedMoveForTrainer(mistake);
  }
  let allowedSide = (() => {
    const raw = String(opts.allowedSide || '').trim().toLowerCase();
    if (raw === 'w' || raw === 'white') return 'w';
    if (raw === 'b' || raw === 'black') return 'b';
    try {
      const turn = String(allowedFenAfter || '').trim().split(/\s+/)[1];
      if (turn === 'w' || turn === 'b') return turn;
    } catch {}
    return null;
  })();
  if (!allowedSide && (missedSide === 'w' || missedSide === 'b')) {
    allowedSide = missedSide === 'w' ? 'b' : 'w';
  }

  let missedDetail = (opts.missedDetail && typeof opts.missedDetail === 'object')
    ? opts.missedDetail
    : null;
  let allowedDetail = (opts.allowedDetail && typeof opts.allowedDetail === 'object')
    ? opts.allowedDetail
    : null;

  let missedThemes = normalizeTacticalThemeList(
    Array.isArray(opts.missedThemes) ? opts.missedThemes : mistake?.themes
  );
  let allowedThemes = normalizeTacticalThemeList(
    Array.isArray(opts.allowedThemes) ? opts.allowedThemes : mistake?.allowedThemes
  );

  if (computeMissingDetails && !missedDetail) {
    try {
      if (mistake?.fen && mistake?.best) {
        missedDetail = detectThemesDetailed(mistake);
      }
    } catch {}
  }

  if (!missedThemes.length && missedDetail) {
    missedThemes = normalizeTacticalThemeList(missedDetail?.themes || []);
  }

  const refutationLine = Array.isArray(opts.refutationLine)
    ? opts.refutationLine
    : (Array.isArray(mistake?.refutationLine) ? mistake.refutationLine : []);
  if (computeMissingDetails && !allowedDetail && allowedFenAfter && refutationLine.length) {
    try {
      if (!allowedSide || (allowedSide !== 'w' && allowedSide !== 'b')) {
        try {
          const turn = String(allowedFenAfter || '').trim().split(/\s+/)[1];
          allowedSide = (turn === 'w' || turn === 'b') ? turn : null;
        } catch {
          allowedSide = null;
        }
      }
      const playedMove = normalizeMove(String(mistake?.fen || '').trim(), mistake?.playedUci || mistake?.played);
      allowedDetail = detectAllowedThemesDetailed(
        allowedFenAfter,
        refutationLine,
        allowedSide,
        {
          deltaCp: Number.isFinite(Number(mistake?.deltaCp)) ? Number(mistake.deltaCp) : null,
          previousFen: String(mistake?.fen || '').trim() || null,
          playedMove: playedMove || null,
          cpBefore: Number.isFinite(Number(mistake?.cpAfter)) ? Number(mistake.cpAfter) : null,
          _sacrificeIntentCp: Number.isFinite(Number(mistake?.cpAfter)) ? Number(mistake.cpAfter) : null
        }
      );
    } catch {}
  }

  if (!allowedThemes.length && allowedDetail) {
    allowedThemes = normalizeTacticalThemeList(allowedDetail?.themes || []);
  }

  const missedCandidate = resolveLinePrimaryCandidate(
    missedThemes,
    missedDetail,
    missedSide,
    missedPrimaryOptions,
    missedThemes[0] || null
  );

  const resolvedAllowedSide = (allowedSide === 'w' || allowedSide === 'b')
    ? allowedSide
    : (missedSide === 'w' ? 'b' : 'w');
  const allowedCandidate = resolveLinePrimaryCandidate(
    allowedThemes,
    allowedDetail,
    resolvedAllowedSide,
    allowedPrimaryOptions,
    allowedThemes[0] || null
  );

  const minCpDrop = trainerPrimaryMinCpDropForPhase(trainerOptions, phase);
  const enforceMinCpDrop = (typeof opts.enforceMinCpDrop === 'boolean')
    ? opts.enforceMinCpDrop
    : true;
  const eligible = trainerPrimaryIsEligibleMistake(
    mistake,
    trainerOptions,
    phase,
    { enforceMinCpDrop }
  );
  const chosen = eligible
    ? chooseTrainerPrimaryCandidate(missedCandidate, allowedCandidate, trainerOptions)
    : { theme: null, source: null };
  const source = normalizePrimarySourceValue(chosen?.source);
  return {
    trainerPrimaryTheme: normalizePrimaryThemeValue(chosen?.theme),
    trainerPrimarySource: source,
    primaryMissedTheme: normalizePrimaryThemeValue(missedCandidate?.theme),
    primaryAllowedTheme: normalizePrimaryThemeValue(allowedCandidate?.theme),
    trainerPrimaryVersion: Number(TRAINER_PRIMARY_VERSION || 0),
    trainerPrimaryMissedPly: normalizePrimaryPlyValue(missedCandidate?.playerPly),
    trainerPrimaryAllowedPly: normalizePrimaryPlyValue(allowedCandidate?.playerPly),
    trainerPrimaryEligible: !!eligible,
    trainerPrimaryMinCpDrop: minCpDrop,
    trainerPrimaryPhase: trainerPrimaryNormalizePhase(phase),
    trainerPrimaryConfigVersion: String(activeTuning?.versionId || '').trim() || null
  };
}

export function applyTrainerPrimaryMetadata(mistake, options = null) {
  if (!mistake || typeof mistake !== 'object') return mistake;
  let metadata = null;
  try { metadata = resolveTrainerPrimaryMetadata(mistake, options); } catch { metadata = null; }
  if (!metadata || typeof metadata !== 'object') return mistake;
  mistake.trainerPrimaryTheme = normalizePrimaryThemeValue(metadata.trainerPrimaryTheme);
  mistake.trainerPrimarySource = normalizePrimarySourceValue(metadata.trainerPrimarySource);
  mistake.primaryMissedTheme = normalizePrimaryThemeValue(metadata.primaryMissedTheme);
  mistake.primaryAllowedTheme = normalizePrimaryThemeValue(metadata.primaryAllowedTheme);
  mistake.trainerPrimaryVersion = Number.isFinite(Number(metadata.trainerPrimaryVersion))
    ? Number(metadata.trainerPrimaryVersion)
    : Number(TRAINER_PRIMARY_VERSION || 0);
  mistake.trainerPrimaryMissedPly = normalizePrimaryPlyValue(metadata.trainerPrimaryMissedPly);
  mistake.trainerPrimaryAllowedPly = normalizePrimaryPlyValue(metadata.trainerPrimaryAllowedPly);
  mistake.trainerPrimaryConfigVersion = String(metadata.trainerPrimaryConfigVersion || '').trim() || null;
  mistake.trainerPrimaryEligible = metadata.trainerPrimaryEligible === true;
  mistake.trainerPrimaryMinCpDrop = Number.isFinite(Number(metadata.trainerPrimaryMinCpDrop))
    ? Math.max(0, Math.round(Number(metadata.trainerPrimaryMinCpDrop)))
    : null;
  mistake.trainerPrimaryPhase = trainerPrimaryNormalizePhase(metadata.trainerPrimaryPhase);
  return mistake;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function resolveDetailThemeStepIndex(detail) {
  if (!detail || !Array.isArray(detail.steps) || !detail.steps.length) return -1;
  let idx = Number.isInteger(detail.themeStepIndex) ? detail.themeStepIndex : -1;
  if ((idx < 0 || idx >= detail.steps.length) && detail.themeUci) {
    const found = detail.steps.findIndex((step) => step?.uci === detail.themeUci);
    if (found >= 0) idx = found;
  }
  if (idx < 0 || idx >= detail.steps.length) idx = 0;
  return idx;
}

function isImmediateEvenOrWorseRecapture(detail, idx, playerSide) {
  const steps = Array.isArray(detail?.steps) ? detail.steps : [];
  const step = steps[idx];
  const next = steps[idx + 1];
  if (!step || !next || !step.uci || !next.uci || !step.capturedPiece || !step.movedPiece) return false;
  const s1Side = normalizeSide(step.side, step.fenBefore);
  const s2Side = normalizeSide(next.side, next.fenBefore);
  if (s1Side !== playerSide || s2Side === playerSide) return false;
  if (next.uci.slice(2, 4) !== step.uci.slice(2, 4)) return false;
  const nextCaptured = String(next.capturedPiece || '').toUpperCase();
  const moved = String(step.movedPiece || '').toUpperCase();
  if (!nextCaptured || !moved || nextCaptured !== moved) return false;
  const toIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(2, 4));
  const fromIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(0, 2));
  const capturedVal = effectivePieceValue(step.capturedPiece, Number.isInteger(toIdx) ? toIdx : null);
  const movedVal = effectivePieceValue(step.movedPiece, Number.isInteger(fromIdx) ? fromIdx : null);
  return capturedVal <= movedVal;
}

function countPlayerPlyAtIndex(steps, idx, playerSide) {
  if (!Array.isArray(steps) || idx < 0) return Number.MAX_SAFE_INTEGER;
  let ply = 0;
  for (let i = 0; i <= idx && i < steps.length; i++) {
    const side = normalizeSide(steps[i]?.side, steps[i]?.fenBefore);
    if (side === playerSide) ply += 1;
  }
  return ply || Number.MAX_SAFE_INTEGER;
}

export function resolvePrimaryThemeDetailed(detectedThemes, detail, side, options = null) {
  const tags = filterToTactical(detectedThemes);
  const specificityMap = (options && typeof options?.specificityMap === 'object')
    ? options.specificityMap
    : PRIMARY_THEME_SPECIFICITY;
  const margin = Number.isFinite(Number(options?.margin)) ? Number(options.margin) : 10;
  const preferPlayerSide = !!options?.preferPlayerSide;
  const immediacyBase = Number.isFinite(Number(options?.immediacyBase))
    ? Number(options.immediacyBase)
    : 30;
  const immediacyStepPenalty = Number.isFinite(Number(options?.immediacyStepPenalty))
    ? Number(options.immediacyStepPenalty)
    : 10;
  const playerSideBias = Number.isFinite(Number(options?.playerSideBias))
    ? Number(options.playerSideBias)
    : 52;
  const opponentSidePenalty = Number.isFinite(Number(options?.opponentSidePenalty))
    ? Number(options.opponentSidePenalty)
    : -60;
  const firstPlayerPlyBonus = Number.isFinite(Number(options?.firstPlayerPlyBonus))
    ? Number(options.firstPlayerPlyBonus)
    : 0;
  const latePlyPenaltyEnabled = options?.latePlyPenaltyEnabled !== false;
  const latePlyPenaltyFactor = Number.isFinite(Number(options?.latePlyPenaltyFactor))
    ? Number(options.latePlyPenaltyFactor)
    : 20;
  const latePlyPenaltyGrowth = Number.isFinite(Number(options?.latePlyPenaltyGrowth))
    ? Number(options.latePlyPenaltyGrowth)
    : 2.5;
  const latePlyPenaltyCap = Number.isFinite(Number(options?.latePlyPenaltyCap))
    ? Number(options.latePlyPenaltyCap)
    : 220;
  const anchorBonus = Number.isFinite(Number(options?.anchorBonus))
    ? Number(options.anchorBonus)
    : 16;
  const proximityBase = Number.isFinite(Number(options?.proximityBase))
    ? Number(options.proximityBase)
    : 12;
  const proximityStepPenalty = Number.isFinite(Number(options?.proximityStepPenalty))
    ? Number(options.proximityStepPenalty)
    : 2;
  const freshnessBonus = Number.isFinite(Number(options?.freshnessBonus))
    ? Number(options.freshnessBonus)
    : 14;
  const staleThemePenalty = Number.isFinite(Number(options?.staleThemePenalty))
    ? Number(options.staleThemePenalty)
    : -18;
  const forcingCheckBonus = Number.isFinite(Number(options?.forcingCheckBonus))
    ? Number(options.forcingCheckBonus)
    : 10;
  const captureValueScale = Number.isFinite(Number(options?.captureValueScale))
    ? Number(options.captureValueScale)
    : 2;
  const captureValueCap = Number.isFinite(Number(options?.captureValueCap))
    ? Number(options.captureValueCap)
    : 14;
  const netMaterialScale = Number.isFinite(Number(options?.netMaterialScale))
    ? Number(options.netMaterialScale)
    : 4;
  const netMaterialCap = Number.isFinite(Number(options?.netMaterialCap))
    ? Number(options.netMaterialCap)
    : 14;
  const payoffScale = Number.isFinite(Number(options?.payoffScale))
    ? Number(options.payoffScale)
    : 3;
  const payoffCap = Number.isFinite(Number(options?.payoffCap))
    ? Number(options.payoffCap)
    : 16;
  const beforePayoffBonus = Number.isFinite(Number(options?.beforePayoffBonus))
    ? Number(options.beforePayoffBonus)
    : 8;
  const afterPayoffPenalty = Number.isFinite(Number(options?.afterPayoffPenalty))
    ? Number(options.afterPayoffPenalty)
    : -4;
  const immediateRecapturePenalty = Number.isFinite(Number(options?.immediateRecapturePenalty))
    ? Number(options.immediateRecapturePenalty)
    : 32;
  if (!tags.length) {
    return {
      theme: null,
      confidence: 0,
      ambiguous: false,
      gap: 0,
      ranked: [],
      stepIndex: -1,
    };
  }
  if (tags.length === 1) {
    const singleTheme = tags[0];
    const steps = Array.isArray(detail?.steps) ? detail.steps : [];
    const playerSide = normalizeSide(side, detail?.steps?.[0]?.fenBefore || '');
    const themeStepMap = (detail && typeof detail.themeStepIndexByTheme === 'object' && detail.themeStepIndexByTheme)
      ? detail.themeStepIndexByTheme
      : null;
    const mappedRaw = themeStepMap ? Number(themeStepMap[singleTheme]) : NaN;
    const stepIndex = (Number.isInteger(mappedRaw) && mappedRaw >= 0 && mappedRaw < steps.length)
      ? mappedRaw
      : resolveDetailThemeStepIndex(detail);
    const computedPly = (stepIndex >= 0 && stepIndex < steps.length)
      ? countPlayerPlyAtIndex(steps, stepIndex, playerSide)
      : 1;
    const playerPly = Number.isFinite(computedPly) && computedPly > 0 ? computedPly : 1;
    return {
      theme: singleTheme,
      confidence: 0.98,
      ambiguous: false,
      gap: 999,
      ranked: [{ theme: singleTheme, score: 999, stepIndex, playerPly }],
      stepIndex,
    };
  }

  const playerSide = normalizeSide(side, detail?.steps?.[0]?.fenBefore || '');
  const steps = Array.isArray(detail?.steps) ? detail.steps : [];
  const anchorIdx = resolveDetailThemeStepIndex(detail);
  const themeStepMap = (detail && typeof detail.themeStepIndexByTheme === 'object' && detail.themeStepIndexByTheme)
    ? detail.themeStepIndexByTheme
    : null;
  const taggedThemeSet = new Set(tags);
  const mappedStepIndexByTheme = new Map();
  const mappedThemesByStep = new Map();
  if (themeStepMap) {
    for (const [themeRaw, idxRaw] of Object.entries(themeStepMap)) {
      const theme = String(themeRaw || '').trim();
      const idx = Number(idxRaw);
      if (!theme || !taggedThemeSet.has(theme)) continue;
      if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) continue;
      mappedStepIndexByTheme.set(theme, idx);
      const existing = mappedThemesByStep.get(idx);
      if (existing) existing.add(theme);
      else mappedThemesByStep.set(idx, new Set([theme]));
    }
  }
  const mappedStepIndexForTheme = (theme) => (
    mappedStepIndexByTheme.has(theme) ? mappedStepIndexByTheme.get(theme) : -1
  );
  const stepThemeCache = new Map();
  const themeSidePresenceCache = new Map();
  const stepThemesAt = (idx) => {
    if (!Array.isArray(steps) || idx < 0 || idx >= steps.length) return [];
    if (stepThemeCache.has(idx)) return stepThemeCache.get(idx);
    const step = steps[idx];
    let tactical = [];
    try {
      const stepSide = normalizeSide(step?.side, step?.fenBefore) || playerSide;
      tactical = filterToTactical(detectTacticsAtStep(step, stepSide, {
        steps,
        previousFen: typeof detail?.previousFen === 'string' ? detail.previousFen : null,
        previousMove: typeof detail?.previousMove === 'string' ? detail.previousMove : null,
      }) || []);
    } catch {}
    const mapped = mappedThemesByStep.get(idx);
    if (mapped && mapped.size) {
      const merged = new Set(Array.isArray(tactical) ? tactical : []);
      mapped.forEach((theme) => merged.add(theme));
      tactical = Array.from(merged.values());
    }
    stepThemeCache.set(idx, tactical);
    return tactical;
  };

  const themeAppearsOnSide = (theme, targetSide) => {
    const normalizedTarget = normalizeSide(targetSide);
    if (!normalizedTarget || !steps.length) return false;
    const cacheKey = `${String(theme || '')}|${normalizedTarget}`;
    if (themeSidePresenceCache.has(cacheKey)) return themeSidePresenceCache.get(cacheKey);
    const mappedIdx = mappedStepIndexForTheme(theme);
    if (mappedIdx >= 0 && mappedIdx < steps.length) {
      const mappedSide = normalizeSide(steps[mappedIdx]?.side, steps[mappedIdx]?.fenBefore);
      if (mappedSide === normalizedTarget) {
        themeSidePresenceCache.set(cacheKey, true);
        return true;
      }
    }
    let found = false;
    for (let i = 0; i < steps.length; i++) {
      const stepSide = normalizeSide(steps[i]?.side, steps[i]?.fenBefore);
      if (stepSide !== normalizedTarget) continue;
      if (stepThemesAt(i).includes(theme)) {
        found = true;
        break;
      }
    }
    themeSidePresenceCache.set(cacheKey, found);
    return found;
  };

  const hasAnyThemeOnPlayerSide = preferPlayerSide
    && (playerSide === 'w' || playerSide === 'b')
    && tags.some((theme) => themeAppearsOnSide(theme, playerSide));

  const findThemeStepIndex = (theme, preferredSide = null) => {
    if (!steps.length) return -1;
    const preferred = normalizeSide(preferredSide);
    const mappedRaw = mappedStepIndexForTheme(theme);
    if (Number.isInteger(mappedRaw) && mappedRaw >= 0 && mappedRaw < steps.length) {
      if (!preferred) return mappedRaw;
      const mappedSide = normalizeSide(steps[mappedRaw]?.side, steps[mappedRaw]?.fenBefore);
      if (mappedSide === preferred) return mappedRaw;
    }
    const start = anchorIdx >= 0 ? anchorIdx : 0;
    const matches = [];
    for (let i = start; i < steps.length; i++) {
      if (stepThemesAt(i).includes(theme)) matches.push(i);
    }
    for (let i = 0; i < start; i++) {
      if (stepThemesAt(i).includes(theme)) matches.push(i);
    }
    if (!matches.length) return -1;
    if (preferred) {
      for (const idx of matches) {
        const stepSide = normalizeSide(steps[idx]?.side, steps[idx]?.fenBefore);
        if (stepSide === preferred) return idx;
      }
    }
    return matches[0];
  };

  const appearedOnPreviousPlayerMove = (theme, idx) => {
    if (!steps.length || idx <= 0) return false;
    for (let i = idx - 1; i >= 0; i--) {
      const s = steps[i];
      const sSide = normalizeSide(s?.side, s?.fenBefore);
      if (sSide !== playerSide) continue;
      return stepThemesAt(i).includes(theme);
    }
    return false;
  };

  const ranked = tags.map((theme) => {
    const idx = findThemeStepIndex(
      theme,
      (preferPlayerSide && hasAnyThemeOnPlayerSide) ? playerSide : null
    );
    const step = idx >= 0 ? steps[idx] : null;
    const scoreParts = [];
    const specificityRaw = Number(specificityMap?.[theme]);
    let score = Number.isFinite(specificityRaw)
      ? specificityRaw
      : (PRIMARY_THEME_SPECIFICITY[theme] || 100);
    scoreParts.push({ key: 'specificity', value: score });

    if (preferPlayerSide && hasAnyThemeOnPlayerSide) {
      const onPlayerSide = themeAppearsOnSide(theme, playerSide);
      const sideBias = onPlayerSide ? playerSideBias : opponentSidePenalty;
      score += sideBias;
      scoreParts.push({
        key: onPlayerSide ? 'playerSideBias' : 'opponentSidePenalty',
        value: sideBias
      });
    }

    if (idx >= 0) {
      const playerPly = countPlayerPlyAtIndex(steps, idx, playerSide);
      const immediacy = Math.max(0, immediacyBase - ((playerPly - 1) * immediacyStepPenalty));
      score += immediacy;
      scoreParts.push({ key: 'immediacy', value: immediacy });
      if (latePlyPenaltyEnabled && playerPly > 1) {
        const growth = Math.max(1.0, latePlyPenaltyGrowth);
        const factor = Math.max(0, latePlyPenaltyFactor);
        const cap = Math.max(0, latePlyPenaltyCap);
        const rawPenalty = factor * (Math.pow(growth, playerPly - 1) - 1);
        const latePenalty = Math.min(cap, Math.max(0, rawPenalty));
        if (latePenalty > 0) {
          score -= latePenalty;
          scoreParts.push({ key: 'latePlyPenalty', value: -latePenalty });
        }
      }
      if (playerPly === 1 && firstPlayerPlyBonus !== 0) {
        score += firstPlayerPlyBonus;
        scoreParts.push({ key: 'firstPlayerPlyBonus', value: firstPlayerPlyBonus });
      }

      if (idx === anchorIdx) {
        score += anchorBonus;
        scoreParts.push({ key: 'anchor', value: anchorBonus });
      } else if (anchorIdx >= 0) {
        const distance = Math.abs(idx - anchorIdx);
        const proximity = Math.max(0, proximityBase - (distance * proximityStepPenalty));
        score += proximity;
        scoreParts.push({ key: 'proximity', value: proximity });
      }

      const stale = appearedOnPreviousPlayerMove(theme, idx);
      const freshness = stale ? staleThemePenalty : freshnessBonus;
      score += freshness;
      scoreParts.push({ key: 'freshness', value: freshness });

      const givesCheck = !!(step?.boardAfter && step?.side && step?.boardAfter.checkerCount(normalizeSide(step.side, step.fenBefore) === 'w' ? 'b' : 'w') > 0);
      if (givesCheck && forcingCheckBonus !== 0) {
        score += forcingCheckBonus;
        scoreParts.push({ key: 'forcingCheck', value: forcingCheckBonus });
      }

      const stepToIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(2, 4));
      const stepFromIdx = step?.boardBefore?.sqToIdx?.(String(step?.uci || '').slice(0, 2));
      const capturedVal = step?.capturedPiece
        ? effectivePieceValue(step.capturedPiece, Number.isInteger(stepToIdx) ? stepToIdx : null)
        : 0;
      const movedVal = step?.movedPiece
        ? effectivePieceValue(step.movedPiece, Number.isInteger(stepFromIdx) ? stepFromIdx : null)
        : 0;
      if (capturedVal > 0) {
        const capScore = Math.min(captureValueCap, (capturedVal * captureValueScale));
        score += capScore;
        scoreParts.push({ key: 'captureValue', value: capScore });
      }
      const net = capturedVal - movedVal;
      if (net > 0) {
        const netScore = Math.min(netMaterialCap, net * netMaterialScale);
        score += netScore;
        scoreParts.push({ key: 'netMaterial', value: netScore });
      }

      const cumulative = Number(step?.cumulativeDelta) || 0;
      if (cumulative > 0) {
        const payoff = Math.min(payoffCap, cumulative * payoffScale);
        score += payoff;
        scoreParts.push({ key: 'payoff', value: payoff });
      }

      if (Number.isInteger(detail?.payoffIndex) && detail.payoffIndex >= 0) {
        if (idx <= detail.payoffIndex) {
          score += beforePayoffBonus;
          scoreParts.push({ key: 'beforePayoff', value: beforePayoffBonus });
        } else {
          score += afterPayoffPenalty;
          scoreParts.push({ key: 'afterPayoff', value: afterPayoffPenalty });
        }
      }

      if (
        immediateRecapturePenalty !== 0 &&
        isImmediateEvenOrWorseRecapture(detail, idx, playerSide) &&
        RECAPTURE_SENSITIVE_THEMES.has(theme)
      ) {
        score -= immediateRecapturePenalty;
        scoreParts.push({ key: 'immediateRecapturePenalty', value: -immediateRecapturePenalty });
      }
    }

    return {
      theme,
      score,
      stepIndex: idx,
      playerPly: idx >= 0 ? countPlayerPlyAtIndex(steps, idx, playerSide) : Number.MAX_SAFE_INTEGER,
      scoreParts,
    };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.playerPly !== b.playerPly) return a.playerPly - b.playerPly;
    const aLabel = String(THEME_LABELS[a.theme] || a.theme || '');
    const bLabel = String(THEME_LABELS[b.theme] || b.theme || '');
    return aLabel.localeCompare(bLabel);
  });

  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const gap = top ? (top.score - (second ? second.score : (top.score - 24))) : 0;
  const ambiguous = !!(top && second && gap < margin);
  let confidence = 0.58 + (gap / 70);
  if (!second) confidence = 0.95;
  if (top && top.score < 120) confidence -= 0.08;
  if (ambiguous) confidence -= 0.14;
  confidence = clamp01(confidence);

  return {
    theme: top?.theme || null,
    confidence,
    ambiguous,
    gap,
    ranked,
    stepIndex: Number.isInteger(top?.stepIndex) ? top.stepIndex : -1,
  };
}

export function resolvePrimaryTheme(detectedThemes, detail, side, options = null) {
  return resolvePrimaryThemeDetailed(detectedThemes, detail, side, options).theme || null;
}

/* ================================================================== */
/*  Detailed detection (returns step-level data for UI)                */
/* ================================================================== */

/**
 * Enhanced theme detection returning step-level diagnostic data.
 */
export function detectThemesDetailed(mistake) {
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
    previousMove: null,
  };
  if (!mistake || !mistake.fen || !mistake.best) return empty;

  const bestUci = normalizeBestMove(mistake);
  if (!bestUci) return empty;

  const side     = normalizeSide(mistake.side, mistake.fen);
  const bestLine = Array.isArray(mistake.bestLine) && mistake.bestLine.length
    ? mistake.bestLine : null;

  if (bestLine) {
    const cappedLine = bestLine.slice(0, 20);
    const steps = walkPV(mistake.fen, cappedLine, side);
    if (!steps.length) return empty;
    if (typeof mistake._prevFen === 'string' && typeof mistake._prevPlayedMove === 'string') {
      try {
        steps[0]._prevFen = mistake._prevFen;
        steps[0]._prevPlayedMove = mistake._prevPlayedMove;
      } catch {}
    }
    const sacrificePath = steps;

    const themes = detectThemes(mistake);
    const isMate = pvEndsMate(steps);
    const payoff = findPayoffStep(steps);
    const payoffIndex = payoff ? steps.indexOf(payoff) : -1;
    const sacrificeInfo = detectSacrificeInPVDetails(sacrificePath, side, pvEndsMate(sacrificePath), { mistake });
    const sacrificeStepIndex = (
      sacrificeInfo.isSacrifice &&
      Number.isInteger(sacrificeInfo.triggerStepIndex) &&
      sacrificeInfo.triggerStepIndex >= 0 &&
      sacrificeInfo.triggerStepIndex < steps.length
    )
      ? sacrificeInfo.triggerStepIndex
      : -1;

    // Find the most interesting step for UI
    let themeStepIndex = -1;
    if (isMate) {
      themeStepIndex = steps.length - 1;
    } else if (payoffIndex >= 0) {
      themeStepIndex = payoffIndex;
      // Check if setup step is more interesting
      if (payoffIndex > 0 && steps[payoffIndex - 1].side === side) {
        const setupTactics = detectTacticsAtStep(steps[payoffIndex - 1], side, {
          steps,
          previousFen: typeof mistake._prevFen === 'string' ? mistake._prevFen : null,
          previousMove: typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null,
        });
        if (setupTactics.length > 0) themeStepIndex = payoffIndex - 1;
      }
    } else {
      // Use first player step that has a tactical theme
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].side !== side) continue;
        const stepTactics = detectTacticsAtStep(steps[i], side, {
          steps,
          previousFen: typeof mistake._prevFen === 'string' ? mistake._prevFen : null,
          previousMove: typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null,
        });
        if (stepTactics.length > 0) { themeStepIndex = i; break; }
      }
      if (themeStepIndex < 0) themeStepIndex = 0;
    }

    // For deflection, anchor to the triggering decoy/forcing move, not the
    // later payoff capture.
    if (Array.isArray(themes) && themes.includes(THEMES.DEFLECTION)) {
      const deflectionIdx = findDeflectionAnchorIndex(steps, side);
      if (deflectionIdx >= 0) themeStepIndex = deflectionIdx;
    }

    const themeStepIndexByTheme = {};
    const anchor = (Number.isInteger(themeStepIndex) && themeStepIndex >= 0 && themeStepIndex < steps.length)
      ? themeStepIndex
      : 0;
    const priorFen = typeof mistake._prevFen === 'string' ? mistake._prevFen : null;
    const priorMove = typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null;
    const stepThemeCache = new Map();
    const getStepThemes = (idx) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) return [];
      if (stepThemeCache.has(idx)) return stepThemeCache.get(idx);
      let tactical = [];
      try {
        const step = steps[idx];
        const stepSide = normalizeSide(step?.side, step?.fenBefore) || side;
        tactical = filterToTactical(detectTacticsAtStep(step, stepSide, {
          steps,
          previousFen: priorFen,
          previousMove: priorMove,
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
        if (theme === THEMES.MATE_THREAT) {
          idx = findMateThreatStepIndex(steps, side);
        } else if (theme === THEMES.CAPTURING_DEFENDER) {
          idx = findCapturingDefenderAnchorIndex(steps, side);
        } else if (theme === THEMES.SACRIFICE && Number.isInteger(sacrificeStepIndex) && sacrificeStepIndex >= 0 && sacrificeStepIndex < steps.length) {
          idx = sacrificeStepIndex;
        } else {
          for (const stepIdx of ordered) {
            const stepSide = normalizeSide(steps[stepIdx]?.side, steps[stepIdx]?.fenBefore);
            if (stepSide !== side) continue;
            if (getStepThemes(stepIdx).includes(theme)) {
              idx = stepIdx;
              break;
            }
          }
        }
        if (Number.isInteger(idx) && idx >= 0 && idx < steps.length) {
          themeStepIndexByTheme[theme] = idx;
        }
      }
    }

    return {
      themes, steps, themeStepIndex,
      themeStepIndexByTheme,
      themeUci: steps[themeStepIndex]?.uci || null,
      payoffIndex, isMate, sacrificeStepIndex,
      previousFen: typeof mistake._prevFen === 'string' ? mistake._prevFen : null,
      previousMove: typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null,
    };
  }

  // Legacy fallback (no PV)
  const boardBefore = ChessPrimitives(mistake.fen);
  const cl = ChessLite();
  cl.loadFEN(mistake.fen);
  const mv = cl.moveUci(bestUci);
  if (!mv || !mv.ok) return empty;
  const fenAfter = cl.fen();
  const boardAfter = ChessPrimitives(fenAfter);
  const fromIdx    = boardBefore.sqToIdx(bestUci.slice(0, 2));
  const toIdx      = boardBefore.sqToIdx(bestUci.slice(2, 4));
  const movedPiece = boardBefore.pieceAt(fromIdx);
  const capturedPc = boardBefore.pieceAt(toIdx);

  const themes = detectThemes(mistake);
  const legacyStep = { uci: bestUci, fenBefore: mistake.fen, fenAfter, movedPiece, capturedPiece: capturedPc, materialDelta: 0, cumulativeDelta: 0, side, boardBefore, boardAfter };
  if (typeof mistake._prevFen === 'string' && typeof mistake._prevPlayedMove === 'string') {
    legacyStep._prevFen = mistake._prevFen;
    legacyStep._prevPlayedMove = mistake._prevPlayedMove;
  }
  const legacyThemeMap = {};
  if (Array.isArray(themes)) {
    for (const t of themes) legacyThemeMap[t] = 0;
  }
  return {
    themes,
    steps: [legacyStep],
    themeStepIndex: themes.length ? 0 : -1,
    themeStepIndexByTheme: legacyThemeMap,
    themeUci: themes.length ? bestUci : null,
    payoffIndex: -1,
    isMate: false,
    sacrificeStepIndex: -1,
    previousFen: typeof mistake._prevFen === 'string' ? mistake._prevFen : null,
    previousMove: typeof mistake._prevPlayedMove === 'string' ? mistake._prevPlayedMove : null,
  };
}

/**
 * Enhanced allowed-theme detection with step-level data.
 */
export function detectAllowedThemesDetailed(fenAfterBadMove, refutationPV, opponentSide, options = null) {
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
    previousMove: null,
  };
  if (!fenAfterBadMove || !Array.isArray(refutationPV) || !refutationPV.length || !opponentSide) return empty;
  const deltaCp = typeof options === 'number'
    ? options
    : (options && typeof options.deltaCp === 'number' ? options.deltaCp : null);
  const prevFen = options && typeof options === 'object' && typeof options.previousFen === 'string'
    ? options.previousFen
    : null;
  const prevPlayedMove = options && typeof options === 'object' && typeof options.playedMove === 'string'
    ? options.playedMove
    : null;
  const cpBefore = options && typeof options === 'object' && typeof options.cpBefore === 'number'
    ? options.cpBefore
    : null;
  const cpAfter = options && typeof options === 'object' && typeof options.cpAfter === 'number'
    ? options.cpAfter
    : null;
  const sacrificeIntentCp = options && typeof options === 'object' && typeof options._sacrificeIntentCp === 'number'
    ? options._sacrificeIntentCp
    : null;

  const syntheticMistake = {
    fen: fenAfterBadMove,
    side: normalizeSide(opponentSide, fenAfterBadMove),
    best: refutationPV[0],
    bestLine: refutationPV,
    deltaCp,
    _prevFen: prevFen,
    _prevPlayedMove: prevPlayedMove,
  };
  if (cpBefore !== null) syntheticMistake.cpBefore = cpBefore;
  if (cpAfter !== null) syntheticMistake.cpAfter = cpAfter;
  if (sacrificeIntentCp !== null) syntheticMistake._sacrificeIntentCp = sacrificeIntentCp;

  return detectThemesDetailed(syntheticMistake);
}

export { walkPV, findPayoffStep, pvEndsMate, detectTacticsAtStep };
