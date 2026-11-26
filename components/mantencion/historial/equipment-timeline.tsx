import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/mantencion/jefatura/shared/section-card"
import { ACTION_TYPE_LABELS } from "@/lib/mantencion/action-type"
import { formatHours, plural } from "@/lib/mantencion/format"
import { ACTION_TYPE_COLORS, HISTORY_SOURCE_LABELS, historyHref, parseHistoryParams } from "@/lib/mantencion/history-view"
import type { EquipmentTimeline, MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { formatDate, todayInChile } from "@/lib/utils"
import { ActionTypeBadge } from "./action-type-badge"
import { responsibleText, workshopText as sharedWorkshopText } from "./history-format"

/** Trabajos que caben en la hoja de vida del equipo; el resto se ve en el Historial de mantenciones. */
export const EQUIPMENT_TIMELINE_LIMIT = 10

/** Primera línea con texto del trabajo; «Sin descripción» si el trabajo no la informa. */
function firstLine(description: string): string {
  return description.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "Sin descripción"
}

/**
 * Mientras sigue en taller, lo mismo que la lista y la vista previa («3 días · sigue en taller», «En taller»).
 * Terminado: «3 días en taller»; nada si salió el mismo día (0) o el trabajo no informa el taller. «0 días en
 * taller» se repetía en casi todos los formularios y no decía nada; la cifra exacta sigue en la ficha del trabajo.
 */
function workshopText(row: MaintenanceHistoryRow): string | null {
  if (row.inWorkshop) return sharedWorkshopText(row)
  return row.workshopDays ? plural(row.workshopDays, "día en taller", "días en taller") : null
}

/** «Externo · {responsable}», «Externo» o «Interno»; `null` si el trabajo no lo informa. */
function executorText(row: MaintenanceHistoryRow): string | null {
  // El mismo texto que la lista y la vista previa; el trabajo que no lo informa no lo dice.
  const text = responsibleText(row)
  return text === "—" ? null : text
}

/** Los datos del trabajo que el equipo trae; sólo los que existen. */
function metaItems(row: MaintenanceHistoryRow): string[] {
  const items = [
    row.detail.reading ? `Lectura ${row.detail.reading}` : null,
    workshopText(row),
    row.laborHours !== null ? `${formatHours(row.laborHours)} hombre` : null,
    executorText(row),
  ]
  return items.filter((item): item is string => item !== null)
}

/** Del más reciente al más antiguo; el orden de empate lo fija quien llama (el sort es estable). */
function newestFirst(rows: readonly MaintenanceHistoryRow[]): MaintenanceHistoryRow[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date))
}

/** Agrupa filas ya ordenadas por año; cada año es un bloque contiguo. */
function groupByYear(rows: readonly MaintenanceHistoryRow[]): Array<{ year: string; rows: MaintenanceHistoryRow[] }> {
  const groups: Array<{ year: string; rows: MaintenanceHistoryRow[] }> = []
  for (const row of rows) {
    const year = row.date.slice(0, 4)
    const last = groups[groups.length - 1]
    if (last && last.year === year) last.rows.push(row)
    else groups.push({ year, rows: [row] })
  }
  return groups
}

function TimelineItem({ row }: { row: MaintenanceHistoryRow }) {
  const typeLabel = ACTION_TYPE_LABELS[row.actionType]
  const date = formatDate(row.date)
  const line = firstLine(row.detail.description)
  const hasDescription = line !== "Sin descripción"
  const meta = metaItems(row)
  return (
    <li className="relative">
      {/* El color es sólo un canal: la etiqueta del tipo va en texto, junto al punto. */}
      <span
        aria-hidden
        className="absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-2 ring-[var(--color-surface)]"
        style={{ backgroundColor: ACTION_TYPE_COLORS[row.actionType] }}
      />
      <Link
        href={row.detail.href}
        aria-label={`${typeLabel}, ${date}, ${HISTORY_SOURCE_LABELS[row.source]}: ${line}`}
        className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <ActionTypeBadge type={row.actionType} size="sm" />
          <time dateTime={row.date} className="text-xs text-[var(--color-text-muted)]">{date}</time>
          <Badge variant="outline" size="sm">{HISTORY_SOURCE_LABELS[row.source]}</Badge>
        </div>
        <p className={hasDescription ? "mt-1 line-clamp-2 text-sm text-[var(--color-text)]" : "mt-1 text-sm text-[var(--color-text-muted)]"}>
          {line}
        </p>
        {meta.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
            {meta.map((item, index) => <span key={index}>{item}</span>)}
          </div>
        )}
      </Link>
    </li>
  )
}

/**
 * «Historial de mantenciones» de la hoja de vida: los trabajos del equipo de cualquier fecha y de las tres
 * fuentes (formularios anteriores, órdenes de trabajo que entraron a taller y registros firmados), del más
 * reciente al más antiguo, agrupados por año. Cada trabajo enlaza a su ficha; el pie lleva al historial
 * completo filtrado por este equipo. `timeline` ya viene acotado por el alcance de quien mira.
 */
export function EquipmentTimelineCard({ timeline, vehicleId }: { timeline: EquipmentTimeline; vehicleId: string }) {
  const shown = newestFirst(timeline.rows).slice(0, EQUIPMENT_TIMELINE_LIMIT)
  const groups = groupByYear(shown)
  const fullHistoryHref = historyHref(parseHistoryParams({}, todayInChile()), { vehicleId, period: "todo", view: "historial" })
  // Sin cifra: la lista aplica el corte del Panel y la línea de tiempo no, y dos números distintos para lo mismo confunden.
  const linkLabel = "Ver todo el historial de este equipo"

  return (
    <SectionCard title="Historial de mantenciones" description={timeline.total > 0 ? "Del más reciente al más antiguo" : undefined}>
      {!timeline.includesOrders && (
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">Tu perfil no ve todas las órdenes de trabajo de este equipo.</p>
      )}
      {timeline.total === 0 ? (
        <EmptyState
          compact
          as="p"
          title="Este equipo aún no tiene trabajos en el historial"
          description="Aquí aparecen los formularios anteriores que se cargaron al historial, las órdenes de trabajo que entraron a taller y los registros firmados. Si esperabas verlos, puede que pertenezcan a una faena que tu perfil no alcanza."
        />
      ) : (
        <>
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.year}>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{group.year}</h3>
                <ol className="mt-2 flex flex-col gap-4 border-l border-[var(--color-border)] pl-5">
                  {group.rows.map((row) => <TimelineItem key={row.id} row={row} />)}
                </ol>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
            <p>Incluye formularios anteriores, órdenes de trabajo y registros firmados.</p>
            <Link
              href={fullHistoryHref}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0"
            >
              {linkLabel}
            </Link>
          </div>
        </>
      )}
    </SectionCard>
  )
}
