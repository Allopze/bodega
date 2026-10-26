import { describe, expect, it } from "vitest"
import type { Permission } from "@/modules/permissions"
import { resolveQuickActions } from "./dashboard-quick-actions"

const grant = (...permissions: Permission[]) => (permission: Permission) => permissions.includes(permission)

describe("resolveQuickActions — Más acciones", () => {
  it("ofrece las altas que el permiso autoriza, solicitud primero", () => {
    const actions = resolveQuickActions({ can: grant("requests:create", "purchasing:create_order") })

    expect(actions.map((action) => action.key)).toEqual(["new-request", "new-oc"])
    expect(actions.map((action) => action.label)).toEqual(["Nueva solicitud", "Nueva OC"])
    expect(actions.map((action) => action.href)).toEqual(["/solicitudes/nueva", "/compras/nueva"])
  })

  it("no ofrece lo que no puede crear", () => {
    expect(resolveQuickActions({ can: grant("requests:create") }).map((action) => action.key)).toEqual(["new-request"])
    expect(resolveQuickActions({ can: grant("purchasing:create_order") }).map((action) => action.key)).toEqual(["new-oc"])
  })

  it("sin ningún permiso de alta no hay acciones", () => {
    expect(resolveQuickActions({ can: grant() })).toEqual([])
  })

  // La primaria calculada ("Ver 215 vencidas") se retiró: esa cifra ya es la
  // alerta de "Requiere atención" (A5). Ningún permiso de lectura de la cola
  // produce una acción en la cabecera.
  it("los permisos de lectura y de cola no generan acciones: sólo se ofrecen altas", () => {
    const everything = grant(
      "operations:view_work", "approvals:approve", "analytics:view", "prevention:pdtp:view",
      "receiving:view", "deliveries:view", "warehouse:view_stock", "reports:view",
    )

    expect(resolveQuickActions({ can: everything })).toEqual([])
  })

  it("no devuelve una primaria ni mezcla navegación del sidebar con las altas", () => {
    const everything = grant(
      "operations:view_work", "approvals:approve", "requests:create", "purchasing:create_order",
      "analytics:view", "prevention:pdtp:view", "receiving:view", "deliveries:view", "warehouse:view_stock", "reports:view",
    )
    const actions = resolveQuickActions({ can: everything })

    expect(Array.isArray(actions)).toBe(true)
    expect(actions.map((action) => action.key)).toEqual(["new-request", "new-oc"])
    expect(actions.some((action) => /vencida|crítica|aprobaci/i.test(action.label))).toBe(false)
  })
})
