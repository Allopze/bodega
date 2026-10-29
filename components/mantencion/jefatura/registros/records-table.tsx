import Link from "next/link"
import { CaretDown, CaretUp, CaretUpDown } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { executorText, formatReading, plural, recordKindText } from "@/lib/mantencion/format"
import type { RecordListRow } from "@/lib/services/mantencion/records-query"
import type { RecordSortKey, SortDirection } from "@/lib/services/mantencion/records-filters"
import { formatDate } from "@/lib/utils"
import { RecordStatusBadges } from "../shared/record-badges"

interface SortableColumn {
  key: RecordSortKey
  label: string
}

const SORTABLE: Record<string, SortableColumn> = {
  folio: { key: "folio", label: "Folio" },
  fecha: { key: "fecha", label: "Fecha" },
  faena: { key: "faena", label: "Faena" },
  equipo: { key: "equipo", label: "Equipo" },
  lectura: { key: "lectura", label: "Lectura" },
}

/** Resultado del trabajo en una línea: lo que una jefatura mira primero en la fila. */
function Outcome({ row }: { row: RecordListRow }) {
  if (row.status === "anulado") return <span className="text-[var(--color-text-muted)]">No cuenta en los cálculos</span>
  if (row.kind === "P") {
    return row.notDoneCount > 0
      ? <span className="font-medium text-[var(--color-signal-ink)]">{plural(row.notDoneCount, "ítem no realizado", "ítems no realizados")}</span>
      : <span className="text-[var(--color-text-muted)]">Completa</span>
  }
  if (row.workshop) {
    const days = row.workshop.daysStopped
    return (
      <span className="font-medium text-[var(--color-signal-ink)]">
        En taller · {days ? plural(days, "día", "días") : "desde hoy"}
        {row.workshop.stale && " · sin actualizar"}
      </span>
    )
  }
  return <span className="text-[var(--color-text-muted)]">Cerrada</span>
}

function AlertBadges({ row }: { row: RecordListRow }) {
  const items: string[] = []
  if (row.alerts.jump) items.push("Salto de lectura")
  if (row.alerts.outOfWorksite) items.push("Fuera de faena")
  if (row.alerts.manualSchedule) items.push("Pauta a mano")
  if (row.alerts.duplicate) items.push("Duplicado")
  if (items.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map((label) => <Badge key={label} variant="outline" size="sm">{label}</Badge>)}
    </div>
  )
}

/**
 * Tabla de «Registros». Es un componente de servidor: cada encabezado ordenable
 * es un enlace que cambia `orden`/`dir` en la URL (`replace`, sin mover el scroll)
 * y el orden lo resuelve la base, igual que la paginación. Una sola
 * representación (sin tarjetas duplicadas para móvil): la vista de jefatura es de
 * escritorio y, en una pantalla angosta, la tabla se desplaza con el teclado.
 */
export function RecordsTable({
  rows,
  sort,
  dir,
  sortHref,
}: {
  rows: RecordListRow[]
  sort: RecordSortKey
  dir: SortDirection
  /** URL de la misma lista ordenada por esa columna (alterna el sentido si ya estaba activa). */
  sortHref: (key: RecordSortKey) => string
}) {
  const header = (column: SortableColumn) => {
    const active = sort === column.key
    const Icon = !active ? CaretUpDown : dir === "asc" ? CaretUp : CaretDown
    return (
      <TableHead key={column.key} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={sortHref(column.key)} replace scroll={false} className="inline-flex items-center gap-1 hover:text-[var(--color-text)]">
          {column.label}
          <Icon size={12} aria-hidden weight={active ? "bold" : "regular"} />
          <span className="sr-only">{active ? `, orden ${dir === "asc" ? "ascendente" : "descendente"}` : ", ordenar"}</span>
        </Link>
      </TableHead>
    )
  }

  return (
    <TableRoot aria-label="Registros de mantención">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {header(SORTABLE.folio!)}
            {header(SORTABLE.fecha!)}
            {header(SORTABLE.faena!)}
            {header(SORTABLE.equipo!)}
            <TableHead>Tipo</TableHead>
            <TableHead>Hecho por</TableHead>
            {header(SORTABLE.lectura!)}
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const equipment = row.equipment
            const showPlate = !equipment.noPlate && equipment.plate !== equipment.code
            const byProxy = row.executorKind !== "yo"
            return (
              <TableRow key={row.id} className={row.status === "anulado" ? "bg-[var(--color-surface-2)]/60" : undefined}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/mantencion/registros/${row.id}`}
                    className="font-mono text-[13px] font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
                    aria-label={`Ver el registro ${row.folio ?? "sin folio"}`}
                  >
                    {row.folio ?? "Sin folio"}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatDate(row.workDate)}</TableCell>
                <TableCell>{row.worksiteName}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px]">
                  <span className="font-semibold">{equipment.code}</span>
                  {showPlate && <span className="text-[var(--color-text-muted)]"> · {equipment.plate}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{recordKindText(row.kind, row.intervalValue, row.unit)}</TableCell>
                <TableCell>
                  <div>{row.executorName}</div>
                  {byProxy && (
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {executorText({ executorKind: row.executorKind, registeredByName: row.registeredByName, executorName: row.executorName })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[13px] tabular-nums">{formatReading(row.reading, row.unit)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Outcome row={row} />
                    <RecordStatusBadges status={row.status} review={row.review} />
                  </div>
                  <AlertBadges row={row} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
