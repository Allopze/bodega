"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { guardAuth, canAny, can } from "@/lib/auth/can"
import { getDefinition } from "@/lib/sst/definitions/index"
import { writableSectionIds } from "@/lib/sst/checklist"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getEvaluation, saveResponses } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import type { sstResponsesBatchSchema } from "@/lib/validation/sst"
import type { z } from "zod"
import { scopeToIds } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function saveResponsesAction(
  evaluationId: string,
  responses: z.infer<typeof sstResponsesBatchSchema>,
): Promise<ActionState> {
  // Permite tanto a evaluadores plenos (sst:create) como a roles acotados a una
  // sección por permiso (p.ej. conductor_lider con sst:evaluate_acompanamiento).
  const { session, error } = await guardAuth()
  if (error) return error
  if (!canAny(session, "sst:create", "sst:evaluate_acompanamiento")) {
    return { ok: false, message: "No tienes permisos para realizar esta acción" }
  }

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  // Refuerzo server-side: si el usuario no es evaluador pleno, solo puede escribir
  // las secciones que su permiso habilita (no basta con ocultarlas en la UI).
  const canCreate = can(session, "sst:create")
  if (!canCreate) {
    const evaluation = await getEvaluation(evaluationId, worksiteIds)
    if (!evaluation) return { ok: false, message: "Evaluación no encontrada o sin acceso." }
    const definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
    const allowed = writableSectionIds(definition, session.user.permissions ?? [], false)
    const invalid = responses.some((r) => !allowed.has(r.seccionId))
    if (invalid) {
      return { ok: false, message: "No tienes permisos para editar esta sección." }
    }
  }

  try {
    await saveResponses(evaluationId, responses, worksiteIds)
    revalidatePath(`${REVALIDATE}/${evaluationId}`)
    return { ok: true, message: "Respuestas guardadas" }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "Error al guardar respuestas") }
  }
}
