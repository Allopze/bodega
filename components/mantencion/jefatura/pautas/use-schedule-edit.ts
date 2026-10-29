"use client"

import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/** Lo que devuelven las acciones del editor: el resultado del servicio, ya en español. */
export type EditOutcome<T = unknown> =
  | { ok: true; message?: string; version?: number; data?: T }
  | { ok: false; message: string; field?: string }

/**
 * Una edición de pauta con el mismo contrato para todo el editor: corre la
 * acción, avisa el resultado con un toast y deja `pending` para marcar la
 * pantalla como ocupada. Los errores se muestran siempre; el éxito lo comunica
 * quien llama (a veces con «Deshacer»).
 */
export function useScheduleEdit() {
  const op = useOperation()

  function edit<T>(
    call: () => Promise<EditOutcome<T>>,
    onDone?: (outcome: Extract<EditOutcome<T>, { ok: true }>) => void,
    onFail?: () => void,
  ) {
    op.run(
      async () => {
        const outcome = await call()
        return { ok: outcome.ok, message: outcome.message, data: outcome.ok ? { outcome } : undefined }
      },
      (result) => onDone?.(result.data?.outcome as Extract<EditOutcome<T>, { ok: true }>),
      (result) => {
        toast.error(result.message ?? "No se pudo guardar el cambio.")
        onFail?.()
      },
    )
  }

  return { pending: op.pending, edit }
}

/** Aviso con «Deshacer» (regla 15: quitar es inactivar, así que deshacer lo restituye). */
export function toastWithUndo(message: string, undo: () => void) {
  toast(message, { action: { label: "Deshacer", onClick: undo }, duration: 8000 })
}
