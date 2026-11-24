import { NEXT_THRESHOLD } from "@/lib/mantencion/status"

/**
 * Semáforos de Planificación, sin dependencias de base de datos: los importa también la
 * tabla cliente (`planning-tables.tsx`). Si vivieran en `planning.ts`, la tabla arrastraría
 * `loadFleet` y `postgres` al bundle del navegador.
 */

export type PlanningTone = "ok" | "warn" | "danger" | "muted"

/** Rojo vencido, ámbar dentro del 15 % de la base, verde el resto. */
export function remainingTone(row: { remaining: number | null; base: number | null }): PlanningTone {
  if (row.remaining == null) return "muted"
  if (row.remaining <= 0) return "danger"
  if (row.base && row.remaining <= row.base * NEXT_THRESHOLD) return "warn"
  return "ok"
}

/** Verde si se hizo antes o a tiempo; ámbar hasta 5 % tarde; rojo más tarde. */
export function deltaTone(row: { delta: number | null; base: number | null }): PlanningTone {
  if (row.delta == null) return "muted"
  if (row.delta >= 0) return "ok"
  if (row.base && row.delta >= -row.base * 0.05) return "warn"
  return "danger"
}
