import Link from "next/link"
import { ClipboardText, ClockCountdown, Gauge, Money, Timer, Wrench, CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ShareBar, type ShareSegment } from "@/components/charts/share-bar"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { EmptyState } from "@/components/ui/empty-state"
import { ChartSlot, DASHBOARD_KPI } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
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

  const kpis = (
    <>
      <KpiCard
        {...DASHBOARD_KPI}
        icon={<Wrench size={16} />}
        label="OT abiertas"
        value={open === null ? "Sin dato" : open === 0 ? "Ninguna" : open}
        valueKind={open === null || open === 0 ? "text" : "number"}
        detail={open === null ? "No se pudo calcular" : open === 0 ? "Sin órdenes abiertas · hoy" : unassigned > 0 ? `${unassigned} por asignar · hoy` : "Todas con mecánico · hoy"}
        tone={unassigned > 0 ? "signal" : "neutral"}
        href={otHref({ estado: "abiertas" })}
      />
      {stats ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<CheckCircle size={16} />}
          label="OT cerradas en el período"
          value={stats.closed}
          detail={stats.closedPrevious > 0 ? `Período anterior: ${formatQty(stats.closedPrevious)}` : "Sin cierres en el período anterior"}
          trend={closedTrend}
          trendLabel={PERIOD_VS}
          trendPolarity="up-good"
          href={closedList}
          empty={stats.closed === 0 ? { message: "Ninguna OT se cerró en el período", actionLabel: "Ver órdenes cerradas" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<CheckCircle size={16} />} label="OT cerradas en el período" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={closedList} />
      )}
      {stats ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<Timer size={16} />}
          label="Tiempo medio de reparación"
          value={stats.mttrHours === null ? "Sin dato" : formatDuration(stats.mttrHours)}
          valueKind={stats.mttrHours === null ? "text" : "number"}
          detail={`Promedio de ${plural(stats.repairClosed, "reparación cerrada", "reparaciones cerradas")}, del ingreso a la salida del taller`}
          href={closedList}
          empty={stats.mttrHours === null ? { message: "Aún no hay reparaciones cerradas con su paso por taller", actionLabel: "Ver órdenes cerradas" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<Timer size={16} />} label="Tiempo medio de reparación" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={closedList} />
      )}
      {stats ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<Money size={16} />}
          label="Mano de obra y taller (OT)"
          value={stats.cost === null ? "Sin dato" : formatCLP(stats.cost)}
          valueKind={stats.cost === null ? "text" : "number"}
          detail="Costo cargado en las OT cerradas del período, sin repuestos comprados por OC"
          href={closedList}
          empty={stats.cost === null ? { message: "Las OT cerradas no traen costo cargado", actionLabel: "Ver órdenes cerradas" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<Money size={16} />} label="Mano de obra y taller (OT)" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={closedList} />
      )}
    </>
  )

  const excel = excelFor(common)
  const segments: ShareSegment[] = (byStatus ?? []).map((item) => ({
    key: item.status,
    label: OT_STATUS_LABELS[item.status],
    count: item.count,
    color: OT_STATUS_COLOR[item.status],
    href: otHref({ estado: item.status }),
  }))
  const top = [...segments].sort((a, b) => b.count - a.count)[0]

  return (
    <DashboardSection
      id="ordenes-trabajo"
      title="Órdenes de trabajo"
      links={links}
      kpis={kpis}
      charts={
        <>
          {/* La foto de hoy va primero y a lo ancho: así, con la serie y la mezcla debajo, la grilla
              de 2 y de 3 columnas cierra sin celdas huérfanas (ver `DashboardPanel`). */}
          {top && open !== null && (
            <ChartSlot span="full">
              <ChartFrame
                title="OT abiertas hoy, por estado"
                description="Hoy · Fuente: órdenes de trabajo"
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(top.count)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>OT en «{top.label}», la etapa con más órdenes de las {formatQty(open)} abiertas</ChartHeadlineCaption>
                  </>
                }
              >
                <ShareBar label="OT abiertas hoy por estado" segments={segments} />
                <ChartDataTable
                  caption="OT abiertas hoy, por estado"
                  headers={["Estado", "OT"]}
                  rows={segments.map((segment) => [segment.label, segment.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {series && (
            <ChartSlot span="wide">
              <WorkOrderFlowChart
                data={series.map((point) => ({ key: point.key, partial: point.partial, created: point.created, closed: point.closed, backlog: point.backlog }))}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
          {series && (
            <ChartSlot span="fillXl">
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

  const kpis = (
    <>
      {pautas && compliance ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<Gauge size={16} />}
          label="Equipos con la pauta al día"
          value={compliance.percent === null ? "Sin dato" : formatPercent(compliance.percent, 0)}
          valueKind={compliance.percent === null ? "text" : "number"}
          detail={`${formatQty(compliance.onTime)} de ${plural(compliance.withSchedule, "equipo con pauta", "equipos con pauta")}${pautas.counts.sin_lecturas > 0 ? ` · ${pautas.counts.sin_lecturas} sin lecturas` : ""} · hoy`}
          tone={pautas.counts.vencida > 0 ? "signal" : "neutral"}
          href={pautas.counts.vencida > 0 ? equiposHref({ estado: "vencida" }) : equiposHref({})}
          empty={compliance.percent === null ? { message: "Aún no hay equipos con pauta", actionLabel: "Ir a Equipos" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<Gauge size={16} />} label="Equipos con la pauta al día" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={equiposHref({})} />
      )}
      {records ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<ClipboardText size={16} />}
          label="Registros preventivos del período"
          value={records.preventive}
          detail={records.preventivePrevious > 0 ? `Período anterior: ${formatQty(records.preventivePrevious)}` : "Sin registros preventivos en el período anterior"}
          trend={preventiveTrend}
          trendLabel={PERIOD_VS}
          trendPolarity="up-good"
          href={recordsHref}
          empty={records.preventive === 0 ? { message: "Ninguna mantención preventiva firmada en el período", actionLabel: "Ver registros" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<ClipboardText size={16} />} label="Registros preventivos del período" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={recordsHref} />
      )}
      {outOfService ? (
        <KpiCard
          {...DASHBOARD_KPI}
          icon={<ClockCountdown size={16} />}
          label="Días fuera de servicio"
          value={formatDays(outOfService.total)}
          detail="Días-equipo en mantención o fuera de servicio, en el período"
          trend={daysTrend}
          trendLabel={PERIOD_VS}
          trendPolarity="up-bad"
          href={equiposHref({ taller: "1" })}
          empty={outOfService.total === 0 ? { message: "Ningún equipo estuvo detenido en el período" } : undefined}
        />
      ) : (
        <KpiCard {...DASHBOARD_KPI} icon={<ClockCountdown size={16} />} label="Días fuera de servicio" value="Sin dato" valueKind="text" detail="No se pudo calcular" href={equiposHref({ taller: "1" })} />
      )}
    </>
  )

  const excel = excelFor(common)
  const barCounts = pautas ? PAUTA_BAR_STATES.map((state) => ({ state, count: pautas.counts[state] })) : []
  const barTotal = barCounts.reduce((sum, item) => sum + item.count, 0)
  const pautaSegments: ShareSegment[] = barCounts.map((item) => ({
    key: item.state,
    label: EQUIPMENT_STATE_LABEL[item.state],
    count: item.count,
    color: PAUTA_COLOR[item.state],
    href: equiposHref({ estado: item.state }),
  }))
  const needAttention = pautas ? pautas.counts.vencida + pautas.counts.proxima : 0
  const rankingRows = showRanking && ranking ? ranking : []
  const rankingTop = rankingRows[0]

  return (
    <DashboardSection
      id="pautas-disponibilidad"
      title="Pautas y disponibilidad"
      links={links}
      kpis={kpis}
      charts={
        <>
          {records && (
            <ChartSlot span="wide">
              <RecordsKindChart
                data={records.points}
                granularity={common.granularity}
                scopeNote={common.scopeNote}
                excel={excel}
              />
            </ChartSlot>
          )}
          {pautas && barTotal > 0 && (
            <ChartSlot span={rankingTop ? "one" : "fillXl"}>
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
                <ShareBar label="Equipos por estado de pauta hoy" segments={pautaSegments} />
                <ChartDataTable
                  caption="Estado de las pautas hoy"
                  headers={["Estado", "Equipos"]}
                  rows={pautaSegments.map((segment) => [segment.label, segment.count])}
                  excel={excel}
                />
              </ChartFrame>
            </ChartSlot>
          )}
          {rankingTop && (
            <ChartSlot span="one">
              <ChartFrame
                title="Equipos con más OT de reparación"
                description={`${common.scopeNote} · Fuente: órdenes de trabajo de reparación (sin anuladas)`}
                headline={
                  <>
                    <ChartHeadlineValue>{formatQty(rankingTop.count)}</ChartHeadlineValue>
                    <ChartHeadlineCaption>OT de reparación en {rankingTop.code}, el equipo con más en el período</ChartHeadlineCaption>
                  </>
                }
              >
                <RankedList
                  ariaLabel="Equipos con más órdenes de trabajo de reparación"
                  format="count"
                  unit=" OT"
                  showShare={false}
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
            <ChartSlot span="wide">
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
