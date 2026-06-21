"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import { SubmitButton } from "@/components/admin/submit-button"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { setEmailsEnabledAction, testResendAction } from "./actions"
import type { ResendStatus } from "@/lib/services/smtp-settings"

interface CorreoFormsProps {
  resendStatus: ResendStatus
  initialEmailsEnabled: boolean
}

export function CorreoForms({ resendStatus, initialEmailsEnabled }: CorreoFormsProps) {
  return (
    <div className="space-y-6">
      <EmailsEnabledForm initialEmailsEnabled={initialEmailsEnabled} />
      <ResendStatusCard resendStatus={resendStatus} />
    </div>
  )
}

function EmailsEnabledForm({ initialEmailsEnabled }: { initialEmailsEnabled: boolean }) {
  const [state, formAction] = useActionState(setEmailsEnabledAction, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Configuración guardada")
    else if (state.message && !state.fieldErrors) toast.error(state.message)
  }, [state])

  return (
    <form action={formAction}>
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
          defaultChecked={initialEmailsEnabled}
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
            {resendStatus.configured ? "✓ Configurado" : "✗ No configurado"}
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
