// Chess engine: board representation, legal move generation, AI.
// Board: 8x8 array, row 0 = rank 1 (white back rank), row 7 = rank 8 (black back rank).
// Columns 0-7 = files a-h. Pieces: 'wP','wN','wB','wR','wQ','wK','bP',...

const FILES = 'abcdefgh';

function initialState() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    board[0][c] = 'w' + back[c];
    board[1][c] = 'wP';
    board[6][c] = 'bP';
    board[7][c] = 'b' + back[c];
  }
  return {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null, // {r,c} square that can be captured en passant
    halfmove: 0,
    fullmove: 1,
  };
}

function cloneState(s) {
  return {
    board: s.board.map((row) => row.slice()),
    turn: s.turn,
    castling: { ...s.castling },
    ep: s.ep ? { ...s.ep } : null,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
  };
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function color(piece) {
  return piece ? piece[0] : null;
}
function ptype(piece) {
  return piece ? piece[1] : null;
}
function opponent(c) {
  return c === 'w' ? 'b' : 'w';
}

function sq(r, c) {
  return FILES[c] + (r + 1);
}

const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [-1, 2], [-2, 1],
  [1, -2], [2, -1], [-1, -2], [-2, -1],
];
const KING_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function isSquareAttacked(board, r, c, byColor) {
  // pawns
  const pawnRowDir = byColor === 'w' ? -1 : 1; // square to check relative to attacker origin
  for (const dc of [-1, 1]) {
    const pr = r + pawnRowDir, pc = c + dc;
    if (inBounds(pr, pc) && board[pr][pc] === byColor + 'P') return true;
  }
  // knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'N') return true;
  }
  // king
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'K') return true;
  }
  // sliding: rook/queen
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (color(p) === byColor && (ptype(p) === 'R' || ptype(p) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  // sliding: bishop/queen
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (color(p) === byColor && (ptype(p) === 'B' || ptype(p) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function findKing(board, col) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === col + 'K') return { r, c };
  return null;
}

function isInCheck(state, col) {
  const k = findKing(state.board, col);
  if (!k) return false;
  return isSquareAttacked(state.board, k.r, k.c, opponent(col));
}

// Generate pseudo-legal moves for the piece at (r,c). Does not filter for self-check.
function pseudoMovesForSquare(state, r, c) {
  const { board } = state;
  const piece = board[r][c];
  if (!piece) return [];
  const col = color(piece);
  const t = ptype(piece);
  const moves = [];

  const addMove = (tr, tc, extra = {}) => {
    moves.push({ from: { r, c }, to: { r: tr, c: tc }, piece, captured: board[tr][tc], ...extra });
  };

  if (t === 'P') {
    const dir = col === 'w' ? 1 : -1;
    const startRow = col === 'w' ? 1 : 6;
    const promoRow = col === 'w' ? 7 : 0;
    // single push
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      if (r + dir === promoRow) {
        for (const promo of ['Q', 'R', 'B', 'N']) addMove(r + dir, c, { promotion: promo });
      } else {
        addMove(r + dir, c);
      }
      // double push
      if (r === startRow && !board[r + 2 * dir][c]) {
        addMove(r + 2 * dir, c, { flag: 'double' });
      }
    }
    // captures
    for (const dc of [-1, 1]) {
      const tr = r + dir, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (target && color(target) !== col) {
        if (tr === promoRow) {
          for (const promo of ['Q', 'R', 'B', 'N']) addMove(tr, tc, { promotion: promo });
        } else {
          addMove(tr, tc);
        }
      } else if (!target && state.ep && state.ep.r === tr && state.ep.c === tc) {
        addMove(tr, tc, { flag: 'ep' });
      }
    }
  } else if (t === 'N') {
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const tr = r + dr, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (!target || color(target) !== col) addMove(tr, tc);
    }
  } else if (t === 'K') {
    for (const [dr, dc] of KING_OFFSETS) {
      const tr = r + dr, tc = c + dc;
      if (!inBounds(tr, tc)) continue;
      const target = board[tr][tc];
      if (!target || color(target) !== col) addMove(tr, tc);
    }
    // castling
    const rights = state.castling;
    const homeRow = col === 'w' ? 0 : 7;
    if (r === homeRow && c === 4 && !isSquareAttacked(board, r, c, opponent(col))) {
      // king side
      if ((col === 'w' ? rights.wK : rights.bK) &&
          !board[homeRow][5] && !board[homeRow][6] &&
          board[homeRow][7] === col + 'R' &&
          !isSquareAttacked(board, homeRow, 5, opponent(col)) &&
          !isSquareAttacked(board, homeRow, 6, opponent(col))) {
        addMove(homeRow, 6, { flag: 'castleK' });
      }
      // queen side
      if ((col === 'w' ? rights.wQ : rights.bQ) &&
          !board[homeRow][3] && !board[homeRow][2] && !board[homeRow][1] &&
          board[homeRow][0] === col + 'R' &&
          !isSquareAttacked(board, homeRow, 3, opponent(col)) &&
          !isSquareAttacked(board, homeRow, 2, opponent(col))) {
        addMove(homeRow, 2, { flag: 'castleQ' });
      }
    }
  } else {
    const dirs = t === 'B' ? BISHOP_DIRS : t === 'R' ? ROOK_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [dr, dc] of dirs) {
      let tr = r + dr, tc = c + dc;
      while (inBounds(tr, tc)) {
        const target = board[tr][tc];
        if (!target) {
          addMove(tr, tc);
        } else {
          if (color(target) !== col) addMove(tr, tc);
          break;
        }
        tr += dr; tc += dc;
      }
    }
  }
  return moves;
}

function allPseudoMoves(state, col) {
  const moves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c] && color(state.board[r][c]) === col)
        moves.push(...pseudoMovesForSquare(state, r, c));
  return moves;
}

function applyMove(state, move) {
  const s = cloneState(state);
  const { board } = s;
  const col = color(move.piece);
  const t = ptype(move.piece);
  const { from, to } = move;

  // reset ep, set new one only on double push
  s.ep = null;

  // halfmove clock
  if (t === 'P' || move.captured) s.halfmove = 0;
  else s.halfmove++;

  // en passant capture removes the pawn behind the target square
  if (move.flag === 'ep') {
    board[from.r][to.c] = null;
  }

  board[from.r][from.c] = null;
  board[to.r][to.c] = move.promotion ? col + move.promotion : move.piece;

  // castling: move rook too
  if (move.flag === 'castleK') {
    const homeRow = from.r;
    board[homeRow][5] = col + 'R';
    board[homeRow][7] = null;
  } else if (move.flag === 'castleQ') {
    const homeRow = from.r;
    board[homeRow][3] = col + 'R';
    board[homeRow][0] = null;
  }

  if (move.flag === 'double') {
    s.ep = { r: (from.r + to.r) / 2, c: from.c };
  }

  // update castling rights
  if (t === 'K') {
    if (col === 'w') { s.castling.wK = false; s.castling.wQ = false; }
    else { s.castling.bK = false; s.castling.bQ = false; }
  }
  const clearRookRight = (r, c) => {
    if (r === 0 && c === 0) s.castling.wQ = false;
    if (r === 0 && c === 7) s.castling.wK = false;
    if (r === 7 && c === 0) s.castling.bQ = false;
    if (r === 7 && c === 7) s.castling.bK = false;
  };
  clearRookRight(from.r, from.c);
  clearRookRight(to.r, to.c);

  if (col === 'b') s.fullmove++;
  s.turn = opponent(col);
  return s;
}

function legalMoves(state, col) {
  const pseudo = allPseudoMoves(state, col);
  const legal = [];
  for (const m of pseudo) {
    const next = applyMove(state, m);
    if (!isInCheck(next, col)) legal.push(m);
  }
  return legal;
}

function gameStatus(state) {
  const col = state.turn;
  const moves = legalMoves(state, col);
  const inCheck = isInCheck(state, col);
  if (moves.length === 0) {
    return inCheck ? { over: true, result: opponent(col) + '_wins', reason: 'checkmate' } : { over: true, result: 'draw', reason: 'stalemate' };
  }
  if (state.halfmove >= 100) return { over: true, result: 'draw', reason: 'fifty-move rule' };
  return { over: false, inCheck, moves };
}

// ---------- AI ----------
const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Simple piece-square tables (white perspective; row0=rank1). Mirrored for black.
const PST = {
  P: [
    [0,0,0,0,0,0,0,0],
    [5,10,10,-10,-10,10,10,5],
    [5,-5,-10,0,0,-10,-5,5],
    [0,0,0,20,20,0,0,0],
    [5,5,10,25,25,10,5,5],
    [10,10,20,30,30,20,10,10],
    [50,50,50,50,50,50,50,50],
    [0,0,0,0,0,0,0,0],
  ],
  N: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,0,5,5,0,-20,-40],
    [-30,5,10,15,15,10,5,-30],
    [-30,0,15,20,20,15,0,-30],
    [-30,5,15,20,20,15,5,-30],
    [-30,0,10,15,15,10,0,-30],
    [-40,-20,0,0,0,0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
  ],
  B: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,5,0,0,0,0,5,-10],
    [-10,10,10,10,10,10,10,-10],
    [-10,0,10,10,10,10,0,-10],
    [-10,5,5,10,10,5,5,-10],
    [-10,0,5,10,10,5,0,-10],
    [-10,0,0,0,0,0,0,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
  ],
  R: [
    [0,0,0,5,5,0,0,0],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [5,10,10,10,10,10,10,5],
    [0,0,0,0,0,0,0,0],
  ],
  Q: [
    [-20,-10,-10,-5,-5,-10,-10,-20],
    [-10,0,5,0,0,0,0,-10],
    [-10,5,5,5,5,5,0,-10],
    [0,0,5,5,5,5,0,-5],
    [-5,0,5,5,5,5,0,-5],
    [-10,0,5,5,5,5,0,-10],
    [-10,0,0,0,0,0,0,-10],
    [-20,-10,-10,-5,-5,-10,-10,-20],
  ],
  K: [
    [20,30,10,0,0,10,30,20],
    [20,20,0,0,0,0,20,20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
  ],
};

function evaluate(state) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const col = color(p), t = ptype(p);
      const pstRow = col === 'w' ? r : 7 - r;
      const val = PIECE_VALUES[t] + PST[t][pstRow][c];
      score += col === 'w' ? val : -val;
    }
  }
  return score; // positive favors white
}

function negamax(state, depth, alpha, beta, sign) {
  const col = state.turn;
  const moves = legalMoves(state, col);
  if (moves.length === 0) {
    const inCheck = isInCheck(state, col);
    if (inCheck) return -100000 - depth; // checkmate, worse the sooner found favored
    return 0; // stalemate
  }
  if (depth === 0) return sign * evaluate(state);

  // simple move ordering: captures first
  moves.sort((a, b) => (b.captured ? PIECE_VALUES[ptype(b.captured)] : 0) - (a.captured ? PIECE_VALUES[ptype(a.captured)] : 0));

  let best = -Infinity;
  for (const m of moves) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, -sign);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function chooseAIMove(state, depth) {
  const col = state.turn;
  const sign = col === 'w' ? 1 : -1;
  const moves = legalMoves(state, col);
  if (moves.length === 0) return null;
  moves.sort((a, b) => (b.captured ? PIECE_VALUES[ptype(b.captured)] : 0) - (a.captured ? PIECE_VALUES[ptype(a.captured)] : 0));
  let best = null, bestVal = -Infinity;
  let alpha = -Infinity, beta = Infinity;
  const scored = [];
  for (const m of moves) {
    const next = applyMove(state, m);
    const val = -negamax(next, depth - 1, -beta, -alpha, -sign);
    scored.push({ m, val });
    if (val > bestVal) { bestVal = val; best = m; }
    if (bestVal > alpha) alpha = bestVal;
  }
  // add slight randomness among near-best moves for variety / lower difficulty feel
  const top = scored.filter((s) => s.val >= bestVal - 15);
  return top[Math.floor(Math.random() * top.length)].m;
}

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(state, state.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    nodes += perft(applyMove(state, m), depth - 1);
  }
  return nodes;
}

const api = {
  initialState, cloneState, legalMoves, applyMove, gameStatus, isInCheck,
  pseudoMovesForSquare, chooseAIMove, evaluate, perft, sq, color, ptype, opponent,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ChessEngine = api;
