import Link from "next/link"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { EmptyState } from "@/components/ui/empty-state"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import type { IndicatorGranularity } from "@/lib/indicators/period"
import { CHART_COLORS } from "@/lib/chart-palette"
import { EQUIPMENT_STATE_LABEL, formatHours, plural } from "@/lib/mantencion/format"
import type { MantEquipmentState } from "@/lib/mantencion/types"
import { OT_STATUS_LABELS, type OtStatus } from "@/lib/mantencion/work-order-states"
import {
  pautaCompliance,
  percentChange,
  type OutOfServiceIndicators,
  type PautaState,
  type RecordIndicators,
  type RepairRankingRow,
  type WorkOrderPeriodStats,
  type WorkOrderSeriesPoint,
} from "@/lib/services/mantencion/indicators"
import { formatCLP, formatPercent, formatQty } from "@/lib/utils"
import { layoutChartSlots, type SlotSpan } from "@/lib/indicators/chart-layout"
import {
  OutOfServiceChart,
  RecordsKindChart,
  WorkOrderFlowChart,
  WorkOrderMixChart,
} from "./indicators-charts-lazy"

/**
 * Las dos secciones de los Indicadores de mantención. Reciben los datos ya cargados: un bloque
 * cuya consulta falló llega como `null` y se pinta «Sin dato» (o no se pinta), nunca como un
 * cero que se lea como «todo en orden». La página es quien envuelve cada consulta.
 */

interface Common {
  from: string
  to: string
  granularity: IndicatorGranularity
  /** Faena elegida (ya validada contra el alcance), o `null` = todas. */
  worksiteId: string | null
  /** «01-09-2026 al 13-11-2026 · todas las faenas»: va bajo el título de cada gráfico. */
  scopeNote: string
  canExport: boolean
}

const PERIOD_VS = "vs. período anterior"

function withParams(base: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `${base}?${text}` : base
}

/** «18,5 h» hasta dos días; sobre eso, en días: 126 h se leen mejor como «5,3 días». */
function formatDuration(hours: number): string {
  if (hours < 48) return formatHours(hours)
  return `${formatQty(hours / 24, undefined, { maximumFractionDigits: 1 })} días`
}

/**
 * Anchos de los gráficos que de verdad se pintan, en su orden (`layoutChartSlots`): todos son
 * de tipo «one» (dos por fila en `xl`, tres en `2xl`) y el reparto sólo ensancha uno para cerrar
 * una fila; los que no se pintan no ocupan lugar.
 */
function spansFor<T extends string>(cells: Array<{ id: T; visible: boolean }>): Record<T, SlotSpan> {
  const shown = cells.filter((cell) => cell.visible)
  const spans = layoutChartSlots(shown.map(() => "one" as const))
  const result = {} as Record<T, SlotSpan>
  for (const cell of cells) result[cell.id] = "one"
  shown.forEach((cell, index) => { result[cell.id] = spans[index]! })
  return result
}

/** «+50 % vs. período anterior»: la variación va como texto en la tira, junto a la cifra. */
function trendHint(change: number | null): string | undefined {
  if (change === null) return undefined
  const rounded = Math.round(change)
  return `${rounded > 0 ? "+" : ""}${formatQty(rounded)} % ${PERIOD_VS}`
}

function excelFor(common: Common): ChartDataExcel | undefined {
  return common.canExport ? { permission: "mant:export", notes: [common.scopeNote] } : undefined
}

// ── Sección 1: Órdenes de trabajo ──────────────────────────────────────────

const OT_STATUS_COLOR: Record<OtStatus, string> = {
  solicitada: CHART_COLORS.signal,
  asignada: CHART_COLORS.neutral,
  en_ejecucion: "var(--color-warning)",
  trabajo_terminado: CHART_COLORS.blue,
  recepcionada: CHART_COLORS.brand,
  cerrada: CHART_COLORS.brand,
  anulada: CHART_COLORS.danger,
}

export function WorkOrdersSection({
  series,
  stats,
  byStatus,
  ...common
}: Common & {
  series: WorkOrderSeriesPoint[] | null
  stats: WorkOrderPeriodStats | null
  byStatus: Array<{ status: OtStatus; count: number }> | null
}) {
  const { worksiteId } = common
  const faena = worksiteId ?? undefined
  const open = byStatus ? byStatus.reduce((sum, item) => sum + item.count, 0) : null
  const unassigned = byStatus?.find((item) => item.status === "solicitada")?.count ?? 0
  const noData =
    byStatus !== null && series !== null && stats !== null &&
    open === 0 && stats.closed === 0 && stats.closedPrevious === 0 &&
    series.every((point) => point.created === 0 && point.closed === 0 && point.backlog === 0)

  const links = [
    { label: "Órdenes de trabajo", href: withParams("/mantencion/ot", { estado: "abiertas", faena }) },
    { label: "Panel de mantención", href: withParams("/mantencion/panel", { faena }) },
  ]

  if (noData) {
    return (
      <DashboardSection
        id="ordenes-trabajo"
        title="Órdenes de trabajo"
        links={links}
        charts={
          <ChartSlot span="full">
            <EmptyState
              compact
              title="Todavía no hay órdenes de trabajo en este período"
              description="Cuando se pida una reparación o una mantención para un equipo, aquí verás cuántas se crean, cuántas se cierran y cuánto trabajo queda en cola."
              action={<Link href="/mantencion/ot" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ver órdenes de trabajo →</Link>}
            />
          </ChartSlot>
        }
      />
    )
  }

  const otHref = (params: Record<string, string | null | undefined>) => withParams("/mantencion/ot", { faena, ...params })
  const closedTrend = stats ? percentChange(stats.closed, stats.closedPrevious) : null
  const closedList = otHref({ estado: "cerrada" })

  const summary = (
    <SummaryBar
      numerals="sans"
      stats={[
        {
          key: "ot-abiertas",
          label: "OT abiertas",
          value: open === null ? "Sin dato" : open === 0 ? "Ninguna" : open,
          valueKind: open === null || open === 0 ? "text" : "number",
          hint: open !== null && unassigned > 0 ? `${unassigned} por asignar` : undefined,
          secondary: open === null ? "No se pudo calcular" : open === 0 ? "Sin órdenes abiertas · hoy" : unassigned > 0 ? "Hoy" : "Todas con mecánico · hoy",
          tone: unassigned > 0 ? "signal" : undefined,
          href: otHref({ estado: "abiertas" }),
        },
        stats
          ? {
              key: "ot-cerradas",
              label: "OT cerradas en el período",
              value: stats.closed,
              hint: trendHint(closedTrend),
              secondary: stats.closed === 0 ? "Ninguna OT se cerró en el período" : stats.closedPrevious > 0 ? `Período anterior: ${formatQty(stats.closedPrevious)}` : "Sin cierres en el período anterior",
              href: closedList,
            }
          : { key: "ot-cerradas", label: "OT cerradas en el período", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: closedList },
        stats
          ? {
              key: "mttr",
              label: "Tiempo medio de reparación",
              value: stats.mttrHours === null ? "Sin dato" : formatDuration(stats.mttrHours),
              valueKind: stats.mttrHours === null ? "text" : "number",
              secondary: stats.mttrHours === null ? "Aún no hay reparaciones cerradas con su paso por taller" : `Promedio de ${plural(stats.repairClosed, "reparación cerrada", "reparaciones cerradas")}`,
              href: closedList,
            }
          : { key: "mttr", label: "Tiempo medio de reparación", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: closedList },
        stats
          ? {
              key: "ot-costo",
              label: "Mano de obra y taller (OT)",
              value: stats.cost === null ? "Sin dato" : formatCLP(stats.cost),
              valueKind: stats.cost === null ? "text" : "number",
              secondary: stats.cost === null ? "Las OT cerradas no traen costo cargado" : "OT cerradas del período, sin repuestos por OC",
              href: closedList,
            }
          : { key: "ot-costo", label: "Mano de obra y taller (OT)", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: closedList },
      ] satisfies SummaryStat[]}
    />
  )

  const excel = excelFor(common)
  const segments = (byStatus ?? []).map((item) => ({
    key: item.status,
    label: OT_STATUS_LABELS[item.status],
    value: item.count,
    color: OT_STATUS_COLOR[item.status],
    href: otHref({ estado: item.status }),
  }))
  const top = [...segments].sort((a, b) => b.value - a.value)[0]
  const spans = spansFor([
    { id: "state", visible: !!top && open !== null },
    { id: "flow", visible: !!series && series.some((point) => point.created + point.closed + point.backlog > 0) },
    { id: "mix", visible: !!series && series.some((point) => point.created > 0) },
  ])

  return (
    <DashboardSection
      id="ordenes-trabajo"
      title="Órdenes de trabajo"
      links={links}
      summary={summary}
      charts={
        <>
          {/* Los anchos salen de `spansFor`: con los gráficos que de verdad se pintan, la grilla de 2 y de 3
              columnas cierra sin celdas huérfanas (ver `lib/indicators/chart-layout.ts`). */}
          {top && open !== null && (
            <ChartSlot span={spans.state}>
              <ChartFrame
                title="OT abiertas hoy, por estado"
                description="Hoy · Fuente: órdenes de trabajo"
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(top.value)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>OT en «{top.label}», la etapa con más órdenes abiertas</ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy items={segments} ariaLabel="OT abiertas hoy por estado" unit=" OT" order="input" limit={8} />
                <ChartDataTable
                  caption="OT abiertas hoy, por estado"
                  headers={["Estado", "OT"]}
                  rows={segments.map((segment) => [segment.label, segment.value])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {series && (
            <ChartSlot span={spans.flow}>
              <WorkOrderFlowChart
                data={series.map((point) => ({ key: point.key, partial: point.partial, created: point.created, closed: point.closed, backlog: point.backlog }))}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
          {series && (
            <ChartSlot span={spans.mix}>
              <WorkOrderMixChart
                data={series.map((point) => ({ key: point.key, partial: point.partial, repairOnly: point.repairOnly, maintenanceOnly: point.maintenanceOnly, both: point.both }))}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
        </>
      }
    />
  )
}

// ── Sección 2: Pautas y disponibilidad ─────────────────────────────────────

/** Estados que se dibujan en la barra de hoy: la flota activa (los dados de baja no cuentan). */
const PAUTA_BAR_STATES = ["vencida", "proxima", "al_dia", "sin_lecturas", "sin_pauta"] as const satisfies readonly MantEquipmentState[]

const PAUTA_COLOR: Record<(typeof PAUTA_BAR_STATES)[number], string> = {
  vencida: CHART_COLORS.danger,
  proxima: CHART_COLORS.signal,
  al_dia: CHART_COLORS.brand,
  sin_lecturas: CHART_COLORS.neutral,
  sin_pauta: CHART_COLORS.slate,
}

export function PautasSection({
  pautas,
  records,
  outOfService,
  ranking,
  showRanking,
  ...common
}: Common & {
  pautas: PautaState | null
  records: RecordIndicators | null
  outOfService: OutOfServiceIndicators | null
  /** `null` = la consulta falló; sin `showRanking` ni se consulta. */
  ranking: RepairRankingRow[] | null
  /** Quien no ve OT no recibe el ranking (sale de las órdenes de trabajo). */
  showRanking: boolean
}) {
  const { worksiteId } = common
  const faena = worksiteId ?? undefined
  const noData =
    pautas !== null && records !== null && outOfService !== null &&
    pautas.total === 0 && records.points.every((point) => point.preventive + point.corrective === 0) &&
    outOfService.total === 0

  const links = [
    { label: "Panel de mantención", href: withParams("/mantencion/panel", { faena }) },
    { label: "Equipos", href: withParams("/mantencion/equipos", { faena }) },
    ...(showRanking ? [{ label: "Órdenes de trabajo", href: withParams("/mantencion/ot", { estado: "abiertas", faena }) }] : []),
  ]

  if (noData) {
    return (
      <DashboardSection
        id="pautas-disponibilidad"
        title="Pautas y disponibilidad"
        links={links}
        charts={
          <ChartSlot span="full">
            <EmptyState
              compact
              title="Aún no hay equipos con pauta en el módulo"
              description="Registra o importa los equipos y asígnales su pauta: con eso verás cuántos están al día, cuántos registros se firman y cuántos días pasan detenidos."
              action={<Link href="/mantencion/equipos" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ir a Equipos →</Link>}
            />
          </ChartSlot>
        }
      />
    )
  }

  const compliance = pautas ? pautaCompliance(pautas.counts) : null
  const equiposHref = (params: Record<string, string | null | undefined>) => withParams("/mantencion/equipos", { faena, ...params })
  const recordsHref = withParams("/mantencion/registros", {
    revision: "todos",
    estado: "vigente",
    tipo: "P",
    desde: common.from,
    hasta: common.to,
    faena,
  })
  const preventiveTrend = records ? percentChange(records.preventive, records.preventivePrevious) : null
  const daysTrend = outOfService ? percentChange(outOfService.total, outOfService.totalPrevious) : null
  const formatDays = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

  const summary = (
    <SummaryBar
      numerals="sans"
      stats={[
        pautas && compliance
          ? {
              key: "pauta-al-dia",
              label: "Equipos con la pauta al día",
              value: compliance.percent === null ? "Sin dato" : formatPercent(compliance.percent, 0),
              valueKind: compliance.percent === null ? "text" : "number",
              secondary: compliance.percent === null
                ? "Aún no hay equipos con pauta"
                : `${formatQty(compliance.onTime)} de ${plural(compliance.withSchedule, "equipo con pauta", "equipos con pauta")}${pautas.counts.sin_lecturas > 0 ? ` · ${pautas.counts.sin_lecturas} sin lecturas` : ""} · hoy`,
              tone: pautas.counts.vencida > 0 ? "signal" : undefined,
              href: pautas.counts.vencida > 0 ? equiposHref({ estado: "vencida" }) : equiposHref({}),
            }
          : { key: "pauta-al-dia", label: "Equipos con la pauta al día", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: equiposHref({}) },
        records
          ? {
              key: "registros-preventivos",
              label: "Registros preventivos del período",
              value: records.preventive,
              hint: trendHint(preventiveTrend),
              secondary: records.preventive === 0 ? "Ninguna mantención preventiva firmada en el período" : records.preventivePrevious > 0 ? `Período anterior: ${formatQty(records.preventivePrevious)}` : "Sin registros preventivos en el período anterior",
              href: recordsHref,
            }
          : { key: "registros-preventivos", label: "Registros preventivos del período", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: recordsHref },
        outOfService
          ? {
              key: "dias-fuera-servicio",
              label: "Días fuera de servicio",
              value: formatDays(outOfService.total),
              hint: trendHint(daysTrend),
              secondary: outOfService.total === 0 ? "Ningún equipo estuvo detenido en el período" : "Días-equipo en mantención o fuera de servicio",
              href: equiposHref({ taller: "1" }),
            }
          : { key: "dias-fuera-servicio", label: "Días fuera de servicio", value: "Sin dato", valueKind: "text", secondary: "No se pudo calcular", href: equiposHref({ taller: "1" }) },
      ] satisfies SummaryStat[]}
    />
  )

  const excel = excelFor(common)
  const barCounts = pautas ? PAUTA_BAR_STATES.map((state) => ({ state, count: pautas.counts[state] })) : []
  const barTotal = barCounts.reduce((sum, item) => sum + item.count, 0)
  const pautaSegments = barCounts.map((item) => ({
    key: item.state,
    label: EQUIPMENT_STATE_LABEL[item.state],
    value: item.count,
    color: PAUTA_COLOR[item.state],
    href: equiposHref({ estado: item.state }),
  }))
  const needAttention = pautas ? pautas.counts.vencida + pautas.counts.proxima : 0
  const rankingRows = showRanking && ranking ? ranking : []
  const rankingTop = rankingRows[0]
  // Con empate en la cima no hay un «equipo con más»: se dice cuántos empatan.
  const rankingLeaders = rankingTop ? rankingRows.filter((row) => row.count === rankingTop.count) : []
  const spans = spansFor([
    { id: "records", visible: !!records && records.points.some((point) => point.preventive + point.corrective > 0) },
    { id: "pautas", visible: !!pautas && barTotal > 0 },
    { id: "ranking", visible: !!rankingTop },
    { id: "days", visible: !!outOfService && outOfService.points.some((point) => point.days > 0) },
  ])

  return (
    <DashboardSection
      id="pautas-disponibilidad"
      title="Pautas y disponibilidad"
      links={links}
      summary={summary}
      charts={
        <>
          {records && (
            <ChartSlot span={spans.records}>
              <RecordsKindChart
                data={records.points}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
          {pautas && barTotal > 0 && (
            <ChartSlot span={spans.pautas}>
              <ChartFrame
                title="Estado de las pautas hoy"
                description="Hoy · Fuente: pautas y lecturas de los equipos activos"
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(needAttention)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      equipos con la mantención vencida ({formatQty(pautas.counts.vencida)}) o próxima ({formatQty(pautas.counts.proxima)})
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy items={pautaSegments} ariaLabel="Equipos por estado de pauta hoy" unit=" equipos" order="input" limit={8} />
                <ChartDataTable
                  caption="Estado de las pautas hoy"
                  headers={["Estado", "Equipos"]}
                  rows={pautaSegments.map((segment) => [segment.label, segment.value])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {rankingTop && (
            <ChartSlot span={spans.ranking}>
              <ChartFrame
                title="Equipos con más OT de reparación"
                description={`${common.scopeNote} · Fuente: órdenes de trabajo de reparación (sin anuladas); sólo equipos con 2 o más`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(rankingTop.count)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>
                      {rankingLeaders.length === 1
                        ? `OT de reparación en ${rankingTop.code}, el equipo con más en el período`
                        : `${rankingLeaders.length} equipos empatan con ${formatQty(rankingTop.count)} OT de reparación en el período`}
                    </ChartHeadlineCaption>
                  </>
                }
              >
                <BarRankingChartLazy
                  ariaLabel="Equipos con más órdenes de trabajo de reparación"
                  unit=" OT"
                  order="desc"
                  limit={8}
                  items={rankingRows.map((row) => ({
                    key: row.vehicleId,
                    label: row.code === row.plate ? row.plate : `${row.code} · ${row.plate}`,
                    value: row.count,
                    href: `/mantencion/equipos/${row.vehicleId}`,
                  }))}
                />
                <ChartDataTable
                  caption="Equipos con más OT de reparación"
                  headers={["Equipo", "Patente", "OT de reparación"]}
                  rows={rankingRows.map((row) => [row.code, row.plate, row.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {outOfService && (
            <ChartSlot span={spans.days}>
              <OutOfServiceChart
                data={outOfService.points}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
        </>
      }
    />
  )
}
