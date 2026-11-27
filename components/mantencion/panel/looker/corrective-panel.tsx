import { ChartFrame } from "@/components/charts/chart-frame"
import { DenseChart } from "@/components/charts/dense-chart"
import { HoursRecordsComboChartLazy } from "@/components/charts/hours-records-combo-chart-lazy"
import { MonthlyWorkChartLazy } from "@/components/charts/monthly-work-chart-lazy"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot, PanelBlock } from "@/components/ui/dashboard-panel"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { plural } from "@/lib/mantencion/format"
import { conductorAction, equipmentAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { CorrectivePage, CorrectiveStats, DriverRow, EquipmentSeriesRow, MonthlyCount } from "@/lib/services/mantencion/looker/types"
import { formatQty } from "@/lib/utils"
import { CorrectiveWorkTable } from "./corrective-table"
import { CrossFilterBars } from "./cross-filter-bars"

/** Cifras de la tira. «Sin foto» va en naranja (`signal`): es respaldo pendiente de subir, no una falla crítica. */
export function correctiveStatBar(stats: CorrectiveStats, controlled: number): SummaryStat[] {
  const photoShare = stats.photoEligible > 0 ? Math.round((stats.withoutPhoto * 100) / stats.photoEligible) : null
  return [
    {
      key: "total",
      label: "Trabajos correctivos",
      value: stats.total,
      secondary: "OT con ingreso a taller y correctivas",
    },
    {
      key: "hours",
      label: "Horas de trabajo",
      value: formatQty(stats.hours, undefined, { maximumFractionDigits: 1 }),
      secondary: "Las que declara cada trabajo",
    },
    {
      key: "equipment",
      label: "Equipos con correctivo",
      value: stats.equipment,
      secondary: `de ${controlled} ${controlled === 1 ? "controlado" : "controlados"}`,
    },
    {
      key: "withoutPhoto",
      label: "Sin foto de respaldo",
      value: stats.withoutPhoto,
      tone: "signal",
      secondary: photoShare === null
        ? "Sin OT ni registros de la plataforma"
        : `${photoShare} % de las OT y registros`,
    },
  ]
}

/**
 * Pestaña Correctivo, en una sola columna: la tira de cifras, ¿dónde se concentra el trabajo? (equipos, conductores y
 * meses) y la tabla de trabajos. Cada sección es un `h2` con su pregunta y UN panel de celdas. El clic en un equipo,
 * un conductor o un mes filtra el resto de la pestaña; cada bloque ignora la dimensión que él mismo emite (el
 * cargador lo decide, ver `corrective-tab-data.ts`), así sus propias barras siguen todas a la vista.
 */
export function CorrectivePanel({
  stats,
  controlled,
  series,
  drivers,
  monthly,
  page,
  unit,
  period,
  hrefForPage,
  selected,
}: {
  stats: CorrectiveStats
  /** Equipos de esta unidad dentro del alcance de los filtros: el «de N controlados». */
  controlled: number
  series: EquipmentSeriesRow[]
  drivers: DriverRow[]
  monthly: MonthlyCount[]
  page: CorrectivePage
  unit: "km" | "h"
  period: { from: string; to: string }
  hrefForPage: (page: number) => string
  selected: { workId: string | null; driverKey: string | null; equipmentId: string | null; monthKey: string | null }
}) {
  const hasMonthly = monthly.some((month) => month.count > 0)

  return (
    <div className="flex flex-col gap-8">
      <SummaryBar numerals="sans" stats={correctiveStatBar(stats, controlled)} />

      <DashboardSection
        id="correctivo-concentracion"
        title="¿Dónde se concentra el trabajo?"
        note="Clic en un equipo, un conductor o un mes filtra el resto de la pestaña."
        links={[]}
        charts={(
          <>
            {/* El combinado va a fila completa; conductor y meses, de a dos por fila (en 2xl, que tiene 3 columnas, los meses toman dos para no dejar hueco). */}
            <ChartSlot span="full">
              <ChartFrame title="Horas y registros por equipo" description="Barras: horas trabajadas. Línea: número de registros. Los 8 equipos con más horas.">
                {series.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin trabajos con equipo en el período.</p>
                ) : (
                  // Bajo 360 px las patentes del eje no se leen: el gráfico pasa a la lista de horas por equipo, que filtra igual.
                  <DenseChart
                    when={series.length > 6}
                    fallback={(
                      <CrossFilterBars
                        ariaLabel="Horas trabajadas por equipo"
                        items={series.map((row) => ({ key: row.vehicleId, label: row.label, value: row.hours, detail: plural(row.records, "registro", "registros") }))}
                        unit=" h"
                        digits={1}
                        mode="rank"
                        selectedKey={selected.equipmentId}
                        actionFor={(item) => equipmentAction(item.key, item.key === selected.equipmentId)}
                      />
                    )}
                  >
                    <HoursRecordsComboChartLazy
                      data={series.map((row) => ({ key: row.vehicleId, label: row.label, hours: row.hours, records: row.records }))}
                      ariaLabel="Horas trabajadas y número de registros por equipo"
                      selectedKey={selected.equipmentId}
                    />
                  </DenseChart>
                )}
              </ChartFrame>
            </ChartSlot>
            <ChartSlot span="one">
              <ChartFrame title="Horas trabajadas por conductor" description="Las 10 personas con más horas, repartidas entre los conductores de cada trabajo. Los nombres del histórico son texto libre.">
                <CrossFilterBars
                  ariaLabel="Horas trabajadas por conductor"
                  items={drivers.slice(0, 10).map((driver) => ({
                    key: driver.key,
                    label: driver.label,
                    value: driver.hours,
                    detail: plural(driver.records, "registro", "registros"),
                  }))}
                  unit=" h"
                  digits={1}
                  mode="rank"
                  selectedKey={selected.driverKey}
                  actionFor={(item) => conductorAction(item.label, item.key === selected.driverKey)}
                  emptyMessage="Sin conductores registrados en el período."
                />
              </ChartFrame>
            </ChartSlot>
            <ChartSlot span="one" className="2xl:col-span-2">
              <ChartFrame title="Trabajos correctivos por mes" description="Trabajos con ingreso a taller en cada mes del período; el mes en curso está incompleto.">
                {hasMonthly ? (
                  <MonthlyWorkChartLazy
                    data={monthly.map((month) => ({ key: month.key, label: month.label, count: month.count, partial: month.partial }))}
                    ariaLabel="Trabajos correctivos por mes"
                    selectedKey={selected.monthKey}
                  />
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">Sin trabajos correctivos en el período.</p>
                )}
              </ChartFrame>
            </ChartSlot>
          </>
        )}
      />

      <DashboardSection
        id="correctivo-trabajos"
        title="Trabajos del período"
        note="OT que ya entraron a taller y correctivas desde el corte; la fecha es el ingreso a taller. Clic en un trabajo filtra el resto de la pestaña."
        links={[]}
        charts={(
          <PanelBlock span="full" padding="none">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-3">
              <p className="text-xs text-[var(--color-text-muted)]">Del más reciente al más antiguo.</p>
              <p className="font-mono text-2xs tabular-nums text-[var(--color-text-muted)]">{plural(page.total, "trabajo", "trabajos")}</p>
            </div>
            <CorrectiveWorkTable
              page={page}
              unit={unit}
              period={period}
              hrefForPage={hrefForPage}
              selectedWorkId={selected.workId}
            />
          </PanelBlock>
        )}
      />
    </div>
  )
}
