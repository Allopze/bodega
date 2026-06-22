"use client"

import { useActionState } from "react"
import { useEffect } from "react"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/admin/submit-button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { updateReportStatusAction } from "@/app/(app)/soporte/actions"
import type { ActionState } from "@/lib/validation/feedback"
import type { FeedbackEstado } from "@/lib/validation/feedback"
import { INITIAL_STATE } from "@/components/admin/form-state"

const ESTADO_OPTIONS: { value: FeedbackEstado; label: string }[] = [
  { value: "abierto",     label: "Abierto" },
  { value: "en_progreso", label: "En progreso" },
  { value: "resuelto",    label: "Resuelto" },
  { value: "descartado",  label: "Descartado" },
]

interface Props {
  reportId:         string
  currentEstado:    FeedbackEstado
  currentNota:      string | null
}

export function StatusPanel({ reportId, currentEstado, currentNota }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateReportStatusAction,
    INITIAL_STATE,
  )

  useEffect(() => {
    if (!state.ok && state.message) {
      toast.error(state.message)
    } else if (state.ok && state.message) {
      toast.success(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={reportId} />

      <Field
        label="Estado"
        htmlFor="estado"
        error={state.fieldErrors?.estado?.[0]}
      >
        <Select name="estado" defaultValue={currentEstado}>
          <SelectTrigger id="estado" error={!!state.fieldErrors?.estado}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ESTADO_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Nota interna"
        htmlFor="notaInterna"
        helper="Solo visible para gestores"
        error={state.fieldErrors?.notaInterna?.[0]}
      >
        <Textarea
          id="notaInterna"
          name="notaInterna"
          defaultValue={currentNota ?? ""}
          placeholder="Contexto interno, decisión tomada, enlace a PR, etc."
          rows={4}
          error={!!state.fieldErrors?.notaInterna}
        />
      </Field>

      <SubmitButton label="Guardar cambios" loadingLabel="Guardando…" />
    </form>
  )
}
