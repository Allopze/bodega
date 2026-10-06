"use client"

import * as React from "react"
import { DotsThree, FileText, Prohibit, User } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { HISTORY_PAGE_SIZE } from "@/lib/constants"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatDate } from "@/lib/utils"
import { VoidDeliveryDialog } from "./void-delivery-dialog"

export type DeliveryRow = {
  id:           string
  code:         string
  /** Fecha de anulación, o null. Una entrega anulada no cuenta como entregada. */
  voidedAt:     string | null
  voidReason:   string | null
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

// BOD-01: `sortable: false` en todas. El orden del DataTable sólo reordena las
// filas de la página en pantalla, no el historial completo, y aparentaba ser un
// orden global. El historial va siempre por fecha de entrega descendente
// (servidor). Un orden por columna real requeriría `?orden=` en la consulta.
const COLUMNS = [
  { key: "code", label: "Entrega", sortable: false, width: "w-36" },
  { key: "workerName", label: "Trabajador", sortable: false },
  { key: "sourceWorksiteName", label: "Bodega origen", sortable: false },
  { key: "worksiteName", label: "Faena", sortable: false },
  { key: "itemSummary", label: "Productos", sortable: false },
  { key: "deliveredAt", label: "Fecha", sortable: false, width: "w-36" },
  { key: "attachmentId", label: "Comprobante", sortable: false, width: "w-32" },
]

/**
 * Acciones secundarias de la fila. "Anular" mueve inventario y es rara: va en
 * un menú, no como botón rojo en cada una de las filas de la página. Conserva el
 * diálogo de confirmación con motivo obligatorio.
 */
function DeliveryRowActions({ delivery }: { delivery: DeliveryRow }) {
  const [voidOpen, setVoidOpen] = React.useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-mobile-sm"
            aria-label={`Más acciones de la entrega ${delivery.code}`}
          >
            <DotsThree size={18} weight="bold" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuItem
            onSelect={() => setVoidOpen(true)}
            className="min-h-11 gap-2 text-[var(--color-danger)] focus:text-[var(--color-danger)] sm:min-h-0"
          >
            <Prohibit size={14} aria-hidden />
            Anular entrega
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <VoidDeliveryDialog
        deliveryId={delivery.id}
        deliveryCode={delivery.code}
        workerName={delivery.workerName}
        open={voidOpen}
        onOpenChange={setVoidOpen}
      />
    </>
  )
}

/** Enlace a la ficha del trabajador con objetivo táctil adecuado (el texto solo medía 19 px). */
const WORKER_LINK_CLASS =
  "-my-1.5 inline-flex min-h-11 max-w-full items-center py-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline sm:min-h-8"

/**
 * `canViewTraceability` llega como prop porque la ficha del trabajador exige
 * `traceability:view`, permiso que varios roles con `deliveries:view` no tienen:
 * sin el gate el nombre enlazaba derecho a /forbidden. Es cliente, así que la
 * sesión la resuelve la página.
 */
export function DeliveriesTable({ deliveries, canViewTraceability = false, canVoid = false }: { deliveries: DeliveryRow[]; canViewTraceability?: boolean; canVoid?: boolean }) {
  return (
    <DataTable
      caption="Entregas"
      columns={COLUMNS}
      rows={deliveries}
      // BOD-01: la página ya viene filtrada y paginada del servidor
      // (`delivery-filters.tsx` + `history-search.ts`). Sin esto el input de la
      // shell volvía a filtrar en memoria sólo estas filas.
      searchKeys={["code", "workerName", "sourceWorksiteName", "worksiteName", "itemSummary"]}
      disableInternalSearch
      pageSize={HISTORY_PAGE_SIZE}
      emptyTitle="Sin entregas"
      emptyDescription="No hay entregas en el historial."
      renderMobileCard={(delivery) => {
        return (
          <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <User size={18} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    <span className={delivery.voidedAt ? "line-through" : undefined}>{delivery.code}</span>
                    {delivery.voidedAt && <MetaBadge meta={{ label: "Anulada", variant: "danger" }} />}
                  </p>
                  {delivery.workerId && canViewTraceability ? (
                    <a
                      href={`/bodega/trazabilidad/trabajador/${delivery.workerId}`}
                      className={`${WORKER_LINK_CLASS} break-words`}
                    >
                      {delivery.workerName}
                    </a>
                  ) : (
                    <p className="mt-0.5 break-words text-sm font-medium text-[var(--color-text)]">{delivery.workerName}</p>
                  )}
                  {delivery.receiverName && delivery.receiverName !== delivery.workerName && (
                    <p className="text-xs text-[var(--color-text-muted)]">Recibido por: {delivery.receiverName}</p>
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
                    <MetaBadge meta={{ label: "Cantidad regularizada", variant: "info" }} className="mt-1" />
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
              <span className={`font-mono text-xs${delivery.voidedAt ? " line-through text-[var(--color-text-subtle)]" : ""}`}>
                {delivery.code}
              </span>
              {delivery.voidedAt && (
                <MetaBadge meta={{ label: "Anulada", variant: "danger" }} title={delivery.voidReason ?? undefined} className="ml-1.5 align-middle" />
              )}
            </TableCell>
            <TableCell>
              <div className="min-w-0">
                {delivery.workerId && canViewTraceability ? (
                  <a
                    href={`/bodega/trazabilidad/trabajador/${delivery.workerId}`}
                    className={WORKER_LINK_CLASS}
                  >
                    <span className="truncate">{delivery.workerName}</span>
                  </a>
                ) : (
                  <p title={delivery.workerName} className="truncate text-sm font-medium text-[var(--color-text)]">{delivery.workerName}</p>
                )}
                {delivery.receiverName && delivery.receiverName !== delivery.workerName && (
                  <p className="text-xs text-[var(--color-text-muted)]">Recibido por: {delivery.receiverName}</p>
                )}
                {delivery.requestCode && (
                  <p className="font-mono text-xs text-[var(--color-text-muted)]">{delivery.requestCode}</p>
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
                {delivery.quantityCorrected && <MetaBadge meta={{ label: "Regularizada", variant: "info" }} />}
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
                {canVoid && !delivery.voidedAt && (
                  <DeliveryRowActions delivery={delivery} />
                )}
              </div>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
