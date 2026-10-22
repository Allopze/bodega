import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { checkRateLimit, consumeFixedWindowLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { createTaeSubmission } from "@/lib/services/fuel-tae"
import { isTaeSubmissionRejected } from "@/lib/services/fuel-tae/errors"
import { parseFieldLoadRequest } from "@/lib/services/fuel-tae/request"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!await isRouteOperational("/combustibles/tae")) {
    return NextResponse.json({ ok: false, message: "Control TAE temporalmente inactivo" }, { status: 503 })
  }
  const requestHeaders = await headers()
  const rateLimitIp = resolveTrustedClientIp(requestHeaders)
  // Audit records must use the same trusted identity as the public limiter.
  const ipAddress = rateLimitIp
  const volumeLimit = await consumeFixedWindowLimit(`tae:submit-volume:ip:${rateLimitIp}`, { maxAttempts: 120, lockMs: 15 * 60 * 1000 })
  if (!volumeLimit.allowed) {
    return NextResponse.json({ ok: false, message: "Se alcanzó el límite de envíos para este origen. Intenta nuevamente más tarde." }, { status: 429 })
  }
  const rateLimit = await checkRateLimit(`tae:submit:${rateLimitIp}`)
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
    const parsedRequest = await parseFieldLoadRequest(formData)
    if (!parsedRequest.ok) return NextResponse.json(parsedRequest.body, { status: parsedRequest.status })

    const result = await createTaeSubmission({ accessToken, input: parsedRequest.input, evidence: parsedRequest.evidence, ipAddress, ocrResult: parsedRequest.ocrResult })
    await recordSuccessForTelemetry(`tae:submit:${rateLimitIp}`)
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    // Un rechazo de negocio (lectura menor, litros sobre la capacidad, sello de
    // relleno…) no es abuso ni falla del sistema: responde 422 con la causa y
    // no cuenta contra el límite de reintentos del origen.
    if (isTaeSubmissionRejected(error)) {
      return NextResponse.json({ ok: false, code: error.code, field: error.field, message: error.message }, { status: 422 })
    }
    await recordFailure(`tae:submit:${rateLimitIp}`, { maxAttempts: 12 })
    logger.error("[tae/submit]", error)
    const message = safeActionMessage(error, "No se pudo registrar la carga TAE")
    return NextResponse.json({ ok: false, message }, { status: 400 })
  }
}
