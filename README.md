# Should You Buy an All-Time High?

Every closing-price all-time high for 200+ tickers, plotted on a shared
30-year timeline, colored by **how many trading days the price stayed
at-or-below it afterward**.

- Green ticks → permanent ATH, never undercut (the buys-of-a-lifetime)
- Olive → a brief blip below, recovered quickly
- Amber → months at-or-below
- Burnt orange → years
- Deep red → a decade or more underwater (the dot-com scars)

Hover any row to scrub through its ATH ladder and read date / drawdown /
recovery window for each peak. Sorted by recency-corrected share of
permanent ATHs.

Live: <https://drewhoover.com/should-you-buy-an-all-time-high/>

## Running locally

```bash
npm install
npm run fetch          # pull adjusted closes from Yahoo Finance
npm run dev
```

Visit <http://localhost:5173/should-you-buy-an-all-time-high/>.

## How it works

- `scripts/universe.mjs` declares the ticker universe (Nasdaq 100 +
  S&P 100 + tech / sector ETFs + commodities + a few flavors of BTC).
- `scripts/fetch-data.mjs` pulls daily split- and dividend-adjusted
  closes via `yahoo-finance2`, then for each ticker computes:
  - every closing-price ATH
  - which ATHs are **permanent floors** (no later close at-or-below)
  - per-ATH worst future drawdown (`athMaxDD`)
  - per-ATH days-at-or-below count (`athBuyable`)
  - a recency-corrected "% unbroken" stat
  Output is one compact JSON per ticker plus `index.json`, all written
  to `public/data/`.
- The Vite build serves those JSON files statically.
- `src/App.jsx` loads `data/index.json`, then fetches every ticker's
  detail file in parallel and renders the leaderboard once they're in.
  Each row is an inline SVG; the color encoding lives in
  `src/chart-utils.js` (`colorByTime`).
- A scheduled GitHub Action refreshes the data on weekdays after the
  US close — see `.github/workflows/deploy.yml`.

## Deploying

The default config publishes to GitHub Pages at
`/should-you-buy-an-all-time-high/`. Push to `main` and the workflow handles the
fetch, build, and deploy.

## Shareable assets

```bash
npm run gen:favicon    # writes public/favicon.* and apple-touch-icon
npm run gen:og         # writes public/og.png (1200x630)
```

Both are committed; CI does not regenerate them. Rerun by hand if you
tweak the look.

## Credits

A reframing of [drewhoover/buy-it-now-or-never](https://github.com/DrewHoo/buy-it-now-or-never).
Where that view asks "is this ATH the last one?", this one asks "how
long would I have been underwater if I bought here?".
