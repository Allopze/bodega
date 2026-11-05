import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { createInternalFieldLoad } from "@/lib/services/fuel-tae"
import { isTaeSubmissionRejected } from "@/lib/services/fuel-tae/errors"
import { parseInternalFieldLoadRequest } from "@/lib/services/fuel-tae/request"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { safeActionMessage } from "@/lib/action-error"
import { logger } from "@/lib/logger"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { isPastLoadNotAllowed, isPossibleDuplicateLoad } from "@/lib/combustibles/field-load-rules"

export const runtime = "nodejs"

/**
 * Registro de carga en terreno desde la app autenticada (mismo formulario por
 * pasos que la PWA, mismas reglas del servicio). La autorización es de este
 * handler: sesión, permiso y alcance de la faena elegida; ocultar el botón no
 * es control de acceso.
 *
 * A diferencia de la vía pública, acepta `pastLoad` (una carga de otro día, con
 * `combustibles:register_past_load`) y `acknowledgeDuplicate` (registrar igual
 * una carga que se parece a otra del mismo equipo).
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ ok: false, message: "Tu sesión expiró. Vuelve a ingresar." }, { status: 401 })
  if (!can(session, "combustibles:register_load")) {
    return NextResponse.json({ ok: false, message: "No tienes permiso para registrar cargas." }, { status: 403 })
  }
  if (!await isRouteOperational(FUEL_PATHS.registrar)) {
    return NextResponse.json({ ok: false, message: "El registro de cargas está temporalmente inactivo." }, { status: 503 })
  }
  const limit = await consumeFixedWindowLimit(`combustibles:cargas:user:${session.user.id}`, { maxAttempts: 120, lockMs: 15 * 60 * 1000 })
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, message: "Demasiados envíos. Intenta nuevamente en unos minutos." }, { status: 429 })
  }

  try {
    const parsedRequest = await parseInternalFieldLoadRequest(await request.formData())
    if (!parsedRequest.ok) return NextResponse.json(parsedRequest.body, { status: parsedRequest.status })
    // El alcance se comprueba con la faena que el usuario eligió, antes de
    // tocar nada más: una faena ajena no debe ni revelar si el equipo existe.
    if (!canAccessWorksite(session, parsedRequest.input.worksiteId)) {
      return NextResponse.json({ ok: false, message: "No tienes acceso a esta faena." }, { status: 403 })
    }
    // La fecha de la carga la pone una persona sólo con este permiso; el servicio lo vuelve a exigir.
    const allowPastLoad = can(session, "combustibles:register_past_load")
    const { pastLoad } = parsedRequest.input
    // D3: la vía interna no fecha una carga con la hora del dispositivo. Un
    // reenvío desde la cola sin conexión (`offline`/`capturedAt`) tiene que
    // presentarse como carga de otro día, con motivo y con el permiso que la
    // autoriza; si no, `offline` sería un atajo para fechar hasta 30 días atrás
    // sin `register_past_load`. La vía pública (`/api/tae/submit`) conserva
    // `offline`: allí la cola es la única fuente de la hora de captura (S-5).
    const offlineReplay = parsedRequest.input.offline === true || parsedRequest.input.capturedAt != null
    if ((pastLoad || offlineReplay) && !allowPastLoad) {
      return NextResponse.json({ ok: false, message: "No tienes permiso para registrar cargas con fecha pasada." }, { status: 403 })
    }
    if (offlineReplay && !pastLoad?.reason?.trim()) {
      return NextResponse.json({
        ok: false,
        code: "past_load_required",
        field: "pastLoad",
        message: "Las cargas registradas sin conexión se ingresan como carga de otro día: indica la fecha, la hora y el motivo.",
      }, { status: 422 })
    }
    const result = await createInternalFieldLoad({
      userId: session.user.id,
      input: parsedRequest.input,
      evidence: parsedRequest.evidence,
      ocrResult: parsedRequest.ocrResult,
      ipAddress: resolveTrustedClientIp(await headers()),
      allowPastLoad,
    })
    return NextResponse.json({ ok: true, data: result }, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    if (isPastLoadNotAllowed(error)) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 403 })
    }
    if (isPossibleDuplicateLoad(error)) {
      // 422 con la otra carga: el formulario la muestra y deja seguir con `acknowledgeDuplicate`.
      return NextResponse.json({ ok: false, code: error.code, message: error.message, duplicateOf: error.duplicateOf }, { status: 422 })
    }
    if (isTaeSubmissionRejected(error)) {
      return NextResponse.json({ ok: false, code: error.code, field: error.field, message: error.message }, { status: 422 })
    }
    logger.error("[combustibles/cargas]", error)
    return NextResponse.json({ ok: false, message: safeActionMessage(error, "No se pudo registrar la carga") }, { status: 400 })
  }
}
