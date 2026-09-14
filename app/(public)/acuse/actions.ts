"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { checkRateLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { acknowledgePermitCrewByPublicToken } from "@/lib/services/prevention-permits"
import { acknowledgeTrainingByPublicToken } from "@/lib/services/prevention-training"
import { safeActionMessage } from "@/lib/action-error"

export interface PublicAckState { ok: boolean; message: string }

/**
 * `CAP-002` / `PER-002` (auditoría 2026-09-14): la Server Action de la vía de
 * acuse sin cuenta. No hay `auth()` ni `requirePermission` porque justamente el
 * hallazgo era que exigir cuenta dejaba fuera a casi todo el personal de faena;
 * la credencial es el token del enlace y la valida el servicio, no esta capa.
 *
 * Lo que sí se conserva de la disciplina de las otras puertas públicas
 * (PPA/TAE): toggle de módulo, límite de tasa por IP y registro de IP y agente
 * de usuario como evidencia del acuse.
 */
export async function submitPublicAcknowledgement(
  _previous: PublicAckState,
  formData: FormData,
): Promise<PublicAckState> {
  const kind = String(formData.get("kind") ?? "")
  const targetId = String(formData.get("targetId") ?? "")
  const token = String(formData.get("token") ?? "")
  if (kind !== "capacitacion" && kind !== "permiso") {
    return { ok: false, message: "El enlace de acuse no es válido." }
  }

  const routeHref = kind === "capacitacion" ? "/prevencion/capacitacion" : "/prevencion/permisos"
  if (!await isRouteOperational(routeHref)) {
    return { ok: false, message: "El acuse está temporalmente inactivo." }
  }

  const requestHeaders = await headers()
  const ip = resolveTrustedClientIp(requestHeaders)
  const userAgent = requestHeaders.get("user-agent")
  const limitKey = `prevencion:acuse:${ip}`
  const rateLimit = await checkRateLimit(limitKey)
  if (!rateLimit.allowed) return { ok: false, message: "Demasiados intentos. Espera unos minutos." }

  try {
    if (kind === "capacitacion") {
      await acknowledgeTrainingByPublicToken({ attendanceId: targetId, token }, { ip, userAgent })
    } else {
      await acknowledgePermitCrewByPublicToken({ crewId: targetId, token }, { ip, userAgent })
    }
    await recordSuccessForTelemetry(limitKey)
    revalidatePath(`/acuse/${kind}/${targetId}/${token}`)
    return { ok: true, message: "Acuse registrado. Gracias." }
  } catch (error) {
    await recordFailure(limitKey, { maxAttempts: 20 })
    return { ok: false, message: safeActionMessage(error, "No fue posible registrar el acuse.") }
  }
}
