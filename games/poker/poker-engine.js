// Texas Hold'em core logic: deck, hand evaluation, equity estimation, side pots.

const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // 11=J,12=Q,13=K,14=A
const RANK_CHAR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankChar(r) { return RANK_CHAR[r] || String(r); }
function cardStr(c) { return rankChar(c.r) + c.s.toUpperCase(); }

function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function combinations5of7(cards) {
  // returns all 21 5-card combinations from a 7-card array
  const result = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return result;
}

const CATEGORY_NAME = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

function evaluate5(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const uniqueRanksDesc = Object.keys(counts).map(Number).sort((a, b) => b - a);

  // straight detection (handles wheel A-2-3-4-5)
  let straightHigh = null;
  const distinct = [...new Set(ranks)];
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
    else if (JSON.stringify(distinct) === JSON.stringify([14, 5, 4, 3, 2])) straightHigh = 5;
  }

  const byCountThenRank = uniqueRanksDesc.slice().sort((a, b) => (counts[b] - counts[a]) || (b - a));

  if (straightHigh && isFlush) return { cat: 8, tiebreak: [straightHigh] };
  if (byCountThenRank.length >= 1 && counts[byCountThenRank[0]] === 4) {
    const kicker = byCountThenRank.find((r) => counts[r] === 1);
    return { cat: 7, tiebreak: [byCountThenRank[0], kicker ?? 0] };
  }
  if (counts[byCountThenRank[0]] === 3 && byCountThenRank[1] !== undefined && counts[byCountThenRank[1]] >= 2) {
    return { cat: 6, tiebreak: [byCountThenRank[0], byCountThenRank[1]] };
  }
  if (isFlush) return { cat: 5, tiebreak: ranks };
  if (straightHigh) return { cat: 4, tiebreak: [straightHigh] };
  if (counts[byCountThenRank[0]] === 3) {
    const kickers = byCountThenRank.filter((r) => counts[r] === 1).slice(0, 2);
    return { cat: 3, tiebreak: [byCountThenRank[0], ...kickers] };
  }
  if (counts[byCountThenRank[0]] === 2 && counts[byCountThenRank[1]] === 2) {
    const pairs = [byCountThenRank[0], byCountThenRank[1]].sort((a, b) => b - a);
    const kicker = byCountThenRank.find((r) => counts[r] === 1);
    return { cat: 2, tiebreak: [...pairs, kicker ?? 0] };
  }
  if (counts[byCountThenRank[0]] === 2) {
    const kickers = byCountThenRank.filter((r) => counts[r] === 1).slice(0, 3);
    return { cat: 1, tiebreak: [byCountThenRank[0], ...kickers] };
  }
  return { cat: 0, tiebreak: ranks.slice(0, 5) };
}

function compareHandResult(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const av = a.tiebreak[i] ?? 0, bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function evaluateBest7(cards7) {
  const combos = combinations5of7(cards7);
  let best = null;
  for (const combo of combos) {
    const res = evaluate5(combo);
    if (!best || compareHandResult(res, best) > 0) best = res;
  }
  return best;
}

function cardKey(c) { return c.r + c.s; }

function removeCards(deck, used) {
  const usedKeys = new Set(used.map(cardKey));
  return deck.filter((c) => !usedKeys.has(cardKey(c)));
}

// Monte Carlo equity: probability hero's hole cards win/tie/lose against `numOpponents`
// random hands, given known community cards. Returns {win, tie, lose} as fractions.
function estimateEquity(heroHole, community, numOpponents, iterations = 1200, rng = Math.random) {
  const known = [...heroHole, ...community];
  const baseDeck = removeCards(freshDeck(), known);
  let win = 0, tie = 0, lose = 0;
  const neededCommunity = 5 - community.length;

  for (let i = 0; i < iterations; i++) {
    const deck = shuffle(baseDeck, rng);
    let idx = 0;
    const oppHoles = [];
    for (let o = 0; o < numOpponents; o++) {
      oppHoles.push([deck[idx++], deck[idx++]]);
    }
    const fullCommunity = community.concat(deck.slice(idx, idx + neededCommunity));

    const heroBest = evaluateBest7([...heroHole, ...fullCommunity]);
    let heroWins = true, tied = false;
    for (const oh of oppHoles) {
      const oppBest = evaluateBest7([...oh, ...fullCommunity]);
      const cmp = compareHandResult(heroBest, oppBest);
      if (cmp < 0) { heroWins = false; tied = false; break; }
      if (cmp === 0) tied = true;
    }
    if (heroWins && tied) tie++;
    else if (heroWins) win++;
    else lose++;
  }
  return { win: win / iterations, tie: tie / iterations, lose: lose / iterations };
}

// Quick preflop hand-strength heuristic (0-100ish), used so bots don't need a full
// Monte Carlo run just to decide whether to open-fold preflop.
function preflopHeuristic(hole) {
  const [a, b] = hole;
  const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
  let score = hi * 2.0;
  if (hi !== lo) score += lo * 0.7;
  if (a.r === b.r) score += 22 + hi * 0.8; // pairs
  if (a.s === b.s) score += 8; // suited
  const gap = hi - lo;
  if (a.r !== b.r) {
    if (gap === 1) score += 6;
    else if (gap === 2) score += 4;
    else if (gap === 3) score += 2;
    else if (gap >= 5) score -= 6;
  }
  return Math.max(0, Math.min(100, score));
}

// ---------- side pots ----------
// players: [{id, contributed, folded, allIn}] contributed = total chips put in this hand
function computeSidePots(players) {
  const contributors = players.filter((p) => p.contributed > 0);
  const levels = [...new Set(contributors.map((p) => p.contributed))].sort((a, b) => a - b);
  const pots = [];
  let prevLevel = 0;
  for (const level of levels) {
    const layerPlayers = contributors.filter((p) => p.contributed >= level);
    const amount = (level - prevLevel) * layerPlayers.length;
    if (amount > 0) {
      const eligible = layerPlayers.filter((p) => !p.folded).map((p) => p.id);
      pots.push({ amount, eligible });
    }
    prevLevel = level;
  }
  return pots;
}

const api = {
  SUITS, RANKS, rankChar, cardStr, freshDeck, shuffle, evaluate5, evaluateBest7,
  compareHandResult, estimateEquity, preflopHeuristic, computeSidePots, CATEGORY_NAME,
  removeCards,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PokerEngine = api;
