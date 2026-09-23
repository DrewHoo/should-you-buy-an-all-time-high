// Generate a 1200x630 OG preview image. Run with: node scripts/gen-og.mjs
// The output (public/og.png) is committed; CI does not regenerate it.
//
// A slice of the real board: a handful of well-known rows drawn from
// public/data with the same tick encoding as the page (src/chart-utils.js),
// so the preview looks like the site. Needs `npm run fetch` first.

import sharp from 'sharp'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  athLevels, makeAxis, RETURN_MID, RETURN_SPAN, returnColor, returnStops,
} from '../src/chart-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public')
const dataDir = resolve(outDir, 'data')
mkdirSync(outDir, { recursive: true })

const W = 1200
const H = 630

// Mirrors src/styles.css :root.
const BG = '#f1ead6'
const INK = '#1a1814'
const INK_SOFT = '#544c40'
const INK_FAINT = '#7a7162'
const TITLE = '#3f7a37'
const RULE = 'rgba(26, 24, 20, 0.16)'
const HAIR = 'rgba(26, 24, 20, 0.08)'

const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"
// Stands in for the page's Libre Caslon Text, which librsvg can't load.
// Big Caslon ships with macOS, where this script runs. It has one weight
// (medium); asking for bold makes the renderer skip it for Georgia Bold.
const SERIF = "'Big Caslon', Georgia, serif"
const SERIF_WEIGHT = 500

// A mix of big winners and dot-com peaks that have paid far less than
// 7% a year since (CSCO, INTC).
const SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'CSCO', 'INTC', 'GLD', 'BTC-USD']
const FROM_YEAR = 1999

if (!existsSync(resolve(dataDir, 'index.json'))) {
  console.error('public/data/ is empty. Run `npm run fetch` first.')
  process.exit(1)
}

const tickers = SYMBOLS.map((s) => JSON.parse(readFileSync(resolve(dataDir, `${s}.json`), 'utf8')))
const endMs = Math.max(...tickers.map((t) => Date.parse(t.stats.lastDate)))
const axis = makeAxis(FROM_YEAR, endMs)

const X0 = 190
const X1 = W - 60
const CW = X1 - X0
const ROW_H = 40
const TOP = 196
const px = (frac) => X0 + Math.round(Math.max(0, Math.min(1, frac)) * (CW - 1))

const years = axis.ticks.map((t) => `
  <text x="${px(t.frac)}" y="${TOP - 12}" text-anchor="middle" font-family="${MONO}"
    font-size="14" fill="${INK_FAINT}">${t.year}</text>`).join('')

const grid = axis.ticks
  .map((t) => `M${px(t.frac) + 0.5} ${TOP}V${TOP + ROW_H * SYMBOLS.length}`).join('')

const rows = tickers.map((t, i) => {
  const y = TOP + i * ROW_H
  const mid = y + ROW_H / 2
  // One tick per pixel column, colored by the mean return there (as on the page).
  const byColor = new Map()
  const draw = (x, sum, n) => {
    const color = returnColor(sum / n)
    byColor.set(color, (byColor.get(color) || '') + `M${x + 0.5} ${mid - 12}V${mid + 12}`)
  }
  let x = null, sum = 0, n = 0
  for (const l of athLevels(t)) {
    const f = axis.frac(l.date)
    if (f < 0 || f > 1) continue
    const lx = px(f)
    if (lx !== x) {
      if (x != null) draw(x, sum, n)
      x = lx; sum = 0; n = 0
    }
    sum += l.annual; n++
  }
  if (x != null) draw(x, sum, n)
  const historyX = px(axis.frac(t.dates[0]))
  const paths = [...byColor].map(([color, d]) =>
    `<path d="${d}" stroke="${color}" stroke-width="1.5"/>`).join('')
  return `
  <line x1="60" x2="${X1}" y1="${y + ROW_H}" y2="${y + ROW_H}" stroke="${HAIR}"/>
  <text x="60" y="${mid + 7}" font-family="${MONO}" font-size="20" font-weight="700" fill="${INK}">${t.symbol}</text>
  <line x1="${historyX}" x2="${X1}" y1="${mid}" y2="${mid}" stroke="${RULE}"/>
  ${paths}`
}).join('')

const pct = (r) => `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.round(Math.abs(r) * 100)}%`
// Green first, as in the page's key: best returns on the left, worst on the right.
const stops = returnStops(9).reverse()
const bar = (id, from, x) => `
  <defs><linearGradient id="${id}">${stops.slice(from, from + 5).map((s, i) =>
    `<stop offset="${i / 4}" stop-color="${s.color}"/>`).join('')}</linearGradient></defs>
  <rect x="${x}" y="131" width="90" height="10" fill="url(#${id})"/>`
const legendText = (x, text, { fill = INK_SOFT, weight = 400 } = {}) =>
  `<text x="${x}" y="143" font-family="${MONO}" font-size="15" font-weight="${weight}" fill="${fill}">${text}</text>`
const legend = [
  legendText(60, pct(RETURN_MID + RETURN_SPAN)),
  bar('hi', 0, 114),
  legendText(214, `${pct(RETURN_MID).slice(1)}/yr`, { fill: INK, weight: 700 }),
  bar('lo', 4, 282),
  legendText(382, pct(RETURN_MID - RETURN_SPAN)),
].join('')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <text x="60" y="96" font-family="${SERIF}" font-size="60" font-weight="${SERIF_WEIGHT}" letter-spacing="-1" fill="${TITLE}">Should You Buy an All-Time High?</text>
  ${legend}

  ${years}
  <line x1="60" x2="${X1}" y1="${TOP}" y2="${TOP}" stroke="${INK}" stroke-width="1.5"/>
  <path d="${grid}" stroke="${HAIR}"/>
  ${rows}

  <text x="60" y="${H - 28}" font-family="${MONO}" font-size="15" fill="${INK_FAINT}">drewhoover.com/should-you-buy-an-all-time-high</text>
  <text x="${X1}" y="${H - 28}" text-anchor="end" font-family="${MONO}" font-size="15" fill="${INK_FAINT}">every closing ATH, 200+ tickers</text>
</svg>`

const out = resolve(outDir, 'og.png')
await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(out)
console.log(`wrote ${out}`)
