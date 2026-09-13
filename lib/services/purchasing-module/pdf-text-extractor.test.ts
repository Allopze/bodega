import { jsPDF } from "jspdf"
import { describe, expect, it } from "vitest"
import { extractTextFromPdf } from "./pdf-text-extractor"

/**
 * El extractor unía **todos** los fragmentos de una página con un espacio y sólo
 * separaba con salto entre páginas, así que una factura de una página salía como una
 * única línea. `invoice-text-parser` reconoce las líneas de detalle recorriendo
 * `text.split(/\n/)`, de modo que nunca encontraba ninguna: toda factura PDF digital
 * caía al OCR aunque su capa de texto fuera perfecta.
 */

function pdfWithLines(lines: string[], options?: { fontSize?: number }): Buffer {
  const doc = new jsPDF()
  doc.setFontSize(options?.fontSize ?? 12)
  let y = 20
  for (const line of lines) {
    if (line) doc.text(line, 14, y)
    y += 10
  }
  return Buffer.from(doc.output("arraybuffer"))
}

describe("extractTextFromPdf", () => {
  it("conserva una línea del documento por línea de texto", async () => {
    const lines = [
      "Factura Electronica N° 3064428",
      "Fecha: 14/07/2026",
      "GUANTE CABRITILLA T9 10 2.500 25.000",
      "TOTAL 68.425",
    ]

    const { text } = await extractTextFromPdf(pdfWithLines(lines))

    expect(text.split("\n").map((line) => line.trim()).filter(Boolean)).toEqual(lines)
  })

  it("reúne en una sola línea los fragmentos que comparten altura", async () => {
    // Un generador real emite una factura como muchos fragmentos sueltos por fila
    // (una celda por columna), no como una cadena por línea.
    const doc = new jsPDF()
    doc.setFontSize(12)
    doc.text("GUANTE CABRITILLA T9", 14, 40)
    doc.text("10", 120, 40)
    doc.text("2.500", 140, 40)
    doc.text("25.000", 170, 40)
    doc.text("TOTAL 68.425", 14, 60)

    const { text } = await extractTextFromPdf(Buffer.from(doc.output("arraybuffer")))
    const rows = text.split("\n").map((line) => line.trim()).filter(Boolean)

    expect(rows).toEqual(["GUANTE CABRITILLA T9 10 2.500 25.000", "TOTAL 68.425"])
  })

  it("ordena las líneas de arriba hacia abajo, no por orden de dibujo", async () => {
    const doc = new jsPDF()
    doc.setFontSize(12)
    // Se dibuja el pie antes que la cabecera a propósito.
    doc.text("TOTAL 68.425", 14, 80)
    doc.text("Factura Electronica N° 3064428", 14, 20)

    const { text } = await extractTextFromPdf(Buffer.from(doc.output("arraybuffer")))

    expect(text.split("\n").map((line) => line.trim()).filter(Boolean))
      .toEqual(["Factura Electronica N° 3064428", "TOTAL 68.425"])
  })

  it("informa el número de páginas", async () => {
    const { pageCount } = await extractTextFromPdf(pdfWithLines(["una sola página"]))
    expect(pageCount).toBe(1)
  })
})
