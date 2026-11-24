import Link from "next/link"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { plural } from "@/lib/mantencion/format"
import {
  type FindingsWithoutWork,
  type MaintenanceWorkSummary,
  type PanelEquipment,
  type ScheduleComplianceStats,
} from "@/lib/services/mantencion/maintenance-work"
import { formatDate, formatPercent, formatQty } from "@/lib/utils"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import { excelFor, spansFor, withParams, type Common } from "./indicators-sections"
import { WorkTypeChart } from "./indicators-charts-lazy"

/**
 * Las dos secciones que reemplazan al Looker (Trinorma, R5): «Trabajos de mantención» (historial de
 * formularios hasta el corte, órdenes de trabajo que entraron a taller y registros de la plataforma desde el
 * corte) y «Pautas y hallazgos de formularios». Reciben los datos ya cargados; un
 * bloque cuya consulta falló llega como `null` y no se pinta (la página avisa arriba), nunca como un cero.
 *
 * Reglas de honestidad:
 * - La fuente va rotulada en cada gráfico: aquí se mezcla historial importado con datos nativos.
 * - Los trabajos «sin clasificar» se cuentan aparte; no entran en el % de correctivas.
 * - Sin pauta definida es un estado con su propia cifra: nunca un cero ni un «al día».
 */

export interface TrinormaCommon extends Common {
  /** Parámetros de la URL que se conservan al navegar dentro del Panel (`desde`, `hasta`, `faena`, `equipo`). */
  baseParams: Record<string, string | undefined>
  /** Equipo elegido en el filtro `?equipo=`, o `null`. */
  equipment: PanelEquipment | null
}

const PANEL = "/mantencion/panel"

/** Enlace al Panel con otra faena/equipo, conservando el período. */
function panelHref(common: TrinormaCommon, overrides: Record<string, string | null | undefined>): string {
  const merged: Record<string, string | null | undefined> = { ...common.baseParams, ...overrides }
  return withParams(PANEL, merged)
}

// ── Trabajos de mantención ─────────────────────────────────────────────────

const formatDays = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

/** «7 del historial · 3 de OT · 2 registros», sin las fuentes en 0 y sin las OT para quien no las ve. */
function workSourceBreakdown(summary: MaintenanceWorkSummary, includesOrders: boolean): string {
  const { historial, ot, registro } = summary.bySource
  const parts = [
    historial > 0 ? `${formatQty(historial)} del historial` : null,
    includesOrders && ot > 0 ? `${formatQty(ot)} de OT` : null,
    registro > 0 ? `${plural(registro, "registro", "registros")}` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" · ") : "Ninguno en el período"
}

export function MaintenanceWorkSection({
  summary,
  includesOrders,
  ...common
}: TrinormaCommon & {
  summary: MaintenanceWorkSummary | null
  /** `false` = quien mira no ve órdenes de trabajo: las cifras son sólo del historial y la sección lo dice. */
  includesOrders: boolean
}) {
  const faena = common.worksiteId ?? undefined
  const links = [
    // La lista del historial recibe el período y la faena de la sección (`desde`, `hasta`, `faena`).
    { label: "Historial de formularios", href: withParams("/mantencion/registros/historicos", { desde: common.from, hasta: common.to, faena }) },
    ...(includesOrders ? [{ label: "Órdenes de trabajo", href: withParams("/mantencion/ot", { faena }) }] : []),
    ...(common.equipment ? [{ label: "Hoja de vida del equipo", href: vehicleFichaHref(common.equipment.id, "mantencion") }] : []),
  ]
  const cutover = formatDate(FORMS_CUTOVER_DATE)
  const source = includesOrders
    ? `historial de formularios (hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)}), órdenes de trabajo y registros de la plataforma (desde el ${cutover}); sin anuladas ni filas de prueba`
    : `historial de formularios (hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)}) y registros de la plataforma (desde el ${cutover}); tu perfil no ve todas las órdenes de trabajo de su alcance`
  // Qué cuenta y desde cuándo, dicho una sola vez en la sección: ninguna lista reproduce la suma de las tres fuentes.
  const definition = `Hasta el ${formatDate(FORMS_LAST_COUNTED_DATE)} cuentan los formularios; desde el ${cutover}, los registros firmados en la plataforma. Las OT cuentan cuando entran a taller.`
  const note = common.equipment ? `${common.scopeNote} · ${common.equipment.label}` : common.scopeNote

  if (!summary) return null

  const seriesTotal = summary.series.reduce((sum, point) => sum + point.preventiva + point.correctiva + point.predictiva + point.sin_clasificar, 0)
  if (summary.total === 0 && seriesTotal === 0) {
    return (
      <DashboardSection
        id="trabajos-mantencion"
        title="Trabajos de mantención"
        links={links}
        note={definition}
        charts={
          <ChartSlot span="full">
            <EmptyState
              compact
              title="No hay trabajos de mantención en este período"
              description="Prueba con otro período."
              action={<Link href="/mantencion/registros/historicos" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ver historial de formularios</Link>}
            />
          </ChartSlot>
        }
      />
    )
  }

  const { byType, workshopDays, laborHours } = summary
  const stats: SummaryStat[] = [
    {
      key: "trabajos-total",
      label: "Trabajos del período",
      value: summary.total,
      // Sin `href`: suma tres fuentes y ninguna lista la reproduce (PANN-4); el desglose va en el subtítulo.
      secondary: workSourceBreakdown(summary, includesOrders),
    },
    {
      key: "trabajos-correctivas",
      label: "Correctivas",
      value: summary.correctivePercent === null ? "Sin dato" : formatPercent(summary.correctivePercent, 0),
      valueKind: summary.correctivePercent === null ? "text" : "number",
      secondary: summary.correctivePercent === null
        ? `Ningún trabajo clasificado por tipo · ${formatQty(byType.sin_clasificar)} sin clasificar`
        : `${formatQty(byType.correctiva)} de ${formatQty(summary.classified)} clasificados · ${formatQty(byType.sin_clasificar)} sin clasificar aparte`,
    },
    {
      key: "trabajos-dias-taller",
      label: "Días en taller",
      value: workshopDays.withData === 0 ? "Sin dato" : formatDays(workshopDays.total),
      valueKind: workshopDays.withData === 0 ? "text" : "number",
      secondary: workshopDays.withData === 0
        ? "Ningún trabajo trae fecha de ingreso y de salida"
        : `${plural(workshopDays.withData, "trabajo con fechas", "trabajos con fechas")} · ${formatQty(workshopDays.withoutData)} sin ellas${workshopDays.inWorkshop > 0 ? ` · ${formatQty(workshopDays.inWorkshop)} en taller hoy` : ""}`,
    },
    {
      key: "trabajos-horas",
      label: "Horas hombre",
      value: laborHours.withData === 0 ? "Sin dato" : formatDays(laborHours.total),
      valueKind: laborHours.withData === 0 ? "text" : "number",
      secondary: laborHours.withData === 0
        ? "Ningún trabajo informa horas"
        : `${plural(laborHours.withData, "trabajo con horas", "trabajos con horas")} · ${formatQty(laborHours.withoutData)} sin ellas`,
    },
  ]

  const excel = excelFor(common, note)
  const chartExcel = excelFor(common, `${common.chartNote}${common.equipment ? ` · ${common.equipment.label}` : ""}`)

  // Por faena (sólo con varias a la vista y sin un equipo elegido: con uno, la faena es una sola).
  const showSites = !common.equipment && summary.byWorksite.length > 0
  const daysByWorksite = showSites ? summary.byWorksite.filter((site) => site.workshopDays > 0) : []
  // El total de días ya está en la tira: el titular del gráfico dice otra cosa, la faena que más acumula (PANN-18).
  const topDays = daysByWorksite.reduce((top, site) => (site.workshopDays > top.workshopDays ? site : top), daysByWorksite[0] ?? { name: "", workshopDays: 0 })
  const hoursByWorksite = showSites ? summary.byWorksite.filter((site) => site.laborHours > 0) : []
  // Igual que los días: el total de horas ya está en la tira; el titular dice la faena que más horas suma.
  const topHours = hoursByWorksite.reduce((top, site) => (site.laborHours > top.laborHours ? site : top), hoursByWorksite[0] ?? { name: "", laborHours: 0 })
  const topHoursTies = hoursByWorksite.filter((site) => site.laborHours === topHours.laborHours).length
  const siteHref = (site: { worksiteId: string | null }) => (site.worksiteId ? panelHref(common, { faena: site.worksiteId, equipo: null }) : undefined)
  const corrective = summary.topCorrective
  const spans = spansFor([
    { id: "type", visible: seriesTotal > 0 },
    { id: "days", visible: daysByWorksite.length > 0 },
    { id: "hours", visible: hoursByWorksite.length > 0 },
    { id: "equipment", visible: corrective.length > 0 },
  ])
  const sourceDescription = `${note} · Fuente: ${source}`

  return (
    <DashboardSection
      id="trabajos-mantencion"
      title="Trabajos de mantención"
      links={links}
      note={definition}
      summary={<SummaryBar numerals="sans" stats={stats} />}
      charts={
        <>
          <ChartSlot span={spans.type}>
            <WorkTypeChart
              data={summary.series}
              granularity={common.chart.granularity}
              scopeNote={`${common.chartNote}${common.equipment ? ` · ${common.equipment.label}` : ""}`}
              excel={chartExcel}
              source={source}
            />
          </ChartSlot>
          {daysByWorksite.length > 0 && (
            <ChartSlot span={spans.days}>
              <ChartFrame
                title="Días en taller por faena"
                description={sourceDescription}
                headline={
                  <>
                    <ChartHeadlineValue>{formatDays(topDays.workshopDays)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {daysByWorksite.filter((site) => site.workshopDays === topDays.workshopDays).length === 1
                        ? `días en taller en ${topDays.name}, la faena con más`
                        : `días en taller en cada una de las ${plural(daysByWorksite.filter((site) => site.workshopDays === topDays.workshopDays).length, "faena", "faenas")} con más`}
                      ; sólo cuentan los trabajos con fecha de ingreso y de salida
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Días en taller por faena"
                  unit=" días"
                  order="desc"
                  limit={10}
                  digits={1}
                  items={daysByWorksite.map((site) => ({ key: site.key, label: site.name, value: site.workshopDays, href: siteHref(site) }))}
                />
                <ChartDataTable
                  caption="Días en taller por faena"
                  headers={["Faena", "Días en taller", "Trabajos"]}
                  rows={daysByWorksite.map((site) => [site.name, formatDays(site.workshopDays), site.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {hoursByWorksite.length > 0 && (
            <ChartSlot span={spans.hours}>
              <ChartFrame
                title="Horas hombre por faena"
                description={sourceDescription}
                headline={
                  <>
                    <ChartHeadlineValue>{formatDays(topHours.laborHours)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {topHoursTies === 1
                        ? `horas hombre en ${topHours.name}, la faena con más`
                        : `horas hombre en cada una de las ${plural(topHoursTies, "faena", "faenas")} con más`}
                      ; los trabajos sin horas no suman
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Horas hombre por faena"
                  unit=" h"
                  order="desc"
                  limit={10}
                  digits={1}
                  items={hoursByWorksite.map((site) => ({ key: site.key, label: site.name, value: site.laborHours, href: siteHref(site) }))}
                />
                <ChartDataTable
                  caption="Horas hombre por faena"
                  headers={["Faena", "Horas hombre", "Trabajos"]}
                  rows={hoursByWorksite.map((site) => [site.name, formatDays(site.laborHours), site.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {corrective.length > 0 && (
            <ChartSlot span={spans.equipment}>
              <ChartFrame
                title="Equipos con más correctivas"
                description={`${note} · Fuente: ${source}; sólo equipos con 2 o más`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(corrective[0]!.count)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {corrective.filter((row) => row.count === corrective[0]!.count).length === 1
                        ? `correctivas en ${corrective[0]!.label}, el equipo con más`
                        : `equipos empatan con ${formatQty(corrective[0]!.count)} correctivas`}
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Equipos con más trabajos correctivos"
                  unit=" correctivas"
                  order="desc"
                  limit={8}
                  items={corrective.map((row) => ({
                    key: row.vehicleId,
                    label: row.label,
                    value: row.count,
                    // Chome → faena → equipo: el equipo acota el Panel; desde ahí se llega a su hoja de vida.
                    href: panelHref(common, { equipo: row.vehicleId }),
                  }))}
                />
                <ChartDataTable
                  caption="Equipos con más correctivas"
                  headers={["Equipo", "Correctivas"]}
                  rows={corrective.map((row) => [row.label, row.count])}
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

// ── Pautas y hallazgos de formularios (R5) ─────────────────────────────────

export function FormsIndicatorsSection({
  compliance,
  findings,
  ...common
}: TrinormaCommon & {
  compliance: ScheduleComplianceStats | null
  findings: FindingsWithoutWork | null
}) {
  const faena = common.worksiteId ?? undefined
  const note = common.equipment ? `${common.scopeNote} · ${common.equipment.label}` : common.scopeNote
  const links = [
    { label: "Equipos", href: withParams("/mantencion/equipos", { faena }) },
    ...(common.equipment ? [{ label: "Hoja de vida del equipo", href: vehicleFichaHref(common.equipment.id, "mantencion") }] : []),
  ]
  const stats: SummaryStat[] = []

  if (compliance) {
    stats.push({
      key: "checklist-pauta",
      label: "Checklist de pauta (formularios)",
      value: compliance.averagePercent === null ? "Sin dato" : formatPercent(compliance.averagePercent, 0),
      valueKind: compliance.averagePercent === null ? "text" : "number",
      secondary: compliance.averagePercent === null
        ? "Sin pautas importadas de formularios en el período"
        : `Promedio de ${plural(compliance.withCompliance, "pauta importada", "pautas importadas")} · no es el semáforo de la plataforma`,
    })
  } else {
    stats.push({ key: "checklist-pauta", label: "Checklist de pauta (formularios)", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular" })
  }

  if (findings) {
    const extras = [
      findings.inWindow > 0 ? `${formatQty(findings.inWindow)} aún dentro del plazo` : null,
      findings.unlinked > 0 ? `${formatQty(findings.unlinked)} sin equipo vinculado` : null,
    ].filter((part): part is string => part !== null)
    stats.push({
      key: "hallazgos-sin-trabajo",
      label: "Hallazgos «mal estado» sin trabajo",
      value: findings.withoutWork === 0 ? "Ninguno" : findings.withoutWork,
      valueKind: findings.withoutWork === 0 ? "text" : "number",
      secondary: `de ${plural(findings.total, "hallazgo", "hallazgos")} del período; sin trabajo ni OT registrados en ${plural(findings.days, "día", "días")}${extras.length ? ` · ${extras.join(" · ")}` : ""}`,
      tone: "signal",
    })
  } else {
    stats.push({ key: "hallazgos-sin-trabajo", label: "Hallazgos «mal estado» sin trabajo", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular" })
  }

  const rows = findings?.byEquipment ?? []
  const excel = excelFor(common, note)
  const spans = spansFor([{ id: "findings", visible: rows.length > 0 }])

  return (
    <DashboardSection
      id="pautas-hallazgos-formularios"
      title="Pautas y hallazgos de formularios"
      links={links}
      summary={<SummaryBar numerals="sans" stats={stats} />}
      charts={
        <>
          {findings && rows.length > 0 && (
            <ChartSlot span={spans.findings}>
              <ChartFrame
                title="Hallazgos «mal estado» sin trabajo, por equipo"
                description={`${note} · Fuente: inspecciones importadas de formularios y trabajos del equipo (historial y OT)`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(findings.withoutWork)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      hallazgos en {plural(rows.length, "equipo", "equipos")} sin trabajo ni OT registrados en los {formatQty(findings.days)} días siguientes
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Hallazgos en mal estado sin trabajo por equipo"
                  unit=" hallazgos"
                  order="desc"
                  limit={8}
                  items={rows.map((row) => ({
                    key: row.vehicleId,
                    label: row.label,
                    value: row.count,
                    detail: row.items.slice(0, 3).join(" · "),
                    href: panelHref(common, { equipo: row.vehicleId }),
                  }))}
                />
                <ChartDataTable
                  caption="Hallazgos «mal estado» sin trabajo, por equipo"
                  headers={["Equipo", "Faena", "Hallazgos", "Desde", "Ítems"]}
                  rows={rows.map((row) => [row.label, row.worksiteName ?? "Sin faena", row.count, formatDate(row.firstFoundOn), row.items.join("; ")])}
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
