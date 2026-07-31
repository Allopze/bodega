/**
 * OCR de facturas ejercitado de verdad: sharp + Tesseract + parser, sin mocks.
 *
 * La auditoría 2026-07-30 dejó abierta justo esta cobertura ("no cubren
 * rasterización real, PDF escaneado, JPG/PNG ni ausencia de traineddata"): los
 * otros tests del módulo simulan el motor, así que un fallback roto en runtime
 * —el P0 de `buffer.transferToFixedLength`— pasaba verde.
 *
 * El documento se genera sintéticamente (SVG → PNG → PDF) en vez de versionar
 * una factura real: un comprobante tributario de un proveedor no debe vivir en
 * el repo. El layout imita el de una factura electrónica chilena para que el
 * parser trabaje contra el texto que produce el OCR, no contra uno inventado.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"

import { extractInvoiceData } from "./invoice-extractor"
import { extractInvoiceTextOcr } from "./invoice-ocr"

const FOLIO = "3064428"

/** Factura sintética con los campos que el parser considera evidencia mínima. */
async function invoicePng(): Promise<Buffer> {
  const line = (y: number, text: string, size = 26) =>
    `<text x="60" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" fill="#000">${text}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="760">
    <rect width="1240" height="760" fill="#fff"/>
    ${line(80, "PROVEEDOR DEMO SPA", 32)}
    ${line(120, "RUT: 96.542.490-3")}
    ${line(170, "FACTURA ELECTRONICA N° " + FOLIO, 30)}
    ${line(210, "Fecha de Emision: 14/07/2026")}
    ${line(300, "CODIGO DESCRIPCION CANTIDAD PRECIO TOTAL", 24)}
    ${line(340, "05-03-008 GUANTE CABRITILLA 50 1.150 57.500", 24)}
    ${line(470, "Neto: 57.500")}
    ${line(510, "IVA 19%: 10.925")}
    ${line(550, "Total: 68.425", 30)}
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Mismo documento "escaneado": la imagen embebida en un PDF sin capa de texto. */
async function scannedInvoicePdf(): Promise<Buffer> {
  const { jsPDF } = await import("jspdf")
  const png = await invoicePng()
  const document = new jsPDF({ unit: "pt", format: [620, 380] })
  document.addImage(`data:image/png;base64,${png.toString("base64")}`, "PNG", 0, 0, 620, 380)
  return Buffer.from(document.output("arraybuffer"))
}

const originalTessdataPath = process.env.INVOICE_OCR_TESSDATA_PATH

afterEach(() => {
  if (originalTessdataPath === undefined) delete process.env.INVOICE_OCR_TESSDATA_PATH
  else process.env.INVOICE_OCR_TESSDATA_PATH = originalTessdataPath
})

describe("OCR real de una imagen de factura", () => {
  it("lee el documento con el modelo local y sin red", async () => {
    const result = await extractInvoiceTextOcr(await invoicePng())

    expect(result.warning).toBeUndefined()
    expect(result.pageCount).toBe(1)
    expect(result.confidence).toBeGreaterThan(0.4)
    expect(result.text).toContain(FOLIO)
  }, 120_000)

  it("entrega folio, fecha y total al formulario", async () => {
    const result = await extractInvoiceData(await invoicePng(), "image/png", "factura.png")

    expect(result.method).toBe("ocr")
    expect(result.data?.invoiceNumber).toBe(FOLIO)
    expect(result.data?.issueDate).toBe("2026-07-14")
    expect(result.data?.totalAmount).toBe(68425)
  }, 120_000)

  it("no promete nada cuando falta el modelo local", async () => {
    // Sin `traineddata` el motor no puede leer: la carga debe quedar manual con
    // el motivo a la vista, nunca caer a la CDN de Tesseract ni fingir un éxito.
    process.env.INVOICE_OCR_TESSDATA_PATH = mkdtempSync(path.join(tmpdir(), "tessdata-vacio-"))

    const result = await extractInvoiceData(await invoicePng(), "image/png", "factura.png")

    expect(result).toMatchObject({ data: null, method: "manual" })
    expect(result.warnings?.join(" ")).toMatch(/modelo OCR local/i)
  }, 60_000)
})

describe("OCR real de un PDF escaneado", () => {
  /**
   * El fallback de PDF escaneado corre sin gating por versión de Node a
   * propósito.
   *
   * La auditoría 2026-07-30 lo declaró P0 no desplegable porque
   * `pdfjs-dist@6.1.200` exige Node >=22.13 y en 20 fallaba con
   * `buffer.transferToFixedLength is not a function`. Con el código actual
   * —build `legacy` de pdfjs y rasterizado vía `@napi-rs/canvas`— ese error no se
   * reproduce ni en Node 20.19: la página se rasteriza y el OCR recupera los
   * campos. Si un runtime futuro vuelve a romperlo, este test lo dice en vez de
   * saltarse.
   */
  it("rasteriza la página y recupera los campos mínimos", async () => {
    const pdf = await scannedInvoicePdf()
    const result = await extractInvoiceData(pdf, "application/pdf", "factura-escaneada.pdf")

    // La rama textual no encuentra nada (el PDF es una imagen), así que el
    // resultado debe venir del fallback OCR y no de un éxito silencioso.
    expect(result.method).toBe("ocr")
    expect(result.data?.invoiceNumber).toBe(FOLIO)
    expect(result.data?.totalAmount).toBe(68425)
  }, 180_000)
})
