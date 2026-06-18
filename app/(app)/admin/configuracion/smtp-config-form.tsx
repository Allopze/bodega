"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { updateSmtpConfigAction, testSmtpAction } from "./actions"
import type { SmtpConfigView } from "@/lib/services/smtp-settings"

interface SmtpSectionProps {
  initialSmtpConfig: SmtpConfigView | null
}

export function SmtpConfigSection({ initialSmtpConfig }: SmtpSectionProps) {
  const [state, formAction] = useActionState(updateSmtpConfigAction, INITIAL_STATE)
  const [testState, setTestState] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Configuración SMTP guardada")
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state])

  async function handleTest(e: React.FormEvent) {
    e.preventDefault()
    setTesting(true)
    setTestState(null)

    const form = e.currentTarget as HTMLFormElement
    const formData = new FormData(form)

    try {
      const result = await testSmtpAction(null, formData)
      if (result.ok) {
        setTestState({ ok: true, message: "Correo de prueba enviado correctamente" })
        toast.success("Correo de prueba enviado")
      } else {
        setTestState({ ok: false, message: result.message ?? "Error al enviar correo de prueba" })
        toast.error(result.message ?? "Error al enviar correo de prueba")
      }
    } catch {
      setTestState({ ok: false, message: "Error inesperado" })
      toast.error("Error inesperado")
    } finally {
      setTesting(false)
    }
  }

  const sourceLabel = initialSmtpConfig?.source === "env"
    ? "Configurado por variables de entorno"
    : initialSmtpConfig?.source === "db"
      ? "Configurado desde la base de datos"
      : "No configurado"

  return (
    <form action={formAction} className="mt-8">
      <div className="min-w-0 rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-6">
        <div className="mb-4">
          <h2 className="text-h2 text-[var(--color-text)]">
            Correo SMTP
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Configuración del servidor de correo saliente. {sourceLabel && (
              <span className="text-[var(--color-text-faint)]">({sourceLabel})</span>
            )}
          </p>
        </div>

        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}

        <FieldGroup className="gap-5">
          <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_auto] gap-4">
            <Field
              label="Host"
              htmlFor="smtp-host"
              required
              error={state.fieldErrors?.smtpHost?.[0]}
            >
              <Input
                id="smtp-host"
                name="smtpHost"
                defaultValue={initialSmtpConfig?.host ?? ""}
                placeholder="smtp.gmail.com"
                error={!!state.fieldErrors?.smtpHost}
              />
            </Field>
            <Field
              label="Puerto"
              htmlFor="smtp-port"
              required
              error={state.fieldErrors?.smtpPort?.[0]}
            >
              <Input
                id="smtp-port"
                name="smtpPort"
                type="number"
                defaultValue={initialSmtpConfig?.port ?? 587}
                placeholder="587"
                className="font-mono"
                error={!!state.fieldErrors?.smtpPort}
              />
            </Field>
            <Field label="TLS/SSL" htmlFor="smtp-secure" helper="TLS si el puerto es 587 o marcar para SSL">
              <input
                id="smtp-secure"
                name="smtpSecure"
                type="hidden"
                value="false"
              />
              <label className="flex items-center gap-2 pt-1">
                <input
                  name="smtpSecure"
                  type="checkbox"
                  defaultChecked={initialSmtpConfig?.secure ?? false}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                <span className="text-sm text-[var(--color-text-muted)]">Usar SSL</span>
              </label>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Usuario"
              htmlFor="smtp-user"
              required
              error={state.fieldErrors?.smtpUser?.[0]}
            >
              <Input
                id="smtp-user"
                name="smtpUser"
                defaultValue={initialSmtpConfig?.user ?? ""}
                placeholder="tu@correo.cl"
                error={!!state.fieldErrors?.smtpUser}
              />
            </Field>
            <Field
              label="Contraseña"
              htmlFor="smtp-pass"
              helper="Se actualiza solo si se escribe un valor nuevo"
              error={state.fieldErrors?.smtpPass?.[0]}
            >
              <Input
                id="smtp-pass"
                name="smtpPass"
                type="password"
                placeholder={initialSmtpConfig ? "••••••" : ""}
                autoComplete="off"
                error={!!state.fieldErrors?.smtpPass}
              />
            </Field>
          </div>

          <Field
            label="Correo remitente (From)"
            htmlFor="smtp-from"
            required
            helper="Un correo o el formato: Nombre <correo@dominio>"
            error={state.fieldErrors?.smtpFrom?.[0]}
          >
            <Input
              id="smtp-from"
              name="smtpFrom"
              type="text"
              defaultValue={initialSmtpConfig?.from ?? ""}
              placeholder="Chome Bodega <noreply@chome.cl>"
              error={!!state.fieldErrors?.smtpFrom}
            />
          </Field>
        </FieldGroup>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <SubmitButton label="Guardar Configuración SMTP" loadingLabel="Guardando..." variant="primary" />

        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {testing ? "Enviando..." : "Enviar correo de prueba"}
        </button>
      </div>

      {testState && (
        <p className={`mt-2 text-sm ${testState.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {testState.message}
        </p>
      )}
    </form>
  )
}
