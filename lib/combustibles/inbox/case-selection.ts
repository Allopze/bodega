import { MAX_CASE_BATCH, requiresMeterResolutionKind } from "@/lib/combustibles/anomaly-labels"
import type { FuelInboxCaseGroup, FuelInboxOpenCaseStatus } from "./types"

/**
 * Lo que se puede hacer con los grupos elegidos en «En seguimiento» (crítica 2026-11-15, paso 4c).
 * Repite en el cliente las reglas que el servidor vuelve a exigir (`takeAnomalyCases`,
 * `closeAnomalyCases`), para no ofrecer un botón que va a rechazar:
 *
 * - **Tomar**: los casos sin responsable, o tuyos sin tomar. Los de otra persona se dejan.
 * - **Resolver**: todos de la misma causa y todos tomados (como de a uno).
 * - **Descartar**: todos de la misma causa.
 *
 * Módulo puro: lo usa la barra del lote y sus pruebas.
 */
export interface CaseSelection {
  groups: number
  cases: number
  /** Lo que «Tomar» tomaría. */
  takeable: number
  /** Sin tomar todavía (abiertos o reabiertos): impiden resolver. */
  notTaken: number
  /** Con otra persona como responsable: «Tomar» los deja como están. */
  heldByOthers: number
  /** La causa común; `null` si los grupos son de causas distintas. */
  ruleCode: string | null
  ruleLabel: string | null
  /** Regla de medidor: en lote se cierra sólo como «lectura corregida». */
  meterRule: boolean
  /** Más casos que el tope de un lote (`MAX_CASE_BATCH`): no se ofrece ninguna acción. */
  tooMany: boolean
  canResolve: boolean
  canDismiss: boolean
  /** Lo que viaja al servidor: cada caso como se vio, para no pisar un cambio ajeno. */
  expected: Array<{ id: string; status: FuelInboxOpenCaseStatus; assigneeId: string | null }>
}

export function summarizeCaseSelection(groups: readonly FuelInboxCaseGroup[], userId: string): CaseSelection {
  const members = groups.flatMap((group) => group.members)
  const rules = new Set(groups.map((group) => group.ruleCode))
  const ruleCode = rules.size === 1 ? groups[0]!.ruleCode : null
  let takeable = 0
  let notTaken = 0
  let heldByOthers = 0
  for (const member of members) {
    const mine = member.assigneeId === userId
    if (member.assigneeId && !mine) heldByOthers++
    else if (!(mine && member.status === "in_review")) takeable++
    if (member.status !== "in_review") notTaken++
  }
  const tooMany = members.length > MAX_CASE_BATCH
  return {
    groups: groups.length,
    cases: members.length,
    takeable,
    notTaken,
    heldByOthers,
    ruleCode,
    ruleLabel: ruleCode ? groups[0]!.ruleLabel : null,
    meterRule: ruleCode !== null && requiresMeterResolutionKind(ruleCode),
    tooMany,
    canResolve: !tooMany && ruleCode !== null && members.length > 0 && notTaken === 0,
    canDismiss: !tooMany && ruleCode !== null && members.length > 0,
    expected: members.map((member) => ({ id: member.row.id, status: member.status, assigneeId: member.assigneeId })),
  }
}
