"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { markFollowup, getFollowups } from "@/lib/services/sst"
import type { ActionState } from "@/lib/validation/sst"
import type { sstFollowupMarkSchema } from "@/lib/validation/sst"
import { sstScheduledFollowups } from "@/db/schema/sst"
import type { z } from "zod"
import { scopeToIds } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function markFollowupAction(
  followupId: string,
  input: z.infer<typeof sstFollowupMarkSchema>,
): Promise<ActionState> {
  const { session, error } = await guardPermission("sst:manage")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    await markFollowup(followupId, input, worksiteIds)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Seguimiento actualizado" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al actualizar el seguimiento" }
  }
}

export async function getFollowupsAction(
  evaluationId: string,
): Promise<ActionState & { data?: { followups: typeof sstScheduledFollowups.$inferSelect[] } }> {
  const { session, error } = await guardPermission("sst:view")
  if (error) return error

  const scope = resolveWorksiteScope(session)
  const worksiteIds = scopeToIds(scope)

  try {
    const followups = await getFollowups(evaluationId, worksiteIds)
    return { ok: true, data: { followups } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener seguimientos" }
  }
}
