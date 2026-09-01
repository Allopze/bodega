/**
 * OCR extraction for invoice PDFs and images using Tesseract.js.
 * Follows the pattern from lib/services/tae-ocr.ts.
 */

import sharp from "sharp"
import { existsSync } from "node:fs"
import path from "node:path"
import { createWorker, PSM } from "tesseract.js"

export interface OcrInvoiceResult {
  text: string
  confidence: number
  pageCount: number
  warning?: string
}

const MAX_CONCURRENT_OCR = Math.max(1, Number(process.env.INVOICE_OCR_MAX_CONCURRENT ?? "1") || 1)
const MAX_PDF_PAGES = boundedEnvironmentNumber("INVOICE_OCR_MAX_PDF_PAGES", 10, 1, 20)
const MAX_RENDER_PIXELS_PER_PAGE = boundedEnvironmentNumber("INVOICE_OCR_MAX_PIXELS_PER_PAGE", 24_000_000, 1_000_000, 48_000_000)
const PDF_RENDER_SCALE = 2
let activeOcr = 0
const ocrWaiters: Array<() => void> = []
type OcrWorker = Awaited<ReturnType<typeof createWorker>>
type Recognition = Awaited<ReturnType<OcrWorker["recognize"]>>

async function acquireOcrSlot() {
  if (activeOcr < MAX_CONCURRENT_OCR) {
    activeOcr++
    return
  }
  await new Promise<void>((resolve) => ocrWaiters.push(resolve))
  activeOcr++
}

function releaseOcrSlot() {
  activeOcr--
  ocrWaiters.shift()?.()
}

/**
 * Preprocess image for better OCR results.
 */
async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .autoOrient()
    .resize({ width: 2200, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .toBuffer()
}

/**
 * Extract text from an invoice image or scanned PDF using OCR.
 */
export async function extractInvoiceTextOcr(buffer: Buffer): Promise<OcrInvoiceResult> {
  await acquireOcrSlot()
  try {
    return await extractInvoiceTextOcrInSlot(buffer)
  } finally {
    releaseOcrSlot()
  }
}

async function extractInvoiceTextOcrInSlot(buffer: Buffer): Promise<OcrInvoiceResult> {
  let pages: Buffer[]
  try {
    pages = isPdf(buffer) ? await rasterizePdfPages(buffer) : [buffer]
  } catch (error) {
    return { text: "", confidence: 0, pageCount: 0, warning: errorMessage(error, "No se pudo preparar el documento para OCR") }
  }

  if (pages.length === 0) return { text: "", confidence: 0, pageCount: 0, warning: "El PDF no contiene páginas procesables" }

  let worker: OcrWorker | null = null
  try {
    const tessdata = resolveLocalTessdata()
    // Never let Tesseract fall back to its CDN at runtime. The Docker image
    // supplies both languages in one local directory; local development still
    // works with the Spanish model bundled by the direct npm dependency.
    worker = await createWorker(tessdata.languages, 1, {
      logger: () => {},
      errorHandler: () => {},
      langPath: tessdata.path,
      cacheMethod: "none",
      gzip: true,
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })

    // A Tesseract worker is stateful and cannot recognize pages concurrently.
    const results = await recognizePagesSequentially(worker, pages)
    const confidence = results.reduce((sum, result) => sum + result.data.confidence, 0) / results.length
    return {
      text: results.reduce((text, result) => {
        const pageText = result.data.text.trim()
        return pageText ? `${text}${text ? "\n" : ""}${pageText}` : text
      }, ""),
      confidence: confidence / 100,
      pageCount: pages.length,
    }
  } catch (error) {
    return { text: "", confidence: 0, pageCount: pages.length, warning: errorMessage(error, "El motor OCR no pudo leer el documento") }
  } finally {
    if (worker) {
      try { await worker.terminate() } catch { /* ignore */ }
    }
  }
}

async function recognizePagesSequentially(worker: OcrWorker, pages: Buffer[]): Promise<Recognition[]> {
  const results: Recognition[] = []
  for (const page of pages) {
    const preprocessed = await preprocessForOcr(page)
    results.push(await worker.recognize(preprocessed))
  }
  return results
}

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 4).toString("ascii") === "%PDF"
}

/**
 * `pdfjs-dist@6` usa `ArrayBuffer.prototype.transferToFixedLength`, que existe
 * desde Node 21. En Node 20 el fallo ocurre *dentro* de `getOperatorList`, donde
 * pdfjs lo degrada a un warning por stderr y devuelve una página en blanco: el
 * OCR entonces lee 9 caracteres de nada y el operador ve "no se pudo leer el
 * documento", sin pista de que la causa es el runtime.
 *
 * Se comprueba antes de rasterizar para convertir eso en un error accionable
 * (auditoría OCR 2026-07-30: "el warning debe convertirse en error estructurado,
 * no quedar en stderr"). `engines` y la imagen de producción ya exigen 22.13.
 */
export function supportsPdfRasterization(): boolean {
  return typeof (ArrayBuffer.prototype as { transferToFixedLength?: unknown }).transferToFixedLength === "function"
}

/** Rasterize bounded PDF pages before OCR. Sharp processes images, not PDF files. */
async function rasterizePdfPages(buffer: Buffer): Promise<Buffer[]> {
  if (!supportsPdfRasterization()) {
    throw new Error(
      `Este runtime (Node ${process.versions.node}) no puede rasterizar PDF para OCR; se requiere Node 22.13 o superior.`,
    )
  }

  // Keep native canvas runtime-only. Turbopack cannot place its platform binary
  // in an ESM chunk; standalone tracing is explicitly configured in next.config.
  const canvasModule = "@napi-rs/canvas"
  const [{ getDocument }, canvas] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    // Next 16 reconoce `webpackIgnore` tanto en Webpack como en Turbopack.
    // No combinar dos claves en el mismo comentario: Turbopack dejaba de
    // preservar este import y trataba de colocar el binario nativo en ESM.
    import(/* webpackIgnore: true */ canvasModule),
  ])
  const document = await getDocument({ data: new Uint8Array(buffer) }).promise
  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`El PDF tiene ${document.numPages} páginas; el máximo para OCR es ${MAX_PDF_PAGES}`)
    }

    const pages: Buffer[] = []
    // Rendering one page at a time keeps a multi-page attachment from holding
    // every decoded canvas in memory simultaneously.
    for (let index = 0; index < document.numPages; index++) {
      const page = await document.getPage(index + 1)
      try {
        const baseViewport = page.getViewport({ scale: 1 })
        const constrainedScale = Math.min(
          PDF_RENDER_SCALE,
          Math.sqrt(MAX_RENDER_PIXELS_PER_PAGE / (baseViewport.width * baseViewport.height)),
        )
        const viewport = page.getViewport({ scale: constrainedScale })
        const image = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        await page.render({ canvas: image as never, canvasContext: image.getContext("2d") as never, viewport }).promise
        pages.push(image.toBuffer("image/png"))
      } finally {
        page.cleanup()
      }
    }
    return pages
  } finally {
    try { await (document as unknown as { destroy?: () => Promise<void> }).destroy?.() } catch { /* best effort */ }
  }
}

function resolveLocalTessdata() {
  const configuredPath = process.env.INVOICE_OCR_TESSDATA_PATH
  const dataPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), "node_modules", "@tesseract.js-data", "spa", "4.0.0_best_int")
  const languages = configuredPath ? "spa+eng" : "spa"

  for (const language of languages.split("+")) {
    if (!existsSync(path.join(dataPath, `${language}.traineddata.gz`))) {
      throw new Error(`No se encontró el modelo OCR local para ${language}. Configure INVOICE_OCR_TESSDATA_PATH.`)
    }
  }

  return { path: dataPath, languages }
}

function boundedEnvironmentNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
