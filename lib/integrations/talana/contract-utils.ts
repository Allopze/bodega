/**
 * Utilidades sin dependencias de servidor, para que las use también la
 * interfaz (chips y panel de Talana en la ficha del trabajador).
 */

/** Días de calendario entre dos fechas `YYYY-MM-DD` (positivo si `to` es posterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Contrato principal: el activo con el inicio más reciente (empate: el id mayor). */
export function primaryActiveContract<T extends { id: number; listedActive: boolean; startsOn: string | null }>(contracts: T[]): T | null {
  const active = contracts.filter((contract) => contract.listedActive)
  if (active.length === 0) return null
  return [...active].sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? "") || b.id - a.id)[0]!
}
