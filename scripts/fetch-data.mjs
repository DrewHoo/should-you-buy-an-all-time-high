// Fetch adjusted daily closes from Yahoo Finance for every ticker in
// UNIVERSE, compute the ATH and recovery-day sets, and write a compact
// JSON file per ticker into public/data/. Also writes public/data/index.json
// describing what was fetched.
//
// This is adapted from the upstream buy-it-now-or-never repo. The two
// fork-specific additions are:
//   - `athMaxDD`      per-ATH worst future drawdown (0..1)
//   - `athCurrentRel` per-ATH ratio of today's close to that ATH price
// The page turns athCurrentRel into each ATH's annualized return, which
// colors the ticks.

import YahooFinance from 'yahoo-finance2'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNIVERSE } from './universe.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'data')

const yahooFinance = new YahooFinance()
yahooFinance.suppressNotices?.(['yahooSurvey', 'ripHistorical'])

const PERIOD_START = '1980-01-01'
const PERIOD_END = new Date()
const CONCURRENCY = 5

async function fetchPriceSeries(symbol) {
  const result = await yahooFinance.chart(symbol, {
    period1: PERIOD_START,
    period2: PERIOD_END,
    interval: '1d',
    events: 'div,splits',
  })
  return result.quotes
    .filter(r => Number.isFinite(r.adjclose) && r.adjclose > 0)
    .map(r => ({ date: new Date(r.date), adjClose: r.adjclose }))
    .sort((a, b) => a.date - b.date)
}

async function fetchDisplayName(symbol) {
  try {
    const q = await yahooFinance.quote(symbol)
    return q?.longName || q?.shortName || q?.displayName || null
  } catch {
    return null
  }
}

function analyze(rows) {
  const n = rows.length
  const dates = new Array(n)
  const closes = new Array(n)
  for (let i = 0; i < n; i++) {
    dates[i] = rows[i].date.toISOString().slice(0, 10)
    closes[i] = Math.round(rows[i].adjClose * 10000) / 10000
  }

  const isAth = new Array(n).fill(false)
  let runningMax = -Infinity
  for (let i = 0; i < n; i++) {
    if (closes[i] > runningMax) {
      isAth[i] = true
      runningMax = closes[i]
    }
  }

  const isPermanentFloor = new Array(n).fill(false)
  let suffixMin = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (closes[i] <= suffixMin) isPermanentFloor[i] = true
    if (closes[i] < suffixMin) suffixMin = closes[i]
  }

  const lastClose = closes[n - 1]
  const lastTimeMs = Date.parse(dates[n - 1])
  const athIndices = []
  const athRecoveryDays = []
  const athBuyableDays = []
  const athMaxDD = []          // worst post-ATH drawdown (0..1)
  const athCurrentRel = []     // lastClose / athPrice

  for (let i = 0; i < n; i++) {
    if (!isAth[i]) continue
    athIndices.push(i)
    const cap = closes[i]
    athCurrentRel.push(lastClose / cap)

    if (isPermanentFloor[i]) {
      athRecoveryDays.push(null)
      athBuyableDays.push(0)
      athMaxDD.push(0)
      continue
    }
    let waited = null
    let buyable = 0
    let minSeen = cap
    for (let j = i + 1; j < n; j++) {
      if (closes[j] <= cap) {
        if (waited == null) waited = j - i
        buyable++
      }
      if (closes[j] < minSeen) minSeen = closes[j]
    }
    athRecoveryDays.push(waited)
    athBuyableDays.push(buyable)
    athMaxDD.push(1 - minSeen / cap)
  }

  const recoveryDays = athRecoveryDays
    .filter(d => d != null)
    .sort((a, b) => a - b)
  const recoveryMean = recoveryDays.length
    ? recoveryDays.reduce((a, b) => a + b, 0) / recoveryDays.length
    : null

  const athCount = athIndices.length
  const permAthCount = athRecoveryDays.filter(d => d == null).length
  const athClose = closes[athIndices[athCount - 1]]
  const pctOffAth = athClose ? (athClose - lastClose) / athClose : 0

  // Average age (in trading-day equivalents, but we just use calendar days)
  // of the still-unbroken ATHs. Older = the ticker's permanent peaks have
  // genuinely endured, not just recently-set ones. Less recency-biased than
  // settledPctUnbroken.
  let permAgeSum = 0
  let permAgeCount = 0
  for (let k = 0; k < athIndices.length; k++) {
    if (athRecoveryDays[k] != null) continue
    permAgeSum += (lastTimeMs - Date.parse(dates[athIndices[k]])) / 86400000
    permAgeCount++
  }
  const avgPermAthAgeDays = permAgeCount ? permAgeSum / permAgeCount : null

  // "Today marker" — the most recent ATH whose price was at-or-below today's
  // close. Maps today's price level onto the time axis via the ATH ladder:
  // at-ATH stocks land on today's ATH (right edge); a stock 50% off ATH lands
  // on the date of the older peak that today's price last exceeded. Avoids
  // the noise of "yesterday was 0.3% higher" that a raw close walk-back gives.
  let currentPriceDate = dates[athIndices[0]]
  for (let k = athIndices.length - 1; k >= 0; k--) {
    if (closes[athIndices[k]] <= lastClose) {
      currentPriceDate = dates[athIndices[k]]
      break
    }
  }

  return {
    dates,
    closes,
    athIndices,
    athRecoveryDays,
    athBuyableDays,
    athMaxDD,
    athCurrentRel,
    stats: {
      firstDate: dates[0],
      lastDate: dates[n - 1],
      totalDays: n,
      athCount,
      permAthCount,
      pctAthsThatWerePermanent: athCount ? permAthCount / athCount : 0,
      avgPermAthAgeDays,
      athClose,
      lastClose,
      pctOffAth,
      currentPriceDate,
      recoveryDaysMean: recoveryMean != null ? Math.round(recoveryMean) : null,
      recoveredAthCount: recoveryDays.length,
    },
  }
}

async function processOne(ticker) {
  const { symbol, name: hardcodedName, category } = ticker
  const rows = await fetchPriceSeries(symbol)
  if (rows.length === 0) throw new Error('no data')
  const a = analyze(rows)
  const name = hardcodedName || (await fetchDisplayName(symbol)) || symbol
  // Field names match what src/App.jsx expects.
  const payload = {
    symbol,
    name,
    category,
    adjusted: 'split + dividend',
    dates: a.dates,
    closes: a.closes,
    athIdx: a.athIndices,
    athRecov: a.athRecoveryDays,
    athBuyable: a.athBuyableDays,
    athMaxDD: a.athMaxDD,
    athCurrentRel: a.athCurrentRel,
    stats: a.stats,
  }
  await writeFile(
    resolve(OUT_DIR, `${symbol}.json`),
    JSON.stringify(payload),
  )
  return {
    symbol, name, category,
    firstDate: a.stats.firstDate,
    lastDate: a.stats.lastDate,
    athCount: a.stats.athCount,
    permAthCount: a.stats.permAthCount,
    avgPermAthAgeDays: a.stats.avgPermAthAgeDays,
    pctOffAth: a.stats.pctOffAth,
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function pull() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (err) {
        results[i] = { ok: false, item: items[i], error: err.message }
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, pull))
  return results
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  console.log(`Fetching ${UNIVERSE.length} tickers, ${CONCURRENCY} at a time…`)
  const t0 = Date.now()

  let done = 0
  const results = await runWithConcurrency(UNIVERSE, CONCURRENCY, async (t) => {
    const r = await processOne(t)
    done++
    process.stdout.write(`\r  ${done}/${UNIVERSE.length}  ${t.symbol.padEnd(8)}        `)
    return r
  })

  const index = []
  const failures = []
  for (const r of results) {
    if (r.ok) index.push(r.value)
    else failures.push({ symbol: r.item.symbol, error: r.error })
  }

  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), tickers: index }, null, 2),
  )

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\nWrote ${index.length} tickers + index.json in ${elapsed}s`)
  if (failures.length) {
    console.log(`Skipped ${failures.length}:`)
    for (const f of failures) console.log(`  ${f.symbol.padEnd(10)} ${f.error}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
