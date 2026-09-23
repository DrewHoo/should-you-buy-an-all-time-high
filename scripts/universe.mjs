// The set of tickers we fetch + analyze. Hand-curated union of:
//   - Nasdaq 100 (NDX)
//   - S&P 100 (OEX)
//   - Major tech / growth ETFs (and a few sectors for context)
//   - Semiconductor ETFs and notable semi names outside NDX/OEX
//   - Commodity ETFs: one fund per metal, plus energy and agriculture
//   - Crypto: bitcoin and the ten oldest coins still widely traded
//     (no stablecoins, no funds that just hold bitcoin)
//
// To refresh constituents (a few times per year):
//   - https://en.wikipedia.org/wiki/Nasdaq-100
//   - https://en.wikipedia.org/wiki/S%26P_100
// Yahoo expects dashes (BRK-B) where the symbol has a class designator;
// we keep those normalized below.

const STOCKS_NDX_OR_SP100 = [
  // Mega caps + Mag 7
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  // Other large-cap tech / software / internet
  'ORCL', 'ADBE', 'CRM', 'AVGO', 'AMD', 'QCOM', 'INTC', 'IBM', 'CSCO',
  'ACN', 'NOW', 'INTU', 'PANW', 'CRWD', 'ZS', 'DDOG', 'MDB', 'SNPS',
  'CDNS', 'ADSK', 'FTNT', 'PLTR', 'TEAM', 'WDAY', 'TTD', 'APP',
  'PYPL', 'EBAY', 'MSTR', 'PAYX', 'CTSH', 'CDW',
  // Semis (NDX members)
  'AMAT', 'LRCX', 'KLAC', 'MRVL', 'MCHP', 'MU', 'NXPI', 'ON', 'TXN', 'ARM',
  'GFS', 'ADI',
  // Communication / streaming / consumer internet
  'NFLX', 'DIS', 'CMCSA', 'CHTR', 'TMUS', 'T', 'VZ',
  'BKNG', 'ABNB', 'MAR', 'MELI', 'PDD', 'DASH', 'AXON',
  // Consumer staples / retail (S&P 100 names)
  'COST', 'WMT', 'TGT', 'HD', 'LOW', 'KO', 'PEP', 'PG', 'MO', 'PM',
  'MDLZ', 'KHC', 'MNST', 'CL', 'KDP', 'SBUX', 'MCD', 'NKE', 'LULU',
  'ROST', 'DLTR', 'ORLY', 'CPRT', 'EA',
  // Healthcare (S&P 100)
  'UNH', 'JNJ', 'PFE', 'MRK', 'LLY', 'ABBV', 'BMY', 'AMGN', 'GILD',
  'ABT', 'TMO', 'MDT', 'DHR', 'REGN', 'VRTX', 'ISRG', 'IDXX', 'BIIB',
  'DXCM', 'GEHC',
  // Financials (S&P 100)
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'BLK', 'SCHW', 'V', 'MA',
  'COF', 'USB', 'MET', 'AIG', 'BK', 'SPG',
  // Industrial / defense / transport (S&P 100)
  'BA', 'GE', 'CAT', 'DE', 'MMM', 'HON', 'UPS', 'FDX', 'RTX', 'LMT',
  'GD', 'EMR', 'UNP', 'CSX', 'ODFL', 'PCAR', 'FAST', 'CTAS', 'ROP',
  'VRSK', 'BKR', 'FANG',
  // Energy / utilities (S&P 100 + some NDX)
  'XOM', 'CVX', 'COP', 'EXC', 'DUK', 'NEE', 'SO', 'AEP', 'XEL', 'CEG',
  // Auto / industrials
  'F', 'GM',
  // Other notable
  'LIN', 'WBD', 'CSGP', 'ADP',
]

// Semis worth including that AREN'T in NDX or S&P 100
const STOCKS_EXTRA_SEMIS = [
  'TSM',    // Taiwan Semi ADR
  'ASML',   // ASML Holding (already NDX, but keep explicit)
  'WOLF',   // Wolfspeed (silicon carbide)
  'COHR',   // Coherent
  'ENTG',   // Entegris (semi supply chain)
  'MKSI',   // MKS Instruments
  'ALAB',   // Astera Labs
  'SMCI',   // Super Micro
  'STM',    // STMicroelectronics
]

const ETFS_TECH_AND_GROWTH = [
  // Tech sector ETFs
  { symbol: 'XLK',  name: 'Technology Select Sector SPDR' },
  { symbol: 'VGT',  name: 'Vanguard Information Technology ETF' },
  { symbol: 'IYW',  name: 'iShares U.S. Technology ETF' },
  { symbol: 'FTEC', name: 'Fidelity MSCI Information Technology ETF' },
  { symbol: 'IGV',  name: 'iShares Expanded Tech-Software Sector ETF' },
  // Semi-focused
  { symbol: 'SMH',  name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'SOXQ', name: 'Invesco PHLX Semiconductor ETF' },
  { symbol: 'XSD',  name: 'SPDR S&P Semiconductor ETF' },
  { symbol: 'PSI',  name: 'Invesco Semiconductors ETF' },
  { symbol: 'DRAM', name: 'Roundhill Memory ETF' },
  // Growth-flavored
  { symbol: 'ARKK', name: 'ARK Innovation ETF' },
  { symbol: 'IVW',  name: 'iShares S&P 500 Growth ETF' },
  { symbol: 'SPYG', name: 'SPDR S&P 500 Growth ETF' },
  { symbol: 'MGK',  name: 'Vanguard Mega Cap Growth ETF' },
  { symbol: 'IWY',  name: 'iShares Russell Top 200 Growth ETF' },
  // Index trackers
  { symbol: 'QQQ',  name: 'Invesco QQQ Trust' },
  { symbol: 'SPY',  name: 'SPDR S&P 500 ETF' },
  { symbol: 'IVV',  name: 'iShares Core S&P 500 ETF' },
  { symbol: 'VOO',  name: 'Vanguard S&P 500 ETF' },
  { symbol: 'DIA',  name: 'SPDR Dow Jones Industrial Average ETF' },
  { symbol: 'IWM',  name: 'iShares Russell 2000 ETF' },
  { symbol: 'OEF',  name: 'iShares S&P 100 ETF' },
  { symbol: 'XLG',  name: 'Invesco Top 50 ETF' },
  // Sector SPDRs for context
  { symbol: 'XLV',  name: 'Health Care Select Sector SPDR' },
  { symbol: 'XLF',  name: 'Financial Select Sector SPDR' },
  { symbol: 'XLE',  name: 'Energy Select Sector SPDR' },
  { symbol: 'XLI',  name: 'Industrial Select Sector SPDR' },
  { symbol: 'XLY',  name: 'Consumer Discretionary Select Sector SPDR' },
  { symbol: 'XLP',  name: 'Consumer Staples Select Sector SPDR' },
  { symbol: 'XLC',  name: 'Communication Services Select Sector SPDR' },
  { symbol: 'XLU',  name: 'Utilities Select Sector SPDR' },
  { symbol: 'XLB',  name: 'Materials Select Sector SPDR' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR' },
]

// ETFs, not futures: continuous futures went negative in 2020 (crude), and a
// return from a negative price is meaningless. The futures-backed funds
// (USO, UNG, DBA, DBC) lose value rolling contracts, which is part of
// their story here.
const COMMODITIES = [
  { symbol: 'GLD',  name: 'SPDR Gold Shares' },
  { symbol: 'SLV',  name: 'iShares Silver Trust' },
  { symbol: 'PPLT', name: 'abrdn Platinum ETF' },
  { symbol: 'PALL', name: 'abrdn Palladium ETF' },
  { symbol: 'CPER', name: 'United States Copper Index Fund' },
  { symbol: 'USO',  name: 'United States Oil Fund' },
  { symbol: 'UNG',  name: 'United States Natural Gas Fund' },
  { symbol: 'DBA',  name: 'Invesco DB Agriculture Fund' },
  { symbol: 'DBC',  name: 'Invesco DB Commodity Index Tracking Fund' },
]

// Oldest first, by launch. Yahoo's daily history starts in 2014 for
// bitcoin and late 2017 for most of the rest, so the rows are shorter
// than the coins are old.
const CRYPTO = [
  { symbol: 'BTC-USD',  name: 'Bitcoin' },
  { symbol: 'LTC-USD',  name: 'Litecoin' },
  { symbol: 'XRP-USD',  name: 'XRP' },
  { symbol: 'DOGE-USD', name: 'Dogecoin' },
  { symbol: 'XMR-USD',  name: 'Monero' },
  { symbol: 'XLM-USD',  name: 'Stellar' },
  { symbol: 'ETH-USD',  name: 'Ethereum' },
  { symbol: 'ETC-USD',  name: 'Ethereum Classic' },
  { symbol: 'ZEC-USD',  name: 'Zcash' },
  { symbol: 'BNB-USD',  name: 'BNB' },
  { symbol: 'BCH-USD',  name: 'Bitcoin Cash' },
]

// Build the canonical list. Stock entries get bare symbols; we look up
// names from Yahoo when fetching. ETFs and commodities have hardcoded
// names for stability.
function buildUniverse() {
  const seen = new Set()
  const out = []
  function push(symbol, name, category) {
    const sym = symbol.toUpperCase()
    if (seen.has(sym)) return
    seen.add(sym)
    out.push({ symbol: sym, name: name || null, category })
  }
  for (const s of STOCKS_NDX_OR_SP100) push(s, null, 'stock')
  for (const s of STOCKS_EXTRA_SEMIS) push(s, null, 'stock')
  for (const e of ETFS_TECH_AND_GROWTH) push(e.symbol, e.name, 'etf')
  for (const e of COMMODITIES)         push(e.symbol, e.name, 'commodity')
  for (const e of CRYPTO)              push(e.symbol, e.name, 'crypto')
  return out
}

export const UNIVERSE = buildUniverse()
