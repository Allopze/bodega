"use server"

import { requirePermission } from "@/lib/auth/can"

export const REVALIDATE = "/admin/usuarios"

export async function requireAdminPermission() {
  try { return await requirePermission("admin:users") }
  catch { return null }
}
