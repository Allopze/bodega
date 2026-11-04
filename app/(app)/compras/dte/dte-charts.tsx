import { ChartSection } from "@/components/charts/chart-section"
import {
  dteCoverageSummary,
  dteCoverageTable,
  dteListHref,
  monthLabel,
  reconciliationSummary,
  reconciliationTable,
  type DteCoverageShape,
  type ReconciliationShape,
} from "@/lib/purchasing/reconciliation-charts"
import { DteCoverageChart, ReconciliationChart } from "./reconciliation-charts-lazy"

/**
 * CHART-034 · lo que el tope de 300 filas de la lista no deja ver: cuánto falta por
 * facturar y qué fracción de los DTE sigue sin vincular. Van **encima** de la
 * lista —la decisión sobre una fila (vincular, conciliar) se sigue tomando en la
 * lista y en la ficha de la OC— y no la reemplazan.
 *
 * La cobertura de DTE es de toda la empresa (`dte_documents` no tiene faena), así
 * que sólo existe para un rol con visibilidad global (`dte` llega `null`) y el
 * gráfico no se dibuja para los demás; el de OC siempre respeta el alcance de faenas.
 */
export function DteCharts({
  orders,
  dte,
  periodo,
  syncHref,
}: {
  orders: ReconciliationShape
  /** `null`: quien mira no tiene visibilidad de toda la empresa. */
  dte: DteCoverageShape | null
  /** Período «YYYY-MM» que la lista tiene a la vista: el enlace de teclado lleva a ese. */
  periodo: string
  /** Destino de la sincronización DTE; sólo para quien puede administrarla. */
  syncHref?: string
}) {
  const orderSummary = reconciliationSummary(orders)
  const dteSummary = dte ? dteCoverageSummary(dte) : null
  const orderTable = reconciliationTable(orders)
  const dteTable = dte ? dteCoverageTable(dte) : null
  const months = orders.months.length

  return (
    <div className={dte ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
      <ChartSection
        title="Conciliación de las OC emitidas"
        summary={orderSummary}
        data={{ caption: "OC emitidas por mes y estado de conciliación", headers: orderTable.headers, rows: orderTable.rows }}
        drillHref="/compras?factura=pendiente"
        drillLabel="Ver las OC con factura pendiente"
        empty={orderSummary ? null : {
          label: `Sin OC emitidas en los últimos ${months} meses`,
          hint: "Cuando se emitan órdenes de compra, aquí verás cuáles faltan por facturar y cuáles piden revisión.",
          ctaLabel: "Ir a Compras",
          ctaHref: "/compras",
        }}
      >
        <ReconciliationChart shape={orders} />
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          El estado es el último que se guardó para cada OC y puede ir un paso atrás; el monto por facturar se calcula al abrir la página.
        </p>
      </ChartSection>

      {dte && dteTable && (
        <ChartSection
          title="Cobertura de los DTE recibidos"
          summary={dteSummary}
          data={{ caption: "DTE recibidos por período y vínculo", headers: dteTable.headers, rows: dteTable.rows }}
          drillHref={dteSummary ? dteListHref(periodo, "none") : undefined}
          drillLabel={`Ver los DTE sin vincular de ${monthLabel(periodo)}`}
          empty={dteSummary ? null : {
            label: `Sin DTE sincronizados en los últimos ${months} meses`,
            hint: "Los documentos aparecen cuando se sincroniza el portal DTE.",
            ...(syncHref ? { ctaLabel: "Ir a la sincronización DTE", ctaHref: syncHref } : {}),
          }}
        >
          <DteCoverageChart shape={dte} />
        </ChartSection>
      )}
    </div>
  )
}
