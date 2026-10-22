import sharp from "sharp"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { extractMeterReading, type OcrMeterResult } from "@/lib/services/tae-ocr"
import { taeEvidenceKinds, taePublicSubmissionSchema, type TaePublicSubmissionInput } from "@/lib/validation/fuel-tae"
import type { TaeEvidenceKind, TaeEvidenceUpload } from "./types"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_PIXELS = 24_000_000
const MIN_IMAGE_SIDE = 200

async function validateImageDimensions(buffer: Buffer) {
  const metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
    throw new Error("Cada evidencia debe medir al menos 200 × 200 píxeles")
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error("La resolución de una evidencia es demasiado grande")
  }
}

export type ParsedFieldLoadRequest =
  | { ok: true; input: TaePublicSubmissionInput; evidence: TaeEvidenceUpload[]; ocrResult?: OcrMeterResult }
  | { ok: false; status: 400; body: { ok: false; message: string; fieldErrors?: Record<string, string[] | undefined> } }

/**
 * Lee el multipart de una carga en terreno (`payload` JSON + fotos). Lo comparten
 * `/api/tae/submit` y `/api/combustibles/cargas`: ambas validan igual la forma y
 * las imágenes, y dejan las reglas de negocio al servicio.
 *
 * Las fotos de sello son opcionales aquí a propósito: solo se exigen cuando se
 * informó el número de ese sello, y eso lo decide el servicio con el payload ya
 * validado.
 */
export async function parseFieldLoadRequest(formData: FormData): Promise<ParsedFieldLoadRequest> {
  const rawPayload = String(formData.get("payload") ?? "")
  let payload: unknown
  try { payload = JSON.parse(rawPayload) } catch {
    return { ok: false, status: 400, body: { ok: false, message: "Datos del formulario inválidos" } }
  }
  const parsed = taePublicSubmissionSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los campos del formulario", fieldErrors: parsed.error.flatten().fieldErrors },
    }
  }

  const evidence: TaeEvidenceUpload[] = []
  for (const kind of taeEvidenceKinds) {
    const file = formData.get(kind)
    if (!(file instanceof File) || file.size === 0) continue
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, status: 400, body: { ok: false, message: "Cada fotografía debe pesar como máximo 5 MB" } }
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.IMAGE)
    if (validation.error) {
      return { ok: false, status: 400, body: { ok: false, message: `Evidencia ${kind}: ${validation.error}` } }
    }
    try {
      await validateImageDimensions(buffer)
    } catch (error) {
      return { ok: false, status: 400, body: { ok: false, message: `Evidencia ${kind}: ${error instanceof Error ? error.message : "dimensiones inválidas"}` } }
    }
    evidence.push({ kind: kind as TaeEvidenceKind, fileName: file.name, mimeType: validation.mimeType, buffer })
  }

  const odometerFile = evidence.find((item) => item.kind === "odometer")
  const ocrResult = odometerFile ? await extractMeterReading(odometerFile.buffer) : undefined
  return { ok: true, input: parsed.data, evidence, ocrResult }
}
