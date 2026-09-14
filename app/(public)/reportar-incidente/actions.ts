"use server"

/**
 * INC-001 (auditoría 2026-09-14) — Acción PÚBLICA (sin login) del canal de
 * reporte del trabajador. Mismo patrón que el envío del PPA: toggle de módulo,
 * cuota por IP y validación Zod como única barrera.
 *
 * **La IP no se guarda ni se audita.** Se usa sólo como clave del limitador en
 * memoria/almacén de cuotas, que no queda vinculado al reporte por ninguna
 * columna ni evento. Ese es el punto del canal: un reporte anónimo que puede
 * rastrearse hasta quien lo hizo —por sesión, por IP en la auditoría o por
 * cualquier cruce de tiempos— no protege a nadie, y la persona que más
 * necesita este canal es justamente la que teme represalias. Por eso tampoco
 * se registra actividad operacional del envío.
 */

import { headers } from "next/headers"
import { safeActionMessage } from "@/lib/action-error"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { submitPublicIncidentReport } from "@/lib/services/prevention-incident-reports"

/** Holgada a propósito: una faena entera puede compartir una sola salida. */
const SUBMIT_IP_QUOTA = { maxAttempts: 20, lockMs: 10 * 60 * 1000 }

export async function submitPublicIncidentReportAction(
  input: unknown,
): Promise<{ ok: boolean; message: string; code?: string }> {
  if (!await isRouteOperational("/prevencion/incidentes")) {
    return { ok: false, message: "El canal de reporte está inactivo temporalmente." }
  }
  const clientIp = resolveTrustedClientIp(await headers())
  const quota = await consumeFixedWindowLimit(`incident-report-ip:${clientIp}`, SUBMIT_IP_QUOTA)
  if (!quota.allowed) {
    return {
      ok: false,
      message: `Se alcanzó el límite de reportes desde esta conexión. Intenta de nuevo en ${SUBMIT_IP_QUOTA.lockMs / 60000} minutos.`,
    }
  }
  try {
    const { code } = await submitPublicIncidentReport(input)
    return { ok: true, message: `Reporte recibido. Su folio es ${code}.`, code }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo registrar el reporte.") }
  }
}
