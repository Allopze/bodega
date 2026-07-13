"use server"

import { revalidatePath } from "next/cache"
import { createPpaSubmission, findWorkerByRut } from "@/lib/services/ppa"
import { ppaSubmitSchema, type ActionState } from "@/lib/validation/ppa"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { headers } from "next/headers"
import { checkRateLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { cleanRut, validateRut } from "@/lib/rut"

/**
 * Acción PÚBLICA (sin login). El trabajador envía el PPA. No usa guardPermission:
 * la validación de datos (Zod) y la pertenencia a faena son la única barrera.
 */
export async function submitPpaAction(
  input: z.infer<typeof ppaSubmitSchema>,
): Promise<ActionState & { data?: { token: string; resultado: string } }> {
  const h = await headers()
  const clientIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"

  // Pre-parse para escopar el rate limit por trabajador (UX-01). Preferimos una
  // identidad estable (id de la lista controlada, luego RUT normalizado) para que
  // un NAT compartido no bloquee a trabajadores legítimos distintos. Caemos a IP
  // solo cuando el envío no trae ninguna identidad.
  const preParsed = ppaSubmitSchema.safeParse(input)
  const rateLimitIdentity = preParsed.success
    ? (preParsed.data.workerId
        || (preParsed.data.workerRut ? cleanRut(preParsed.data.workerRut) : "")
        || clientIp)
    : clientIp
  const rateLimitKey = `ppa:${rateLimitIdentity}`

  const limitRes = await checkRateLimit(rateLimitKey)
  if (!limitRes.allowed) {
    const minutes = Math.ceil(limitRes.waitTimeRemainingMs / 60000)
    return {
      ok: false,
      message: `Has enviado demasiados formularios. Por favor, intenta de nuevo en ${minutes} minutos.`,
    }
  }

  const parsed = ppaSubmitSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  // Registramos el intento (tanto si resulta aprobado como detenido, contamos el envío)
  await recordFailure(rateLimitKey)

  try {
    const { token, submission } = await createPpaSubmission(parsed.data)
    revalidatePath("/prevencion/ppa")
    return {
      ok: true,
      message: submission.resultado === "detenido"
        ? "Trabajo detenido. Comuníquese con su supervisor."
        : "Puede iniciar el trabajo de forma segura.",
      data: { token, resultado: submission.resultado },
    }
  } catch (e) {
    logger.error("[ppa] submit failed", e)
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo enviar el PPA." }
  }
}

/** Identifica al trabajador por RUT y deriva su faena (sin elegirla). */
export async function findWorkerByRutAction(
  rut: string,
): Promise<{
  ok: boolean
  worker?: { id: string; name: string; rut: null; position: null; worksiteId: string }
  message?: string
}> {
  if (!rut) return { ok: false, message: "Ingresa tu RUT." }

  if (!validateRut(rut)) {
    return { ok: false, message: "RUT inválido. Debe tener formato 12345678-9 o similar." }
  }

  // Rate limit por IP para evitar enumeración masiva de trabajadores (S-01)
  const h = await headers()
  const clientIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  const lookupLimitKey = `ppa-lookup:${clientIp}`
  const limitRes = await checkRateLimit(lookupLimitKey)
  if (!limitRes.allowed) {
    const minutes = Math.ceil(limitRes.waitTimeRemainingMs / 60000)
    return {
      ok: false,
      message: `Demasiadas consultas. Intenta de nuevo en ${minutes} minutos.`,
    }
  }

  try {
    const worker = await findWorkerByRut(rut)
    if (!worker) {
      // Contamos solo el intento fallido (RUT no encontrado): las identificaciones
      // legítimas no penalizan al NAT compartido. Umbral generoso (10/15min) para
      // tolerar algunos errores de tipeo de una faena sin permitir enumeración masiva.
      await recordFailure(lookupLimitKey, { maxAttempts: 10 })
      return { ok: false, message: "No se encontró ningún trabajador activo con este RUT." }
    }
    // ponytail: minimizar PII expuesto en acción pública - solo primer nombre + inicial
    // apellido para identificación básica. No devolver RUT (ya lo tiene quien busca),
    // cargo completo, ni nombre de faena (el cliente lo infiere de `worksites`,
    // la misma lista pública que alimenta el <Select> del modo manual, usando
    // el worksiteId de abajo — ver resolvedWorksiteName en ppa-form.hooks.ts).
    const maskedName = `${worker.firstName} ${worker.lastName?.[0]}.`

    // Registrar éxito para telemetría: permite detectar enumeración masiva
    // incluso cuando todas las búsquedas son exitosas
    await recordSuccessForTelemetry(lookupLimitKey)

    return {
      ok: true,
      worker: {
        id: worker.id,
        name: maskedName,
        rut: null, // No devolver RUT en respuesta pública
        position: null, // No devolver cargo en respuesta pública
        worksiteId: worker.worksiteId,
      },
    }
  } catch (e) {
    logger.error("[ppa] findWorkerByRut failed", e)
    return { ok: false, message: "Error al buscar el trabajador." }
  }
}
