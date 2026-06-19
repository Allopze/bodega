"use client"

import { useState } from "react"
import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { updateTemplateAction, resetTemplateAction } from "./actions"

interface TemplateItem {
  id:        string
  key:       string
  name:      string
  subject:   string
  bodyHtml:  string
  isDefault: boolean
  updatedAt: string
}

interface TemplateListProps {
  templates: TemplateItem[]
}

export function TemplateList({ templates }: TemplateListProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null)

  if (templates.length === 0) {
    return (
      <div className="rounded-[var(--radius-2xl)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          No hay plantillas. Vuelve a sembrar los datos.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {templates.map((tmpl) => (
        <TemplateCard
          key={tmpl.key}
          template={tmpl}
          isEditing={editingKey === tmpl.key}
          onStartEdit={() => setEditingKey(tmpl.key)}
          onStopEdit={() => setEditingKey(null)}
        />
      ))}
    </div>
  )
}

function TemplateCard({
  template,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  template: TemplateItem
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  const [state, formAction, isPending] = useActionState(updateTemplateAction, INITIAL_STATE)
  const [resetState, resetFormAction] = useActionState(resetTemplateAction, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Plantilla actualizada")
      onStopEdit()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state, onStopEdit])

  useEffect(() => {
    if (resetState.ok) {
      toast.success(resetState.message ?? "Plantilla restaurada")
      onStopEdit()
    } else if (resetState.message) {
      toast.error(resetState.message)
    }
  }, [resetState, onStopEdit])

  if (isEditing) {
    return (
      <form action={formAction} className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
        <input type="hidden" name="key" value={template.key} />

        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">{template.name}</h3>
              <p className="text-xs text-[var(--color-text-muted)]">{template.key}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onStopEdit}
                className="rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              >
                Cancelar
              </button>
              <SubmitButton label="Guardar" loadingLabel="Guardando..." variant="primary" />
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {state.message && !state.ok && !state.fieldErrors && (
            <p className="text-sm text-[var(--color-danger)]">{state.message}</p>
          )}

          <Field
            label="Asunto"
            htmlFor={`subject-${template.key}`}
            required
            helper="Usa {{variable}} para valores dinámicos"
            error={state.fieldErrors?.subject?.[0]}
          >
            <Input
              id={`subject-${template.key}`}
              name="subject"
              defaultValue={template.subject}
              error={!!state.fieldErrors?.subject}
            />
          </Field>

          <Field
            label="Cuerpo HTML"
            htmlFor={`body-${template.key}`}
            required
            helper="HTML completo con {{variable}} para valores dinámicos. {{#var}}...{{/var}} para condicionales."
            error={state.fieldErrors?.bodyHtml?.[0]}
          >
            <textarea
              id={`body-${template.key}`}
              name="bodyHtml"
              defaultValue={template.bodyHtml}
              rows={12}
              className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-ring)]"
              spellCheck={false}
            />
          </Field>

          <PreviewBlock template={template} />
        </div>
      </form>
    )
  }

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{template.name}</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">{template.key}</code>
            <span className="ml-2">Asunto: {template.subject}</span>
            {template.isDefault && (
              <span className="ml-2 text-[var(--color-success)]">(por defecto)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={resetFormAction} className="inline">
            <input type="hidden" name="key" value={template.key} />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Restaurar default
            </button>
          </form>
          <button
            type="button"
            onClick={onStartEdit}
            className="rounded-[var(--radius)] bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--color-primary-shade)]"
          >
            Editar
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewBlock({ template }: { template: TemplateItem }) {
  const previewVars: Record<string, string> = {
    app_name:    "Chome Bodega",
    sender_name: "Administrador",
    user_name:   "Juan Pérez",
    title:       "Notificación de prueba",
    body:        "Este es el cuerpo de la notificación.",
    href:        "https://app.chome.cl/dashboard",
    invite_url:  "https://app.chome.cl/invitar/abc123",
  }

  const preview = template.subject.replace(/\{\{(\w+)\}\}/g, (_, key) => previewVars[key] ?? `{{${key}}}`)

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">Vista previa del asunto:</p>
      <p className="text-sm text-[var(--color-text)]">{preview}</p>
    </div>
  )
}
