import { sql, type SQL } from "drizzle-orm"
import { purchaseRequests } from "@/db/schema"
import type { StageTab } from "@/components/ui/stage-tabs"

/**
 * Pestañas por etapa de la lista de Solicitudes.
 *
 * El estado de la solicitud (`purchase_requests.status`) no distingue "En
 * compra" de "En recepción": ambos son `approved/partially_approved/in_purchasing`
 * y es el estado de los ÍTEMS el que dice dónde está parada. Por eso la etapa se
 * deriva en SQL con el mismo orden que `requestCurrentStage`
 * (`lib/work-queue-labels.ts`), sin N+1:
 *
 *   borrador   status = draft
 *   cerradas   status ∈ closed, rejected, cancelled
 *   aprobacion status ∈ submitted, in_review, o algún ítem `requested`
 *   compra     algún ítem approved / pending_purchase / in_purchase_order
 *   recepcion  el resto de las abiertas (ítems purchased … received/delivered:
 *              ya con la OC emitida, esperando llegada o cierre)
 *
 * Las constantes se inyectan con `sql.raw` (son literales fijos, no entrada del
 * usuario) para que el `CASE` del SELECT y el del GROUP BY sean idénticos y
 * Postgres no los trate como expresiones distintas por tener parámetros `$n`.
 */
export const REQUEST_STAGE_TABS = [
  { value: "borrador",   label: "Borrador" },
  { value: "aprobacion", label: "En aprobación" },
  { value: "compra",     label: "En compra" },
  { value: "recepcion",  label: "En recepción" },
  { value: "cerradas",   label: "Cerradas" },
] as const

export type RequestStageKey = (typeof REQUEST_STAGE_TABS)[number]["value"]

const STAGE_KEYS = new Set<string>(REQUEST_STAGE_TABS.map((t) => t.value))

/** Estados de solicitud equivalentes (aprox.) para el exportador, que filtra por estado. */
const STAGE_EXPORT_STATUSES: Record<RequestStageKey, string[]> = {
  borrador:   ["draft"],
  aprobacion: ["submitted", "in_review"],
  compra:     ["approved", "partially_approved", "in_purchasing"],
  recepcion:  ["approved", "partially_approved", "in_purchasing"],
  cerradas:   ["closed", "rejected", "cancelled"],
}

function itemInStatuses(statuses: string[]): SQL {
  const list = sql.raw(statuses.map((s) => `'${s}'`).join(", "))
  return sql`exists (
    select 1 from purchase_request_items stage_items
    where stage_items.request_id = ${purchaseRequests.id}
      and stage_items.status in (${list})
  )`
}

/** Etapa de cada solicitud como expresión SQL (ver mapeo arriba). */
export const requestStageSql: SQL = sql`(case
  when ${purchaseRequests.status} = 'draft' then 'borrador'
  when ${purchaseRequests.status} in ('closed', 'rejected', 'cancelled') then 'cerradas'
  when ${purchaseRequests.status} in ('submitted', 'in_review') or ${itemInStatuses(["requested"])} then 'aprobacion'
  when ${itemInStatuses(["approved", "pending_purchase", "in_purchase_order"])} then 'compra'
  else 'recepcion'
end)`

/**
 * Separa lo que viene en `?estado=`: las claves de etapa (pestañas) y los estados
 * crudos de solicitud, que siguen funcionando porque los enlaces del tablero y de
 * trazabilidad los usan (`estado=draft,submitted,…`).
 */
export function splitStageFilter(estados: string[]): { stages: RequestStageKey[]; statuses: string[] } {
  const stages: RequestStageKey[] = []
  const statuses: string[] = []
  for (const value of estados) {
    if (STAGE_KEYS.has(value)) stages.push(value as RequestStageKey)
    else statuses.push(value)
  }
  return { stages, statuses }
}

/** Predicado de etapa, o `undefined` si no se pidió ninguna. */
export function stageFilterSql(stages: RequestStageKey[]): SQL | undefined {
  if (stages.length === 0) return undefined
  const list = sql.raw(stages.map((s) => `'${s}'`).join(", "))
  return sql`${requestStageSql} in (${list})`
}

/** `status=` del exportador para los valores de `estado` (etapas → estados). */
export function exportStatusesFor(estados: string[]): string[] {
  const { stages, statuses } = splitStageFilter(estados)
  return [...new Set([...statuses, ...stages.flatMap((s) => STAGE_EXPORT_STATUSES[s])])]
}

/** Pestañas con contador a partir de los conteos por etapa. */
export function buildStageTabs(countByStage: Record<string, number>): StageTab[] {
  return [
    { value: "", label: "Todas", count: Object.values(countByStage).reduce((sum, n) => sum + n, 0) },
    ...REQUEST_STAGE_TABS.map((tab) => ({ value: tab.value, label: tab.label, count: countByStage[tab.value] ?? 0 })),
  ]
}
