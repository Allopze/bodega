"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LockKey } from "@phosphor-icons/react/dist/ssr"
import { toast } from "@/lib/toast"
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
import { useOperation } from "@/lib/hooks/use-operation"
import type { ActionState } from "@/lib/validation/masters"
import type { ChipaxAdminStatus } from "@/lib/services/billing/chipax-settings"
import { clearChipaxSettingsAction, saveChipaxSettingsAction } from "../actions"

const SOURCE_LABEL = {
  system_settings: "guardada en la plataforma",
  environment: "heredada del servidor",
  missing: "sin configurar",
} as const

function helperFor(source: keyof typeof SOURCE_LABEL, canStoreSecrets: boolean): string {
  const origin = `Actualmente ${SOURCE_LABEL[source]}.`
  return canStoreSecrets
    ? `${origin} Vacío conserva el valor actual.`
    : `${origin} No se puede editar sin keyring en el servidor.`
}

/**
 * Credenciales e interruptores de Chipax, sin pasar por un despliegue.
 *
 * Hasta acá Chipax era la única integración con credenciales que sólo se podía
 * tocar editando el `.env` del servidor. El portal DTE ya se administraba desde
 * la plataforma; esto usa el mismo sobre cifrado y la misma regla de "vacío
 * conserva".
 *
 * El diálogo **nunca recibe un valor**: `status` sólo dice si cada campo está
 * configurado y de dónde viene. Un secreto viaja del navegador al servidor y no
 * vuelve.
 */
export function ChipaxSettingsDialog({ status }: { status: ChipaxAdminStatus }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(status.enabled)
  const [syncEnabled, setSyncEnabled] = useState(status.syncEnabled)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const clear = useOperation()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveChipaxSettingsAction,
    { ok: false },
  )

  // Abrir el diálogo relee el estado del servidor. Sin esto, cerrar con Escape
  // después de mover un interruptor lo dejaba movido al reabrir: el diálogo
  // mostraba un cambio que nunca se guardó.
  function handleOpenChange(next: boolean) {
    if (next) {
      setEnabled(status.enabled)
      setSyncEnabled(status.syncEnabled)
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

  function handleClear() {
    clear.run(clearChipaxSettingsAction, (result) => {
      setConfirmClearOpen(false)
      setOpen(false)
      toast.success(result.message ?? "Se restauró la configuración del servidor")
      router.refresh()
    })
  }

  useEffect(() => {
    if (clear.message && !clear.pending && !clear.message.startsWith("Guardado")) {
      toast.error(clear.message)
      clear.setMessage("")
    }
  }, [clear])

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">Credenciales</Button>
        </DialogTrigger>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Credenciales de Chipax</DialogTitle>
              <DialogDescription>
                Las credenciales de aplicación que entrega Chipax. Se guardan cifradas y no vuelven a
                mostrarse: deja un campo vacío para conservar el valor actual.
              </DialogDescription>
            </DialogHeader>

            {!status.canStoreSecrets && (
              <p role="alert" className="rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-xs text-[var(--color-warning-ink)]">
                Este servidor no tiene keyring de cifrado, así que no puede guardar credenciales acá.
                Los interruptores sí se guardan; las credenciales siguen saliendo del <code>.env</code>.
              </p>
            )}

            <Field
              label="App ID"
              htmlFor="chipax-app-id"
              helper={helperFor(status.fields.appId.source, status.canStoreSecrets)}
            >
              <Input
                id="chipax-app-id"
                name="appId"
                autoComplete="off"
                disabled={!status.canStoreSecrets}
                placeholder={status.fields.appId.configured ? "••••••••" : "6155cf60-f90c-…"}
              />
            </Field>

            <Field
              label="Secret Key"
              htmlFor="chipax-secret-key"
              helper={helperFor(status.fields.secretKey.source, status.canStoreSecrets)}
            >
              <Input
                id="chipax-secret-key"
                name="secretKey"
                type="password"
                autoComplete="new-password"
                disabled={!status.canStoreSecrets}
                placeholder="••••••••"
              />
            </Field>

            <div className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Proveedor habilitado</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Apagado, Chipax no sincroniza ni a mano ni por cron.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} label="Habilitar el proveedor Chipax" id="chipax-enabled" />
                <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] pt-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Automatización diaria</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Corrida de las 09:00: ventas y cartolas del mes actual y del anterior.
                    {!enabled && " No corre mientras el proveedor esté apagado."}
                  </p>
                </div>
                <Switch
                  checked={syncEnabled}
                  onCheckedChange={setSyncEnabled}
                  label="Habilitar la automatización diaria de Chipax"
                  id="chipax-sync-enabled"
                />
                <input type="hidden" name="syncEnabled" value={syncEnabled ? "on" : ""} />
              </div>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
              <LockKey size={13} className="mt-0.5 shrink-0" aria-hidden />
              La URL base, el timeout y el RUT de la empresa se siguen definiendo en el servidor: son
              decisiones del despliegue, no de la operación.
            </p>

            <DialogFooter>
              {status.hasStoredSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clear.pending || pending}
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Restaurar la del servidor
                </Button>
              )}
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar la configuración del servidor?"
        description="Se borran las credenciales y los interruptores guardados en la plataforma, y Chipax vuelve a regirse por el .env del servidor. No cambia nada en Chipax."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clear.pending}
      />
    </>
  )
}
