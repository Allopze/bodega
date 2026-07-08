import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { permissions, rolePermissions, roles } from "@/db/schema"
import { nanoid } from "@/lib/id"

/** Roles that cannot be deleted and whose core permissions cannot be emptied. */
export const PROTECTED_ROLE_SLUGS = new Set(["administrador"])

export interface RoleInput {
  id?: string
  name: string
  label: string
  description?: string
  isGlobal: boolean
  permissionIds: string[]
}

export interface RoleWithPermissions {
  id: string
  name: string
  label: string
  description: string | null
  isGlobal: boolean
  permissionIds: string[]
}

export interface AdminActor {
  userId: string
  userEmail?: string
}

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** Load every persisted role with its permission ids. */
export async function listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
  const roleRows = await db.query.roles.findMany({
    orderBy: (r, { asc }) => [asc(r.label)],
  })
  const grants = await db.select().from(rolePermissions)
  return roleRows.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    description: r.description ?? null,
    isGlobal: r.isGlobal,
    permissionIds: grants.filter((g) => g.roleId === r.id).map((g) => g.permissionId),
  }))
}

/** Reject missing roles and the protected `administrador` slug when deleting. */
export async function assertRoleCanBeModified(roleId: string, options?: { allowDelete?: boolean }): Promise<void> {
  const [row] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!row) throw new Error("Rol no encontrado")
  if (options?.allowDelete && PROTECTED_ROLE_SLUGS.has(row.name)) {
    throw new Error(`El rol "${row.name}" está protegido y no puede eliminarse`)
  }
}

/** Insert a new role and its permissions within a single transaction. */
export async function createRoleWithPermissions(input: RoleInput, _actor: AdminActor, client: Tx | typeof db = db): Promise<RoleWithPermissions> {
  const slug = toSlug(input.name)
  if (!slug) throw new Error("El nombre del rol es obligatorio")

  const existing = await (client as typeof db).query.roles.findFirst({ where: eq(roles.name, slug) })
  if (existing) throw new Error(`Ya existe un rol con el slug "${slug}"`)

  const id = input.id ?? `role-${nanoid()}`
  await (client as typeof db).insert(roles).values({
    id,
    name: slug,
    label: input.label.trim(),
    description: input.description ?? null,
    isGlobal: input.isGlobal,
  })

  if (input.permissionIds.length > 0) {
    await (client as typeof db).insert(rolePermissions).values(
      input.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
    )
  }

  return {
    id,
    name: slug,
    label: input.label.trim(),
    description: input.description ?? null,
    isGlobal: input.isGlobal,
    permissionIds: input.permissionIds,
  }
}

/** Update role metadata and replace its permission grants transactionally. */
export async function updateRoleWithPermissions(
  id: string,
  input: RoleInput,
  _actor: AdminActor,
  client: Tx | typeof db = db,
): Promise<RoleWithPermissions> {
  await assertRoleCanBeModified(id)

  // Protected roles must keep at least one permission.
  const [current] = await (client as typeof db).select().from(roles).where(eq(roles.id, id)).limit(1)
  if (!current) throw new Error("Rol no encontrado")
  if (PROTECTED_ROLE_SLUGS.has(current.name) && input.permissionIds.length === 0) {
    throw new Error("El rol administrador debe conservar al menos un permiso")
  }

  const slug = toSlug(input.name) || current.name
  if (slug !== current.name) {
    const conflict = await (client as typeof db).query.roles.findFirst({ where: eq(roles.name, slug) })
    if (conflict && conflict.id !== id) throw new Error(`Ya existe un rol con el slug "${slug}"`)
  }

  await (client as typeof db)
    .update(roles)
    .set({
      name: slug,
      label: input.label.trim(),
      description: input.description ?? null,
      isGlobal: input.isGlobal,
    })
    .where(eq(roles.id, id))

  // Replace permission grants atomically.
  await (client as typeof db).delete(rolePermissions).where(eq(rolePermissions.roleId, id))
  if (input.permissionIds.length > 0) {
    await (client as typeof db).insert(rolePermissions).values(
      input.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
    )
  }

  return {
    id,
    name: slug,
    label: input.label.trim(),
    description: input.description ?? null,
    isGlobal: input.isGlobal,
    permissionIds: input.permissionIds,
  }
}

/** Validate that every provided id resolves to a real permission. */
export async function assertPermissionsExist(permissionIds: string[], client: Tx | typeof db = db): Promise<void> {
  if (permissionIds.length === 0) return
  const rows = await (client as typeof db)
    .select({ id: permissions.id })
    .from(permissions)
    .where(and(...permissionIds.map((pid) => eq(permissions.id, pid))))
  if (rows.length !== permissionIds.length) {
    throw new Error("Uno o más permisos seleccionados no existen")
  }
}
