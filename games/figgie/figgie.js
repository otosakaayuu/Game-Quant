const F = window.FiggieEngine;

const ANTE = 50;
const PER_CARD_VALUE = 10;
const ROUND_SECONDS = 75;
const START_CHIPS = 300;
const NAMES = ['You', 'Bot Sari', 'Bot Doni', 'Bot Rina'];
const PERSONALITY = [
  null,
  { noise: 3, spread: 2, activity: 0.55 },
  { noise: 5, spread: 4, activity: 0.4 },
  { noise: 2, spread: 3, activity: 0.5 },
];

let players = [];
let market = {};
let goalSuit = null, shortSuit = null, trueCounts = null;
let pot = 0;
let roundActive = false;
let revealed = false;
let timeLeft = 0;
let timerHandle = null;
let botHandle = null;
let log = [];
let lastSummary = null;

const playersRowEl = document.getElementById('playersRow');
const marketGridEl = document.getElementById('marketGrid');
const timerEl = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const revealPanelEl = document.getElementById('revealPanel');
const logEl = document.getElementById('logPanel');

function initPlayers() {
  players = NAMES.map((name, i) => ({ idx: i, name, isHuman: i === 0, chips: START_CHIPS, hand: [] }));
}

function logMsg(m) { log.unshift(m); if (log.length > 60) log.pop(); }

function clearMarket() {
  market = { S: { bid: null, ask: null }, C: { bid: null, ask: null }, H: { bid: null, ask: null }, D: { bid: null, ask: null } };
}

function startRound() {
  for (const p of players) {
    if (p.chips < ANTE) { p.chips += START_CHIPS; logMsg(`${p.name} tops up with ${START_CHIPS} chips.`); }
    p.chips -= ANTE;
  }
  pot = ANTE * players.length;
  const round = F.buildRound();
  goalSuit = round.goalSuit; shortSuit = round.shortSuit; trueCounts = round.counts;
  for (let i = 0; i < 4; i++) players[i].hand = round.hands[i];
  clearMarket();
  revealed = false;
  lastSummary = null;
  log = [];
  logMsg('Round started. Antes collected, cards dealt. Trading is open.');
  timeLeft = ROUND_SECONDS;
  roundActive = true;

  if (timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) { clearInterval(timerHandle); endRound(); }
    render();
  }, 1000);

  if (botHandle) clearInterval(botHandle);
  botHandle = setInterval(botsTick, 750);

  render();
}

function endRound() {
  roundActive = false;
  revealed = true;
  if (botHandle) clearInterval(botHandle);
  clearMarket();

  const holdings = players.map((p) => p.hand.filter((s) => s === goalSuit).length);
  const result = F.computePayouts(holdings, pot, PER_CARD_VALUE);
  for (let i = 0; i < players.length; i++) players[i].chips += result.payouts[i];
  lastSummary = { holdings, result };

  logMsg(`Goal suit was ${F.SUIT_NAME[goalSuit]} ${F.SUIT_SYMBOL[goalSuit]} (12 in the deck). Short suit: ${F.SUIT_NAME[shortSuit]} ${F.SUIT_SYMBOL[shortSuit]} (8 in the deck).`);
  for (let i = 0; i < players.length; i++) {
    logMsg(`${players[i].name}: held ${holdings[i]} goal cards, paid ${result.payouts[i]} chips.`);
  }
  render();
}

// ---------- market actions ----------
function postBid(playerIdx, suit, price) {
  const p = players[playerIdx];
  if (price <= 0 || price > p.chips) return false;
  const cur = market[suit].bid;
  if (cur && cur.price >= price && cur.playerIdx !== playerIdx) return false;
  market[suit].bid = { price, playerIdx };
  return true;
}
function postAsk(playerIdx, suit, price) {
  const p = players[playerIdx];
  const held = p.hand.filter((s) => s === suit).length;
  if (held <= 0 || price <= 0) return false;
  const cur = market[suit].ask;
  if (cur && cur.price <= price && cur.playerIdx !== playerIdx) return false;
  market[suit].ask = { price, playerIdx };
  return true;
}
function buyAtAsk(playerIdx, suit) {
  const ask = market[suit].ask;
  if (!ask || ask.playerIdx === playerIdx) return false;
  const buyer = players[playerIdx], seller = players[ask.playerIdx];
  if (buyer.chips < ask.price) return false;
  const sellIdx = seller.hand.indexOf(suit);
  if (sellIdx === -1) { market[suit].ask = null; return false; }
  seller.hand.splice(sellIdx, 1);
  buyer.hand.push(suit);
  buyer.chips -= ask.price; seller.chips += ask.price;
  logMsg(`${buyer.name} buys ${F.SUIT_SYMBOL[suit]} from ${seller.name} for ${ask.price}.`);
  market[suit].ask = null;
  if (market[suit].bid && market[suit].bid.playerIdx === buyer.idx && buyer.hand.filter(s=>s===suit).length===0) {} // no-op
  return true;
}
function sellAtBid(playerIdx, suit) {
  const bid = market[suit].bid;
  if (!bid || bid.playerIdx === playerIdx) return false;
  const seller = players[playerIdx], buyer = players[bid.playerIdx];
  const sellIdx = seller.hand.indexOf(suit);
  if (sellIdx === -1) return false;
  if (buyer.chips < bid.price) { market[suit].bid = null; return false; }
  seller.hand.splice(sellIdx, 1);
  buyer.hand.push(suit);
  buyer.chips -= bid.price; seller.chips += bid.price;
  logMsg(`${seller.name} sells ${F.SUIT_SYMBOL[suit]} to ${buyer.name} for ${bid.price}.`);
  market[suit].bid = null;
  return true;
}

// ---------- bot heuristic trading ----------
function estimateValues(hand) {
  const counts = F.countBy(hand);
  const order = F.SUITS.slice().sort((a, b) => counts[b] - counts[a]);
  const values = {};
  // top-held suit looks most like the 12-count goal suit; bottom-held looks like the 8-count short suit
  values[order[0]] = 17;
  values[order[1]] = 9;
  values[order[2]] = 9;
  values[order[3]] = 2;
  return values;
}

function botsTick() {
  if (!roundActive) return;
  for (let i = 1; i < players.length; i++) {
    const pers = PERSONALITY[i];
    if (Math.random() > pers.activity) continue;
    botActOnce(i, pers);
  }
  render();
}

function botActOnce(playerIdx, pers) {
  const p = players[playerIdx];
  const values = estimateValues(p.hand);
  const counts = F.countBy(p.hand);
  const suits = F.SUITS.slice().sort(() => Math.random() - 0.5);

  for (const suit of suits) {
    const val = values[suit] + (Math.random() * 2 - 1) * pers.noise;
    const book = market[suit];

    // arbitrage: ask priced below my value -> buy
    if (book.ask && book.ask.playerIdx !== playerIdx && book.ask.price < val - 1 && p.chips >= book.ask.price) {
      buyAtAsk(playerIdx, suit);
      return;
    }
    // arbitrage: bid priced above my value, and I hold some -> sell
    if (book.bid && book.bid.playerIdx !== playerIdx && book.bid.price > val + 1 && counts[suit] > 0) {
      sellAtBid(playerIdx, suit);
      return;
    }
  }

  // otherwise, improve a quote on a random suit
  const suit = suits[0];
  const val = values[suit];
  if (counts[suit] > 1 && Math.random() < 0.5) {
    const price = Math.max(1, Math.round(val + pers.spread));
    if (!market[suit].ask || market[suit].ask.price > price) postAsk(playerIdx, suit, price);
  } else if (p.chips > val) {
    const price = Math.max(1, Math.round(val - pers.spread));
    if (!market[suit].bid || market[suit].bid.price < price) postBid(playerIdx, suit, price);
  }
}

// ---------- rendering ----------
function render() {
  timerEl.textContent = roundActive ? `${String(Math.floor(timeLeft / 60)).padStart(1, '0')}:${String(timeLeft % 60).padStart(2, '0')}` : revealed ? 'Round over' : 'Ready';
  timerEl.classList.toggle('urgent', roundActive && timeLeft <= 15);
  startBtn.textContent = revealed || (!roundActive && timeLeft === 0 && players[0].hand.length === 0) ? (log.length ? 'Next round' : 'Start round') : 'Start round';
  startBtn.disabled = roundActive;

  playersRowEl.innerHTML = '';
  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'player-chip panel' + (p.isHuman ? ' you' : '');
    div.innerHTML = `<div class="pname">${p.name}</div><div>${p.chips} chips</div><div>${p.hand.length} cards${p.isHuman ? '' : ' (hidden)'}</div>`;
    playersRowEl.appendChild(div);
  }

  marketGridEl.innerHTML = '';
  const human = players[0];
  const myCounts = F.countBy(human.hand);
  for (const suit of F.SUITS) {
    const color = F.suitColor(suit);
    const book = market[suit];
    const card = document.createElement('div');
    card.className = 'suit-card panel';
    card.innerHTML = `
      <div class="suit-head">
        <span class="suit-glyph ${color}">${F.SUIT_SYMBOL[suit]}</span>
        <span class="suit-name">${F.SUIT_NAME[suit]}</span>
        <span class="my-count">you hold ${myCounts[suit]}</span>
      </div>
      <div class="book-row"><span class="bid">bid ${book.bid ? book.bid.price : '—'}</span><span class="ask">ask ${book.ask ? book.ask.price : '—'}</span></div>
      <div class="suit-actions">
        <button class="btn secondary" data-act="buy" data-suit="${suit}" ${!roundActive || !book.ask || book.ask.playerIdx === 0 ? 'disabled' : ''}>Buy</button>
        <button class="btn secondary" data-act="sell" data-suit="${suit}" ${!roundActive || !book.bid || book.bid.playerIdx === 0 || myCounts[suit] === 0 ? 'disabled' : ''}>Sell</button>
      </div>
      <div class="post-row">
        <input type="number" min="1" max="${human.chips}" value="${book.bid && book.bid.playerIdx===0 ? book.bid.price : 8}" data-bidinput="${suit}" ${!roundActive ? 'disabled' : ''}/>
        <button class="btn secondary" data-act="postbid" data-suit="${suit}" ${!roundActive ? 'disabled' : ''}>Bid</button>
        <input type="number" min="1" value="${book.ask && book.ask.playerIdx===0 ? book.ask.price : 12}" data-askinput="${suit}" ${!roundActive || myCounts[suit] === 0 ? 'disabled' : ''}/>
        <button class="btn secondary" data-act="postask" data-suit="${suit}" ${!roundActive || myCounts[suit] === 0 ? 'disabled' : ''}>Ask</button>
      </div>
    `;
    marketGridEl.appendChild(card);
  }
  marketGridEl.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const suit = btn.dataset.suit;
      const act = btn.dataset.act;
      if (act === 'buy') buyAtAsk(0, suit);
      else if (act === 'sell') sellAtBid(0, suit);
      else if (act === 'postbid') {
        const v = parseInt(marketGridEl.querySelector(`[data-bidinput="${suit}"]`).value, 10);
        postBid(0, suit, v);
      } else if (act === 'postask') {
        const v = parseInt(marketGridEl.querySelector(`[data-askinput="${suit}"]`).value, 10);
        postAsk(0, suit, v);
      }
      render();
    });
  });

  if (revealed && lastSummary) {
    revealPanelEl.style.display = 'block';
    const { holdings, result } = lastSummary;
    let rows = '';
    for (let i = 0; i < players.length; i++) {
      rows += `<tr><td>${players[i].name}${result.bonusWinners.includes(i) ? ' 🏆' : ''}</td><td>${holdings[i]}</td><td>${result.payouts[i]}</td></tr>`;
    }
    revealPanelEl.innerHTML = `
      <h3>Goal suit: ${F.SUIT_SYMBOL[goalSuit]} ${F.SUIT_NAME[goalSuit]} — 12 in the deck</h3>
      <p style="color:var(--chalk-dim); font-family:var(--mono); font-size:0.85rem;">Short suit was ${F.SUIT_SYMBOL[shortSuit]} ${F.SUIT_NAME[shortSuit]} (8 in the deck). Deck: S${trueCounts.S} C${trueCounts.C} H${trueCounts.H} D${trueCounts.D}. Majority bonus (${result.bonusPot} chips) goes to whoever held the most goal-suit cards.</p>
      <table class="payout-table"><thead><tr><th>Player</th><th>Goal cards held</th><th>Payout</th></tr></thead><tbody>${rows}</tbody></table>
    `;
  } else {
    revealPanelEl.style.display = 'none';
  }

  logEl.innerHTML = log.map((l) => `<div>${l}</div>`).join('');
}

startBtn.addEventListener('click', startRound);

initPlayers();
clearMarket();
render();
