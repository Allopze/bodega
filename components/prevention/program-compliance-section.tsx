import { ChartSection } from "@/components/charts/chart-section"
import { ComplianceCalendar, type ComplianceRow } from "@/components/charts/compliance-calendar"
import {
  SLOT_CALENDAR_COLUMNS,
  slotCalendarDataTable,
  summarizeSlotCalendar,
  type SlotCalendar,
} from "@/lib/prevention/slot-compliance-calendar"
import { countOf } from "@/lib/utils"

/**
 * El calendario de cumplimiento de un programa anual de casillas (capacitación,
 * alcotest…): faenas × doce meses, la frase que lo resume y «Ver datos».
 *
 * Es un adaptador, no un componente de dominio: recibe el calendario ya
 * calculado (`buildSlotCalendar`) y sólo lo traduce al primitivo
 * `ComplianceCalendar` dentro de un `ChartSection`. Cada pantalla decide qué
 * filtra un clic (`hrefFor`); aquí se garantiza lo que debe ser igual en todas:
 * que un mes `na` no sea clicable, que la celda activa se marque y que volver a
 * hacerle clic quite el filtro (`clearHref`).
 *
 * Es server component: el calendario son enlaces, sin estado de cliente.
 */
export function ProgramComplianceSection({
  title,
  caption,
  calendar,
  noun,
  rowHeader = "Faena",
  hrefFor,
  clearHref,
  selected,
  empty,
  className,
}: {
  title: string
  /** Nombre accesible de la tabla. */
  caption: string
  calendar: SlotCalendar
  noun: { singular: string; plural: string }
  rowHeader?: string
  /** Adónde lleva el clic en el mes `month` de la fila `rowId`. */
  hrefFor: (rowId: string, month: number) => string
  /** Adónde lleva el clic en la celda ya activa: la misma vista sin ese filtro. */
  clearHref: string
  /** La celda que hoy filtra la lista de abajo, si hay una. */
  selected?: { rowId: string; month: number } | null
  /**
   * Qué mostrar si no hay ninguna casilla que dibujar (regla A4). Sin esto el
   * calendario simplemente no se pinta: úsalo cuando la pantalla ya explica el
   * vacío en otro lado y repetirlo sería ruido.
   */
  empty?: { label: string; hint?: string; ctaLabel?: string; ctaHref?: string }
  className?: string
}) {
  if (calendar.rows.length === 0) {
    return empty ? <ChartSection title={title} empty={empty} className={className} /> : null
  }

  const rows: ComplianceRow[] = calendar.rows.map((row) => ({
    id: row.id,
    label: row.label,
    cells: row.cells.map((cell) => {
      const isSelected = selected?.rowId === row.id && selected.month === cell.month
      return {
        status: cell.status,
        detail: cell.detail,
        selected: isSelected,
        // «No exigible» no filtra nada: no hay casillas que mostrar.
        href: cell.status === "na" ? undefined : isSelected ? clearHref : hrefFor(row.id, cell.month),
      }
    }),
  }))

  return (
    <ChartSection
      title={title}
      summary={summarizeSlotCalendar(calendar.rows, { noun })}
      data={{ caption: `${caption}: cifras por ${noun.singular}`, ...slotCalendarDataTable(calendar.rows, rowHeader) }}
      className={className}
    >
      <ComplianceCalendar
        caption={caption}
        rowHeader={rowHeader}
        columns={[...SLOT_CALENDAR_COLUMNS]}
        rows={rows}
        linkNavigation={{ scroll: false, replace: true }}
      />
      {calendar.unscheduled > 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {countOf(calendar.unscheduled, "actividad exigible", "actividades exigibles")} no {calendar.unscheduled === 1 ? "tiene" : "tienen"} mes programado y no {calendar.unscheduled === 1 ? "aparece" : "aparecen"} en el calendario.
        </p>
      )}
    </ChartSection>
  )
}
