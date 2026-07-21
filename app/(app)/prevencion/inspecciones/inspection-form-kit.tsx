"use client"

import * as React from "react"

type Result = { ok: boolean; message?: string }

/**
 * Estado compartido de los formularios de inspecciones: pendiente + mensaje.
 * El mensaje de error viene del servicio, que es donde viven las reglas (piso
 * de obligatorios, independencia de revisión, versión optimista), así que se
 * muestra tal cual en vez de traducirlo a un texto genérico.
 */
export function useOperation() {
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState("")
  function run(operation: () => Promise<Result>, onSuccess?: () => void) {
    setMessage("")
    startTransition(async () => {
      const result = await operation()
      setMessage(result.ok ? "Guardado correctamente." : result.message ?? "No se pudo completar la acción.")
      if (result.ok) onSuccess?.()
    })
  }
  return { pending, message, run }
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-text-subtle)]">{hint}</span>}
    </label>
  )
}

