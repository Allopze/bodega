import type { Session } from "next-auth"
import type { Permission } from "@/modules/permissions"
import { can, canAny, isGlobalRole } from "@/lib/auth/can"

/**
 * Permisos que abren el centro de control operacional. Única fuente para el
 * gate de página, la navegación y la exportación: un usuario con cualquiera de
 * ellos puede entrar, y las superficies derivadas de flota, inspección o
 * combustible se condicionan aparte por su propia capacidad.
 */
export const OPERATIONAL_CONTROL_VIEW_PERMISSIONS: Permission[] = [
  "flota:view",
  "prevention:inspections:view",
  "combustibles:view",
]

export function canViewOperationalControl(session: Session): boolean {
  return canAny(session, ...OPERATIONAL_CONTROL_VIEW_PERMISSIONS)
}

/**
 * Las cifras de órdenes de trabajo (OT abiertas, horas en taller, MTTR) se ven
 * con la capacidad de OT del módulo de mantención, no con las de flota,
 * inspección o combustible: entrar al panel no las habilita, y tenerlas no abre
 * el panel (el gate de entrada es `canViewOperationalControl`).
 */
export function canViewWorkOrders(session: Session): boolean {
  return can(session, "mant:ot:view_all") || can(session, "mant:ot:view_worksite")
}

/**
 * El costo de repuestos y servicios comprados por OC para un equipo se protege
 * con `purchasing:view`: no existe un permiso de costos de compras aparte, y
 * `combustibles:view_costs` es del combustible. Entrar al panel tampoco lo
 * habilita (el gate de entrada es `canViewOperationalControl`).
 */
export function canViewPurchaseCosts(session: Session): boolean {
  return can(session, "purchasing:view")
}

/** `mant:ot:view_all`: ve las OT de todas las faenas, no sólo las de su alcance. */
export function canViewAllWorkOrders(session: Session): boolean {
  return can(session, "mant:ot:view_all")
}

/**
 * Capacidades independientes del centro de control operacional.
 *
 * No se debe usar la visibilidad del dominio Flota del dashboard como permiso
 * transitivo: cada consulta y dato sensible se decide con la capacidad de su
 * propio subdominio. `canViewCosts` protege montos de combustible y
 * `canViewPurchaseCosts` los de repuestos y servicios comprados por OC.
 */
export function operationalControlCapabilities(session: Session) {
  return {
    canViewFuel: can(session, "combustibles:view"),
    canViewTae: can(session, "combustibles:tae_view"),
    canViewFleet: can(session, "flota:view"),
    canViewCosts: can(session, "combustibles:view_costs"),
    canViewWorkOrders: canViewWorkOrders(session),
    canViewPurchaseCosts: canViewPurchaseCosts(session),
  } as const
}

export type OperationalControlCapabilities = ReturnType<typeof operationalControlCapabilities>

/** Contrato único para cualquier superficie monetaria de combustible. */
export function assertFuelCostAccess(session: Session, options: { global?: boolean } = {}) {
  if (!can(session, "combustibles:view") || !can(session, "combustibles:view_costs")) {
    throw new Error("Se requiere acceso operacional y de costos de combustible")
  }
  if (options.global && !isGlobalRole(session)) {
    throw new Error("Los estados de cuenta requieren acceso global")
  }
}
