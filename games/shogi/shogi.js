const E = window.ShogiEngine;

const GLYPH = {
  K: '王', G: '金', S: '銀', N: '桂', L: '香', P: '歩', R: '飛', B: '角',
  '+S': '全', '+N': '圭', '+L': '杏', '+P': 'と', '+R': '龍', '+B': '馬',
};
const GOTE_KING_GLYPH = '玉';
const FILES_LABEL = '987654321';

let state = E.initialState();
let playerColor = 'b';
let aiDepth = 2;
let selected = null; // {kind:'board', r, c} or {kind:'hand', type}
let legalForSelected = [];
let lastMove = null;
let history = [];
let gameOver = false;
let aiThinking = false;

const boardEl = document.getElementById('board');
const statusTextEl = document.getElementById('statusText');
const turnDotEl = document.getElementById('turnDot');
const turnBannerEl = document.getElementById('turnBanner');
const moveLogEl = document.getElementById('moveLog');
const handTopEl = document.getElementById('handTop');
const handBottomEl = document.getElementById('handBottom');
const newGameBtn = document.getElementById('newGameBtn');
const colorSeg = document.getElementById('colorSeg');
const diffSeg = document.getElementById('diffSeg');

function glyphFor(piece) {
  const t = E.ptype(piece);
  if (t === 'K') return E.color(piece) === 'b' ? GLYPH.K : GOTE_KING_GLYPH;
  return GLYPH[t];
}

function render() {
  const opponentColor = playerColor === 'b' ? 'w' : 'b';
  renderHand(opponentColor, handTopEl, true);
  renderHand(playerColor, handBottomEl, false);

  boardEl.innerHTML = '';
  const rowsOrder = playerColor === 'b' ? [...Array(9).keys()].reverse() : [...Array(9).keys()];
  const colsOrder = playerColor === 'b' ? [...Array(9).keys()] : [...Array(9).keys()].reverse();

  const status = E.gameStatus(state);
  const checkKingSq = status.inCheck ? findKingSquare(state.turn) : null;

  for (const r of rowsOrder) {
    for (const c of colsOrder) {
      const sqEl = document.createElement('div');
      sqEl.className = 'square';
      sqEl.dataset.r = r; sqEl.dataset.c = c;
      if (E.promotionZone(r, 'b')) sqEl.classList.add('promo-zone-b');
      else if (E.promotionZone(r, 'w')) sqEl.classList.add('promo-zone-w');

      if (lastMove && lastMove.to && lastMove.to.r === r && lastMove.to.c === c) sqEl.classList.add('last-move');
      if (lastMove && lastMove.from && lastMove.from.r === r && lastMove.from.c === c) sqEl.classList.add('last-move');
      if (selected && selected.kind === 'board' && selected.r === r && selected.c === c) sqEl.classList.add('selected');
      if (checkKingSq && checkKingSq.r === r && checkKingSq.c === c) sqEl.classList.add('in-check');

      if (c === colsOrder[0]) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = r + 1;
        sqEl.appendChild(rankLabel);
      }
      if (r === rowsOrder[rowsOrder.length - 1]) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = FILES_LABEL[c];
        sqEl.appendChild(fileLabel);
      }

      const piece = state.board[r][c];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece' + (E.color(piece) === 'w' ? ' gote' : '') + (E.isPromoted(E.ptype(piece)) ? ' promoted' : '');
        if (lastMove && lastMove.to && lastMove.to.r === r && lastMove.to.c === c) span.classList.add('piece-moving');
        span.textContent = glyphFor(piece);
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

  renderMoveLog();
  renderStatus(status);
}

function findKingSquare(col) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.board[r][c] === col + 'K') return { r, c };
  return null;
}

function renderHand(col, el, isOpponentRow) {
  el.innerHTML = '';
  el.className = 'hand-row' + (col === 'w' ? ' gote' : '');
  for (const type of E.HAND_TYPES) {
    const count = state.hands[col][type];
    const div = document.createElement('div');
    div.className = 'hand-piece' + (count === 0 ? ' empty' : '');
    if (selected && selected.kind === 'hand' && selected.type === type && selected.col === col) div.classList.add('selected');
    const glyphSpan = document.createElement('div');
    glyphSpan.textContent = GLYPH[type];
    const countSpan = document.createElement('div');
    countSpan.className = 'count';
    countSpan.textContent = 'x' + count;
    div.appendChild(glyphSpan);
    div.appendChild(countSpan);
    if (count > 0 && col === playerColor) {
      div.addEventListener('click', () => onHandClick(col, type));
    }
    el.appendChild(div);
  }
}

function renderStatus(status) {
  turnBannerEl.classList.remove('danger');
  if (status.over) {
    gameOver = true;
    turnDotEl.style.display = 'none';
    if (status.result === 'draw') statusTextEl.textContent = `Draw — ${status.reason}`;
    else {
      const winner = status.result.startsWith('b') ? 'Sente (black)' : 'Gote (white)';
      statusTextEl.textContent = `Checkmate — ${winner} wins`;
      turnBannerEl.classList.add('danger');
    }
    return;
  }
  turnDotEl.style.display = 'inline-block';
  turnDotEl.classList.toggle('gote', state.turn === 'w');
  if (aiThinking) { statusTextEl.textContent = 'Computer is thinking…'; return; }
  const turnName = state.turn === 'b' ? 'Sente' : 'Gote';
  statusTextEl.textContent = status.inCheck ? `${turnName} to move — in check` : `${turnName} to move`;
  if (status.inCheck) turnBannerEl.classList.add('danger');
}

function squareLabel(r, c) {
  return FILES_LABEL[c] + (r + 1);
}

function moveToNotation(move) {
  if (move.kind === 'drop') {
    return `${GLYPH[move.dropType]}*${squareLabel(move.to.r, move.to.c)}`;
  }
  const g = glyphFor(move.piece);
  const promo = move.promote ? '+' : '';
  const cap = move.captured ? 'x' : '';
  return `${g}${cap}${squareLabel(move.to.r, move.to.c)}${promo}`;
}

function renderMoveLog() {
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    const num = i / 2 + 1;
    const a = history[i] ? moveToNotation(history[i]) : '';
    const b = history[i + 1] ? moveToNotation(history[i + 1]) : '';
    html += `<div><span class="num">${num}.</span><span class="mv">${a}</span><span class="mv">${b}</span></div>`;
  }
  moveLogEl.innerHTML = html;
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

function onHandClick(col, type) {
  if (gameOver || aiThinking || state.turn !== playerColor || col !== playerColor) return;
  selected = { kind: 'hand', type, col };
  const all = E.legalDropMoves(state, playerColor);
  legalForSelected = all.filter((m) => m.dropType === type);
  render();
}

function onSquareClick(r, c) {
  if (gameOver || aiThinking || state.turn !== playerColor) return;
  const piece = state.board[r][c];

  if (selected) {
    const candidates = legalForSelected.filter((m) => m.to.r === r && m.to.c === c);
    if (candidates.length === 1) { playMove(candidates[0]); return; }
    if (candidates.length === 2) { showPromotionModal(candidates); return; }
    if (piece && E.color(piece) === playerColor) { selectBoardSquare(r, c); return; }
    selected = null; legalForSelected = []; render();
  } else if (piece && E.color(piece) === playerColor) {
    selectBoardSquare(r, c);
  }
}

function selectBoardSquare(r, c) {
  selected = { kind: 'board', r, c };
  const all = E.legalBoardMoves(state, playerColor);
  legalForSelected = all.filter((m) => m.from.r === r && m.from.c === c);
  render();
}

function showPromotionModal(candidates) {
  const modal = document.createElement('div');
  modal.className = 'promo-modal';
  const box = document.createElement('div');
  box.className = 'promo-box';
  const label = document.createElement('div');
  label.style.color = 'var(--chalk-dim)';
  label.style.fontFamily = 'var(--mono)';
  label.style.fontSize = '0.8rem';
  label.textContent = 'Promote this piece?';
  box.appendChild(label);
  const opts = document.createElement('div');
  opts.className = 'options';
  for (const m of candidates) {
    const btn = document.createElement('button');
    const base = E.baseType(E.ptype(m.piece));
    btn.textContent = m.promote ? GLYPH['+' + base] : GLYPH[base];
    btn.addEventListener('click', () => {
      document.body.removeChild(modal);
      playMove(m);
    });
    opts.appendChild(btn);
  }
  box.appendChild(opts);
  modal.appendChild(box);
  document.body.appendChild(modal);
}

function playMove(move) {
  state = E.applyMove(state, move);
  history.push(move);
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
  state = E.applyMove(state, move);
  history.push(move);
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
  if (playerColor === 'w') {
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
