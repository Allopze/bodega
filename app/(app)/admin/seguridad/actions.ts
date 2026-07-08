"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { clearRateLimitRecord, pruneExpiredLocks } from "@/lib/services/rate-limit"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/seguridad"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

export async function clearRateLimitKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:security")
  } catch {
    return errorState("Sin permisos")
  }

  const key = (formData.get("key") as string | null)?.trim()
  if (!key) return errorState("Key requerida")

  try {
    const removed = await clearRateLimitRecord(key)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "delete",
      entityType: "rate_limit",
      entityId:   key,
      newState:   { removed },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Bloqueo de "${key}" liberado` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function pruneRateLimitLocksAction(_prev: ActionState): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:security")
  } catch {
    return errorState("Sin permisos")
  }

  try {
    await pruneExpiredLocks()
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "delete",
      entityType: "rate_limit",
      entityId:   "prune_expired",
      newState:   { pruner: "manual_admin" },
    })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Bloqueos expirados purgados" }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
