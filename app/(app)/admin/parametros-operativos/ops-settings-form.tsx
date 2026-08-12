"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/admin/submit-button"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { saveOperationalSettingsAction } from "./actions"

interface OpsSettingsFormProps {
  current: {
    exportMaxRows: number
    notificationRetentionDays: number
    feedbackAttachmentMaxMb: number
    pdtpEvidenceMaxMb: number
    pdtpEvidenceRetentionDays: number
  }
  defaults: typeof import("@/lib/services/system-settings").DEFAULT_OPS_SETTINGS
  office: {
    worksites: { id: string; name: string; code: string }[]
    configuredId: string
    resolvedId: string | null
  }
}

export function OpsSettingsForm({ current, defaults, office }: OpsSettingsFormProps) {
  const resuelta = office.worksites.find((w) => w.id === office.resolvedId)
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveOperationalSettingsAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Parámetros guardados")
      } else if (result.message) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  return (
    <form action={formAction} className="space-y-6">
      {state.message && !state.ok && (
        <div className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-danger)]">
          {state.message}
        </div>
      )}

      <Section
        title="Bodega de origen"
        description="Qué faena representa la oficina central: de ahí sale el stock de toda guía de despacho interna y ahí se registra la llegada del proveedor."
      >
        <Field
          label="Faena que hace de oficina"
          htmlFor="officeWorksiteId"
          helper={
            office.configuredId
              ? "Fijada explícitamente: sobrevive a que renombren la faena."
              : `Hoy se deduce del nombre y da ${resuelta ? `“${resuelta.name}”` : "ninguna faena — por eso la recepción en oficina falla"}. Elígela para dejar de depender del nombre.`
          }
          error={state.fieldErrors?.officeWorksiteId?.[0]}
        >
          <OptionSelect
            id="officeWorksiteId"
            name="officeWorksiteId"
            defaultValue={office.configuredId}
            emptyLabel="Deducir por el nombre de la faena"
            options={office.worksites.map((worksite) => ({
              value: worksite.id,
              label: `${worksite.name} · ${worksite.code}`,
            }))}
            error={!!state.fieldErrors?.officeWorksiteId}
          />
        </Field>
      </Section>

      <Section title="Exportaciones" description="Tope de filas por archivo al exportar listados.">
        <Field
          label="Máximo de filas por exportación"
          htmlFor="exportMaxRows"
          helper={`Predeterminado: ${defaults.exportMaxRows}. Rango permitido: 100 a 100.000.`}
          error={state.fieldErrors?.exportMaxRows?.[0]}
        >
          <Input
            id="exportMaxRows"
            name="exportMaxRows"
            type="number"
            min={100}
            max={100_000}
            step={100}
            defaultValue={String(current.exportMaxRows)}
            error={!!state.fieldErrors?.exportMaxRows}
          />
        </Field>
      </Section>

      <Section title="Notificaciones" description="Cuánto tiempo se conservan las notificaciones leídas antes de purga.">
        <Field
          label="Retención (días)"
          htmlFor="notificationRetentionDays"
          helper={`Predeterminado: ${defaults.notificationRetentionDays}. Rango permitido: 7 a 3.650 días.`}
          error={state.fieldErrors?.notificationRetentionDays?.[0]}
        >
          <Input
            id="notificationRetentionDays"
            name="notificationRetentionDays"
            type="number"
            min={7}
            max={3650}
            step={1}
            defaultValue={String(current.notificationRetentionDays)}
            error={!!state.fieldErrors?.notificationRetentionDays}
          />
        </Field>
      </Section>

      <Section title="Adjuntos de soporte" description="Tamaño máximo que puede adjuntar un usuario al crear un ticket de soporte.">
        <Field
          label="Adjunto máximo (MB)"
          htmlFor="feedbackAttachmentMaxMb"
          helper={`Predeterminado: ${defaults.feedbackAttachmentMaxMb}. Rango permitido: 1 a 20 MB.`}
          error={state.fieldErrors?.feedbackAttachmentMaxMb?.[0]}
        >
          <Input
            id="feedbackAttachmentMaxMb"
            name="feedbackAttachmentMaxMb"
            type="number"
            min={1}
            max={20}
            step={1}
            defaultValue={String(current.feedbackAttachmentMaxMb)}
            error={!!state.fieldErrors?.feedbackAttachmentMaxMb}
          />
        </Field>
      </Section>

      <Section title="Evidencias PDTP" description="Tamaño máximo y retención de las fotos asociadas a las ejecuciones PDTP.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Foto máxima (MB)"
            htmlFor="pdtpEvidenceMaxMb"
            helper={`Predeterminado: ${defaults.pdtpEvidenceMaxMb}. Rango: 1 a 100 MB.`}
            error={state.fieldErrors?.pdtpEvidenceMaxMb?.[0]}
          >
            <Input
              id="pdtpEvidenceMaxMb"
              name="pdtpEvidenceMaxMb"
              type="number"
              min={1}
              max={100}
              step={1}
              defaultValue={String(current.pdtpEvidenceMaxMb)}
              error={!!state.fieldErrors?.pdtpEvidenceMaxMb}
            />
          </Field>
          <Field
            label="Retención (días)"
            htmlFor="pdtpEvidenceRetentionDays"
            helper={`Predeterminado: ${defaults.pdtpEvidenceRetentionDays}. Rango: 30 a 3.650 días.`}
            error={state.fieldErrors?.pdtpEvidenceRetentionDays?.[0]}
          >
            <Input
              id="pdtpEvidenceRetentionDays"
              name="pdtpEvidenceRetentionDays"
              type="number"
              min={30}
              max={3650}
              step={1}
              defaultValue={String(current.pdtpEvidenceRetentionDays)}
              error={!!state.fieldErrors?.pdtpEvidenceRetentionDays}
            />
          </Field>
        </div>
      </Section>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={() => window.location.reload()}>Restablecer</Button>
        <SubmitButton label="Guardar parámetros" loadingLabel="Guardando..." />
      </div>
    </form>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">{description}</p>
      <FieldGroup className="gap-4">{children}</FieldGroup>
    </Card>
  )
}
