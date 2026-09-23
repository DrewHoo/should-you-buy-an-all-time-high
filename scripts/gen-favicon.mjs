// Generate favicon assets from a single SVG source. Run with:
//   node scripts/gen-favicon.mjs
// Writes:
//   public/favicon.svg          — modern browsers (vector, any size)
//   public/favicon-32.png       — generic small-pixel fallback
//   public/favicon-192.png      — Android, PWA
//   public/apple-touch-icon.png — iOS home-screen icon (180x180)

import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

// Cream paper square with a five-tick slice of a board row, running the
// page's return scale (src/chart-utils.js RETURN_COLORS.light): dark red below
// 7%/yr, neutral at it, dollar-bill green above.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#f1ead6"/>
  <line x1="12" y1="16" x2="12" y2="48" stroke="#971b1a" stroke-width="7" stroke-linecap="round"/>
  <line x1="22.5" y1="16" x2="22.5" y2="48" stroke="#a9a49c" stroke-width="7" stroke-linecap="round"/>
  <line x1="33" y1="16" x2="33" y2="48" stroke="#57914a" stroke-width="7" stroke-linecap="round"/>
  <line x1="43.5" y1="16" x2="43.5" y2="48" stroke="#57914a" stroke-width="7" stroke-linecap="round"/>
  <line x1="54" y1="16" x2="54" y2="48" stroke="#57914a" stroke-width="7" stroke-linecap="round"/>
</svg>`

writeFileSync(resolve(outDir, 'favicon.svg'), svg + '\n')
console.log('wrote favicon.svg')

const png = [
  { name: 'favicon-32.png',       size: 32 },
  { name: 'favicon-192.png',      size: 192 },
  { name: 'apple-touch-icon.png', size: 180 },
]
for (const { name, size } of png) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, name))
  console.log(`wrote ${name}`)
}
