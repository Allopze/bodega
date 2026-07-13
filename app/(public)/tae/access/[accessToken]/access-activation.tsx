"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleNotch } from "@phosphor-icons/react"
import { saveTaeAccessConfig, saveTaeAccessToken } from "@/lib/pwa/tae-offline-queue"

export function TaeAccessActivation({ accessToken }: { accessToken: string }) {
  const router = useRouter()
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    fetch("/api/tae/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    })
      .then(async (response) => {
        const body = await response.json() as { ok: boolean; data?: Record<string, unknown>; message?: string }
        if (!response.ok || !body.ok || !body.data) throw new Error(body.message ?? "Este enlace TAE no está disponible")
        await Promise.all([saveTaeAccessToken(accessToken), saveTaeAccessConfig(body.data)])
        router.replace("/tae")
      })
      .catch(() => setError("No se pudo preparar este dispositivo. Habilita el almacenamiento del navegador e inténtalo nuevamente."))
  }, [accessToken, router])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-6">
      <div className="w-full rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-[var(--shadow-lg)]">
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : <>
          <CircleNotch size={30} className="mx-auto animate-spin text-[var(--color-primary)]" />
          <h1 className="mt-4 text-h2">Preparando Control TAE</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Este enlace configurará la faena y el punto de carga en este dispositivo.</p>
        </>}
      </div>
    </main>
  )
}
