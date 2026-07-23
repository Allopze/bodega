/**
 * OCR extraction for invoice PDFs and images using Tesseract.js.
 * Follows the pattern from lib/services/tae-ocr.ts.
 */

import sharp from "sharp"
import { createWorker } from "tesseract.js"

export interface OcrInvoiceResult {
  text: string
  confidence: number
}

const MAX_CONCURRENT_OCR = Math.max(1, Number(process.env.INVOICE_OCR_MAX_CONCURRENT ?? "1") || 1)
let activeOcr = 0
const ocrWaiters: Array<() => void> = []

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
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .threshold(128)
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
  let preprocessed: Buffer
  try {
    preprocessed = await preprocessForOcr(buffer)
  } catch {
    return { text: "", confidence: 0 }
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    // Use Spanish model for Chilean invoices
    worker = await createWorker("spa", 1, {
      logger: () => {},
      errorHandler: () => {},
    })

    const { data } = await worker.recognize(preprocessed)
    return {
      text: data.text.trim(),
      confidence: data.confidence / 100,
    }
  } catch {
    return { text: "", confidence: 0 }
  } finally {
    if (worker) {
      try { await worker.terminate() } catch { /* ignore */ }
    }
  }
}
