"use server"

import { createPpaSubmission, listWorkersForWorksite } from "@/lib/services/ppa"
import { ppaSubmitSchema, type ActionState } from "@/lib/validation/ppa"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import type { PpaAnswers } from "@/lib/ppa/types"
import { z } from "zod"
import { logger } from "@/lib/logger"

/**
 * Acción PÚBLICA (sin login). El trabajador envía el PPA. No usa guardPermission:
 * la validación de datos (Zod) y la pertenencia a faena son la única barrera.
 */
export async function submitPpaAction(
  input: z.infer<typeof ppaSubmitSchema>,
): Promise<ActionState & { data?: { token: string; resultado: string } }> {
  const parsed = ppaSubmitSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    const { token, submission } = await createPpaSubmission(parsed.data)
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

/** Lista trabajadores activos de una faena (para el selector del formulario público). */
export async function listWorkersAction(
  worksiteId: string,
): Promise<{ ok: boolean; workers: { id: string; label: string }[] }> {
  if (!worksiteId) return { ok: false, workers: [] }
  try {
    const workers = await listWorkersForWorksite(worksiteId)
    return {
      ok: true,
      workers: workers.map((w) => ({
        id: w.id,
        label: `${w.firstName} ${w.lastName}${w.rut ? ` · ${w.rut}` : ""}`,
      })),
    }
  } catch (e) {
    logger.error("[ppa] listWorkers failed", e)
    return { ok: false, workers: [] }
  }
}

/**
 * Previsualización de evaluación en el cliente (opcional). Permite mostrar al
 * trabajador, antes de confirmar, si el envío detendrá el trabajo. Solo lógica pura.
 */
export async function previewEvaluationAction(answers: PpaAnswers) {
  return evaluatePpa(answers)
}
