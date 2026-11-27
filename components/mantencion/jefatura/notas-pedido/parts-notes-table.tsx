"use client"

import Link from "next/link"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import type { PartsNoteListRow } from "@/lib/services/mantencion/parts/types"
import { formatDateTime } from "@/lib/utils"
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
  const pending = isNotePending(row)
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

/**
 * Bandeja de notas de pedido. La búsqueda y los filtros viven en la URL y los resuelve el servidor (la tabla no filtra
 * por su cuenta: `disableInternalSearch`). En escritorio una tabla; bajo `md`, las mismas filas como tarjetas con una
 * acción de 44 px.
 */
export function PartsNotesTable({ rows }: { rows: PartsNoteListRow[] }) {
  return (
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
          <ResponsiveDataListField label="Líneas pendientes"><span className="font-mono tabular-nums text-[var(--color-text)]">{pendingLinesText(row.pendingLines, row.totalLines)}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="Pedida por"><span className="text-[var(--color-text)]">{row.requestedByName}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="En este estado"><span className="text-[var(--color-text)]" title={sinceTitle(row)}>{ageText(row.statusSince)}</span></ResponsiveDataListField>
        </ResponsiveDataListCard>
      )}
      renderRow={(row) => (
        <TableRow key={row.id} className={row.status === "anulada" ? "bg-[var(--color-surface-2)]/60" : undefined}>
          <TableCell>
            <Link
              href={`/mantencion/notas-pedido/${row.id}`}
              className="font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
            >
              {row.code}
            </Link>
            <NoteFlags row={row} />
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
          <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">{pendingLinesText(row.pendingLines, row.totalLines)}</TableCell>
        </TableRow>
      )}
    />
  )
}
