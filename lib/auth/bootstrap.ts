import { createHash, randomBytes } from "crypto"
import { count, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, users } from "@/db/schema"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

export { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/system-rbac"

/** Permissions removed from the registry that must not survive in direct grants. */
const RETIRED_PERMISSION_NAMES = [
  "prevention:pdtp:manage",
  // El motor de checklist propio del PDTP se retiró: los instrumentos viven en
  // Inspecciones. Sacarlos del manifiesto no basta —las concesiones ya
  // otorgadas sobreviven en `user_permissions` y `role_permissions`—.
  "prevention:pdtp:checklist:manage",
  "prevention:pdtp:checklist:fill",
  "requests:submit",
  "operations:assign_work",
  "traceability:view",
  "traceability:reconcile_integrity",
] as const

/**
 * Idempotently seeds system roles/permissions. Accepts an optional transaction
 * executor so callers (e.g. the bootstrap registration) can run it atomically
 * within their own transaction — passing `tx` también evita reentrar en la
 * conexión en montajes de una sola conexión (tests con pglite).
 *
 * **`defaultGrants` son defaults, no estado impuesto.** Los grants de un
 * manifiesto se aplican únicamente la primera vez que aparecen: cuando el
 * permiso es nuevo en esta BD, o cuando el rol es nuevo. De ahí en adelante,
 * quien manda es lo que haya en la BD, así que lo que un administrador ajuste
 * en `/admin/roles` sobrevive a los deploys.
 *
 * Antes esta función borraba **todos** los grants de los 15 roles del sistema y
 * los reinsertaba desde los manifiestos, así que cada `deploy:prod` revertía en
 * silencio cualquier ajuste hecho por la UI —que no advertía nada—.
 *
 * Consecuencias que hay que tener presentes:
 * - Cambiar el `defaultGrants` de un permiso que **ya existe** en producción no
 *   se propaga solo: hay que replicarlo en `/admin/roles` (o retirar el permiso
 *   vía `RETIRED_PERMISSION_NAMES` y volver a introducirlo).
 * - Quitar un permiso del manifiesto sin listarlo en `RETIRED_PERMISSION_NAMES`
 *   deja sus grants vivos en la BD. Esa lista es la vía explícita para retirar.
 */
export async function ensureSystemRbac(executor: typeof db | Tx = db) {
  // Qué existía ANTES de este upsert: es lo que distingue "primera vez que
  // este permiso/rol aparece" (aplicar sus defaults) de "ya estaba, la BD
  // manda" (no tocar sus grants).
  const existingRoleIds = new Set(
    (await executor.select({ id: roles.id }).from(roles)).map((row) => row.id),
  )
  const existingPermissionIds = new Set(
    (await executor.select({ id: permissions.id }).from(permissions)).map((row) => row.id),
  )

  for (const role of SYSTEM_ROLES) {
    await executor.insert(roles).values(role).onConflictDoUpdate({
      target: roles.id,
      set: {
        name: role.name,
        label: role.label,
        description: role.description ?? null,
      },
    })
  }

  for (const permission of SYSTEM_PERMISSIONS) {
    await executor.insert(permissions).values(permission).onConflictDoUpdate({
      target: permissions.id,
      set: {
        name: permission.name,
        module: permission.module,
        description: permission.description ?? null,
      },
    })
  }

  // System role grants are rebuilt below, but direct user grants can otherwise
  // keep a retired permission alive indefinitely. Remove every reference before
  // deleting its permission record so the normal RBAC sync is a full retirement.
  const retiredPermissions = await executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.name, [...RETIRED_PERMISSION_NAMES]))
  const retiredPermissionIds = retiredPermissions.map((permission) => permission.id)
  if (retiredPermissionIds.length > 0) {
    await executor.delete(userPermissions).where(inArray(userPermissions.permissionId, retiredPermissionIds))
    await executor.delete(rolePermissions).where(inArray(rolePermissions.permissionId, retiredPermissionIds))
    await executor.delete(permissions).where(inArray(permissions.id, retiredPermissionIds))
  }

  // Solo los grants estrenados en esta corrida. Un permiso nuevo lleva sus
  // defaults a todos los roles que lo declaran, y un rol nuevo estrena todos
  // los suyos (si no, un rol recién agregado al manifiesto nacería sin
  // permisos, porque los que le tocan ya existían en la BD).
  const grantsToSeed = SYSTEM_ROLE_PERMISSIONS.filter((grant) =>
    !existingPermissionIds.has(grant.permissionId) || !existingRoleIds.has(grant.roleId),
  )
  if (grantsToSeed.length > 0) {
    // `onConflictDoNothing` porque el par pudo quedar a medio sembrar por una
    // corrida anterior interrumpida: sembrar de nuevo no debe fallar.
    await executor.insert(rolePermissions).values(grantsToSeed).onConflictDoNothing()
  }
}

export async function getUserCount() {
  const [row] = await db.select({ value: count() }).from(users)
  return row?.value ?? 0
}

export function generateInvitationToken() {
  return randomBytes(32).toString("base64url")
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
