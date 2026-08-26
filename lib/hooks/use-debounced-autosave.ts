"use client"

import * as React from "react"
import type { ActionState } from "@/lib/validation/operations"

export type AutosaveStatus = "saved" | "saving" | "dirty" | "error"

/**
 * Guarda automáticamente tras una pausa de tecleo, reusando la misma Server
 * Action que un botón explícito. No agenda un nuevo intento mientras el
 * anterior sigue en vuelo y advierte con `beforeunload` si queda algo sin
 * guardar. Generaliza el patrón introducido en `MetadataTab`
 * (app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx).
 *
 * `watchKey` debe cambiar (por valor, no por referencia) cada vez que el
 * campo vigilado cambia — un string/number derivado de los campos, o el
 * propio valor si es primitivo. `onSave` puede cambiar de identidad en cada
 * render sin romper el debounce: se lee desde un ref, no desde la deps del
 * efecto, así el caller no necesita memoizarla con `useCallback`.
 */
export function useDebouncedAutosave({
  watchKey,
  isDirty,
  onSave,
  onSaved,
  enabled = true,
  debounceMs = 1500,
}: {
  watchKey: string | number
  isDirty: boolean
  onSave: () => Promise<ActionState>
  /** Se invoca tras un guardado exitoso, con el resultado. Pensado para UIs
   *  que muestran "Guardado HH:MM" o refrescan datos derivados. */
  onSaved?: (result: ActionState) => void
  enabled?: boolean
  debounceMs?: number
}): { status: AutosaveStatus; error: string | null; saveNow: () => Promise<void> } {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const onSaveRef = React.useRef(onSave)
  React.useEffect(() => {
    onSaveRef.current = onSave
  })
  const onSavedRef = React.useRef(onSaved)
  React.useEffect(() => {
    onSavedRef.current = onSaved
  })
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSave = React.useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const result = await onSaveRef.current()
      if (!result.ok) setError(result.message ?? "Error al guardar.")
      else onSavedRef.current?.(result)
    } catch {
      // Falla de red u otra excepción no controlada (no la Server Action
      // devolviendo ok:false, sino que ni siquiera respondió): sin este
      // catch, el error quedaba silencioso — pending se limpiaba pero el
      // usuario nunca se enteraba de que no se guardó nada. isDirty sigue
      // en true, así que el próximo cambio o el reintento automático del
      // debounce (el efecto se re-arma en cuanto pending vuelve a false)
      // lo vuelve a intentar sin acción adicional del usuario.
      setError("Error de red al guardar. Se reintentará automáticamente.")
    } finally {
      setPending(false)
    }
  }, [])

  React.useEffect(() => {
    if (!enabled || !isDirty || pending) return
    timeoutRef.current = setTimeout(() => { void runSave() }, debounceMs)
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [watchKey, isDirty, enabled, pending, debounceMs, runSave])

  React.useEffect(() => {
    if (!enabled) return
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [isDirty, enabled])

  // Permite a un botón explícito guardar de inmediato, cancelando el
  // debounce pendiente y compartiendo el mismo estado pending/error.
  const saveNow = React.useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    await runSave()
  }, [runSave])

  const status: AutosaveStatus = pending ? "saving" : error ? "error" : isDirty ? "dirty" : "saved"
  return { status, error, saveNow }
}

/** Texto corto para mostrar el estado de autoguardado junto a un campo. */
export function autosaveStatusLabel(status: AutosaveStatus): string {
  if (status === "saving") return "Guardando…"
  if (status === "dirty") return "Cambios sin guardar"
  if (status === "error") return "Error al guardar"
  return "Guardado"
}
