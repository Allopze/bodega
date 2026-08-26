"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useTransition } from "react"
import { toast } from "@/lib/toast"
import { Trash } from "@phosphor-icons/react"
import { StateBadge } from "@/components/states/state-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { INITIAL_STATE } from "@/lib/form-state"
import { formatCLP, formatDate, pluralize } from "@/lib/utils"
import { issueAndSendOrderAction } from "./actions/order-status"
import { deleteOrderAction } from "./actions/order-cancel"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { DELETABLE_ORDER_STATUSES } from "@/lib/services/purchasing.constants"
import type { ActionState } from "@/lib/validation/operations"
import type { OcRow } from "./oc-list.types"
import { ocDeleteConfirmDescription, ocDisplayDate } from "./oc-list.types"

/** La factura ya corresponde: llegó mercadería y la OC sigue abierta. */
function invoiceDue(row: OcRow) {
  return row.invoiceNeedsWork
}

function InvoiceCoverageLabel({ status }: { status: OcRow["invoiceReconciliationStatus"] }) {
  if (status === "needs_review") {
    return <span className="inline-flex items-center rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-ink">Revisar conciliación</span>
  }
  if (status === "partially_invoiced") {
    return <span className="inline-flex items-center rounded-full bg-[var(--color-info-tint)] px-2 py-0.5 text-xs font-medium text-[var(--color-info-ink)]">Facturación parcial</span>
  }
  if (status === "awaiting_receipt") {
    return <span className="inline-flex items-center rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">Recepción pendiente</span>
  }
  return null
}


export function OcTableRow({ row, canDelete = false, canSend = false }: { row: OcRow; canDelete?: boolean; canSend?: boolean }) {
  const router = useRouter()
  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueAndSendOrderAction, INITIAL_STATE,
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

  const href = `/compras/${row.id}`

  return (
    <TableRow
      className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
      /* La fila conserva su rol implícito `row`: con role="link" encima, sus
         celdas quedaban sin padre `row` (axe aria-required-parents) y la tabla
         dejaba de anunciarse como tabla. El clic sigue como comodidad de
         mouse; el destino accesible por teclado es el enlace del código. */
      onClick={() => router.push(href)}
    >
      <TableCell>
        <Link
          href={href}
          aria-label={`Ver OC ${row.code}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-xs text-(--color-text) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                >{row.code}</Link>
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
        {row.pendingCostLines > 0 && (
          <span
            className="ml-1 text-[10px] font-normal text-[var(--color-warning-ink)]"
            title={`${row.pendingCostLines} servicio(s) con costo pendiente, no incluidos en el total`}
          >
            +{row.pendingCostLines} pend.
          </span>
        )}
      </TableCellNum>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <StateBadge state={row.status} entity="oc" size="sm" />
          {row.status === "draft" && canSend && (
            <form action={issueAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Emitir y enviar"
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
                description={ocDeleteConfirmDescription(row.code)}
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
        {row.invoiceReconciliationStatus === "needs_review"
          || row.invoiceReconciliationStatus === "partially_invoiced"
          || row.invoiceReconciliationStatus === "awaiting_receipt" ? (
          <InvoiceCoverageLabel status={row.invoiceReconciliationStatus} />
        ) : row.invoiceCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-muted)] text-xs font-medium px-2 py-0.5 tabular-nums">
            {row.invoiceCount}
          </span>
        ) : invoiceDue(row) ? (
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
        {formatDate(ocDisplayDate(row))}
      </TableCell>
    </TableRow>
  )
}

/**
 * A-1: variante móvil de `OcTableRow`. En 390px la tabla mostraba 3 de sus 8
 * columnas, y ni el total ni el estado eran visibles — no se puede reconocer
 * una OC sin ellos (Heurística #6). La tarjeta prioriza código, proveedor,
 * estado y total; la emisión y el envío se resuelven en el detalle.
 */
export function OcMobileCard({
  row,
  canDelete = false,
  canSend = false,
}: {
  row: OcRow
  canDelete?: boolean
  canSend?: boolean
}) {
  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueAndSendOrderAction, INITIAL_STATE,
  )
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteOrderAction, INITIAL_STATE,
  )
  const [deletePending, startDeleteTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  React.useEffect(() => {
    if (!issueState.message) return
    if (issueState.ok) toast.success(issueState.message)
    else toast.error(issueState.message)
  }, [issueState])

  React.useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) toast.success(deleteState.message)
    else toast.error(deleteState.message)
  }, [deleteState])

  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/compras/${row.id}`}
            className="font-mono text-sm font-semibold text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
          >
            {row.code}
          </Link>
          <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{row.supplierName}</p>
        </div>
        <StateBadge state={row.status} entity="oc" size="sm" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-[var(--color-text-subtle)]">Total</dt>
        <dd className="text-right font-mono font-semibold tabular-nums text-[var(--color-text)]">
          {formatCLP(row.totalAmount)}
          {row.pendingCostLines > 0 && (
            <span className="ml-1 font-sans text-[10px] font-normal text-[var(--color-warning-ink)]">
              +{row.pendingCostLines} pend.
            </span>
          )}
        </dd>
        <dt className="text-[var(--color-text-subtle)]">Ítems</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{row.itemCount}</dd>
        <dt className="text-[var(--color-text-subtle)]">Faena</dt>
        <dd className="min-w-0 break-words text-right text-[var(--color-text)]">{row.worksiteName}</dd>
        <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
        <dd className="text-right font-mono tabular-nums text-[var(--color-text)]">{formatDate(ocDisplayDate(row))}</dd>
      </dl>
      {row.invoiceReconciliationStatus === "needs_review" ? (
        <p className="mt-2 text-xs font-medium text-warning-ink">Revisar conciliación</p>
      ) : row.invoiceReconciliationStatus === "partially_invoiced" ? (
        <p className="mt-2 text-xs font-medium text-[var(--color-info-ink)]">Facturación parcial</p>
      ) : row.invoiceReconciliationStatus === "awaiting_receipt" ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Recepción pendiente</p>
      ) : row.invoiceCount > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {pluralize(row.invoiceCount, "factura")} {pluralize(row.invoiceCount, "asociada", "asociadas")}
        </p>
      ) : invoiceDue(row) && (
        <p className="mt-2 text-xs font-medium text-signal-ink">Sin factura</p>
      )}
      {(row.status === "draft" && canSend) || (canDelete && (DELETABLE_ORDER_STATUSES as readonly string[]).includes(row.status)) ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
          {row.status === "draft" && canSend && (
            <form action={issueAction}>
              <input type="hidden" name="orderId" value={row.id} />
              <SubmitButton
                label="Emitir y enviar"
                loadingLabel="Enviando…"
                variant="secondary"
                size="sm"
              />
            </form>
          )}
          {canDelete && (DELETABLE_ORDER_STATUSES as readonly string[]).includes(row.status) && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deletePending}
                onClick={() => setDeleteOpen(true)}
                className="text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
              >
                <Trash size={15} aria-hidden />
                Eliminar OC
              </Button>
              <ConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="¿Eliminar orden de compra?"
                description={ocDeleteConfirmDescription(row.code)}
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
      ) : null}
    </article>
  )
}
