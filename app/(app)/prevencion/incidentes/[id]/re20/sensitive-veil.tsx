"use client"

import * as React from "react"
import { LockKey } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useRe20 } from "./use-re20-workspace"

/**
 * Velo de los datos reservados (declaraciones, entrevista, DIAT, anexos): sin
 * permiso explica a quién pedirlo; con permiso pide «para qué» y recarga el caso
 * con ese propósito auditado. Abierto, muestra `children`.
 */
export function Re20SensitiveVeil({ title = "Datos reservados", description, children, standalone = false }: {
  title?: string
  /** Qué hay detrás, en una línea («Las declaraciones identifican a quienes declaran»). */
  description?: string
  children?: React.ReactNode
  /**
   * Sólo el shell: en modo sólo lectura la etapa va en un `<fieldset disabled>`
   * que también apagaría este formulario, así que el shell monta el velo afuera
   * y los velos de las etapas remiten a él.
   */
  standalone?: boolean
}) {
  const ws = useRe20()
  const inputId = React.useId()
  const [purpose, setPurpose] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  if (ws.sensitiveAvailable) return <>{children}</>

  if (!ws.permissions.canSensitive) {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
        <LockKey aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]" />
        <div>
          <p className="font-medium text-[var(--color-text)]">{title}</p>
          <p className="mt-0.5 text-[var(--color-text-muted)]">Tu perfil no tiene acceso a datos reservados. Pide a Prevención de Riesgos que complete esta parte.</p>
        </div>
      </div>
    )
  }

  if (ws.readOnly && !standalone) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <LockKey aria-hidden className="size-4 shrink-0" />
        {title}: para verlos usa «Ver con propósito» al inicio del expediente.
      </p>
    )
  }

  async function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (purpose.trim().length < 3) return
    setBusy(true)
    // Abrir recarga el caso: lo que no esté guardado se guarda antes.
    const saved = await ws.ensureSaved()
    if (saved === null && ws.dirty) { setBusy(false); return }
    const url = new URL(window.location.href)
    url.searchParams.set("sensitive", "1")
    url.searchParams.set("purpose", purpose.trim())
    url.searchParams.set("etapa", ws.stage)
    window.location.assign(`${url.pathname}${url.search}`)
  }

  return (
    <form onSubmit={open} className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <LockKey aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description ?? "Esta parte identifica a personas. Para verla, indica para qué la necesitas: queda registrado."}</p>
          {ws.sensitiveLoadError && <p role="alert" className="mt-1 text-sm text-[var(--color-danger-ink)]">{ws.sensitiveLoadError}</p>}
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label="Para qué la necesitas" htmlFor={inputId}>
            <Input id={inputId} value={purpose} onChange={(event) => setPurpose(event.target.value)} minLength={3} maxLength={300} placeholder="Investigación del incidente" required />
          </Field>
          <Button type="submit" variant="secondary" loading={busy} disabled={purpose.trim().length < 3 || ws.offlineOnly || !ws.online}>Ver con propósito</Button>
        </div>
      </div>
    </form>
  )
}
