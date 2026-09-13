/**
 * Extract text from PDF files using pdfjs-dist.
 * Works for digitally-generated PDFs (not scanned images).
 */

export interface PdfExtractionResult {
  text: string
  pageCount: number
}

/**
 * Extract all text from a PDF buffer.
 * Returns concatenated text from all pages.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  // `pdfjs-dist` inicializa APIs de canvas durante la evaluación del módulo.
  // Cargarlo sólo al extraer un PDF evita que una dependencia nativa ausente
  // derribe rutas que no usan este flujo (incluido el render de solicitudes).
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const data = new Uint8Array(buffer)

  const doc = await getDocument({ data }).promise
  const pageCount = doc.numPages
  const textParts = await Promise.all(Array.from({ length: pageCount }, async (_, index) => {
    const page = await doc.getPage(index + 1)
    const content = await page.getTextContent()
    return linesFromTextItems(content.items)
  }))

  // Cleanup (destroy may not exist in all pdfjs-dist versions)
  try { await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.() } catch { /* ignore */ }

  return {
    text: textParts.join("\n"),
    pageCount,
  }
}

/**
 * Reconstruye las filas del documento a partir de los fragmentos sueltos que entrega
 * pdfjs.
 *
 * Antes se unía todo con un espacio: una factura de una página quedaba como **una sola
 * línea**, y `invoice-text-parser` —que busca las líneas de detalle recorriendo
 * `text.split(/\n/)`— no encontraba ninguna. El efecto no era cosmético: con la cabecera
 * legible pero sin líneas, `invoice-extractor` cae a OCR, así que toda factura PDF
 * digital pagaba el costo completo del OCR teniendo una capa de texto perfecta.
 *
 * El agrupado es por geometría y no por `hasEOL` porque esa marca depende del generador
 * del PDF; la posición siempre está. `transform[5]` es la coordenada vertical y
 * `transform[4]` la horizontal, con el origen abajo a la izquierda: de ahí que las filas
 * se ordenen por Y **descendente** y las columnas por X ascendente. Ordenar importa
 * porque el orden de dibujo no es el orden de lectura —un pie de página puede emitirse
 * antes que su cabecera.
 */
function linesFromTextItems(items: ReadonlyArray<unknown>): string {
  /** Tolerancia vertical, en puntos: subíndices y cambios de tipografía mueven la Y de una misma fila. */
  const SAME_LINE_TOLERANCE = 2

  const rows: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = []
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue
    const { str, transform } = item as { str: string; transform?: number[] }
    if (typeof str !== "string" || str.length === 0) continue
    const x = transform?.[4] ?? 0
    const y = transform?.[5] ?? 0

    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= SAME_LINE_TOLERANCE)
    if (row) row.parts.push({ x, text: str })
    else rows.push({ y, parts: [{ x, text: str }] })
  }

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.parts
      .sort((left, right) => left.x - right.x)
      .map((part) => part.text)
      .join(" ")
      // pdfjs intercala fragmentos de espaciado entre columnas; sin esto una fila de
      // tabla llega con rachas de espacios que corren los grupos de los patrones.
      .replace(/\s+/g, " ")
      .trim())
    .filter((row) => row.length > 0)
    .join("\n")
}
