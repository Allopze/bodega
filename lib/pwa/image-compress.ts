"use client"

/**
 * Compresión de fotos en cliente antes de encolar offline (decisión de Fase 0,
 * 2026-07-12): máx. ~5MB por foto, redimensionada a ~1600px en su lado mayor,
 * sin perder legibilidad del odómetro, litros o sello. El servidor vuelve a
 * validar tipo, tamaño y cantidad — esto solo reduce lo que hay que encolar/subir.
 */
const MAX_DIMENSION = 1600
const MAX_BYTES = 5 * 1024 * 1024
const INITIAL_QUALITY = 0.85
const MIN_QUALITY = 0.5
const QUALITY_STEP = 0.1

function fitWithinMaxDimension(width: number, height: number, max: number) {
  if (width <= max && height <= max) return { width, height }
  const scale = max / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
}

function jpegFileName(originalName: string) {
  const base = originalName.replace(/\.[^.]+$/, "")
  return `${base || "foto"}.jpg`
}

/** Redimensiona/recomprime una foto capturada en el formulario TAE. Si algo falla, devuelve el archivo original sin bloquear al usuario. */
export async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithinMaxDimension(bitmap.width, bitmap.height, MAX_DIMENSION)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    let quality = INITIAL_QUALITY
    let blob = await canvasToBlob(canvas, quality)
    while (blob && blob.size > MAX_BYTES && quality > MIN_QUALITY) {
      quality -= QUALITY_STEP
      blob = await canvasToBlob(canvas, quality)
    }
    if (!blob) return file
    // No reemplazar si la "compresión" terminó más pesada que el original
    // (puede pasar con PNGs simples reencodeados a JPEG de baja compresión).
    if (blob.size >= file.size) return file
    return new File([blob], jpegFileName(file.name), { type: "image/jpeg" })
  } catch {
    return file
  }
}
