"use client"

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react"
import { toast } from "@/lib/toast"
import { SubmitButton } from "@/components/admin/submit-button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { setEmailsEnabledAction, testResendAction } from "./actions"
import { formatDateTime } from "@/lib/utils"
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
        <h2 className="text-h2 text-(--color-text)">Servicio de envío — Resend</h2>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Los correos se envían a través de{" "}
          <span className="font-medium text-(--color-text)">Resend</span>.
          La clave de API se configura con la variable de entorno{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
            RESEND_API_KEY
          </code>
          .
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

        <Row label="Clave API (prefijo)">
          <code className="font-mono text-xs text-(--color-text-muted)">
            {resendStatus.apiKeyPrefix}
          </code>
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

      {!resendStatus.configured && (
        <p className="mt-5 rounded-(--radius) border border-(--color-warning-border) bg-(--color-warning-surface) px-4 py-3 text-sm text-warning">
          Configura <code className="font-mono text-xs">RESEND_API_KEY</code> en el entorno para
          activar el envío de correos.
        </p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-text-subtle uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-(--color-text)">{children}</dd>
    </div>
  )
}
