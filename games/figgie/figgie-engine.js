// Figgie core logic. Figgie cards only have a suit (no rank) — the whole game is
// about inferring which suit is scarce/abundant from the 10 cards you're dealt.

const SUITS = ['S', 'C', 'H', 'D'];
const SUIT_SYMBOL = { S: '♠', C: '♣', H: '♥', D: '♦' };
const SUIT_NAME = { S: 'Spades', C: 'Clubs', H: 'Hearts', D: 'Diamonds' };

function suitColor(s) { return (s === 'S' || s === 'C') ? 'black' : 'red'; }

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds one round: picks the goal suit (12 cards), its same-color short suit (8
// cards), and gives the other color's two suits 10 cards each. Deals 10 cards to
// each of 4 players.
function buildRound(rng = Math.random) {
  const colorPairs = [['S', 'C'], ['H', 'D']];
  const goalPairIdx = rng() < 0.5 ? 0 : 1;
  const goalPair = colorPairs[goalPairIdx];
  const otherPair = colorPairs[1 - goalPairIdx];
  const goalSuit = rng() < 0.5 ? goalPair[0] : goalPair[1];
  const shortSuit = goalPair.find((s) => s !== goalSuit);

  const counts = {};
  counts[goalSuit] = 12;
  counts[shortSuit] = 8;
  counts[otherPair[0]] = 10;
  counts[otherPair[1]] = 10;

  let deck = [];
  for (const s of SUITS) for (let i = 0; i < counts[s]; i++) deck.push(s);
  deck = shuffle(deck, rng);

  const hands = [deck.slice(0, 10), deck.slice(10, 20), deck.slice(20, 30), deck.slice(30, 40)];
  return { goalSuit, shortSuit, counts, hands };
}

function countBy(hand) {
  const c = { S: 0, C: 0, H: 0, D: 0 };
  for (const s of hand) c[s]++;
  return c;
}

// holdings: array of {playerIdx, count} for the goal suit, one entry per player.
// Returns {payouts: [amounts per player idx], perCardValue, bonusPot, bonusWinners}
function computePayouts(holdingsByPlayer, pot, perCardValue) {
  const n = holdingsByPlayer.length;
  const payouts = new Array(n).fill(0);
  let totalGoalCards = 0;
  for (let i = 0; i < n; i++) {
    const pay = holdingsByPlayer[i] * perCardValue;
    payouts[i] += pay;
    totalGoalCards += holdingsByPlayer[i];
  }
  const spentOnCards = perCardValue * totalGoalCards;
  const bonusPot = Math.max(0, pot - spentOnCards);
  const maxHeld = Math.max(...holdingsByPlayer);
  const winners = [];
  for (let i = 0; i < n; i++) if (holdingsByPlayer[i] === maxHeld) winners.push(i);
  const share = Math.floor(bonusPot / winners.length);
  let remainder = bonusPot - share * winners.length;
  for (const w of winners) {
    payouts[w] += share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return { payouts, bonusPot, bonusWinners: winners, maxHeld, totalGoalCards };
}

const api = { SUITS, SUIT_SYMBOL, SUIT_NAME, suitColor, shuffle, buildRound, countBy, computePayouts };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FiggieEngine = api;
