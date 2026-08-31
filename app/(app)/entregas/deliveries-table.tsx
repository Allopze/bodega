"use client"

import { FileText, User } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { HISTORY_PAGE_SIZE } from "@/lib/constants"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"

export type DeliveryRow = {
  id:           string
  code:         string
  sourceWorksiteName: string
  worksiteName: string
  workerId?:    string | null
  workerName:   string
  receiverName: string | null
  itemSummary:  string
  quantityCorrected: boolean
  requestCode:  string | null
  deliveredAt:  string
  attachmentId: string | null
}

const COLUMNS = [
  { key: "code", label: "Entrega", sortable: true, width: "w-36" },
  { key: "workerName", label: "Trabajador", sortable: true },
  { key: "sourceWorksiteName", label: "Bodega origen", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "itemSummary", label: "Productos", sortable: true },
  { key: "deliveredAt", label: "Fecha", sortable: true, width: "w-36" },
  { key: "attachmentId", label: "Comprobante", sortable: false, width: "w-32" },
]

/**
 * `canViewTraceability` llega como prop porque la ficha del trabajador exige
 * `traceability:view`, permiso que varios roles con `deliveries:view` no tienen:
 * sin el gate el nombre enlazaba derecho a /forbidden. Es cliente, así que la
 * sesión la resuelve la página.
 */
export function DeliveriesTable({ deliveries, canViewTraceability = false }: { deliveries: DeliveryRow[]; canViewTraceability?: boolean }) {
  return (
    <DataTable
      caption="Entregas"
      columns={COLUMNS}
      rows={deliveries}
      searchKeys={["code", "workerName", "sourceWorksiteName", "worksiteName", "itemSummary"]}
      pageSize={HISTORY_PAGE_SIZE}

      emptyTitle="Sin entregas"
      emptyDescription="No hay entregas que coincidan con la búsqueda."
      renderMobileCard={(delivery) => {
        return (
          <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <User size={18} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">{delivery.code}</p>
                  {delivery.workerId && canViewTraceability ? (
                    <a
                      href={`/trazabilidad/trabajador/${delivery.workerId}`}
                      className="mt-0.5 block break-words text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {delivery.workerName}
                    </a>
                  ) : (
                    <p className="mt-0.5 break-words text-sm font-medium text-[var(--color-text)]">{delivery.workerName}</p>
                  )}
                  {delivery.receiverName && delivery.receiverName !== delivery.workerName && (
                    <p className="text-[11px] text-[var(--color-text-subtle)]">Recibido por: {delivery.receiverName}</p>
                  )}
                  <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{delivery.worksiteName}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="secondary" size="sm" asChild className="shrink-0 gap-1">
                  <a
                    href={`/entregas/${delivery.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Comprobante de entrega ${delivery.code}`}
                  >
                    <FileText size={12} aria-hidden />
                    Comprobante
                  </a>
                </Button>
                {delivery.attachmentId && (
                  <Button variant="secondary" size="sm" asChild className="shrink-0 gap-1">
                    <a
                      href={`/api/attachments/${delivery.attachmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText size={12} aria-hidden />
                      Archivo
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--color-text-subtle)]">Productos</dt>
                <dd className="break-words text-[var(--color-text-muted)]">
                  {delivery.itemSummary}
                  {delivery.quantityCorrected && (
                    <Badge variant="info" size="sm" className="mt-1">Cantidad regularizada</Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-subtle)]">Bodega origen</dt>
                <dd className="break-words text-[var(--color-text-muted)]">{delivery.sourceWorksiteName}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
                <dd className="text-[var(--color-text-muted)]">{formatDate(delivery.deliveredAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-subtle)]">Solicitud</dt>
                <dd className="font-mono text-[var(--color-text)]">{delivery.requestCode ?? "—"}</dd>
              </div>
            </dl>
          </article>
        )
      }}
      renderRow={(delivery) => {
        return (
          <TableRow key={delivery.id}>
            <TableCell>
              <span className="font-mono text-xs">{delivery.code}</span>
            </TableCell>
            <TableCell>
              <div className="min-w-0">
                {delivery.workerId && canViewTraceability ? (
                  <a
                    href={`/trazabilidad/trabajador/${delivery.workerId}`}
                    className="block truncate text-sm font-medium text-[var(--color-primary)] hover:underline"
                  >
                    {delivery.workerName}
                  </a>
                ) : (
                  <p title={delivery.workerName} className="truncate text-sm font-medium text-[var(--color-text)]">{delivery.workerName}</p>
                )}
                {delivery.receiverName && delivery.receiverName !== delivery.workerName && (
                  <p className="text-[11px] text-[var(--color-text-subtle)]">Recibido por: {delivery.receiverName}</p>
                )}
                {delivery.requestCode && (
                  <p className="font-mono text-[11px] text-[var(--color-text-subtle)]">{delivery.requestCode}</p>
                )}
              </div>
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {delivery.sourceWorksiteName}
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-muted)]">
              {delivery.worksiteName}
            </TableCell>
            <TableCell className="max-w-64 text-sm text-[var(--color-text-muted)]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate">{delivery.itemSummary}</span>
                {delivery.quantityCorrected && <Badge variant="info" size="sm">Regularizada</Badge>}
              </div>
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {formatDate(delivery.deliveredAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" asChild className="gap-1">
                  <a
                    href={`/entregas/${delivery.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Comprobante de entrega ${delivery.code}`}
                  >
                    <FileText size={12} aria-hidden />
                    Comprobante
                  </a>
                </Button>
                {delivery.attachmentId && (
                  <Button variant="secondary" size="sm" asChild className="gap-1">
                    <a
                      href={`/api/attachments/${delivery.attachmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <FileText size={12} aria-hidden />
                      Archivo
                    </a>
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
