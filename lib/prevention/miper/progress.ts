/**
 * Avance del Programa de Trabajo (§7.5 del spec F2).
 *
 * El avance nunca se ingresa a mano: se deriva de las ocurrencias. Una
 * ocurrencia `superseded` no cuenta (ni en el numerador ni en el denominador),
 * una «fuera de plazo» cuenta como realizada y queda marcada, y una pendiente
 * con vencimiento pasado es además «vencida».
 */

export type OccurrenceOutcome = "pending" | "done" | "not_done" | "superseded"

export type ProgramProgress = {
  /** Ocurrencias realizadas (incluidas las fuera de plazo). */
  done: number
  /** Realizadas marcadas como fuera de plazo (subconjunto de `done`). */
  late: number
  /** Ocurrencias pendientes (incluye las vencidas). */
  pending: number
  /** Pendientes cuyo `dueOn` ya pasó (subconjunto de `pending`). */
  overdue: number
  /** Ocurrencias incumplidas. */
  failed: number
  /** Total planificado: todas menos las `superseded`. */
  planned: number
  /** `done / planned`, o `null` si no hay nada planificado. */
  ratio: number | null
}

/**
 * Deriva el avance del programa a partir de sus ocurrencias. `today` es una
 * fecha civil `AAAA-MM-DD`; se comparan las cadenas, que en ISO ordenan igual
 * que el calendario.
 */
export function programProgress(
  occurrences: Array<{ outcome: OccurrenceOutcome; dueOn: string; late?: boolean }>,
  today: string,
): ProgramProgress {
  let done = 0
  let late = 0
  let pending = 0
  let overdue = 0
  let failed = 0

  for (const occurrence of occurrences) {
    if (occurrence.outcome === "superseded") continue
    if (occurrence.outcome === "done") {
      done += 1
      if (occurrence.late === true) late += 1
    } else if (occurrence.outcome === "not_done") {
      failed += 1
    } else {
      pending += 1
      if (occurrence.dueOn < today) overdue += 1
    }
  }

  const planned = done + pending + failed
  return { done, late, pending, overdue, failed, planned, ratio: planned === 0 ? null : done / planned }
}

/**
 * El avance como porcentaje entero para mostrar, o `null` sin nada planificado.
 * Hacia abajo: `Math.round` diría 100% con 199/200, con una ocurrencia aún
 * pendiente. En enteros: `Math.floor(ratio * 100)` diría 28% con 29/100
 * (0.29 * 100 = 28,99… en coma flotante).
 */
export function progressPercent(progress: Pick<ProgramProgress, "done" | "planned">): number | null {
  return progress.planned === 0 ? null : Math.floor((progress.done * 100) / progress.planned)
}
