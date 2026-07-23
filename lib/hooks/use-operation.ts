"use client"

import * as React from "react"

export type OperationResult = { ok: boolean; message?: string }

/**
 * Estado compartido de operaciones en formularios: pendiente (useTransition) + mensaje.
 * El mensaje viene del servicio/action, mostrándose tal cual.
 */
export function useOperation() {
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")

  function run(operation: () => Promise<OperationResult>, onSuccess?: () => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.()
    })
  }

  return { pending, message, setMessage, run }
}
