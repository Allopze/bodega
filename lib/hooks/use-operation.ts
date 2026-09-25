"use client"

import * as React from "react"
import { toast } from "@/lib/toast"

export type OperationResult = { ok: boolean; message?: string; data?: Record<string, unknown> }

export type OperationOptions = {
  /** "message" (default): el resultado se expone en `message`. "toast": se notifica con toast.success/error. */
  feedback?: "message" | "toast"
  /**
   * Callback global de éxito, además del `onSuccess` por operación. Pensado
   * para efectos que acompañan al toast sin tocar cada call site —p. ej.
   * `router.refresh()` para que los server components reciban los datos nuevos.
   */
  onSuccess?: (result: OperationResult) => void
}

/**
 * Estado compartido de operaciones en formularios: pendiente (useTransition) + mensaje.
 * El mensaje viene del servicio/action, mostrándose tal cual.
 */
export function useOperation(options?: OperationOptions) {
  const { feedback = "message", onSuccess: onGlobalSuccess } = options ?? {}
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")

  /**
   * `onSuccess` recibe el resultado completo: algunas acciones devuelven datos
   * que el cliente necesita conservar —p. ej. la nueva `version` de un registro
   * con bloqueo optimista, para que el siguiente envío no choque—. El parámetro
   * es opcional, así que los callbacks sin argumentos siguen siendo válidos.
   *
   * En modo "message", con `onSuccess` el éxito lo comunica quien llama y el
   * hook no guarda «Guardado correctamente.». Casi todos esos callbacks cierran
   * el diálogo que llamó: nadie veía el aviso, que se quedaba en el estado del
   * padre —sigue montado— y reaparecía sobre el formulario vacío al volver a
   * abrirlo. Los errores se muestran igual.
   */
  function run(operation: () => Promise<OperationResult>, onSuccess?: (result: OperationResult) => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        if (feedback === "toast") {
          toast.success(result.message ?? "Cambio registrado")
        } else if (!onSuccess) {
          setMessage("Guardado correctamente.")
        }
        onSuccess?.(result)
        onGlobalSuccess?.(result)
      } else if (feedback === "toast") {
        toast.error(result.message ?? "No se pudo registrar el cambio")
      } else {
        setMessage(result.message ?? "No se pudo completar la acción.")
      }
    })
  }

  return { pending, message, setMessage, run }
}
