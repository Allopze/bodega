import type { RankedListItem } from "@/components/ui/ranked-list"
import { REQUEST_STATE_META, ITEM_STATE_META, OC_STATE_META } from "@/components/states/state-badge"
import { formatPercent, formatQty, pluralize } from "@/lib/utils"

/**
 * Forma de los datos de `/reportes` (CHART-032): qué se dibuja y qué dice la frase de cada gráfico.
 * Todo es puro y tiene pruebas propias; la página sólo consulta y compone.
 */

export type StatusEntity = "request" | "item" | "oc"

/**
 * Orden de lectura de cada lista de estados: el ciclo de vida, de borrador a
 * cierre, y los desenlaces que salen del flujo (rechazo, devolución, anulación)
 * al final. Antes se ordenaba por cantidad, así que «Cerrada» (la más
 * numerosa) abría la lista y el flujo se leía al revés.
 *
 * No existía una constante así en `lib/`: los enums (`ItemStatus`,
 * `RequestStatus`, `OcStatus`) sólo dan el tipo, y el stepper de la solicitud
 * (`STAGES`) agrupa por etapa, no por estado. El orden sigue las transiciones
 * permitidas (`ALLOWED_TRANSITIONS`). `reportes-page.helpers.test.ts` exige que
 * todo estado con rótulo en `*_STATE_META` figure aquí: un estado nuevo no puede
 * quedar relegado al final sin que alguien lo decida.
 */
export const STATUS_LIFECYCLE: Record<StatusEntity, readonly string[]> = {
  request: [
    "draft", "submitted", "in_review", "partially_approved", "approved", "in_purchasing", "closed",
    "rejected", "returned", "cancelled",
  ],
  item: [
    "draft", "requested", "approved", "pending_purchase", "in_purchase_order", "purchased",
    "partially_office_received", "office_received", "partially_received", "received",
    "partially_delivered", "delivered",
    "rejected", "returned", "postponed",
  ],
  oc: [
    "draft", "issued", "sent", "supplier_confirmed", "partially_office_received", "office_received",
    "partially_received", "received", "closed", "cancelled",
  ],
}

/** Filas `[estado, cantidad]` en orden de ciclo de vida; un estado desconocido va al final. */
export function statusRows(rows: { status: string; total: number }[], entity: StatusEntity) {
  const order = STATUS_LIFECYCLE[entity]
  const rank = (status: string) => {
    const index = order.indexOf(status)
    return index === -1 ? order.length : index
  }
  return rows
    .map((row) => [row.status, Number(row.total)] as [string, number])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
}

/** Rótulo cuando el desglose trae una faena que el catálogo no conoce. */
export const UNKNOWN_WORKSITE_LABEL = "Faena desconocida"

/**
 * Nombre legible de cada faena por id. Incluye las inactivas (con «(inactiva)»):
 * los desgloses cuentan OC e ítems históricos y una faena dada de baja no puede
 * aparecer como su UUID.
 */
export function worksiteLabels(rows: { id: string; name: string; isActive: boolean }[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.id, row.isActive ? row.name : `${row.name} (inactiva)`]))
}

/** Map a raw DB status to its Spanish label, falling back to the raw value. */
export function stateLabel(entity: "request" | "item" | "oc", status: string): string {
  const map = entity === "request" ? REQUEST_STATE_META
    : entity === "oc" ? OC_STATE_META
    : ITEM_STATE_META
  return (map as Record<string, { label: string }>)[status]?.label ?? status
}

/**
 * Ítems de `RankedList` para una lista de estados, **en orden de ciclo de vida** (el orden es parte
 * del dato: «Cerrada», la más numerosa, no abre la lista). `href` convierte un estado en el destino de
 * su lista; sin él, la fila no enlaza (no todo estado tiene una lista que lo explique).
 */
export function statusItems(
  rows: ReadonlyArray<[string, number]>,
  entity: StatusEntity,
  href?: (status: string) => string | undefined,
): RankedListItem[] {
  return rows
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ key: status, label: stateLabel(entity, status), value: count, href: href?.(status) }))
}

/**
 * La frase de un gráfico de estados: el estado más frecuente y cuánto pesa. «Más frecuente» sale de
 * los datos, no de una suposición del ciclo; en un empate gana el estado más avanzado del ciclo
 * (primero en la lista), que es el orden en que se reciben.
 */
export function statusSummary(items: readonly RankedListItem[], noun: { singular: string; plural: string }): string {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (total === 0) return ""
  const top = items.reduce((best, item) => (item.value > best.value ? item : best), items[0]!)
  return `Lo más frecuente: ${top.label} (${formatQty(top.value)} de ${formatQty(total)} ${total === 1 ? noun.singular : noun.plural}, ${formatPercent((top.value / total) * 100, 0)}).`
}

export interface WorksiteBacklogRow {
  key: string
  label: string
  /** Ítems aprobados o pendientes de compra que aún no tienen OC. */
  withoutOrder: number
  /** OC enviadas que esperan recepción en oficina o faena. */
  pendingReceipt: number
}

/**
 * Lo pendiente de abastecimiento por faena, **una fila por faena** con sus dos cifras (ítems sin OC y OC
 * por recibir). Antes eran dos paneles de texto con la misma faena repetida: acá la faena aparece una
 * vez y las dos cifras se leen juntas. Nunca muestra un id: una faena que el catálogo no conoce cae en
 * «Faena desconocida», y todas las desconocidas se juntan en una sola fila. Las más cargadas, primero.
 */
export function buildWorksiteBacklog(
  itemsWithoutOrder: ReadonlyArray<{ worksiteId: string | null; total: number }>,
  ordersPendingReceipt: ReadonlyArray<{ worksiteId: string | null; total: number }>,
  labels: Record<string, string>,
): WorksiteBacklogRow[] {
  const rows = new Map<string, WorksiteBacklogRow>()
  const rowFor = (worksiteId: string | null) => {
    const label = (worksiteId ? labels[worksiteId] : undefined) ?? UNKNOWN_WORKSITE_LABEL
    // Se agrupa por rótulo cuando la faena es desconocida: dos ids sin catálogo no son dos filas distintas para el lector.
    const key = labels[worksiteId ?? ""] ? (worksiteId as string) : UNKNOWN_WORKSITE_LABEL
    const row = rows.get(key) ?? { key, label, withoutOrder: 0, pendingReceipt: 0 }
    rows.set(key, row)
    return row
  }
  for (const entry of itemsWithoutOrder) rowFor(entry.worksiteId).withoutOrder += Number(entry.total)
  for (const entry of ordersPendingReceipt) rowFor(entry.worksiteId).pendingReceipt += Number(entry.total)
  return [...rows.values()]
    .filter((row) => row.withoutOrder + row.pendingReceipt > 0)
    .sort((a, b) => b.withoutOrder + b.pendingReceipt - (a.withoutOrder + a.pendingReceipt) || a.label.localeCompare(b.label, "es"))
}

/** Totales y frase del gráfico de pendientes por faena, de las mismas filas que se dibujan. */
export function backlogSummary(rows: readonly WorksiteBacklogRow[]): string {
  const withoutOrder = rows.reduce((sum, row) => sum + row.withoutOrder, 0)
  const pendingReceipt = rows.reduce((sum, row) => sum + row.pendingReceipt, 0)
  const top = rows[0]
  if (!top) return ""
  const items = `${formatQty(withoutOrder)} ${pluralize(withoutOrder, "ítem")} ${withoutOrder === 1 ? "espera" : "esperan"} una OC`
  const orders = `${formatQty(pendingReceipt)} ${pluralize(pendingReceipt, "OC", "OC")} ${pendingReceipt === 1 ? "espera" : "esperan"} recepción`
  const load = top.withoutOrder + top.pendingReceipt
  return rows.length === 1
    ? `${items} y ${orders}; todo está en ${top.label}.`
    : `${items} y ${orders}. La mayor carga está en ${top.label} (${formatQty(load)}).`
}
