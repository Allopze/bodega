"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import type { DriverRosterRow } from "@/lib/services/driver-licenses-contract"
import { ClassTags, DriverVigencia } from "./driver-status"
import { displayPosition, driverSearchText, driverUrgency } from "./drivers-view"

/**
 * La fila que ve `DataTable`: los campos planos que busca y ordena la tabla,
 * más la fila completa del servicio para pintarla. Tiene que ser un `type` y no
 * una `interface` para cumplir `Record<string, unknown>`.
 */
export type DriverTableRow = {
  /** `DataTable` usa `id` de llave de la fila. */
  id: string
  name: string
  rut: string | null
  worksiteName: string
  positionName: string | null
  /** Lo que busca el buscador de la barra superior (ver `driverSearchText`). */
  searchText: string
  /** Para ordenar por «Vigencia» (ver `driverUrgency`). */
  urgency: number
  row: DriverRosterRow
}

export function toDriverTableRow(row: DriverRosterRow): DriverTableRow {
  return {
    id: row.workerId,
    name: row.name,
    rut: row.rut,
    worksiteName: row.worksiteName,
    positionName: row.positionName,
    searchText: driverSearchText(row),
    urgency: driverUrgency(row),
    row,
  }
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Trabajador", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "positionName", label: "Cargo", sortable: true, sortValue: (row: DriverTableRow) => displayPosition(row.positionName) },
  { key: "classes", label: "Clases" },
  { key: "urgency", label: "Vigencia", sortable: true },
  // Sin rótulo visible: `DataTable` le pone «Acciones» como nombre accesible.
  { key: "actions", label: "" },
]

const SEARCH_KEYS: (keyof DriverTableRow)[] = ["searchText"]

function RowAction({ row, onEdit }: { row: DriverRosterRow; onEdit: (row: DriverRosterRow) => void }) {
  const hasLicense = row.license !== null
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      // El nombre visible («Actualizar») está contenido en el accesible (WCAG 2.5.3) y dice de quién.
      aria-label={`${hasLicense ? "Actualizar" : "Registrar"} licencia de ${row.name}`}
      onClick={() => onEdit(row)}
    >
      {hasLicense ? "Actualizar" : "Registrar"}
    </Button>
  )
}

function Notes({ notes, className }: { notes: string | null | undefined; className?: string }) {
  if (!notes) return null
  return (
    <p title={notes} className={className ?? "mt-1 max-w-[32ch] truncate text-xs text-[var(--color-text-muted)]"}>
      {notes}
    </p>
  )
}

export function DriversTable({
  rows,
  today,
  warningDays,
  onEdit,
}: {
  rows: DriverTableRow[]
  today: string
  warningDays: number
  onEdit: (row: DriverRosterRow) => void
}) {
  const renderRow = React.useCallback(
    (item: DriverTableRow) => {
      const { row } = item
      return (
        <TableRow key={item.id}>
          <TableCell>
            <div className="font-medium text-[var(--color-text)]">{row.name}</div>
            <div className="text-xs tabular-nums text-[var(--color-text-muted)]">{row.rut ?? "Sin RUT"}</div>
          </TableCell>
          <TableCell>{row.worksiteName}</TableCell>
          <TableCell>{displayPosition(row.positionName)}</TableCell>
          <TableCell>
            <ClassTags classes={row.license?.classes ?? []} />
          </TableCell>
          <TableCell>
            <DriverVigencia row={row} today={today} warningDays={warningDays} />
            <Notes notes={row.license?.notes} />
          </TableCell>
          <TableCell className="text-right">
            <RowAction row={row} onEdit={onEdit} />
          </TableCell>
        </TableRow>
      )
    },
    [onEdit, today, warningDays],
  )

  const renderMobileCard = React.useCallback(
    (item: DriverTableRow) => {
      const { row } = item
      return (
        <article className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-medium text-[var(--color-text)]">{row.name}</p>
              <p className="text-xs tabular-nums text-[var(--color-text-muted)]">{row.rut ?? "Sin RUT"}</p>
            </div>
            <DriverVigencia row={row} today={today} warningDays={warningDays} className="max-w-[58%] shrink-0 justify-end text-right" />
          </div>
          <Notes notes={row.license?.notes} className="mt-2 line-clamp-2 text-xs text-[var(--color-text-muted)]" />
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-[var(--color-text-subtle)]">Faena</dt>
              <dd>{row.worksiteName}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-text-subtle)]">Cargo</dt>
              <dd>{displayPosition(row.positionName)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="mb-1 text-[var(--color-text-subtle)]">Clases</dt>
              <dd>
                <ClassTags classes={row.license?.classes ?? []} />
              </dd>
            </div>
          </dl>
          <div className="mt-3 [&>button]:w-full">
            <RowAction row={row} onEdit={onEdit} />
          </div>
        </article>
      )
    },
    [onEdit, today, warningDays],
  )

  return (
    <DataTable
      caption="Licencias de conducir por trabajador"
      columns={COLUMNS}
      rows={rows}
      searchKeys={SEARCH_KEYS}
      tableClassName="min-w-[820px]"
      pageSize={25}
      emptyTitle="Sin coincidencias"
      emptyDescription="Ningún conductor de esta vista coincide con lo que buscaste."
      renderRow={renderRow}
      renderMobileCard={renderMobileCard}
    />
  )
}
