import type { MantChecklistItem, MantScheduleSnapshot, MantSuggestion } from "./types"

/**
 * Pautas (reglas 4, 5 y 15).
 */

/**
 * Regla 4: con lectura L y base b (el menor intervalo), el punto es
 * `max(b, round(L / b) × b)` y se elige el MAYOR intervalo que divide exacto
 * al punto; si ninguno lo divide, la base. 5.400 h en maquinaria (300/600/900/
 * 1.200) → punto 5.400 → 900 h.
 */
export function suggestInterval(intervals: readonly number[], reading: number): MantSuggestion {
  if (intervals.length === 0) throw new Error("La pauta no tiene intervalos")
  const sorted = [...intervals].sort((a, b) => a - b)
  const base = sorted[0]!
  const point = Math.max(base, Math.round(reading / base) * base)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const value = sorted[i]!
    if (point % value === 0) return { index: i, intervalValue: value, point }
  }
  return { index: 0, intervalValue: base, point }
}

export function baseInterval(intervals: readonly number[]): number {
  return Math.min(...intervals)
}

/**
 * Regla 5: los ítems activos que aplican en el intervalo elegido, con la regla
 * por marca del equipo aplicada (X oculta, W avisa). Una marca sin reglas en la
 * pauta aplica todo. La marca llega como id del catálogo cerrado: nunca se
 * compara texto libre.
 */
export function checklistFor(schedule: MantScheduleSnapshot, intervalValue: number, brandId: string | null): MantChecklistItem[] {
  const column = schedule.intervals.indexOf(intervalValue)
  if (column < 0) return []
  const rules = new Map<string, string>()
  if (brandId) {
    for (const rule of schedule.brandRules) if (rule.brandId === brandId) rules.set(rule.itemKey, rule.value)
  }
  const items: MantChecklistItem[] = []
  for (const group of schedule.groups) {
    for (const item of group.items) {
      if (!item.applies[column]) continue
      const rule = rules.get(item.key) ?? "A"
      if (rule === "X") continue
      items.push({ key: item.key, name: item.name, group: group.name, manufacturerWarning: rule === "W" })
    }
  }
  return items
}

/** Agrupa una lista plana conservando el orden de aparición de los sistemas. */
export function groupChecklist(items: readonly MantChecklistItem[]): Array<{ group: string; items: MantChecklistItem[] }> {
  const groups: Array<{ group: string; items: MantChecklistItem[] }> = []
  const index = new Map<string, number>()
  for (const item of items) {
    let at = index.get(item.group)
    if (at === undefined) {
      at = groups.length
      index.set(item.group, at)
      groups.push({ group: item.group, items: [] })
    }
    groups[at]!.items.push(item)
  }
  return groups
}

/**
 * Regla 15: un intervalo nuevo hereda la columna del MAYOR intervalo existente
 * que lo divide exacto; si ninguno lo divide, la del intervalo base. Devuelve el
 * valor del intervalo del que hereda.
 */
export function inheritedIntervalFor(existing: readonly number[], newValue: number): number {
  if (existing.length === 0) throw new Error("La pauta no tiene intervalos de los que heredar")
  const sorted = [...existing].sort((a, b) => a - b)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const value = sorted[i]!
    if (value !== newValue && newValue % value === 0) return value
  }
  return sorted[0]!
}

/**
 * Valida un conjunto de resultados contra el checklist de la versión usada:
 * mismos ítems, un valor por ítem y motivo de 3+ caracteres en cada «No
 * realizado». Devuelve el primer problema en lenguaje del mecánico.
 */
export function checkItemResults(
  checklist: readonly MantChecklistItem[],
  results: ReadonlyArray<{ itemKey: string; value: string; reason?: string | null }>,
): { ok: true } | { ok: false; message: string } {
  const byKey = new Map(results.map((result) => [result.itemKey, result]))
  if (byKey.size !== results.length) return { ok: false, message: "Hay ítems repetidos en la pauta." }
  for (const item of checklist) {
    const result = byKey.get(item.key)
    if (!result) return { ok: false, message: `Falta marcar «${item.name}» (${item.group}).` }
    if (!["R", "NR", "NA"].includes(result.value)) return { ok: false, message: `Valor inválido en «${item.name}».` }
    if (result.value === "NR" && (result.reason ?? "").trim().length < 3) {
      return { ok: false, message: `Falta el motivo de «${item.name}» (no realizado).` }
    }
  }
  const expected = new Set(checklist.map((item) => item.key))
  const extra = results.find((result) => !expected.has(result.itemKey))
  if (extra) return { ok: false, message: "La pauta enviada no corresponde a la versión usada." }
  return { ok: true }
}
