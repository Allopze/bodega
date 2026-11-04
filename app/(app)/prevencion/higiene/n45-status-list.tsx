import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { MONTH_NAMES, formatDate, pluralize } from "@/lib/utils"
import type { N45Model, N45Row, N45Status } from "./n45-status"

/**
 * Qué faenas tienen hecha la evaluación cuantitativa N°45 y cuáles no. Reemplaza al
 * calendario de cumplimiento (una celda exigible de doce por fila): ver `n45-status.ts`.
 *
 * Los rótulos son los de `ProgramSlotList` («Hecha», «Pendiente», «No hecha», «No aplica»):
 * la misma casilla no se llama distinto en la lista y en el panel de la faena.
 */

const BADGE: Record<N45Status, { label: string; variant: "success" | "warning" | "danger" | "outline" }> = {
  completed: { label: "Hecha", variant: "success" },
  pending: { label: "Pendiente", variant: "warning" },
  not_completed: { label: "No hecha", variant: "danger" },
  not_applicable: { label: "No aplica", variant: "outline" },
  none: { label: "Sin casilla", variant: "outline" },
}

function detail(row: N45Row): string | null {
  if (row.status === "completed") {
    if (!row.measuredOn) return null
    return `Medición del ${formatDate(row.measuredOn)}${row.groupCode ? ` · GES ${row.groupCode}` : ""}`
  }
  if (row.status === "pending" && row.scheduledMonth) return `Programada para ${MONTH_NAMES[row.scheduledMonth - 1]}`
  if (row.status === "none") return "Todavía no tiene la casilla; se genera al activar la faena en el programa"
  return null
}

export function N45StatusList({ model, year }: { model: N45Model; year: number }) {
  if (model.rows.length === 0) return null
  return (
    <section aria-labelledby="hygiene-n45-faenas-heading" className="space-y-2">
      <div>
        <h2 id="hygiene-n45-faenas-heading" className="text-sm font-semibold">Evaluación cuantitativa N°45 · {year}</h2>
        {model.due > 0 && (
          <p className="text-xs text-[var(--color-text-subtle)]">
            {model.done} de {model.due} {pluralize(model.due, "faena", "faenas")} con la evaluación hecha
          </p>
        )}
      </div>
      <ul
        aria-label="Evaluación cuantitativa N°45 por faena"
        className="divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)]"
      >
        {model.rows.map((row) => {
          const badge = BADGE[row.status]
          const text = detail(row)
          return (
            <li key={row.worksiteId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/prevencion/higiene?tab=protocols&faena=${encodeURIComponent(row.worksiteId)}&anio=${year}`}
                  replace
                  scroll={false}
                  className="text-sm font-medium hover:underline"
                >
                  {row.worksiteName}
                </Link>
                {text && <p className="text-xs text-[var(--color-text-subtle)]">{text}</p>}
              </div>
              <MetaBadge meta={badge} dot />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
