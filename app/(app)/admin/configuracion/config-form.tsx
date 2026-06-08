"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { updateSystemSettings } from "./actions"

interface ConfigFormProps {
  initialPdfMaxSizeMb: number
}

export function ConfigForm({ initialPdfMaxSizeMb }: ConfigFormProps) {
  const [state, formAction] = useActionState(updateSystemSettings, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Configuración guardada")
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-4">
          Parámetros de Carga de Archivos
        </h2>

        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}

        <FieldGroup className="gap-6">
          <Field
            label="Límite de tamaño de archivo PDF (MB)"
            htmlFor="pdf-max-size"
            required
            helper="Define el tamaño máximo en Megabytes para la subida de facturas anexas en formato PDF."
            error={state.fieldErrors?.pdfMaxSizeMb?.[0]}
          >
            <div className="flex items-center gap-3">
              <Input
                id="pdf-max-size"
                name="pdfMaxSizeMb"
                type="number"
                min="1"
                max="500"
                defaultValue={initialPdfMaxSizeMb}
                error={!!state.fieldErrors?.pdfMaxSizeMb}
                className="w-32 font-mono text-center"
              />
              <span className="text-sm font-medium text-[var(--color-text-muted)]">
                MB
              </span>
            </div>
          </Field>
        </FieldGroup>
      </div>

      <div className="flex justify-end">
        <SubmitButton label="Guardar Configuración" loadingLabel="Guardando..." variant="primary" />
      </div>
    </form>
  )
}
