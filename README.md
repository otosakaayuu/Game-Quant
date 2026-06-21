# The Odds Room

Chess, Poker, Figgie, and Shogi — four games against computer opponents, built to train probability and expected-value intuition. Pure HTML/CSS/JavaScript, no build step, no backend, no accounts. Works fully offline once the page has loaded once.

## Play it locally, right now

No installation needed. Just open `index.html` in a browser (double-click it, or drag it into a browser window). Every game runs entirely client-side.

If double-clicking doesn't work nicely in your browser, run a tiny local server from this folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages (free hosting)

1. **Create a repository.** On GitHub, click **New repository**, give it a name (e.g. `odds-room`), and create it (public, no need to add a README/.gitignore).
2. **Upload these files.**
   - Easiest: on the repo page, click **Add file → Upload files**, drag in everything from this folder (keeping the `games/` folder structure intact), and commit.
   - Or via git:
     ```bash
     cd odds-room   # this folder
     git init
     git add .
     git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/<your-username>/<repo-name>.git
     git push -u origin main
     ```
3. **Turn on Pages.** In the repo, go to **Settings → Pages**. Under "Build and deployment", set **Source** to "Deploy from a branch", **Branch** to `main` and folder `/ (root)`, then **Save**.
4. **Wait about a minute**, then your site is live at:
   `https://<your-username>.github.io/<repo-name>/`

That's it — no server, no environment variables, no dependencies to install on GitHub's side.

## What's inside

```
index.html          hub page linking to all four games
style.css            shared theme (colors, type, buttons) used by every page
games/
  chess/             full legal-move chess engine + board UI
  shogi/             full shogi engine incl. drops/promotion + board UI
  poker/             6-max No-Limit Hold'em + hand evaluator + equity trainer
  figgie/            40-card market/inference game
```

Each game folder has an `-engine.js` file (pure game logic/rules/AI, no DOM) and a matching UI controller + stylesheet. The engines were validated with standard correctness checks before the UI was built on top:

- **Chess** — move generator checked against known [perft](https://www.chessprogramming.org/Perft_Results) node counts (20 / 400 / 8,902 / 197,281 at depths 1–4), confirming castling, en passant, promotion, and check detection are all correct.
- **Shogi** — move generator checked against known perft counts for the standard start position (30 / 900 / 25,470), plus targeted tests for the two-pawn rule, drop placement restrictions, and the "can't drop a pawn for checkmate" rule.
- **Poker** — hand evaluator checked against all hand categories, and the betting engine (side pots, all-ins, folds) was stress-tested over thousands of simulated automated hands with perfect chip conservation.
- **Figgie** — deck construction and the per-card + majority-bonus payout were checked for chip conservation, including tie splits.

## Notes on difficulty / AI

- Chess and Shogi: Easy / Medium / Hard map to a minimax search with alpha-beta pruning at increasing depth. Shogi's search also caps how many moves it considers per node, since the "drop" rule can otherwise make the move count explode late in a game.
- Poker and Figgie bots use a probability/equity-based heuristic (Monte Carlo simulation for poker, hand-composition inference for Figgie) rather than search, with a little personality variance per bot so they don't all play identically.

## Customizing

Everything is plain JS/CSS, so it's easy to tweak:
- Colors/fonts/spacing live in `style.css` as CSS variables at the top.
- Starting chip stacks, blinds, and round timers are constants near the top of `poker.js` and `figgie.js`.
- AI search depth options are in the `diffSeg` buttons in each game's `index.html`.
