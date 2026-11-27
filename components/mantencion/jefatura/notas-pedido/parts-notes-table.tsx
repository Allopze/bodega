"use client"

import * as React from "react"
import Link from "next/link"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import type { PartsNoteListRow } from "@/lib/services/mantencion/parts/types"
import { formatDateTime } from "@/lib/utils"
import { BulkLinesBar } from "./bulk-lines-bar"
import { canPickLines, LinesToggle, NoteLinesList, NoteSelectBox, SelectAllLines, useLineSelection, type LineSelection } from "./note-lines-select"
import { NoteStatusBadge } from "./note-status-badge"
import { ageText, chargesText, isNotePending, PARTS_NOTES_PAGE_SIZE, pendingLinesText } from "./parts-notes-format"

const COLUMNS = [
  { key: "code", label: "Nota" },
  { key: "equipmentCode", label: "Equipo y OT" },
  { key: "worksiteName", label: "Faena" },
  { key: "requestedByName", label: "Pedida por" },
  { key: "status", label: "Estado" },
  { key: "statusSince", label: "En este estado" },
  { key: "pendingLines", label: "Líneas pendientes" },
]

const OT_LINK = "font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
const QUIET = "text-xs text-[var(--color-text-muted)]"

/**
 * Lo que se dice de la nota además de su código y su estado: «Equipo detenido» o «Urgente» (el naranja signal es sólo de lo
 * pendiente, así que una nota cerrada no lo lleva; si el equipo está detenido ya se sabe que es urgente) y, en una importada,
 * su folio de origen.
 */
function NoteFlags({ row }: { row: PartsNoteListRow }) {
  const pending = isNotePending({ status: row.status, pendingLines: row.pendingLines.length })
  const flag = pending && row.equipmentStopped ? "Equipo detenido" : pending && row.urgent ? "Urgente" : null
  if (!flag && !row.externalRef) return null
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {flag && <Badge variant="signal" size="sm">{flag}</Badge>}
      {row.externalRef && <span className="font-mono text-2xs text-[var(--color-text-muted)]" title="Folio del sistema de origen">{row.externalRef}</span>}
    </span>
  )
}

/** La orden de la nota, o «Sin OT» con el cargo de sus líneas (a qué equipo o centro de costo se imputa): sin OT no hay otro dato que la ubique. */
function WorkOrderOrCharge({ row }: { row: PartsNoteListRow }) {
  if (row.workOrderId) {
    return <Link href={`/mantencion/ot/${row.workOrderId}`} aria-label={`Ver la OT ${row.workOrderFolio}`} className={OT_LINK}>{row.workOrderFolio}</Link>
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={QUIET}>Sin OT</span>
      {row.charges.length > 0 && <span className={QUIET} title={row.charges.join(", ")}>Cargo: {chargesText(row.charges)}</span>}
    </span>
  )
}

const sinceTitle = (row: PartsNoteListRow) => `En este estado desde el ${formatDateTime(row.statusSince)}. Creada el ${formatDateTime(row.createdAt)}.`

/** En la tarjeta del móvil: «2 de 3» (que despliega las líneas), la casilla de la nota con su rótulo visible y, abierta, cada línea. */
function CardLines({ row, selection, open, onToggle }: { row: PartsNoteListRow; selection: LineSelection; open: boolean; onToggle: () => void }) {
  const text = pendingLinesText(row.pendingLines.length, row.totalLines)
  const pickable = canPickLines(row)
  return (
    <div className="flex flex-col items-start gap-1.5">
      {pickable
        ? <LinesToggle row={row} text={text} open={open} onToggle={onToggle} />
        : <span className="font-mono tabular-nums text-[var(--color-text)]">{text}</span>}
      <NoteSelectBox row={row} selection={selection} variant="card" />
      {pickable && open && <NoteLinesList row={row} selection={selection} />}
    </div>
  )
}

/**
 * Bandeja de notas de pedido. La búsqueda y los filtros viven en la URL y los resuelve el servidor (la tabla no filtra
 * por su cuenta: `disableInternalSearch`). En escritorio una tabla; bajo `md`, las mismas filas como tarjetas con una
 * acción de 44 px.
 *
 * Con `selectable` (quien administra las notas, en «Por revisar») cada fila con líneas pendientes lleva una casilla que
 * elige TODAS las suyas, se puede desplegar para marcar líneas sueltas, y sobre la tabla hay un «elegir todo» de la página;
 * la barra del lote (`BulkLinesBar`) aparece con la selección y decide las líneas elegidas sin salir de la bandeja.
 */
export function PartsNotesTable({ rows, selectable = false }: { rows: PartsNoteListRow[]; selectable?: boolean }) {
  const selection = useLineSelection(rows, selectable)
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set())
  const toggleOpen = (id: string) => setOpen((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const table = (
    <DataTable
      caption="Notas de pedido"
      columns={COLUMNS}
      rows={rows}
      searchKeys={[]}
      disableInternalSearch
      pageSize={PARTS_NOTES_PAGE_SIZE}
      disableSort
      hideDensityToggle
      emptyTitle="Ninguna nota coincide con la búsqueda"
      emptyDescription="Prueba con otro código de nota, de orden de trabajo o de equipo."
      renderMobileCard={(row) => (
        <ResponsiveDataListCard
          headingLevel={2}
          title={<span className="font-mono text-sm font-semibold">{row.code}</span>}
          description={<>{row.equipmentCode}{row.equipmentPlate && row.equipmentPlate !== row.equipmentCode ? ` · ${row.equipmentPlate}` : ""}{row.equipmentCode ? " · " : ""}{row.worksiteName}</>}
          status={<><NoteStatusBadge status={row.status} /><NoteFlags row={row} /></>}
          actions={(
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link href={`/mantencion/notas-pedido/${row.id}`} aria-label={`Ver la nota ${row.code}`}>Ver la nota</Link>
            </Button>
          )}
        >
          <ResponsiveDataListField label="Orden de trabajo"><WorkOrderOrCharge row={row} /></ResponsiveDataListField>
          <ResponsiveDataListField label="Líneas pendientes" className={selectable ? "col-span-2" : undefined}>
            {selectable
              ? <CardLines row={row} selection={selection} open={open.has(row.id)} onToggle={() => toggleOpen(row.id)} />
              : <span className="font-mono tabular-nums text-[var(--color-text)]">{pendingLinesText(row.pendingLines.length, row.totalLines)}</span>}
          </ResponsiveDataListField>
          <ResponsiveDataListField label="Pedida por"><span className="text-[var(--color-text)]">{row.requestedByName}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="En este estado"><span className="text-[var(--color-text)]" title={sinceTitle(row)}>{ageText(row.statusSince)}</span></ResponsiveDataListField>
        </ResponsiveDataListCard>
      )}
      renderRow={(row) => {
        const expandable = selectable && canPickLines(row)
        return (
          <>
            <TableRow
              className={row.status === "anulada" ? "bg-[var(--color-surface-2)]/60" : undefined}
              data-selected={selectable && selection.noteState(row) === "all" ? true : undefined}
            >
              <TableCell>
                <div className={selectable ? "flex items-start gap-2" : undefined}>
                  {selectable && <NoteSelectBox row={row} selection={selection} variant="cell" />}
                  <div>
                    <Link
                      href={`/mantencion/notas-pedido/${row.id}`}
                      className="font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
                    >
                      {row.code}
                    </Link>
                    <NoteFlags row={row} />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {/* En columna: el equipo (código y patente) y debajo su OT. En línea, el folio quedaba pegado al código. */}
                <div className="flex flex-col items-start gap-1">
                  {row.equipmentCode && <VehicleIdentity code={row.equipmentCode} plate={row.equipmentPlate} />}
                  <WorkOrderOrCharge row={row} />
                </div>
              </TableCell>
              <TableCell>{row.worksiteName}</TableCell>
              <TableCell>{row.requestedByName}</TableCell>
              <TableCell><NoteStatusBadge status={row.status} /></TableCell>
              <TableCell className="whitespace-nowrap text-sm" title={sinceTitle(row)}>{ageText(row.statusSince)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                {expandable
                  ? <LinesToggle row={row} text={pendingLinesText(row.pendingLines.length, row.totalLines)} open={open.has(row.id)} onToggle={() => toggleOpen(row.id)} />
                  : pendingLinesText(row.pendingLines.length, row.totalLines)}
              </TableCell>
            </TableRow>
            {expandable && open.has(row.id) && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="py-2 pl-11">
                  <NoteLinesList row={row} selection={selection} />
                </TableCell>
              </TableRow>
            )}
          </>
        )
      }}
    />
  )
  if (!selectable) return table
  return (
    <div className="flex flex-col">
      <SelectAllLines selection={selection} />
      {table}
      <BulkLinesBar lineIds={[...selection.selected]} noteCount={selection.noteCount} canTakeFromStock={selection.canTakeFromStock} onClear={selection.clear} />
    </div>
  )
}
