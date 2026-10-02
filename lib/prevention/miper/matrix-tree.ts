/**
 * La matriz como estructura de trabajo (spec 2026-10-02 §5): Actividad › Tarea ›
 * riesgos, en el orden del RE-04 —el menor N° de cada grupo—, no alfabético.
 * Reemplaza a `groupRows`, que agrupaba un solo nivel para la grilla.
 */
import { RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { normalizeMiperName } from "./names"
import type { MiperEntrySnapshot } from "./snapshot"

export type ClassificationCounts = Record<RiskClassification, number>

export type TaskNode = {
  key: string
  activity: string | null
  task: string | null
  label: string
  positions: string[]
  locations: string[]
  /** Todos los riesgos de la tarea, por N°. */
  entries: MiperEntrySnapshot[]
  /** Los que pasan los filtros (todos, si no hay filtros). */
  matching: MiperEntrySnapshot[]
  counts: ClassificationCounts
  complete: number
  observed: number
  modified: number
  /** Máximo F+M+Otro de un riesgo: sumar contaría dos veces a las mismas personas. */
  maxExposed: number
  lastRowNumber: number
}

export type ActivityNode = {
  key: string
  activity: string | null
  label: string
  tasks: TaskNode[]
  entryCount: number
  matchingCount: number
  counts: ClassificationCounts
}

export type TreeContext = {
  incomplete: ReadonlySet<string>
  observed: ReadonlySet<string>
  modified: ReadonlySet<string>
  /** `null` = sin filtros: todo coincide. */
  matching: ReadonlySet<string> | null
}

const emptyCounts = (): ClassificationCounts =>
  Object.fromEntries(RISK_CLASSIFICATIONS.map((classification) => [classification, 0])) as ClassificationCounts

/** FNV-1a de 32 bits en base 36: corta para la URL y estable entre renders y recargas. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function activityKeyOf(entry: Pick<MiperEntrySnapshot, "activity">): string {
  return fnv1a(normalizeMiperName(entry.activity ?? ""))
}

/** Clave de `?tarea=`: misma igualdad que el diccionario de la faena (nombre normalizado). */
export function taskKeyOf(entry: Pick<MiperEntrySnapshot, "activity" | "task">): string {
  return fnv1a(`${normalizeMiperName(entry.activity ?? "")}\u001f${normalizeMiperName(entry.task ?? "")}`)
}

function pushDistinct(list: string[], value: string | null) {
  if (!value) return
  const key = normalizeMiperName(value)
  if (!list.some((item) => normalizeMiperName(item) === key)) list.push(value)
}

export function buildMatrixTree(rows: readonly MiperEntrySnapshot[], ctx: TreeContext): ActivityNode[] {
  const activities = new Map<string, ActivityNode>()
  const tasks = new Map<string, TaskNode>()
  for (const entry of [...rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const activityKey = activityKeyOf(entry)
    let activity = activities.get(activityKey)
    if (!activity) {
      activity = { key: activityKey, activity: entry.activity, label: entry.activity ?? "Sin actividad", tasks: [], entryCount: 0, matchingCount: 0, counts: emptyCounts() }
      activities.set(activityKey, activity)
    }
    const taskKey = taskKeyOf(entry)
    let task = tasks.get(taskKey)
    if (!task) {
      task = {
        key: taskKey, activity: entry.activity, task: entry.task, label: entry.task ?? "Sin tarea",
        positions: [], locations: [], entries: [], matching: [], counts: emptyCounts(),
        complete: 0, observed: 0, modified: 0, maxExposed: 0, lastRowNumber: entry.rowNumber,
      }
      tasks.set(taskKey, task)
      activity.tasks.push(task)
    }
    task.entries.push(entry)
    task.lastRowNumber = entry.rowNumber
    pushDistinct(task.positions, entry.position)
    pushDistinct(task.locations, entry.location)
    if (entry.classification) {
      task.counts[entry.classification] += 1
      activity.counts[entry.classification] += 1
    }
    if (!ctx.incomplete.has(entry.id)) task.complete += 1
    if (ctx.observed.has(entry.id)) task.observed += 1
    if (ctx.modified.has(entry.id)) task.modified += 1
    task.maxExposed = Math.max(task.maxExposed, entry.exposedFemale + entry.exposedMale + entry.exposedOther)
    activity.entryCount += 1
    if (!ctx.matching || ctx.matching.has(entry.id)) {
      task.matching.push(entry)
      activity.matchingCount += 1
    }
  }
  const tree = [...activities.values()]
  if (!ctx.matching) return tree
  return tree
    .map((activity) => ({ ...activity, tasks: activity.tasks.filter((task) => task.matching.length > 0) }))
    .filter((activity) => activity.matchingCount > 0)
}

export function findTask(tree: readonly ActivityNode[], key: string): TaskNode | null {
  for (const activity of tree) for (const task of activity.tasks) if (task.key === key) return task
  return null
}

/** El valor más repetido (en empate, el primero en aparecer). Se hereda al agregar un peligro. */
export function mostFrequent<T>(values: readonly (T | null)[]): T | null {
  const counts = new Map<T, number>()
  let best: T | null = null
  let bestCount = 0
  for (const value of values) {
    if (value === null) continue
    const next = (counts.get(value) ?? 0) + 1
    counts.set(value, next)
    if (next > bestCount) { best = value; bestCount = next }
  }
  return best
}
