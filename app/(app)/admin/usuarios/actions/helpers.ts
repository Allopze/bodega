"use server"

import { requirePermission } from "@/lib/auth/can"

export async function requireAdminPermission() {
  try { return await requirePermission("admin:users") }
  catch { return null }
}
