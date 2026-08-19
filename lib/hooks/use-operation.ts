"use client"

import * as React from "react"

export type OperationResult = { ok: boolean; message?: string; data?: Record<string, unknown> }

/**
 * Estado compartido de operaciones en formularios: pendiente (useTransition) + mensaje.
 * El mensaje viene del servicio/action, mostrándose tal cual.
 */
export function useOperation() {
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")

  /**
   * `onSuccess` recibe el resultado completo: algunas acciones devuelven datos
   * que el cliente necesita conservar —p. ej. la nueva `version` de un registro
   * con bloqueo optimista, para que el siguiente envío no choque—. El parámetro
   * es opcional, así que los callbacks sin argumentos siguen siendo válidos.
   */
  function run(operation: () => Promise<OperationResult>, onSuccess?: (result: OperationResult) => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.(result)
    })
  }

  return { pending, message, setMessage, run }
}
