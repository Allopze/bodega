"use client"

import { useActionState, useEffect, useState } from "react"
import { CheckCircle, HardDrives, LockKey, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE } from "@/lib/form-state"
import type { ActionState } from "@/lib/validation/masters"
import { useOperation } from "@/lib/hooks/use-operation"
import type { CloudreveAdminStatus } from "@/lib/services/cloudreve/settings"
import {
  clearCloudreveStorageAction,
  saveCloudreveStorageAction,
  testCloudreveConnectionAction,
} from "./actions"

interface CloudreveStorageFormProps {
  /** Deliberately safe DTO: no username, password ni URL efectiva. */
  status: CloudreveAdminStatus
}

const SOURCE_LABELS = {
  system_settings: "guardada desde esta pantalla",
  environment: "proveniente de configuración del servidor",
  missing: "sin configurar",
} as const

export function CloudreveStorageForm({ status }: CloudreveStorageFormProps) {
  // El aviso sale dentro de la acción: al revalidar, la página se vuelve a
  // montar y un efecto sobre `state` nunca llegaba a ver el resultado, así que
  // guardar no avisaba nada (el mismo patrón de `admin/desviaciones`).
  const [, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveCloudreveStorageAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Configuración guardada")
    else if (result.message) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [backend, setBackend] = useState<"filesystem" | "cloudreve">(status.backend.value)
  const [usernameInput, setUsernameInput] = useState("")
  const [passwordInput, setPasswordInput] = useState("")
  const [sstPathInput, setSstPathInput] = useState("")
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  // `feedback: "toast"` notifica con el mensaje que devuelve la acción. Con el
  // modo "message" (el default) el hook reemplaza el texto por un literal de
  // guardado, y una prueba exitosa terminaba mostrándose como error.
  const connection = useOperation({ feedback: "toast" })

  useEffect(() => {
    setBackend(status.backend.value)
  }, [status.backend.value])

  function handleTest() {
    connection.run(testCloudreveConnectionAction)
  }

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    try {
      const result = await clearCloudreveStorageAction()
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } finally {
      setClearing(false)
    }
  }

  const credentialsConfigured = status.baseUrl.configured
    && status.fields.username.configured
    && status.fields.password.configured

  const visualStatus = backend === "cloudreve" && !credentialsConfigured
    ? {
        icon: WarningCircle,
        title: "Backend Cloudreve activo sin credenciales completas",
        description: "Los archivos no se podrán leer ni escribir en Cloudreve hasta configurar URL, usuario y contraseña.",
        className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
      }
    : backend === "cloudreve"
      ? {
          icon: CheckCircle,
          title: "Documentos SST en Cloudreve (carpeta compartida de Chome)",
          description: "Las cargas y descargas pasan por la cuenta WebDAV configurada.",
          className: "border-[var(--color-success)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
        }
      : {
          icon: HardDrives,
          title: "Documentos SST en el filesystem local",
          description: "Comportamiento histórico: los archivos viven en el volumen de storage del servidor.",
          className: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]",
        }
  const StatusIcon = visualStatus.icon

  return (
    <div className="space-y-6">
      <section role="status" className={`rounded-[var(--radius-xl)] border p-4 ${visualStatus.className}`}>
        <h2 className="flex items-center gap-2 font-semibold">
          <StatusIcon size={18} />
          {visualStatus.title}
        </h2>
        <p className="mt-1 text-sm">{visualStatus.description}</p>
        <p className="mt-2 flex items-center gap-1 text-xs opacity-90">
          <LockKey size={14} aria-hidden />
          Credenciales: {SOURCE_LABELS[status.fields.username.configured ? status.fields.username.source : "missing"]}
          {" · "}Backend: {status.backend.value} ({SOURCE_LABELS[status.backend.source]})
        </p>
        {status.hasStoredSettings && (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmClearOpen(true)} disabled={clearing}>
              Restaurar configuración del servidor
            </Button>
          </div>
        )}
      </section>

      {!status.canStoreSecrets && (
        <section role="alert" className="rounded-[var(--radius-xl)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-4 text-[var(--color-danger-ink)]">
          <h2 className="font-semibold">No hay keyring de cifrado configurado</h2>
          <p className="mt-1 text-sm">
            Sin <code>DTE_SETTINGS_KEYRING</code> en el servidor no se puede guardar usuario ni contraseña:
            el guardado se rechaza en vez de persistir credenciales en texto plano.
          </p>
        </section>
      )}

      {backend === "cloudreve" && (
        <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-muted)]">
          Antes de activar Cloudreve asegúrese de haber migrado los archivos existentes con{" "}
          <code>docker compose run --rm migrate-sst-to-cloudreve</code>. Mientras no se migre,
          los documentos previos seguirán leyéndose del filesystem local.
        </section>
      )}

      <form action={formAction}>
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5">
            <h2 className="text-h2 text-[var(--color-text)]">Conexión Cloudreve (WebDAV)</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Los valores existentes no se cargan ni se envían al navegador: deje vacío para conservarlos
              y marque «Borrar» solo si desea retirarlos.
            </p>
          </div>

          <FieldGroup>
            <Field label="URL base de Cloudreve" htmlFor="cr-base-url" helper="Sin /dav al final, ej. https://cloudreve.chome.cl. Vacío conserva la existente.">
              <Input id="cr-base-url" name="baseUrl" type="text" placeholder="https://cloudreve.chome.cl" autoComplete="off" />
            </Field>

            <Field label="Usuario (email dueño de la cuenta WebDAV)" htmlFor="cr-username" helper={status.fields.username.configured ? "Vacío conserva el existente." : "Aún no configurado."}>
              <Input id="cr-username" name="username" type="text" placeholder="usuario@chome.cl" autoComplete="off" onChange={(event) => setUsernameInput(event.currentTarget.value)} />
            </Field>
            {/* Sólo hay algo que borrar si vino de esta pantalla: con el valor
                heredado del `.env` el borrado no tendría efecto alguno. */}
            {status.fields.username.source === "system_settings" && (
              <Checkbox id="cr-clear-username" name="clearUsername" value="on" disabled={usernameInput.length > 0} label="Borrar el usuario persistido" />
            )}

            <Field label="Contraseña" htmlFor="cr-password" helper={status.fields.password.configured ? "Déjela vacía para conservar la existente." : "Ingrese la contraseña generada por Cloudreve."}>
              <Input id="cr-password" name="password" type="password" placeholder="••••••••" autoComplete="new-password" onChange={(event) => setPasswordInput(event.currentTarget.value)} />
            </Field>
            {status.fields.password.source === "system_settings" && (
              <Checkbox id="cr-clear-password" name="clearPassword" value="on" disabled={passwordInput.length > 0} label="Borrar la contraseña persistida" />
            )}

            <Field label="Carpeta remota (sst_path)" htmlFor="cr-sst-path" helper="Vacío conserva la existente. '/' usa la raíz de una cuenta WebDAV acotada a la carpeta de la plataforma.">
              <Input id="cr-sst-path" name="sstPath" type="text" placeholder="/" autoComplete="off" onChange={(event) => setSstPathInput(event.currentTarget.value)} />
            </Field>
            {status.sstPath.source === "system_settings" && (
              <Checkbox id="cr-clear-sst-path" name="clearSstPath" value="on" disabled={sstPathInput.length > 0} label="Borrar la carpeta persistida (volver al default)" />
            )}

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Backend activo</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Aplica al guardar y termina de propagarse a todos los procesos del servidor en menos de 10 segundos.
                  Los archivos ya guardados no se mueven solos. Activar Cloudreve exige URL, usuario y contraseña.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="backend" value="filesystem" checked={backend === "filesystem"} onChange={() => setBackend("filesystem")} />
                  Filesystem local
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="backend" value="cloudreve" checked={backend === "cloudreve"} onChange={() => setBackend("cloudreve")} />
                  Cloudreve
                </label>
              </div>
            </div>
          </FieldGroup>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Button type="button" variant="secondary" onClick={handleTest} disabled={connection.pending}>
                {connection.pending ? "Probando…" : "Probar conexión"}
              </Button>
              <p className="mt-1 max-w-xs text-xs text-[var(--color-text-muted)]">
                Prueba la configuración <strong>guardada</strong>, no lo escrito arriba: guarde primero si acaba de cambiar algo.
                Verifica además que la carpeta remota exista.
              </p>
            </div>
            <SubmitButton label="Guardar configuración" loadingLabel="Guardando…" variant="primary" disabled={!status.canStoreSecrets} />
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="¿Restaurar la configuración del servidor?"
        description={status.fallbackBackend === "cloudreve"
          ? "Se borrará la configuración Cloudreve persistida, credenciales incluidas. ATENCIÓN: el servidor tiene SST_STORAGE_BACKEND=cloudreve, así que la biblioteca SST seguirá apuntando a Cloudreve, pero sin credenciales: las subidas y descargas van a fallar hasta configurarlas de nuevo."
          : "Se borrará la configuración Cloudreve persistida. El backend volverá al filesystem local y las credenciales quedarán sin configurar."}
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clearing}
      />
    </div>
  )
}
