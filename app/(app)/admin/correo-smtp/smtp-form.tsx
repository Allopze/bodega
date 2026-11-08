"use client"

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react"
import { toast } from "@/lib/toast"
import {
  SecretSettingField,
  SETTING_SOURCE_LABELS,
  SettingsKeyringCallout,
} from "@/components/admin/secret-setting-field"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { SubmitButton } from "@/components/ui/submit-button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { INITIAL_STATE } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  restoreResendSettingsAction,
  saveResendApiKeyAction,
  setEmailsEnabledAction,
  testResendAction,
} from "./actions"
import { formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/masters"
import type { LastDeliveryTest, ResendStatus } from "@/lib/services/smtp-settings"

interface CorreoFormsProps {
  resendStatus: ResendStatus
  initialEmailsEnabled: boolean
  lastTest: LastDeliveryTest | null
}

export function CorreoForms({ resendStatus, initialEmailsEnabled, lastTest }: CorreoFormsProps) {
  return (
    <div className="space-y-6">
      <EmailDeliveryStatus resendStatus={resendStatus} emailsEnabled={initialEmailsEnabled} lastTest={lastTest} />
      <EmailsEnabledForm initialEmailsEnabled={initialEmailsEnabled} />
      <ResendStatusCard resendStatus={resendStatus} />
    </div>
  )
}

function EmailDeliveryStatus({
  resendStatus,
  emailsEnabled,
  lastTest,
}: {
  resendStatus: ResendStatus
  emailsEnabled: boolean
  lastTest: LastDeliveryTest | null
}) {
  const status = !resendStatus.configured
    ? {
        title: "Suspendido: proveedor no configurado",
        description: "El interruptor global puede quedar activo, pero no se enviará ningún correo hasta configurar Resend.",
        className: "border-[var(--color-danger)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
      }
    : !emailsEnabled
      ? {
          title: "Suspendido: envíos globales desactivados",
          description: "Resend está configurado, pero invitaciones, notificaciones y recuperación de contraseña permanecerán pausadas.",
          className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
        }
      // El único verde con evidencia: una entrega que el proveedor aceptó.
      // Antes esta rama decía "prueba pendiente" para siempre, aunque la prueba
      // se hubiera enviado con éxito — un estado que no cambiaba nunca.
      : lastTest?.ok
        ? {
            title: "Entrega confirmada",
            description: `El proveedor aceptó el último correo de prueba${lastTest.recipient ? ` a ${lastTest.recipient}` : ""}. La aceptación no garantiza la bandeja de entrada del destinatario.`,
            className: "border-[var(--color-success)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
          }
        : lastTest
          ? {
              title: "La última prueba de envío falló",
              description: lastTest.error ?? "El proveedor rechazó el correo de prueba y no informó una causa.",
              className: "border-[var(--color-danger)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
            }
          : {
              title: "Configurado: prueba de envío pendiente",
              description: "La clave y el interruptor global están disponibles. Envía una prueba antes de asumir que el proveedor entrega correos.",
              className: "border-[var(--color-warning)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
            }

  return (
    <section role="status" className={`rounded-(--radius-2xl) border p-4 ${status.className}`}>
      <h2 className="font-semibold">{status.title}</h2>
      <p className="mt-1 text-sm">{status.description}</p>
      {lastTest && (
        <p className="mt-1 text-xs opacity-90">
          Última prueba: {formatDateTime(lastTest.attemptedAt)}
        </p>
      )}
    </section>
  )
}

function EmailsEnabledForm({ initialEmailsEnabled }: { initialEmailsEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(setEmailsEnabledAction, INITIAL_STATE)
  const [emailsEnabled, setEmailsEnabled] = useState(initialEmailsEnabled)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const confirmedRef = useRef(false)

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Configuración guardada")
    else if (state.message && !state.fieldErrors) toast.error(state.message)
  }, [state])

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    if (!confirmedRef.current) {
      event.preventDefault()
      setConfirmOpen(true)
      return
    }
    confirmedRef.current = false
  }

  function confirmChange() {
    confirmedRef.current = true
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  function closeConfirmation(open: boolean) {
    setConfirmOpen(open)
    if (!open) setEmailsEnabled(initialEmailsEnabled)
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={requestConfirmation}>
      <div className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-6">
        <div className="mb-4">
          <h2 className="text-h2 text-(--color-text)">Envío de correos</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            Interruptor global para todos los envíos de correo del sistema.
          </p>
        </div>

        <Checkbox
          id="emails-enabled"
          name="emailsEnabled"
          value="on"
          checked={emailsEnabled}
          onChange={(event) => setEmailsEnabled(event.currentTarget.checked)}
          label="Enviar correos del sistema"
        />
        <p className="mt-1.5 text-xs text-text-subtle">
          Al desactivarlo se pausan <strong>todos</strong> los envíos (notificaciones,
          invitaciones y restablecimiento de contraseña). Las notificaciones dentro de
          la app no se ven afectadas.
        </p>

        <div className="mt-5 flex justify-end">
          <SubmitButton label="Guardar" loadingLabel="Guardando..." variant="primary" />
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={closeConfirmation}
        title={emailsEnabled ? "¿Activar todos los correos del sistema?" : "¿Pausar todos los correos del sistema?"}
        description={emailsEnabled
          ? "Habilitarás invitaciones, notificaciones y recuperación de contraseña si el proveedor está configurado."
          : "Se pausarán invitaciones, notificaciones y recuperación de contraseña hasta volver a activar este interruptor."}
        confirmLabel={emailsEnabled ? "Activar correos" : "Pausar correos"}
        cancelLabel="Cancelar"
        onConfirm={confirmChange}
        loading={pending}
      />
    </form>
  )
}

function ResendStatusCard({ resendStatus }: { resendStatus: ResendStatus }) {
  const [testing, setTesting] = useState(false)

  async function handleTest() {
    if (testing) return
    setTesting(true)
    try {
      const result = await testResendAction(null, new FormData())
      if (result?.ok) toast.success(result.message ?? "Correo enviado")
      else toast.error(result?.message ?? "Error al enviar correo de prueba")
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-6">
      <div className="mb-5">
        <h2 className="text-h2 text-(--color-text)">Servicio de envío: Resend</h2>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Los correos se envían a través de{" "}
          <span className="font-medium text-(--color-text)">Resend</span>.
          La clave de API se guarda cifrada en la plataforma; si no hay una guardada,
          se usa la que tenga configurada el servidor.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
        <Row label="Estado">
          <span
            className={
              resendStatus.configured
                ? "font-medium text-(--color-success)"
                : "font-medium text-danger"
            }
          >
            {resendStatus.configured ? "Configurado; requiere prueba" : "No configurado"}
          </span>
        </Row>

        <Row label="Origen de la clave API">
          <span className="text-(--color-text-muted)">
            {SETTING_SOURCE_LABELS[resendStatus.source]}
          </span>
        </Row>

        <Row label="Remitente (From)">
          <code className="font-mono text-xs text-(--color-text-muted)">
            {resendStatus.from}
          </code>
        </Row>

        <Row label="Dominio verificado">
          <span className="text-(--color-text-muted)">portalchome.cl</span>
        </Row>
      </dl>

      {!resendStatus.configured && (
        <Callout tone="warning" className="mt-5">
          Guarda una clave de API de Resend para activar el envío de correos.
        </Callout>
      )}

      <ResendApiKeyForm resendStatus={resendStatus} />

      {resendStatus.configured && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-(--radius) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm font-medium text-(--color-text) transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {testing ? "Enviando..." : "Enviar correo de prueba"}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Clave de API de solo escritura: el campo parte vacío, vacío conserva la
 * guardada y la clave jamás vuelve al navegador (ni siquiera un prefijo).
 * Restaurar borra lo guardado y devuelve el mando al `.env` del servidor.
 */
function ResendApiKeyForm({ resendStatus }: { resendStatus: ResendStatus }) {
  // El aviso sale dentro de la acción, donde se conoce el resultado.
  const [, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveResendApiKeyAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Clave de Resend guardada")
    else if (result.message) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false)
  const restore = useOperation()

  function openRestore() {
    restore.setMessage("")
    setConfirmRestoreOpen(true)
  }

  function handleRestore() {
    restore.run(restoreResendSettingsAction, (result) => {
      setConfirmRestoreOpen(false)
      toast.success(result.message ?? "Configuración del servidor restaurada")
    })
  }

  return (
    <div className="mt-6 border-t border-(--color-border) pt-5">
      {!resendStatus.canStoreSecrets && (
        <div className="mb-4">
          <SettingsKeyringCallout>
            Mientras tanto el correo sigue usando la clave del servidor y la prueba de envío funciona igual.
          </SettingsKeyringCallout>
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <SecretSettingField
          id="resend-api-key"
          name="apiKey"
          label="Clave API de Resend"
          type="password"
          placeholder="re_..."
          status={{ configured: resendStatus.configured, source: resendStatus.source }}
          clearName="clearApiKey"
          disabled={!resendStatus.canStoreSecrets}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          {resendStatus.hasStoredSettings && (
            <Button type="button" variant="secondary" size="sm" onClick={openRestore} disabled={restore.pending}>
              Restaurar la configuración del servidor
            </Button>
          )}
          <SubmitButton
            label="Guardar clave"
            loadingLabel="Guardando..."
            variant="primary"
            disabled={!resendStatus.canStoreSecrets}
          />
        </div>
      </form>

      <ConfirmDialog
        open={confirmRestoreOpen}
        onOpenChange={setConfirmRestoreOpen}
        title="¿Restaurar la configuración del servidor?"
        description="Se borra la clave guardada en la plataforma y el correo vuelve a usar la clave del servidor (.env). Si el servidor no tiene ninguna, no se enviará ningún correo hasta guardar una nueva."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        variant="warning"
        onConfirm={handleRestore}
        loading={restore.pending}
        error={restore.message || undefined}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-eyebrow">
        {label}
      </dt>
      <dd className="text-(--color-text)">{children}</dd>
    </div>
  )
}
