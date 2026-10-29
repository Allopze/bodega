import { CalendarX, ClipboardText, Truck, Warning } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { formatHours, plural } from "@/lib/mantencion/format"
import type { PanelData } from "@/lib/services/mantencion/panel"
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
 */
export function PanelKpis({ data }: { data: PanelData }) {
  const { records, fleet, workshop, stoppedDays, filters, from } = data
  const period = PANEL_PERIOD_PHRASE[filters.period]
  const worksite = filters.worksiteId ? `&faena=${encodeURIComponent(filters.worksiteId)}` : ""
  const since = from ? `&desde=${from}` : ""
  const overdue = fleet.counts.vencida
  const upcoming = fleet.counts.proxima

  return (
    <section aria-label="Indicadores" className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        detail={overdue === 0 ? "Todas las pautas al día" : `${plural(upcoming, "próxima a vencer", "próximas a vencer")}`}
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
 * Tira de texto con las cifras que no necesitan tarjeta (A1): se leen de corrido
 * y no abren nada por sí solas.
 */
export function PanelStrip({ data }: { data: PanelData }) {
  const { records, fleet, filters } = data
  return (
    <p className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y border-[var(--color-border)] py-2.5 text-sm text-[var(--color-text-muted)]">
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
