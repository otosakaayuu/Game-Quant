const E = window.ChessEngine;

const GLYPH = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

let state = E.initialState();
let playerColor = 'w';
let aiDepth = 2;
let selected = null;
let legalForSelected = [];
let lastMove = null;
let history = [];
let gameOver = false;
let aiThinking = false;

const boardEl = document.getElementById('board');
const statusTextEl = document.getElementById('statusText');
const turnDotEl = document.getElementById('turnDot');
const turnBannerEl = document.getElementById('turnBanner');
const materialRowEl = document.getElementById('materialRow');
const moveLogEl = document.getElementById('moveLog');
const capturedTopEl = document.getElementById('capturedTop');
const capturedBottomEl = document.getElementById('capturedBottom');
const newGameBtn = document.getElementById('newGameBtn');
const colorSeg = document.getElementById('colorSeg');
const diffSeg = document.getElementById('diffSeg');

const PIECE_WORTH = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const FILE_LETTERS = 'abcdefgh';

function squareColor(r, c) { return (r + c) % 2 === 0 ? 'dark' : 'light'; }

function render() {
  boardEl.innerHTML = '';
  const displayRows = playerColor === 'w' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const displayCols = playerColor === 'w' ? [...Array(8).keys()] : [...Array(8).keys()].reverse();

  const status = E.gameStatus(state);
  const checkKingSq = status.inCheck ? findKingSquare(state.turn) : null;

  for (const r of displayRows) {
    for (const c of displayCols) {
      const sqEl = document.createElement('div');
      sqEl.className = `square ${squareColor(r, c)}`;
      sqEl.dataset.r = r; sqEl.dataset.c = c;

      if (lastMove && ((lastMove.from.r === r && lastMove.from.c === c) || (lastMove.to.r === r && lastMove.to.c === c))) {
        sqEl.classList.add('last-move');
      }
      if (selected && selected.r === r && selected.c === c) sqEl.classList.add('selected');
      if (checkKingSq && checkKingSq.r === r && checkKingSq.c === c) sqEl.classList.add('in-check');

      if (c === displayCols[0]) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = r + 1;
        sqEl.appendChild(rankLabel);
      }
      if (r === displayRows[displayRows.length - 1]) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = FILE_LETTERS[c];
        sqEl.appendChild(fileLabel);
      }

      const piece = state.board[r][c];
      if (piece) {
        const span = document.createElement('span');
        span.className = piece[0] === 'w' ? 'piece-w' : 'piece-b';
        if (lastMove && lastMove.to.r === r && lastMove.to.c === c) span.classList.add('piece-moving');
        span.textContent = GLYPH[piece];
        sqEl.appendChild(span);
      }

      const moveHere = legalForSelected.find((m) => m.to.r === r && m.to.c === c);
      if (moveHere) {
        if (piece) {
          const ring = document.createElement('div');
          ring.className = 'capture-ring';
          sqEl.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'dot';
          sqEl.appendChild(dot);
        }
      }

      sqEl.addEventListener('click', () => onSquareClick(r, c));
      boardEl.appendChild(sqEl);
    }
  }

  renderCaptured();
  renderMoveLog();
  renderStatus(status);
  renderMaterial();
}

function findKingSquare(col) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c] === col + 'K') return { r, c };
  return null;
}

function renderStatus(status) {
  turnBannerEl.classList.remove('danger');
  if (status.over) {
    gameOver = true;
    turnDotEl.style.display = 'none';
    if (status.result === 'draw') statusTextEl.textContent = `Draw — ${status.reason}`;
    else {
      const winner = status.result.startsWith('w') ? 'White' : 'Black';
      statusTextEl.textContent = `Checkmate — ${winner} wins`;
      turnBannerEl.classList.add('danger');
    }
    return;
  }
  turnDotEl.style.display = 'inline-block';
  turnDotEl.classList.toggle('black', state.turn === 'b');
  if (aiThinking) { statusTextEl.textContent = 'Computer is thinking…'; return; }
  const turnName = state.turn === 'w' ? 'White' : 'Black';
  statusTextEl.textContent = status.inCheck ? `${turnName} to move — in check` : `${turnName} to move`;
  if (status.inCheck) turnBannerEl.classList.add('danger');
}

function renderMaterial() {
  let white = 0, black = 0;
  for (const h of history) {
    if (h.move.captured) {
      const worth = PIECE_WORTH[E.ptype(h.move.captured)] || 0;
      if (E.color(h.move.captured) === 'w') black += worth; else white += worth;
    }
  }
  const diff = white - black;
  if (diff === 0) { materialRowEl.textContent = 'Material even'; return; }
  const leader = diff > 0 ? 'White' : 'Black';
  materialRowEl.innerHTML = `<span class="adv">${leader} is up ${Math.abs(diff)} point${Math.abs(diff) > 1 ? 's' : ''} of material</span>`;
}

function renderCaptured() {
  const captured = { w: [], b: [] };
  for (const h of history) {
    if (h.move.captured) {
      const capColor = h.move.captured[0];
      captured[capColor].push(GLYPH[h.move.captured]);
    }
  }
  // captured white pieces shown on black's side row and vice versa
  capturedTopEl.textContent = captured[playerColor === 'w' ? 'b' : 'w'].join(' ');
  capturedBottomEl.textContent = captured[playerColor === 'w' ? 'w' : 'b'].join(' ');
}

function renderMoveLog() {
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    const num = i / 2 + 1;
    const whiteSan = history[i] ? history[i].san : '';
    const blackSan = history[i + 1] ? history[i + 1].san : '';
    html += `<div><span class="num">${num}.</span><span class="mv">${whiteSan}</span><span class="mv">${blackSan}</span></div>`;
  }
  moveLogEl.innerHTML = html;
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

function toSAN(move, before) {
  const file = E.sq(move.to.r, move.to.c);
  if (move.flag === 'castleK') return 'O-O';
  if (move.flag === 'castleQ') return 'O-O-O';
  const pieceLetter = move.piece[1] === 'P' ? '' : move.piece[1];
  const capture = move.captured || move.flag === 'ep' ? 'x' : '';
  let from = '';
  if (move.piece[1] === 'P' && capture) from = 'abcdefgh'[move.from.c];
  const promo = move.promotion ? '=' + move.promotion : '';
  return `${pieceLetter}${from}${capture}${file}${promo}`;
}

function onSquareClick(r, c) {
  if (gameOver || aiThinking) return;
  if (state.turn !== playerColor) return;

  const piece = state.board[r][c];

  if (selected) {
    const move = legalForSelected.find((m) => m.to.r === r && m.to.c === c);
    if (move) {
      if (move.promotion && move.promotion !== 'Q') return; // handled via modal pick below
      const promoMoves = legalForSelected.filter((m) => m.to.r === r && m.to.c === c && m.promotion);
      if (promoMoves.length > 1) {
        showPromotionModal(promoMoves);
        return;
      }
      playMove(move);
      return;
    }
    if (piece && piece[0] === playerColor) {
      selectSquare(r, c);
    } else {
      selected = null; legalForSelected = []; render();
    }
  } else if (piece && piece[0] === playerColor) {
    selectSquare(r, c);
  }
}

function selectSquare(r, c) {
  selected = { r, c };
  const all = E.legalMoves(state, playerColor);
  legalForSelected = all.filter((m) => m.from.r === r && m.from.c === c);
  render();
}

function showPromotionModal(promoMoves) {
  const modal = document.createElement('div');
  modal.className = 'promo-modal';
  const box = document.createElement('div');
  box.className = 'promo-box';
  for (const m of promoMoves) {
    const btn = document.createElement('button');
    btn.textContent = GLYPH[playerColor + m.promotion];
    btn.addEventListener('click', () => {
      document.body.removeChild(modal);
      playMove(m);
    });
    box.appendChild(btn);
  }
  modal.appendChild(box);
  document.body.appendChild(modal);
}

function playMove(move) {
  const san = toSAN(move, state);
  state = E.applyMove(state, move);
  history.push({ move, san });
  lastMove = move;
  selected = null;
  legalForSelected = [];
  render();

  const status = E.gameStatus(state);
  if (status.over) { render(); return; }

  if (state.turn !== playerColor) {
    aiThinking = true;
    render();
    setTimeout(aiTurn, 350);
  }
}

function aiTurn() {
  const move = E.chooseAIMove(state, aiDepth);
  aiThinking = false;
  if (!move) { render(); return; }
  const san = toSAN(move, state);
  state = E.applyMove(state, move);
  history.push({ move, san });
  lastMove = move;
  render();
}

function newGame() {
  state = E.initialState();
  selected = null;
  legalForSelected = [];
  lastMove = null;
  history = [];
  gameOver = false;
  aiThinking = false;
  render();
  if (playerColor === 'b') {
    aiThinking = true;
    render();
    setTimeout(aiTurn, 350);
  }
}

colorSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...colorSeg.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  playerColor = btn.dataset.color;
  newGame();
});

diffSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...diffSeg.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  aiDepth = parseInt(btn.dataset.depth, 10);
});

newGameBtn.addEventListener('click', newGame);

render();
