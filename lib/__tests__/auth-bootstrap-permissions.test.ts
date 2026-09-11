/**
 * Parity test: the derived SYSTEM_ROLE_PERMISSIONS must match the old hardcoded
 * mapping so the seed produces identical role_permissions rows.
 */

import { describe, it, expect } from "vitest"
import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES, SYSTEM_PERMISSIONS } from "../auth/system-rbac"

const permissionNameById = new Map(SYSTEM_PERMISSIONS.map((permission) => [permission.id, permission.name]))

function rolePermissions(roleId: string) {
  return [
    ...new Set(
    SYSTEM_ROLE_PERMISSIONS
      .filter((row) => row.roleId === roleId)
      .map((row) => permissionNameById.get(row.permissionId)),
    ),
  ]
}

describe("system-rbac → manifest parity", () => {
  it("every grant references an existing roleId", () => {
    const roleIds = new Set(SYSTEM_ROLES.map((r) => r.id))
    for (const g of SYSTEM_ROLE_PERMISSIONS) {
      expect(roleIds.has(g.roleId), `unknown roleId: ${g.roleId}`).toBe(true)
    }
  })

  it("every grant references an existing permissionId", () => {
    const permIds = new Set(SYSTEM_PERMISSIONS.map((p) => p.id))
    for (const g of SYSTEM_ROLE_PERMISSIONS) {
      expect(permIds.has(g.permissionId), `unknown permissionId: ${g.permissionId}`).toBe(true)
    }
  })

  it("produces a non-empty grants table", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.length).toBeGreaterThan(50)
  })

  it("does not expose a generic work assignment permission", () => {
    expect(SYSTEM_PERMISSIONS.map((permission) => permission.name)).not.toContain("operations:assign_work")
  })

  it("expone un rol por responsable PDTP con cargo propio", () => {
    // La planilla distingue SUP de JT, y Legal/RRHH y Subgerencia de operaciones
    // de la Jefatura; antes los tres colapsaban en otro rol y no se podía asignar
    // un usuario al responsable real de la actividad.
    const names = SYSTEM_ROLES.map((role) => role.name)
    for (const slug of ["supervisor_terreno", "gerente_legal_rrhh", "subgerente_operaciones"]) {
      expect(names, `falta el rol ${slug}`).toContain(slug)
      const roleId = SYSTEM_ROLES.find((role) => role.name === slug)!.id
      expect(SYSTEM_ROLE_PERMISSIONS.some((grant) => grant.roleId === roleId)).toBe(true)
    }
    // `supervisor` a secas no sirve: en las firmas SST ya significa "Administrador
    // de contrato" (SIGNATURE_ROLE_LABELS), que es otra persona.
    expect(names).not.toContain("supervisor")
    expect(names).not.toContain("supervisor_faena")
  })

  // These permissions must exist in the derived permission set, in the admin
  // module manifest, and be granted to the expected non-admin roles.
  const expectedAdminPermissions = [
    "admin:roles",
    "admin:cost_centers",
    "admin:product_catalogs",
    "admin:document_taxonomy",
    "admin:pdtp_catalog",
    "admin:deviation_catalog",
    "admin:worker_positions",
    "admin:fleet_catalog",
    "admin:security",
    "admin:folios",
    "admin:notifications",
    "admin:ops_settings",
  ] as const

  it("declares every new admin permission in the registry", () => {
    const names = new Set(SYSTEM_PERMISSIONS.map((p) => p.name))
    for (const permission of expectedAdminPermissions) {
      expect(names.has(permission), `missing permission: ${permission}`).toBe(true)
    }
  })

  it("administrador receives every new admin permission", () => {
    const perms = rolePermissions("rol-admin")
    for (const permission of expectedAdminPermissions) {
      expect(perms, `admin missing ${permission}`).toContain(permission)
    }
  })

  it("grants cost centers and product catalogs to secretaria", () => {
    const perms = rolePermissions("rol-sec")
    expect(perms).toContain("admin:cost_centers")
    expect(perms).toContain("admin:product_catalogs")
  })

  it("grants jefa_chome the operational admin catalogs", () => {
    const perms = rolePermissions("rol-jefa")
    expect(perms).toContain("admin:cost_centers")
    expect(perms).toContain("admin:product_catalogs")
    expect(perms).toContain("admin:pdtp_catalog")
    expect(perms).toContain("admin:fleet_catalog")
    expect(perms).toContain("admin:notifications")
    expect(perms).toContain("admin:worker_positions")
  })

  it("grants prevencionista the SST taxonomy, PDTP and deviation catalogs", () => {
    const perms = rolePermissions("rol-prev")
    expect(perms).toContain("admin:document_taxonomy")
    expect(perms).toContain("admin:pdtp_catalog")
    // Quien calibra los instrumentos es quien mantiene la lista maestra de
    // desviaciones: sin esto la pantalla existiría sin nadie que la use.
    expect(perms).toContain("admin:deviation_catalog")
    expect(perms).toContain("admin:worker_positions")
  })

  it("grants jefe_mantencion the fleet catalog", () => {
    const perms = rolePermissions("rol-jefe-mant")
    expect(perms).toContain("admin:fleet_catalog")
  })

  // Admin must have all permissions
  it("administrador has every permission", () => {
    const adminPerms = SYSTEM_ROLE_PERMISSIONS
      .filter((g) => g.roleId === "rol-admin")
      .map((g) => g.permissionId)
    expect(new Set(adminPerms)).toEqual(
      new Set(SYSTEM_PERMISSIONS.map((p) => p.id)),
    )
  })

  it("allows Jefa Dpto. Prevención de riesgos to manage catalog, suppliers, users, faenas, workers, and worker deliveries", () => {
    const perms = rolePermissions("rol-prev")

    expect(perms).toEqual(expect.arrayContaining([
      "requests:create",
      "requests:view_all",
      "approvals:approve",
      "receiving:register_office",
      "warehouse:view_stock",
      "warehouse:register_movement",
      "admin:users",
      "admin:worksites",
      "admin:workers",
      "admin:products",
      "admin:suppliers",
    ]))
  })

  it("keeps prevencionista faena scoped to faena operations plus worker creation", () => {
    const perms = rolePermissions("rol-sol-faena")

    expect(perms).toEqual(expect.arrayContaining([
      "requests:create",
      "requests:view_own",
      "receiving:register_faena",
      "warehouse:view_stock",
      "warehouse:register_movement",
      "admin:workers",
    ]))
    expect(perms).not.toContain("requests:view_all")
    expect(perms).not.toContain("admin:users")
    expect(perms).not.toContain("admin:products")

  })

  it("allows operational fuel vehicle management without exposing it to conductor lider", () => {
    expect(rolePermissions("rol-jefa")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:create",
      "combustibles:export",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-jefe-mant")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:create",
      "combustibles:export",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-sol-faena")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-prev-faena")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-admin-contrato")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-cond-lider")).not.toContain("combustibles:view")
    expect(rolePermissions("rol-cond-lider")).not.toContain("combustibles:manage_vehicles")
  })

  it("grants conductor_lider only the acompanamiento (Punto 3) evaluation permission", () => {
    const perms = rolePermissions("rol-cond-lider")

    expect(perms).toEqual(["sst:evaluate_acompanamiento"])
    expect(perms).not.toContain("sst:view")
    expect(perms).not.toContain("sst:create")
    expect(perms).not.toContain("sst:close")
  })

  it("hides the acompanamiento (Punto 3) permission from prevención roles but keeps it for admin", () => {
    expect(rolePermissions("rol-admin")).toContain("sst:evaluate_acompanamiento")
    expect(rolePermissions("rol-prev")).not.toContain("sst:evaluate_acompanamiento")
    expect(rolePermissions("rol-prev-faena")).not.toContain("sst:evaluate_acompanamiento")
  })
})
