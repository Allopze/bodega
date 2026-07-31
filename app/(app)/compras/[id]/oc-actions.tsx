"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { issueOrderAction, sendOrderAction } from "../actions/order-status"
import { cancelOrderAction, closeOrderAction, deleteOrderAction } from "../actions/order-cancel"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Trash, DotsThree } from "@phosphor-icons/react"
import { useTransition } from "react"
import { DELETABLE_ORDER_STATUSES } from "@/lib/services/purchasing.constants"
import { useRouter } from "next/navigation"
import type { ActionState } from "@/lib/validation/operations"

/**
 * Advertencias de conciliación OC↔factura↔recepción, dentro del formulario de
 * cierre.
 *
 * Antes de pulsar "Cerrar orden" el aviso lo da `OcInvoiceCta`, arriba en el
 * mismo rail y con el botón que lo resuelve. Repetirlo también aquí ponía el
 * mismo texto dos veces en un viewport (precedente A-19); aquí queda el detalle
 * completo, que es lo que hace falta al firmar el cierre, más el atajo.
 */
function CloseWarnings({ warnings, invoiceHref }: { warnings: string[]; invoiceHref?: string }) {
  if (warnings.length === 0) return null
  return (
    <div className="rounded bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] p-2 text-xs text-[var(--color-warning-700)]">
      <p className="font-medium mb-1 flex items-center gap-1">
        <Warning size={12} /> Advertencias de conciliación
      </p>
      <ul className="space-y-0.5 list-disc list-inside">
        {warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
      {invoiceHref && (
        <Link href={invoiceHref} className="mt-1.5 inline-block font-medium underline underline-offset-2">
          Ir a Facturación
        </Link>
      )}
    </div>
  )
}

const CANCELLABLE_STATUSES = new Set(["draft", "issued", "sent"])
// El cierre está disponible desde que hay algo recibido: antes de eso la salida
// es anular, no cerrar.
const CLOSEABLE_STATUSES   = new Set([
  "partially_office_received", "office_received", "partially_received", "received",
])

export function OcActions({
  orderId,
  orderCode,
  status,
  canManage,
  canSend,
  canDelete = false,
  closeWarnings = [],
}: {
  orderId:        string
  orderCode:      string
  status:         string
  canManage:      boolean
  canSend:        boolean
  canDelete?:     boolean
  closeWarnings?: string[]
}) {
  const router = useRouter()
  const [showCancelForm, setShowCancelForm] = React.useState(false)
  const [showCloseForm,  setShowCloseForm]  = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const [issueState,   issueAction]   = useActionState<ActionState, FormData>(issueOrderAction,   INITIAL_STATE)
  const [sendState,    sendAction]    = useActionState<ActionState, FormData>(sendOrderAction,    INITIAL_STATE)
  const [cancelState,  cancelAction]  = useActionState<ActionState, FormData>(cancelOrderAction,  INITIAL_STATE)
  const [closeState,   closeAction]   = useActionState<ActionState, FormData>(closeOrderAction,   INITIAL_STATE)
  const [deleteState,  deleteAction]  = useActionState<ActionState, FormData>(deleteOrderAction,  INITIAL_STATE)
  const [deletePending, startDeleteTransition] = useTransition()

  React.useEffect(() => {
    if (issueState.ok && issueState.message) toast.success(issueState.message)
    else if (!issueState.ok && issueState.message && issueState !== INITIAL_STATE) toast.error(issueState.message)
  }, [issueState])

  React.useEffect(() => {
    if (sendState.ok && sendState.message) toast.success(sendState.message)
    else if (!sendState.ok && sendState.message && sendState !== INITIAL_STATE) toast.error(sendState.message)
  }, [sendState])

  React.useEffect(() => {
    if (cancelState.ok && cancelState.message) {
      toast.success(cancelState.message)
      setShowCancelForm(false)
    } else if (!cancelState.ok && cancelState.message && cancelState !== INITIAL_STATE) {
      toast.error(cancelState.message)
    }
  }, [cancelState])

  React.useEffect(() => {
    if (closeState.ok && closeState.message) {
      toast.success(closeState.message)
      setShowCloseForm(false)
    } else if (!closeState.ok && closeState.message && closeState !== INITIAL_STATE) {
      toast.error(closeState.message)
    }
  }, [closeState])

  React.useEffect(() => {
    if (!deleteState.message) return
    if (deleteState.ok) {
      toast.success(deleteState.message)
      router.push("/compras")
    } else {
      toast.error(deleteState.message)
    }
  }, [deleteState, router])

  const isActionable =
    CANCELLABLE_STATUSES.has(status) ||
    CLOSEABLE_STATUSES.has(status) ||
    (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)

  if (!isActionable) return null

  // ── Close form ────────────────────────────────────────────────────────────
  if (showCloseForm) {
    return (
      <form
        action={closeAction}
        className="flex flex-col gap-2 mt-2 max-w-md border border-(--color-border) p-3.5 rounded-(--radius) bg-surface-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <label className="text-xs font-semibold text-(--color-text)">
          Motivo de cierre <span className="text-danger">*</span>
        </label>
        <p className="text-xs text-(--color-text-muted)">
          {status === "received"
            ? "La orden ya fue recibida completamente. Indica el motivo del cierre formal."
            : "Indica el motivo por el que se cierra la orden (ítems rechazados, dañados, etc.)."}
        </p>
        <textarea
          name="reason"
          placeholder="Ej: ítems dañados no serán repuestos, acuerdo con proveedor..."
          required
          aria-label="Motivo del cierre"
          className="w-full text-xs p-2 rounded border border-(--color-border-control) bg-(--color-surface) resize-none"
          rows={3}
        />
        {!closeState.ok && closeState.message && closeState !== INITIAL_STATE && (
          <p className="text-xs text-danger flex items-center gap-1">
            <Warning size={12} /> {closeState.message}
          </p>
        )}
        <CloseWarnings warnings={closeWarnings} invoiceHref={`/compras/${orderId}?tab=facturacion`} />
        {/* Cerrar sin factura conciliada es legítimo (servicios, notas de
            crédito, acuerdos), pero deja de ser el camino por defecto: se
            confirma a mano y la confirmación queda en el motivo y el historial.
            El servidor lo revalida; esta casilla no es la única defensa. */}
        {closeWarnings.length > 0 && (
          <label className="flex items-start gap-2 text-xs text-(--color-text)">
            <input
              type="checkbox"
              name="acknowledgeInvoiceWarnings"
              value="true"
              required
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-danger)]"
            />
            <span>
              Confirmo que la orden se cierra sin la facturación conciliada y que queda registrado en su historial.
            </span>
          </label>
        )}
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={() => setShowCloseForm(false)}
            className="text-xs px-2.5 py-1.5 rounded hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Volver
          </button>
          <SubmitButton
            label="Cerrar OC"
            loadingLabel="Cerrando..."
            variant="destructive"
            size="sm"
          />
        </div>
      </form>
    )
  }

  // ── Cancel form ───────────────────────────────────────────────────────────
  if (showCancelForm) {
    return (
      <form
        action={cancelAction}
        className="flex flex-col gap-2 mt-2 max-w-md border border-danger p-3.5 rounded-(--radius) bg-surface-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <label className="text-xs font-semibold text-danger">Motivo de anulación (obligatorio)</label>
        <textarea
          name="reason"
          placeholder="Explique el motivo por el cual se anula esta orden de compra..."
          required
          aria-label="Motivo de anulación"
          className="w-full text-xs p-2 rounded border border-(--color-border-control) bg-(--color-surface) resize-none"
          rows={3}
        />
        {!cancelState.ok && cancelState.message && cancelState !== INITIAL_STATE && (
          <p className="text-xs text-danger flex items-center gap-1">
            <Warning size={12} /> {cancelState.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={() => setShowCancelForm(false)}
            className="text-xs px-2.5 py-1.5 rounded hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Volver
          </button>
          <SubmitButton
            label="Confirmar anulación"
            loadingLabel="Anulando..."
            variant="destructive"
            size="sm"
          />
        </div>
      </form>
    )
  }

  // ── Main action bar ───────────────────────────────────────────────────────
  const canCancel = CANCELLABLE_STATUSES.has(status) && canManage
  const canEliminar = canDelete && (DELETABLE_ORDER_STATUSES as readonly string[]).includes(status)
  const hasDestructive = canCancel || canEliminar

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {/* ── Acción primaria ──────────────────────────────────────────────── */}
        {status === "draft" && canManage && (
          <form action={issueAction} className="w-full">
            <input type="hidden" name="orderId" value={orderId} />
            <SubmitButton label="Emitir orden" loadingLabel="Emitiendo..." variant="primary" className="w-full" />
          </form>
        )}

        {status === "issued" && canSend && (
          <form action={sendAction} className="w-full">
            <input type="hidden" name="orderId" value={orderId} />
            <SubmitButton label="Marcar como enviada" loadingLabel="Guardando..." variant="primary" className="w-full" />
          </form>
        )}

        {CLOSEABLE_STATUSES.has(status) && canManage && (
          <button
            type="button"
            onClick={() => setShowCloseForm(true)}
            className="flex-1 text-xs font-medium text-(--color-text) border border-(--color-border) hover:bg-surface-2 px-3.5 py-2 rounded-(--radius) transition-colors cursor-pointer"
          >
            Cerrar orden
          </button>
        )}

        {/* ── Destructivas: menú overflow, separadas de la primaria ─────────── */}
        {hasDestructive && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Más acciones"
              className="inline-flex items-center justify-center rounded-(--radius) border border-(--color-border) p-2 text-(--color-text-muted) hover:bg-surface-2 transition-colors cursor-pointer"
            >
              <DotsThree size={16} weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canCancel && (
                <DropdownMenuItem
                  onSelect={() => setShowCancelForm(true)}
                  className="gap-2 text-danger"
                >
                  <Warning size={14} /> Anular orden
                </DropdownMenuItem>
              )}
              {canEliminar && (
                <DropdownMenuItem
                  disabled={deletePending}
                  onSelect={() => setDeleteOpen(true)}
                  className="gap-2 text-danger"
                >
                  <Trash size={14} /> Eliminar orden
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canEliminar && (
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="¿Eliminar orden de compra?"
            description={`La orden ${orderCode} será eliminada permanentemente junto con sus ítems y facturas adjuntas. Los ítems de la solicitud original volverán a estado pendiente. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            variant="destructive"
            loading={deletePending}
            onConfirm={() => {
              const fd = new FormData()
              fd.set("orderId", orderId)
              startDeleteTransition(() => deleteAction(fd))
              setDeleteOpen(false)
            }}
          />
        )}
      </div>

      {/* Error inline */}
      {!issueState.ok && issueState.message && issueState !== INITIAL_STATE && (
        <p className="text-sm text-danger flex items-center gap-1.5 justify-end">
          <Warning size={14} /> {issueState.message}
        </p>
      )}
      {!sendState.ok && sendState.message && sendState !== INITIAL_STATE && (
        <p className="text-sm text-danger flex items-center gap-1.5 justify-end">
          <Warning size={14} /> {sendState.message}
        </p>
      )}
    </div>
  )
}
