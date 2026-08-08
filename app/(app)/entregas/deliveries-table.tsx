"use client"

import { FileText, User } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { HISTORY_PAGE_SIZE } from "@/lib/constants"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"

export type DeliveryRow = {
  id:           string
  code:         string
  worksiteName: string
  workerId?:    string | null
  workerName:   string
  receiverName: string | null
  itemSummary:  string
  requestCode:  string | null
  deliveredAt:  string
  attachmentId: string | null
}

const COLUMNS = [
  { key: "code", label: "Entrega", sortable: true, width: "w-36" },
  { key: "workerName", label: "Trabajador", sortable: true },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "itemSummary", label: "EPP", sortable: true },
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
      searchKeys={["code", "workerName", "worksiteName", "itemSummary"]}
      pageSize={HISTORY_PAGE_SIZE}

      emptyTitle="Sin entregas"
      emptyDescription="No hay entregas de EPP que coincidan con la búsqueda."
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
                      className="mt-0.5 block truncate text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {delivery.workerName}
                    </a>
                  ) : (
                    <p title={delivery.workerName} className="mt-0.5 truncate text-sm font-medium text-[var(--color-text)]">{delivery.workerName}</p>
                  )}
                  {delivery.receiverName && delivery.receiverName !== delivery.workerName && (
                    <p className="text-[11px] text-[var(--color-text-subtle)]">Recibido por: {delivery.receiverName}</p>
                  )}
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{delivery.worksiteName}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={`/entregas/${delivery.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                  aria-label={`Comprobante de entrega ${delivery.code}`}
                >
                  <FileText size={12} />
                  Comprobante
                </a>
                {delivery.attachmentId && (
                  <a
                    href={`/api/attachments/${delivery.attachmentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                  >
                    <FileText size={12} />
                    Archivo
                  </a>
                )}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--color-text-subtle)]">EPP</dt>
                <dd className="truncate text-[var(--color-text-muted)]">{delivery.itemSummary}</dd>
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
              {delivery.worksiteName}
            </TableCell>
            <TableCell className="max-w-64 truncate text-sm text-[var(--color-text-muted)]">
              {delivery.itemSummary}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-subtle)]">
              {formatDate(delivery.deliveredAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <a
                  href={`/entregas/${delivery.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                  aria-label={`Comprobante de entrega ${delivery.code}`}
                >
                  <FileText size={12} />
                  Comprobante
                </a>
                {delivery.attachmentId && (
                  <a
                    href={`/api/attachments/${delivery.attachmentId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                  >
                    <FileText size={12} />
                    Archivo
                  </a>
                )}
              </div>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
