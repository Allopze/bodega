/**
 * Standalone script to generate test PDFs for visual inspection.
 * Run with: npx tsx scripts/generate-test-pdfs.ts
 *
 * Requires the dev server to be running on http://localhost:3000.
 */
import { chromium } from "playwright"
import fs from "node:fs"
import path from "node:path"

const BASE = process.env.APP_URL ?? "http://localhost:3000"
const OUT_DIR = "/tmp/pdf-exports"

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()

  // ── Login ────────────────────────────────────────────────────────────────
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { timeout: 30_000 })
  await page.waitForSelector('#email', { timeout: 10_000 })
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await page.waitForURL("**/dashboard", { timeout: 15_000 })
  console.log("✓ Logged in")

  // ── SST PDF (server-side route) ──────────────────────────────────────────
  console.log("→ Fetching SST PDF via /sst/sst-eval-e2e/print/pdf ...")
  const sstResponse = await page.request.get("/sst/sst-eval-e2e/print/pdf")
  if (sstResponse.status() === 200) {
    const sstBody = await sstResponse.body()
    const sstPath = path.join(OUT_DIR, "sst-acta.pdf")
    fs.writeFileSync(sstPath, sstBody)
    console.log(`✓ SST PDF saved: ${sstPath} (${(sstBody.byteLength / 1024).toFixed(1)} KB)`)
  } else {
    console.log(`✗ SST PDF failed: HTTP ${sstResponse.status()}`)
    // Try navigating to the print page instead
    console.log("  Falling back to browser print for SST...")
    await page.goto(`${BASE}/sst/sst-eval-e2e/print`)
    await page.waitForTimeout(2000)
    await page.emulateMedia({ media: "print" })
    const sstPdf = await page.pdf({ format: "A4", printBackground: true })
    await page.emulateMedia({ media: "screen" })
    const sstPath = path.join(OUT_DIR, "sst-acta.pdf")
    fs.writeFileSync(sstPath, sstPdf)
    console.log(`✓ SST PDF saved (browser print): ${sstPath} (${(sstPdf.byteLength / 1024).toFixed(1)} KB)`)
  }

  // ── PO Print page (browser-rendered) ─────────────────────────────────────
  console.log("→ Looking for a purchase order to generate PO PDF...")
  await page.goto(`${BASE}/compras`)

  // Find first OC link
  const ocLink = page.getByRole("link", { name: /OC-|Ver detalle/ }).first()
  const hasOc = await ocLink.isVisible({ timeout: 5000 }).catch(() => false)

  if (hasOc) {
    const href = await ocLink.getAttribute("href")
    const match = href?.match(/\/compras\/([^/]+)/)
    if (match) {
      const orderId = match[1]
      console.log(`  Found OC: ${orderId}`)
      await page.goto(`${BASE}/compras/${orderId}/print`)
      await page.waitForSelector(".sheet", { timeout: 10000 })

      // Wait for fonts/images to load
      await page.waitForTimeout(1000)

      await page.emulateMedia({ media: "print" })
      const poPdf = await page.pdf({ format: "A4", printBackground: true })
      await page.emulateMedia({ media: "screen" })

      const poPath = path.join(OUT_DIR, `po-${orderId}.pdf`)
      fs.writeFileSync(poPath, poPdf)
      console.log(`✓ PO PDF saved: ${poPath} (${(poPdf.byteLength / 1024).toFixed(1)} KB)`)

      // Also save the SST print page as browser PDF for comparison
      console.log("→ Generating SST browser-print PDF for comparison...")
      await page.goto(`${BASE}/sst/sst-eval-e2e/print`)
      await page.waitForSelector(".sheet", { timeout: 10000 })
      await page.waitForTimeout(1000)
      await page.emulateMedia({ media: "print" })
      const sstBrowserPdf = await page.pdf({ format: "A4", printBackground: true })
      await page.emulateMedia({ media: "screen" })
      const sstBrowserPath = path.join(OUT_DIR, "sst-acta-browser-print.pdf")
      fs.writeFileSync(sstBrowserPath, sstBrowserPdf)
      console.log(`✓ SST browser-print PDF saved: ${sstBrowserPath} (${(sstBrowserPdf.byteLength / 1024).toFixed(1)} KB)`)
    }
  } else {
    console.log("  No purchase orders found — skipping PO PDF")
  }

  await browser.close()

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n═══ PDFs saved to ${OUT_DIR} ═══`)
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith(".pdf"))
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT_DIR, f))
    console.log(`  ${f}  (${(stat.size / 1024).toFixed(1)} KB)`)
  }
  console.log("\nOpen these files to visually inspect page-break rules and layouts.")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
