# Should You Buy an All-Time High?

Every closing-price all-time high for 200+ tickers, plotted on one shared
timeline and colored by **the annualized return from buying at that close to
the latest close** (dividends in, inflation not taken out).

- Gray → about 7% a year, the figure retirement planning usually assumes
- Greener → beat it, fully dollar-bill green at +22%/yr
- Redder → fell short, fully red at −8%/yr

The midpoint and span are `RETURN_MID` and `RETURN_SPAN` in
`src/chart-utils.js`.

The timeline reaches back to 1995 on wide screens, 1999 on tablets, and
2007 on phones, so a narrow screen still has room to read the clusters.

Hover or tap any row to read each peak's date, return since, and how many
later trading days closed cheaper.

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
  Each row is an inline SVG; the return color scale (`returnColor`) and the
  breakpoint-dependent timeline start (`RANGES`) live in
  `src/chart-utils.js`.
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
npm run gen:cover      # writes public/card.png (1200x750), the index-site card
```

Both are committed; CI does not regenerate them. Rerun by hand if you
tweak the look. `gen:og` draws real rows, so run `npm run fetch` first.

## Credits

A reframing of [drewhoover/buy-it-now-or-never](https://github.com/DrewHoo/buy-it-now-or-never).
Where that view asks "is this ATH the last one?", this one asks "what
would I have made if I bought here?".
