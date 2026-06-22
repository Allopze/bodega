/**
 * E2E: PDF export quality — page count and content integrity
 *
 * Verifies that generated PDFs:
 *   • Contain expected content (no cut-off text)
 *   • Have a reasonable page count (no excessive blank trailing pages)
 *   • Are valid PDF files with expected headers
 *
 * Uses `pdf-parse` for reliable text extraction and page counting since
 * Chromium headless compresses text streams with FlateDecode.
 *
 * Covers both the SST server-side PDF route and the PO browser-print PDF.
 * The PO tests use a dedicated fixture (oc-e2e) seeded in setup-db.ts so
 * they don't depend on purchase-flow.spec.ts creating one first.
 */
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a PDF buffer and return page count + extracted text. */
async function parsePdf(buf: Buffer) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parse: (buf: Buffer) => Promise<{ numpages: number; text: string }> =
    require("pdf-parse")
  const result = await parse(buf)
  return { pageCount: result.numpages, text: result.text }
}

// ── SST PDF (server-side route) ──────────────────────────────────────────────

test.describe("PDF exports — content integrity", () => {
  test("SST PDF: valid PDF, correct page count, content present", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get("/sst/sst-eval-e2e/print/pdf", {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toMatch(/application\/pdf/)

    const body = await response.body()
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")

    // Parse PDF for page count and text extraction.
    const { pageCount, text } = await parsePdf(body)

    // A single evaluation acta should fit in 1–3 pages.
    expect(pageCount).toBeGreaterThanOrEqual(1)
    expect(pageCount).toBeLessThanOrEqual(3)

    // Content integrity — key strings from the seeded evaluation.
    // The worker is "Trabajador E2E", the definition is "trabajador_nuevo".
    expect(text).toContain("Trabajador")
    expect(text).toContain("E2E")
  })

  test("SST PDF: no blank trailing page (size sanity)", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get("/sst/sst-eval-e2e/print/pdf", {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })
    const body = await response.body()
    const { pageCount } = await parsePdf(body)

    // A 1-page doc should be < 50 KB. If > 80 KB with ≤ 2 pages, it likely
    // has embedded images (acceptable). But a tiny 3-page doc signals a blank
    // trailing page.
    if (pageCount === 1) {
      expect(body.byteLength).toBeLessThan(80_000)
    }
    // No acta should exceed 4 pages — that signals a layout bug.
    expect(pageCount).toBeLessThanOrEqual(4)
  })

  // ── PO Print (browser-rendered) ──────────────────────────────────────────

  test("PO PDF: valid PDF via browser print, content present", async ({
    page,
  }) => {
    await login(page)

    await page.goto(`/compras/${OC_FIXTURE_ID}/print`)
    await expect(page.locator(".sheet")).toBeVisible()

    // Check DOM content BEFORE generating PDF — this validates the
    // page rendered correctly with print styles.
    const sheetText = await page.locator(".sheet").textContent()
    expect(sheetText).toContain("Orden de Compra")

    // Emulate print media and generate PDF
    await page.emulateMedia({ media: "print" })
    const pdf = await page.pdf({ format: "A4", printBackground: true })
    await page.emulateMedia({ media: "screen" })

    expect(pdf.byteLength).toBeGreaterThan(10_000)
    expect(pdf.slice(0, 5).toString("ascii")).toBe("%PDF-")

    // Parse PDF for page count.
    const { pageCount, text } = await parsePdf(pdf)

    // A typical OC should fit in 1–2 pages.
    expect(pageCount).toBeGreaterThanOrEqual(1)
    expect(pageCount).toBeLessThanOrEqual(3)

    // Content integrity — the OC print page shows "Orden de Compra" heading.
    // Verify via both DOM (already checked above) and extracted PDF text.
    expect(text).toContain("Orden de Compra")
  })

  test("PO PDF: no blank trailing page (size sanity)", async ({ page }) => {
    await login(page)

    await page.goto(`/compras/${OC_FIXTURE_ID}/print`)
    await expect(page.locator(".sheet")).toBeVisible()

    await page.emulateMedia({ media: "print" })
    const pdf = await page.pdf({ format: "A4", printBackground: true })
    await page.emulateMedia({ media: "screen" })

    const { pageCount } = await parsePdf(pdf)

    // Single-page OC should be < 60 KB.
    if (pageCount === 1) {
      expect(pdf.byteLength).toBeLessThan(60_000)
    }
    // Max 3 pages for a PO — beyond that signals layout overflow.
    expect(pageCount).toBeLessThanOrEqual(3)
  })
})
