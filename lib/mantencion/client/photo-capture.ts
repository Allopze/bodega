import { formatDateTime } from "@/lib/utils"
import { readExif } from "./exif"

/**
 * Foto del mecánico: cámara trasera → se lee el EXIF → se dibuja en un canvas con
 * el lado largo en 1.600 px → se estampa el SELLO (fecha, hora, código y patente)
 * directamente sobre los píxeles → JPEG 0,7 → huella sha256.
 *
 * El sello va dibujado en la imagen, no en un metadato: es lo que se ve en la
 * plataforma y en el PDF aunque alguien reenvíe o recorte el archivo.
 */

export const MAX_SIDE = 1_600
export const JPEG_QUALITY = 0.7
/** Cuánto del archivo original se lee para buscar el EXIF (vive al inicio del JPEG). */
const EXIF_WINDOW = 256 * 1024

export class PhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PhotoError"
  }
}

export interface CapturedPhoto {
  blob: Blob
  width: number
  height: number
  sha256: string
  /** Hora del sello (el momento de la captura en el teléfono). */
  stampedAt: string
  takenAtExif: string | null
  exif: Record<string, string> | null
}

export function fitWithin(width: number, height: number, max: number = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** `28-10-2026 14:05 · KA-140 · SGCP-84`; si el equipo no tiene patente propia, el código va una sola vez. */
export function stampText(now: Date, code: string, plate: string): string {
  const who = code === plate ? code : `${code}  ·  ${plate}`
  return `${formatDateTime(now)}  ·  ${who}`
}

export function stampBar(height: number): { bar: number; fontPx: number; pad: number } {
  const bar = Math.round(height * 0.075) + 14
  return { bar, fontPx: Math.round(bar * 0.4), pad: Math.round(bar * 0.4) }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* cae al <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new PhotoError("No pudimos leer la foto. Saca otra con la cámara.")
  }
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoError("No pudimos preparar la foto. Intenta de nuevo."))), "image/jpeg", JPEG_QUALITY)
  })
}

export function drawStamp(context: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  const { bar, fontPx, pad } = stampBar(height)
  context.fillStyle = "rgba(29, 29, 27, 0.86)"
  context.fillRect(0, height - bar, width, bar)
  context.fillStyle = "#ffffff"
  context.textBaseline = "middle"
  let size = fontPx
  const family = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
  context.font = `600 ${size}px ${family}`
  while (size > 10 && context.measureText(text).width > width - pad * 2) {
    size -= 1
    context.font = `600 ${size}px ${family}`
  }
  context.fillText(text, pad, height - bar / 2)
}

export async function capturePhoto(file: File, equipment: { code: string; plate: string }, now: Date = new Date()): Promise<CapturedPhoto> {
  if (!file.type.startsWith("image/") && file.type !== "") throw new PhotoError("Eso no es una foto. Usa la cámara.")
  const exif = readExif(new Uint8Array(await file.slice(0, EXIF_WINDOW).arrayBuffer()))
  const decoded = await decode(file)
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new PhotoError("No pudimos preparar la foto. Intenta de nuevo.")
    context.drawImage(decoded.source, 0, 0, width, height)
    drawStamp(context, width, height, stampText(now, equipment.code, equipment.plate))
    const blob = await toJpeg(canvas)
    return {
      blob,
      width,
      height,
      sha256: await sha256Hex(blob),
      stampedAt: now.toISOString(),
      takenAtExif: exif?.takenAt ?? null,
      exif: exif && Object.keys(exif.fields).length > 0 ? exif.fields : null,
    }
  } finally {
    decoded.release()
  }
}
