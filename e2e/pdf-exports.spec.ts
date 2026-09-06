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
 * Covers both the SST and PO server-side PDF routes. The PO tests use a
 * dedicated fixture (oc-e2e) seeded in setup-db.ts so they don't depend on
 * purchase-flow.spec.ts creating one first.
 */
import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"
const OC_MULTIPAGE_FIXTURE_ID = "oc-multipagina-e2e"
const DELIVERY_FIXTURE_ID = "del-e2e"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a PDF buffer and return page count + extracted text. */
async function parsePdf(buf: Buffer) {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: buf })
  try {
    const result = await parser.getText()
    return {
      pageCount: result.total,
      pages: result.pages.map((page) => page.text),
      text: result.text,
    }
  } finally {
    await parser.destroy()
  }
}

/** Cuántas veces aparece un literal en el texto extraído. */
function occurrences(text: string, needle: string) {
  return text.split(needle).length - 1
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
    expect(response.url()).toMatch(/\/sst\/sst-eval-e2e\/print\/pdf$/)
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

  // ── PO PDF (server-side route) ────────────────────────────────────────────

  test("PO PDF: valid PDF, single page, content present, OC filename", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get(`/compras/${OC_FIXTURE_ID}/print/pdf`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toMatch(/application\/pdf/)

    // Filename must follow the "OC {número}" format (fixture code OC-2026-0001).
    expect(response.headers()["content-disposition"]).toContain('filename="OC 2026-0001.pdf"')

    const body = await response.body()
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")

    // Parse PDF for page count + content.
    const { pageCount, text } = await parsePdf(body)

    // The OC fixture has 2 line items (oc-item-e2e-01/02) and must still fit in exactly 1 page.
    expect(pageCount).toBe(1)
    expect(text).toMatch(/ORDEN DE COMPRA/i)
    expect(text).toContain("Talla: L")
    expect(text).toContain("Color: Azul")
    // RUT y fecha se imprimen como campos indivisibles en A4: la extracción
    // del artefacto descargado verifica que ambos llegaron completos.
    expect(text).toContain("76.000.000-0")
    expect(text).toMatch(/Fecha Emisión\s*:\s*\d{2}-\d{2}-\d{4}/)
    // El pie corrido se numera incluso en documentos de una hoja. Sirve de
    // regresión del font-size 0 con que Chromium renderiza el template.
    expect(text).toContain("Página 1 de 1")
  })

  test("PO PDF: no blank trailing page (size sanity)", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get(`/compras/${OC_FIXTURE_ID}/print/pdf`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })
    const body = await response.body()
    const { pageCount } = await parsePdf(body)

    // OC fixture has 2 line items — must be exactly 1 page with no trailing blank.
    expect(pageCount).toBe(1)
    expect(body.byteLength).toBeLessThan(120_000)
  })

  test("PO PDF multipágina: numeración, encabezado repetido y cierre único", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get(`/compras/${OC_MULTIPAGE_FIXTURE_ID}/print/pdf`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })

    expect(response.status()).toBe(200)

    const { pageCount, text } = await parsePdf(await response.body())

    // 40 ítems no caben en una hoja: es el caso que este spec vigila.
    expect(pageCount).toBeGreaterThanOrEqual(2)

    // Toda hoja se numera y sabe cuántas son.
    expect(text).toContain(`Página 1 de ${pageCount}`)
    expect(text).toContain(`Página 2 de ${pageCount}`)

    // El encabezado de columnas y el título con el número de OC se repiten en
    // cada hoja (thead { display: table-header-group }), así que una página
    // suelta sigue siendo identificable.
    // "Cod. Articulo" se extrae partido en dos líneas: basta la segunda palabra.
    expect(occurrences(text, "Articulo")).toBeGreaterThanOrEqual(2)
    expect(occurrences(text, "2026-0077")).toBeGreaterThanOrEqual(2)

    // El cierre del documento aparece una sola vez, al final.
    // El título va en versalitas por CSS, así que se extrae en mayúsculas.
    expect(occurrences(text, "AUTORIZACIÓN DE EMISIÓN")).toBe(1)
    expect(text).toContain("Insumo multipágina 40")
  })

  test("Delivery PDF: final URL, headers, bytes and stored signature evidence", async ({
    page,
    request,
  }) => {
    await login(page)

    const response = await request.get(`/entregas/${DELIVERY_FIXTURE_ID}/print/pdf`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    })

    expect(response.status()).toBe(200)
    expect(response.url()).toMatch(/\/entregas\/del-e2e\/print\/pdf$/)
    expect(response.headers()["content-type"]).toMatch(/application\/pdf/)
    expect(response.headers()["content-disposition"]).toContain('filename="comprobante-entrega-ENT-2026-0001.pdf"')

    const body = await response.body()
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")

    const { pageCount, text } = await parsePdf(body)
    expect(pageCount).toBeGreaterThanOrEqual(1)
    expect(pageCount).toBeLessThanOrEqual(2)
    expect(text).toContain("Comprobante de Entrega")
    expect(text).toContain("11111111-1")
    // Las entregas nuevas ya no piden firma: la sección "Evidencia histórica"
    // sólo aparece en registros antiguos con `signaturePath`. Este fixture no
    // lo tiene, así que el comprobante no debe inventar un espacio de firma.
    expect(text).not.toContain("Evidencia histórica")
    expect(text).not.toContain("firma")
  })
})

// ── OC con el motor pdfcn/Takumi ─────────────────────────────────────────────

/**
 * El segundo motor se pide con `?motor=pdfcn` en vez de dejar el ajuste
 * `pdf.engine.oc` sembrado: así las aserciones de arriba siguen midiendo la
 * rama Chromium intacta, y las de aquí miden Takumi sobre la misma OC. El
 * override exige `admin:ops_settings`, que la cuenta de e2e tiene.
 */
test.describe("PDF exports — OC con motor pdfcn", () => {
  async function fetchOcPdf(page: import("@playwright/test").Page,
                            request: import("@playwright/test").APIRequestContext,
                            id: string) {
    await login(page)
    const response = await request.get(`/compras/${id}/print/pdf?motor=pdfcn`, {
      headers: {
        cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; "),
      },
    })
    return response
  }

  test("OC pdfcn: PDF válido, mismo nombre de archivo y contenido presente", async ({
    page,
    request,
  }) => {
    const response = await fetchOcPdf(page, request, OC_FIXTURE_ID)

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/pdf")
    // El nombre no depende del motor: es el mismo que produce la rama Chromium.
    expect(response.headers()["content-disposition"]).toContain("OC 2026-0001.pdf")

    const body = await response.body()
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(body.toString("latin1")).toContain("Producer(takumi-pdf 0.14.2)")

    const { pageCount, text } = await parsePdf(body)
    expect(pageCount).toBeGreaterThanOrEqual(1)

    expect(text).toContain("Orden de Compra")
    expect(text).toContain("2026-0001")
    expect(text).toContain("Autorización de emisión")
    // Los atributos del ítem viajan como sub-notas de la celda Detalle.
    expect(text).toContain("Talla")
    expect(text).toContain("Azul")
    // El monto en palabras lo calcula el mismo helper que la vista Chromium.
    expect(text).toContain("SON:")
  })

  test("OC pdfcn multipágina: numera cada hoja y no repite el cierre", async ({
    page,
    request,
  }) => {
    const response = await fetchOcPdf(page, request, OC_MULTIPAGE_FIXTURE_ID)
    expect(response.status()).toBe(200)

    const { pageCount, pages, text } = await parsePdf(await response.body())

    expect(pageCount).toBeGreaterThan(1)
    expect(occurrences(text, "Página")).toBeGreaterThanOrEqual(pageCount)
    expect(text).toContain(`de ${pageCount}`)
    expect(occurrences(text, "Autorización de emisión")).toBe(1)

    const itemPages = pages.filter((pageText) => pageText.includes("P. Unitario"))
    expect(itemPages.length).toBeGreaterThan(1)
    for (const pageText of itemPages) {
      expect(pageText).toContain("Articulo")
      expect(pageText).toContain("Detalle")
      expect(pageText).toContain("Orden de Compra")
    }
  })

  test("sin el override, la misma OC sigue saliendo por Chromium", async ({
    page,
    request,
  }) => {
    // Fija que el ajuste por defecto no cambió al añadir el motor nuevo.
    await login(page)
    const response = await request.get(`/compras/${OC_FIXTURE_ID}/print/pdf`, {
      headers: {
        cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; "),
      },
    })

    expect(response.status()).toBe(200)
    const body = await response.body()
    const { text } = await parsePdf(body)
    expect(text).toContain("ORDEN DE COMPRA")
    expect(body.toString("latin1")).not.toContain("Producer(takumi-pdf 0.14.2)")
  })
})
