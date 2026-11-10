/**
 * Etiqueta estable de un equipo de la flota, sin acceso a datos: la usan los servicios
 * (`lib/services/fleet.ts` la reexporta) y también módulos puros que se prueban sin base
 * de datos, como las filas de la OC impresa.
 */

/** Etiqueta estable de un equipo para congelar como evidencia: "KA-122 · ABCD-12". */
export function vehicleLabel(vehicle: { plate: string; code: string | null }) {
  return vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate
}
