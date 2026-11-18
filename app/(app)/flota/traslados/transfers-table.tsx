"use client"

import * as React from "react"
import { TransferButton } from "@/components/fleet/transfer/transfer-button"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import type { TransferListRow } from "@/lib/services/fleet-transfers"
import { formatDate } from "@/lib/utils"
import { VoidTransferDialog } from "./void-transfer-dialog"

// Un tipo (no la interfaz) para que sea asignable al `Record<string, unknown>` de DataTable; `search` junta lo
// que la barra superior filtra: folio, códigos, patentes, faenas, motivo y quién autorizó.
type Row = { [K in keyof TransferListRow]: TransferListRow[K] } & { search: string }

const COLUMNS = [
  { key: "folio", label: "Folio", sortable: true },
  { key: "effectiveDate", label: "Fecha", sortable: true },
  { key: "items", label: "Equipos", sortable: false },
  { key: "toWorksiteName", label: "A la faena", sortable: true },
  { key: "reason", label: "Motivo", sortable: false },
  { key: "authorizedBy", label: "Autorizado por", sortable: true },
  { key: "createdByName", label: "Registrado por", sortable: true },
  { key: "status", label: "Estado", sortable: false, sortValue: (row: Row) => (row.voidedAt ? 1 : 0) },
  { key: "_actions", label: "Acciones", sortable: false, toggleable: false },
]

function searchTextOf(row: TransferListRow): string {
  return [
    row.folio, row.toWorksiteName, row.reason, row.authorizedBy, row.createdByName,
    ...row.items.flatMap((item) => [item.code, item.plate, item.fromWorksiteName]),
  ].filter(Boolean).join(" ")
}

function StatusBadge({ row }: { row: TransferListRow }) {
  return row.voidedAt
    ? <Badge variant="danger" title={row.voidReason ?? undefined}>Anulado</Badge>
    : <Badge variant="success">Vigente</Badge>
}

function Items({ row }: { row: TransferListRow }) {
  return (
    <ul className="space-y-1.5">
      {row.items.map((item) => (
        <li key={item.vehicleId} className="flex flex-wrap items-baseline gap-x-2">
          <VehicleIdentity code={item.code} plate={item.plate} href={vehicleFichaHref(item.vehicleId)} />
          <span className="text-xs text-[var(--color-text-muted)]">desde {item.fromWorksiteName}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Lista de traslados. La búsqueda es la de la barra superior (DataTable se conecta sola); el período y la
 * faena son filtros de la página. «Anular» sólo aparece en un traslado vigente cuyos equipos siguen donde
 * él los dejó (`voidable`) y para quien puede trasladar. Sin filas, el estado vacío ofrece registrar el primero.
 */
export function TransfersTable({ rows, canTransfer }: { rows: TransferListRow[]; canTransfer: boolean }) {
  const [voiding, setVoiding] = React.useState<{ id: string; folio: string } | null>(null)
  const data = React.useMemo<Row[]>(() => rows.map((row) => ({ ...row, search: searchTextOf(row) })), [rows])

  const voidButton = (row: TransferListRow, className?: string) => (
    canTransfer && row.voidable ? (
      <Button
        size="sm" variant="secondary" className={className} aria-label={`Anular traslado ${row.folio}`}
        onClick={() => setVoiding({ id: row.id, folio: row.folio })}
      >
        Anular
      </Button>
    ) : null
  )

  return (
    <>
      <DataTable
        caption="Traslados de equipos entre faenas"
        columns={COLUMNS}
        rows={data}
        searchKeys={["search"]}
        tableClassName="min-w-[960px]"
        emptyTitle="Aún no hay traslados registrados"
        emptyDescription="Cuando Gerencia mueva equipos de faena, regístralo aquí para que quede su recorrido."
        emptyAction={canTransfer ? <TransferButton /> : undefined}
        renderMobileCard={(row) => (
          <article className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium">{row.folio}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{formatDate(row.effectiveDate)} · a {row.toWorksiteName}</p>
              </div>
              <StatusBadge row={row} />
            </div>
            <div className="mt-3"><Items row={row} /></div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Motivo</dt><dd>{row.reason}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Autorizado por</dt><dd>{row.authorizedBy}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Registrado por</dt><dd>{row.createdByName ?? "—"}</dd></div>
            </dl>
            {voidButton(row, "mt-3 w-full")}
          </article>
        )}
        renderRow={(row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono whitespace-nowrap">{row.folio}</TableCell>
            <TableCell className="whitespace-nowrap">{formatDate(row.effectiveDate)}</TableCell>
            <TableCell><Items row={row} /></TableCell>
            <TableCell>{row.toWorksiteName}</TableCell>
            <TableCell className="max-w-xs">{row.reason}</TableCell>
            <TableCell>{row.authorizedBy}</TableCell>
            <TableCell>{row.createdByName ?? "—"}</TableCell>
            <TableCell><StatusBadge row={row} /></TableCell>
            <TableCell className="text-right">{voidButton(row)}</TableCell>
          </TableRow>
        )}
      />
      {voiding && (
        <VoidTransferDialog key={voiding.id} transfer={voiding} open onOpenChange={(open) => { if (!open) setVoiding(null) }} />
      )}
    </>
  )
}
