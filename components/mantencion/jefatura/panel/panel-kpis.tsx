import Link from "next/link"
import { KpiCard } from "@/components/ui/kpi-card"
import { formatHours, formatNumber, plural } from "@/lib/mantencion/format"
import type { PanelData } from "@/lib/services/mantencion/panel"
import { fleetCoverage, overdueDetail, type FleetCoverage } from "@/lib/services/mantencion/panel-coverage"
import { PANEL_PERIOD_PHRASE } from "@/lib/services/mantencion/panel-filters"

/**
 * Los indicadores del panel (regla A1: máximo cuatro tarjetas sobre el contenido,
 * cada una accionable): «Órdenes por asignar» (lo primero que hace la jefatura),
 * «Mantenciones vencidas» y «Registros» del período. Antes eran cuatro, con
 * «Equipos en taller» y «Días fuera de servicio»; salieron por A5 (auditoría
 * 2026-11-13, M4): los equipos en taller son la lista «En taller ahora» (y la
 * cifra vive en el panel operacional), y los días fuera de servicio no abrían
 * ningún subconjunto propio, así que bajan a la tira de texto (`PanelStrip`).
 *
 * «Mantenciones vencidas» es la única cifra de vencidas del panel: la barra de la
 * flota ya no la repite.
 *
 * Cada tarjeta lleva a su subconjunto, no al total. Si no hay nada que ver, el
 * tile lo dice con palabras en vez de un «0» pelado.
 *
 * «0 vencidas» no puede leerse como «todo al día» cuando casi nadie tiene
 * lectura: el detalle dice entre cuántos equipos se pudo evaluar (`overdueDetail`).
 * Y si ninguno se puede evaluar, no hay cifra que mostrar: el tile pasa a su
 * estado vacío (A1) con la acción que lo resuelve en vez de un «0» pelado.
 *
 * `unassignedOrders` es `null` para quien no puede ver órdenes de trabajo: el
 * tile no se ofrece (un enlace a una pantalla prohibida no es una acción).
 */
export function PanelKpis({ data, unassignedOrders = null }: { data: PanelData; unassignedOrders?: number | null }) {
  const { records, fleet, filters, from } = data
  const period = PANEL_PERIOD_PHRASE[filters.period]
  const worksite = filters.worksiteId ? `&faena=${encodeURIComponent(filters.worksiteId)}` : ""
  const since = from ? `&desde=${from}` : ""
  const overdue = fleet.counts.vencida
  const coverage = fleetCoverage(fleet.counts)
  const overdueEmpty = coverage.evaluable === 0 ? overdueEmptyState(coverage, worksite) : null
  const tiles = unassignedOrders === null ? 2 : 3

  return (
    <section
      aria-label="Indicadores"
      // En 2×2 cada tile mide ~175 px y el rótulo (`truncate` en KpiCard) quedaba en «Mantenciones ve…», sin el período. Bajo `sm` se
      // deja envolver y los tiles de una fila se igualan. Lo correcto sería que KpiCard envuelva su rótulo; mientras tanto, local y acotado.
      className={`mb-4 grid grid-cols-2 gap-2 sm:mb-5 sm:gap-3 ${tiles === 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}
    >
      {unassignedOrders !== null && (
        <KpiCard
          icon={null}
          label="Órdenes por asignar"
          value={unassignedOrders === 0 ? "Ninguna" : unassignedOrders}
          valueKind={unassignedOrders === 0 ? "text" : "number"}
          detail={unassignedOrders === 0 ? "Todas las órdenes tienen mecánico" : "Esperan un mecánico para entrar a taller"}
          tone={unassignedOrders > 0 ? "signal" : "neutral"}
          href={`/mantencion/ot?estado=solicitada${worksite}`}
        />
      )}
      <KpiCard
        icon={null}
        label="Mantenciones vencidas"
        value={overdue}
        detail={overdueDetail(fleet.counts)}
        tone={overdue > 0 ? "danger" : "neutral"}
        // Sin equipos evaluables «vencida» está vacío por construcción: lo accionable es dejarlos evaluables.
        href={overdueEmpty ? overdueEmpty.href : `/mantencion/equipos?estado=vencida${worksite}`}
        empty={overdueEmpty ? { message: "Aún no hay equipos con pauta y lectura", actionLabel: overdueEmpty.actionLabel } : undefined}
      />
      <KpiCard
        icon={null}
        label={`Registros · ${period}`}
        value={records.total}
        detail={`${plural(records.preventive, "preventiva", "preventivas")} · ${plural(records.corrective, "correctiva", "correctivas")}`}
        // Sin registros en el período, lo accionable es ampliar el período.
        href={records.total === 0 && filters.period !== "todo"
          ? `/mantencion/panel?periodo=todo${worksite}`
          : `/mantencion/registros?revision=todos&estado=vigente${since}${worksite}`}
        empty={records.total === 0
          ? { message: "Aún no hay registros en este período", actionLabel: filters.period === "todo" ? "Ir a Registros firmados" : "Ver todo el historial" }
          : undefined}
      />
    </section>
  )
}

/**
 * Adónde lleva el tile de vencidas cuando ningún equipo se puede evaluar: primero
 * a quienes les falta la pauta (lo que sólo se resuelve asignándola), luego a
 * quienes les faltan lecturas, y sin equipos al listado para agregarlos.
 */
function overdueEmptyState(coverage: FleetCoverage, worksite: string): { href: string; actionLabel: string } {
  if (coverage.withoutSchedule > 0) return { href: `/mantencion/equipos?estado=sin_pauta${worksite}`, actionLabel: "Asignar pautas" }
  if (coverage.withoutReadings > 0) return { href: `/mantencion/equipos?estado=sin_lecturas${worksite}`, actionLabel: "Ver equipos sin lecturas" }
  return { href: `/mantencion/equipos${worksite ? `?${worksite.slice(1)}` : ""}`, actionLabel: "Ir a Equipos" }
}

/**
 * Tira de texto con las cifras que no necesitan tarjeta (A1): se leen de corrido.
 * «Por revisar» es la excepción útil: es el trabajo pendiente de la jefatura y
 * lleva directo a esos registros (los vigentes del período y la faena elegidos,
 * con la misma regla de la pestaña «Por revisar» de Registros).
 */
export function PanelStrip({ data }: { data: PanelData }) {
  const { records, fleet, stoppedDays, filters, from } = data
  const worksite = filters.worksiteId ? `&faena=${encodeURIComponent(filters.worksiteId)}` : ""
  const since = from ? `&desde=${from}` : ""
  return (
    <p className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y border-[var(--color-border)] py-1 text-sm text-[var(--color-text-muted)] sm:mb-5 sm:py-2.5">
      {records.pendingReview > 0 && (
        <Link
          href={`/mantencion/registros?revision=pendiente&estado=vigente${since}${worksite}`}
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline sm:min-h-0"
        >
          {plural(records.pendingReview, "registro por revisar", "registros por revisar")} · {PANEL_PERIOD_PHRASE[filters.period]}
          <span aria-hidden>→</span>
        </Link>
      )}
      <span>
        Horas hombre · {PANEL_PERIOD_PHRASE[filters.period]}:{" "}
        <strong className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{formatHours(records.hours)}</strong>
        {" "}en {plural(records.corrective, "correctiva", "correctivas")}
      </span>
      <span>
        Días fuera de servicio · {PANEL_PERIOD_PHRASE[filters.period]}:{" "}
        <strong className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{formatNumber(stoppedDays.total)}</strong>
        {stoppedDays.total > 0 && <> en {plural(stoppedDays.equipment, "equipo", "equipos")}</>}
      </span>
      <span>
        Equipos activos: <strong className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{fleet.active}</strong>
      </span>
    </p>
  )
}
