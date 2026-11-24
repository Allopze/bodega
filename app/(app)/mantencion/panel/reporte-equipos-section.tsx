import Link from "next/link"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { plural } from "@/lib/mantencion/format"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import type { ReporteEquiposIndicators } from "@/lib/services/mantencion/reporte-equipos"
import { AGE_BUCKETS, REPORTE_EQUIPOS_TEMPLATE_NAME } from "@/lib/services/mantencion/reporte-equipos-metrics"
import { formatPercent, formatQty } from "@/lib/utils"
import { excelFor, spansFor, withParams, type Common } from "./indicators-sections"
import { OpenFailuresAgeChart, ReportsPerDayChart } from "./reporte-equipos-charts-lazy"

/**
 * Sección «Reportes de equipos» del Panel de mantención: lleva a la plataforma los indicadores que el
 * supervisor de una faena calculaba a mano a partir del reporte diario en papel de cada equipo.
 * Contesta una sola pregunta: ¿llegan los reportes de turno y qué fallas dejan abiertas?
 *
 * Recibe los datos ya cargados. Sin ningún reporte en el alcance (o con la consulta caída, que la
 * página ya avisó en el banner de datos incompletos) no se pinta: ni la sección ni su marco.
 * No repite la disponibilidad de los equipos: «Pautas y disponibilidad» ya la muestra (A5).
 *
 * Los enlaces van a la bandeja de Inspecciones de Prevención, que no filtra por plantilla: lo que sí
 * entiende es la búsqueda de texto (`q`, que mira el nombre de la plantilla), la faena y la vista de
 * hallazgos abiertos. Quien no puede ver inspecciones recibe las cifras sin enlace.
 */

const INSPECTIONS = "/prevencion/inspecciones"

/** Porcentaje que nunca redondea hacia arriba hasta 100 %: «99,6 %» con reportes sin llegar no es «100 %». */
function percentText(percent: number): string {
  return formatPercent(percent >= 100 ? 100 : Math.floor(percent), 0)
}

function equipmentLabel(code: string, plate: string): string {
  return !plate || code === plate ? code : `${code} · ${plate}`
}

export function ReporteEquiposSection({
  data,
  canViewInspections,
  ...common
}: Common & {
  /** `null` = la consulta falló (la página ya lo dijo). */
  data: ReporteEquiposIndicators | null
  canViewInspections: boolean
}) {
  if (!data || !data.hasRuns) return null

  const { coverage, signatures, hours, failures, bySystem } = data
  const faena = common.worksiteId ?? undefined
  const reportsHref = canViewInspections ? withParams(INSPECTIONS, { q: REPORTE_EQUIPOS_TEMPLATE_NAME, faena }) : undefined
  const failuresHref = canViewInspections ? withParams(INSPECTIONS, { q: REPORTE_EQUIPOS_TEMPLATE_NAME, vista: "open_findings", faena }) : undefined
  const links = reportsHref ? [{ label: "Reportes en Inspecciones", href: reportsHref }] : []

  const noData = coverage.expected === 0 && failures.total === 0 && bySystem.length === 0
  if (noData) {
    return (
      <DashboardSection
        id="reportes-equipos"
        title="Reportes de equipos"
        links={links}
        charts={
          <ChartSlot span="full">
            <EmptyState
              compact
              title="No hay reportes de equipos en este período"
              description="Aparecerán cuando se transcriban los reportes diarios de los equipos."
              action={reportsHref ? <Link href={reportsHref} className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ver reportes en Inspecciones</Link> : undefined}
            />
          </ChartSlot>
        }
      />
    )
  }

  const noReceived = signatures.received === 0
  const summary = (
    <SummaryBar
      numerals="sans"
      stats={[
        coverage.percent === null
          ? { key: "reportes-recibidos", label: "Reportes recibidos", value: "Sin reportes", valueKind: "text", secondary: "Ningún reporte esperado en el período", href: reportsHref }
          : {
              key: "reportes-recibidos",
              label: "Reportes recibidos",
              value: percentText(coverage.percent),
              secondary: `${formatQty(coverage.received)} de ${plural(coverage.expected, "reporte esperado", "reportes esperados")}`,
              href: reportsHref,
            },
        signatures.percent === null
          ? { key: "firmas-completas", label: "Firmas completas", value: "Sin reportes", valueKind: "text", secondary: noReceived ? "Aún no llega ningún reporte en el período" : "No se pudo calcular", href: reportsHref }
          : {
              key: "firmas-completas",
              label: "Firmas completas",
              value: percentText(signatures.percent),
              secondary: `${formatQty(signatures.complete)} de ${plural(signatures.received, "reporte recibido", "reportes recibidos")} con todas las firmas`,
              href: reportsHref,
            },
        hours.measuredReports === 0
          ? {
              key: "horas-operadas",
              label: "Horas operadas",
              value: "Sin horómetros",
              valueKind: "text",
              secondary: noReceived ? "Aún no llega ningún reporte en el período" : "Ningún reporte trae el horómetro de inicio y de término",
              href: reportsHref,
            }
          : {
              key: "horas-operadas",
              label: "Horas operadas",
              value: formatQty(hours.total, undefined, { maximumFractionDigits: 1 }),
              secondary: `Horómetro de ${formatQty(hours.measuredReports)} de ${plural(signatures.received, "reporte recibido", "reportes recibidos")}`,
              href: reportsHref,
            },
        failures.total === 0
          ? { key: "fallas-abiertas", label: "Fallas abiertas", value: "Ninguna", valueKind: "text", secondary: "Sin fallas abiertas · hoy", href: failuresHref }
          : {
              key: "fallas-abiertas",
              label: "Fallas abiertas",
              value: failures.total,
              hint: failures.safety > 0 ? `${formatQty(failures.safety)} de seguridad` : undefined,
              tone: failures.safety > 0 ? "danger" : "signal",
              secondary: failures.safety > 0 ? "Hoy · hallazgos sin cerrar" : "Ninguna de seguridad · hoy",
              href: failuresHref,
            },
      ] satisfies SummaryStat[]}
    />
  )

  const excel = excelFor(common, common.scopeNote)
  const spans = spansFor([
    { id: "perDay", visible: coverage.points.some((point) => point.expected + point.received > 0) },
    { id: "hours", visible: hours.byEquipment.length > 0 },
    { id: "age", visible: failures.byEquipment.length > 0 },
    { id: "system", visible: bySystem.length > 0 },
  ])

  const topHours = hours.byEquipment[0]
  const topHoursLeaders = topHours ? hours.byEquipment.filter((row) => row.hours === topHours.hours) : []
  const oldFailures = failures.byEquipment.reduce((sum, row) => sum + row.old, 0)
  const topSystem = bySystem[0]
  const topSystemLeaders = topSystem ? bySystem.filter((row) => row.count === topSystem.count) : []
  const ageRows = failures.byEquipment.map((row) => ({
    key: row.key,
    label: equipmentLabel(row.code, row.plate),
    fresh: row.fresh,
    week: row.week,
    old: row.old,
    total: row.total,
  }))

  return (
    <DashboardSection
      id="reportes-equipos"
      title="Reportes de equipos"
      links={links}
      summary={summary}
      charts={
        <>
          {coverage.points.length > 0 && (
            <ChartSlot span={spans.perDay}>
              <ReportsPerDayChart data={coverage.points} granularity={common.granularity} scopeNote={common.scopeNote} excel={excel} />
            </ChartSlot>
          )}
          {topHours && (
            <ChartSlot span={spans.hours}>
              <ChartFrame
                title="Horas operadas por equipo"
                description={`${common.scopeNote} · Fuente: horómetros de los reportes recibidos (se suman los turnos de 0 a 24 h)`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(topHours.hours, undefined, { maximumFractionDigits: 1 })}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {topHoursLeaders.length === 1
                        ? `horas operadas por ${topHours.code}, el equipo con más en el período`
                        : `horas operadas por cada uno de ${topHoursLeaders.length} equipos, el máximo del período`}
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Horas operadas por equipo"
                  unit=" h"
                  digits={1}
                  order="desc"
                  limit={8}
                  items={hours.byEquipment.map((row) => ({
                    key: row.vehicleId,
                    label: equipmentLabel(row.code, row.plate),
                    value: row.hours,
                    href: vehicleFichaHref(row.vehicleId, "mantencion"),
                  }))}
                />
                <ChartDataTable
                  caption="Horas operadas por equipo"
                  headers={["Equipo", "Patente", "Horas operadas"]}
                  rows={hours.byEquipment.map((row) => [row.code, row.plate, formatQty(row.hours, undefined, { maximumFractionDigits: 1 })])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {failures.byEquipment.length > 0 && (
            <ChartSlot span={spans.age}>
              <ChartFrame
                title="Fallas abiertas por equipo, según antigüedad"
                description={`Hoy · ${common.worksiteId ? "faena elegida" : "todas las faenas del alcance"} · Fuente: hallazgos sin cerrar de los reportes; la antigüedad cuenta desde que se detectó la falla`}
                headline={
                  <>
                    <ChartHeadlineValue tone={oldFailures > 0 ? "danger" : "neutral"}>{formatQty(oldFailures)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {oldFailures === 0 ? "fallas con más de 7 días abiertas: todas son recientes" : oldFailures === 1 ? "falla lleva más de 7 días abierta" : "fallas llevan más de 7 días abiertas"}
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <OpenFailuresAgeChart rows={ageRows} ariaLabel="Fallas abiertas por equipo, por antigüedad" limit={8} />
                <ChartDataTable
                  caption="Fallas abiertas por equipo, según antigüedad"
                  headers={["Equipo", "Patente", ...AGE_BUCKETS.map((bucket) => bucket.label), "Total", "De seguridad"]}
                  rows={failures.byEquipment.map((row) => [row.code, row.plate, row.fresh, row.week, row.old, row.total, row.safety])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {topSystem && (
            <ChartSlot span={spans.system}>
              <ChartFrame
                title="Fallas reportadas por sistema"
                description={`${common.scopeNote} · Fuente: ítems marcados «Falla» en los reportes recibidos (cada reporte cuenta una vez)`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(topSystem.count)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {topSystemLeaders.length === 1
                        ? `fallas reportadas en ${topSystem.label.toLowerCase()}, el sistema con más`
                        : `fallas reportadas en cada uno de ${topSystemLeaders.length} sistemas, el máximo del período`}
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Fallas reportadas por sistema"
                  unit=" fallas"
                  order="desc"
                  limit={8}
                  items={bySystem.map((row) => ({ key: row.id, label: row.label, value: row.count }))}
                />
                <ChartDataTable
                  caption="Fallas reportadas por sistema"
                  headers={["Sistema", "Fallas reportadas"]}
                  rows={bySystem.map((row) => [row.label, row.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
        </>
      }
    />
  )
}
