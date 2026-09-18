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
  if (
    !input
    || typeof input !== "object"
    || typeof input.programId !== "string"
    || typeof input.activityId !== "string"
    || input.programId.trim().length === 0
    || input.activityId.trim().length === 0
    || !Array.isArray(input.roleIds)
    || input.roleIds.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return { ok: false, message: "Los ejecutores seleccionados no son válidos." }
  }
  const programId = input.programId.trim()
  const activityId = input.activityId.trim()
  const roleIds = [...new Set(input.roleIds.map((id) => id.trim()))]
  try {
    await setPdtpActivityExecutorAssignments({
      programId,
      activityId,
      roleIds,
      userId: guard.session.user.id,
    })
    revalidatePath(ROOT)
    revalidatePath(`${ROOT}/${programId}`)
    revalidatePath(`${ROOT}/${programId}/editar`)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudieron actualizar los ejecutores.") }
  }
}
