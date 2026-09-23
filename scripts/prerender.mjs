// Runs after `vite build`. Bakes the loading view into dist/index.html:
// the masthead, every ticker in featured order, and the notes. The price
// data still loads in the browser, but crawlers, unfurlers, and a slow
// connection get real content instead of `<div id="root"></div>`.
//
// The ticker list the markup was rendered from goes into the page too,
// so the first client render matches and main.jsx can hydrate onto it.
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from '../package.json' with { type: 'json' }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://drewhoover.com'
const SITE = `${ORIGIN}/${pkg.name}/`
const OUT = path.join(ROOT, 'dist/index.html')
const TITLE = 'Should You Buy an All-Time High?'

// vite build copies public/data (written by fetch-data) into dist/data.
const full = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/data/index.json'), 'utf8'))
const initialIndex = {
  generatedAt: full.generatedAt,
  tickers: full.tickers.map(({ symbol, name, category }) => ({ symbol, name, category })),
}

const vite = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
})
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const appHtml = renderToString(React.createElement(App, { initialIndex }))
await vite.close()

let html = fs.readFileSync(OUT, 'utf8')

// Throw rather than no-op: a Vite change that renames the marker would
// otherwise quietly ship an empty page again.
if (!html.includes('<div id="root"></div>')) {
  throw new Error('prerender: could not find an empty #root in dist/index.html')
}

const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': SITE,
      url: SITE,
      name: TITLE,
      description,
      isPartOf: { '@type': 'WebSite', url: `${ORIGIN}/`, name: 'drewhoover.com' },
      dateModified: full.generatedAt,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'drewhoover.com', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: TITLE, item: SITE },
      ],
    },
    {
      '@type': 'ItemList',
      name: 'Tickers on the board',
      numberOfItems: initialIndex.tickers.length,
      itemListElement: initialIndex.tickers.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t.name ? `${t.symbol}: ${t.name}` : t.symbol,
      })),
    },
  ],
}

// `<` escaped so neither blob can close its <script> early.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c')

html = html.replace('</head>', `    <script type="application/ld+json">${safeJson(jsonLd)}</script>\n  </head>`)
html = html.replace(
  '<div id="root"></div>',
  `<div id="root">${appHtml}</div>\n    <script type="application/json" id="initial-index">${safeJson(initialIndex)}</script>`,
)
fs.writeFileSync(OUT, html)

// Single-page sitemap: what Search Console wants submitted, and it carries lastmod.
fs.writeFileSync(
  path.join(ROOT, 'dist/sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${full.generatedAt.slice(0, 10)}</lastmod>
  </url>
</urlset>
`,
)

const words = appHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
console.log(`prerendered ${(appHtml.length / 1024).toFixed(0)}KB into #root (~${words} words, ${initialIndex.tickers.length} tickers)`)
