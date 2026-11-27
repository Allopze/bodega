import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { formatQty } from "@/lib/utils"

/**
 * «4 por una OT · 2 por una correctiva»: equipos, no órdenes. El gráfico de OT de al lado cuenta órdenes en
 * la etapa «En taller»; sin este desglose, «Equipos en taller 6» sobre «En taller 4 OT» parecía un error.
 */
export function workshopBreakdown(total: number, byOrder: number | null): string | undefined {
  if (byOrder === null || total === 0) return undefined
  const byRecord = Math.max(0, total - byOrder)
  const parts = [
    byOrder > 0 ? `${formatQty(byOrder)} por una OT` : null,
    byRecord > 0 ? `${formatQty(byRecord)} por una correctiva` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

/**
 * Franja de pendientes de la pestaña «Hoy» del Panel de mantención: lo pendiente ahora, antes de los gráficos del período
 * (decisión del usuario 2026-11-14: el Panel abre con lo pendiente y debajo van los gráficos).
 * No depende del período elegido, sólo de la faena: un equipo en taller o una orden sin
 * mecánico es trabajo de hoy, no una cifra de los últimos seis meses.
 *
 * Cada cifra lleva a su subconjunto. `null` = la persona no puede ver ese dato (órdenes sin
 * `mant:ot:view_*`) o la consulta falló: la cifra no se ofrece en vez de mostrar un cero falso.
 */
export function PanelToday({
  unassignedOrders,
  inWorkshop,
  inWorkshopByOrder = null,
  pendingReview,
  pendingPartsNotes = null,
  worksiteId,
}: {
  unassignedOrders: number | null
  inWorkshop: number | null
  /** De los equipos en taller, los que están por una OT en ejecución; el resto, por una correctiva sin OT. */
  inWorkshopByOrder?: number | null
  pendingReview: number | null
  /** Notas de pedido con líneas por resolver (`mant:np:view_worksite|manage`); `null` = no se puede ver o la consulta falló. */
  pendingPartsNotes?: number | null
  worksiteId: string | null
}) {
  const faena = worksiteId ? `&faena=${encodeURIComponent(worksiteId)}` : ""
  const stats: SummaryStat[] = []
  if (unassignedOrders !== null) {
    stats.push({
      key: "ot-por-asignar",
      label: "Órdenes por asignar",
      value: unassignedOrders === 0 ? "Ninguna" : unassignedOrders,
      valueKind: unassignedOrders === 0 ? "text" : "number",
      tone: "signal",
      href: `/mantencion/ot?estado=solicitada${faena}`,
    })
  }
  if (inWorkshop !== null) {
    stats.push({
      key: "en-taller",
      label: "Equipos en taller",
      value: inWorkshop === 0 ? "Ninguno" : inWorkshop,
      valueKind: inWorkshop === 0 ? "text" : "number",
      secondary: workshopBreakdown(inWorkshop, inWorkshopByOrder),
      href: `/mantencion/equipos?taller=1${faena}`,
    })
  }
  if (pendingReview !== null) {
    stats.push({
      key: "por-revisar",
      label: "Registros por revisar",
      value: pendingReview === 0 ? "Ninguno" : pendingReview,
      valueKind: pendingReview === 0 ? "text" : "number",
      tone: "signal",
      href: `/mantencion/registros?revision=pendiente&estado=vigente${faena}`,
    })
  }
  if (pendingPartsNotes !== null) {
    // Cuarta cifra de la misma tira (regla A1: máximo 4, accionable): lleva a la bandeja, no a un tile nuevo.
    stats.push({
      key: "np-por-resolver",
      label: "Notas de pedido por resolver",
      value: pendingPartsNotes === 0 ? "Ninguna" : pendingPartsNotes,
      valueKind: pendingPartsNotes === 0 ? "text" : "number",
      tone: "signal",
      href: `/mantencion/notas-pedido?estado=por_revisar${faena}`,
    })
  }
  if (stats.length === 0) return null

  return (
    // Sin título visible: la pestaña «Hoy» ya lo dice. El nombre accesible mantiene la franja como región.
    <section aria-label="Pendientes de hoy" className="mb-6">
      <SummaryBar numerals="sans" stats={stats} />
    </section>
  )
}
