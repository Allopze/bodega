import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import { can, canAny, isGlobalRole } from "@/lib/auth/can"

/**
 * Trinidad de permisos que abre el centro de control operacional. Única fuente
 * para el gate de página, la navegación y la exportación: un usuario con
 * cualquiera de los tres puede entrar, y las superficies derivadas de
 * mantención/inspección se condicionan aparte por su propia capacidad.
 */
export const OPERATIONAL_CONTROL_VIEW_PERMISSIONS: Permission[] = [
  "flota:view",
  "mantenciones:view",
  "prevention:inspections:view",
]

export function canViewOperationalControl(session: Session): boolean {
  return canAny(session, ...OPERATIONAL_CONTROL_VIEW_PERMISSIONS)
}

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
