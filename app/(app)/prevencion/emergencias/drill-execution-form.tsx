"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { recordDrillExecutionAction } from "./actions"

interface Props {
  drillId: string
  onDone?: () => void
}

export function DrillExecutionForm({ drillId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    attendees: "",
    findings: "",
    effectiveness: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await recordDrillExecutionAction(drillId, form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Ejecución de simulacro registrada.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Asistentes" htmlFor="drillexec-attendees" error={fieldErrors.attendees?.[0]}>
            <Input
              id="drillexec-attendees"
              type="number"
              min={0}
              value={form.attendees}
              onChange={(e) => setForm((f) => ({ ...f, attendees: e.target.value }))}
              placeholder="24"
            />
          </Field>

          <Field label="Efectividad" htmlFor="drillexec-effectiveness" error={fieldErrors.effectiveness?.[0]}>
            <Input
              id="drillexec-effectiveness"
              value={form.effectiveness}
              onChange={(e) => setForm((f) => ({ ...f, effectiveness: e.target.value }))}
              placeholder="Efectivo, parcial, no efectivo…"
            />
          </Field>
        </div>

        <Field
          label="Hallazgos"
          htmlFor="drillexec-findings"
          helper="Texto libre o JSON con observaciones del simulacro."
          error={fieldErrors.findings?.[0]}
        >
          <Textarea
            id="drillexec-findings"
            value={form.findings}
            onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))}
            placeholder="Tiempo de evacuación: 4 min. Punto de encuentro despejado…"
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Registrar ejecución"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
