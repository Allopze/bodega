"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useTransition } from "react"
import { toast } from "@/lib/toast"
import { Trash } from "@phosphor-icons/react"
import { StateBadge } from "@/components/states/state-badge"
import { SubmitButton } from "@/components/admin/submit-button"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { formatCLP, formatDate } from "@/lib/utils"
import { issueOrderAction, sendOrderAction } from "./actions/order-status"
import { deleteOrderAction } from "./actions/order-cancel"
import { resumeItemAction } from "./actions/item-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DELETABLE_ORDER_STATUSES } from "@/lib/services/purchasing.constants"
import { INVOICE_DUE_ORDER_STATUSES } from "@/lib/work-queue-labels"
import type { ActionState } from "@/lib/validation/operations"
import type { OcRow, PendingItem } from "./oc-list.types"

/** La factura ya corresponde: llegó mercadería y la OC sigue abierta. */
function invoiceDue(status: string) {
  return INVOICE_DUE_ORDER_STATUSES.includes(status)
}

export function OcTableRow({ row, canDelete = false }: { row: OcRow; canDelete?: boolean }) {
  const router = useRouter()
  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueOrderAction, INITIAL_STATE,
  )
  const [sendState, sendAction] = useActionState<ActionState, FormData>(
    sendOrderAction, INITIAL_STATE,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteOrderAction, INITIAL_STATE,
  )
  const [deletePending, startDeleteTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  React.useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) toast.success(deleteState.message)
    else toast.error(deleteState.message)
  }, [deleteState])

  React.useEffect(() => {
    if (issueState.ok && issueState.message) toast.success(issueState.message)
    else if (issueState.ok === false && issueState.message && issueState !== INITIAL_STATE) {
      toast.error(issueState.message)
    }
  }, [issueState])

  React.useEffect(() => {
    if (sendState.ok && sendState.message) toast.success(sendState.message)
    else if (sendState.ok === false && sendState.message && sendState !== INITIAL_STATE) {
      toast.error(sendState.message)
    }
  }, [sendState])

  const href = `/compras/${row.id}`

  return (
    <TableRow
      className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
      role="link"
      tabIndex={0}
      aria-label={`Ver OC ${row.code}`}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          router.push(href)
        }
      }}
    >
      <TableCell>
        <span className="font-mono text-xs text-[var(--color-text)]">{row.code}</span>
      </TableCell>
      <TableCell className="text-sm text-[var(--color-text-muted)]">
        {row.worksiteName}
      </TableCell>
      <TableCell className="text-sm text-[var(--color-text-muted)]">
        {row.supplierName}
      </TableCell>
      {/* A-35: `TableCellNum` es el render canónico de columna numérica (mono,
          alineada a la derecha, con el mismo padding que su encabezado). Con
          `TableCell` + `text-right pr-6` ad-hoc, valor y encabezado no coincidían. */}
      <TableCellNum className="text-[var(--color-text-muted)]">
        {row.itemCount}
      </TableCellNum>
      <TableCellNum className="font-medium">
        {formatCLP(row.totalAmount)}
      </TableCellNum>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <StateBadge state={row.status} entity="oc" size="sm" />
          {row.status === "draft" && (
            <form action={issueAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Emitir"
                loadingLabel="Emitiendo…"
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {row.status === "issued" && (
            <form action={sendAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Marcar enviada"
                loadingLabel="Enviando…"
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {canDelete && (DELETABLE_ORDER_STATUSES as readonly string[]).includes(row.status) && (
            <>
              {/* `size-6` y no `p-1`: con 4px de padding alrededor de un icono de
                  15px el objetivo medía 23×23, un pixel por debajo del mínimo de
                  WCAG 2.5.8. Lo detectó zoom-200.spec.ts en cuanto el admin de
                  e2e tuvo el permiso que revela este botón. */}
              <button
                type="button"
                disabled={deletePending}
                onClick={(e) => { e.stopPropagation(); setDeleteOpen(true) }}
                className="inline-flex size-6 items-center justify-center rounded text-text-subtle hover:text-danger hover:bg-danger-tint transition-colors disabled:opacity-40"
                title="Eliminar OC"
                aria-label={`Eliminar OC ${row.code}`}
              >
                <Trash size={15} />
              </button>
              <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="¿Eliminar orden de compra?"
                description={`La orden ${row.code} será eliminada permanentemente junto con sus ítems y facturas adjuntas. Los ítems de la solicitud original volverán a estado pendiente. Esta acción no se puede deshacer.`}
                confirmLabel="Eliminar"
                variant="destructive"
                loading={deletePending}
                onConfirm={() => {
                  const fd = new FormData()
                  fd.set("orderId", row.id)
                  startDeleteTransition(() => deleteAction(fd))
                  setDeleteOpen(false)
                }}
              />
            </>
          )}
        </div>
      </TableCell>
      {/* El orden de las celdas debe seguir a `COLUMNS` de oc-list.tsx: estaban
          invertidas respecto a los encabezados, así que el badge de estado caía
          bajo "Facturas" y el conteo bajo "Estado". */}
      <TableCellNum>
        {row.invoiceCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-muted)] text-xs font-medium px-2 py-0.5 tabular-nums">
            {row.invoiceCount}
          </span>
        ) : invoiceDue(row.status) ? (
          // Con mercadería recibida el "—" neutro escondía el atraso: se leía
          // igual que en una OC recién emitida, donde aún no corresponde.
          <span className="inline-flex items-center rounded-full bg-signal-tint px-2 py-0.5 text-xs font-medium text-signal-ink">
            Sin factura
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-subtle)]">—</span>
        )}
      </TableCellNum>
      <TableCell className="text-xs text-[var(--color-text-subtle)]">
        {formatDate(row.sentAt ?? row.issuedAt ?? row.createdAt)}
      </TableCell>
    </TableRow>
  )
}

export function PostponedItemRow({ item }: { item: PendingItem }) {
  const [resumeState, resumeAction] = useActionState<ActionState, FormData>(
    resumeItemAction, INITIAL_STATE,
  )

  React.useEffect(() => {
    if (resumeState.ok && resumeState.message) toast.success(resumeState.message)
    else if (resumeState.ok === false && resumeState.message && resumeState !== INITIAL_STATE) {
      toast.error(resumeState.message)
    }
  }, [resumeState])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-[var(--color-border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/solicitudes/${item.requestId}`} className="font-mono text-xs text-[var(--color-primary)] hover:underline">
            {item.requestCode}
          </Link>
          <span className="text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
        </div>
        <p title={item.productName} className="mt-1 truncate text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {item.quantity} {item.unitOfMeasure}{item.notes ? ` · ${item.notes}` : ""}
        </p>
      </div>
      <form action={resumeAction} className="self-center">
        <input type="hidden" name="itemId" value={item.id} />
        <SubmitButton
          label="Reanudar"
          loadingLabel="Reanudando…"
          variant="secondary"
          size="sm"
        />
      </form>
    </div>
  )
}

/**
 * A-1: variante móvil de `OcTableRow`. En 390px la tabla mostraba 3 de sus 8
 * columnas, y ni el total ni el estado eran visibles — no se puede reconocer
 * una OC sin ellos (Heurística #6). La tarjeta prioriza código, proveedor,
 * estado y total; las acciones de emisión/envío se resuelven en el detalle.
 */
export function OcMobileCard({ row }: { row: OcRow }) {
  return (
    <Link
      href={`/compras/${row.id}`}
      className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{row.code}</p>
          <p title={row.supplierName} className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{row.supplierName}</p>
        </div>
        <StateBadge state={row.status} entity="oc" size="sm" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-[var(--color-text-subtle)]">Total</dt>
        <dd className="text-right font-mono font-semibold tabular-nums text-[var(--color-text)]">{formatCLP(row.totalAmount)}</dd>
        <dt className="text-[var(--color-text-subtle)]">Ítems</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{row.itemCount}</dd>
        <dt className="text-[var(--color-text-subtle)]">Faena</dt>
        <dd className="truncate text-right text-[var(--color-text)]">{row.worksiteName}</dd>
        <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatDate(row.createdAt)}</dd>
      </dl>
      {row.invoiceCount > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {row.invoiceCount} factura{row.invoiceCount === 1 ? "" : "s"} asociada{row.invoiceCount === 1 ? "" : "s"}
        </p>
      ) : invoiceDue(row.status) && (
        <p className="mt-2 text-xs font-medium text-signal-ink">Sin factura</p>
      )}
    </Link>
  )
}
