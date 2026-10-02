/**
 * Pasos del editor del riesgo y recorrido entre riesgos (spec 2026-10-02 §5.4).
 * El validador (`completeness.ts`) habla en campos; el editor, en pasos: este
 * mapa es el único punto donde se traducen.
 */
import type { CompletenessIssue } from "./completeness"
import { taskKeyOf } from "./matrix-tree"
import type { MiperEntrySnapshot } from "./snapshot"

export const EDITOR_STEPS = ["identificacion", "evaluacion", "medidas", "seguimiento"] as const
export type EditorStep = typeof EDITOR_STEPS[number]
export const EDITOR_STEP_LABEL: Record<EditorStep, string> = {
  identificacion: "Identificación", evaluacion: "Evaluación", medidas: "Medidas de control", seguimiento: "Seguimiento",
}

const STEP_OF_FIELD: Record<string, EditorStep> = {
  activity: "identificacion", task: "identificacion", position: "identificacion", location: "identificacion",
  riskFactorId: "identificacion", isRoutine: "identificacion", hazard: "identificacion", risk: "identificacion", probableDamage: "identificacion",
  probability: "evaluacion", consequence: "evaluacion", classification: "evaluacion",
  controlledStatus: "medidas", controls: "medidas", dueDate: "medidas", responsible: "medidas", description: "medidas",
  programLink: "seguimiento",
}

export function stepOfField(field: string): EditorStep {
  return STEP_OF_FIELD[field] ?? "medidas"
}

export function isEditorStep(value: string | null | undefined): value is EditorStep {
  return typeof value === "string" && (EDITOR_STEPS as readonly string[]).includes(value)
}

export function errorCountByStep(issues: readonly CompletenessIssue[]): Record<EditorStep, number> {
  const counts: Record<EditorStep, number> = { identificacion: 0, evaluacion: 0, medidas: 0, seguimiento: 0 }
  for (const issue of issues) if (issue.severity === "error") counts[stepOfField(issue.field)] += 1
  return counts
}

export function firstStepWithErrors(issues: readonly CompletenessIssue[]): EditorStep {
  const counts = errorCountByStep(issues)
  return EDITOR_STEPS.find((step) => counts[step] > 0) ?? "identificacion"
}

const byRow = (a: MiperEntrySnapshot, b: MiperEntrySnapshot) => a.rowNumber - b.rowNumber

export function siblingsInTask(rows: readonly MiperEntrySnapshot[], entryId: string) {
  const entry = rows.find((row) => row.id === entryId)
  if (!entry) return null
  const key = taskKeyOf(entry)
  const siblings = rows.filter((row) => taskKeyOf(row) === key).sort(byRow)
  const index = siblings.findIndex((row) => row.id === entryId)
  return { previousId: siblings[index - 1]?.id ?? null, nextId: siblings[index + 1]?.id ?? null, position: index + 1, total: siblings.length }
}

/** El próximo riesgo con errores por N°, dando la vuelta; con filtro, sólo dentro del filtro. */
export function nextPendingId(rows: readonly MiperEntrySnapshot[], currentId: string | null, incomplete: ReadonlySet<string>, scope: ReadonlySet<string> | null): string | null {
  const candidates = [...rows].sort(byRow).filter((row) => incomplete.has(row.id) && row.id !== currentId && (!scope || scope.has(row.id)))
  if (candidates.length === 0) return null
  const currentRow = rows.find((row) => row.id === currentId)?.rowNumber ?? 0
  return (candidates.find((row) => row.rowNumber > currentRow) ?? candidates[0]!).id
}

const SEVERITY: Record<string, number> = { intolerable: 0, important: 1, moderate: 2, tolerable: 3 }

/** Por dónde empezar: Intolerable > Importante > el resto; dentro de cada banda, por N°. */
export function firstPendingBySeverity(rows: readonly MiperEntrySnapshot[], incomplete: ReadonlySet<string>): string | null {
  const pending = rows.filter((row) => incomplete.has(row.id))
  pending.sort((a, b) => (SEVERITY[a.classification ?? ""] ?? 4) - (SEVERITY[b.classification ?? ""] ?? 4) || a.rowNumber - b.rowNumber)
  return pending[0]?.id ?? null
}
