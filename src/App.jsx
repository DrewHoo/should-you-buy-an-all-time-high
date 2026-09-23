import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  athLevels, makeAxis, RANGES, RETURN_MID, RETURN_SPAN, returnColor,
} from './chart-utils.js'

const BASE = import.meta.env.BASE_URL
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Bare YYYY-MM-DD strings, formatted without a Date so no timezone can
// shift them a day.
function fmtDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${MONTHS[m - 1]} ${+d}, ${y}`
}

function fmtSignedPct(frac) {
  const pct = frac * 100
  const abs = Math.abs(pct)
  return `${pct >= 0 ? '+' : '−'}${abs < 10 ? abs.toFixed(1) : Math.round(abs)}%`
}

// Popular tickers, in display order, surfaced by the default "featured" sort.
// Hand-curated rather than algorithmic so the landing view tells a coherent
// shared-timeline story (indexes, Mag 7, semis, gold, BTC).
const FEATURED = [
  'SPY', 'QQQ', 'VOO', 'DIA', 'IWM',
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'NFLX', 'AMD', 'AVGO', 'ORCL',
  'XLK', 'SMH', 'SOXX',
  'GLD',
  'BTC-USD',
]
const FEATURED_RANK = new Map(FEATURED.map((s, i) => [s, i]))

const CATEGORIES = [
  ['all', 'All'], ['stock', 'Stocks'], ['etf', 'ETFs'],
  ['commodity', 'Metals'], ['crypto', 'Crypto'],
]

const SORTS = [['featured', 'Featured'], ['lexicographic', 'Lexicographic']]

// The slider's stops for the gray midpoint, in % a year. Each one asks a
// different question of the same buys.
const AVG_STOPS = [
  { pct: 0, note: 'did buying lose money?' },
  { pct: 3, note: 'about inflation' },
  { pct: 7, note: 'the usual planning figure' },
  { pct: 10, note: "the S&P 500's long-run average" },
]
const DEFAULT_AVG = Math.round(RETURN_MID * 100)

const VALID_FILTERS = new Set(CATEGORIES.map(([v]) => v))
const VALID_SORTS = new Set(SORTS.map(([v]) => v))
const VALID_AVGS = new Set(AVG_STOPS.map((s) => String(s.pct)))

function readUrlState() {
  if (typeof window === 'undefined') return { filter: 'all', sortKey: 'featured', query: '', avg: DEFAULT_AVG }
  const u = new URLSearchParams(window.location.search)
  const filter = u.get('cat')
  const sort = u.get('sort')
  const avg = u.get('avg')
  return {
    filter: VALID_FILTERS.has(filter) ? filter : 'all',
    sortKey: VALID_SORTS.has(sort) ? sort : 'featured',
    query: u.get('q') || '',
    avg: VALID_AVGS.has(avg) ? Number(avg) : DEFAULT_AVG,
  }
}

function writeUrlState({ filter, sortKey, query, avg }) {
  const u = new URLSearchParams()
  if (filter && filter !== 'all') u.set('cat', filter)
  if (sortKey && sortKey !== 'featured') u.set('sort', sortKey)
  if (query) u.set('q', query)
  if (avg !== DEFAULT_AVG) u.set('avg', String(avg))
  const qs = u.toString()
  const path = window.location.pathname + (qs ? `?${qs}` : '')
  window.history.replaceState(null, '', path + window.location.hash)
}

// The widest RANGES tier whose min-width media query matches.
function useRange() {
  const pick = () => RANGES.find((r) => window.matchMedia(`(min-width: ${r.minWidth}px)`).matches)
  const [range, setRange] = useState(pick)
  useEffect(() => {
    const mqs = RANGES.map((r) => window.matchMedia(`(min-width: ${r.minWidth}px)`))
    const update = () => setRange(pick())
    mqs.forEach((mq) => mq.addEventListener('change', update))
    return () => mqs.forEach((mq) => mq.removeEventListener('change', update))
  }, [])
  return range
}

// useLayoutEffect warns during the build-time prerender, where there is
// no layout to measure; on the server it's a plain no-op effect instead.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// 'light' or 'dark', following the viewer's system setting. The chart's
// tick colors are computed in JS, so they can't just ride on CSS vars.
// Starts as 'light' so the prerendered HTML and the first client render
// match, then switches before the first paint after hydration.
const DARK_QUERY = '(prefers-color-scheme: dark)'
function useColorScheme() {
  const [scheme, setScheme] = useState('light')
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const update = () => setScheme(mq.matches ? 'dark' : 'light')
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return scheme
}

// GitHub Pages now and then answers with a 503. Try each load three
// times, a moment apart, before giving up.
async function fetchJson(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, init)
      if (!r.ok) throw new Error(`${r.status} ${r.statusText || 'error'}`.trim())
      return await r.json()
    } catch (err) {
      if (attempt >= 3) throw err
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Top-level: loads index.json, then board.json, which holds every
// ticker's all-time highs in one file.
//
// `initialIndex` is the ticker list baked into the page at build time
// (scripts/prerender.mjs), so the loading view can list every ticker
// before any data arrives, and the prerendered HTML and first client
// render match.
// ─────────────────────────────────────────────────────────────
export default function App({ initialIndex = null }) {
  const [index, setIndex] = useState(initialIndex)
  const [tickers, setTickers] = useState(null)
  const [error, setError] = useState(null)
  const scheme = useColorScheme()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // index.json is the freshness gate: always bypass the HTTP/CDN cache
        // so a new refresh is picked up immediately. Its `generatedAt` then
        // versions the (cacheable) board.json, busting it in lockstep.
        const idx = await fetchJson(`${BASE}data/index.json`, { cache: 'no-store' })
        if (cancelled) return
        setIndex(idx)
        const board = await fetchJson(`${BASE}data/board.json?v=${encodeURIComponent(idx.generatedAt || '')}`)
        if (cancelled) return
        board.tickers.forEach((t) => { athLevels(t) })
        setTickers(board.tickers)
      } catch (err) {
        console.error('Could not load the price data:', err)
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!tickers) return <Loading index={index} error={error} scheme={scheme} />
  return <Leaderboard tickers={tickers} generatedAt={index?.generatedAt} scheme={scheme} />
}

// The page before the price data arrives: the masthead, every ticker in
// featured order with an empty timeline, and the notes. It's also what
// the prerender bakes into the HTML for crawlers. If the data never
// arrives, it says so in the loader's place.
function Loading({ index, error, scheme }) {
  const tickers = index ? [...index.tickers].sort(byFeatured) : []
  return (
    <main>
      <Mast scheme={scheme} endMs={index ? Date.parse(index.generatedAt) : 0} avg={DEFAULT_AVG} />
      {error
        ? <p className="loader loader--error">Couldn't load the price data. Reload to try again.</p>
        : <p className="loader">Loading prices…</p>}
      <ol className="rows">
        {tickers.map((t) => (
          <li key={t.symbol} className="row">
            <div className="c-sym" title={t.name}>{t.symbol}</div>
            <div className="c-name">{t.name}</div>
            <div className="c-chart" />
          </li>
        ))}
      </ol>
      <Notes generatedAt={index?.generatedAt} />
    </main>
  )
}

function Mast({ scheme, endMs, avg, onAvg }) {
  return (
    <header className="mast">
      <h1>Should You Buy an All-Time High?</h1>
      <p className="deck">
        Every colored tick on the timeline represents an all-time high for its security. The
        color represents how well you'd have done by buying it: green if you'd have beaten the
        market average, grey for average, red for underperforming the market. Hover or tap
        individual all-time highs to learn more.
      </p>
      <Legend scheme={scheme} endMs={endMs} avg={avg} onAvg={onAvg} />
    </header>
  )
}

function featuredRank(symbol) {
  return FEATURED_RANK.has(symbol) ? FEATURED_RANK.get(symbol) : Infinity
}

const bySymbol = (a, b) => a.symbol.localeCompare(b.symbol)
// Featured puts the curated list first, then everything else A–Z.
const byFeatured = (a, b) => (featuredRank(a.symbol) - featuredRank(b.symbol)) || bySymbol(a, b)

// Every row's SVG is drawn in pixel space at this height, so ticks stay
// crisp instead of being stretched by a viewBox.
const CHART_H = 23

function Leaderboard({ tickers, generatedAt, scheme }) {
  const initial = useMemo(readUrlState, [])
  const [filter, setFilter] = useState(initial.filter)
  const [sortKey, setSortKey] = useState(initial.sortKey)
  const [query, setQuery] = useState(initial.query)
  const [avg, setAvg] = useState(initial.avg)
  const mid = avg / 100
  const range = useRange()
  const [chartEl, setChartEl] = useState(null)
  const [chartW, setChartW] = useState(0)

  useEffect(() => { writeUrlState({ filter, sortKey, query, avg }) }, [filter, sortKey, query, avg])

  // Every row's chart cell has the same width, so measure the header's once.
  useIsoLayoutEffect(() => {
    if (!chartEl) return
    const measure = () => setChartW(Math.floor(chartEl.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(chartEl)
    return () => ro.disconnect()
  }, [chartEl])

  // The axis ends at the latest close in the data, not the viewer's clock,
  // so the right edge always means "most recent close".
  const endMs = useMemo(
    () => Math.max(...tickers.map((t) => Date.parse(t.lastDate))),
    [tickers],
  )
  const axis = useMemo(() => makeAxis(range.fromYear, endMs), [range.fromYear, endMs])

  const gridD = useMemo(() => {
    if (!chartW) return ''
    return axis.ticks.map((t) => `M${Math.round(t.frac * (chartW - 1)) + 0.5} 0V${CHART_H}`).join('')
  }, [axis, chartW])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickers.filter(t => {
      if (filter !== 'all' && t.category !== filter) return false
      if (!q) return true
      return t.symbol.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
    })
  }, [tickers, filter, query])

  // Lexicographic is A–Z by symbol throughout.
  const sorted = useMemo(
    () => [...filtered].sort(sortKey === 'featured' ? byFeatured : bySymbol),
    [filtered, sortKey],
  )

  return (
    <main>
      <Mast scheme={scheme} endMs={axis.endMs} avg={avg} onAvg={setAvg} />

      <section className="controls">
        <div className="seg" role="group" aria-label="Category">
          {CATEGORIES.map(([v, l]) => (
            <button key={v} className={`seg-btn ${filter === v ? 'is-active' : ''}`}
              aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="search">
          <input
            type="search"
            className="search-input"
            placeholder="Search ticker or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search ticker or name"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
          )}
        </div>
        <label className="sort">
          Sort
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </section>

      <div className="board">
        <div className="row row--head">
          <div className="c-sym" />
          <div className="c-name" />
          <div className="c-chart" ref={setChartEl}>
            {axis.ticks.map((t) => (
              <span key={t.year} className="yr" style={{ left: `${t.frac * 100}%` }}>{t.year}</span>
            ))}
          </div>
        </div>

        {sorted.length === 0 && (
          <p className="empty">No tickers match “{query}”.</p>
        )}

        <ol className="rows">
          {sorted.map((t) => (
            <Row key={t.symbol} ticker={t} axis={axis} chartW={chartW} gridD={gridD} scheme={scheme} mid={mid} />
          ))}
        </ol>
      </div>

      <Notes generatedAt={generatedAt} />
    </main>
  )
}

const pctLabel = (r) => `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.round(Math.abs(r) * 100)}%`

// The legend: a made-up row, about a third of the screen wide on wider
// screens, with one tick per color, oldest to newest, each labeled with
// what it stands for. Ticks are 2px here (1px on the board) so a lone one
// reads. Hovering or tapping one opens the same popover the board does.
// Each tick is a made-up buy, consistent with one today's price: the
// green one never got cheaper, the red one is still below today.
// The ticks' returns follow the slider's midpoint.
const SAMPLE_TODAY = 165.6
function keyTicks(mid) {
  return [
    { frac: 0.15, r: mid + RETURN_SPAN, label: `≥${pctLabel(mid + RETURN_SPAN)}/yr`,
      years: 16, buyable: 0, maxDD: 0 },
    { frac: 0.45, r: mid, label: `${Math.round(mid * 100)}%/yr`,
      years: 10, buyable: 41, maxDD: 0.09 },
    { frac: 0.75, r: mid - RETURN_SPAN, label: `≤${pctLabel(mid - RETURN_SPAN)}/yr`,
      years: 2, buyable: 250, maxDD: 0.31 },
  ]
}
const KEY_FRACS = keyTicks(RETURN_MID).map((k) => k.frac)
// Today's price sits between the gray and red ticks: above the gray high
// (so that buyer is up) and below the red one (so that buyer is down).
const KEY_NOW = 0.6
const SAMPLE_TICKER = { symbol: 'TICKER', name: 'Example Co.' }

function sampleLevel(k, endMs) {
  const d = new Date(endMs)
  d.setUTCFullYear(d.getUTCFullYear() - k.years)
  const rel = (1 + k.r) ** k.years
  return {
    date: d.toISOString().slice(0, 10),
    price: SAMPLE_TODAY / rel,
    annual: k.r,
    currentRel: rel,
    buyable: k.buyable,
    maxDD: k.maxDD,
  }
}

function Legend({ scheme, endMs, avg, onAvg }) {
  const mid = avg / 100
  const KEY = useMemo(() => keyTicks(mid), [mid])
  const [chartEl, setChartEl] = useState(null)
  const [chartW, setChartW] = useState(0)
  useIsoLayoutEffect(() => {
    if (!chartEl) return
    const measure = () => setChartW(Math.floor(chartEl.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(chartEl)
    return () => ro.disconnect()
  }, [chartEl])
  const { hover, svgRef, handlers } = useScrub(KEY_FRACS)

  const px = (frac) => Math.round(frac * (chartW - 1)) + 1
  // Labels sit centered on their tick.
  const at = (frac) => ({ left: `calc(${frac * 100}% + 1px)`, transform: 'translateX(-50%)' })
  const nowX = px(KEY_NOW)
  const active = hover ? KEY[hover.k] : null

  return (
    <div className="legend">
      <div className="row key">
        <div className="c-sym">TICKER</div>
        <div className="c-chart" ref={setChartEl}>
          <span className="key-label key-label--above" style={at(KEY_NOW)}>today's price</span>
          <svg ref={svgRef} width={chartW} height={CHART_H} {...handlers}>
            <path d={`M0 ${CHART_H / 2}H${chartW}`} className="baseline" />
            {chartW > 0 && active && <path d={`M${px(active.frac) + 0.5} 0V${CHART_H}`} className="hairline" />}
            {chartW > 0 && KEY.map((k) => (
              <path key={k.frac} d={`M${px(k.frac)} 5V${CHART_H - 5}`} stroke={returnColor(k.r, scheme, mid)} strokeWidth="2" />
            ))}
            {chartW > 0 && (
              <polygon className="now-caret" points={`${nowX - 3.5},0 ${nowX + 3.5},0 ${nowX},4.5`} />
            )}
          </svg>
          {KEY.map((k) => (
            <span key={k.frac} className="key-label key-label--below" style={at(k.frac)}>{k.label}</span>
          ))}
        </div>
      </div>
      <AverageSlider avg={avg} onAvg={onAvg} />
      {active && (
        <Tooltip ticker={SAMPLE_TICKER} level={sampleLevel(active, endMs)}
          frac={active.frac} rect={hover.rect} scheme={scheme} mid={mid} />
      )}
    </div>
  )
}

// Picks the gray midpoint from AVG_STOPS. Disabled until the data loads,
// since the loading view has nothing for it to recolor.
function AverageSlider({ avg, onAvg }) {
  const i = Math.max(0, AVG_STOPS.findIndex((s) => s.pct === avg))
  const stop = AVG_STOPS[i]
  const last = AVG_STOPS.length - 1
  return (
    <div className="avg">
      <label className="avg-head" htmlFor="avg">
        Market average <strong>{stop.pct}%/yr</strong>
      </label>
      <input id="avg" type="range" min="0" max={last} step="1" value={i}
        disabled={!onAvg}
        aria-valuetext={`${stop.pct}% a year, ${stop.note}`}
        onChange={(e) => onAvg(AVG_STOPS[Number(e.target.value)].pct)} />
      <div className="avg-ticks" aria-hidden="true">
        {AVG_STOPS.map((s, j) => (
          <span key={s.pct} className={j === i ? 'is-on' : ''}
            style={{ left: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${j / last})` }}>{s.pct}%</span>
        ))}
      </div>
      <div className="avg-note">{stop.note}</div>
    </div>
  )
}

// Hover with a mouse; tap or scrub sideways with a finger (a vertical
// swipe scrolls the page instead, via touch-action: pan-y). `fracs` are
// the sorted x positions (0..1) of an svg's marks. While one is active,
// `hover` holds its index and the svg's rect; popovers are fixed or
// floating, so any scroll or a tap elsewhere closes it.
function useScrub(fracs) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)
  const touchX = useRef(null)

  function nearestAt(clientX) {
    if (!fracs.length) return null
    const rect = svgRef.current.getBoundingClientRect()
    const f = (clientX - rect.left) / rect.width
    let lo = 0, hi = fracs.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (fracs[mid] < f) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && f - fracs[lo - 1] < fracs[lo] - f) lo--
    return { k: lo, rect }
  }

  function show(e) {
    const hit = nearestAt(e.clientX)
    if (hit) setHover((h) => (h && h.k === hit.k ? h : hit))
  }

  const handlers = {
    onPointerMove: (e) => {
      if (e.pointerType === 'mouse') show(e)
      else if (touchX.current != null && Math.abs(e.clientX - touchX.current) > 4) show(e)
    },
    onPointerLeave: (e) => { if (e.pointerType === 'mouse') setHover(null) },
    onPointerDown: (e) => { if (e.pointerType !== 'mouse') touchX.current = e.clientX },
    onPointerUp: (e) => {
      if (e.pointerType === 'mouse') return
      touchX.current = null
      show(e)
    },
    onPointerCancel: () => { touchX.current = null; setHover(null) },
  }

  const open = hover != null
  useEffect(() => {
    if (!open) return
    const close = () => setHover(null)
    const outside = (e) => { if (!svgRef.current?.contains(e.target)) close() }
    window.addEventListener('scroll', close, { passive: true })
    window.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('scroll', close)
      window.removeEventListener('pointerdown', outside)
    }
  }, [open])

  return { hover, svgRef, handlers }
}

// ─────────────────────────────────────────────────────────────
// One row: symbol, (name on wide screens), the ATH barcode, and
// the windowed counts. Hover or tap the barcode to inspect an ATH.
// ─────────────────────────────────────────────────────────────
const Row = memo(function Row({ ticker, axis, chartW, gridD, scheme, mid }) {
  const levels = useMemo(
    () => athLevels(ticker).filter((l) => {
      const f = axis.frac(l.date)
      return f >= 0 && f <= 1
    }),
    [ticker, axis],
  )
  const fracs = useMemo(() => levels.map((l) => axis.frac(l.date)), [levels, axis])
  const { hover, svgRef, handlers } = useScrub(fracs)

  const px = (frac) => Math.round(Math.max(0, Math.min(1, frac)) * (chartW - 1))

  // One tick per pixel column, colored by the mean return of the ATHs
  // that land in it, then one path per color: a busy row has 800+ ATHs,
  // most of them sharing a column with a neighbor.
  const paths = useMemo(() => {
    const byColor = new Map()
    if (!chartW) return byColor
    const draw = (x, sum, n) => {
      const color = returnColor(sum / n, scheme, mid)
      byColor.set(color, (byColor.get(color) || '') + `M${x + 0.5} 5V${CHART_H - 5}`)
    }
    let x = null, sum = 0, n = 0
    levels.forEach((l, k) => {
      const lx = px(fracs[k])
      if (lx !== x) {
        if (x != null) draw(x, sum, n)
        x = lx; sum = 0; n = 0
      }
      sum += l.annual; n++
    })
    if (x != null) draw(x, sum, n)
    return byColor
  }, [levels, fracs, chartW, scheme, mid])

  // Today's price, placed between the most recent ATH that today's close
  // still clears (the fetch script's currentPriceDate) and the next ATH,
  // which it doesn't. Sitting on either tick would claim today's price
  // equals that high. A ticker at its high has no next ATH, so the marker
  // lands on its latest one. A ticker below even its first close (DASH,
  // KHC) clears nothing; the fetch script falls back to that first ATH, and
  // the marker stays there at the start of its history.
  const nowDate = ticker.currentPriceDate
  let nowX = null
  if (nowDate) {
    const { dates, closes } = ticker.ath
    const k = dates.indexOf(nowDate)
    const clears = k >= 0 && closes[k] <= ticker.lastClose
    const next = clears ? dates[k + 1] : undefined
    const x0 = px(axis.frac(nowDate))
    nowX = next == null ? x0 : Math.round((x0 + px(axis.frac(next))) / 2)
  }
  const historyX = px(axis.frac(ticker.firstDate))

  const active = hover ? levels[hover.k] : null

  return (
    <li className="row">
      <div className="c-sym" title={ticker.name}>{ticker.symbol}</div>
      <div className="c-name">{ticker.name}</div>
      <div className="c-chart">
        <svg ref={svgRef} width={chartW} height={CHART_H} {...handlers}>
          <path d={gridD} className="grid" />
          {historyX < chartW - 1 && (
            <path d={`M${historyX} ${CHART_H / 2}H${chartW}`} className="baseline" />
          )}
          {[...paths].map(([color, d]) => (
            <path key={color} d={d} stroke={color} />
          ))}
          {nowX != null && (
            <polygon className="now-caret" points={`${nowX - 3.5},0 ${nowX + 3.5},0 ${nowX},4.5`} />
          )}
          {active && (
            <path d={`M${px(fracs[hover.k]) + 0.5} 0V${CHART_H}`} className="hairline" />
          )}
        </svg>
      </div>
      {active && (
        <Tooltip ticker={ticker} level={active} frac={fracs[hover.k]} rect={hover.rect} scheme={scheme} mid={mid} />
      )}
    </li>
  )
})

const TIP_W = 236

// Fixed to the viewport: centered over the hovered ATH, above the row
// unless the row is too close to the top of the screen.
function Tooltip({ ticker, level, frac, rect, scheme, mid }) {
  const x = rect.left + frac * rect.width
  const left = Math.max(8, Math.min(window.innerWidth - TIP_W - 8, x - TIP_W / 2))
  const style = rect.top < 180
    ? { left, top: rect.bottom + 8, width: TIP_W }
    : { left, bottom: window.innerHeight - rect.top + 8, width: TIP_W }

  const rel = level.currentRel
  const hasBuy = Number.isFinite(rel) && rel > 0

  // Trading days after this high that closed at or below it.
  const cheaper = level.buyable
  const laterNote = cheaper > 0
    ? [
        rel < 1 && 'still cheaper today',
        level.maxDD >= 0.005 && `as much as ${Math.round(level.maxDD * 100)}% lower`,
      ].filter(Boolean).join(' · ')
    : "it hasn't closed this low since"

  return (
    <div className="tip" style={style} role="tooltip">
      <div className="t-eyebrow">{ticker.symbol} · {ticker.name}</div>
      <div className="t-head">
        <span>{fmtDate(level.date)}</span>
        <span>${level.price.toFixed(2)}</span>
      </div>
      <div className="t-verdict">
        <span className="t-swatch" style={{ background: returnColor(level.annual, scheme, mid) }} />
        {fmtSignedPct(level.annual)}/yr since
      </div>
      {hasBuy && (
        <div className="t-sub">
          $1,000 → <strong>${Math.round(1000 * rel).toLocaleString('en-US')}</strong> today
        </div>
      )}
      <div className="t-later">
        <div className="t-later-label">Later opportunities to buy for cheaper</div>
        <div className="t-later-num">
          {cheaper > 0 ? <>{cheaper.toLocaleString('en-US')}<small>days</small></> : 'None'}
        </div>
        {laterNote && <div className="t-later-note">{laterNote}</div>}
      </div>
    </div>
  )
}

function Notes({ generatedAt }) {
  const [phone, tablet, wide] = [...RANGES].reverse()
  const mid = Math.round(RETURN_MID * 100)
  return (
    <section className="notes">
      <h2>Notes</h2>
      <ul>
        <li>
          Split- and dividend-adjusted daily closes from Yahoo Finance. Only closes count, not
          intraday lows. These are today's biggest names, so survivorship flatters the returns.
        </li>
        <li>
          Color is the annualized return from buying at that close to the latest close, with
          dividends reinvested and no inflation adjustment. Gray starts at {mid}% a year, the
          figure retirement planning most often assumes, usually after inflation, so it's a
          lenient bar here. The slider moves gray: 0% asks whether buying lost money, 3% is about
          inflation, and 10% is the S&P 500's long-run average before inflation.
        </li>
        <li>
          Later opportunities to buy for cheaper counts the trading days after a high that
          closed at or below it.
        </li>
        <li>
          The timeline starts in {phone.fromYear} on phones, {tablet.fromYear} on tablets, and{' '}
          {wide.fromYear} on wider screens.
        </li>
        <li>
          The ▾ marks today's price: between the last all-time high today's close still
          clears and the next one, which it doesn't.
        </li>
        <li>
          Data refreshed {generatedAt ? fmtDate(generatedAt.slice(0, 10)) : '—'}.
        </li>
      </ul>
    </section>
  )
}
