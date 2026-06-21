const P = window.PokerEngine;

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const START_STACK = 1000;

const NAMES = ['You', 'Bot Sari', 'Bot Doni', 'Bot Rina', 'Bot Bayu', 'Bot Citra'];
// per-bot personality: higher raiseFreq/lower callThreshold => looser/more aggressive
const PERSONALITY = [
  null,
  { aggression: 1.25, callSlack: 0.05, raiseFreq: 0.5, bluffFreq: 0.12 }, // Sari: loose-aggressive
  { aggression: 0.75, callSlack: -0.04, raiseFreq: 0.22, bluffFreq: 0.03 }, // Doni: tight-passive
  { aggression: 1.0, callSlack: 0.0, raiseFreq: 0.35, bluffFreq: 0.07 }, // Rina: balanced
  { aggression: 1.15, callSlack: -0.06, raiseFreq: 0.45, bluffFreq: 0.05 }, // Bayu: tight-aggressive
  { aggression: 0.85, callSlack: 0.08, raiseFreq: 0.2, bluffFreq: 0.1 }, // Citra: loose-passive
];

let players = [];
let dealerSeat = -1;
let community = [];
let deck = [];
let phase = 'idle'; // idle, preflop, flop, turn, river, showdown
let currentBet = 0;
let lastRaiseSize = BIG_BLIND;
let roundQueue = [];
let handLog = [];
let handNumber = 0;
let resultText = '';
let acting = false; // true while a bot is "thinking" / awaiting human input
let revealAll = false;

const tableEl = document.getElementById('table');
const startBtn = document.getElementById('startBtn');
const foldBtn = document.getElementById('foldBtn');
const checkCallBtn = document.getElementById('checkCallBtn');
const betRaiseBtn = document.getElementById('betRaiseBtn');
const betSlider = document.getElementById('betSlider');
const betAmountEl = document.getElementById('betAmount');
const actionPanel = document.getElementById('actionPanel');
const resultEl = document.getElementById('resultText');
const logEl = document.getElementById('logPanel');
const equityWrap = document.getElementById('equityWrap');
const equityBarWin = document.getElementById('equityBarWin');
const equityBarTie = document.getElementById('equityBarTie');
const equityBarLose = document.getElementById('equityBarLose');
const equityText = document.getElementById('equityText');
const potOddsText = document.getElementById('potOddsText');
const equityToggle = document.getElementById('equityToggle');
const presetBtns = [...document.querySelectorAll('.preset-btn')];

function initPlayers() {
  players = NAMES.map((name, i) => ({
    seat: i, name, isHuman: i === 0, stack: START_STACK, hole: [],
    folded: false, allIn: false, roundBet: 0, contributed: 0, lastAction: '',
  }));
}

function log(msg) { handLog.push(msg); }

function totalPot() { return players.reduce((s, p) => s + p.contributed, 0); }

function activeNonFolded() { return players.filter((p) => !p.folded); }

function startHand() {
  handNumber++;
  community = [];
  deck = P.shuffle(P.freshDeck());
  resultText = '';
  revealAll = false;
  handLog = [];
  currentBet = 0;
  lastRaiseSize = BIG_BLIND;

  for (const p of players) {
    if (p.stack <= 0) { p.stack = START_STACK; log(`${p.name} re-buys for ${START_STACK}.`); }
    p.hole = [deck.pop(), deck.pop()];
    p.folded = false; p.allIn = false; p.roundBet = 0; p.contributed = 0; p.lastAction = '';
  }

  dealerSeat = (dealerSeat + 1) % 6;
  const sbSeat = (dealerSeat + 1) % 6;
  const bbSeat = (dealerSeat + 2) % 6;
  postBet(sbSeat, SMALL_BLIND);
  postBet(bbSeat, BIG_BLIND);
  currentBet = BIG_BLIND;
  phase = 'preflop';
  log(`Hand #${handNumber} — dealer: ${players[dealerSeat].name}`);
  log(`${players[sbSeat].name} posts small blind (${SMALL_BLIND}), ${players[bbSeat].name} posts big blind (${BIG_BLIND}).`);

  buildRoundQueue((dealerSeat + 3) % 6);
  render();
  processNext();
}

function postBet(seatIdx, amount) {
  const p = players[seatIdx];
  const a = Math.min(amount, p.stack);
  p.stack -= a; p.roundBet += a; p.contributed += a;
  if (p.stack === 0) p.allIn = true;
}

function buildRoundQueue(startSeat) {
  const q = [];
  for (let i = 0; i < 6; i++) {
    const idx = (startSeat + i) % 6;
    const p = players[idx];
    if (!p.folded && !p.allIn) q.push(idx);
  }
  roundQueue = q;
}

function processNext() {
  const remaining = activeNonFolded();
  if (remaining.length <= 1) { awardUncontested(); return; }

  if (roundQueue.length === 0) { advancePhase(); return; }

  const seatIdx = roundQueue[0];
  const p = players[seatIdx];

  if (p.isHuman) {
    acting = true;
    render();
  } else {
    acting = false;
    render();
    setTimeout(() => {
      const action = botDecide(p);
      applyAction(seatIdx, action);
      render();
      setTimeout(processNext, 280);
    }, 500 + Math.random() * 500);
  }
}

function applyAction(seatIdx, action) {
  const p = players[seatIdx];
  if (action.type === 'fold') {
    p.folded = true; p.lastAction = 'Fold';
    log(`${p.name} folds.`);
    roundQueue = roundQueue.filter((s) => s !== seatIdx);
  } else if (action.type === 'check') {
    p.lastAction = 'Check';
    log(`${p.name} checks.`);
    roundQueue = roundQueue.filter((s) => s !== seatIdx);
  } else if (action.type === 'call') {
    const amt = Math.min(currentBet - p.roundBet, p.stack);
    p.stack -= amt; p.roundBet += amt; p.contributed += amt;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = p.allIn ? `All-in (${p.roundBet})` : `Call ${amt}`;
    log(`${p.name} ${p.allIn ? 'calls all-in for ' + amt : 'calls ' + amt}.`);
    roundQueue = roundQueue.filter((s) => s !== seatIdx);
  } else if (action.type === 'bet' || action.type === 'raise') {
    const target = Math.min(action.amount, p.roundBet + p.stack);
    const delta = target - p.roundBet;
    p.stack -= delta; p.roundBet += delta; p.contributed += delta;
    if (p.stack === 0) p.allIn = true;
    const increment = target - currentBet;
    if (increment > 0) lastRaiseSize = Math.max(increment, BIG_BLIND);
    currentBet = Math.max(currentBet, target);
    p.lastAction = p.allIn ? `All-in (${target})` : (action.type === 'bet' ? `Bet ${target}` : `Raise to ${target}`);
    log(`${p.name} ${action.type === 'bet' ? 'bets' : 'raises to'} ${target}${p.allIn ? ' (all-in)' : ''}.`);
    roundQueue = [];
    const startAfter = (seatIdx + 1) % 6;
    for (let i = 0; i < 6; i++) {
      const idx = (startAfter + i) % 6;
      const other = players[idx];
      if (idx !== seatIdx && !other.folded && !other.allIn) roundQueue.push(idx);
    }
  }
}

function advancePhase() {
  const canAct = players.filter((p) => !p.folded && !p.allIn).length;
  for (const p of players) p.roundBet = 0;
  currentBet = 0;
  lastRaiseSize = BIG_BLIND;

  if (phase === 'preflop') { phase = 'flop'; community.push(deck.pop(), deck.pop(), deck.pop()); log(`Flop: ${community.slice(0,3).map(P.cardStr).join(' ')}`); }
  else if (phase === 'flop') { phase = 'turn'; community.push(deck.pop()); log(`Turn: ${P.cardStr(community[3])}`); }
  else if (phase === 'turn') { phase = 'river'; community.push(deck.pop()); log(`River: ${P.cardStr(community[4])}`); }
  else if (phase === 'river') { doShowdown(); return; }

  if (canAct <= 1) {
    // everyone (or all but one) is all-in: just run the board out with a pause between cards
    render();
    setTimeout(advancePhase, 700);
    return;
  }

  buildRoundQueue((dealerSeat + 1) % 6);
  render();
  processNext();
}

function handEvalLabel(hole) {
  const res = P.evaluateBest7([...hole, ...community]);
  return P.CATEGORY_NAME[res.cat];
}

function doShowdown() {
  revealAll = true;
  const potPlayers = players.map((p) => ({ id: p.seat, contributed: p.contributed, folded: p.folded }));
  const pots = P.computeSidePots(potPlayers);
  const results = [];

  for (const pot of pots) {
    const eligible = players.filter((p) => pot.eligible.includes(p.seat));
    let best = null, winners = [];
    for (const p of eligible) {
      const res = P.evaluateBest7([...p.hole, ...community]);
      if (!best || P.compareHandResult(res, best) > 0) { best = res; winners = [p]; }
      else if (P.compareHandResult(res, best) === 0) { winners.push(p); }
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      w.stack += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
    }
    results.push(`Pot of ${pot.amount}: ${winners.map((w) => w.name).join(', ')} win${winners.length > 1 ? '' : 's'} with ${P.CATEGORY_NAME[best.cat]}.`);
  }

  resultText = results.join(' ');
  for (const r of results) log(r);
  render();
}

function awardUncontested() {
  const winner = activeNonFolded()[0];
  const pot = totalPot();
  winner.stack += pot;
  resultText = `${winner.name} wins ${pot} chips (everyone else folded).`;
  log(resultText);
  phase = 'showdown';
  render();
}

// ---------- Bot AI ----------
function botDecide(p) {
  const pers = PERSONALITY[p.seat];
  const callCost = currentBet - p.roundBet;
  const potBefore = totalPot();
  const numOpponents = activeNonFolded().filter((x) => x.seat !== p.seat).length;

  let strength;
  if (community.length === 0) {
    strength = P.preflopHeuristic(p.hole) / 100;
  } else {
    const eq = P.estimateEquity(p.hole, community, numOpponents, 500);
    strength = eq.win + eq.tie * 0.5;
  }
  strength = Math.min(1, strength * pers.aggression);

  const maxTarget = p.roundBet + p.stack;

  if (callCost <= 0) {
    const wantsBet = strength > 0.6 && Math.random() < pers.raiseFreq;
    const bluffs = Math.random() < pers.bluffFreq * 0.4;
    if (wantsBet || bluffs) {
      const sizeFrac = 0.45 + Math.random() * 0.4;
      const target = Math.min(maxTarget, Math.round((potBefore * sizeFrac) / 10) * 10 || BIG_BLIND);
      return { type: 'bet', amount: Math.max(target, BIG_BLIND) };
    }
    return { type: 'check' };
  }

  const requiredEquity = callCost / (potBefore + callCost);
  const threshold = requiredEquity + pers.callSlack;

  if (strength < threshold - 0.1) {
    if (Math.random() < 0.05) return { type: 'call' }; // occasional loose call
    return { type: 'fold' };
  }
  if (strength > 0.72 && Math.random() < pers.raiseFreq) {
    const target = Math.min(maxTarget, currentBet + Math.max(lastRaiseSize, Math.round(potBefore * 0.6 / 10) * 10));
    if (target > currentBet) return { type: 'raise', amount: target };
  }
  return { type: 'call' };
}

// ---------- Rendering ----------
function cardEl(card, faceUp, big) {
  const div = document.createElement('div');
  if (!faceUp) { div.className = 'card back' + (big ? ' big' : ''); return div; }
  const isRed = card.s === 'h' || card.s === 'd';
  div.className = `card ${isRed ? 'red' : 'black'}${big ? ' big' : ''}`;
  const suitChar = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.s];
  div.innerHTML = `<div class="r">${P.rankChar(card.r)}</div><div class="s">${suitChar}</div>`;
  return div;
}

function render() {
  // seats
  for (let i = 0; i < 6; i++) {
    const p = players[i];
    const seatEl = document.getElementById(`seat-${i}`);
    seatEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'seat-card' + (p.folded ? ' folded' : '') + (p.isHuman ? ' you-seat' : '') + (acting && roundQueue[0] === i ? ' active-turn' : '');

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = p.isHuman ? 'Y' : p.name.replace('Bot ', '')[0];
    nameRow.appendChild(avatar);
    if (i === dealerSeat) { const d = document.createElement('span'); d.className = 'dealer-chip'; d.textContent = 'D'; nameRow.appendChild(d); }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = p.name;
    nameRow.appendChild(nameSpan);

    const stackDiv = document.createElement('div');
    stackDiv.className = 'stack';
    stackDiv.textContent = p.stack + ' chips';

    const betRow = document.createElement('div');
    betRow.className = 'bet-row';
    if (p.roundBet > 0) betRow.appendChild(chipStackEl(p.roundBet));

    const actionDiv = document.createElement('div');
    actionDiv.className = 'action-tag' + (p.lastAction && /call|check|bet|raise|all-in/i.test(p.lastAction) ? ' positive' : '');
    actionDiv.textContent = p.folded ? '' : (p.lastAction || '');

    const holeDiv = document.createElement('div');
    holeDiv.className = 'hole-cards';
    if (p.hole.length) {
      const faceUp = p.isHuman || revealAll && !p.folded;
      for (const c of p.hole) holeDiv.appendChild(cardEl(c, faceUp, false));
    }

    card.appendChild(nameRow);
    card.appendChild(stackDiv);
    card.appendChild(betRow);
    card.appendChild(holeDiv);
    card.appendChild(actionDiv);
    if (p.folded) { const stamp = document.createElement('div'); stamp.className = 'fold-stamp'; stamp.textContent = 'Folded'; card.appendChild(stamp); }
    seatEl.appendChild(card);
  }

  // community + pot
  const commEl = document.getElementById('communityCards');
  commEl.innerHTML = '';
  for (const c of community) commEl.appendChild(cardEl(c, true, true));
  document.getElementById('potLabel').textContent = `Pot: ${totalPot()} chips`;

  // result + log
  resultEl.innerHTML = resultText ? `<span class="banner">${resultText}</span>` : '';
  logEl.innerHTML = handLog.map((l) => `<div>${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;

  // action panel visibility
  const human = players[0];
  const humanTurn = acting && phase !== 'showdown' && roundQueue[0] === 0 && !human.folded;
  actionPanel.style.display = humanTurn ? 'flex' : 'none';
  startBtn.style.display = (phase === 'idle' || phase === 'showdown') ? 'inline-flex' : 'none';
  startBtn.textContent = phase === 'idle' ? 'Deal first hand' : 'Next hand';

  if (humanTurn) {
    const callCost = currentBet - human.roundBet;
    checkCallBtn.textContent = callCost <= 0 ? 'Check' : `Call ${callCost}`;
    checkCallBtn.disabled = callCost > human.stack && callCost > 0 ? false : false;
    const minRaiseTo = currentBet === 0 ? BIG_BLIND : currentBet + lastRaiseSize;
    const maxTo = human.roundBet + human.stack;
    betSlider.min = Math.min(minRaiseTo, maxTo);
    betSlider.max = maxTo;
    betSlider.step = 10;
    if (parseInt(betSlider.value, 10) < betSlider.min || !betSlider.value) betSlider.value = betSlider.min;
    betAmountEl.textContent = betSlider.value;
    betRaiseBtn.textContent = currentBet === 0 ? `Bet ${betSlider.value}` : `Raise to ${betSlider.value}`;
    betRaiseBtn.disabled = maxTo <= currentBet;
  }

  renderEquity();
}

function chipStackEl(amount) {
  const wrap = document.createElement('div');
  wrap.className = 'chip-stack';
  const icons = document.createElement('div');
  icons.className = 'chip-icons';
  const n = Math.min(4, Math.max(1, Math.ceil(amount / 50)));
  for (let i = 0; i < n; i++) { const c = document.createElement('span'); c.className = 'c'; icons.appendChild(c); }
  const amt = document.createElement('span');
  amt.className = 'amt';
  amt.textContent = amount;
  wrap.appendChild(icons);
  wrap.appendChild(amt);
  return wrap;
}

function renderEquity() {
  const human = players[0];
  if (!equityToggle.checked || phase === 'idle' || human.folded || !human.hole.length) {
    equityWrap.style.display = 'none';
    return;
  }
  equityWrap.style.display = 'block';
  const numOpponents = activeNonFolded().filter((x) => x.seat !== 0).length;
  if (numOpponents === 0) { equityWrap.style.display = 'none'; return; }
  const eq = P.estimateEquity(human.hole, community, numOpponents, 700);
  const winPct = eq.win * 100, tiePct = eq.tie * 100, losePct = eq.lose * 100;
  equityBarWin.style.width = winPct + '%';
  equityBarTie.style.width = tiePct + '%';
  equityBarLose.style.width = losePct + '%';
  equityText.textContent = `Win ${winPct.toFixed(1)}% · Tie ${tiePct.toFixed(1)}% · Lose ${losePct.toFixed(1)}%`;

  const callCost = currentBet - human.roundBet;
  if (callCost > 0) {
    const potBefore = totalPot();
    const required = (callCost / (potBefore + callCost)) * 100;
    const yourEq = winPct + tiePct * 0.5;
    const verdict = yourEq >= required ? 'profitable call by equity' : 'unprofitable call by equity';
    potOddsText.textContent = `Pot odds need ${required.toFixed(1)}% equity to call — you have ~${yourEq.toFixed(1)}% (${verdict}).`;
  } else {
    potOddsText.textContent = 'No bet facing you — free to see the next card.';
  }
}

// ---------- Event wiring ----------
startBtn.addEventListener('click', startHand);

foldBtn.addEventListener('click', () => {
  if (!acting) return;
  acting = false;
  applyAction(0, { type: 'fold' });
  render();
  setTimeout(processNext, 200);
});

checkCallBtn.addEventListener('click', () => {
  if (!acting) return;
  acting = false;
  const human = players[0];
  const callCost = currentBet - human.roundBet;
  applyAction(0, callCost <= 0 ? { type: 'check' } : { type: 'call' });
  render();
  setTimeout(processNext, 200);
});

betRaiseBtn.addEventListener('click', () => {
  if (!acting) return;
  acting = false;
  const amount = parseInt(betSlider.value, 10);
  applyAction(0, { type: currentBet === 0 ? 'bet' : 'raise', amount });
  render();
  setTimeout(processNext, 200);
});

betSlider.addEventListener('input', () => {
  betAmountEl.textContent = betSlider.value;
  betRaiseBtn.textContent = currentBet === 0 ? `Bet ${betSlider.value}` : `Raise to ${betSlider.value}`;
});

presetBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const human = players[0];
    const pot = totalPot();
    const maxTo = human.roundBet + human.stack;
    let target;
    if (btn.dataset.preset === 'half') target = currentBet + Math.round(pot * 0.5 / 10) * 10;
    else if (btn.dataset.preset === 'pot') target = currentBet + Math.round(pot / 10) * 10;
    else target = maxTo; // all-in
    target = Math.max(parseInt(betSlider.min, 10), Math.min(target, maxTo));
    betSlider.value = target;
    betAmountEl.textContent = target;
    betRaiseBtn.textContent = currentBet === 0 ? `Bet ${target}` : `Raise to ${target}`;
  });
});

equityToggle.addEventListener('change', renderEquity);

initPlayers();
render();
