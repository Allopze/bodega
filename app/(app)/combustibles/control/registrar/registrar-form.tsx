"use client"

import * as React from "react"
import { FieldLoadWizard } from "@/components/combustibles/field-load/field-load-wizard"
import type { FieldLoadConfig, FieldLoadSubmitter } from "@/components/combustibles/field-load/types"

/** Registro autenticado: mismo formulario por pasos que la PWA, enviado directo a la API con la sesión. */
export function RegistrarForm({ config }: { config: FieldLoadConfig }) {
  const worksiteId = config.worksite.id
  const submit = React.useCallback<FieldLoadSubmitter>(async (payload, evidence) => {
    const form = new FormData()
    form.set("payload", JSON.stringify(payload))
    for (const item of evidence) form.set(item.kind, new File([item.blob], item.fileName, { type: item.blob.type }))
    try {
      const response = await fetch("/api/combustibles/cargas", { method: "POST", body: form })
      const body = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; field?: string }
      if (response.ok && body.ok) return { kind: "sent" }
      // 4xx: el dato hay que corregirlo; 5xx o sin respuesta: se puede reintentar tal cual.
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        return { kind: "rejected", message: body.message ?? "La plataforma rechazó la carga.", field: body.field }
      }
      return { kind: "failed", message: body.message ?? "No se pudo enviar. Vuelve a intentarlo en un momento." }
    } catch {
      return { kind: "failed", message: "No se pudo enviar. Revisa tu conexión y vuelve a intentarlo: tus datos siguen aquí." }
    }
  }, [])
  const identityTransport = React.useMemo(
    () => ({ url: "/api/combustibles/cargas/identidad", body: (rut: string) => ({ worksiteId, rut }) }),
    [worksiteId],
  )
  return (
    <div className="mx-auto w-full max-w-lg">
      <FieldLoadWizard config={config} scopeKey={`internal:${worksiteId}:${config.loadingPoint?.id ?? "none"}`} submit={submit} identityTransport={identityTransport} shellSearch />
    </div>
  )
}
