/**
 * GET /api/notifications — returns latest 20 + unreadCount for the current user.
 *
 * Mutations (mark-read / mark-all-read) are Server Actions in
 * app/(app)/notificaciones/actions.ts for CSRF safety.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { getNotificationsForUser, getUnreadCount } from "@/lib/services/notifications"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const [items, unreadCount] = await Promise.all([
    getNotificationsForUser(userId, 20) as Promise<NotificationItem[]>,
    getUnreadCount(userId),
  ])

  return NextResponse.json({ items, unreadCount })
}
