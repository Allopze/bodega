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
import { extractInvoiceTextOcr, supportsPdfRasterization } from "./invoice-ocr"

/**
 * Un PDF sintético simple (una imagen embebida por jspdf) se rasteriza aun en
 * Node 20, así que por sí solo daba verde y escondía el P0 de la auditoría: con
 * la factura real de la muestra, `pdfjs` cae en `transferToFixedLength`, devuelve
 * una página en blanco y el OCR lee 9 caracteres. La capacidad se consulta al
 * módulo —no se deduce de la versión— y cada rama tiene su expectativa.
 */
const CAN_RASTERIZE = supportsPdfRasterization()

const FOLIO = "3064428"

/** Renderiza líneas de texto como un documento escaneado en blanco y negro. */
async function renderPng(lines: string[], options: { rotate?: number; noise?: boolean } = {}): Promise<Buffer> {
  const body = lines
    .map((text, index) =>
      `<text x="60" y="${90 + index * 46}" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#000">${text}</text>`,
    )
    .join("")
  const height = 140 + lines.length * 46
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${height}">
    <rect width="1240" height="${height}" fill="#fff"/>${body}</svg>`

  let image = sharp(Buffer.from(svg))
  // Un escaneo real llega torcido y sucio; el preprocesado de `invoice-ocr`
  // (autoOrient + grises + normalize + sharpen) existe justamente para eso.
  if (options.rotate) image = image.rotate(options.rotate, { background: "#fff" })
  if (options.noise) image = image.blur(0.6).modulate({ brightness: 0.95 })
  return image.png().toBuffer()
}

/** Factura sintética con los campos que el parser considera evidencia mínima. */
function canonicalLines(): string[] {
  return [
    "PROVEEDOR DEMO SPA",
    "RUT: 96.542.490-3",
    `FACTURA ELECTRONICA N° ${FOLIO}`,
    "Fecha de Emision: 14/07/2026",
    "",
    "CODIGO DESCRIPCION CANTIDAD PRECIO TOTAL",
    "05-03-008 GUANTE CABRITILLA 50 1.150 57.500",
    "",
    "Neto: 57.500",
    "IVA 19%: 10.925",
    "Total: 68.425",
  ]
}

async function invoicePng(): Promise<Buffer> {
  return renderPng(canonicalLines())
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

describe.skipIf(!CAN_RASTERIZE)("OCR real de un PDF escaneado (runtime soportado)", () => {
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

describe.skipIf(CAN_RASTERIZE)("OCR de PDF en un runtime sin soporte", () => {
  it("nombra el runtime como causa en vez de leer una página en blanco", async () => {
    const result = await extractInvoiceData(await scannedInvoicePdf(), "application/pdf", "factura-escaneada.pdf")

    expect(result).toMatchObject({ data: null, method: "manual" })
    expect(result.warnings?.join(" ")).toMatch(/no puede rasterizar PDF para OCR.*Node 22\.13/i)
  }, 120_000)
})

/**
 * Matriz de layouts sintéticos.
 *
 * No sustituye documentos reales por proveedor —esos no se versionan aquí—, pero
 * cubre lo que sí es del motor y del parser: cómo degrada el ordinal, dónde
 * aparece el folio, con qué rótulo viene el total y qué pasa con un escaneo
 * torcido o sucio. Los dos bugs que este módulo tenía (folio perdido por `N*`,
 * total tomado del encabezado de columna) eran exactamente de esta clase.
 */
const LAYOUTS: Array<{ nombre: string; lineas: string[]; opciones?: { rotate?: number; noise?: boolean } }> = [
  {
    nombre: "folio con rótulo FOLIO y total como 'Total a pagar'",
    lineas: [
      "COMERCIAL DEMO LIMITADA",
      "RUT: 76.111.222-3",
      "FACTURA ELECTRONICA",
      `FOLIO: ${FOLIO}`,
      "Fecha de Emision: 14/07/2026",
      "",
      "DESCRIPCION CANT PRECIO TOTAL",
      "GUANTE CABRITILLA 50 1.150 57.500",
      "",
      "Neto: 57.500",
      "IVA 19%: 10.925",
      "Total a pagar: 68.425",
    ],
  },
  {
    nombre: "montos sin separador de miles y fecha con guías",
    lineas: [
      "PROVEEDOR DEMO SPA",
      `FACTURA ELECTRONICA N° ${FOLIO}`,
      "Fecha de Emision ---: 14/07/2026",
      "",
      "DESCRIPCION CANT PRECIO TOTAL",
      "GUANTE CABRITILLA 50 1150 57500",
      "",
      "Neto: 57500",
      "IVA 19%: 10925",
      "Total: 68425",
    ],
  },
  {
    nombre: "escaneo torcido y con ruido",
    lineas: canonicalLines(),
    opciones: { rotate: 1.2, noise: true },
  },
]

describe("matriz de layouts escaneados", () => {
  it.each(LAYOUTS)("extrae folio, fecha y total: $nombre", async ({ lineas, opciones }) => {
    const result = await extractInvoiceData(await renderPng(lineas, opciones), "image/png", "factura.png")

    expect(result.method).toBe("ocr")
    expect(result.data?.invoiceNumber).toBe(FOLIO)
    expect(result.data?.issueDate).toBe("2026-07-14")
    expect(result.data?.totalAmount).toBe(68425)
    // Ningún layout debe colar un total que no cuadre con neto + IVA.
    expect(result.quality.totalsConsistent).toBe(true)
  }, 120_000)
})

