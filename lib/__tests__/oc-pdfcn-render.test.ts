/**
 * Render real con Takumi: sin mocks y sin navegador. Arranca el wasm, así que es
 * más lento que un test puro, pero es lo único que prueba que el documento sale
 * legible en vez de sólo bien tipado.
 */
import { describe, expect, it } from "vitest"
import { renderOcPdf } from "@/app/(print)/compras/[id]/print/oc-pdfcn-render"
import type { OcPrintData } from "@/app/(print)/compras/[id]/print/oc-print-data"

/**
 * `extraNotes` sube la altura de una fila concreta: la paginación mide el
 * fragmento que después dibuja, así que un documento donde todas las filas miden
 * lo mismo no prueba nada sobre el reparto real.
 */
function makeData(itemCount: number, extraNotes: (index: number) => number = () => 0): OcPrintData {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `it-${i}`,
    productId: "p-1",
    productNameFree: null,
    quantity: i + 1,
    unitOfMeasure: "unidad",
    unitPrice: 12_500,
    discount: null,
    subtotal: (i + 1) * 12_500,
    notes: null,
    sortOrder: i,
    requestItem: {
      equipment: { code: `EQ-${i}`, name: "Retroexcavadora", serialNumber: `SN-${i}` },
      worker: null,
      attributes: [
        { id: `a-${i}`, attributeName: "Talla", value: "L" },
        ...Array.from({ length: extraNotes(i) }, (_unused, k) => ({
          id: `a-${i}-${k}`,
          attributeName: `Observación ${k}`,
          value: "detalle adicional de la línea",
        })),
      ],
    },
  }))

  return {
    order: {
      id: "oc-1",
      code: "OC-2026-0001",
      netAmount: 100_000,
      taxAmount: 19_000,
      totalAmount: 119_000,
      paymentTerms: "30 días",
      notes: null,
      items,
      supplier: {
        name: "Ferretería Andina Ltda.",
        businessActivity: "Venta de insumos",
        address: "Av. Siempre Viva 123",
        commune: "Antofagasta",
        city: "Antofagasta",
        rut: "76.000.000-0",
        paymentTerms: "30 días",
      },
      worksite: { name: "Faena Norte" },
    },
    company: {
      name: "CHOME SPA",
      rut: "77.111.222-3",
      businessActivity: "Servicios industriales",
      address: "Ruta 5 Norte km 10",
      branchAddress: "Sucursal Sur",
      phone: "+56 55 000 0000",
      email: "contacto@chome.cl",
      website: "chome.cl",
    },
    productMap: { "p-1": { id: "p-1", sku: "SKU-9", name: "Guante de cuero" } },
    issuedDate: "05-09-2026",
    authorizedByName: "Ana Pérez",
    authorizedDate: "05-09-2026",
    suggestedFilename: "OC 2026-0001.pdf",
    requestCodes: ["01"],
    orderDetailLines: ["enviar a Ruta 5 Norte km 10", "NP 01"],
    totalInWords: "SON: CIENTO DIECINUEVE MIL PESOS",
  } as unknown as OcPrintData
}

async function parse(bytes: Uint8Array) {
  const { PDFParse } = await import("pdf-parse")
  const buf = Buffer.from(bytes)
  const parser = new PDFParse({ data: buf })
  try {
    const result = await parser.getText()
    return {
      pageCount: result.total,
      pages: result.pages.map((page) => page.text),
      text: result.text,
      bytes: buf,
    }
  } finally {
    await parser.destroy()
  }
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe("renderOcPdf", () => {
  it("produce un PDF con el contenido de la orden", async () => {
    const { pageCount, text, bytes } = await parse(await renderOcPdf(makeData(3)))

    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(pageCount).toBeGreaterThanOrEqual(1)

    expect(text).toContain("Orden de Compra")
    expect(text).toContain("2026-0001")
    expect(text).toContain("CHOME SPA")
    expect(text).toContain("Ferretería Andina Ltda.")
    expect(text).toContain("Guante de cuero")
    expect(text).toContain("SON: CIENTO DIECINUEVE MIL PESOS")
    expect(text).toContain("Autorización de emisión")
  }, 30_000)

  it("arrastra las sub-notas del Detalle al documento", async () => {
    const { text } = await parse(await renderOcPdf(makeData(1)))
    expect(text).toContain("Equipo: EQ-0")
    expect(text).toContain("Talla: L")
  }, 30_000)

  it("conserva las cadenas visibles de la vista Chromium", async () => {
    const { text } = await parse(await renderOcPdf(makeData(1)))

    expect(text).toContain("Otras Direcciones o Sucursales:")
    expect(text).toContain("Señor(es):")
    expect(text).toContain("$ 100.000")
  }, 30_000)

  it("repite caption y cabeceras en cada página que contiene ítems", async () => {
    const { pageCount, pages } = await parse(await renderOcPdf(makeData(45)))
    const itemPages = pages.filter((page) => page.includes("P. Unitario"))

    expect(pageCount).toBeGreaterThan(1)
    expect(itemPages.length).toBeGreaterThan(1)
    for (const page of itemPages) {
      expect(page).toContain("N°")
      expect(page).toContain("Cod.")
      expect(page).toContain("Articulo")
      expect(page).toContain("Detalle")
      expect(page).toContain("Orden de Compra")
    }
  }, 60_000)

  // Con filas de altura dispar, un corte calculado con un «filas por hoja» fijo
  // —o una pista que no se corrige hacia abajo— desborda a la hoja siguiente, y
  // esa hoja queda con ítems pero sin caption ni cabecera.
  it.each([
    ["alternando líneas cortas y largas", 40, (i: number) => (i % 2 === 0 ? 0 : 12)],
    ["ráfagas de líneas muy largas",      60, (i: number) => (i % 7 === 0 ? 15 : 0)],
    ["altura creciente",                  40, (i: number) => i % 20],
  ])("reparte filas de altura dispar: %s", async (_name, count, extraNotes) => {
    const { pages } = await parse(await renderOcPdf(makeData(count, extraNotes)))

    // Una hoja con importes de línea pero sin la cabecera es un corte perdido.
    const huerfanas = pages.filter((page) =>
      page.includes("Guante de cuero") && !page.includes("P. Unitario"),
    )
    expect(huerfanas).toEqual([])
    expect(pages.filter((page) => page.includes("P. Unitario")).length).toBeGreaterThan(1)
  }, 120_000)

  // Un fragmento que mide EXACTAMENTE el alto útil deja el flujo parado en el
  // borde de la hoja, y entonces el `breakBefore: page` del fragmento siguiente
  // suma un segundo salto: sale una hoja en blanco entre medio.
  it.each([14, 16, 18, 20, 22, 24, 28])("no deja hojas en blanco (%i líneas)", async (count) => {
    const { pages } = await parse(await renderOcPdf(makeData(count, (i) => (i % 3 === 0 ? 4 : 0))))

    const enBlanco = pages
      .map((page, index) => ({ index, texto: page.replace(/Página\s*\d+\s*de\s*\d+/g, "").trim() }))
      .filter((page) => page.texto.length < 40)
    expect(enBlanco).toEqual([])
  }, 120_000)

  // La paginación mide sólo la tabla, así que llenaba la última hoja hasta el
  // tope y el cierre —observaciones, totales y firma— se iba solo a una hoja
  // nueva casi en blanco. Ahora ese bloque se mide junto al fragmento final.
  it.each([18, 22, 26, 31])("cierra el documento en la última hoja de ítems (%i líneas)", async (count) => {
    const { pages } = await parse(await renderOcPdf(makeData(count, (i) => (i % 3 === 0 ? 4 : 0))))

    const cierre = pages.filter((page) => page.includes("Autorización de emisión"))
    expect(cierre).toHaveLength(1)
    // La hoja del cierre trae también la tabla: no es una hoja suelta de firma.
    expect(cierre[0]).toContain("P. Unitario")
  }, 120_000)

  it("pagina y numera cada hoja con el mismo texto que la rama Chromium", async () => {
    const { pageCount, text } = await parse(await renderOcPdf(makeData(45)))

    expect(pageCount).toBeGreaterThan(1)
    expect(occurrences(text, "Página")).toBeGreaterThanOrEqual(pageCount)
    expect(text).toContain(`de ${pageCount}`)
    // El bloque de firma cierra el documento: no se repite por hoja.
    expect(occurrences(text, "Autorización de emisión")).toBe(1)
  }, 60_000)

  it("dice 'Por definir' y avisa cuando una línea no tiene precio", async () => {
    const data = makeData(2)
    const items = data.order.items as unknown as { unitPrice: number | null; subtotal: number | null }[]
    items[0]!.unitPrice = null
    items[0]!.subtotal = null

    const { text } = await parse(await renderOcPdf(data))
    expect(text).toContain("Por definir")
    expect(text).toContain("1 servicio con costo por definir")
    expect(text).toContain("Total conocido")
  }, 30_000)
})
