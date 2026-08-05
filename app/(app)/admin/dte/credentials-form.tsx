"use client"

import { useActionState, useEffect, useState } from "react"
import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react/dist/ssr"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import type { DtePortalEnvConfig } from "@/lib/services/dte-portal/config"
import { clearDteSettingsAction, saveDteSettingsAction } from "./settings-actions"

interface DteCredentialsFormProps {
  /** Configuración efectiva actual (base de datos + variables de entorno). */
  initial: DtePortalEnvConfig
  /** True si hay al menos un valor DTE guardado en la base de datos. */
  hasStored: boolean
}

/**
 * Credenciales del portal DTE desde el panel: guarda en `system_settings`
 * lo que hoy se configura en las variables de entorno DTE_PORTAL_*. Lo
 * guardado aquí tiene prioridad sobre el .env.
 */
export function DteCredentialsForm({ initial, hasStored }: DteCredentialsFormProps) {
  const [state, formAction] = useActionState(saveDteSettingsAction, INITIAL_STATE)
  const [syncEnabled, setSyncEnabled] = useState(initial.syncEnabled)
  const [clearClave, setClearClave] = useState(false)
  const [claveInput, setClaveInput] = useState("")
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Tras guardar, el server action revalida la página y `initial` se refresca:
  // el switch debe seguir el valor efectivo nuevo.
  useEffect(() => {
    setSyncEnabled(initial.syncEnabled)
  }, [initial.syncEnabled])

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Configuración guardada")
    else if (state.message) toast.error(state.message)
  }, [state])

  const { rutUsr, rutEmp, clave, codEmp } = initial.credentials
  const configured = Boolean(rutUsr && rutEmp && clave && codEmp)

  const status = !configured
    ? {
        icon: XCircle,
        title: "Portal DTE sin configurar",
        description: "Guarda las credenciales abajo para poder sincronizar la Bandeja de Entrada.",
        className: "border-[var(--color-danger)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
      }
    : !initial.syncEnabled
      ? {
          icon: WarningCircle,
          title: "Portal DTE configurado, sincronización pausada",
          description: "Las credenciales están listas, pero el interruptor de sincronización está apagado.",
          className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
        }
      : {
          icon: CheckCircle,
          title: "Portal DTE configurado y sincronización habilitada",
          description: "El cron mensual y el botón \"Sincronizar ahora\" pueden consultar el portal.",
          className: "border-[var(--color-success)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
        }

  const StatusIcon = status.icon
  const sourceLabel = hasStored
    ? "guardadas en el sistema (esta pantalla tiene prioridad)"
    : "tomadas de las variables de entorno (DTE_PORTAL_*)"

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    try {
      const result = await clearDteSettingsAction()
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Estado actual */}
      <section role="status" className={`rounded-[var(--radius-xl)] border p-4 ${status.className}`}>
        <h2 className="flex items-center gap-2 font-semibold">
          <StatusIcon size={18} />
          {status.title}
        </h2>
        <p className="mt-1 text-sm">{status.description}</p>
        <p className="mt-1 text-xs opacity-90">
          Credenciales {sourceLabel}
          {initial.baseUrl ? ` · Portal: ${initial.baseUrl}` : ""}.
        </p>
        {hasStored && (
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmClearOpen(true)}
              disabled={clearing}
            >
              Restaurar variables de entorno
            </Button>
          </div>
        )}
      </section>

      {/* Formulario */}
      <form action={formAction}>
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5">
            <h2 className="text-h2 text-[var(--color-text)]">Credenciales del portal</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Guarda aquí lo que hoy se configura en{" "}
              <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-xs">DTE_PORTAL_*</code>.
              Lo guardado aquí tiene prioridad; deja un campo en blanco para volver a usar la variable de entorno.
            </p>
          </div>

          <FieldGroup>
            <Field
              label="URL base del portal"
              htmlFor="dte-base-url"
              helper="En blanco usa DTE_PORTAL_BASE_URL (default: https://clientes.dtefacturaenlinea.cl/facturaenlinea)"
            >
              <Input
                id="dte-base-url"
                name="baseUrl"
                type="url"
                defaultValue={initial.baseUrl}
                placeholder="https://clientes.dtefacturaenlinea.cl/facturaenlinea"
                autoComplete="off"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="RUT del usuario" htmlFor="dte-rut-usr" helper="DTE_PORTAL_RUT_USR">
                <Input id="dte-rut-usr" name="rutUsr" defaultValue={rutUsr} placeholder="12345678-9" autoComplete="off" />
              </Field>
              <Field label="RUT de la empresa" htmlFor="dte-rut-emp" helper="DTE_PORTAL_RUT_EMP">
                <Input id="dte-rut-emp" name="rutEmp" defaultValue={rutEmp} placeholder="78023530-6" autoComplete="off" />
              </Field>
            </div>

            <Field label="Código de empresa (CodEmp)" htmlFor="dte-cod-emp" helper="DTE_PORTAL_CODEMP">
              <Input id="dte-cod-emp" name="codEmp" defaultValue={codEmp} placeholder="433" autoComplete="off" />
            </Field>

            <Field
              label="Contraseña"
              htmlFor="dte-clave"
              helper={
                clave
                  ? "Déjala en blanco para conservar la actual. Se almacena en la base de datos del sistema (como el resto de la configuración)."
                  : "DTE_PORTAL_CLAVE · se almacena en la base de datos del sistema."
              }
            >
              <Input
                id="dte-clave"
                name="clave"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                onChange={(event) => setClaveInput(event.currentTarget.value)}
              />
            </Field>
            {clave && (
              <Checkbox
                id="dte-clear-clave"
                name="clearClave"
                value="on"
                checked={clearClave}
                disabled={claveInput.length > 0}
                onChange={(event) => setClearClave(event.currentTarget.checked)}
                label="Borrar la contraseña guardada (vuelve a DTE_PORTAL_CLAVE)"
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Intervalo entre consultas (ms)" htmlFor="dte-delay" helper="0–10.000 · en blanco conserva el valor actual (default 500)">
                <Input id="dte-delay" name="delayMs" type="number" min={0} max={10000} step={100} defaultValue={initial.delayMs} />
              </Field>
              <Field
                label="Email del usuario técnico (importer)"
                htmlFor="dte-importer"
                helper="DTE_SYNC_IMPORTER_EMAIL · opcional, se usa en las corridas del cron"
              >
                <Input id="dte-importer" name="importerEmail" type="email" defaultValue={initial.importerEmail ?? ""} autoComplete="off" />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Habilitar sincronización</p>
                <p className="text-xs text-[var(--color-text-muted)]">DTE_SYNC_ENABLED · el cron mensual y el botón Sincronizar ahora solo corren si está activo</p>
              </div>
              <Switch
                id="dte-sync-enabled"
                checked={syncEnabled}
                onCheckedChange={setSyncEnabled}
                label="Habilitar sincronización DTE"
              />
              <input type="hidden" name="syncEnabled" value={syncEnabled ? "on" : ""} />
            </div>
          </FieldGroup>

          <div className="mt-6 flex justify-end">
            <SubmitButton label="Guardar credenciales" loadingLabel="Guardando…" variant="primary" />
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar las variables de entorno?"
        description="Se borrará toda la configuración DTE guardada en el sistema. A partir de ese momento la app vuelve a leer solo las variables de entorno (DTE_PORTAL_*)."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clearing}
      />
    </div>
  )
}
