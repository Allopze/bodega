import { formatLeadDays, stageFill } from "@/components/charts/stage-duration-bar"
import {
  buildItemLeadTimeView,
  itemStageHeadline,
  type ItemOutcome,
  type ItemStage,
} from "@/lib/services/analytics-module/lead-time-item-stages"
import type { ItemLeadTime } from "@/lib/services/analytics-module/lead-time-item"
import { dayToPlainDate } from "@/lib/services/analytics-module/lead-time-shape"
import { formatDate } from "@/lib/utils"

/**
 * CHART-029, vista por ítem · ¿Dónde se atascó lo que pedí? Los días de cada tramo del ciclo
 * solicitud → aprobación → OC → llegada → entrega de **este** ítem, con las mismas fechas que cuenta
 * Analítica (`getItemLeadTime` comparte los hitos con `getSupplyLeadTime`).
 *
 * Reglas que sostiene la tarjeta:
 *  - **La respuesta antes que el dibujo:** una frase que dice dónde está el ítem y cuál tramo se
 *    demoró, armada de las mismas cifras que las barras (`itemStageHeadline`).
 *  - **El color nunca carga solo el significado:** cada tramo dice su estado con palabras (en curso, aún
 *    no llega, no ocurrió) y el más lento lleva su etiqueta «Más lento».
 *  - **Lo que no se midió no se inventa:** un tramo sin fecha o con fechas al revés dice eso, no una
 *    duración.
 *
 * Server-safe: sin hooks; las barras son CSS.
 */

const DAYS_ARE_CALENDAR = "Los días son corridos. Se miden con el primer hito de cada tramo: la primera aprobación, la primera OC emitida, la primera recepción y la primera entrega; las posteriores no cuentan."

function dateRange(stage: ItemStage): string {
  const from = stage.fromDay === null ? null : formatDate(dayToPlainDate(stage.fromDay))
  const to = stage.toDay === null ? null : formatDate(dayToPlainDate(stage.toDay))
  switch (stage.state) {
    case "done": return `${from} → ${to}`
    case "current": return `Desde ${from} · en curso`
    case "pending": return "Aún no llega a este tramo"
    case "skipped": return "No ocurrió en este ítem"
    case "no_date": return "Falta una fecha para medirlo"
    case "out_of_order": return `Fechas fuera de orden: ${from} → ${to}`
  }
}

const TOTAL_LABEL: Record<ItemOutcome, string> = {
  closed: "Plazo total (solicitud → cierre)",
  open: "Plazo hasta hoy (solicitud → hoy)",
  stopped: "",
}

export function ItemLeadTimeCard({ leadTime, todayDay }: {
  /** `null` cuando la consulta falló: se dice, no se omite en silencio. */
  leadTime: ItemLeadTime | null
  /** Hoy en día civil de Chile desde 1970 (`plainDateToDay(todayInChile())`). */
  todayDay: number
}) {
  const shell = "rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6"

  if (!leadTime) {
    return (
      <section aria-labelledby="item-lead-time-title" className={shell}>
        <h2 id="item-lead-time-title" className="text-h2 text-[var(--color-text)]">Plazos por etapa</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">No se pudieron calcular los plazos de este ítem. Recarga la página o vuelve a intentarlo en unos minutos.</p>
      </section>
    )
  }

  const view = buildItemLeadTimeView(leadTime.milestones, leadTime.status, todayDay)
  const measured = view.stages.filter((stage) => stage.days !== null)
  const scale = Math.max(1, ...measured.map((stage) => stage.days ?? 0))
  const done = view.stages.filter((stage) => stage.state === "done")
  const longest = Math.max(0, ...done.map((stage) => stage.days ?? 0))
  // «Más lento» sólo cuando distingue algo: con un solo tramo medido, o con todos iguales, no hay un más lento.
  const markSlowest = done.length > 1 && done.some((stage) => (stage.days ?? 0) < longest)

  return (
    <section aria-labelledby="item-lead-time-title" className={shell}>
      <h2 id="item-lead-time-title" className="text-h2 text-[var(--color-text)]">Plazos por etapa</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)] text-pretty">{itemStageHeadline(view, formatLeadDays)}</p>

      <ol aria-label="Días por etapa del ítem" className="mt-4 grid gap-3">
        {view.stages.map((stage, index) => {
          const isSlowest = markSlowest && stage.state === "done" && stage.days === longest
          const pct = stage.days === null ? 0 : stage.days === 0 ? 0 : Math.max(2, (stage.days / scale) * 100)
          return (
            <li
              key={stage.key}
              data-stage={stage.key}
              data-state={stage.state}
              className="grid gap-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,9rem)] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-[var(--color-text)]">{stage.label}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{dateRange(stage)}</span>
              </div>
              <div aria-hidden className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border)]">
                {pct > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: stageFill(index, view.stages.length), opacity: stage.state === "current" ? 0.7 : 1 }}
                  />
                )}
              </div>
              <div className="text-sm tabular-nums text-[var(--color-text)] sm:text-right">
                {stage.days === null ? (
                  <span className="text-[var(--color-text-muted)]">—</span>
                ) : (
                  <span className="font-semibold">{formatLeadDays(stage.days)}</span>
                )}
                {stage.state === "current" && <span className="ml-1.5 text-xs font-normal text-[var(--color-text-muted)]">en curso</span>}
                {isSlowest && <span className="ml-1.5 text-xs font-semibold text-[var(--color-warning-ink)]">Más lento</span>}
              </div>
            </li>
          )
        })}
      </ol>

      {view.totalDays !== null && view.outcome !== "stopped" && (
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text)]">
          <span className="text-[var(--color-text-muted)]">{TOTAL_LABEL[view.outcome]}: </span>
          <span className="font-semibold tabular-nums">{formatLeadDays(view.totalDays)}</span>
        </p>
      )}
      <p className="mt-2 text-xs text-[var(--color-text-muted)] text-pretty">{DAYS_ARE_CALENDAR}</p>
    </section>
  )
}
