"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { AramcoAdminStatus } from "@/lib/combustibles/aramco-settings"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
// Las acciones viven con el importador de Aramco (Fuentes de datos); aquí sólo se usan.
import { clearAramcoSettingsAction, saveAramcoSettingsAction } from "../../importar/aramco-sync-action"
import { ARAMCO_SOURCE_LABELS } from "./integration-status"

/**
 * Credenciales de Aramco. Nunca muestra la clave ni la cuenta: el servidor
 * sólo dice si están configuradas, de dónde vienen y cuándo se guardaron. Para
 * cambiarlas se reemplazan (campos vacíos al abrir, un campo vacío conserva el
 * valor actual) o se quitan las guardadas.
 */
export function AramcoCredentials({ status, configuredAt }: { status: AramcoAdminStatus; configuredAt: string | null }) {
  const { documentNumber: documentField, password: passwordField } = status.fields
  const configured = documentField.configured && passwordField.configured
  // «Reemplazando» sólo dice que la persona abrió el formulario; sin credenciales el formulario se muestra siempre.
  const [replacing, setReplacing] = React.useState(false)
  const showForm = replacing || !configured
  const [documentNumber, setDocumentNumber] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const [syncShown, setSyncShown] = React.useState<boolean | null>(null)
  const save = useOperation()
  const toggle = useOperation({ feedback: "toast" })
  const remove = useOperation()

  const syncEnabled = syncShown ?? status.syncEnabled
  const storedHere = documentField.source === "system_settings" || passwordField.source === "system_settings"

  function resetFields() {
    // La clave no se queda en el DOM después de guardarla ni al cancelar.
    setDocumentNumber("")
    setPassword("")
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    save.run(
      () => saveAramcoSettingsAction({ documentNumber: documentNumber.trim() || undefined, password: password.trim() || undefined, syncEnabled }),
      (result) => {
        toast.success(result.message ?? "Credenciales guardadas")
        resetFields()
        setReplacing(false)
      },
    )
  }

  function changeSync(next: boolean) {
    setSyncShown(next)
    toggle.run(
      () => saveAramcoSettingsAction({ syncEnabled: next }),
      undefined,
      () => setSyncShown(null),
    )
  }

  function confirmClear() {
    remove.run(
      () => clearAramcoSettingsAction(),
      (result) => {
        toast.success(result.message ?? "Credenciales guardadas quitadas")
        setConfirmRemove(false)
        resetFields()
        setReplacing(false)
      },
    )
  }

  return (
    <div className="space-y-5">
      {!status.canStoreSecrets ? (
        <Callout tone="warning" role="status">
          Este servidor no tiene la llave de cifrado configurada, así que no puede guardar credenciales desde aquí.
          Pídele a quien administra el servidor que la configure, o que deje las credenciales de Aramco en la configuración del servidor.
        </Callout>
      ) : null}

      {showForm ? (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label="RUT de la cuenta" htmlFor="aramco-document" helper={documentField.configured ? "Déjalo vacío para conservar el actual." : "Con guion y sin puntos, p. ej. 78023530-6."}>
            <Input id="aramco-document" value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} autoComplete="off" placeholder={documentField.configured ? "Sin cambios" : undefined} />
          </Field>
          <Field label="Clave" htmlFor="aramco-password" helper={passwordField.configured ? "Sólo dígitos. Déjala vacía para conservar la actual." : "Sólo dígitos."}>
            <Input id="aramco-password" type="password" inputMode="numeric" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={passwordField.configured ? "Sin cambios" : undefined} />
          </Field>
          {save.message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{save.message}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={save.pending} disabled={!status.canStoreSecrets || (!documentNumber.trim() && !password.trim())}>Guardar credenciales</Button>
            {configured ? <Button type="button" variant="ghost" onClick={() => { resetFields(); setReplacing(false); save.setMessage("") }} disabled={save.pending}>Cancelar</Button> : null}
          </div>
          <p className="text-xs text-[var(--color-text-subtle)]">La clave se guarda cifrada y no vuelve a mostrarse.</p>
        </form>
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--color-text-subtle)]">Cuenta</dt>
              <dd className="text-[var(--color-text)]">Configurada · {ARAMCO_SOURCE_LABELS[documentField.source] ?? documentField.source}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-text-subtle)]">Clave</dt>
              <dd className="text-[var(--color-text)]">Configurada · {ARAMCO_SOURCE_LABELS[passwordField.source] ?? passwordField.source}</dd>
            </div>
          </dl>
          {storedHere && configuredAt ? <p className="text-sm text-[var(--color-text-muted)]">Credenciales guardadas el {formatDateTime(configuredAt)}.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setReplacing(true)}>Reemplazar credenciales</Button>
            {status.hasStoredSettings ? <Button type="button" variant="ghost-danger" size="sm" onClick={() => setConfirmRemove(true)}>Quitar las guardadas</Button> : null}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-4">
        <Switch id="aramco-sync-enabled" checked={syncEnabled} onCheckedChange={changeSync} disabled={toggle.pending} label="Actualizar sola cada día" />
        <label htmlFor="aramco-sync-enabled" className="text-sm text-[var(--color-text)]">Actualizar sola cada día</label>
      </div>
      {syncEnabled && !configured ? (
        <p role="status" className="text-sm text-[var(--color-warning-ink)]">La actualización está activa pero faltan las credenciales: va a fallar cada mañana hasta que las cargues.</p>
      ) : null}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(next) => { if (!remove.pending) { setConfirmRemove(next); if (!next) remove.setMessage("") } }}
        title="Quitar las credenciales guardadas"
        description="Se borran de la aplicación la cuenta y la clave guardadas. Si el servidor tiene unas propias, Aramco seguirá actualizándose con esas; si no, dejará de actualizarse hasta que cargues unas nuevas."
        confirmLabel="Quitar credenciales"
        variant="destructive"
        loading={remove.pending}
        error={remove.message || undefined}
        onConfirm={confirmClear}
      />
    </div>
  )
}
