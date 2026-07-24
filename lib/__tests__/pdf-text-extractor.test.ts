import { describe, expect, it } from "vitest"
import { extractTextFromPdf } from "@/lib/services/purchasing-module/pdf-text-extractor"

/**
 * Construye un PDF mínimo pero válido con una línea de texto. Se genera aquí en
 * vez de usar un fixture para no meter datos reales de `storage/` al repo.
 */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj${o}endobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, "latin1")
}

describe("extractTextFromPdf()", () => {
  // Regresión: el build por defecto de pdfjs-dist asume APIs de navegador y
  // lanza "DOMMatrix is not defined" al cargarse bajo Node, así que la
  // extracción de facturas estaba rota en el servidor. Debe usarse el legacy.
  it("extrae texto de un PDF bajo Node", async () => {
    const result = await extractTextFromPdf(minimalPdf("FACTURA 12345 NETO 99000"))

    expect(result.pageCount).toBe(1)
    expect(result.text).toContain("FACTURA 12345")
    expect(result.text).toContain("99000")
  })
})
