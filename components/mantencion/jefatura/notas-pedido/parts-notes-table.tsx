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
import { ageText, isNotePending, NOTE_STATUS_TEXT, PARTS_NOTES_PAGE_SIZE, pendingLinesText } from "./parts-notes-format"

const COLUMNS = [
  { key: "code", label: "NP" },
  { key: "equipmentCode", label: "Equipo y OT" },
  { key: "worksiteName", label: "Faena" },
  { key: "requestedByName", label: "Pedido por" },
  { key: "pendingLines", label: "Líneas pendientes" },
  { key: "createdAt", label: "Antigüedad" },
]

const SEARCH_KEYS: Array<keyof PartsNoteListRow> = ["code", "workOrderFolio", "equipmentCode", "equipmentPlate", "worksiteName", "requestedByName"]

const OT_LINK = "font-mono text-xs font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

/**
 * Lo que se dice de la nota además de su código: «Equipo detenido» (el naranja signal es sólo de lo pendiente,
 * así que una nota cerrada no lo lleva) y «Anulada», que dentro de «Cerradas» no se distingue de otro modo.
 */
function NoteFlags({ row }: { row: PartsNoteListRow }) {
  const stopped = row.equipmentStopped && isNotePending(row)
  if (!stopped && row.status !== "anulada") return null
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {stopped && <Badge variant="signal" size="sm">Equipo detenido</Badge>}
      {row.status === "anulada" && <Badge variant="neutral" size="sm">{NOTE_STATUS_TEXT.anulada}</Badge>}
    </span>
  )
}

/**
 * Bandeja de notas de pedido. La búsqueda de texto es la de la barra superior (`DataTable` se conecta solo): filtra
 * la página que el servidor ya recortó con la pestaña y la faena de la URL. En escritorio una tabla; bajo `md`, las
 * mismas filas como tarjetas con una acción de 44 px.
 */
export function PartsNotesTable({ rows }: { rows: PartsNoteListRow[] }) {
  return (
    <DataTable
      caption="Notas de pedido"
      columns={COLUMNS}
      rows={rows}
      searchKeys={SEARCH_KEYS}
      pageSize={PARTS_NOTES_PAGE_SIZE}
      disableSort
      hideDensityToggle
      emptyTitle="Ninguna nota coincide con la búsqueda"
      emptyDescription="Prueba con otro código de nota, de orden de trabajo o de equipo."
      renderMobileCard={(row) => (
        <ResponsiveDataListCard
          headingLevel={2}
          title={<span className="font-mono text-sm font-semibold">{row.code}</span>}
          description={<>{row.equipmentCode}{row.equipmentPlate && row.equipmentPlate !== row.equipmentCode ? ` · ${row.equipmentPlate}` : ""} · {row.worksiteName}</>}
          status={<NoteFlags row={row} />}
          actions={(
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link href={`/mantencion/notas-pedido/${row.id}`} aria-label={`Ver la nota ${row.code}`}>Ver la nota</Link>
            </Button>
          )}
        >
          <ResponsiveDataListField label="Orden de trabajo">
            <Link href={`/mantencion/ot/${row.workOrderId}`} aria-label={`Ver la OT ${row.workOrderFolio}`} className={OT_LINK}>{row.workOrderFolio}</Link>
          </ResponsiveDataListField>
          <ResponsiveDataListField label="Líneas pendientes"><span className="font-mono tabular-nums text-[var(--color-text)]">{pendingLinesText(row.pendingLines, row.totalLines)}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="Pedido por"><span className="text-[var(--color-text)]">{row.requestedByName}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="Antigüedad"><span className="text-[var(--color-text)]">{ageText(row.createdAt)}</span></ResponsiveDataListField>
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
              <VehicleIdentity code={row.equipmentCode} plate={row.equipmentPlate} />
              <Link href={`/mantencion/ot/${row.workOrderId}`} aria-label={`Ver la OT ${row.workOrderFolio}`} className={OT_LINK}>{row.workOrderFolio}</Link>
            </div>
          </TableCell>
          <TableCell>{row.worksiteName}</TableCell>
          <TableCell>{row.requestedByName}</TableCell>
          <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">{pendingLinesText(row.pendingLines, row.totalLines)}</TableCell>
          <TableCell className="whitespace-nowrap text-sm" title={formatDateTime(row.createdAt)}>{ageText(row.createdAt)}</TableCell>
        </TableRow>
      )}
    />
  )
}
