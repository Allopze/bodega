import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import { can, canAny, isGlobalRole } from "@/lib/auth/can"

/**
 * Permisos que abren el centro de control operacional. Única fuente para el
 * gate de página, la navegación y la exportación.
 */
export const OPERATIONAL_CONTROL_VIEW_PERMISSIONS: Permission[] = [
  "flota:view",
  "prevention:inspections:view",
]

export function canViewOperationalControl(session: Session): boolean {
  return canAny(session, ...OPERATIONAL_CONTROL_VIEW_PERMISSIONS)
}

/**
 * Capacidades independientes del centro de control operacional.
 *
 * No se debe usar la visibilidad del dominio Flota del dashboard como permiso
 * transitivo: cada consulta y dato sensible se decide con la capacidad de su
 * propio subdominio. `canViewCosts` protege montos de combustible.
 */
export function operationalControlCapabilities(session: Session) {
  return {
    canViewFuel: can(session, "combustibles:view"),
    canViewTae: can(session, "combustibles:tae_view"),
    canViewFleet: can(session, "flota:view"),
    canViewCosts: can(session, "combustibles:view_costs"),
  } as const
}

export type OperationalControlCapabilities = ReturnType<typeof operationalControlCapabilities>

/** Contrato único para cualquier superficie monetaria de combustible. */
export function assertFuelCostAccess(session: Session, options: { global?: boolean } = {}) {
  if (!can(session, "combustibles:view") || !can(session, "combustibles:view_costs")) {
    throw new Error("Se requiere acceso operacional y de costos de combustible")
  }
  if (options.global && !isGlobalRole(session)) {
    throw new Error("La cuenta corriente requiere acceso global")
  }
}
