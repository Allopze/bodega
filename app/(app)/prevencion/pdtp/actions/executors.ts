"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { setPdtpActivityExecutorAssignments } from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"

const ROOT = "/prevencion/pdtp"

export async function setPdtpActivityExecutorAssignmentsAction(input: {
  programId: string
  activityId: string
  roleIds: string[]
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input.programId || !input.activityId || !Array.isArray(input.roleIds) || input.roleIds.some((id) => typeof id !== "string")) {
    return { ok: false, message: "Los ejecutores seleccionados no son válidos." }
  }
  try {
    await setPdtpActivityExecutorAssignments({
      programId: input.programId,
      activityId: input.activityId,
      roleIds: input.roleIds,
      userId: guard.session.user.id,
    })
    revalidatePath(ROOT)
    revalidatePath(`${ROOT}/${input.programId}`)
    revalidatePath(`${ROOT}/${input.programId}/editar`)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudieron actualizar los ejecutores.") }
  }
}
