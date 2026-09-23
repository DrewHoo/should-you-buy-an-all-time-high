// Chart data helpers. Pure functions, no React, no DOM. Kept separate so
// they're trivial to unit-test or reuse if the UI gets ported.

// One JSON ticker file from public/data/<SYM>.json carries:
//   closes, dates, athIdx, athBuyable, athMaxDD, athCurrentRel, stats
// `athLevels(ticker)` zips those parallel arrays into per-ATH records the
// chart can map over directly. Cached per ticker.
//
// `annual` is the annualized return from buying at that ATH close to the
// ticker's latest close. It's computed for every ATH, however recent: a
// dip of a few weeks annualizes to something dramatic, and the reader can
// be trusted with that. An ATH on the latest close has returned nothing
// yet, so it's 0.
const _levelsCache = new WeakMap()
export function athLevels(t) {
  const cached = _levelsCache.get(t)
  if (cached) return cached
  const lastMs = Date.parse(t.stats.lastDate)
  const levels = t.athIdx.map((closeIdx, k) => {
    const rel = t.athCurrentRel ? t.athCurrentRel[k] : 1
    const years = (lastMs - Date.parse(t.dates[closeIdx])) / YEAR_MS
    return {
      idx: closeIdx,
      date: t.dates[closeIdx],
      price: t.closes[closeIdx],
      buyable: t.athBuyable[k],
      maxDD: t.athMaxDD ? t.athMaxDD[k] : 0,
      currentRel: rel,
      annual: years > 0 ? rel ** (1 / years) - 1 : rel - 1,
    }
  })
  _levelsCache.set(t, levels)
  return levels
}

// ---------------------------------------------------------------
// Shared time axis.
//
// Every row plots ATHs at their date position on the same horizontal
// span, so the dot-com cluster, '08, and the 2022 peaks line up across
// tickers. How far back that span reaches depends on how much width
// there is to spread it over: a phone gets 2007 onward (the GFC peaks
// and everything since), wider screens reach back to the dot-com run-up.
// `minWidth` is a viewport width and matches the breakpoints in
// styles.css.
// ---------------------------------------------------------------
export const RANGES = [
  { minWidth: 1080, fromYear: 1995 },
  { minWidth: 640, fromYear: 1999 },
  { minWidth: 0, fromYear: 2007 },
]

export const YEAR_MS = 365.25 * 86400000

export function makeAxis(fromYear, endMs) {
  const startMs = Date.UTC(fromYear, 0, 1)
  const span = endMs - startMs
  const frac = (dateStr) => (Date.parse(dateStr) - startMs) / span
  const ticks = []
  for (let y = Math.ceil((fromYear + 1) / 5) * 5; Date.UTC(y, 0, 1) < endMs; y += 5) {
    ticks.push({ year: y, frac: (Date.UTC(y, 0, 1) - startMs) / span })
  }
  return { fromYear, startMs, endMs, frac, ticks }
}

// ---------------------------------------------------------------
// Tick color: the annualized return from buying at that ATH close to
// the latest close (dividends in, inflation not taken out).
//
// A diverging scale around a midpoint the reader picks with a slider,
// RETURN_MID by default: the 7%/yr that retirement planning most often
// assumes. At the midpoint a tick is neutral gray;
// it goes redder the further the return falls short and deeper
// dollar-bill green the further it beats it, saturating RETURN_SPAN
// either side (at 7%, -8%/yr is full red and +22%/yr full green). The tooltip
// always carries the exact number.
//
// Each color scheme gets its own steps, checked with the dataviz palette
// validator against that scheme's background. The gray midpoint sits
// just above the 2:1 floor so average returns recede, and the poles
// differ in lightness so they still separate for red-green colorblind
// readers: on the light paper red is the darker pole, on the dark
// background green is the brighter one.
// ---------------------------------------------------------------
export const RETURN_MID = 0.07
export const RETURN_SPAN = 0.15

export const RETURN_COLORS = {
  light: { below: '#971b1a', mid: '#a9a49c', above: '#57914a' },
  dark: { below: '#e76250', mid: '#67635d', above: '#8bd47b' },
}

// Quantized to whole percentage points so a row draws one path per
// color instead of one element per tick.
const STEPS = Math.round(RETURN_SPAN * 100)

function hexToOklab(hex) {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const [r, g, b] = lin
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + rgb.map((c) => {
    c = Math.max(0, Math.min(1, c))
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }).join('')
}

// RAMPS[scheme][STEPS + k] is the color k percentage points away from
// the midpoint.
function buildRamp({ below, mid, above }) {
  const [b, m, a] = [below, mid, above].map(hexToOklab)
  const out = []
  for (let k = -STEPS; k <= STEPS; k++) {
    const pole = k < 0 ? b : a
    const t = Math.abs(k) / STEPS
    out.push(oklabToHex(m.map((v, i) => v + (pole[i] - v) * t)))
  }
  return out
}
const RAMPS = { light: buildRamp(RETURN_COLORS.light), dark: buildRamp(RETURN_COLORS.dark) }

export function returnColor(annual, scheme = 'light', mid = RETURN_MID) {
  const k = Number.isFinite(annual) ? Math.round((annual - mid) * 100) : 0
  return RAMPS[scheme][STEPS + Math.max(-STEPS, Math.min(STEPS, k))]
}

// Stops for drawing the scale as a gradient, low end first.
export function returnStops(n = 7, scheme = 'light') {
  return Array.from({ length: n }, (_, i) => {
    const offset = i / (n - 1)
    return { offset, color: returnColor(RETURN_MID + RETURN_SPAN * (offset * 2 - 1), scheme) }
  })
}
