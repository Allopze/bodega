"use client"

import * as React from "react"
import { LockKey, LockKeyOpen } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { cn } from "@/lib/utils"

/* Bóveda cifrada del dispositivo: UNA sola interfaz para abrirla, crearla y
 * cerrarla. La usan el expediente RE-20, el formulario de reporte y la pantalla
 * pública sin conexión. Quien la monta decide cuándo se ve (hay borradores
 * guardados, no hay conexión o la persona pidió trabajar sin conexión). */

export const RE20_VAULT_MIN_PASSPHRASE = 12

export interface Re20VaultProfile {
  userId: string
  label: string
}

export interface Re20VaultGateProps {
  /** La bóveda ya existe en este dispositivo (se abre) o no (se crea). */
  configured: boolean
  unlocked: boolean
  /** Lanza un Error con un mensaje para la persona si la frase no sirve. */
  onUnlock: (passphrase: string, profileUserId?: string) => Promise<void>
  onLock?: () => void
  /** Sin sesión (pantalla pública): elegir de qué perfil local es la bóveda. */
  profiles?: Re20VaultProfile[]
  /** Qué hay guardado, en una línea («2 reportes sin enviar»). */
  pendingSummary?: string | null
  /** Por qué se muestra ahora, en una línea. Por defecto, un texto general. */
  reason?: string
  /** Acciones con la bóveda abierta («Guardar copia ahora», «Actualizar lista»). */
  unlockedActions?: React.ReactNode
  className?: string
}

export function Re20VaultGate({ configured, unlocked, onUnlock, onLock, profiles, pendingSummary, reason, unlockedActions, className }: Re20VaultGateProps) {
  const fieldId = React.useId()
  const [passphrase, setPassphrase] = React.useState("")
  const [chosenProfile, setProfileUserId] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const needsProfile = profiles !== undefined
  const noProfiles = needsProfile && profiles.length === 0
  // La lista de perfiles llega después del primer render (IndexedDB): sin elección, el primero.
  const profileUserId = chosenProfile || profiles?.[0]?.userId || ""

  // Sin <form>: el formulario de reporte la contiene y un form anidado no es HTML válido.
  async function submit() {
    if (passphrase.trim().length < RE20_VAULT_MIN_PASSPHRASE) {
      setError(`La frase debe tener al menos ${RE20_VAULT_MIN_PASSPHRASE} caracteres.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onUnlock(passphrase, needsProfile ? profileUserId : undefined)
      setPassphrase("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la bóveda. Revisa la frase e inténtalo de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  if (unlocked) {
    return (
      <section aria-label="Bóveda de este dispositivo" className={cn("flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3", className)}>
        <LockKeyOpen aria-hidden className="size-5 shrink-0 text-[var(--color-success-ink)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text)]">Bóveda abierta en este dispositivo</p>
          <p className="text-xs text-[var(--color-text-muted)]">{pendingSummary ?? "Lo que guardes aquí queda cifrado aunque se corte la conexión."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unlockedActions}
          {onLock && <Button type="button" variant="ghost" size="sm" onClick={onLock}><LockKey aria-hidden className="size-4" />Cerrar bóveda</Button>}
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby={`${fieldId}-title`} className={cn("rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4", className)}>
      <div className="flex items-start gap-3">
        <LockKey aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 id={`${fieldId}-title`} className="text-sm font-semibold text-[var(--color-text)]">
              {noProfiles ? "No hay una bóveda en este dispositivo" : configured || needsProfile ? "Abre la bóveda de este dispositivo" : "Crea una bóveda para trabajar sin conexión"}
            </h3>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {noProfiles
                ? "Para preparar trabajo sin conexión, abre un incidente con conexión y crea la bóveda desde ahí."
                : reason ?? (configured
                  ? "Tus borradores están cifrados con la frase de este dispositivo. Es distinta de tu contraseña."
                  : "Elige una frase solo para este dispositivo. Con ella se cifran los borradores y nadie más puede leerlos.")}
            </p>
            {pendingSummary && !noProfiles && <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{pendingSummary}</p>}
          </div>
          {!noProfiles && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-3">
                {needsProfile && profiles.length > 1 && (
                  <Field label="Bóveda" htmlFor={`${fieldId}-profile`}>
                    <OptionSelect id={`${fieldId}-profile`} options={profiles.map((profile) => ({ value: profile.userId, label: profile.label }))} value={profileUserId} onValueChange={setProfileUserId} />
                  </Field>
                )}
                <Field label="Frase del dispositivo" htmlFor={`${fieldId}-passphrase`} error={error ?? undefined} helper={configured || needsProfile ? undefined : `Al menos ${RE20_VAULT_MIN_PASSPHRASE} caracteres. Si la olvidas, los borradores no se pueden recuperar.`}>
                  <Input
                    id={`${fieldId}-passphrase`}
                    type="password"
                    autoComplete={configured || needsProfile ? "current-password" : "new-password"}
                    value={passphrase}
                    onChange={(event) => { setPassphrase(event.target.value); setError(null) }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      void submit()
                    }}
                    error={Boolean(error)}
                  />
                </Field>
              </div>
              <Button type="button" variant="secondary" loading={busy} onClick={() => void submit()} disabled={passphrase.length === 0 || (needsProfile && !profileUserId)}>
                {configured || needsProfile ? "Abrir bóveda" : "Crear y abrir"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
