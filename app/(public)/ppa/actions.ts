"use server"

import { createPpaSubmission, findWorkerByRut } from "@/lib/services/ppa"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { ppaSubmitSchema, type ActionState } from "@/lib/validation/ppa"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { resolveTrustedClientIp } from "@/lib/security/login-rate-limit-ip"
import { headers } from "next/headers"
import { checkRateLimit, consumeFixedWindowLimit, recordFailure, recordSuccessForTelemetry } from "@/lib/services/rate-limit"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { cleanRut, validateRut } from "@/lib/rut"

/**
 * Cuotas del envío público (S-PPA-01). Son DOS y hay que pasar las dos:
 *
 * - Identidad (workerId / RUT normalizado): buena para la UX, porque aísla a
 *   cada trabajador de sus compañeros tras un NAT compartido. Pero es el propio
 *   cliente quien la declara — `workerId` es opcional y libre —, así que por sí
 *   sola no limita nada: rotarla da escrituras ilimitadas sin autenticación.
 * - IP: es la única que el cliente no puede rotar. Umbral holgado a propósito
 *   (30 envíos / 5 min = 360 por hora) para que una faena entera detrás de una
 *   sola IP siga enviando, acotando igual la escritura masiva.
 *
 * Ambas usan `consumeFixedWindowLimit`, que cuenta también los envíos exitosos
 * (`recordFailure` sólo servía cuando el "intento" era un fallo de login).
 */
const SUBMIT_IDENTITY_QUOTA = { maxAttempts: 5, lockMs: 15 * 60 * 1000 }
const SUBMIT_IP_QUOTA = { maxAttempts: 30, lockMs: 5 * 60 * 1000 }

/**
 * Acción PÚBLICA (sin login). El trabajador envía el PPA. No usa guardPermission:
 * la validación de datos (Zod) y la pertenencia a faena son la única barrera.
 */
export async function submitPpaAction(
  input: z.infer<typeof ppaSubmitSchema>,
): Promise<ActionState & { data?: { token: string; resultado: string } }> {
  // Antes de la cuota y de cualquier escritura: una PWA cacheada puede seguir
  // enviando después de que el módulo se apagó (o incluso sin red hasta que
  // recupera conexión), y el layout no protege a la acción.
  if (!await isRouteOperational("/prevencion/ppa")) {
    return { ok: false, message: "PPA Digital está inactivo temporalmente." }
  }
  const h = await headers()
  const clientIp = resolveTrustedClientIp(h)

  // La cuota por IP se consume SIEMPRE y antes de validar: un payload basura
  // repetido también es escritura no autenticada contra la base.
  const ipQuota = await consumeFixedWindowLimit(`ppa-ip:${clientIp}`, SUBMIT_IP_QUOTA)
  if (!ipQuota.allowed) {
    return {
      ok: false,
      message: `Se alcanzó el límite de envíos desde esta conexión. Intenta de nuevo en ${SUBMIT_IP_QUOTA.lockMs / 60000} minutos.`,
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

  // Identidad estable (id de la lista controlada, luego RUT normalizado —ya
  // validado con dígito verificador por el schema—). Caemos a IP sólo cuando el
  // envío no trae ninguna identidad.
  const identity = parsed.data.workerId
    || (parsed.data.workerRut ? cleanRut(parsed.data.workerRut) : "")
    || clientIp
  const identityQuota = await consumeFixedWindowLimit(`ppa:${identity}`, SUBMIT_IDENTITY_QUOTA)
  if (!identityQuota.allowed) {
    return {
      ok: false,
      message: `Has enviado demasiados formularios. Por favor, intenta de nuevo en ${SUBMIT_IDENTITY_QUOTA.lockMs / 60000} minutos.`,
    }
  }

  try {
    const { token, submission } = await createPpaSubmission(parsed.data)
    revalidateOperationalViews(["/prevencion/ppa"])
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
  const clientIp = resolveTrustedClientIp(h)
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
