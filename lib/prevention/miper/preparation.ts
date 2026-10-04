/**
 * Preparación para enviar a revisión: agrupa los bloqueos que ya calcula
 * `checkMiperCompleteness` por el lugar donde se corrigen. No recalcula reglas:
 * sólo presenta las del servidor.
 */
import type { CompletenessIssue } from "./completeness"
import { stepOfField } from "./entry-navigation"

export const PREPARATION_GROUPS = [
  { key: "ficha", title: "Ficha del documento" },
  { key: "riesgos", title: "Identificación y evaluación" },
  { key: "medidas", title: "Medidas de control" },
  { key: "programa", title: "Vínculos al Programa de Trabajo" },
] as const

export type PreparationGroupKey = (typeof PREPARATION_GROUPS)[number]["key"]

export function preparationGroupOf(issue: CompletenessIssue): PreparationGroupKey {
  if (issue.scope === "header" && issue.field !== "entries") return "ficha"
  if (issue.field === "programLink") return "programa"
  if (issue.field === "entries" || ["identificacion", "evaluacion"].includes(stepOfField(issue.field))) return "riesgos"
  return "medidas"
}
