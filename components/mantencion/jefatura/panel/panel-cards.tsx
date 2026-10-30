import type { ReactNode } from "react"
import Link from "next/link"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { EmptyState } from "@/components/ui/empty-state"
import { RankedList } from "@/components/ui/ranked-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EQUIPMENT_STATE_LABEL, formatHours, formatNumber, formatReading, plural, remainingText } from "@/lib/mantencion/format"
import { cn } from "@/lib/utils"
import type { PanelData } from "@/lib/services/mantencion/panel"
import { fleetCoverage } from "@/lib/services/mantencion/panel-coverage"
import { PANEL_PERIOD_PHRASE, weekRangeLabel } from "@/lib/services/mantencion/panel-filters"
import { ChartDataTable } from "../shared/chart-data-table"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"
import { SectionCard } from "../shared/section-card"
import { WeeklyChart } from "./weekly-chart"

/**
 * Estados que se dibujan como barra: los únicos que el panel puede CALCULAR
 * (pauta y lectura). «Sin lecturas» y «Sin pauta» no son un estado de
 * mantención sino la falta del dato, y como barra gris eclipsaban a los demás
 * (112 de 119): van como aviso con enlace, más abajo. «Dado de baja» no cuenta:
 * la flota del panel es la activa.
 */
const FLEET_BAR_STATES = ["vencida", "proxima", "al_dia"] as const

/** Color de la barra de cada estado: los mismos tokens que su etiqueta (D9). */
const BAR_COLOR: Record<(typeof FLEET_BAR_STATES)[number], string> = {
  vencida: "var(--color-danger)",
  proxima: "var(--color-warning)",
  al_dia: "var(--color-success)",
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

/**
 * Estado de la flota: una barra por estado calculable, cada una con enlace a
 * Equipos ya filtrado, y un aviso sereno por cada grupo cuyo estado todavía se
 * desconoce (sin lecturas, sin pauta) con el camino para resolverlo.
 */
export function FleetCard({ data }: { data: PanelData }) {
  const { counts, active } = data.fleet
  const coverage = fleetCoverage(counts)
  const max = Math.max(1, ...FLEET_BAR_STATES.map((state) => counts[state]))
  const description = coverage.unknown > 0 && coverage.evaluable > 0
    ? `${coverage.evaluable} de ${plural(active, "equipo activo", "equipos activos")} tienen pauta y lectura para calcular su estado`
    : `${plural(active, "equipo activo", "equipos activos")}, según su pauta y su última lectura`
  return (
    <SectionCard title="Estado de la flota" description={description}>
      {active === 0 ? (
        <EmptyState
          compact
          title="Aún no hay equipos en el módulo"
          description="Agrega o importa los equipos para ver cuáles necesitan mantención."
          action={<Link href="/mantencion/equipos" className="text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">Ir a Equipos →</Link>}
        />
      ) : (
        <>
          <ul aria-label="Equipos por estado de mantención" className="flex flex-col gap-0.5">
            {FLEET_BAR_STATES.map((state) => (
              <li key={state}>
                <Link
                  href={`/mantencion/equipos?estado=${state}${worksiteParam(data)}`}
                  className="group grid min-h-11 grid-cols-[5.5rem_1fr_2rem] items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)] sm:min-h-9 sm:grid-cols-[7rem_1fr_2rem]"
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
          {coverage.unknown > 0 && (
            <ul
              aria-label="Equipos con el estado por conocer"
              className={cn("flex flex-col gap-3 text-sm text-[var(--color-text-muted)]", coverage.evaluable > 0 && "mt-3 border-t border-[var(--color-border)] pt-3")}
            >
              {coverage.withoutReadings > 0 && (
                <FleetNotice
                  href={`/mantencion/equipos?estado=sin_lecturas${worksiteParam(data)}`}
                  linkLabel={seeEquipmentLabel(coverage.withoutReadings, "sin lecturas")}
                >
                  {coverage.withoutReadings === 1
                    ? "1 equipo aún no tiene lecturas; su estado se conocerá con su primer registro de mantención."
                    : `${formatNumber(coverage.withoutReadings)} equipos aún no tienen lecturas; su estado se conocerá con el primer registro de mantención de cada uno.`}
                </FleetNotice>
              )}
              {coverage.withoutSchedule > 0 && (
                <FleetNotice
                  href={`/mantencion/equipos?estado=sin_pauta${worksiteParam(data)}`}
                  linkLabel={seeEquipmentLabel(coverage.withoutSchedule, "sin pauta")}
                >
                  {coverage.withoutSchedule === 1
                    ? "1 equipo no tiene pauta asignada, así que no se puede calcular cuándo le toca."
                    : `${formatNumber(coverage.withoutSchedule)} equipos no tienen pauta asignada, así que no se puede calcular cuándo les toca.`}
                </FleetNotice>
              )}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  )
}

/** «Ver el equipo sin lecturas» / «Ver los 112 equipos sin lecturas»: el enlace nombra el grupo al que lleva. */
function seeEquipmentLabel(count: number, suffix: string): string {
  return count === 1 ? `Ver el equipo ${suffix}` : `Ver los ${formatNumber(count)} equipos ${suffix}`
}

/**
 * Aviso de la flota: una frase serena y el enlace que lo resuelve. Sin caja ni
 * color de alerta: no es una falla, es un dato que todavía no existe.
 */
function FleetNotice({ href, linkLabel, children }: { href: string; linkLabel: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-info-ink)]" />
      <div className="min-w-0">
        <p>{children}</p>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline sm:min-h-8"
        >
          {linkLabel} →
        </Link>
      </div>
    </li>
  )
}

/**
 * Próximas mantenciones. Un equipo detenido en taller lo dice en su etiqueta de
 * estado («En taller · 15 días» antes que «Al día»): lo accionable no puede
 * quedar tapado por una pauta que parece en orden.
 *
 * Mismo contenido dos veces, como en el resto de la plataforma: en teléfono una
 * lista de filas (cada una un solo enlace de al menos 44 px; seis columnas no
 * caben en 358 px y la etiqueta de estado, la más importante, quedaba fuera de
 * pantalla) y desde `md` la tabla completa. Sólo una de las dos se ve a la vez.
 */
export function UpcomingCard({ data }: { data: PanelData }) {
  const workshopOf = (days: number | null) => (days != null ? { days } : null)
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
        <>
          <ul aria-label="Próximas mantenciones" className="-mt-1 divide-y divide-[var(--color-border)] md:hidden">
            {data.upcoming.map((row) => (
              <li key={row.vehicleId}>
                <Link
                  href={`/mantencion/equipos/${row.vehicleId}`}
                  className="block min-h-11 rounded-md py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm">
                      <strong className="whitespace-nowrap font-mono text-[13px] font-semibold text-[var(--color-primary-ink)]">{row.code}</strong>
                      {row.plate !== row.code && <span className="whitespace-nowrap font-mono text-xs text-[var(--color-text-muted)]"> · {row.plate}</span>}
                      <span className="block text-xs text-[var(--color-text-muted)]">{row.worksiteName} · {row.scheduleName ?? "Sin pauta"}</span>
                    </span>
                    {row.nextReading != null && (
                      <span className="shrink-0 whitespace-nowrap text-right">
                        <span className="font-mono text-[13px] tabular-nums text-[var(--color-text)]">{formatReading(row.nextReading, row.unit)}</span>
                        <span className="block text-xs text-[var(--color-text-muted)]">{remainingText({ remaining: row.remaining }, row.unit)}</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block"><EquipmentStateBadge state={row.state} workshop={workshopOf(row.workshopDays)} /></span>
                </Link>
              </li>
            ))}
          </ul>
          {/* La tabla sangra hasta el borde de la tarjeta y pierde su marco propio: dentro de una tarjeta, borde sobre borde era un doble marco. */}
          <TableRoot aria-label="Próximas mantenciones" className="-mx-5 hidden w-auto rounded-none border-0 md:block">
            <Table className="[&_tr>:first-child]:pl-5 [&_tr>:last-child]:pr-5">
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
                    <TableCell>
                      <EquipmentStateBadge state={row.state} workshop={workshopOf(row.workshopDays)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </>
      )}
    </SectionCard>
  )
}

/**
 * Correctivas con el equipo aún detenido. Los textos largos (faena y trabajo, y
 * el motivo de seguir en taller) se recortan a dos líneas, no a una con elipsis:
 * el texto completo sigue en el DOM para quien usa lector de pantalla y el
 * registro entero está a un clic. «Sin actualizar» va en tono señal, el mismo
 * de la tira de Registros (C4): pide una novedad, no es una falla.
 */
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
                className="flex min-h-11 items-start justify-between gap-3 rounded-md px-1 py-2.5 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
              >
                <span className="min-w-0 text-sm">
                  <strong className="font-mono text-[13px] font-semibold">{row.code}{row.plate !== row.code ? ` · ${row.plate}` : ""}</strong>
                  <span className="line-clamp-2 break-words text-[var(--color-text-muted)]">{row.worksiteName}{row.summary ? ` · ${row.summary}` : ""}</span>
                  {row.reason && <span className="line-clamp-2 break-words text-[var(--color-text-muted)]">Sigue en taller: {row.reason}</span>}
                </span>
                <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">
                  {row.daysStopped ? plural(row.daysStopped, "día", "días") : "desde hoy"}
                  {row.stale && <span className="block text-xs font-semibold text-[var(--color-signal-ink)]">Sin actualizar</span>}
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
