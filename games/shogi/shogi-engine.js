// Shogi engine. Board: 9x9, row0 = sente's back rank, row8 = gote's back rank.
// Sente ('b') moves toward increasing row; Gote ('w') moves toward decreasing row.
// Piece strings: color + type, e.g. 'bP', 'w+R'. Types: K,R,B,G,S,N,L,P and promoted +R,+B,+S,+N,+L,+P.

const PROMOTABLE = ['R', 'B', 'S', 'N', 'L', 'P'];
const HAND_TYPES = ['P', 'L', 'N', 'S', 'G', 'B', 'R'];

function initialState() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  const backRow = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];
  for (let c = 0; c < 9; c++) {
    board[0][c] = 'b' + backRow[c];
    board[8][c] = 'w' + backRow[c];
    board[2][c] = 'bP';
    board[6][c] = 'wP';
  }
  board[1][1] = 'bB'; board[1][7] = 'bR';
  board[7][1] = 'wR'; board[7][7] = 'wB';
  return {
    board,
    turn: 'b',
    hands: { b: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 }, w: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 } },
  };
}

function cloneState(s) {
  return {
    board: s.board.map((row) => row.slice()),
    turn: s.turn,
    hands: { b: { ...s.hands.b }, w: { ...s.hands.w } },
  };
}

function inBounds(r, c) { return r >= 0 && r < 9 && c >= 0 && c < 9; }
function color(p) { return p ? p[0] : null; }
function ptype(p) { return p ? p.slice(1) : null; }
function opponent(c) { return c === 'b' ? 'w' : 'b'; }
function isPromoted(t) { return t[0] === '+'; }
function baseType(t) { return isPromoted(t) ? t.slice(1) : t; }

function promotionZone(r, col) {
  return col === 'b' ? r >= 6 : r <= 2;
}
function farRank(r, col) {
  return col === 'b' ? r === 8 : r === 0;
}
function farTwoRanks(r, col) {
  return col === 'b' ? r >= 7 : r <= 1;
}

// Movement offsets. fwd = +1 for sente, -1 for gote.
function steppingOffsets(type, col) {
  const f = col === 'b' ? 1 : -1;
  switch (type) {
    case 'K': return [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    case 'G': case '+P': case '+L': case '+N': case '+S':
      return [[f,-1],[f,0],[f,1],[0,-1],[0,1],[-f,0]];
    case 'S': return [[f,-1],[f,0],[f,1],[-f,-1],[-f,1]];
    case 'N': return [[2*f,-1],[2*f,1]];
    case 'P': return [[f,0]];
    default: return [];
  }
}
function slidingDirs(type) {
  switch (type) {
    case 'L': return null; // handled with forward-only sliding, special-cased
    case 'R': case '+R': return [[1,0],[-1,0],[0,1],[0,-1]];
    case 'B': case '+B': return [[1,1],[1,-1],[-1,1],[-1,-1]];
    default: return [];
  }
}
function extraStepsForPromotedSlider(type) {
  if (type === '+R') return [[1,1],[1,-1],[-1,1],[-1,-1]];
  if (type === '+B') return [[1,0],[-1,0],[0,1],[0,-1]];
  return [];
}

function pieceMovesOnBoard(board, r, c, includePromotionVariants) {
  const piece = board[r][c];
  if (!piece) return [];
  const col = color(piece);
  const t = ptype(piece);
  const moves = [];
  const tryTarget = (tr, tc) => {
    if (!inBounds(tr, tc)) return;
    const target = board[tr][tc];
    if (target && color(target) === col) return;
    pushMoveWithPromotion(moves, r, c, tr, tc, piece, target, includePromotionVariants);
  };

  if (t === 'L') {
    const f = col === 'b' ? 1 : -1;
    let tr = r + f, tc = c;
    while (inBounds(tr, tc)) {
      const target = board[tr][tc];
      if (!target) { tryTarget(tr, tc); }
      else { if (color(target) !== col) tryTarget(tr, tc); break; }
      tr += f;
    }
    return moves;
  }

  const dirs = slidingDirs(t);
  if (dirs && dirs.length) {
    for (const [dr, dc] of dirs) {
      let tr = r + dr, tc = c + dc;
      while (inBounds(tr, tc)) {
        const target = board[tr][tc];
        if (!target) { tryTarget(tr, tc); }
        else { if (color(target) !== col) tryTarget(tr, tc); break; }
        tr += dr; tc += dc;
      }
    }
    for (const [dr, dc] of extraStepsForPromotedSlider(t)) {
      tryTarget(r + dr, c + dc);
    }
    return moves;
  }

  for (const [dr, dc] of steppingOffsets(t, col)) {
    tryTarget(r + dr, c + dc);
  }
  return moves;
}

function pushMoveWithPromotion(moves, fr, fc, tr, tc, piece, captured, includePromotionVariants) {
  const col = color(piece);
  const t = ptype(piece);
  const base = baseType(t);
  const promotable = PROMOTABLE.includes(base) && !isPromoted(t);
  const fromZone = promotionZone(fr, col);
  const toZone = promotionZone(tr, col);
  const canPromote = promotable && (fromZone || toZone);
  const mustPromote = promotable && (
    (base === 'P' || base === 'L') ? farRank(tr, col) :
    base === 'N' ? farTwoRanks(tr, col) : false
  );

  if (!includePromotionVariants) {
    moves.push({ kind: 'move', from: { r: fr, c: fc }, to: { r: tr, c: tc }, piece, captured, promote: mustPromote });
    return;
  }

  if (mustPromote) {
    moves.push({ kind: 'move', from: { r: fr, c: fc }, to: { r: tr, c: tc }, piece, captured, promote: true });
  } else if (canPromote) {
    moves.push({ kind: 'move', from: { r: fr, c: fc }, to: { r: tr, c: tc }, piece, captured, promote: true });
    moves.push({ kind: 'move', from: { r: fr, c: fc }, to: { r: tr, c: tc }, piece, captured, promote: false });
  } else {
    moves.push({ kind: 'move', from: { r: fr, c: fc }, to: { r: tr, c: tc }, piece, captured, promote: false });
  }
}

function findKing(board, col) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] === col + 'K') return { r, c };
  return null;
}

// Is square (r,c) attacked by `byColor`'s board pieces?
function isSquareAttacked(board, r, c, byColor) {
  for (let pr = 0; pr < 9; pr++) {
    for (let pc = 0; pc < 9; pc++) {
      const p = board[pr][pc];
      if (!p || color(p) !== byColor) continue;
      const moves = pieceMovesOnBoard(board, pr, pc, false);
      for (const m of moves) {
        if (m.to.r === r && m.to.c === c) return true;
      }
    }
  }
  return false;
}

function isInCheck(state, col) {
  const k = findKing(state.board, col);
  if (!k) return false;
  return isSquareAttacked(state.board, k.r, k.c, opponent(col));
}

function applyMove(state, move) {
  const s = cloneState(state);
  const { board, hands } = s;
  if (move.kind === 'move') {
    const col = color(move.piece);
    board[move.from.r][move.from.c] = null;
    let newPiece = move.piece;
    if (move.promote) newPiece = col + '+' + baseType(ptype(move.piece));
    if (move.captured) {
      const capBase = baseType(ptype(move.captured));
      hands[col][capBase]++;
    }
    board[move.to.r][move.to.c] = newPiece;
  } else if (move.kind === 'drop') {
    const col = color2(move.piece_color_type);
    board[move.to.r][move.to.c] = move.piece_color_type;
    hands[move.piece_color_type[0]][move.dropType]--;
  }
  s.turn = opponent(s.turn);
  return s;
}
function color2(p) { return p[0]; }

function legalBoardMoves(state, col) {
  const { board } = state;
  const pseudo = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c] && color(board[r][c]) === col)
        pseudo.push(...pieceMovesOnBoard(board, r, c, true));
  const legal = [];
  for (const m of pseudo) {
    const next = applyMove(state, m);
    if (!isInCheck(next, col)) legal.push(m);
  }
  return legal;
}

function legalDropMoves(state, col) {
  const { board, hands } = state;
  const moves = [];
  for (const type of HAND_TYPES) {
    if (hands[col][type] <= 0) continue;
    // pawn-file restriction (nifu): can't drop if an unpromoted pawn of same color already on that file
    let nifuFiles = null;
    if (type === 'P') {
      nifuFiles = new Set();
      for (let r = 0; r < 9; r++) if (board[r] && board[r].some) {}
      for (let c = 0; c < 9; c++) {
        for (let r = 0; r < 9; r++) {
          if (board[r][c] === col + 'P') { nifuFiles.add(c); break; }
        }
      }
    }
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c]) continue;
        if (type === 'P' && nifuFiles.has(c)) continue;
        if ((type === 'P' || type === 'L') && farRank(r, col)) continue;
        if (type === 'N' && farTwoRanks(r, col)) continue;
        const move = { kind: 'drop', to: { r, c }, piece_color_type: col + type, dropType: type };
        const next = applyMove(state, move);
        if (isInCheck(next, col)) continue; // illegal: leaves own king in check (rare)
        if (type === 'P') {
          // uchifuzume: illegal if this drop checkmates the opponent
          if (isInCheck(next, opponent(col))) {
            const oppMoves = legalMovesAll(next, opponent(col));
            if (oppMoves.length === 0) continue;
          }
        }
        moves.push(move);
      }
    }
  }
  return moves;
}

function legalMovesAll(state, col) {
  return [...legalBoardMoves(state, col), ...legalDropMoves(state, col)];
}

function gameStatus(state) {
  const col = state.turn;
  const moves = legalMovesAll(state, col);
  const inCheck = isInCheck(state, col);
  if (moves.length === 0) {
    return inCheck
      ? { over: true, result: opponent(col) + '_wins', reason: 'checkmate' }
      : { over: true, result: 'draw', reason: 'no legal moves' };
  }
  return { over: false, inCheck, moves };
}

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMovesAll(state, state.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) nodes += perft(applyMove(state, m), depth - 1);
  return nodes;
}

// ---------- AI ----------
const VALUES = { P: 100, L: 300, N: 350, S: 550, G: 600, B: 850, R: 950, K: 20000,
  '+P': 500, '+L': 550, '+N': 550, '+S': 600, '+B': 1100, '+R': 1200 };

function evaluate(state) {
  let score = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const v = VALUES[ptype(p)] || 0;
      score += color(p) === 'b' ? v : -v;
    }
  }
  for (const t of HAND_TYPES) {
    score += state.hands.b[t] * (VALUES[t] || 0) * 0.9;
    score -= state.hands.w[t] * (VALUES[t] || 0) * 0.9;
  }
  return score;
}

function moveScore(m) {
  let s = m.captured ? (VALUES[ptype(m.captured)] || 0) * 10 : 0;
  if (m.promote) s += 40;
  if (m.kind === 'drop') s += 2;
  return s;
}

// Breadth-capped negamax: at each node only the top `cap` moves (by quick heuristic
// ordering) are explored. Shogi's drop rule means legal-move counts can spike into
// the hundreds, so capping branching (rather than only depth) keeps search bounded
// no matter how many pieces are sitting in hand.
function negamax(state, depth, alpha, beta, sign, cap) {
  if (depth === 0) return sign * evaluate(state);
  const col = state.turn;
  let moves = legalMovesAll(state, col);
  if (moves.length === 0) {
    return isInCheck(state, col) ? -100000 - depth : 0;
  }
  moves.sort((a, b) => moveScore(b) - moveScore(a));
  if (moves.length > cap) moves = moves.slice(0, cap);
  let best = -Infinity;
  for (const m of moves) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, -sign, cap);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function chooseAIMove(state, depth) {
  const col = state.turn;
  const sign = col === 'b' ? 1 : -1;
  const moves = legalMovesAll(state, col);
  if (moves.length === 0) return null;
  moves.sort((a, b) => moveScore(b) - moveScore(a));
  // Root keeps every legal move (correctness for the move actually played);
  // only the recursive search below the root is breadth-capped for speed.
  const cap = depth >= 3 ? 10 : depth === 2 ? 18 : 40;
  let alpha = -Infinity, beta = Infinity, bestVal = -Infinity;
  const scored = [];
  for (const m of moves) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, -sign, cap);
    scored.push({ m, val });
    if (val > bestVal) bestVal = val;
    if (bestVal > alpha) alpha = bestVal;
  }
  const top = scored.filter((s) => s.val >= bestVal - 15);
  return top[Math.floor(Math.random() * top.length)].m;
}

const api = {
  initialState, cloneState, legalMovesAll, legalBoardMoves, legalDropMoves,
  applyMove, gameStatus, isInCheck, chooseAIMove, evaluate, perft,
  color, ptype, opponent, baseType, isPromoted, HAND_TYPES, promotionZone,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ShogiEngine = api;
