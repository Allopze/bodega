/**
 * lib/auth/system-rbac.ts — System RBAC definitions
 *
 * `SYSTEM_ROLES` is maintained manually (extra fields like `isGlobal`).
 * `SYSTEM_PERMISSIONS` and `SYSTEM_ROLE_PERMISSIONS` are **derived automatically**
 * from the module registry manifests — no manual sync required.
 *
 * To add a new module's permissions:
 *   1. Create the manifest with `permissions`, `permissionMeta`, and `defaultGrants`
 *   2. Register it in `modules/registry.ts`
 *   3. Done. The auth bootstrap and admin UI pick them up automatically.
 */
import { permissions, rolePermissions, roles } from "../../db/schema"
import { registry } from "../../modules/registry"

// ── Roles (manual — extra metadata not in manifests) ──────────────────────────

export const SYSTEM_ROLES = [
  { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total técnico del sistema", isGlobal: true },
  { id: "rol-jefa", name: "jefa_chome", label: "Jefatura", description: "Revisa, aprueba y administra la operación", isGlobal: true },
  { id: "rol-sec", name: "secretaria", label: "Secretaría", description: "Revisa, aprueba y gestiona operación diaria", isGlobal: true },
  { id: "rol-prev", name: "prevencionista", label: "Jefa Dpto. Prevención de riesgos", description: "Revisa y aprueba solicitudes", isGlobal: true },
  { id: "rol-sol-faena", name: "solicitante_faena", label: "Solicitante faena", description: "Solicita ítems para sus faenas asignadas", isGlobal: false },
  { id: "rol-prev-faena", name: "prevencionista_faena", label: "Prevencionista faena", description: "Evalúa EPP, recibe en faena y gestiona stock en sus faenas asignadas", isGlobal: false },
  { id: "rol-jefe-mant", name: "jefe_mantencion", label: "Jefe de mantención", description: "Solicita repuestos, servicios y otros para todas las faenas", isGlobal: true },
  { id: "rol-cond-lider", name: "conductor_lider", label: "Conductor líder", description: "Evalúa el acompañamiento en terreno (Punto 3) de trabajadores nuevos en sus faenas asignadas", isGlobal: false },
  { id: "rol-admin-contrato", name: "admin_contrato", label: "Administrador de contrato / Supervisor de faena", description: "Evalúa SST (secciones 1-2) de trabajadores nuevos y antiguos en sus faenas asignadas", isGlobal: false },
  { id: "rol-sup-faena", name: "supervisor_faena", label: "Supervisor de faena", description: "Ejecuta actividades preventivas, reportes operacionales e inspecciones en sus faenas asignadas", isGlobal: false },
  { id: "rol-jt", name: "jefe_terreno", label: "Jefe de terreno", description: "Lidera actividades de terreno, alcotest, emergencias y bitacora preventiva en sus faenas asignadas", isGlobal: false },
  { id: "rol-cphs", name: "cphs", label: "Comité Paritario de Higiene y Seguridad", description: "Miembro del Comite Paritario de Higiene y Seguridad con acceso a programa, reuniones e indicadores", isGlobal: false },
] satisfies Array<typeof roles.$inferInsert>

// ── Permissions (auto-derived from module manifests) ──────────────────────────

/** Lookup map: role slug → role id. */
const ROLE_ID_BY_SLUG = new Map(SYSTEM_ROLES.map((r) => [r.name, r.id]))

/**
 * Flat array of all permissions declared by every registered module.
 * Each module manifest's `permissionMeta` provides the DB id and description.
 */
export const SYSTEM_PERMISSIONS = (registry as readonly { id: string; permissions: readonly string[]; permissionMeta?: Record<string, { id: string; description: string }> }[]).flatMap((m) =>
  m.permissions.map((name) => {
    const meta = m.permissionMeta?.[name]
    return {
      id:          meta?.id ?? name,
      name,
      module:      m.id,
      description: meta?.description ?? name,
    }
  }),
) satisfies Array<typeof permissions.$inferInsert>

// ── Role ↔ Permission mappings (auto-derived from manifests' defaultGrants) ───

/**
 * Flat array of { roleId, permissionId } derived from every module's
 * `defaultGrants`. The admin role gets ALL permissions automatically.
 */
export const SYSTEM_ROLE_PERMISSIONS: Array<typeof rolePermissions.$inferInsert> = (() => {
  // Build a lookup: module:permissionName → permissionId
  const permIdByKey = new Map(
    SYSTEM_PERMISSIONS.map((p) => [`${p.module}:${p.name}`, p.id]),
  )

  return [
    // Admin gets every permission
    ...SYSTEM_PERMISSIONS.map((p) => ({ roleId: "rol-admin", permissionId: p.id })),
    // All other roles from manifests' defaultGrants
    ...(registry as readonly { id: string; defaultGrants?: readonly { roleSlug: string; permission: string }[] }[]).flatMap((m) =>
      (m.defaultGrants ?? [])
        .filter((grant) => grant.roleSlug !== "administrador")
        .map((grant) => {
          const roleId = ROLE_ID_BY_SLUG.get(grant.roleSlug)
          if (!roleId) throw new Error(`[system-rbac] Unknown role slug "${grant.roleSlug}" in module "${m.id}" defaultGrants`)
          const permissionId = permIdByKey.get(`${m.id}:${grant.permission}`)
          if (!permissionId) throw new Error(`[system-rbac] Permission "${grant.permission}" not found in module "${m.id}"`)
          return { roleId, permissionId }
        })
    ),
  ]
})()
