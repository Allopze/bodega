"use client"

import * as React from "react"

type Result = { ok: boolean; message?: string }

/**
 * Estado compartido de los formularios de CPHS: pendiente + mensaje. El
 * mensaje de error viene del servicio, que es donde viven las reglas
 * (paridad, quórum, cierre con conclusiones), así que se muestra tal cual en
 * vez de traducirlo a un texto genérico.
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

export const selectClass = "h-10 rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm"

/** `datetime-local` exige `YYYY-MM-DDTHH:mm` en hora local, no un ISO en UTC. */
export function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
