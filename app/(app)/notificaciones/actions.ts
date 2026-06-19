"use server"

import { requireAuth } from "@/lib/auth/can"
import { markNotificationRead, markAllNotificationsRead } from "@/lib/services/notifications"
import { revalidatePath } from "next/cache"

/**
 * Mark a single notification as read.
 * Server Action (CSRF-safe) — replaces the former POST /api/notifications.
 */
export async function markReadAction(notificationId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireAuth()
    await markNotificationRead(notificationId, session.user.id)
    revalidatePath("/") // notifications appear in the global layout
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al marcar como leída" }
  }
}

/**
 * Mark all notifications as read.
 * Server Action (CSRF-safe) — replaces the former POST /api/notifications markAll.
 */
export async function markAllReadAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireAuth()
    await markAllNotificationsRead(session.user.id)
    revalidatePath("/")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al marcar como leídas" }
  }
}
