"use client"

import * as React from "react"
import { useRutIdentity, type RutIdentityResult } from "@/lib/hooks/use-rut-identity"
import { getTaeIdentity, saveTaeIdentity, type TaeIdentityRole } from "@/lib/pwa/tae-offline-queue"

export interface TaeMatchedWorker {
  id: string
  name: string
}

/** Verificación por RUT reutilizable offline (Fase 0: el conductor completa el formulario).
 *  La máquina de verificación vive en `useRutIdentity`; acá queda el backend
 *  específico de TAE (fetch con accessToken + caché offline por scopeKey). */
export function useTaeIdentity(role: TaeIdentityRole, accessToken: string | null, scopeKey: string | null) {
  const verifyByRut = React.useCallback(
    async (rut: string): Promise<RutIdentityResult<TaeMatchedWorker>> => {
      const response = await fetch("/api/tae/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, rut }),
      })
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as { message?: string }
        return { ok: false, message: errBody.message ?? "No se pudo verificar el RUT" }
      }
      const body = await response.json() as { ok: boolean; data?: TaeMatchedWorker; message?: string }
      if (body.ok && body.data) return { ok: true, matched: body.data }
      return { ok: false, message: body.message ?? "No se pudo verificar el RUT" }
    },
    [accessToken],
  )

  const loadCached = React.useCallback(async () => {
    if (!scopeKey) return null
    return getTaeIdentity(scopeKey, role)
  }, [scopeKey, role])

  const identity = useRutIdentity<TaeMatchedWorker>({
    verify: verifyByRut,
    loadMatched: loadCached,
    clearMatchedOnEdit: true,
    onMatched: React.useCallback(async (matched: TaeMatchedWorker) => {
      if (scopeKey) await saveTaeIdentity(scopeKey, role, matched)
    }, [scopeKey, role]),
    messages: {
      success: "Identidad verificada",
      notFound: "No se pudo verificar el RUT",
      error: () => navigator.onLine
        ? "Error al verificar el RUT"
        : "Sin conexión. Completa el nombre manualmente; quedará observado para revisión.",
    },
  })

  const verify = React.useCallback(async () => {
    if (!accessToken) return
    await identity.verify()
    // identity.verify es estable (useCallback interno con deps propias);
    // se incluye en deps por completitud, no cambia entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  return {
    rut: identity.rut,
    setRut: identity.setRut,
    verifying: identity.verifying,
    matched: identity.matched,
    verify,
    clear: identity.clear,
  }
}
