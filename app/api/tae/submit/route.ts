import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import sharp from "sharp"
import { checkRateLimit, consumeFixedWindowLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { createTaeSubmission, type TaeEvidenceKind, type TaeEvidenceUpload } from "@/lib/services/fuel-tae"
import { taeEvidenceKinds, taePublicSubmissionSchema } from "@/lib/validation/fuel-tae"
import { extractMeterReading } from "@/lib/services/tae-ocr"

export const runtime = "nodejs"

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

export async function POST(request: Request) {
  const requestHeaders = await headers()
  const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  const volumeLimit = await consumeFixedWindowLimit(`tae:submit-volume:ip:${ipAddress}`, { maxAttempts: 120, lockMs: 15 * 60 * 1000 })
  if (!volumeLimit.allowed) {
    return NextResponse.json({ ok: false, message: "Se alcanzó el límite de envíos para este origen. Intenta nuevamente más tarde." }, { status: 429 })
  }
  const rateLimit = await checkRateLimit(`tae:submit:${ipAddress}`)
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false, message: "Demasiados envíos. Intenta nuevamente más tarde." }, { status: 429 })
  }

  try {
    const formData = await request.formData()
    const accessToken = String(formData.get("accessToken") ?? "")
    const tokenFingerprint = createHash("sha256").update(accessToken).digest("hex").slice(0, 24)
    const tokenLimit = await consumeFixedWindowLimit(`tae:submit-volume:token:${tokenFingerprint}`, { maxAttempts: 60, lockMs: 15 * 60 * 1000 })
    if (!tokenLimit.allowed) {
      return NextResponse.json({ ok: false, message: "Este acceso TAE alcanzó temporalmente su límite de envíos." }, { status: 429 })
    }
    const rawPayload = String(formData.get("payload") ?? "")
    let payload: unknown
    try { payload = JSON.parse(rawPayload) } catch {
      return NextResponse.json({ ok: false, message: "Datos del formulario inválidos" }, { status: 400 })
    }
    const parsed = taePublicSubmissionSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los campos del formulario", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const evidence: TaeEvidenceUpload[] = []
    for (const kind of taeEvidenceKinds) {
      const file = formData.get(kind)
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ ok: false, message: "Debes adjuntar las cuatro evidencias" }, { status: 400 })
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ ok: false, message: "Cada fotografía debe pesar como máximo 5 MB" }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const validation = validateFileBuffer(new Uint8Array(buffer), file.size, MimeType.IMAGE)
      if (validation.error) {
        return NextResponse.json({ ok: false, message: `Evidencia ${kind}: ${validation.error}` }, { status: 400 })
      }
      try {
        await validateImageDimensions(buffer)
      } catch (error) {
        return NextResponse.json({ ok: false, message: `Evidencia ${kind}: ${error instanceof Error ? error.message : "dimensiones inválidas"}` }, { status: 400 })
      }
      evidence.push({ kind: kind as TaeEvidenceKind, fileName: file.name, mimeType: validation.mimeType, buffer })
    }

    const odometerFile = evidence.find((e) => e.kind === "odometer")
    const ocrResult = odometerFile ? await extractMeterReading(odometerFile.buffer) : undefined

    const result = await createTaeSubmission({ accessToken, input: parsed.data, evidence, ipAddress, ocrResult })
    await recordSuccessForTelemetry(`tae:submit:${ipAddress}`)
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    await recordFailure(`tae:submit:${ipAddress}`, { maxAttempts: 12 })
    const message = error instanceof Error ? error.message : "No se pudo registrar la carga TAE"
    return NextResponse.json({ ok: false, message }, { status: 400 })
  }
}
