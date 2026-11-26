import Link from "next/link"
import { Fragment } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { bucketLabel } from "@/lib/indicators/period"
import { ACTION_TYPE_LABELS, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { formatNumber, plural } from "@/lib/mantencion/format"
import {
  ACTION_TYPE_COLORS,
  MATRIX_MAX_ROWS,
  historyHref,
  matrixCellKind,
  monthRange,
  type HistoryParams,
  type MatrixCell,
  type MatrixCellKind,
  type MatrixRow,
  type WorkMatrix,
} from "@/lib/mantencion/history-view"
import { cn } from "@/lib/utils"

/**
 * La matriz «equipos × meses» del Historial: cuántos trabajos tuvo cada equipo en cada mes, y de qué tipo.
 * Es una vista del mismo `WorkMatrix` que calcula `buildWorkMatrix`, sin estado: cada celda con trabajo es un
 * enlace a la lista de ese equipo en ese mes.
 *
 * No es el calendario de cumplimiento (`components/charts/compliance-calendar.tsx`): aquí la celda cuenta trabajos y
 * dice su tipo, no un estado de cumplimiento. El tipo se lee por tres canales a la vez: el tono del fondo, una letra
 * junto al número (C, P, Pd, ?, M) y el texto del `aria-label` con el desglose. Una celda con varios tipos («mixta»)
 * no toma el color de ninguno: fondo neutro con borde punteado.
 *
 * Es una `<table>` real, con encabezados de columna y de fila (`scope`) y una fila de faena por grupo. La primera
 * columna queda fija y la tabla tiene su propio desplazamiento horizontal: en 390 px la página no se desborda.
 */

const CAPTION = "Trabajos por equipo y mes"

/** Orden fijo del desglose y de la leyenda: las correctivas primero, que es lo que Mantención mira. */
const KINDS: readonly ActionTypeOrUnknown[] = ["correctiva", "preventiva", "predictiva", "sin_clasificar"]

/** La letra que acompaña al conteo: el color nunca es el único canal. */
const MARK: Record<MatrixCellKind, string> = {
  correctiva: "C",
  preventiva: "P",
  predictiva: "Pd",
  sin_clasificar: "?",
  mixta: "M",
}

const NOUNS: Record<ActionTypeOrUnknown, { one: string; many: string }> = {
  correctiva: { one: "correctiva", many: "correctivas" },
  preventiva: { one: "preventiva", many: "preventivas" },
  predictiva: { one: "predictiva", many: "predictivas" },
  sin_clasificar: { one: "sin clasificar", many: "sin clasificar" },
}

const LEGEND: ReadonlyArray<{ kind: MatrixCellKind; label: string }> = [
  ...KINDS.map((kind) => ({ kind, label: ACTION_TYPE_LABELS[kind] })),
  { kind: "mixta", label: "Varios tipos" },
]

/** Desglose de una celda para el lector de pantalla y el tooltip: «3 trabajos: 2 correctivas, 1 preventiva». */
export function cellBreakdown(cell: MatrixCell): string {
  const parts = KINDS.filter((kind) => cell[kind] > 0).map((kind) => plural(cell[kind], NOUNS[kind].one, NOUNS[kind].many))
  return `${plural(cell.total, "trabajo", "trabajos")}: ${parts.join(", ")}`
}

/**
 * Fondo de una celda. Un tipo: su color de serie mezclado con la superficie, de 12 % a 32 % según cuántos trabajos
 * tiene frente al mes más cargado (`maxCell`). Mixta: neutro, sin color de tipo. Es `color-mix` con tokens, no hex.
 */
export function cellSurface(kind: MatrixCellKind, total: number, maxCell: number): string {
  if (kind === "mixta") return "var(--color-surface-2)"
  const share = maxCell > 0 ? Math.min(total / maxCell, 1) : 0
  return `color-mix(in oklab, ${ACTION_TYPE_COLORS[kind]} ${Math.round(12 + 20 * share)}%, var(--color-surface))`
}

interface FaenaGroup {
  /** Clave de React: separa la faena que se llama «Sin faena» del grupo sin faena. */
  key: string
  label: string
  rows: MatrixRow[]
}

/** Agrupa las filas (ya ordenadas por la matriz) por faena. «Sin faena» va al final. */
function groupByFaena(rows: readonly MatrixRow[]): FaenaGroup[] {
  const named = new Map<string, FaenaGroup>()
  const unassigned: MatrixRow[] = []
  for (const row of rows) {
    if (!row.worksiteName) {
      unassigned.push(row)
      continue
    }
    const group = named.get(row.worksiteName) ?? { key: `faena:${row.worksiteName}`, label: row.worksiteName, rows: [] }
    group.rows.push(row)
    named.set(row.worksiteName, group)
  }
  const groups = [...named.values()]
  if (unassigned.length > 0) groups.push({ key: "sin-faena", label: "Sin faena", rows: unassigned })
  return groups
}

function tileClass(kind: MatrixCellKind) {
  return kind === "mixta" ? "border border-dashed border-[var(--color-text-muted)]" : null
}

export function WorkMatrixView({ matrix, params }: { matrix: WorkMatrix; params: HistoryParams }) {
  const empty = matrix.rows.length === 0
  return (
    <div className="space-y-3">
      {empty ? (
        <EmptyState
          title="No hay trabajos en estos meses"
          description={params.period === "todo"
            ? "No hay trabajos de equipos identificados con estos filtros. Quita alguno (faena, origen, tipo) para verlos."
            : "No hay trabajos de equipos identificados entre estas fechas. Amplía el período o quita algún filtro (faena, origen, tipo) para verlos."}
          action={params.period === "todo" ? undefined : (
            <Button asChild variant="secondary">
              <Link href={historyHref(params, { period: "todo" })} scroll={false}>Ver todo el historial</Link>
            </Button>
          )}
        />
      ) : (
        <>
          <MatrixLegend />
          {matrix.hiddenRows > 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              {`Se muestran los ${MATRIX_MAX_ROWS} equipos con más correctivas; hay ${plural(matrix.hiddenRows, "equipo más", "equipos más")}. Filtra por faena para verlos.`}
            </p>
          ) : null}
        </>
      )}
      {matrix.withoutEquipment > 0 ? <WithoutEquipmentNotice count={matrix.withoutEquipment} params={params} /> : null}
      {empty ? null : <MatrixTable matrix={matrix} params={params} />}
    </div>
  )
}

function MatrixLegend() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <ul aria-label="Leyenda de tipos" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-muted)]">
        {LEGEND.map(({ kind, label }) => (
          <li key={kind} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-sm)] px-1 text-2xs font-semibold text-[var(--color-text)]", tileClass(kind))}
              style={{ backgroundColor: cellSurface(kind, 1, 1) }}
            >
              {MARK[kind]}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--color-text-muted)]">Cada celda cuenta los trabajos del equipo en el mes. Toca una celda para ver sus trabajos.</p>
    </div>
  )
}

function WithoutEquipmentNotice({ count, params }: { count: number; params: HistoryParams }) {
  const sentence = count === 1
    ? "1 trabajo sin equipo identificado no aparece aquí; se resuelve en "
    : `${formatNumber(count)} trabajos sin equipo identificado no aparecen aquí; se resuelven en `
  return (
    <p className="text-xs text-[var(--color-text-muted)]">
      {sentence}“<Link href={historyHref(params, { view: "formularios" })} scroll={false} className="font-medium text-[var(--color-text)] underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1">Respuestas de formularios</Link>”.
    </p>
  )
}

function MatrixTable({ matrix, params }: { matrix: WorkMatrix; params: HistoryParams }) {
  const groups = groupByFaena(matrix.rows)
  // Columna del equipo + meses + total.
  const span = matrix.months.length + 2
  return (
    <div
      role="region"
      aria-label={CAPTION}
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-max min-w-full border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">{CAPTION}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-40 bg-[var(--color-surface)] pr-3 text-left font-semibold text-[var(--color-text-muted)]">
              Equipo
            </th>
            {matrix.months.map((month) => (
              <th key={month} scope="col" className="min-w-16 px-1 text-center font-medium whitespace-nowrap text-[var(--color-text-muted)]">
                {bucketLabel(month, "month")}
              </th>
            ))}
            <th scope="col" className="min-w-24 px-1 text-left font-semibold whitespace-nowrap text-[var(--color-text-muted)]">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <tr>
                <th scope="rowgroup" colSpan={span} className="sticky left-0 bg-[var(--color-surface-2)] px-2 py-1 text-left font-semibold text-[var(--color-text)]">
                  {group.label}
                </th>
              </tr>
              {group.rows.map((row) => (
                <MatrixRowCells key={row.vehicleId} row={row} matrix={matrix} params={params} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatrixRowCells({ row, matrix, params }: { row: MatrixRow; matrix: WorkMatrix; params: HistoryParams }) {
  const equipmentHref = historyHref(params, { view: "historial", vehicleId: row.vehicleId })
  const totalText = `${row.label}, total: ${plural(row.total, "trabajo", "trabajos")}, ${plural(row.correctives, "correctiva", "correctivas")}`
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-[var(--color-surface)] pr-3 text-left font-normal text-[var(--color-text)]">
        <Link
          href={equipmentHref}
          scroll={false}
          title={row.label}
          className="flex h-10 max-w-48 items-center rounded-[var(--radius-sm)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <span className="truncate">{row.label}</span>
        </Link>
      </th>
      {matrix.months.map((month) => {
        const cell: MatrixCell | undefined = row.cells[month]
        return (
          <td key={month} className="p-0 text-center">
            {cell ? (
              <CountLink row={row} month={month} cell={cell} params={params} maxCell={matrix.maxCell} />
            ) : (
              <span className="flex h-10 items-center justify-center text-[var(--color-text-faint)]">
                <span aria-hidden>·</span>
                <span className="sr-only">Sin trabajos</span>
              </span>
            )}
          </td>
        )
      })}
      <td className="p-0">
        <Link
          href={equipmentHref}
          scroll={false}
          aria-label={totalText}
          title={totalText}
          className="flex h-10 flex-col justify-center rounded-[var(--radius-sm)] px-1 hover:ring-1 hover:ring-[var(--color-border-control)] focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <span className="font-semibold tabular-nums text-[var(--color-text)]">{row.total}</span>
          <span className="text-2xs text-[var(--color-text-muted)]">{plural(row.correctives, "correctiva", "correctivas")}</span>
        </Link>
      </td>
    </tr>
  )
}

function CountLink({ row, month, cell, params, maxCell }: { row: MatrixRow; month: string; cell: MatrixCell; params: HistoryParams; maxCell: number }) {
  const kind = matrixCellKind(cell)
  const { from, to } = monthRange(month)
  const href = historyHref(params, { view: "historial", vehicleId: row.vehicleId, period: "personalizado", from, to, type: null, page: 1 })
  const text = `${row.label}, ${bucketLabel(month, "month")}: ${cellBreakdown(cell)}`
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={text}
      title={text}
      data-kind={kind}
      style={{ backgroundColor: cellSurface(kind, cell.total, maxCell) }}
      className={cn(
        "flex h-10 min-w-12 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--color-text)] hover:ring-1 hover:ring-[var(--color-border-control)] focus-visible:outline-2 focus-visible:outline-offset-1",
        tileClass(kind),
      )}
    >
      <span className="font-semibold tabular-nums">{cell.total}</span>
      <span aria-hidden className="text-2xs font-medium">{MARK[kind]}</span>
    </Link>
  )
}
