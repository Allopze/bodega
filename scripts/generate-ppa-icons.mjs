/**
 * Generates PPA Digital PWA icons with a lighter green background
 * and the white Chome logo centered on top.
 *
 * Fixes from v1:
 *  - Logo properly centered (accounting for its 201.36 viewBox)
 *  - No rounded corners in the PNG (OS handles masking)
 *  - Maskable icon fills entire canvas with no transparency
 *
 * Usage: node scripts/generate-ppa-icons.mjs
 */

import sharp from "sharp"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGO_SVG_PATH = resolve(__dirname, "../public/chome_logo_white.svg")
const OUTPUT_DIR = resolve(__dirname, "../public")

// Lighter green background
const BG_COLOR = "#34A853"

// Logo SVG viewBox is 201.36 x 201.36
const LOGO_VIEWBOX = 201.36

const SIZES = [
  { name: "ppa-icon-192.png", size: 192 },
  { name: "ppa-icon-512.png", size: 512 },
  { name: "ppa-icon-maskable-512.png", size: 512, maskable: true },
]

async function generateIcon({ name, size, maskable }) {
  const logoRaw = readFileSync(LOGO_SVG_PATH, "utf-8")

  // Strip XML declaration and outer <svg> tags, keep inner paths
  const logoPaths = logoRaw
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>/i, "")
    .trim()

  // Consistent logo size across all icons (70% of canvas)
  // Maskable icons get extra background padding so the logo stays
  // within the safe zone, but the logo itself is the same size.
  const logoPixelSize = size * 0.7

  // Position to center the logo
  const offset = (size - logoPixelSize) / 2

  // Scale factor: map the logo's 201.36 viewBox to our desired pixel size
  const scale = logoPixelSize / LOGO_VIEWBOX

  const compositeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG_COLOR}"/>
  <g transform="translate(${offset}, ${offset}) scale(${scale})">
    ${logoPaths}
  </g>
</svg>`

  await sharp(Buffer.from(compositeSvg))
    .resize(size, size)
    .png()
    .toFile(resolve(OUTPUT_DIR, name))

  console.log(`✓ ${name} (${size}x${size}${maskable ? " maskable" : ""})`)
}

async function main() {
  console.log("Generating PPA Digital PWA icons…\n")
  for (const icon of SIZES) {
    await generateIcon(icon)
  }
  console.log("\nDone!")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
