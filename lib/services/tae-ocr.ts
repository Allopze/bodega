import sharp from "sharp"
import { createWorker, PSM } from "tesseract.js"

export interface OcrMeterResult {
  value: number | null
  confidence: number
  rawText: string
}

const MAX_METER_VALUE = 9_999_999
/** Bajo este umbral el resultado sólo es una sugerencia y requiere confirmación humana. */
export const MIN_ACCEPTED_OCR_CONFIDENCE = 0.7
const MAX_CONCURRENT_OCR = Math.max(1, Number(process.env.TAE_OCR_MAX_CONCURRENT ?? "1") || 1)
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

async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .threshold(128)
    .toBuffer()
}

function parseDigits(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  if (!digits) return null
  const value = parseInt(digits, 10)
  if (isNaN(value) || value < 0 || value > MAX_METER_VALUE) return null
  return value
}

async function recognizeWithPsm(worker: Awaited<ReturnType<typeof createWorker>>, imageBuffer: Buffer, psm: PSM): Promise<OcrMeterResult> {
  await worker.setParameters({ tessedit_pageseg_mode: psm })
  const { data } = await worker.recognize(imageBuffer)
  const rawText = data.text.trim()
  const confidence = data.confidence / 100
  const value = parseDigits(rawText)
  return { value, confidence, rawText }
}

export async function extractMeterReading(buffer: Buffer): Promise<OcrMeterResult> {
  await acquireOcrSlot()
  try {
    return await extractMeterReadingInSlot(buffer)
  } finally {
    releaseOcrSlot()
  }
}

async function extractMeterReadingInSlot(buffer: Buffer): Promise<OcrMeterResult> {
  let preprocessed: Buffer
  try {
    preprocessed = await preprocessForOcr(buffer)
  } catch {
    return { value: null, confidence: 0, rawText: "" }
  }

  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  try {
    // load_system_dawg/load_freq_dawg son parámetros "init only": Tesseract los
    // lee solo al inicializar el worker, no vía setParameters() después — ahí
    // se ignoran en silencio y el diccionario de inglés queda activo, lo que
    // puede "corregir" una lectura numérica hacia una palabra parecida.
    worker = await createWorker("eng", 1, {
      logger: () => {},
      errorHandler: () => {},
    }, {
      load_system_dawg: "F",
      load_freq_dawg: "F",
    })
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
    })

    const result = await recognizeWithPsm(worker, preprocessed, PSM.SINGLE_LINE)

    if (result.value != null && result.confidence >= MIN_ACCEPTED_OCR_CONFIDENCE) {
      return result
    }

    if (result.value == null || result.confidence < 0.4) {
      const rawResult = await recognizeWithPsm(worker, preprocessed, PSM.RAW_LINE)
      if (rawResult.value != null) return rawResult
    }

    return result
  } catch {
    return { value: null, confidence: 0, rawText: "" }
  } finally {
    if (worker) {
      try { await worker.terminate() } catch { /* ignore */ }
    }
  }
}
