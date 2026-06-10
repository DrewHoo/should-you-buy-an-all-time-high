import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  athLevels, colorByTime, COLOR,
  AXIS_END_MS, AXIS_YEARS, AXIS_INSET_FRAC, dateToAxis,
  windowedAthStats,
} from './chart-utils.js'

function formatTimeSince(dateStr) {
  const ms = AXIS_END_MS - Date.parse(dateStr)
  const days = ms / 86400000
  if (days < 1) return 'today'
  if (days < 30) return `${Math.round(days)} days ago`
  const months = days / 30.44
  if (months < 18) return `${Math.round(months)} months ago`
  const years = days / 365.25
  return `${years.toFixed(1)} years ago`
}

function formatThousandBuy(level) {
  const rel = level.currentRel
  if (!Number.isFinite(rel) || rel <= 0) return null
  const value = 1000 * rel
  const pct = (rel - 1) * 100
  const dollars = `$${Math.round(value).toLocaleString('en-US')}`
  const deltaSign = pct >= 0 ? '+' : '−'
  const deltaPct = Math.abs(pct)
  const delta = `${deltaSign}${deltaPct < 10 ? deltaPct.toFixed(1) : Math.round(deltaPct)}%`
  return { dollars, delta, isLoss: pct < 0 }
}

function formatAnnual(level) {
  const a = level.annual
  if (a == null || !Number.isFinite(a)) return null
  const pct = a * 100
  const sign = pct >= 0 ? '+' : '−'
  const abs = Math.abs(pct)
  return `${sign}${abs < 10 ? abs.toFixed(1) : Math.round(abs)}%/yr`
}

const BASE = import.meta.env.BASE_URL

// Popular tickers, in display order, surfaced by the default "featured" sort.
// Hand-curated rather than algorithmic so the landing view tells a coherent
// "shared 30-year timeline" story (indexes, Mag 7, semis, BTC).
const FEATURED = [
  'SPY', 'QQQ', 'VOO', 'DIA', 'IWM',
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'NFLX', 'AMD', 'AVGO', 'ORCL',
  'XLK', 'SMH', 'SOXX',
  'GLD',
  'BTC-USD',
]
const FEATURED_RANK = new Map(FEATURED.map((s, i) => [s, i]))

const VALID_FILTERS = new Set(['all', 'stock', 'etf', 'commodity', 'crypto'])
const VALID_SORTS = new Set(['featured', 'athCount', 'permCount', 'athsPerYear'])

function readUrlState() {
  if (typeof window === 'undefined') return { filter: 'all', sortKey: 'featured', query: '' }
  const u = new URLSearchParams(window.location.search)
  const filter = u.get('cat')
  const sort = u.get('sort')
  return {
    filter: VALID_FILTERS.has(filter) ? filter : 'all',
    sortKey: VALID_SORTS.has(sort) ? sort : 'featured',
    query: u.get('q') || '',
  }
}

function writeUrlState({ filter, sortKey, query }) {
  const u = new URLSearchParams()
  if (filter && filter !== 'all') u.set('cat', filter)
  if (sortKey && sortKey !== 'featured') u.set('sort', sortKey)
  if (query) u.set('q', query)
  const qs = u.toString()
  const path = window.location.pathname + (qs ? `?${qs}` : '')
  window.history.replaceState(null, '', path + window.location.hash)
}

function useIsMobile() {
  const [is, setIs] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 800px)')
    const update = () => setIs(mq.matches)
    if (mq.addEventListener) mq.addEventListener('change', update)
    else mq.addListener(update)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update)
      else mq.removeListener(update)
    }
  }, [])
  return is
}

// ─────────────────────────────────────────────────────────────
// Top-level: loads index.json, then fetches every ticker's
// detail file in parallel. Shows a progress count while loading.
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [index, setIndex] = useState(null)
  const [tickers, setTickers] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // index.json is the freshness gate: always bypass the HTTP/CDN cache
        // so a new refresh is picked up immediately. Its `generatedAt` then
        // versions the (cacheable) per-ticker files, busting them in lockstep.
        const idx = await fetch(`${BASE}data/index.json`, { cache: 'no-store' }).then(r => r.json())
        if (cancelled) return
        setIndex(idx)
        setProgress({ done: 0, total: idx.tickers.length })

        const ver = encodeURIComponent(idx.generatedAt || '')
        const results = new Array(idx.tickers.length)
        let done = 0
        await Promise.all(idx.tickers.map(async (t, i) => {
          try {
            const d = await fetch(`${BASE}data/${encodeURIComponent(t.symbol)}.json?v=${ver}`).then(r => r.json())
            results[i] = d
          } catch {
            results[i] = null
          }
          done++
          if (!cancelled) setProgress({ done, total: idx.tickers.length })
        }))
        if (cancelled) return
        const ok = results.filter(Boolean)
        ok.forEach(t => { athLevels(t) })
        setTickers(ok)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) return <main className="state state--error">Couldn't load data: {error}</main>
  if (!tickers) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <main className="state">
        <Mast />
        <div className="loader">
          Loading <strong>{progress.done}/{progress.total || '…'}</strong> tickers
          <div className="loader-bar"><div className="loader-fill" style={{ width: `${pct}%` }} /></div>
        </div>
      </main>
    )
  }
  return <Leaderboard tickers={tickers} generatedAt={index?.generatedAt} />
}

function Mast() {
  return (
    <header className="mast">
      <div className="mast-title">Should You Buy <em>an All-Time High?</em></div>
      <div className="mast-sub">every closing all-time high, colored by how long buyers stayed underwater</div>
    </header>
  )
}

// All non-featured sort options pull from windowedAthStats and rank descending.
// Featured falls through to the athCount display so the badge still says
// something useful in that mode.
function rowMetric(t, sortKey) {
  const w = windowedAthStats(t)
  if (sortKey === 'permCount') {
    return { value: w.permCount, big: w.permCount.toLocaleString('en-US'), suffix: 'never undercut',
      cap: `${w.athCount.toLocaleString('en-US')} ATHs · ${w.athsPerYear.toFixed(1)}/yr` }
  }
  if (sortKey === 'athsPerYear') {
    return { value: w.athsPerYear, big: w.athsPerYear.toFixed(1), suffix: 'ATHs/yr',
      cap: `${w.athCount.toLocaleString('en-US')} ATHs · ${w.permCount} unbroken` }
  }
  return { value: w.athCount, big: w.athCount.toLocaleString('en-US'), suffix: 'ATHs',
    cap: `${w.permCount} unbroken · ${w.athsPerYear.toFixed(1)}/yr` }
}

function featuredRank(symbol) {
  return FEATURED_RANK.has(symbol) ? FEATURED_RANK.get(symbol) : Infinity
}

function Leaderboard({ tickers, generatedAt }) {
  const initial = useMemo(readUrlState, [])
  const [filter, setFilter] = useState(initial.filter)
  const [sortKey, setSortKey] = useState(initial.sortKey)
  const [query, setQuery] = useState(initial.query)
  const [chartEl, setChartEl] = useState(null)
  const [chartBounds, setChartBounds] = useState(null)
  const isMobile = useIsMobile()

  useEffect(() => { writeUrlState({ filter, sortKey, query }) }, [filter, sortKey, query])

  useLayoutEffect(() => {
    if (!chartEl) return
    const measure = () => {
      const r = chartEl.getBoundingClientRect()
      setChartBounds({ left: r.left, width: r.width })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(chartEl)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [chartEl])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickers.filter(t => {
      if (filter !== 'all' && t.category !== filter) return false
      if (!q) return true
      return t.symbol.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)
    })
  }, [tickers, filter, query])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortKey === 'featured') {
      arr.sort((a, b) => {
        const ra = featuredRank(a.symbol), rb = featuredRank(b.symbol)
        if (ra !== rb) return ra - rb
        // Anything not in FEATURED falls back to athCount descending.
        return rowMetric(b, 'athCount').value - rowMetric(a, 'athCount').value
      })
    } else {
      arr.sort((a, b) => rowMetric(b, sortKey).value - rowMetric(a, sortKey).value)
    }
    return arr
  }, [filtered, sortKey])

  const displayKey = sortKey === 'featured' ? 'athCount' : sortKey
  const metricMax = useMemo(() => {
    let max = 0
    for (const t of sorted) {
      const v = rowMetric(t, displayKey).value
      if (v > max) max = v
    }
    return max
  }, [sorted, displayKey])

  return (
    <main>
      <BackgroundTimeline bounds={chartBounds} />
      <Mast />

      <section className="lede-row">
        <p className="lede">
          Sometimes yes — green ticks below haven't been undercut yet, so a buyer at that peak got in at what is (so far!) a permanent floor.
          Sometimes brutally no — red ticks left buyers underwater for years (the 2000 dot-com cluster is hard to miss).
          Every closing-price all-time high in {tickers.length} tickers, on a shared {AXIS_YEARS}-year timeline.
          Tap or hover any row to scrub the ladder.
        </p>
        <Legend />
      </section>

      <section className="controls">
        <div className="seg">
          {[
            ['all', 'All'], ['stock', 'Stocks'], ['etf', 'ETFs'],
            ['commodity', 'Commodities'], ['crypto', 'Crypto'],
          ].map(([v, l]) => (
            <button key={v} className={`seg-btn ${filter === v ? 'is-active' : ''}`} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="search">
          <input
            type="search"
            className="search-input"
            placeholder="Search ticker or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search ticker or name"
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
          )}
        </div>
        <div className="seg seg--right">
          <span className="seg-label">sort</span>
          {[
            ['featured', 'featured'],
            ['athCount', 'most ATHs'],
            ['permCount', 'ATHs that were never undercut'],
            ['athsPerYear', 'most ATHs per year'],
          ].map(([v, l]) => (
            <button key={v} className={`seg-btn ${sortKey === v ? 'is-active' : ''}`} onClick={() => setSortKey(v)}>
              {l}
            </button>
          ))}
        </div>
      </section>

      {sorted.length === 0 && (
        <p className="empty">No tickers match “{query}”.</p>
      )}

      <ol className="board">
        {sorted.map((t, i) => (
          <Row key={t.symbol} ticker={t} rank={i + 1}
            chartProbeRef={i === 0 ? setChartEl : null}
            sortKey={displayKey} metricMax={metricMax}
            isMobile={isMobile} />
        ))}
      </ol>

      <Methodology generatedAt={generatedAt} tickerCount={tickers.length} />
    </main>
  )
}

function Legend() {
  const items = [
    [COLOR.victory,  'never undercut (so far!)'],
    [COLOR.short,    '≤ 3 months at-or-below'],
    [COLOR.safe,     '3–6 months'],
    [COLOR.meh,      '6–12 months'],
    [COLOR.scary,    '1–2 years'],
    [COLOR.disaster, '2+ years underwater'],
  ]
  return (
    <div className="legend">
      {items.map(([c, l], i) => (
        <span key={i} className="legend-item">
          <svg width="20" height="14" aria-hidden="true">
            <line x1="10" y1="0" x2="10" y2="14" stroke={c} strokeWidth="3" />
          </svg>
          {l}
        </span>
      ))}
      <span className="legend-item">
        <svg width="20" height="14" aria-hidden="true">
          <polygon points="6,0 14,0 10,4" fill={COLOR.disaster} />
          <line x1="10" y1="0" x2="10" y2="14" stroke={COLOR.disaster} strokeDasharray="3 2" strokeWidth="2" />
        </svg>
        today
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// One leaderboard row: rank + symbol/name + scrubbable barcode +
// permanent-share bar + drawdown indicator.
// ─────────────────────────────────────────────────────────────
function Row({ ticker, rank, chartProbeRef, sortKey, metricMax, isMobile }) {
  const levels = useMemo(
    () => athLevels(ticker).filter(l => dateToAxis(l.date) >= 0),
    [ticker],
  )
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const W = 840, H = 64
  const left = 12, right = W - 12
  const yMid = H / 2
  const xOfFrac = (frac) => left + frac * (right - left)
  const xOfDate = (dateStr) => xOfFrac(Math.max(0, Math.min(1, dateToAxis(dateStr))))

  function nearestByAxis(axisPos) {
    if (!levels.length) return null
    let best = levels[0], bd = Math.abs(dateToAxis(best.date) - axisPos)
    for (let i = 1; i < levels.length; i++) {
      const d = Math.abs(dateToAxis(levels[i].date) - axisPos)
      if (d < bd) { bd = d; best = levels[i] }
    }
    return best
  }

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const axisPos = Math.max(0, Math.min(1, px / rect.width))
    const a = nearestByAxis(axisPos)
    if (!a) return
    const xLocal = Math.max(0, Math.min(1, dateToAxis(a.date))) * rect.width
    setHover({ axisPos, xLocal, a, chartW: rect.width })
  }

  const active = hover?.a || null
  const metric = rowMetric(ticker, sortKey)
  const barPct = metricMax > 0 ? Math.min(100, (metric.value / metricMax) * 100) : 0

  return (
    <li className="row">
      <div className="row-rank">{String(rank).padStart(2, '0')}</div>
      <div className="row-name">
        <div className="row-symbol">{ticker.symbol}</div>
        <div className="row-fullname">{ticker.name}</div>
      </div>
      <div ref={chartProbeRef} className="row-chart">
        <svg ref={svgRef}
          width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onTouchMove={(e) => { if (e.touches[0]) onMove({ clientX: e.touches[0].clientX }) }}
          onTouchEnd={() => setHover(null)}
        >
          <line className="axis-line" x1={left - 4} x2={right + 4} y1={yMid} y2={yMid} />
          {levels.map((l, i) => {
            const isActive = active && active.idx === l.idx
            const stroke = colorByTime(l)
            const half = l.perm ? 26 : 14
            return (
              <line key={i}
                x1={xOfDate(l.date)} x2={xOfDate(l.date)}
                y1={yMid - half} y2={yMid + half}
                stroke={stroke}
                strokeWidth={isActive ? 3.4 : l.perm ? 3 : 1.4} />
            )
          })}
          {(() => {
            const markerDate = ticker.stats.currentPriceDate ?? ticker.stats.lastDate
            const markerFrac = Math.max(0, Math.min(1, dateToAxis(markerDate)))
            const nx = xOfFrac(markerFrac)
            return (
              <>
                <polygon className="now-flag"
                  points={`${nx - 5},0 ${nx + 5},0 ${nx},7`} />
                <line className="now-line"
                  x1={nx} x2={nx}
                  y1={0} y2={H} />
              </>
            )
          })()}
          {hover && active && (
            <line stroke={COLOR.ink} strokeOpacity="0.55" strokeWidth="0.7"
              x1={xOfDate(active.date)} x2={xOfDate(active.date)} y1={4} y2={H - 4}
              strokeDasharray="2 3" />
          )}
        </svg>
        {hover && active && (
          <Tooltip ticker={ticker} level={active}
            x={hover.xLocal}
            y={yMid}
            chartW={hover.chartW}
            side={hover.axisPos > 0.6 ? 'left' : 'right'}
            placement={isMobile ? 'above' : 'side'} />
        )}
      </div>
      <div className="row-pct">
        <div className="pct-bar">
          <div className="pct-track">
            <div className="pct-fill" style={{ width: `${barPct}%` }} />
          </div>
          <span className="pct-num">{metric.big} <span className="pct-suffix">{metric.suffix}</span></span>
        </div>
        <div className="pct-cap">{metric.cap}</div>
      </div>
    </li>
  )
}

function Tooltip({ ticker, level, x, y, side, placement = 'side', chartW }) {
  if (!level) return null
  const above = placement === 'above'
  const W = above ? 220 : 230
  const offset = 12
  // When floating above on mobile, clamp the horizontal anchor so the
  // tooltip stays inside the chart instead of escaping the right/left edge.
  let style
  if (above) {
    const pad = 6
    const cw = chartW || W
    const effW = Math.min(W, cw - pad * 2)
    const half = effW / 2
    const minX = half + pad
    const maxX = cw - half - pad
    const anchorX = minX > maxX ? cw / 2 : Math.max(minX, Math.min(maxX, x))
    style = { left: anchorX, top: -8, width: effW, transform: 'translate(-50%, -100%)' }
  } else {
    style = { left: side === 'right' ? x + offset : x - W - offset, top: y, width: W, transform: 'translateY(-50%)' }
  }
  const c = colorByTime(level)
  const yrs = level.buyable / 252
  const buy = formatThousandBuy(level)
  let detail
  if (level.perm) {
    detail = (
      <div className="t-row t-row--big" style={{ color: c }}>
        not undercut yet (so far!) — {formatTimeSince(level.date)}
      </div>
    )
  } else {
    detail = (
      <>
        <div className="t-row t-row--big" style={{ color: c }}>
          {yrs >= 1 ? `${yrs.toFixed(1)} years at-or-below` : `${level.buyable} days at-or-below`}
        </div>
        <div className="t-row t-row--sub">
          worst drawdown −{(level.maxDD * 100).toFixed(0)}% · first undercut after {level.recov} days
        </div>
      </>
    )
  }
  const annual = formatAnnual(level)
  return (
    <div className={`tip ${above ? 'tip--above' : ''}`} style={style}>
      <div className="t-eyebrow">{ticker.symbol} ATH</div>
      <div className="t-date">{level.date}</div>
      <div className="t-price">${level.price.toFixed(2)}</div>
      {detail}
      {buy && (
        <div className={`t-row t-row--buy ${buy.isLoss ? 'is-loss' : 'is-gain'}`}>
          $1,000 then → <strong>{buy.dollars}</strong> today ({buy.delta})
          {annual && <span className="t-row--annual"> · {annual} avg</span>}
        </div>
      )}
    </div>
  )
}

const BG_MARKS = [
  { date: '2000-03-10', year: '2000', tag: 'dot-com' },
  { date: '2008-09-15', year: '2008', tag: 'GFC' },
  { date: '2020-03-23', year: '2020', tag: 'COVID' },
]

function BackgroundTimeline({ bounds }) {
  if (!bounds) return null
  const axisLeft = bounds.left + bounds.width * AXIS_INSET_FRAC
  const axisRight = bounds.left + bounds.width * (1 - AXIS_INSET_FRAC)
  const axisWidth = axisRight - axisLeft
  return (
    <div className="bg-timeline" aria-hidden>
      {BG_MARKS.map(m => {
        const t = dateToAxis(m.date)
        if (t < 0 || t > 1) return null
        const x = axisLeft + t * axisWidth
        return (
          <div key={m.year} className="bg-timeline-mark" style={{ left: `${x}px` }}>
            <div className="bg-timeline-label">
              <span className="bg-timeline-year">{m.year}</span>
              <span className="bg-timeline-tag">{m.tag}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Methodology({ generatedAt, tickerCount }) {
  return (
    <section className="meth">
      <h3>Notes</h3>
      <ul>
        <li>
          {tickerCount} tickers — Nasdaq 100 + S&amp;P 100 (deduped union) plus
          major tech / growth / sector / semi ETFs, gold and silver, and a
          few flavors of bitcoin. Daily prices are <strong>split- and dividend-adjusted closes</strong> from Yahoo Finance.
        </li>
        <li>
          A close is a <strong>permanent floor</strong> if no later close was at-or-below it (so far!). Sorts:
          "featured" pins popular indexes, the Mag 7, semis, and BTC up top;
          "most ATHs" by total ATH count in the visible window;
          "ATHs that were never undercut" by permanent-floor count; and
          "most ATHs per year" by count divided by the ticker's years of history in the window
          (so a 4-year-old ETF with 80 ATHs can outscore a 30-year-old name with 600).
        </li>
        <li>
          Every row shares the same horizontal axis: the last {AXIS_YEARS} years, ending today (dashed vertical line).
          ATHs before the window are hidden; rows for younger tickers (BTC, ARM, PLTR) just start later.
        </li>
        <li>
          Color encodes how many trading days the close stayed at-or-below the ATH afterward, in linear bins:
          ≤3 months stays green, 3–6 olive, 6–12 yellow, 1–2 years orange, 2+ years red.
        </li>
        <li>
          Only <em>closes</em> are checked, not intraday lows.
        </li>
        <li>
          Data refreshed {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}.
        </li>
      </ul>
    </section>
  )
}
