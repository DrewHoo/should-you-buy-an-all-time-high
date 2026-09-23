// Generate the 1200x750 project card for the drewhoover.com index site.
// Run with: node scripts/gen-cover.mjs (after `npm run fetch`, since it
// draws SPY's real row). Writes public/card.png, which is committed and
// copied to the index repo as public/projects/should-you-buy-an-all-time-high.png.
//
// The card has to work on its own: what the project is, how to read the
// colors, and one finding, without anyone opening the site.

import sharp from 'sharp'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { athLevels, makeAxis, RETURN_MID, RETURN_SPAN, returnColor, toBoardTicker } from '../src/chart-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public')
const dataDir = resolve(outDir, 'data')

const W = 1200
const H = 750

// Mirrors src/styles.css :root.
const BG = '#f1ead6'
const INK = '#1a1814'
const INK_SOFT = '#544c40'
const INK_FAINT = '#7a7162'
const TITLE = '#3f7a37'
const RULE = 'rgba(26, 24, 20, 0.16)'

const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"
// Stands in for the page's Libre Caslon Text, which librsvg can't load.
// Big Caslon ships with macOS, where this script runs. It has one weight
// (medium); asking for bold makes the renderer skip it for Georgia Bold.
const SERIF = "'Big Caslon', Georgia, serif"
const SERIF_WEIGHT = 500

const SYMBOL = 'SPY'
const FROM_YEAR = 1995
// The dot-com top: SPY's last all-time high before the 2000 crash.
const PEAK_BEFORE = '2000-09-01'

if (!existsSync(resolve(dataDir, `${SYMBOL}.json`))) {
  console.error('public/data/ is empty. Run `npm run fetch` first.')
  process.exit(1)
}

const tickerCount = JSON.parse(readFileSync(resolve(dataDir, 'index.json'), 'utf8')).tickers.length
const ticker = toBoardTicker(JSON.parse(readFileSync(resolve(dataDir, `${SYMBOL}.json`), 'utf8')))
const axis = makeAxis(FROM_YEAR, Date.parse(ticker.lastDate))
const levels = athLevels(ticker).filter((l) => axis.frac(l.date) >= 0)
const peak = levels.filter((l) => l.date < PEAK_BEFORE).at(-1)
const peakPct = Math.round(peak.annual * 100)

// The row: 2px ticks, one per 2px column, colored by the mean return of
// the ATHs in it, as on the page.
const X0 = 150
const X1 = 1080
const ROW_TOP = 372
const ROW_H = 56
const px = (frac) => X0 + Math.round(Math.max(0, Math.min(1, frac)) * (X1 - X0 - 2) / 2) * 2
const byColor = new Map()
let col = null, sum = 0, n = 0
const draw = () => {
  const color = returnColor(sum / n)
  byColor.set(color, (byColor.get(color) || '') + `M${col + 1} ${ROW_TOP}V${ROW_TOP + ROW_H}`)
}
for (const l of levels) {
  const x = px(axis.frac(l.date))
  if (x !== col) {
    if (col != null) draw()
    col = x; sum = 0; n = 0
  }
  sum += l.annual; n++
}
if (col != null) draw()
const ticks = [...byColor].map(([color, d]) => `<path d="${d}" stroke="${color}" stroke-width="2"/>`).join('')

const years = axis.ticks.filter((t) => t.year % 10 === 0).map((t) => `
  <text x="${px(t.frac)}" y="${ROW_TOP + ROW_H + 28}" text-anchor="middle" font-family="${MONO}"
    font-size="15" fill="${INK_FAINT}">${t.year}</text>`).join('')

const peakX = px(axis.frac(peak.date)) + 1
const callout = `
  <line x1="${peakX}" x2="${peakX}" y1="${ROW_TOP - 30}" y2="${ROW_TOP - 6}" stroke="${INK}" stroke-width="1.5"/>
  <text x="${peakX}" y="${ROW_TOP - 40}" text-anchor="middle" font-family="${MONO}" font-size="15"
    fill="${INK}">dot-com peak</text>`

// Key: three swatches, green first as on the page.
const mid = Math.round(RETURN_MID * 100)
const KEY = [
  [RETURN_MID + RETURN_SPAN, `beat ${mid}%/yr`],
  [RETURN_MID, `about ${mid}%`],
  [RETURN_MID - RETURN_SPAN, 'fell short'],
]
const CHAR_W = 16 * 0.6
const keyWidths = KEY.map(([, label]) => 14 + label.length * CHAR_W)
const GAP = 34
let kx = (W - (keyWidths.reduce((a, b) => a + b, 0) + GAP * (KEY.length - 1))) / 2
const key = KEY.map(([r, label], i) => {
  const out = `<rect x="${kx}" y="578" width="4" height="18" fill="${returnColor(r)}"/>
    <text x="${kx + 14}" y="593" font-family="${MONO}" font-size="16" fill="${INK_SOFT}">${label}</text>`
  kx += keyWidths[i] + GAP
  return out
}).join('')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0.10  0 0 0 0 0.09  0 0 0 0 0.07  0 0 0 0.05 0"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>

  <line x1="60" x2="330" y1="66" y2="66" stroke="${INK_FAINT}" stroke-width="2" stroke-dasharray="12 8"/>
  <line x1="870" x2="1140" y1="66" y2="66" stroke="${INK_FAINT}" stroke-width="2" stroke-dasharray="12 8"/>
  <text x="${W / 2}" y="72" text-anchor="middle" font-family="${MONO}" font-size="18" letter-spacing="4"
    fill="${INK_FAINT}">MARKETS · CLOSING EDITION</text>

  <text x="${W / 2}" y="212" text-anchor="middle" font-family="${SERIF}" font-size="72" font-weight="${SERIF_WEIGHT}"
    letter-spacing="-1" fill="${TITLE}">Should You Buy an All-Time High?</text>
  <text x="${W / 2}" y="262" text-anchor="middle" font-family="${MONO}" font-size="18" letter-spacing="2.5"
    fill="${INK_SOFT}">EVERY CLOSING HIGH IN ${tickerCount} TICKERS, COLORED BY WHAT BUYING IT MADE</text>

  <text x="${X0 - 24}" y="${ROW_TOP + ROW_H / 2 + 7}" text-anchor="end" font-family="${MONO}" font-size="20"
    font-weight="700" fill="${INK}">${SYMBOL}</text>
  <line x1="${X0}" x2="${X1}" y1="${ROW_TOP + ROW_H / 2}" y2="${ROW_TOP + ROW_H / 2}" stroke="${RULE}"/>
  ${ticks}
  ${callout}
  ${years}

  <text x="${W / 2}" y="${ROW_TOP + ROW_H + 88}" text-anchor="middle" font-family="${SERIF}" font-size="28" font-weight="${SERIF_WEIGHT}"
    fill="${INK_SOFT}">Even buying ${SYMBOL} at the dot-com peak has paid ${peakPct}% a year.</text>
  ${key}

  <text x="${W / 2}" y="${H - 58}" text-anchor="middle" font-family="${MONO}" font-size="17"
    fill="${INK_FAINT}">drewhoover.com/should-you-buy-an-all-time-high</text>
</svg>`

const out = resolve(outDir, 'card.png')
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
console.log(`wrote ${out} (${SYMBOL} peak ${peak.date}: ${(peak.annual * 100).toFixed(1)}%/yr since)`)
