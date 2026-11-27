import { ChartFrame } from "@/components/charts/chart-frame"
import { MonthlyComplianceChartLazy } from "@/components/charts/monthly-compliance-chart-lazy"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot, PanelBlock } from "@/components/ui/dashboard-panel"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { layoutChartSlots } from "@/lib/indicators/chart-layout"
import { plural } from "@/lib/mantencion/format"
import { mechanicAction, worksiteAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { PreventiveTabData } from "@/lib/services/mantencion/looker/work-data"
import type { MatrixCheck, PreventiveCompliance } from "@/lib/services/mantencion/looker/types"
import { formatPercent } from "@/lib/utils"
import { ChecklistMatrixView } from "./checklist-matrix"
import { CrossFilterBars } from "./cross-filter-bars"
import { FichaSessionMark } from "./equipment-check-sheet"
import { ComplianceByEquipmentTable } from "./preventive-tables"

/** Las faenas y mecánicos que dibuja el gráfico: los 12 de menor cumplimiento. */
const WORKSITE_BARS = 12

/** La tira de cifras del período, con todos los filtros aplicados (no ignora ninguna dimensión). */
export function preventiveStatBar(summary: PreventiveCompliance): SummaryStat[] {
  return [
    { key: "pautas", label: "Pautas cerradas", value: summary.total, secondary: "en el período" },
    summary.average == null
      ? { key: "cumplimiento", label: "Cumplimiento promedio", value: "Sin dato", valueKind: "text", secondary: "promedio de los % de cada pauta" }
      : { key: "cumplimiento", label: "Cumplimiento promedio", value: formatPercent(summary.average, 1), secondary: "promedio de los % de cada pauta" },
    { key: "sin-hacer", label: "Ítems no realizados", value: summary.notDone, tone: "signal", secondary: "suma de todas las pautas" },
    { key: "fotos", label: "Pautas con fotos incompletas", value: summary.withoutPhotos, tone: "danger", secondary: "filtros o sticker faltante" },
  ]
}

export interface PreventiveSelection {
  /** Mes elegido (`x_mes`, o el de la pauta elegida). */
  month: string | null
  worksiteId: string | null
  mechanicKey: string | null
  /** Equipo del filtro cruzado `x_equipo`. */
  equipmentId: string | null
  /** Pauta del filtro cruzado `x_check`. */
  checkId: string | null
  /** Equipo cuya ficha está abierta. */
  openVehicleId: string | null
}

/**
 * Columna Preventivo, de arriba abajo: la tira de cifras y tres preguntas, cada una un panel de celdas separadas por
 * líneas finas: ¿se cumplen las pautas? (por mes y por faena), ¿qué equipos tienen ítems sin hacer? (la tabla, que
 * abre la ficha) y ¿qué se hizo en cada pauta? (la matriz). El % es el promedio de los % de cada pauta (no el
 * cociente de los totales) y cada bloque ignora la dimensión que él mismo emite, así el clic no lo vacía.
 */
export function PreventivePanel({
  data,
  selected,
  currentMonth,
  hrefForCheck,
}: {
  data: PreventiveTabData
  selected: PreventiveSelection
  /** `YYYY-MM` de hoy: ese mes está incompleto y se dibuja tenue. */
  currentMonth: string
  hrefForCheck: (check: MatrixCheck) => string | null
}) {
  const { summary, monthly, byWorksite, byPlate, matrix } = data
  const [monthSpan, worksiteSpan] = layoutChartSlots(["one", "one"])

  const months = monthly.byMonth.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    percent: bucket.percent,
    checks: bucket.checks,
    partial: bucket.key === currentMonth,
  }))
  const hasMonths = months.some((month) => month.percent != null)

  const worksiteBuckets = byWorksite.byWorksiteMechanic.filter((bucket) => bucket.percent != null && !!bucket.worksiteId)
  const worksiteItems = worksiteBuckets.slice(0, WORKSITE_BARS).map((bucket) => ({
    key: bucket.key,
    // La faena y el mecánico van en dos líneas: juntos («A · B») se cortaban en el mismo punto.
    label: bucket.worksiteName ?? "Sin faena",
    sublabel: bucket.mechanicLabel ?? "Sin mecánico",
    value: bucket.percent!,
    detail: plural(bucket.checks, "pauta", "pautas"),
  }))
  const selectedWorksiteMechanic = selected.worksiteId && selected.mechanicKey ? `${selected.worksiteId}|${selected.mechanicKey}` : null

  return (
    <div className="flex flex-col gap-8">
      <FichaSessionMark />
      <SummaryBar numerals="sans" stats={preventiveStatBar(summary)} />

      <DashboardSection
        id="preventivo-cumplimiento"
        title="¿Se cumplen las pautas?"
        note="Clic en un mes o en una faena filtra la tabla y el checklist."
        links={[]}
        charts={(
          <>
            <ChartSlot span={monthSpan!}>
              <ChartFrame title="Cumplimiento por mes" description="Promedio de los % de cada pauta del mes; el mes en curso está incompleto.">
                {hasMonths ? (
                  <MonthlyComplianceChartLazy data={months} ariaLabel="Cumplimiento por mes" selectedKey={selected.month} />
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin pautas con cumplimiento en el período.</p>
                )}
              </ChartFrame>
            </ChartSlot>
            <ChartSlot span={worksiteSpan!}>
              <ChartFrame
                title="Cumplimiento por faena y mecánico"
                description={`Los ${WORKSITE_BARS} de menor cumplimiento, el más bajo primero. Los nombres del histórico son texto libre.`}
              >
                <CrossFilterBars
                  ariaLabel="Cumplimiento por faena y mecánico"
                  items={worksiteItems}
                  unit="%"
                  mode="percent"
                  max={100}
                  selectedKey={selectedWorksiteMechanic}
                  actionFor={(item) => {
                    const bucket = worksiteBuckets.find((row) => row.key === item.key)
                    if (!bucket?.worksiteId) return worksiteAction("", false)
                    return bucket.mechanicKey
                      ? mechanicAction(bucket.worksiteId, bucket.mechanicLabel ?? bucket.mechanicKey, item.key === selectedWorksiteMechanic)
                      : worksiteAction(bucket.worksiteId, item.key === selectedWorksiteMechanic)
                  }}
                  emptyMessage="Sin pautas con faena y mecánico en el período."
                />
              </ChartFrame>
            </ChartSlot>
          </>
        )}
      />

      <DashboardSection
        id="preventivo-equipos"
        title="Cumplimiento por equipo"
        note="Primero los equipos con ítems sin hacer. Clic en un equipo abre sus pautas: qué se hizo y qué no."
        links={[]}
        charts={(
          <PanelBlock span="full" padding="none">
            <ComplianceByEquipmentTable rows={byPlate.byPlate} selectedId={selected.equipmentId} openId={selected.openVehicleId} />
          </PanelBlock>
        )}
      />

      <DashboardSection
        id="preventivo-checklist"
        title="¿Qué se hizo en cada pauta?"
        note="Cada columna es una pauta. La patente abre sus ítems; el embudo filtra el panel por esa pauta."
        links={[]}
        charts={<ChecklistMatrixView matrix={matrix} selectedCheckId={selected.checkId} hrefForCheck={hrefForCheck} />}
      />
    </div>
  )
}
