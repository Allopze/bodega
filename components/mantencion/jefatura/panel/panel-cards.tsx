import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { RankedList } from "@/components/ui/ranked-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EQUIPMENT_STATE_LABEL, formatHours, formatNumber, formatReading, plural, remainingText } from "@/lib/mantencion/format"
import type { MantEquipmentState } from "@/lib/mantencion/types"
import type { PanelData } from "@/lib/services/mantencion/panel"
import { PANEL_PERIOD_PHRASE, weekRangeLabel } from "@/lib/services/mantencion/panel-filters"
import { ChartDataTable } from "../shared/chart-data-table"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"
import { SectionCard } from "../shared/section-card"
import { WeeklyChart } from "./weekly-chart"

/** Estados que se dibujan en la flota. «Dado de baja» no cuenta: la flota del panel es la activa. */
const FLEET_STATES: MantEquipmentState[] = ["vencida", "proxima", "al_dia", "sin_lecturas", "sin_pauta"]

/** Color de la barra de cada estado: los mismos tokens que su etiqueta (D9). */
const BAR_COLOR: Record<MantEquipmentState, string> = {
  vencida: "var(--color-danger)",
  proxima: "var(--color-warning)",
  al_dia: "var(--color-success)",
  sin_lecturas: "var(--color-border-control)",
  sin_pauta: "var(--color-border-control)",
  baja: "var(--color-border-control)",
}

const worksiteParam = (data: PanelData) => (data.filters.worksiteId ? `&faena=${encodeURIComponent(data.filters.worksiteId)}` : "")

export function WeeklyCard({ data }: { data: PanelData }) {
  const worksite = data.filters.worksiteId ? "la faena elegida" : "todas las faenas"
  return (
    <SectionCard title="Registros por semana" description={`Últimas ${data.weeks.length} semanas · ${worksite}`}>
      <WeeklyChart data={data.weeks} />
      <ChartDataTable
        caption="Registros por semana"
        headers={["Semana", "Preventivas", "Correctivas"]}
        rows={data.weeks.map((week) => [weekRangeLabel(week.start), week.preventive, week.corrective])}
      />
    </SectionCard>
  )
}

/** Estado de la flota: una barra por estado; cada una lleva a Equipos ya filtrado. */
export function FleetCard({ data }: { data: PanelData }) {
  const { counts, active } = data.fleet
  const max = Math.max(1, ...FLEET_STATES.map((state) => counts[state]))
  return (
    <SectionCard title="Estado de la flota" description={`${plural(active, "equipo activo", "equipos activos")}, según su pauta y su última lectura`}>
      {active === 0 ? (
        <EmptyState
          compact
          title="Aún no hay equipos en el módulo"
          description="Agrega o importa los equipos para ver cuáles necesitan mantención."
          action={<Link href="/mantencion/equipos" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ir a Equipos →</Link>}
        />
      ) : (
        <ul aria-label="Equipos por estado de mantención" className="flex flex-col gap-0.5">
          {FLEET_STATES.map((state) => (
            <li key={state}>
              <Link
                href={`/mantencion/equipos?estado=${state}${worksiteParam(data)}`}
                className="group grid grid-cols-[7rem_1fr_2rem] items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                aria-label={`${EQUIPMENT_STATE_LABEL[state]}: ${plural(counts[state], "equipo", "equipos")}. Ver esos equipos`}
              >
                <span className="text-sm text-[var(--color-text)]">{EQUIPMENT_STATE_LABEL[state]}</span>
                <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <span className="block h-full rounded-full" style={{ width: `${(counts[state] / max) * 100}%`, backgroundColor: BAR_COLOR[state] }} />
                </span>
                <span className="text-right font-mono text-sm font-semibold tabular-nums">{counts[state]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

export function UpcomingCard({ data }: { data: PanelData }) {
  return (
    <SectionCard title="Próximas mantenciones" description="Los equipos más cerca de su próxima pauta, o que ya la pasaron">
      {data.upcoming.length === 0 ? (
        <EmptyState
          compact
          title="Todavía no hay mantenciones que calcular"
          description="Un equipo necesita una pauta asignada y una lectura para saber cuándo le toca."
          action={<Link href="/mantencion/equipos" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Revisar los equipos →</Link>}
        />
      ) : (
        <TableRoot aria-label="Próximas mantenciones">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Equipo</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Pauta</TableHead>
                <TableHead>Lectura</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.upcoming.map((row) => (
                <TableRow key={row.vehicleId}>
                  <TableCell className="whitespace-nowrap font-mono text-[13px]">
                    <Link href={`/mantencion/equipos/${row.vehicleId}`} className="font-semibold text-[var(--color-primary-ink)] hover:underline focus-visible:underline">{row.code}</Link>
                    {row.plate !== row.code && <div className="text-xs text-[var(--color-text-muted)]">{row.plate}</div>}
                  </TableCell>
                  <TableCell>{row.worksiteName}</TableCell>
                  <TableCell>{row.scheduleName ?? <span className="text-[var(--color-text-muted)]">Sin pauta</span>}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{row.reading != null ? formatReading(row.reading, row.unit) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.nextReading != null ? (
                      <>
                        <span className="font-mono text-[13px] tabular-nums">{formatReading(row.nextReading, row.unit)}</span>
                        <div className="text-xs text-[var(--color-text-muted)]">{remainingText({ remaining: row.remaining }, row.unit)}</div>
                      </>
                    ) : "—"}
                  </TableCell>
                  <TableCell><EquipmentStateBadge state={row.state} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </SectionCard>
  )
}

export function WorkshopCard({ data }: { data: PanelData }) {
  const { rows } = data.workshop
  return (
    <SectionCard title="En taller ahora" description="Correctivas con el equipo aún detenido">
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Ningún equipo en taller.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <li key={row.recordId}>
              <Link
                href={`/mantencion/registros/${row.recordId}`}
                className="flex items-start justify-between gap-3 rounded-md px-1 py-2.5 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
              >
                <span className="min-w-0 text-sm">
                  <strong className="font-mono text-[13px] font-semibold">{row.code}{row.plate !== row.code ? ` · ${row.plate}` : ""}</strong>
                  <span className="block truncate text-[var(--color-text-muted)]">{row.worksiteName} · {row.summary}</span>
                  {row.reason && <span className="block truncate text-[var(--color-text-muted)]">Sigue en taller: {row.reason}</span>}
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {row.daysStopped ? plural(row.daysStopped, "día", "días") : "desde hoy"}
                  {row.stale && <span className="block text-xs font-semibold text-[var(--color-danger-ink)]">Sin actualizar</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

export function HoursCard({ data }: { data: PanelData }) {
  const period = PANEL_PERIOD_PHRASE[data.filters.period]
  return (
    <SectionCard title="Horas de taller por faena" description={`Correctivas · ${period}`}>
      {data.hoursByWorksite.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Sin correctivas en el período.</p>
      ) : (
        <RankedList
          ariaLabel="Horas de taller por faena"
          format="count"
          unit=" h"
          showShare={false}
          items={data.hoursByWorksite.map((row) => ({
            key: row.worksiteId,
            label: row.worksiteName,
            value: row.hours,
            href: `/mantencion/registros?tipo=C&estado=vigente&faena=${encodeURIComponent(row.worksiteId)}${data.from ? `&desde=${data.from}` : ""}`,
          }))}
        />
      )}
      {data.hoursByWorksite.length > 0 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Total: {formatHours(data.records.hours)}</p>}
    </SectionCard>
  )
}

export function NotDoneCard({ data }: { data: PanelData }) {
  const period = PANEL_PERIOD_PHRASE[data.filters.period]
  return (
    <SectionCard title="Ítems que más quedan sin hacer" description={`Preventivas · ${period}`}>
      {data.notDone.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Todos los ítems se realizaron en el período.</p>
      ) : (
        <ol className="divide-y divide-[var(--color-border)]">
          {data.notDone.map((item) => (
            <li key={`${item.group}-${item.item}`} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-[var(--color-text)]">{item.item}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{item.group}{item.lastReason ? ` · último motivo: ${item.lastReason}` : ""}</span>
              </span>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                {formatNumber(item.count)}<span className="sr-only"> veces sin hacer</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}
