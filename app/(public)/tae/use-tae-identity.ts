"use client"

import * as React from "react"
import { toast } from "@/lib/toast"
import { getTaeIdentity, saveTaeIdentity, type TaeIdentityRole } from "@/lib/pwa/tae-offline-queue"

export interface TaeMatchedWorker {
  id: string
  name: string
}

/** Verificación por RUT reutilizable offline (Fase 0: el conductor completa el formulario). */
export function useTaeIdentity(role: TaeIdentityRole, accessToken: string | null, scopeKey: string | null) {
  const [rut, setRut] = React.useState("")
  const [verifying, setVerifying] = React.useState(false)
  const [matched, setMatched] = React.useState<TaeMatchedWorker | null>(null)

  React.useEffect(() => {
    void (async () => {
      setMatched(null)
      if (!scopeKey) return
      const cached = await getTaeIdentity(scopeKey, role)
      if (cached) setMatched(cached)
    })()
  }, [role, scopeKey])

  async function verify() {
    if (!accessToken || !rut) return
    setVerifying(true)
    try {
      const response = await fetch("/api/tae/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, rut }),
      })
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as { message?: string }
        setMatched(null)
        toast.error(errBody.message ?? "No se pudo verificar el RUT")
        return
      }
      const body = await response.json() as { ok: boolean; data?: TaeMatchedWorker; message?: string }
      if (body.ok && body.data) {
        setMatched(body.data)
        if (scopeKey) await saveTaeIdentity(scopeKey, role, body.data)
        toast.success("Identidad verificada")
      } else {
        setMatched(null)
        toast.error(body.message ?? "No se pudo verificar el RUT")
      }
    } catch {
      toast.error(navigator.onLine ? "Error al verificar el RUT" : "Sin conexión. Completa el nombre manualmente; quedará observado para revisión.")
    } finally {
      setVerifying(false)
    }
  }

  function clear() {
    setMatched(null)
    setRut("")
  }

  function updateRut(value: string) {
    setRut(value)
    if (matched) setMatched(null)
  }

  return { rut, setRut: updateRut, verifying, matched, verify, clear }
}
