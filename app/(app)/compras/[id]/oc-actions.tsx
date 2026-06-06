"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { issueOrderAction, sendOrderAction } from "../actions"
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
  const [issueState, issueAction] = useActionState<ActionState, FormData>(
    issueOrderAction, INITIAL_STATE,
  )
  const [sendState, sendAction] = useActionState<ActionState, FormData>(
    sendOrderAction, INITIAL_STATE,
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

  if (status !== "draft" && status !== "issued") return null

  return (
    <div className="flex items-center gap-3 pt-2">
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
