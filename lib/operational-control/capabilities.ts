import type { Session } from "next-auth"
import { can, isGlobalRole } from "@/lib/auth/can"

/**
 * Capacidades independientes del centro de control operacional.
 *
 * No se debe usar la visibilidad del dominio Flota del dashboard como permiso
 * transitivo: cada consulta, enlace y dato sensible se decide con la capacidad
 * de su propio subdominio. En particular, `canViewCosts` protege montos tanto
 * de combustible como de mantención y costos unitarios de flota.
 */
export function operationalControlCapabilities(session: Session) {
  return {
    canViewFuel: can(session, "combustibles:view"),
    canViewTae: can(session, "combustibles:tae_view"),
    canViewFleet: can(session, "flota:view"),
    canViewMaintenance: can(session, "mantenciones:view"),
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
