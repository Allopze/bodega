export type PdtpRecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "custom"

export type PdtpRecurrenceRule = {
  frequency: PdtpRecurrenceFrequency
  interval: number
  plannedQuantity: number
  months?: number[]
  weekOfMonth: number
  /**
   * Semanas del mes (1-4) en que se proyecta cada ocurrencia no-semanal
   * (`monthly`, `quarterly`, `semiannual`, `annual`, `custom`). Opcional y
   * retrocompatible: cuando está ausente —todas las reglas guardadas antes de
   * este campo— el comportamiento es idéntico al histórico de una sola
   * semana, `[weekOfMonth]` (ver `resolveWeeks`). Con más de una semana
   * permite expresar patrones quincenales (`weeks: [1, 3]`) sin inventar una
   * nueva frecuencia.
   */
  weeks?: number[]
}

export type PdtpScheduleCell = { month: number; week: number; plannedQuantity: number }
export type PdtpScheduleMode = "scheduled" | "on_demand" | "triggered"

/**
 * Horizonte de proyección: qué meses calendario (1-12, dentro del año del
 * programa) y cuántas semanas por mes admite la grilla de compatibilidad.
 * `pdtpActivitySchedule` sigue acotado a un único año con semana 1-4 por
 * restricción de esquema (CHECK), así que multi-año o semanas ISO reales
 * quedan fuera de este horizonte — requieren remodelar esa tabla.
 */
export type PdtpScheduleHorizon = {
  months: number[]
  weeksPerMonth: number
}

const FULL_YEAR_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)
export const DEFAULT_SCHEDULE_HORIZON: PdtpScheduleHorizon = { months: FULL_YEAR_MONTHS, weeksPerMonth: 4 }

/**
 * Deriva el horizonte real de un programa a partir de su período declarado.
 * Sin `periodStart`/`periodEnd` (el caso 2026 y la mayoría de programas
 * hoy), el horizonte es el año calendario completo — comportamiento
 * idéntico al anterior. Con un período parcial (ej. un contrato de 6
 * meses), solo se proyectan los meses que ese período cubre dentro del
 * año del programa, evitando fabricar obligaciones fuera de su alcance.
 */
export function deriveScheduleHorizon(
  program: { year: number; periodStart?: string | null; periodEnd?: string | null },
  weeksPerMonth = 4,
): PdtpScheduleHorizon {
  if (!program.periodStart || !program.periodEnd) return { months: FULL_YEAR_MONTHS, weeksPerMonth }
  const start = new Date(program.periodStart)
  const end = new Date(program.periodEnd)
  const months = FULL_YEAR_MONTHS.filter((month) => {
    const monthStart = new Date(Date.UTC(program.year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(program.year, month, 0))
    return monthEnd >= start && monthStart <= end
  })
  return { months: months.length > 0 ? months : FULL_YEAR_MONTHS, weeksPerMonth }
}

const FREQUENCY_LABELS: Record<PdtpRecurrenceFrequency, string> = {
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
  custom: "en meses seleccionados",
}

/**
 * Semanas del mes (1-4) en que se proyecta una ocurrencia no-semanal:
 * `rule.weeks` normalizado (único, ordenado, acotado a `weeksPerMonth`) si
 * viene, o `[weekOfMonth]` si no —el comportamiento histórico previo a este
 * campo—. Centraliza esa caída para que `projectRecurrenceToLegacySchedule` y
 * `describePdtpRecurrence` no puedan divergir en cómo la calculan.
 *
 * El recorte a `weeksPerMonth` es **deliberado y silencioso**, misma
 * estrategia que ya existía para `weekOfMonth` antes de este campo: no
 * lanza ni avisa. Con un horizonte de período parcial que declare menos de
 * 4 semanas por mes (`weeksPerMonth < 4`), una regla quincenal como
 * `weeks: [2, 4]` puede colapsar a una sola semana efectiva (`4` se recorta a
 * `weeksPerMonth`, coincide con `2` si `weeksPerMonth === 2`, y el `Set`
 * las deduplica) — el patrón deja de ser quincenal sin que nada lo señale.
 * Quien construya la UI de período parcial debe tenerlo presente: ver el
 * test "documenta el colapso silencioso" en `pdtp-recurrence.test.ts`.
 */
export function resolveWeeks(rule: PdtpRecurrenceRule, weeksPerMonth: number): number[] {
  const clampedWeeksPerMonth = Math.min(4, Math.max(1, Math.trunc(weeksPerMonth || 4)))
  const raw = rule.weeks && rule.weeks.length > 0 ? rule.weeks : [rule.weekOfMonth]
  const clamped = raw.map((week) => Math.min(clampedWeeksPerMonth, Math.max(1, Math.trunc(week || 1))))
  return [...new Set(clamped)].sort((a, b) => a - b)
}

/**
 * Proyección de compatibilidad hacia la grilla histórica de semanas/mes.
 * La regla de recurrencia es la fuente de verdad del constructor; estas celdas
 * permiten que las vistas operacionales antiguas sigan funcionando durante la
 * transición y no convierten las 48 columnas del Excel en el modelo de autoría.
 * `horizon` acota a qué meses/semanas del año del programa se proyecta —
 * por defecto, el año calendario completo (comportamiento histórico).
 */
export function projectRecurrenceToLegacySchedule(
  rule: PdtpRecurrenceRule,
  horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON,
): PdtpScheduleCell[] {
  const interval = Math.max(1, Math.trunc(rule.interval || 1))
  const quantity = Math.max(0, rule.plannedQuantity)
  const weeksPerMonth = Math.min(4, Math.max(1, Math.trunc(horizon.weeksPerMonth || 4)))
  const months = [...new Set(horizon.months)].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b)

  if (rule.frequency === "weekly") {
    // `months`, en `weekly`, acota la campaña a un subconjunto de meses del
    // año (ej. `{ weekly, months: [6, 7] }` = campaña de junio a julio). Sin
    // `months` —el caso de toda regla semanal guardada antes de este
    // cambio— no se filtra nada y el comportamiento es idéntico al histórico.
    const candidateMonths = rule.months && rule.months.length > 0
      ? [...new Set(rule.months)].filter((month) => month >= 1 && month <= 12)
      : null
    const filteredMonths = candidateMonths ? months.filter((month) => candidateMonths.includes(month)) : months
    const cells: PdtpScheduleCell[] = []
    let position = 0
    for (const month of filteredMonths) {
      for (let weekOfMonth = 1; weekOfMonth <= weeksPerMonth; weekOfMonth++) {
        if (position % interval === 0) cells.push({ month, week: weekOfMonth, plannedQuantity: quantity })
        position += 1
      }
    }
    return cells
  }

  const monthStep = rule.frequency === "monthly"
    ? interval
    : rule.frequency === "quarterly"
      ? 3 * interval
      : rule.frequency === "semiannual"
        ? 6 * interval
        : 12 * interval
  const candidateMonths = rule.frequency === "custom"
    ? [...new Set(rule.months ?? [])].filter((month) => month >= 1 && month <= 12)
    : FULL_YEAR_MONTHS.filter((month) => (month - 1) % monthStep === 0)
  const selectedMonths = candidateMonths.filter((month) => months.includes(month)).sort((a, b) => a - b)
  const weeks = resolveWeeks(rule, weeksPerMonth)

  return selectedMonths.flatMap((month) => weeks.map((week) => ({ month, week, plannedQuantity: quantity })))
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

function listLabel(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1] ?? ""}`
}

function weeksLabel(weeks: number[]): string {
  return `semana${weeks.length > 1 ? "s" : ""} ${listLabel(weeks.map(String))}`
}

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month)
}

function sortedUniqueMonths(months: number[]): number[] {
  return [...new Set(months)].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b)
}

/**
 * Único uso: distinguir en `frequencyLabel` un rango de meses corrido (ej.
 * "febrero a diciembre") de una selección salteada (ej. "marzo, junio y
 * septiembre"), para decidir si un `custom` de una sola semana se describe
 * como "mensual, semana N (rango)" o se deja como "en meses seleccionados".
 * Un único mes cuenta como contiguo (rango degenerado de longitud 1).
 */
function monthsAreContiguous(sortedMonths: number[]): boolean {
  return sortedMonths.length > 0 && sortedMonths.every((month, index) => index === 0 || month === (sortedMonths[index - 1] ?? 0) + 1)
}

/** "de junio a julio" para meses contiguos, "en marzo, junio y septiembre" si no. */
function monthsRangeLabel(months: number[]): string {
  const sorted = sortedUniqueMonths(months)
  if (sorted.length === 0) return ""
  if (sorted.length > 1 && monthsAreContiguous(sorted)) return `de ${monthName(sorted[0] ?? 1)} a ${monthName(sorted[sorted.length - 1] ?? 1)}`
  return `en ${listLabel(sorted.map((month) => monthName(month)))}`
}

/**
 * Etiqueta legible de la frecuencia, incluyendo los dos patrones que `weeks`
 * y `months` permiten expresar sin una frecuencia nueva: campaña (`weekly`
 * acotado a un subconjunto de meses) y más de una semana por ocurrencia, que
 * el motor admite en **cualquier** frecuencia no-`weekly` (`monthly`,
 * `quarterly`, `semiannual`, `annual`, `custom`) y por tanto también debe
 * describirse en todas — `{quarterly, weeks:[1,3]}`, por ejemplo, duplica
 * las celdas proyectadas (8 en vez de 4) y el texto tiene que contarlo, no
 * solo el caso `monthly` (que además conserva el nombre coloquial
 * "quincenal" cuando son exactamente dos semanas).
 *
 * Caso adicional (Tarea 2.2, preset `monthly_week` con rango de meses): un
 * `custom` con **una sola semana** cuya lista de meses es un rango corrido
 * (ej. `months: [2..12]`, producido por ese preset) no es realmente "en
 * meses seleccionados" para quien lo lee — es un mensual con rango, y
 * merece el mismo nombre coloquial que `monthly` ("mensual, semana 4
 * (febrero a diciembre)"). Si los meses **no** son un rango corrido (una
 * selección salteada real), el texto genérico de `custom` sigue siendo el
 * correcto.
 */
function frequencyLabel(rule: PdtpRecurrenceRule, weeksPerMonth: number): string {
  if (rule.frequency === "weekly") {
    return rule.months && rule.months.length > 0 ? `campaña ${monthsRangeLabel(rule.months)}` : FREQUENCY_LABELS.weekly
  }
  const weeks = resolveWeeks(rule, weeksPerMonth)
  if (rule.frequency === "custom" && weeks.length === 1) {
    const sortedMonths = sortedUniqueMonths(rule.months ?? [])
    if (monthsAreContiguous(sortedMonths)) {
      const rangeText = sortedMonths.length > 1
        ? `${monthName(sortedMonths[0] ?? 1)} a ${monthName(sortedMonths[sortedMonths.length - 1] ?? 1)}`
        : monthName(sortedMonths[0] ?? 1)
      return `mensual, semana ${weeks[0] ?? 1} (${rangeText})`
    }
  }
  if (weeks.length <= 1) return FREQUENCY_LABELS[rule.frequency]
  if (rule.frequency === "monthly" && weeks.length === 2) return `quincenal (${weeksLabel(weeks)})`
  return `${FREQUENCY_LABELS[rule.frequency]} (${weeksLabel(weeks)})`
}

export function describePdtpRecurrence(rule: PdtpRecurrenceRule, horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON): string {
  const base = frequencyLabel(rule, horizon.weeksPerMonth)
  const interval = rule.interval > 1 ? ` cada ${rule.interval} ciclos` : ""
  const quantity = rule.plannedQuantity === 1 ? "1 ejecución" : `${rule.plannedQuantity} ejecuciones`
  const projected = projectRecurrenceToLegacySchedule(rule, horizon)
  const periodLabel = horizon.months.length >= 12 ? "período anual" : `período de ${horizon.months.length} mes(es)`
  return `${quantity}, frecuencia ${base}${interval}. Genera ${projected.length} obligación(es) en el ${periodLabel}.`
}

export function describePdtpRecurrenceImpact(
  currentMode: PdtpScheduleMode,
  currentRule: PdtpRecurrenceRule | null,
  nextMode: PdtpScheduleMode,
  nextRule: PdtpRecurrenceRule | null,
  horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON,
) {
  const currentCount = currentMode === "scheduled" && currentRule ? projectRecurrenceToLegacySchedule(currentRule, horizon).length : 0
  const nextCount = nextMode === "scheduled" && nextRule ? projectRecurrenceToLegacySchedule(nextRule, horizon).length : 0
  const changed = currentMode !== nextMode || !recurrenceRulesEqual(currentRule, nextRule)
  return { currentCount, nextCount, changed }
}

/**
 * Igualdad de reglas de recurrencia, campo a campo.
 *
 * No se compara con `JSON.stringify`: la regla vive en una columna `jsonb`, y
 * Postgres no conserva ahí el orden de las claves ni la forma numérica (`1`
 * frente a `1.0`). Con `months` o `weeks` presentes eso da un falso "cambió"
 * —el cliente los serializa en el orden en que el usuario los tocó, y
 * `jsonb` no promete devolverlos en ese mismo orden— y un falso "cambió" no
 * es cosmético: dispara la re-proyección de la recurrencia, que reescribe el
 * calendario del año. Por eso ambos arreglos se comparan normalizados
 * (único, ordenado), no por posición.
 */
export function recurrenceRulesEqual(a: PdtpRecurrenceRule | null | undefined, b: PdtpRecurrenceRule | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.frequency !== b.frequency) return false
  if (Number(a.interval) !== Number(b.interval)) return false
  if (Number(a.plannedQuantity) !== Number(b.plannedQuantity)) return false
  if (Number(a.weekOfMonth) !== Number(b.weekOfMonth)) return false
  const monthsA = [...new Set(a.months ?? [])].sort((x, y) => x - y)
  const monthsB = [...new Set(b.months ?? [])].sort((x, y) => x - y)
  if (monthsA.length !== monthsB.length || !monthsA.every((month, index) => month === monthsB[index])) return false
  const weeksA = [...new Set(a.weeks ?? [])].sort((x, y) => x - y)
  const weeksB = [...new Set(b.weeks ?? [])].sort((x, y) => x - y)
  return weeksA.length === weeksB.length && weeksA.every((week, index) => week === weeksB[index])
}

/**
 * Huella canónica de un conjunto de celdas: independiente del orden y de la
 * diferencia entre "ausente" y "cero" (la tabla no guarda ceros, así que ambas
 * representan lo mismo). Sirve para comparar planificaciones en el servidor y
 * en el cliente con exactamente el mismo criterio.
 */
export function scheduleCellsFingerprint(cells: Array<{ month: number; week: number; plannedQuantity: number }>): string {
  return cells
    .filter((cell) => Number(cell.plannedQuantity) > 0)
    .map((cell) => ({ month: Number(cell.month), week: Number(cell.week), quantity: Number(cell.plannedQuantity) }))
    .sort((a, b) => a.month - b.month || a.week - b.week)
    .map((cell) => `${cell.month}-${cell.week}=${cell.quantity.toFixed(2)}`)
    .join(",")
}

export type PdtpScheduleDiff = {
  addedCells: PdtpScheduleCell[]
  removedCells: PdtpScheduleCell[]
  changedCells: Array<{ month: number; week: number; from: number; to: number }>
  currentPlannedTotal: number
  nextPlannedTotal: number
}

const cellKey = (cell: { month: number; week: number }) => `${Number(cell.month)}-${Number(cell.week)}`

function positiveCellMap(cells: Array<{ month: number; week: number; plannedQuantity: number }>) {
  const map = new Map<string, PdtpScheduleCell>()
  for (const cell of cells) {
    const quantity = Number(cell.plannedQuantity)
    if (!(quantity > 0)) continue
    map.set(cellKey(cell), { month: Number(cell.month), week: Number(cell.week), plannedQuantity: quantity })
  }
  return map
}

/** Qué cambia al pasar de `current` a `next`. `removedCells` y las bajas de
 * `changedCells` son la pérdida de cantidad planificada, que es el denominador
 * del indicador de cumplimiento: por eso se cuentan por separado. */
export function diffScheduleCells(
  current: Array<{ month: number; week: number; plannedQuantity: number }>,
  next: Array<{ month: number; week: number; plannedQuantity: number }>,
): PdtpScheduleDiff {
  const currentMap = positiveCellMap(current)
  const nextMap = positiveCellMap(next)
  const addedCells: PdtpScheduleCell[] = []
  const removedCells: PdtpScheduleCell[] = []
  const changedCells: PdtpScheduleDiff["changedCells"] = []

  for (const [key, cell] of nextMap) {
    const before = currentMap.get(key)
    if (!before) addedCells.push(cell)
    else if (before.plannedQuantity !== cell.plannedQuantity) {
      changedCells.push({ month: cell.month, week: cell.week, from: before.plannedQuantity, to: cell.plannedQuantity })
    }
  }
  for (const [key, cell] of currentMap) {
    if (!nextMap.has(key)) removedCells.push(cell)
  }

  const total = (map: Map<string, PdtpScheduleCell>) => [...map.values()].reduce((sum, cell) => sum + cell.plannedQuantity, 0)
  const byPeriod = (a: { month: number; week: number }, b: { month: number; week: number }) => a.month - b.month || a.week - b.week
  return {
    addedCells: addedCells.sort(byPeriod),
    removedCells: removedCells.sort(byPeriod),
    changedCells: changedCells.sort(byPeriod),
    currentPlannedTotal: total(currentMap),
    nextPlannedTotal: total(nextMap),
  }
}

export type PdtpScheduleSource = "rule" | "manual" | "none"

/**
 * De dónde viene realmente la planificación de una actividad, **derivado** de
 * las celdas guardadas y no almacenado.
 *
 * Se deriva a propósito: un campo persistido puede desincronizarse de las
 * celdas —que es justo el defecto que esta función existe para cerrar—, y
 * cualquier backfill tendría que calcularse así de todos modos.
 *
 * Límites conocidos: no distingue una edición manual que coincide por
 * casualidad con la proyección (inofensivo, ambas lecturas producen la misma
 * escritura), ni permite declarar "manual, hoy idéntica a la regla, pero no la
 * re-proyectes nunca más". Ese último caso queda cubierto por la confirmación
 * explícita del lado destructivo.
 */
export function derivePdtpScheduleSource({
  cells,
  scheduleMode,
  recurrenceRule,
  horizon,
}: {
  cells: Array<{ month: number; week: number; plannedQuantity: number }>
  scheduleMode: PdtpScheduleMode
  recurrenceRule: PdtpRecurrenceRule | null
  horizon: PdtpScheduleHorizon
}): PdtpScheduleSource {
  const fingerprint = scheduleCellsFingerprint(cells)
  if (fingerprint === "") return "none"
  if (scheduleMode !== "scheduled" || !recurrenceRule) return "manual"
  return fingerprint === scheduleCellsFingerprint(projectRecurrenceToLegacySchedule(recurrenceRule, horizon))
    ? "rule"
    : "manual"
}

export function describePdtpScheduleSource(source: PdtpScheduleSource, cellCount: number): string {
  if (source === "none") return "Sin semanas planificadas."
  if (source === "rule") return `${cellCount} semana(s) proyectadas por la recurrencia.`
  return `${cellCount} semana(s) ajustadas manualmente; la recurrencia guardada ya no coincide.`
}
