"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { conciliatePartAction } from "@/app/(app)/mantencion/notas-pedido/actions"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import type { PendingConciliationRow } from "@/lib/services/mantencion/parts/types"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { NoteReasonDialog } from "./note-reason-dialog"
import { PARTS_NOTES_PAGE_SIZE } from "./parts-notes-format"

const COLUMNS = [
  { key: "recordFolio", label: "Registro" },
  { key: "workOrderFolio", label: "Orden de trabajo" },
  { key: "worksiteName", label: "Faena" },
  { key: "productName", label: "Repuesto" },
  { key: "quantity", label: "Cantidad" },
  { key: "freeNow", label: "Libres ahora" },
  { key: "note", label: "Nota" },
  { key: "actions", label: "" },
]

const SEARCH_KEYS: Array<keyof PendingConciliationRow> = ["recordFolio", "workOrderFolio", "worksiteName", "productName"]
const LINK = "font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

function RecordLink({ row }: { row: PendingConciliationRow }) {
  if (!row.recordFolio) return <span className="text-[var(--color-text-muted)]">Sin folio</span>
  return <Link href={`/mantencion/registros/${row.recordId}`} className={LINK}>{row.recordFolio}</Link>
}

function OrderLink({ row }: { row: PendingConciliationRow }) {
  if (!row.workOrderId || !row.workOrderFolio) return <span className="text-[var(--color-text-muted)]">Sin orden</span>
  return <Link href={`/mantencion/ot/${row.workOrderId}`} className={LINK}>{row.workOrderFolio}</Link>
}

function FreeNow({ row }: { row: PendingConciliationRow }) {
  return (
    <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">
      {formatQty(row.freeNow)} libres ahora
      {row.freeNow < row.quantity && <span className="block font-sans text-xs text-[var(--color-signal-ink)]">No alcanza para lo declarado</span>}
    </span>
  )
}

/**
 * Las dos salidas de un repuesto declarado sin stock: «Descontar ahora» (rutina: no pide confirmación; el servidor
 * aplica el egreso o dice por qué no) y «No salió de bodega» (con motivo: el registro queda sin movimiento). El
 * resultado de «Descontar» se ve en la misma fila, no en un toast que desaparece.
 */
function ConciliationActions({ row }: { row: PendingConciliationRow }) {
  const router = useRouter()
  const op = useOperation()
  const [dialog, setDialog] = React.useState(false)
  const label = `${row.productName}${row.recordFolio ? ` (${row.recordFolio})` : ""}`

  function apply() {
    op.run(
      () => conciliatePartAction({ recordPartId: row.recordPartId, mode: "aplicar" }),
      (result) => { toast.success(result.message ?? "Repuesto descontado"); router.refresh() },
      (result) => { if (/ya fue|otra persona|otra sesi[oó]n/i.test(result.message ?? "")) router.refresh() },
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" loading={op.pending} aria-label={`Descontar ahora ${label}`} onClick={apply}>Descontar ahora</Button>
        <Button type="button" size="sm" variant="ghost" disabled={op.pending} aria-label={`No salió de bodega ${label}`} onClick={() => setDialog(true)}>No salió de bodega</Button>
      </div>
      {op.message && <p role="alert" className="max-w-64 text-right text-xs text-[var(--color-danger-ink)]">{op.message}</p>}
      {dialog && (
        <NoteReasonDialog
          onOpenChange={setDialog}
          title="No salió de bodega"
          description={`${row.productName} × ${formatQty(row.quantity)}: el registro queda sin movimiento de stock, con tu motivo.`}
          submitLabel="Registrar sin movimiento"
          action={(reason) => conciliatePartAction({ recordPartId: row.recordPartId, mode: "sin_movimiento", reason })}
          successMessage="Registrado sin movimiento"
        />
      )}
    </div>
  )
}

/**
 * Pestaña «Por conciliar» de la bandeja (sólo con `mant:np:manage`): los repuestos que un mecánico declaró usar sin
 * que hubiera stock al sincronizar (el registro nunca se rechaza por eso: ADR 0001, D6). La búsqueda es la de la
 * barra superior; el servidor ya recortó por faena y página.
 */
export function ConciliationList({ rows }: { rows: PendingConciliationRow[] }) {
  return (
    <DataTable
      caption="Repuestos por conciliar"
      columns={COLUMNS}
      rows={rows.map((row) => ({ ...row, id: row.recordPartId }))}
      searchKeys={SEARCH_KEYS}
      pageSize={PARTS_NOTES_PAGE_SIZE}
      disableSort
      hideDensityToggle
      emptyTitle="Ningún repuesto coincide con la búsqueda"
      emptyDescription="Prueba con otro folio de registro, de orden de trabajo o de repuesto."
      renderMobileCard={(row) => (
        <ResponsiveDataListCard
          headingLevel={2}
          title={row.productName}
          description={<>{row.recordFolio ?? "Sin folio"} · {row.worksiteName}</>}
          actions={<ConciliationActions row={row} />}
        >
          <ResponsiveDataListField label="Orden de trabajo"><OrderLink row={row} /></ResponsiveDataListField>
          <ResponsiveDataListField label="Cantidad"><span className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.quantity)}</span></ResponsiveDataListField>
          <ResponsiveDataListField label="Libres ahora"><FreeNow row={row} /></ResponsiveDataListField>
          {row.note && <ResponsiveDataListField label="Nota" className="col-span-2"><span className="text-[var(--color-text)]">{row.note}</span></ResponsiveDataListField>}
        </ResponsiveDataListCard>
      )}
      renderRow={(row) => (
        <TableRow key={row.recordPartId}>
          <TableCell className="whitespace-nowrap"><RecordLink row={row} /></TableCell>
          <TableCell className="whitespace-nowrap"><OrderLink row={row} /></TableCell>
          <TableCell>{row.worksiteName}</TableCell>
          <TableCell>{row.productName}</TableCell>
          <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">{formatQty(row.quantity)}</TableCell>
          <TableCell className="whitespace-nowrap"><FreeNow row={row} /></TableCell>
          <TableCell className="max-w-64 text-xs text-[var(--color-text-muted)]">{row.note ?? "—"}</TableCell>
          <TableCell className="text-right"><ConciliationActions row={row} /></TableCell>
        </TableRow>
      )}
    />
  )
}
