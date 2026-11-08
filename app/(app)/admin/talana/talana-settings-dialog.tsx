"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Gear } from "@phosphor-icons/react/dist/ssr"
import { SecretSettingField, SettingsKeyringCallout, SETTING_SOURCE_LABELS } from "@/components/admin/secret-setting-field"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
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
import { useOperation } from "@/lib/hooks/use-operation"
import type { TalanaAdminStatus, TalanaSyncMode } from "@/lib/integrations/talana/talana-settings"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/masters"
import {
  clearTalanaSettingsAction,
  saveTalanaSettingsAction,
  testTalanaConnectionAction,
} from "./settings-actions"
import { SYNC_MODE_LABELS, SYNC_MODE_OPTIONS } from "./talana-labels"

const MODE_OPTIONS = SYNC_MODE_OPTIONS.map((option) => ({ ...option }))

function modeHelper(status: TalanaAdminStatus): string {
  if (status.modeSource === "missing") return "Hoy está apagada: no hay un modo configurado."
  return `Hoy: ${SYNC_MODE_LABELS[status.mode]} · ${SETTING_SOURCE_LABELS[status.modeSource]}.`
}

/**
 * Token y modo de la sincronización con Talana, sin pasar por un despliegue.
 *
 * Sólo se monta para quien tiene `admin:talana_settings`, pero eso es comodidad:
 * la autorización está en cada server action.
 *
 * El diálogo **nunca recibe el token**: `status` sólo dice si hay uno y de
 * dónde viene. El campo parte vacío y vacío conserva el actual.
 *
 * El modo viaja sólo si la persona lo cambió. Si siempre viajara, guardar un
 * token nuevo copiaría el modo del `.env` a la plataforma y el servidor dejaría
 * de poder cambiarlo desde el entorno sin que nadie lo hubiera decidido.
 */
export function TalanaSettingsDialog({ status }: { status: TalanaAdminStatus }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const confirmedApplyRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<TalanaSyncMode>(status.mode)
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const clear = useOperation()
  const test = useOperation()
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveTalanaSettingsAction,
    { ok: false },
  )

  const modeChanged = mode !== status.mode
  // Pasar a «Aplicar» desde otro modo es lo único que modifica trabajadores.
  const needsApplyConfirmation = mode === "apply" && status.mode !== "apply"

  // Abrir el diálogo relee el estado del servidor: cerrar con Escape tras mover
  // el selector no puede dejarlo movido al reabrir (mostraría un cambio que
  // nunca se guardó).
  function handleOpenChange(next: boolean) {
    if (next) {
      setMode(status.mode)
      test.setMessage("")
      clear.setMessage("")
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (needsApplyConfirmation && !confirmedApplyRef.current) {
      event.preventDefault()
      setConfirmApplyOpen(true)
      return
    }
    confirmedApplyRef.current = false
  }

  function handleConfirmApply() {
    confirmedApplyRef.current = true
    setConfirmApplyOpen(false)
    formRef.current?.requestSubmit()
  }

  function handleClear() {
    clear.run(clearTalanaSettingsAction, (result) => {
      setConfirmClearOpen(false)
      setOpen(false)
      toast.success(result.message ?? "Se restauró la configuración del servidor.")
      router.refresh()
    })
  }

  function handleTest() {
    test.run(testTalanaConnectionAction, (result) => {
      test.setMessage(result.message ?? "Conexión correcta.", "success")
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">
            <Gear size={16} aria-hidden />
            Configurar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Configurar la sincronización con Talana</DialogTitle>
              <DialogDescription>
                El token de la API y el modo de la sincronización diaria. El token se guarda cifrado y no
                vuelve a mostrarse: deja el campo vacío para conservar el actual.
              </DialogDescription>
            </DialogHeader>

            {!status.canStoreSecrets && (
              <SettingsKeyringCallout>
                El modo de sincronización sí se puede guardar; el token sigue saliendo del <code>.env</code>.
              </SettingsKeyringCallout>
            )}

            <SecretSettingField
              id="talana-api-token"
              name="apiToken"
              label="Token de la API"
              type="password"
              clearName="clearApiToken"
              status={status.token}
              disabled={!status.canStoreSecrets}
            />

            <div className="space-y-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={test.pending}
                disabled={test.pending || pending || !status.token.configured}
                onClick={handleTest}
              >
                Probar conexión
              </Button>
              <p className="text-xs text-[var(--color-text-subtle)]">
                Prueba el token ya guardado (o el del servidor), no el que estés escribiendo: guárdalo primero.
                Hace una sola consulta a Talana.
              </p>
              {test.message && (
                <p
                  role={test.messageTone === "error" ? "alert" : "status"}
                  className={cn(
                    "text-sm",
                    test.messageTone === "success"
                      ? "text-[var(--color-success-ink)]"
                      : "text-[var(--color-danger-ink)]",
                  )}
                >
                  {test.message}
                </p>
              )}
            </div>

            <Field label="Modo de sincronización" helper={modeHelper(status)}>
              <div>
                {modeChanged && <input type="hidden" name="mode" value={mode} />}
                <ChoiceCardGroup
                  label="Modo de sincronización"
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={setMode}
                  className="sm:grid-cols-1"
                />
              </div>
            </Field>

            <DialogFooter>
              {status.hasStoredSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clear.pending || pending}
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Restaurar la configuración del servidor
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
        open={confirmApplyOpen}
        onOpenChange={setConfirmApplyOpen}
        title="¿Pasar la sincronización a «Aplicar»?"
        description="Con este modo la sincronización diaria modificará las fichas de los trabajadores en Chome: altas, bajas, cargos y jefes, según lo que diga Talana. Revisa antes la pestaña «Cambios de la corrida» de la última simulación."
        confirmLabel="Aplicar y guardar"
        cancelLabel="Cancelar"
        variant="warning"
        onConfirm={handleConfirmApply}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar la configuración del servidor?"
        description="Se borran el token y el modo guardados en la plataforma, y la sincronización vuelve a regirse por el .env del servidor. No cambia nada en Talana."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clear.pending}
        error={clear.message || undefined}
      />
    </>
  )
}
