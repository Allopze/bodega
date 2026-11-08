/**
 * Controles sobre la descarga de Talana antes de usarla:
 *
 * - **Completa**: si la paginación quedó corta o la lista de activos trae
 *   contratos que no están en la completa, la corrida falla y no se usa nada.
 * - **Fusible**: si la respuesta es anómala respecto de la última copia buena,
 *   la corrida queda bloqueada (no aplica nada, no reemplaza la copia) y avisa.
 *   Una anomalía pasajera se despeja sola en la corrida siguiente, porque se
 *   compara contra la última copia buena; una que persiste la rearma una
 *   persona desde `/admin/talana`.
 *
 * Un finiquito masivo explícito NO es anomalía: en agosto de 2026 hubo 81
 * finiquitos legítimos por el fin de un contrato con un cliente.
 */
import type { TalanaContractRow, TalanaListResult } from "./talana-client"

export type SnapshotProblem = "pagination_truncated" | "count_mismatch" | "active_not_in_full_list"

export function checkSnapshotComplete(input: {
  all: TalanaListResult<TalanaContractRow>
  active: TalanaListResult<TalanaContractRow>
}): SnapshotProblem | null {
  if (input.all.truncated || input.active.truncated) return "pagination_truncated"
  for (const list of [input.all, input.active]) {
    if (list.declaredCount !== null && list.rows.length + list.rejected !== list.declaredCount) return "count_mismatch"
  }
  const allIds = new Set(input.all.rows.map((row) => row.id))
  if (input.active.rows.some((row) => !allIds.has(row.id))) return "active_not_in_full_list"
  return null
}

export type FusibleReason = "no_active_contracts" | "active_drop" | "mass_altas"

/** Caída de activos sin explicación que dispara el fusible, sobre la base anterior. */
export const FUSIBLE_DROP_RATIO = 0.25
/** Con menos activos en la base, la proporción no significa nada. */
export const FUSIBLE_MIN_BASE = 10
/** Altas en una corrida (después de la primera aplicación): máx(10, 25 % de los activos). */
export const FUSIBLE_MAX_ALTAS_MIN = 10
export const FUSIBLE_MAX_ALTAS_RATIO = 0.25

export interface DropEvaluation {
  previousActive: number
  unexplainedDrop: number
}

/**
 * Contratos que estaban activos en la última copia buena y ya no lo están. Una
 * caída está explicada si el contrato ahora figura finiquitado, si su término
 * ya pasó (un plazo fijo que vence es normal; el finiquito llega semanas
 * después) o si la misma persona tiene otro contrato activo (renovación).
 */
export function evaluateActiveDrop(input: {
  previousActiveIds: Set<number>
  current: TalanaContractRow[]
  currentActiveIds: Set<number>
  today: string
}): DropEvaluation {
  const byId = new Map(input.current.map((row) => [row.id, row]))
  const activeRuts = new Set(input.current.filter((row) => input.currentActiveIds.has(row.id)).map((row) => row.rut))
  let unexplained = 0
  for (const id of input.previousActiveIds) {
    if (input.currentActiveIds.has(id)) continue
    const row = byId.get(id)
    const explained = !!row && (row.finiquitado || (row.endsOn !== null && row.endsOn < input.today) || activeRuts.has(row.rut))
    if (!explained) unexplained++
  }
  return { previousActive: input.previousActiveIds.size, unexplainedDrop: unexplained }
}

/** Fusible previo a planificar: activos en cero o caída sin explicación. */
export function evaluateFusible(input: {
  activeCount: number
  drop: DropEvaluation
  /** Una persona aceptó el último bloqueo: la caída no se vuelve a evaluar esta vez. */
  bypassDrop: boolean
}): FusibleReason | null {
  if (input.activeCount === 0) return "no_active_contracts"
  if (input.bypassDrop) return null
  const { previousActive, unexplainedDrop } = input.drop
  if (previousActive >= FUSIBLE_MIN_BASE && unexplainedDrop > previousActive * FUSIBLE_DROP_RATIO) return "active_drop"
  return null
}

/** Fusible posterior a planificar: demasiadas altas de una vez (otra cuenta, datos duplicados). */
export function exceedsMassAltas(input: { plannedAltas: number; activeCount: number; hasAppliedBefore: boolean; bypass: boolean }): boolean {
  if (!input.hasAppliedBefore || input.bypass) return false
  return input.plannedAltas > Math.max(FUSIBLE_MAX_ALTAS_MIN, Math.ceil(input.activeCount * FUSIBLE_MAX_ALTAS_RATIO))
}
