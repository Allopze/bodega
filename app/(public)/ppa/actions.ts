"use server"

import { revalidatePath } from "next/cache"
import { createPpaSubmission, findWorkerByRut } from "@/lib/services/ppa"
import { ppaSubmitSchema, type ActionState } from "@/lib/validation/ppa"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { headers } from "next/headers"
import { checkRateLimit, recordFailure } from "@/lib/services/rate-limit"
import { validateRut } from "@/lib/rut"

/**
 * Acción PÚBLICA (sin login). El trabajador envía el PPA. No usa guardPermission:
 * la validación de datos (Zod) y la pertenencia a faena son la única barrera.
 */
export async function submitPpaAction(
  input: z.infer<typeof ppaSubmitSchema>,
): Promise<ActionState & { data?: { token: string; resultado: string } }> {
  const h = await headers()
  const clientIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  const rateLimitKey = `ppa:${clientIp}`

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
  worker?: { id: string; name: string; position: string | null; worksiteId: string; worksiteName: string }
  message?: string
}> {
  if (!rut) return { ok: false, message: "Ingresa tu RUT." }

  if (!validateRut(rut)) {
    return { ok: false, message: "RUT inválido. Debe tener formato 12345678-9 o similar." }
  }

  try {
    const worker = await findWorkerByRut(rut)
    if (!worker) {
      return { ok: false, message: "No se encontró ningún trabajador activo con este RUT." }
    }
    return {
      ok: true,
      worker: {
        id: worker.id,
        name: `${worker.firstName} ${worker.lastName}`,
        position: worker.position,
        worksiteId: worker.worksiteId,
        worksiteName: worker.worksiteName ?? "",
      },
    }
  } catch (e) {
    logger.error("[ppa] findWorkerByRut failed", e)
    return { ok: false, message: "Error al buscar el trabajador." }
  }
}
