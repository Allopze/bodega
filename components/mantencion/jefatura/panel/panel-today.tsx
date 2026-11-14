import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"

/**
 * Franja «Hoy» del Panel de mantención: lo pendiente ahora, antes de los gráficos del período
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
  pendingReview,
  worksiteId,
}: {
  unassignedOrders: number | null
  inWorkshop: number | null
  pendingReview: number | null
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
  if (stats.length === 0) return null

  return (
    <section aria-labelledby="panel-hoy" className="mb-6">
      <h2 id="panel-hoy" className="text-eyebrow mb-2 text-[var(--color-text-muted)]">Hoy</h2>
      <SummaryBar numerals="sans" stats={stats} />
    </section>
  )
}
