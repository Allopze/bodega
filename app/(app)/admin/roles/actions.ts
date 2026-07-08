"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { roles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/masters"
import {
  assertPermissionsExist,
  createRoleWithPermissions,
  PROTECTED_ROLE_SLUGS,
  updateRoleWithPermissions,
  type RoleInput,
} from "@/lib/services/admin-roles"

const REVALIDATE = "/admin/roles"

function parseIds(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function saveRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:roles")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const id = (formData.get("id") as string | null)?.trim() || undefined
  const name = (formData.get("name") as string | null)?.trim() ?? ""
  const label = (formData.get("label") as string | null)?.trim() ?? name
  const description = (formData.get("description") as string | null)?.trim() || undefined
  const isGlobal = formData.get("isGlobal") === "on"
  const permissionIds = parseIds(formData.get("permissionIds"))

  if (!name) return { ok: false, fieldErrors: { name: ["Ingresa un nombre de rol"] } }
  if (label.length > 80) return { ok: false, fieldErrors: { label: ["Máximo 80 caracteres"] } }

  const input: RoleInput = { id, name, label, description, isGlobal, permissionIds }

  try {
    await assertPermissionsExist(permissionIds)
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }

  try {
    if (id) {
      // Protected roles cannot be renamed into another protected slug's space; the service
      // enforces keeping at least one permission for administrador.
      const [current] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
      if (!current) return { ok: false, message: "Rol no encontrado" }

      const updated = await updateRoleWithPermissions(id, input, {
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
      })

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "role",
        entityId: id,
        entityCode: updated.name,
        newState: { label: updated.label, isGlobal: updated.isGlobal, permissionIds: updated.permissionIds },
      })

      revalidatePath(REVALIDATE)
      return { ok: true, message: `Rol ${updated.label} actualizado` }
    }

    const created = await createRoleWithPermissions(input, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "role",
      entityId: created.id,
      entityCode: created.name,
      newState: { label: created.label, isGlobal: created.isGlobal, permissionIds: created.permissionIds },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Rol ${created.label} creado` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export async function setRolePermissionsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Convenience path used by the list view when only permission assignments change.
  return saveRoleAction(_prev, formData)
}

export { PROTECTED_ROLE_SLUGS }
