"use client"

import { useActionState, useRef, useState, type FormEvent } from "react"
import { Play } from "@phosphor-icons/react/dist/ssr"
import { triggerDteSyncAction } from "./actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

export function DteSyncActions() {
  const [state, formAction, pending] = useActionState(triggerDteSyncAction, { ok: true, message: "" })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const confirmedRef = useRef(false)

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    if (!confirmedRef.current) {
      event.preventDefault()
      setConfirmOpen(true)
      return
    }
    confirmedRef.current = false
  }

  function confirmSync() {
    confirmedRef.current = true
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  return (
    <div className="flex items-center gap-2">
      {state.message && (
        <span role="status" className={`text-xs ${state.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {state.message}
        </span>
      )}
      <form ref={formRef} action={formAction} onSubmit={requestConfirmation}>
        <Button type="submit" disabled={pending} size="sm">
          <Play size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Sincronizando…" : "Sincronizar ahora"}
        </Button>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Sincronizar la Bandeja de Entrada ahora?"
        description="Consulta el portal DTE por el mes actual y puede tardar hasta un par de minutos para volúmenes altos. No acepta, rechaza ni modifica documentos en el portal — solo lee."
        confirmLabel="Sincronizar"
        cancelLabel="Cancelar"
        onConfirm={confirmSync}
      />
    </div>
  )
}
