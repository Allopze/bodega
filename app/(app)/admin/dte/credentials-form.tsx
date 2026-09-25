"use client"

import { useActionState, useEffect, useState } from "react"
import { CheckCircle, LockKey, WarningCircle, XCircle } from "@phosphor-icons/react/dist/ssr"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import type { DtePortalAdminStatus } from "@/lib/services/dte-portal/settings"
import {
  clearDteSettingsAction,
  convertLegacyDteSettingsAction,
  rotateDteSettingsKeyringAction,
  saveDteSettingsAction,
} from "./settings-actions"

interface DteCredentialsFormProps {
  /** Deliberately safe DTO: no RUTs, password, email or effective defaults. */
  status: DtePortalAdminStatus
}

/**
 * Administración de DTE sin cruzar secretos por la frontera RSC→cliente.
 * Los inputs siempre parten vacíos: vacío conserva y cada borrado es explícito.
 */
export function DteCredentialsForm({ status }: DteCredentialsFormProps) {
  const [claveInput, setClaveInput] = useState("")
  // El aviso sale dentro de la acción, donde se conoce el resultado. La clave
  // es un campo no controlado que React vacía al terminar; su espejo se vacía
  // acá, o «Borrar la contraseña persistida» quedaría deshabilitada.
  const [, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveDteSettingsAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Configuración DTE guardada")
      setClaveInput("")
    } else if (result.message) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)
  const [syncEnabled, setSyncEnabled] = useState(status.syncEnabled)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [confirmConversionOpen, setConfirmConversionOpen] = useState(false)
  const [confirmRotationOpen, setConfirmRotationOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const conversion = useOperation()
  const rotation = useOperation()

  useEffect(() => {
    setSyncEnabled(status.syncEnabled)
  }, [status.syncEnabled])

  const visualStatus = !status.configured
    ? {
        icon: XCircle,
        title: "Portal DTE sin configurar",
        description: "Ingrese solo los campos que desea crear o reemplazar. Los que ya existen no se muestran en el navegador.",
        className: "border-[var(--color-danger)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
      }
    : !status.syncEnabled
      ? {
          icon: WarningCircle,
          title: "Portal DTE configurado, sincronización pausada",
          description: "Las credenciales están disponibles, pero el interruptor de sincronización está apagado.",
          className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
        }
      : {
          icon: CheckCircle,
          title: "Portal DTE configurado y sincronización habilitada",
          description: "La automatización puede consultar el portal de FacturaEnLínea.",
          className: "border-[var(--color-success)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
        }
  const StatusIcon = visualStatus.icon
  const sourceLabel = {
    system_settings: "guardadas de forma administrada",
    environment: "provenientes de configuración del servidor",
    mixed: "con origen mixto",
    none: "sin origen configurado",
  }[status.source]
  const encryptionLabel = {
    not_configured: "sin valores persistidos",
    legacy: "compatibilidad legacy activa",
    migration_required: "requiere conversión cifrada controlada",
    encrypted: "valores persistidos cifrados",
    encrypted_only: "modo cifrado obligatorio",
    configuration_error: "keyring requiere revisión en el host",
  }[status.encryptionStatus]

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    try {
      const result = await clearDteSettingsAction()
      if (result.ok) {
        toast.success(result.message)
        setConfirmClearOpen(false)
      } else {
        toast.error(result.message)
      }
    } finally {
      setClearing(false)
    }
  }

  function handleConversion() {
    conversion.run(convertLegacyDteSettingsAction, () => {
      setConfirmConversionOpen(false)
      toast.success("Conversión cifrada completada")
    })
  }

  function handleRotation() {
    rotation.run(rotateDteSettingsKeyringAction, () => {
      setConfirmRotationOpen(false)
      toast.success("Re-cifrado del keyring completado")
    })
  }

  useEffect(() => {
    if (conversion.message && !conversion.pending) {
      if (conversion.message.startsWith("Guardado")) return
      toast.error(conversion.message)
      conversion.setMessage("")
    }
  }, [conversion])

  useEffect(() => {
    if (rotation.message && !rotation.pending) {
      if (rotation.message.startsWith("Guardado")) return
      toast.error(rotation.message)
      rotation.setMessage("")
    }
  }, [rotation])

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
          Estado: {sourceLabel} · {encryptionLabel}.
        </p>
        {status.hasStoredSettings && (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmClearOpen(true)} disabled={clearing}>
              {status.encryptionMode === "encrypted_only" ? "Borrar y deshabilitar DTE" : "Restaurar configuración del servidor"}
            </Button>
          </div>
        )}
      </section>

      {!status.cutoverComplete && status.canMigrateLegacy && (
        <section role="alert" className="rounded-[var(--radius-xl)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-4 text-[var(--color-warning-ink)]">
          <h2 className="font-semibold">Corte cifrado pendiente</h2>
          <p className="mt-1 text-sm">La operación pausará nuevos inicios, esperará las solicitudes activas al portal y verificará/cifrará todos los campos de una vez. No se puede volver a imágenes legacy después del corte.</p>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmConversionOpen(true)} disabled={!status.canMigrateLegacy || conversion.pending}>
              {conversion.pending ? "Convirtiendo…" : "Convertir y activar corte cifrado"}
            </Button>
          </div>
        </section>
      )}

      {!status.canStoreSecrets && (
        <section role="alert" className="rounded-[var(--radius-xl)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-4 text-[var(--color-danger-ink)]">
          <h2 className="font-semibold">No hay keyring activo</h2>
          <p className="mt-1 text-sm">Sin una clave activa en <code>DTE_SETTINGS_KEYRING</code> no se puede guardar ninguna credencial: escribirla en claro no es una opción, así que el guardado se rechaza. Configure el keyring en el servicio <code>app</code> y vuelva a intentarlo.</p>
        </section>
      )}

      {status.cutoverComplete && status.encryptionStatus === "encrypted_only" && (
        <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="font-semibold text-[var(--color-text)]">Re-cifrado del keyring</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Después de agregar una nueva clave activa al keyring de app, vuelva a cifrar todos los campos antes de retirar la clave anterior. No cambia el RUT, la contraseña, CodEmp ni el email técnico del portal.</p>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmRotationOpen(true)} disabled={rotation.pending}>
              {rotation.pending ? "Re-cifrando…" : "Re-cifrar con clave activa"}
            </Button>
          </div>
        </section>
      )}

      <form action={formAction}>
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5">
            <h2 className="text-h2 text-[var(--color-text)]">Configuración del portal</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              El origen del portal es fijo y validado. Por seguridad, los valores existentes no se cargan ni se envían al navegador: deje vacío para conservarlos.
            </p>
          </div>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <SecretField id="dte-rut-usr" name="rutUsr" label="RUT del usuario" configured={status.fields.rutUsr.configured} clearName="clearRutUsr" placeholder="12345678-9" />
              <SecretField id="dte-rut-emp" name="rutEmp" label="RUT de la empresa" configured={status.fields.rutEmp.configured} clearName="clearRutEmp" placeholder="78023530-6" />
            </div>

            <SecretField id="dte-cod-emp" name="codEmp" label="Código de empresa (CodEmp)" configured={status.fields.codEmp.configured} clearName="clearCodEmp" placeholder="433" />

            <Field label="Contraseña" htmlFor="dte-clave" helper={status.fields.clave.configured ? "Déjela vacía para conservar la existente; marque borrar solo si desea retirarla." : "Ingrese una contraseña solo para configurarla."}>
              <Input id="dte-clave" name="clave" type="password" placeholder="••••••••" autoComplete="new-password" onChange={(event) => setClaveInput(event.currentTarget.value)} />
            </Field>
            {status.fields.clave.configured && (
              <Checkbox id="dte-clear-clave" name="clearClave" value="on" disabled={claveInput.length > 0} label="Borrar la contraseña persistida" />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Intervalo entre consultas (ms)" htmlFor="dte-delay" helper="0–10.000 · en blanco conserva el intervalo actual.">
                <Input id="dte-delay" name="delayMs" type="number" min={0} max={10000} step={100} placeholder="500" />
              </Field>
              <SecretField id="dte-importer" name="importerEmail" label="Email del usuario técnico (importer)" configured={status.fields.importerEmail.configured} clearName="clearImporterEmail" placeholder="tecnico@empresa.cl" type="email" />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Habilitar sincronización</p>
                <p className="text-xs text-[var(--color-text-muted)]">La automatización y la sincronización manual solo corren si está activo.</p>
              </div>
              <Switch id="dte-sync-enabled" checked={syncEnabled} onCheckedChange={setSyncEnabled} label="Habilitar sincronización DTE" />
              <input type="hidden" name="syncEnabled" value={syncEnabled ? "on" : ""} />
            </div>
          </FieldGroup>

          <div className="mt-6 flex justify-end">
            <SubmitButton label="Guardar configuración" loadingLabel="Guardando…" variant="primary" disabled={!status.canStoreSecrets} />
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title={status.encryptionMode === "encrypted_only" ? "¿Borrar y deshabilitar DTE?" : "¿Restaurar la configuración del servidor?"}
        description={status.encryptionMode === "encrypted_only"
          ? "Se borrará la configuración persistida y la sincronización quedará deshabilitada hasta ingresar nuevos valores cifrados."
          : "Se borrará la configuración DTE persistida. El modo compatible podrá volver a usar la configuración protegida del servidor."}
        confirmLabel={status.encryptionMode === "encrypted_only" ? "Borrar y deshabilitar" : "Restaurar"}
        cancelLabel="Cancelar"
        onConfirm={handleClear}
        loading={clearing}
      />
      <ConfirmDialog
        open={confirmConversionOpen}
        onOpenChange={setConfirmConversionOpen}
        title="¿Convertir la configuración DTE a cifrado obligatorio?"
        description="La sincronización se pausará, se esperarán las solicitudes activas al portal y los mismos secretos pasarán a sobres cifrados. No modifica las credenciales en FacturaEnLínea. Después del corte no se permite volver a una imagen legacy."
        confirmLabel="Convertir y pausar"
        cancelLabel="Cancelar"
        onConfirm={handleConversion}
        loading={conversion.pending}
      />
      <ConfirmDialog
        open={confirmRotationOpen}
        onOpenChange={setConfirmRotationOpen}
        title="¿Re-cifrar con la clave activa?"
        description="Confirme sólo después de provisionar la nueva clave junto con la anterior en el keyring de app. La sincronización quedará pausada hasta validar el re-cifrado. Esta acción no cambia las credenciales en FacturaEnLínea."
        confirmLabel="Re-cifrar"
        cancelLabel="Cancelar"
        onConfirm={handleRotation}
        loading={rotation.pending}
      />
    </div>
  )
}

function SecretField({
  id,
  name,
  label,
  configured,
  clearName,
  placeholder,
  type = "text",
}: {
  id: string
  name: string
  label: string
  configured: boolean
  clearName: string
  placeholder: string
  type?: "text" | "email"
}) {
  return (
    <div className="space-y-2">
      <Field label={label} htmlFor={id} helper={configured ? "Vacío conserva el valor existente." : "Aún no configurado."}>
        <Input id={id} name={name} type={type} placeholder={placeholder} autoComplete="off" />
      </Field>
      {configured && <Checkbox id={`dte-${clearName}`} name={clearName} value="on" label={`Borrar ${label.toLowerCase()} persistido`} />}
    </div>
  )
}
