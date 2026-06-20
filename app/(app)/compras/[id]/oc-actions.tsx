"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { issueOrderAction, sendOrderAction, cancelOrderAction } from "../actions"
import type { ActionState } from "@/lib/validation/operations"

export function OcActions({
  orderId,
  status,
  canManage,
  canSend,
}: {
  orderId:   string
  status:    string
  canManage: boolean
  canSend:   boolean
}) {
  const [showCancelForm, setShowCancelForm] = React.useState(false)

  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueOrderAction, INITIAL_STATE,
  )
  const [sendState, sendAction] = useActionState<ActionState, FormData>(
    sendOrderAction, INITIAL_STATE,
  )
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(
    cancelOrderAction, INITIAL_STATE,
  )

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

  React.useEffect(() => {
    if (cancelState.ok && cancelState.message) {
      toast.success(cancelState.message)
      setShowCancelForm(false)
    } else if (cancelState.ok === false && cancelState.message && cancelState !== INITIAL_STATE) {
      toast.error(cancelState.message)
    }
  }, [cancelState])

  if (status !== "draft" && status !== "issued" && status !== "sent") return null

  if (showCancelForm) {
    return (
      <form action={cancelAction} className="flex flex-col gap-2 mt-2 max-w-md border border-[var(--color-danger)] p-3.5 rounded-[var(--radius)] bg-[var(--color-surface-2)]">
        <input type="hidden" name="orderId" value={orderId} />
        <label className="text-xs font-semibold text-[var(--color-danger)]">Motivo de anulación (obligatorio)</label>
        <textarea
          name="reason"
          placeholder="Explique el motivo por el cual se anula esta orden de compra..."
          required
          className="w-full text-xs p-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] resize-none"
          rows={3}
        />
        {cancelState.ok === false && cancelState.message && cancelState !== INITIAL_STATE && (
          <p className="text-xs text-[var(--color-danger)] flex items-center gap-1">
            <Warning size={12} /> {cancelState.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={() => setShowCancelForm(false)}
            className="text-xs px-2.5 py-1.5 rounded hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
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

  return (
    <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
      {status === "draft" && canManage && (
        <form action={issueAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <SubmitButton
            label="Emitir orden"
            loadingLabel="Emitiendo..."
            variant="primary"
          />
        </form>
      )}
      {status === "issued" && canSend && (
        <form action={sendAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <SubmitButton
            label="Marcar como enviada"
            loadingLabel="Guardando..."
            variant="primary"
          />
        </form>
      )}
      {canManage && (
        <button
          type="button"
          onClick={() => setShowCancelForm(true)}
          className="text-xs font-medium text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] px-3.5 py-2 rounded-[var(--radius)] transition-colors cursor-pointer"
        >
          Anular orden
        </button>
      )}
      {issueState.ok === false && issueState.message && issueState !== INITIAL_STATE && (
        <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
          <Warning size={14} /> {issueState.message}
        </p>
      )}
      {sendState.ok === false && sendState.message && sendState !== INITIAL_STATE && (
        <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
          <Warning size={14} /> {sendState.message}
        </p>
      )}
    </div>
  )
}
