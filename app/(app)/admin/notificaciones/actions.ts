"use server"

import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import {
  cleanupOldNotifications,
} from "@/lib/services/notification-read"
import { getOperationalSettings } from "@/lib/services/system-settings"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/notificaciones"

function errorState(message: string): ActionState {
  return { ok: false, message }
}

export async function cleanupReadNotificationsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:notifications")
  } catch {
    return errorState("Sin permisos")
  }

  try {
    const settings = await getOperationalSettings()
    await cleanupOldNotifications(settings.notificationRetentionDays)
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "delete",
      entityType: "notification",
      entityId:   "cleanup_script",
      newState:   { retentionDays: settings.notificationRetentionDays },
    })
    revalidatePath(REVALIDATE)
    return {
      ok: true,
      message: `Notificaciones leídas con más de ${settings.notificationRetentionDays} días eliminadas`,
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
