"use server"

import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { recordPdtpProgramAcknowledgment } from "@/lib/services/pdtp/program-acknowledgments"

const programIdSchema = z.string().trim().min(1).max(200)

/**
 * Toma de conocimiento: la dispara la propia página del programa al montarse
 * (no un render del servidor, que también correría en un prefetch sin que
 * nadie haya visto nada). No revalida: la constancia no cambia lo que ve quien
 * abrió la página, y la jefatura la verá en su próxima carga.
 */
export async function acknowledgePdtpProgramAction(programId: string): Promise<{ ok: boolean }> {
  const { session, error } = await guardPermission("prevention:pdtp:view")
  if (error) return { ok: false }
  const parsed = programIdSchema.safeParse(programId)
  if (!parsed.success) return { ok: false }
  try {
    const result = await recordPdtpProgramAcknowledgment(parsed.data, session.user.id)
    return { ok: result.recorded }
  } catch (err) {
    // Es un registro de fondo: un fallo no puede interrumpir a quien está
    // leyendo el programa, pero tiene que quedar a la vista en los logs.
    logger.error("[acknowledgePdtpProgramAction]", err)
    return { ok: false }
  }
}
