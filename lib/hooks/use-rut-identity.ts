"use client"

import * as React from "react"
import { toast } from "@/lib/toast"

export type RutIdentityResult<T> =
  | { ok: true; matched: T }
  | { ok: false; message?: string }

export interface RutIdentityOptions<T> {
  /** Resuelve un RUT contra su backend (server action o fetch). */
  verify: (rut: string) => Promise<RutIdentityResult<T>>
  /** Restaura un match previo (caché offline), si existe. */
  loadMatched?: () => Promise<T | null>
  /** Antes de cada verificación (limpiar estado derivado, faena, etc.). */
  onBeforeVerify?: () => void
  /** Tras un match exitoso (persistir caché, cambiar faena, fijar RUT). */
  onMatched?: (matched: T) => void | Promise<void>
  /** Al editar el RUT, descarta el match anterior (comportamiento TAE). */
  clearMatchedOnEdit?: boolean
  messages?: {
    success?: string
    notFound?: string
    error?: string | (() => string)
  }
}

/**
 * Máquina compartida de verificación de identidad por RUT: entrada →
 * verificando → match/error, con toasts y reset. Antes PPA y TAE tenían cada
 * uno su versión del mismo esqueleto con backends distintos (server action vs
 * fetch offline); las particularidades quedan en los wrappers vía callbacks.
 */
export function useRutIdentity<T>({
  verify,
  loadMatched,
  onBeforeVerify,
  onMatched,
  clearMatchedOnEdit = false,
  messages,
}: RutIdentityOptions<T>) {
  const [rut, setRut] = React.useState("")
  const [verifying, setVerifying] = React.useState(false)
  const [matched, setMatched] = React.useState<T | null>(null)

  React.useEffect(() => {
    if (!loadMatched) return
    let cancelled = false
    void loadMatched().then((cached) => {
      if (!cancelled && cached) setMatched(cached)
    })
    return () => { cancelled = true }
  }, [loadMatched])

  const updateRut = React.useCallback(
    (value: string) => {
      setRut(value)
      if (clearMatchedOnEdit && matched) setMatched(null)
    },
    [clearMatchedOnEdit, matched],
  )

  const verifyRut = React.useCallback(async () => {
    if (!rut || verifying) return
    setVerifying(true)
    setMatched(null)
    onBeforeVerify?.()
    try {
      const result = await verify(rut)
      if (result.ok) {
        setMatched(result.matched)
        toast.success(messages?.success ?? "Identidad verificada")
        await onMatched?.(result.matched)
      } else {
        toast.error(result.message ?? messages?.notFound ?? "No se encontró el trabajador.")
      }
    } catch {
      const fallback = messages?.error
      toast.error(typeof fallback === "function" ? fallback() : (fallback ?? "Error al verificar el RUT"))
    } finally {
      setVerifying(false)
    }
  }, [rut, verifying, verify, onBeforeVerify, onMatched, messages])

  const clear = React.useCallback(() => {
    setMatched(null)
    setRut("")
  }, [])

  const resetMatch = React.useCallback(() => {
    setMatched(null)
  }, [])

  return { rut, setRut: updateRut, verifying, matched, verify: verifyRut, clear, resetMatch }
}
