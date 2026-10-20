"use client"

import * as React from "react"
import { reportBoundaryError } from "@/lib/observability/sentry-client"
import { toast } from "@/lib/toast"

export type OperationResult = {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
  /** Errores por campo (forma de `parseZ` / `actionErrorResult`). */
  fieldErrors?: Record<string, string[]>
  /**
   * El envío ni siquiera llegó al servidor (sin conexión o la red falló). Solo
   * lo fija el propio hook cuando la acción lanza; una acción que responde
   * `ok: false` no lo trae. Sirve para ofrecer guardar en el dispositivo en
   * vez de pedir que se reintente.
   */
  offline?: boolean
}

/** Qué comunica `message`: un error y un aviso de éxito no se pintan igual. */
export type MessageTone = "success" | "error" | "neutral"

const OFFLINE_MESSAGE = "Sin conexión: no se pudo enviar. Revisa la señal e inténtalo de nuevo."
const GENERIC_FAILURE_MESSAGE = "No se pudo completar la acción. Inténtalo de nuevo."

/**
 * ¿La Server Action falló por red? No se usa `isNetworkError` de `lib/network-error`: está
 * pensado para error boundaries y acepta cualquier mensaje con «typeerror» o «fetch», así que
 * un error de programación diría «Sin conexión».
 */
function isOfflineFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  return error instanceof TypeError && /failed to fetch|fetch failed|network|load failed/i.test(error.message)
}

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
  const [message, setMessageState] = React.useState("")
  const [messageTone, setMessageTone] = React.useState<MessageTone>("neutral")
  // Antes el hook descartaba `fieldErrors`: aunque la acción dijera qué campo
  // fallaba, el diálogo sólo podía mostrar «Revisa los campos marcados.».
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  /** Texto que quien llama quiere mostrar; el tono por defecto es neutro. */
  const setMessage = React.useCallback((next: string, tone: MessageTone = "neutral") => {
    setMessageState(next)
    setMessageTone(next ? tone : "neutral")
  }, [])

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
   *
   * `onFailure` se llama cuando la operación falla, ya sea porque responde `ok: false` o porque
   * lanza (típicamente, sin conexión): en ese segundo caso el resultado trae `offline` y el
   * hook no deja que la excepción llegue al error boundary de la página, que descartaba
   * la pantalla entera con todo lo que la persona había escrito.
   */
  function run(
    operation: () => Promise<OperationResult>,
    onSuccess?: (result: OperationResult) => void,
    onFailure?: (result: OperationResult) => void,
  ) {
    setMessage("")
    setFieldErrors({})
    startTransition(async () => {
      let result: OperationResult
      try {
        result = await operation()
      } catch (error) {
        const offline = isOfflineFailure(error)
        // Un fallo de red tiene su propio aviso; cualquier otra excepción es un
        // defecto o un error del servidor y no puede perderse en silencio: antes
        // llegaba al error boundary, que la registraba en la consola y en Sentry.
        if (!offline) {
          console.error(error)
          reportBoundaryError(error instanceof Error ? error : new Error(String(error)))
        }
        result = { ok: false, offline, message: offline ? OFFLINE_MESSAGE : GENERIC_FAILURE_MESSAGE }
      }
      if (!result.ok && result.fieldErrors) setFieldErrors(result.fieldErrors)
      if (result.ok) {
        if (feedback === "toast") {
          toast.success(result.message ?? "Cambio registrado")
        } else if (!onSuccess) {
          setMessage("Guardado correctamente.", "success")
        }
        onSuccess?.(result)
        onGlobalSuccess?.(result)
      } else {
        if (feedback === "toast") {
          toast.error(result.message ?? "No se pudo registrar el cambio")
        } else {
          setMessage(result.message ?? "No se pudo completar la acción.", "error")
        }
        onFailure?.(result)
      }
    })
  }

  /** Primer error del campo, listo para `<Field error={fieldError("nombre")}>`. */
  const fieldError = React.useCallback((name: string) => fieldErrors[name]?.[0], [fieldErrors])

  return { pending, message, messageTone, setMessage, fieldErrors, fieldError, run }
}
