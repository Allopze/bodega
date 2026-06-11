import { createHash, randomBytes } from "crypto"
import { count, inArray } from "drizzle-orm"
import { db } from "@/db"
import { permissions, rolePermissions, roles, users } from "@/db/schema"

export const SYSTEM_ROLES = [
  { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total técnico del sistema" },
  { id: "rol-jefa", name: "jefa_chome", label: "Jefatura", description: "Revisa, aprueba y administra la operación" },
  { id: "rol-sec", name: "secretaria", label: "Secretaría", description: "Revisa, aprueba y gestiona operación diaria" },
  { id: "rol-prev", name: "prevencionista", label: "Prevencionista oficina", description: "Revisa y aprueba solicitudes" },
  { id: "rol-sol-faena", name: "solicitante_faena", label: "Prevencionista faena", description: "Solicita ítems para sus faenas asignadas" },
] satisfies Array<typeof roles.$inferInsert>

export const SYSTEM_PERMISSIONS = [
  { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
  { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver solicitudes propias" },
  { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas las solicitudes" },
  { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes a aprobación" },
  { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Revisar y aprobar solicitudes" },
  { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver módulo de órdenes de compra" },
  { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear órdenes de compra" },
  { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC a proveedor" },
  { id: "p-pur-sup", name: "purchasing:manage_suppliers", module: "purchasing", description: "Administrar proveedores" },
  { id: "p-rec-reg-office", name: "receiving:register_office", module: "receiving", description: "Registrar llegada a oficina" },
  { id: "p-rec-reg-faena", name: "receiving:register_faena", module: "receiving", description: "Registrar recepción en faena" },
  { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepciones" },
  { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
  { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Registrar movimientos" },
  { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajustar stock" },
  { id: "p-rep-view", name: "reports:view", module: "reports", description: "Ver reportes y matriz de trazabilidad" },
  { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Gestionar usuarios" },
  { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Gestionar faenas" },
  { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Gestionar trabajadores" },
  { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Gestionar catálogo" },
  { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Gestionar proveedores" },
  { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Configuración del sistema" },
  { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Ver log de auditoría" },
] satisfies Array<typeof permissions.$inferInsert>

const JEFATURA_PERMISSION_IDS = [
  "p-req-all",
  "p-apr",
  "p-pur-view",
  "p-rec-view",
  "p-wh-stock",
  "p-rep-view",
]

const SECRETARIA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-all", "p-req-submit",
  "p-apr",
  "p-pur-view", "p-pur-create", "p-pur-send", "p-pur-sup",
  "p-rec-reg-office", "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-rep-view",
  "p-adm-usr", "p-adm-ws", "p-adm-wrk", "p-adm-prod", "p-adm-sup",
]

const PREVENCIONISTA_OFICINA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-all", "p-req-submit",
  "p-apr",
  "p-rec-reg-office", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-rep-view",
  "p-adm-usr", "p-adm-ws", "p-adm-wrk", "p-adm-prod", "p-adm-sup",
]

const PREVENCIONISTA_FAENA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-submit",
  "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-adm-wrk",
]

export const SYSTEM_ROLE_PERMISSIONS = [
  ...SYSTEM_PERMISSIONS.map((permission) => ({ roleId: "rol-admin", permissionId: permission.id })),
  ...JEFATURA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...SECRETARIA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...PREVENCIONISTA_OFICINA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...PREVENCIONISTA_FAENA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sol-faena", permissionId })),
] satisfies Array<typeof rolePermissions.$inferInsert>

export async function ensureSystemRbac() {
  for (const role of SYSTEM_ROLES) {
    await db.insert(roles).values(role).onConflictDoUpdate({
      target: roles.id,
      set: {
        name: role.name,
        label: role.label,
        description: role.description ?? null,
      },
    })
  }

  for (const permission of SYSTEM_PERMISSIONS) {
    await db.insert(permissions).values(permission).onConflictDoUpdate({
      target: permissions.id,
      set: {
        name: permission.name,
        module: permission.module,
        description: permission.description ?? null,
      },
    })
  }

  await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, SYSTEM_ROLES.map((role) => role.id)))
  await db.insert(rolePermissions).values(SYSTEM_ROLE_PERMISSIONS)
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
