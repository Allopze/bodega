import Link from "next/link"
import { CalendarX, ClipboardText, Truck, Warning } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { formatHours, plural } from "@/lib/mantencion/format"
import type { PanelData } from "@/lib/services/mantencion/panel"
import { overdueDetail } from "@/lib/services/mantencion/panel-coverage"
import { PANEL_PERIOD_PHRASE } from "@/lib/services/mantencion/panel-filters"

/**
 * Los cuatro indicadores del panel (regla A1: máximo cuatro tarjetas sobre el
 * contenido, cada una accionable). Decisión del tope: de los cinco indicadores
 * que pide la especificación, «Horas hombre del período» baja a la tira
 * compacta de texto de abajo (`PanelStrip`) porque no abre ningún subconjunto
 * propio —sus correctivas ya son el destino de «Registros»— y el resto sí
 * cambia una decisión: dónde mirar primero.
 *
 * Cada tarjeta lleva a su subconjunto, no al total. Si no hay nada que ver, el
 * tile lo dice con palabras en vez de un «0» pelado.
 *
 * «0 vencidas» no puede leerse como «todo al día» cuando casi nadie tiene
 * lectura: el detalle dice entre cuántos equipos se pudo evaluar (`overdueDetail`).
 *
 * En teléfono son dos por fila (2×2) y no cuatro apilados: apilados se comían
 * ~540 px antes del primer contenido accionable.
 */
export function PanelKpis({ data }: { data: PanelData }) {
  const { records, fleet, workshop, stoppedDays, filters, from } = data
  const period = PANEL_PERIOD_PHRASE[filters.period]
  const worksite = filters.worksiteId ? `&faena=${encodeURIComponent(filters.worksiteId)}` : ""
  const since = from ? `&desde=${from}` : ""
  const overdue = fleet.counts.vencida

  return (
    <section
      aria-label="Indicadores"
      // En 2×2 cada tile mide ~175 px y el rótulo (`truncate` en KpiCard) quedaba en «Mantenciones ve…», sin el período. Bajo `sm` se
      // deja envolver y los tiles de una fila se igualan. Lo correcto sería que KpiCard envuelva su rótulo; mientras tanto, local y acotado.
      className="mb-4 grid grid-cols-2 gap-2 sm:mb-5 sm:gap-3 xl:grid-cols-4"
    >
      <KpiCard
        icon={<ClipboardText size={16} aria-hidden />}
        label={`Registros · ${period}`}
        value={String(records.total)}
        detail={`${plural(records.preventive, "preventiva", "preventivas")} · ${plural(records.corrective, "correctiva", "correctivas")}`}
        // Sin registros en el período, lo accionable es ampliar el período.
        href={records.total === 0 && filters.period !== "todo"
          ? `/mantencion/panel?periodo=todo${worksite}`
          : `/mantencion/registros?estado=vigente${since}${worksite}`}
        empty={records.total === 0
          ? { message: "Aún no hay registros en este período", actionLabel: filters.period === "todo" ? "Ir a Registros" : "Ver todo el historial" }
          : undefined}
      />
      <KpiCard
        icon={<Warning size={16} aria-hidden />}
        label="Mantenciones vencidas"
        value={String(overdue)}
        detail={overdueDetail(fleet.counts)}
        tone={overdue > 0 ? "danger" : "neutral"}
        href={`/mantencion/equipos?estado=vencida${worksite}`}
      />
      <KpiCard
        icon={<Truck size={16} aria-hidden />}
        label="Equipos en taller"
        value={String(workshop.equipment)}
        detail={workshop.equipment === 0
          ? "Ninguno detenido"
          : workshop.stale > 0 ? `${plural(workshop.stale, "sin actualizar", "sin actualizar")} hace más de 2 días` : "Todos con estado al día"}
        tone={workshop.stale > 0 ? "signal" : "neutral"}
        href={`/mantencion/registros?tipo=C&situacion=en_taller&estado=vigente${worksite}`}
      />
      <KpiCard
        icon={<CalendarX size={16} aria-hidden />}
        label={`Días fuera de servicio · ${period}`}
        value={String(stoppedDays.total)}
        detail={stoppedDays.total === 0 ? "Ningún equipo detenido" : `En ${plural(stoppedDays.equipment, "equipo", "equipos")}, de ingreso a salida`}
        href={`/mantencion/registros?tipo=C&situacion=paso_taller&estado=vigente${since}${worksite}`}
      />
    </section>
  )
}

/**
 * Tira de texto con las cifras que no necesitan tarjeta (A1): se leen de corrido.
 * «Por revisar» es la excepción útil: es el trabajo pendiente de la jefatura y
 * lleva directo a esos registros (los vigentes del período y la faena elegidos,
 * con la misma regla de la pestaña «Por revisar» de Registros).
 */
export function PanelStrip({ data }: { data: PanelData }) {
  const { records, fleet, filters, from } = data
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
        Equipos activos: <strong className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{fleet.active}</strong>
      </span>
    </p>
  )
}
