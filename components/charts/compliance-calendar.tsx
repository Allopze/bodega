import Link from "next/link"
import { Check, CircleHalf, Clock, Minus, X } from "@phosphor-icons/react/dist/ssr"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Calendario de cumplimiento: filas (personas, equipos, faenas) × columnas
 * (meses, semanas, días), cada celda con su estado: cumplido (success),
 * parcial (warning), vencido sin cumplir (danger), pendiente futuro (neutro) y
 * no exigible (atenuado), como pide CHART-008.
 *
 * Responde «¿quién está al día y quién no, y desde cuándo?» de un vistazo, que
 * es la pregunta de capacitaciones, alcotest, inspecciones o entregas
 * periódicas. Una tabla de fechas obliga a leer fila por fila; aquí las filas
 * rojas y los huecos saltan solos.
 *
 * Es una `<table>` de verdad —encabezados de fila y de columna con `scope`—,
 * así que el lector de pantalla anuncia «Juan Pérez, marzo: vencido». Cada
 * estado tiene **ícono + color + texto oculto**: nunca sólo color. El
 * contenedor con desbordamiento horizontal es foco de teclado (WCAG 2.1.1) y
 * la primera columna queda fija al desplazarse.
 */
export type ComplianceStatus = "ok" | "partial" | "missing" | "upcoming" | "na"

export interface ComplianceCell {
  status: ComplianceStatus
  /** Texto del tooltip y del lector de pantalla además del estado («vence 12-03»). */
  detail?: string
  href?: string
  /** La celda que hoy filtra la lista de abajo: se marca con un aro y `aria-current`. */
  selected?: boolean
}

export interface ComplianceRow {
  id: string
  label: ReactNode
  /** Texto plano de la fila para el lector de pantalla cuando `label` no es texto. */
  labelText?: string
  cells: ComplianceCell[]
}

export const COMPLIANCE_STATUS_LABEL: Record<ComplianceStatus, string> = {
  ok: "Cumplido",
  partial: "Parcial",
  missing: "Vencido sin cumplir",
  upcoming: "Pendiente",
  na: "No exigible",
}

const STATUS_STYLE: Record<ComplianceStatus, string> = {
  ok: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  partial: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
  missing: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
  upcoming: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] ring-1 ring-inset ring-[var(--color-border)]",
  na: "bg-transparent text-[var(--color-text-faint)]",
}

/** La celda activa como filtro: un aro del color primario, que sobrevive a los tintes de estado. */
const SELECTED_STYLE = "ring-2 ring-[var(--color-primary)] hover:ring-2 hover:ring-[var(--color-primary)]"

const STATUS_ICON: Record<ComplianceStatus, typeof Check> = {
  ok: Check,
  partial: CircleHalf,
  missing: X,
  upcoming: Clock,
  na: Minus,
}

export function ComplianceCalendar({
  caption,
  columns,
  rows,
  rowHeader = "Nombre",
  legend = ["ok", "partial", "missing", "upcoming", "na"],
  statusLabels,
  linkNavigation,
  className,
}: {
  /** Nombre accesible de la tabla. Visible sólo para lectores de pantalla. */
  caption: string
  /** Rótulo de cada columna («Ene», «S12», «15»). */
  columns: Array<{ key: string; label: string; title?: string }>
  rows: ComplianceRow[]
  rowHeader?: string
  legend?: ComplianceStatus[]
  /**
   * Rótulos propios de los estados, para cuando «Cumplido» o «Vencido sin
   * cumplir» no son el vocabulario de la pantalla (cobertura de datos:
   * «Completo», «Sin datos», «En curso»). Los que no se pasan conservan el de
   * `COMPLIANCE_STATUS_LABEL`. Rigen para el texto de cada celda y la leyenda.
   */
  statusLabels?: Partial<Record<ComplianceStatus, string>>
  /**
   * Cómo navegan los enlaces de celda. Cuando la celda sólo cambia el filtro de
   * la misma pantalla, pasa `{ scroll: false, replace: true }` (patrón de
   * navegación de AGENTS.md: el filtro es estado de la vista, no una página
   * nueva). Sin esto los enlaces usan el comportamiento por defecto de `Link`.
   */
  linkNavigation?: { scroll?: boolean; replace?: boolean }
  className?: string
}) {
  const labelOf = (status: ComplianceStatus) => statusLabels?.[status] ?? COMPLIANCE_STATUS_LABEL[status]
  const counts = new Map<ComplianceStatus, number>()
  for (const row of rows) for (const cell of row.cells) counts.set(cell.status, (counts.get(cell.status) ?? 0) + 1)

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="overflow-x-auto rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <table className="w-max min-w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-[var(--color-surface)] pr-3 text-left font-semibold text-[var(--color-text-muted)]">
                {rowHeader}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" title={column.title} className="min-w-8 px-0.5 text-center font-medium text-[var(--color-text-muted)]">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="sticky left-0 z-10 max-w-56 truncate bg-[var(--color-surface)] py-0.5 pr-3 text-left font-normal text-[var(--color-text)]">
                  {row.label}
                </th>
                {row.cells.map((cell, index) => {
                  const Icon = STATUS_ICON[cell.status]
                  const column = columns[index]
                  const text = `${labelOf(cell.status)}${cell.detail ? `, ${cell.detail}` : ""}`
                  const glyph = (
                    <>
                      <Icon className="size-3.5" weight="bold" aria-hidden />
                      <span className="sr-only">{text}</span>
                    </>
                  )
                  return (
                    <td key={column?.key ?? index} className="p-0">
                      {cell.href && cell.status !== "na" ? (
                        <Link
                          href={cell.href}
                          title={text}
                          scroll={linkNavigation?.scroll}
                          replace={linkNavigation?.replace}
                          aria-current={cell.selected ? "true" : undefined}
                          className={cn("flex size-8 items-center justify-center rounded-[var(--radius-sm)] hover:ring-1 hover:ring-[var(--color-border-control)] focus-visible:outline-2 focus-visible:outline-offset-1", STATUS_STYLE[cell.status], cell.selected && SELECTED_STYLE)}
                        >
                          {glyph}
                        </Link>
                      ) : (
                        <span title={text} aria-current={cell.selected ? "true" : undefined} className={cn("flex size-8 items-center justify-center rounded-[var(--radius-sm)]", STATUS_STYLE[cell.status], cell.selected && SELECTED_STYLE)}>
                          {glyph}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]" aria-label="Leyenda">
        {legend.map((status) => {
          const Icon = STATUS_ICON[status]
          return (
            <li key={status} className="inline-flex items-center gap-1.5">
              <span className={cn("flex size-4 items-center justify-center rounded-[var(--radius-sm)]", STATUS_STYLE[status])}>
                <Icon className="size-3" weight="bold" aria-hidden />
              </span>
              {labelOf(status)}
              {counts.get(status) ? <span className="tabular-nums text-[var(--color-text)]">{counts.get(status)}</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
