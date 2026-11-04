import { ChartSection } from "@/components/charts/chart-section"
import type { ChartDataExcel } from "@/components/charts/chart-data-table"
import { StageDurationBar, formatLeadDays } from "@/components/charts/stage-duration-bar"
import {
  LEAD_TIME_MIN_SAMPLE,
  leadTimeStageHeadline,
  type DurationStat,
  type LeadTimeGroup,
  type SupplyLeadTime,
} from "@/lib/services/analytics-module/lead-time-shape"
import { pluralize } from "@/lib/utils"
import { LeadTimeSlowestItems, NO_LEAD_TIME_LINKS, type LeadTimeItemLinks } from "./lead-time-slowest"

/**
 * Faenas que se dibujan una bajo otra. Con más, el resto queda en «Ver datos»: una barra por faena
 * deja de comparar cuando son decenas.
 */
export const LEAD_TIME_MAX_WORKSITES = 8

const TITLE = "Plazos del ciclo de abastecimiento"

const median = (stat: DurationStat) => (stat.median === null ? "Datos insuficientes" : formatLeadDays(stat.median))
const p90 = (stat: DurationStat) => (stat.p90 === null ? "—" : formatLeadDays(stat.p90))

/** «Ver datos»: cada grupo con sus cuatro tramos y el plazo total, siempre con su n. */
export function leadTimeDataRows(groups: readonly LeadTimeGroup[]): Array<Array<string | number>> {
  return groups.flatMap((group) => [
    ...group.stages.map((stage) => [`${group.label} · ${stage.label}`, median(stage), p90(stage), stage.n]),
    [`${group.label} · Plazo total`, median(group.total), p90(group.total), group.total.n],
  ])
}

/**
 * CHART-029 · ¿Dónde se demora lo que pedí? Cuánto tarda cada tramo del ciclo
 * solicitud → aprobación → OC → llegada → entrega, de los ítems ya cerrados.
 *
 * Es una vista **de proceso**: el cuello de botella se ve de un vistazo (qué tramo es el más largo) y
 * a quién reclamar. Reglas que la pantalla sostiene: toda cifra va con su n; con pocos ítems dice
 * «datos insuficientes» en vez de un número; sólo cuenta lo cerrado, y lo dice.
 */
export function LeadTimeSection({
  report,
  ignoresFilters,
  itemLinks = NO_LEAD_TIME_LINKS,
  excel,
}: {
  /**
   * `null` cuando la consulta falló: se dice, no se muestra vacío como si no hubiera datos. `filters` es
   * lo que la consulta **aplicó** (viene en `SupplyLeadTimeResult`): de ahí salen las notas del proveedor.
   */
  report: (SupplyLeadTime & { filters?: { supplierId?: string } }) | null
  /** Hay un filtro de vehículo, que este gráfico no aplica (el ciclo de abastecimiento no pasa por la flota). */
  ignoresFilters: boolean
  /** Enlaces permitidos desde la lista de ítems más lentos; por defecto ninguno. */
  itemLinks?: LeadTimeItemLinks
  /** Sólo si la página verificó `analytics:export`: «Ver datos» exporta a Excel. */
  excel?: ChartDataExcel
}) {
  if (!report) {
    return <ChartSection title={TITLE} empty={{ label: "No se pudieron calcular los plazos", hint: "La consulta falló. Recarga la página o vuelve a intentarlo en unos minutos." }} />
  }
  const supplierFiltered = Boolean(report.filters?.supplierId)
  if (report.overall.closedItems === 0) {
    return (
      <ChartSection
        title={TITLE}
        empty={{
          label: "Ningún ítem se cerró en el período",
          hint: supplierFiltered
            ? "Ningún ítem comprado a ese proveedor llegó completo a faena ni se entregó dentro del período. Amplía el rango de fechas o quita el filtro de proveedor."
            : "Los plazos se calculan con los ítems que llegaron completos a faena o se entregaron dentro del período. Amplía el rango de fechas para ver más.",
        }}
      />
    )
  }

  const shownWorksites = report.byWorksite.slice(0, LEAD_TIME_MAX_WORKSITES)
  // Con una sola faena el total ES esa faena: repetirla en una segunda barra no aporta.
  const groups = report.byWorksite.length > 1 ? [report.overall, ...shownWorksites] : [report.overall]
  const hiddenWorksites = report.byWorksite.length - shownWorksites.length

  return (
    <ChartSection
      title={TITLE}
      summary={leadTimeStageHeadline(report, formatLeadDays)}
      data={{
        caption: `${TITLE}: mediana, P90 y número de ítems por tramo`,
        headers: ["Grupo y tramo", "Mediana", "P90", "n"],
        rows: leadTimeDataRows([report.overall, ...report.byWorksite]),
        ...(excel ? { excel: { ...excel, notes: ["Sólo ítems cerrados; una cifra necesita al menos " + LEAD_TIME_MIN_SAMPLE + " ítems."] } } : {}),
      }}
    >
      <StageDurationBar groups={groups} previousTotal={report.previousTotal} ariaLabel="Plazos del ciclo de abastecimiento por faena" />
      <ul className="mt-3 grid gap-1 text-xs text-[var(--color-text-muted)] text-pretty">
        <li>
          Sólo cuenta ítems ya cerrados (llegaron completos a faena o se entregaron): lo que sigue esperando no tiene plazo todavía, así que los plazos reales pueden ser mayores.
          Una cifra necesita al menos {LEAD_TIME_MIN_SAMPLE} ítems para publicarse.
        </li>
        {supplierFiltered && (
          <li>Con proveedor elegido sólo cuenta los ítems comprados a él, y la emisión de la OC y la llegada se miden sobre sus órdenes.</li>
        )}
        {ignoresFilters && <li>Este gráfico respeta el período, la faena y el proveedor; no el vehículo.</li>}
        {hiddenWorksites > 0 && <li>Se dibujan las {LEAD_TIME_MAX_WORKSITES} faenas con más ítems cerrados; el resto está en «Ver datos» ({hiddenWorksites} {pluralize(hiddenWorksites, "faena")} más).</li>}
        {report.outOfOrder > 0 && (
          <li>{report.outOfOrder} {pluralize(report.outOfOrder, "medición", "mediciones")} con fechas fuera de orden (por ejemplo, una OC emitida antes de aprobar el ítem) se excluyeron de su tramo.</li>
        )}
      </ul>
      <LeadTimeSlowestItems items={report.slowest ?? []} links={itemLinks} />
    </ChartSection>
  )
}
