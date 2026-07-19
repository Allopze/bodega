"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { saveActionPlanItem, deleteActionPlanItem } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import type { sstActionPlanItemSchema } from "@/lib/validation/sst"
import type { z } from "zod"
import { scopeToIds } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function saveActionPlanItemAction(
  input: z.infer<typeof sstActionPlanItemSchema>,
): Promise<ActionState & { data?: { id: string; capaActionId: string | null } }> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const saved = await saveActionPlanItem(input, worksiteIds, session.user.id)
    revalidatePath(`${REVALIDATE}/${input.evaluationId}`)
    return { ok: true, message: "Ítem del plan guardado", data: { id: saved.id, capaActionId: saved.capaActionId } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al guardar el ítem del plan" }
  }
}

export async function deleteActionPlanItemAction(id: string): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await deleteActionPlanItem(id, worksiteIds, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ítem eliminado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar el ítem" }
  }
}
