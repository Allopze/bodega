"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { markPdtpExecution } from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para registrar ejecución PDTP." }
  }

  try {
    await markPdtpExecution({
      activityId: formData.get("activityId"),
      worksiteId: formData.get("worksiteId"),
      year: formData.get("year"),
      month: formData.get("month"),
      week: formData.get("week"),
      executedQuantity: formData.get("executedQuantity"),
      evidenceText: formData.get("evidenceText") ?? "",
    }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<void> {
  await markPdtpExecutionAction(formData)
}
