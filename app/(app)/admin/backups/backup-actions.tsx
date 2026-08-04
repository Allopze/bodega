"use client"

import { useActionState, useRef, useState, type FormEvent } from "react"
import { Play } from "@phosphor-icons/react/dist/ssr"
import { triggerManualBackupAction } from "./actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

export function BackupsActions() {
  const [state, formAction, pending] = useActionState(triggerManualBackupAction, { ok: true, message: "" })
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

  function confirmBackup() {
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
        <Button
          type="submit"
          disabled={pending}
          size="sm"
        >
          <Play size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Respaldando…" : "Respaldar ahora"}
        </Button>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Ejecutar un respaldo ahora?"
        description="La copia puede tardar varios minutos y registrará una nueva ejecución en el historial. No reemplaza la verificación de restauración."
        confirmLabel="Iniciar respaldo"
        cancelLabel="Cancelar"
        onConfirm={confirmBackup}
      />
    </div>
  )
}
