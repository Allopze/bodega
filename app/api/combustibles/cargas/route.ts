import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { createInternalFieldLoad } from "@/lib/services/fuel-tae"
import { isTaeSubmissionRejected } from "@/lib/services/fuel-tae/errors"
import { parseFieldLoadRequest } from "@/lib/services/fuel-tae/request"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"

/**
 * Registro de carga en terreno desde la app autenticada (mismo formulario por
 * pasos que la PWA, mismas reglas del servicio). La autorización es de este
 * handler: sesión, permiso y alcance de la faena elegida; ocultar el botón no
 * es control de acceso.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ ok: false, message: "Tu sesión expiró. Vuelve a ingresar." }, { status: 401 })
  if (!can(session, "combustibles:register_load")) {
    return NextResponse.json({ ok: false, message: "No tienes permiso para registrar cargas." }, { status: 403 })
  }
  if (!await isRouteOperational("/combustibles/control/registrar")) {
    return NextResponse.json({ ok: false, message: "El registro de cargas está temporalmente inactivo." }, { status: 503 })
  }
  const limit = await consumeFixedWindowLimit(`combustibles:cargas:user:${session.user.id}`, { maxAttempts: 120, lockMs: 15 * 60 * 1000 })
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, message: "Demasiados envíos. Intenta nuevamente en unos minutos." }, { status: 429 })
  }

  try {
    const parsedRequest = await parseFieldLoadRequest(await request.formData())
    if (!parsedRequest.ok) return NextResponse.json(parsedRequest.body, { status: parsedRequest.status })
    // El alcance se comprueba con la faena que el usuario eligió, antes de
    // tocar nada más: una faena ajena no debe ni revelar si el equipo existe.
    if (!canAccessWorksite(session, parsedRequest.input.worksiteId)) {
      return NextResponse.json({ ok: false, message: "No tienes acceso a esta faena." }, { status: 403 })
    }
    const result = await createInternalFieldLoad({
      userId: session.user.id,
      input: parsedRequest.input,
      evidence: parsedRequest.evidence,
      ocrResult: parsedRequest.ocrResult,
      ipAddress: resolveTrustedClientIp(await headers()),
    })
    return NextResponse.json({ ok: true, data: result }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    if (isTaeSubmissionRejected(error)) {
      return NextResponse.json({ ok: false, code: error.code, field: error.field, message: error.message }, { status: 422 })
    }
    logger.error("[combustibles/cargas]", error)
    return NextResponse.json({ ok: false, message: safeActionMessage(error, "No se pudo registrar la carga") }, { status: 400 })
  }
}
