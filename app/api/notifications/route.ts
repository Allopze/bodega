/**
 * GET  /api/notifications        — returns latest 20 + unreadCount for the current user
 * POST /api/notifications        — marks a specific notification as read { id }
 * POST /api/notifications/all    — marks ALL notifications as read
 */

import { NextRequest, NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth/auth"
import {
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/services/notifications"

// Disable caching for this endpoint
export const dynamic = "force-dynamic"

function getSession(): Promise<Session | null> {
  return auth() as Promise<Session | null>
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const [items, unreadCount] = await Promise.all([
    getNotificationsForUser(userId, 20),
    getUnreadCount(userId),
  ])

  return NextResponse.json({ items, unreadCount })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const userId = session.user.id

  if (body.markAll === true) {
    await markAllNotificationsRead(userId)
    return NextResponse.json({ ok: true })
  }

  if (typeof body.id === "string") {
    await markNotificationRead(body.id, userId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Provide id or markAll" }, { status: 400 })
}
