"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwise, LockKey } from "@phosphor-icons/react/dist/ssr"
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
import { Callout } from "@/components/ui/callout"
import type { OnwayAdminStatus } from "@/lib/integrations/onway/onway-settings"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/masters"
import { clearOnwaySettingsAction, runOnwaySyncAction, saveOnwaySettingsAction } from "./actions"

const SOURCE_LABEL = {
  system_settings: "guardado cifrado en la plataforma",
  environment: "definido en el servidor",
  missing: "sin configurar",
} as const

function secretHelper(
  source: keyof typeof SOURCE_LABEL,
  canStoreSecrets: boolean,
): string {
  const current = `Actualmente ${SOURCE_LABEL[source]}.`
  return canStoreSecrets
    ? `${current} Déjalo vacío para conservar el valor actual.`
    : `${current} No se puede editar sin keyring en el servidor.`
}

export function OnwayControls({ status }: { status: OnwayAdminStatus }) {
  const router = useRouter()
  const sync = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const clear = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const [open, setOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(status.syncEnabled)
  const [state, formAction, saving] = useActionState<ActionState, FormData>(
    saveOnwaySettingsAction,
    { ok: false },
  )

  function handleOpenChange(next: boolean) {
    if (next) setSyncEnabled(status.syncEnabled)
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
  }, [router, state])

  function handleClear() {
    clear.run(clearOnwaySettingsAction, () => {
      setConfirmClearOpen(false)
      setOpen(false)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">Configurar</Button>
        </DialogTrigger>
        <DialogContent>
          <form action={formAction} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Conexión con Entel OnWay</DialogTitle>
              <DialogDescription>
                El servidor inicia sesión en el portal y conserva la sesión solo en memoria. Las credenciales
                guardadas quedan cifradas y nunca vuelven al navegador.
              </DialogDescription>
            </DialogHeader>

            {!status.canStoreSecrets && (
              <Callout tone="warning" role="alert" className="text-xs">
                Este servidor no tiene keyring de cifrado. Puedes usar ONWAY_USERNAME y ONWAY_PASSWORD en el entorno,
                pero no guardar credenciales desde esta pantalla.
              </Callout>
            )}

            <Field
              label="Usuario"
              htmlFor="onway-username"
              helper={secretHelper(status.fields.username.source, status.canStoreSecrets)}
            >
              <Input
                id="onway-username"
                name="username"
                type="email"
                autoComplete="off"
                disabled={!status.canStoreSecrets}
                placeholder={status.fields.username.configured ? "••••••••" : "usuario@empresa.cl"}
                maxLength={320}
              />
            </Field>

            <Field
              label="Contraseña"
              htmlFor="onway-password"
              helper={secretHelper(status.fields.password.source, status.canStoreSecrets)}
            >
              <Input
                id="onway-password"
                name="password"
                type="password"
                autoComplete="new-password"
                disabled={!status.canStoreSecrets}
                placeholder="••••••••"
                maxLength={320}
              />
            </Field>

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Actualización automática</p>
                <p className="text-xs text-[var(--color-text-muted)]">Permite que el cron consulte OnWay sin intervención manual.</p>
              </div>
              <Switch
                id="onway-sync-enabled"
                checked={syncEnabled}
                onCheckedChange={setSyncEnabled}
                label="Habilitar actualización automática de OnWay"
              />
              <input type="hidden" name="syncEnabled" value={syncEnabled ? "on" : ""} />
            </div>

            <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-subtle)]">
              <LockKey size={13} className="mt-0.5 shrink-0" aria-hidden />
              Solo se guardan patente, posición, velocidad, encendido y momento de captura. No se almacena el payload del portal.
            </p>

            <DialogFooter>
              {status.hasStoredSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clear.pending || saving}
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Restaurar servidor
                </Button>
              )}
              <Button type="submit" size="sm" loading={saving}>Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        type="button"
        size="sm"
        disabled={!status.hasCredentials}
        loading={sync.pending}
        onClick={() => sync.run(runOnwaySyncAction)}
      >
        <ArrowClockwise size={14} aria-hidden />
        Actualizar ahora
      </Button>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar la configuración del servidor?"
        description="Se borran las credenciales y el interruptor guardados en la plataforma. OnWay vuelve a regirse por las variables del servidor."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clear.pending}
      />
    </div>
  )
}
