"use client"

import { useActionState, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { LockKey } from "@phosphor-icons/react/dist/ssr"
import { toast } from "@/lib/toast"
import { SETTING_SOURCE_LABELS, SettingsKeyringCallout } from "@/components/admin/secret-setting-field"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import type { SettingSource } from "@/lib/services/encrypted-settings"
import type { ActionState } from "@/lib/validation/masters"

/**
 * Campo de texto NO secreto (RUT, correo, client id…). Viene precargado con el
 * valor vigente —el DTO sólo lo trae para los campos que no son secretos— y el
 * servidor guarda únicamente lo que cambió, así que abrir y guardar no fija en
 * la plataforma lo que viene del `.env`. Vacío conserva el valor actual.
 */
export function SettingTextField({
  id,
  name,
  label,
  status,
  type = "text",
  placeholder,
  hint,
}: {
  id: string
  name: string
  label: string
  status: { source: SettingSource; value?: string }
  type?: "text" | "email"
  placeholder?: string
  /** Lo que el campo significa, tras el origen del valor. */
  hint?: string
}) {
  const origin = status.source === "missing" ? "Sin configurar." : `${SETTING_SOURCE_LABELS[status.source]}.`
  return (
    <Field label={label} htmlFor={id} helper={hint ? `${origin} ${hint}` : origin}>
      <Input id={id} name={name} type={type} autoComplete="off" defaultValue={status.value ?? ""} placeholder={placeholder} />
    </Field>
  )
}

export interface IntegrationSettingsDialogProps {
  /** Prefijo de los ids: «copec», «visionlink». */
  idPrefix: string
  /** Nombre del proveedor tal como se muestra: «Copec». */
  providerName: string
  description: string
  /** False sin llavero en el servidor: los secretos se deshabilitan y el aviso lo explica. */
  canStoreSecrets: boolean
  /** Qué sí se puede guardar sin llavero. */
  withoutKeyringNote: string
  hasStoredSettings: boolean
  /** Valor vigente del interruptor al abrir. */
  syncEnabled: boolean
  /** Rótulo del interruptor; «Actualización diaria» por defecto. */
  syncLabel?: string
  /** Rótulo del botón que abre el diálogo; con dos integraciones en una misma barra, que diga cuál. */
  triggerLabel?: string
  /** Cuándo corre y qué hace la actualización diaria. */
  syncDescription: string
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>
  clearAction: () => Promise<OperationResult>
  testAction: () => Promise<OperationResult>
  /** Los campos propios de la integración. */
  children: ReactNode
}

/**
 * Diálogo «Configurar» de una integración de Combustibles: credenciales, el
 * interruptor de la actualización diaria, «Probar conexión» y «Restaurar la
 * configuración del servidor». Sigue el molde del diálogo de Chipax.
 *
 * Nunca recibe un valor secreto: los campos propios (`children`) parten vacíos y
 * un secreto viaja del navegador al servidor sin volver. «Probar conexión»
 * prueba lo GUARDADO, no lo que se esté escribiendo, y el diálogo lo dice.
 */
export function IntegrationSettingsDialog({
  idPrefix,
  providerName,
  description,
  canStoreSecrets,
  withoutKeyringNote,
  hasStoredSettings,
  syncEnabled: initialSyncEnabled,
  syncLabel = "Actualización diaria",
  syncDescription,
  saveAction,
  clearAction,
  testAction,
  triggerLabel = "Configurar",
  children,
}: IntegrationSettingsDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(initialSyncEnabled)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const clear = useOperation()
  const test = useOperation()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveAction, { ok: false })

  // Abrir el diálogo relee el estado del servidor. Sin esto, cerrar con Escape
  // después de mover el interruptor lo dejaba movido al reabrir: mostraba un
  // cambio que nunca se guardó.
  function handleOpenChange(next: boolean) {
    if (next) {
      setSyncEnabled(initialSyncEnabled)
      test.setMessage("")
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      setOpen(false)
      router.refresh()
    } else {
      toast.error(state.message)
    }
  }, [state, router])

  function handleTest() {
    test.run(testAction, (result) => test.setMessage(result.message ?? "Conexión correcta.", "success"))
  }

  function handleClear() {
    clear.run(clearAction, (result) => {
      setConfirmClearOpen(false)
      setOpen(false)
      toast.success(result.message ?? "Se restauró la configuración del servidor")
      router.refresh()
    })
  }

  function handleConfirmOpenChange(next: boolean) {
    if (next) clear.setMessage("")
    setConfirmClearOpen(next)
  }

  const busy = pending || clear.pending || test.pending

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">{triggerLabel}</Button>
        </DialogTrigger>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Configurar {providerName}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>

            {!canStoreSecrets && <SettingsKeyringCallout>{withoutKeyringNote}</SettingsKeyringCallout>}

            {children}

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{syncLabel}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{syncDescription}</p>
              </div>
              <Switch
                checked={syncEnabled}
                onCheckedChange={setSyncEnabled}
                label={`Activar la ${syncLabel.charAt(0).toLowerCase()}${syncLabel.slice(1)} de ${providerName}`}
                id={`${idPrefix}-sync-enabled`}
              />
              <input type="hidden" name="syncEnabled" value={syncEnabled ? "on" : ""} />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={handleTest}>
                  {test.pending ? "Probando…" : "Probar conexión"}
                </Button>
                <p className="text-xs text-[var(--color-text-subtle)]">Prueba lo guardado: guarda los cambios antes.</p>
              </div>
              {test.message && (
                <p
                  role={test.messageTone === "error" ? "alert" : "status"}
                  className={test.messageTone === "error"
                    ? "text-xs text-[var(--color-danger-ink)]"
                    : "text-xs text-[var(--color-success-ink)]"}
                >
                  {test.message}
                </p>
              )}
            </div>

            <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
              <LockKey size={13} className="mt-0.5 shrink-0" aria-hidden />
              Los valores guardados no se vuelven a mostrar. Lo que no se guarda aquí sigue saliendo del .env del servidor.
            </p>

            <DialogFooter>
              {hasStoredSettings && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => handleConfirmOpenChange(true)}>
                  Restaurar la configuración del servidor
                </Button>
              )}
              <Button type="submit" size="sm" disabled={busy}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={handleConfirmOpenChange}
        title="¿Restaurar la configuración del servidor?"
        description={`Se borran las credenciales y los ajustes de ${providerName} guardados en la plataforma, y la integración vuelve a regirse por el .env del servidor. No cambia nada en ${providerName}.`}
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clear.pending}
        error={clear.message || undefined}
      />
    </>
  )
}
