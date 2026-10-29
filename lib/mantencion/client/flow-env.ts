import { groupChecklist } from "../schedule"
import type { FlowEnv } from "./flow"
import type { FlowDraft } from "./flow-types"
import { analyzeLecture, groupDone, validateStep, type FlowCtx } from "./flow-validate"

/**
 * Arma el entorno del reductor con el equipo y la fecha del momento. Al salir de
 * «Lectura» (preventiva) se fija la pauta que toca —con la versión del borrador— y
 * se descartan las marcas de ítems que ya no están en esa pauta.
 */
export function buildFlowEnv(ctx: FlowCtx): FlowEnv {
  return {
    validate: (draft, step) => validateStep(draft, step, ctx),
    leave: (draft, step) => (step === "lectura" && draft.kind === "P" ? leaveLectura(draft, ctx) : null),
  }
}

function leaveLectura(draft: FlowDraft, ctx: FlowCtx): Partial<FlowDraft> | null {
  const analysis = analyzeLecture(draft, ctx.row)
  if (analysis.intervalValue === null) return null
  const keep = new Set(analysis.items.map((item) => item.key))
  const marks = Object.fromEntries(Object.entries(draft.marks).filter(([key]) => keep.has(key)))
  const reasons = Object.fromEntries(Object.entries(draft.reasons).filter(([key]) => keep.has(key)))
  const next = { ...draft, checklist: analysis.items, marks, reasons }
  const groups = groupChecklist(analysis.items)
  return {
    checklist: analysis.items,
    intervalValue: analysis.intervalValue,
    suggestedIntervalValue: analysis.suggestion?.intervalValue ?? null,
    marks,
    reasons,
    openGroup: groups.findIndex((group) => !groupDone(next, group.items)),
  }
}
