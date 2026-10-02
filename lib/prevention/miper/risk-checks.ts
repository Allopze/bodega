/** «Chequeo del riesgo» del panel lateral (spec §5.4): un ítem por bloque, con los mensajes del validador. */
import type { CompletenessIssue } from "./completeness"
import type { EditorStep } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"

export type RiskCheck = { key: "identificacion" | "evaluacion" | "controlado" | "medidas" | "programa"; label: string; ok: boolean; messages: string[]; step: EditorStep }

const BLOCKS: ReadonlyArray<Omit<RiskCheck, "ok" | "messages"> & { fields: readonly string[] }> = [
  { key: "identificacion", label: "Peligro, riesgo y daño definidos", step: "identificacion", fields: ["activity", "task", "position", "riskFactorId", "hazard", "risk", "probableDamage"] },
  { key: "evaluacion", label: "Evaluación P×C registrada", step: "evaluacion", fields: ["probability", "consequence"] },
  { key: "controlado", label: "«¿Está controlado?» indicado", step: "medidas", fields: ["controlledStatus"] },
  { key: "medidas", label: "Medidas de control suficientes", step: "medidas", fields: ["controls", "dueDate", "responsible", "description"] },
  { key: "programa", label: "Medida vinculada al Programa de Trabajo", step: "seguimiento", fields: ["programLink"] },
]

export function riskChecks(entry: Pick<MiperEntrySnapshot, "classification">, issues: readonly CompletenessIssue[]): RiskCheck[] {
  return BLOCKS
    .filter((block) => block.key !== "programa" || entry.classification === "intolerable")
    .map(({ fields, ...block }) => {
      const messages = issues.filter((issue) => issue.severity === "error" && fields.includes(issue.field)).map((issue) => issue.message)
      return { ...block, ok: messages.length === 0, messages }
    })
}
