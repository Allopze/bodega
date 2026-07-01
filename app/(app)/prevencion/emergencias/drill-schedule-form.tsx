"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { scheduleDrillAction } from "./actions"

interface Props {
  planId: string
  onDone?: () => void
}

export function DrillScheduleForm({ planId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    type: "",
    scheduledAt: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.type || !form.scheduledAt) {
      toast.error("Completa tipo y fecha programada.")
      return
    }
    setSubmitting(true)
    setFieldErrors({})
    const result = await scheduleDrillAction({ planId, type: form.type, scheduledAt: form.scheduledAt })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Simulacro programado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tipo de simulacro" htmlFor="drill-type" required error={fieldErrors.type?.[0]}>
            <Input
              id="drill-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              placeholder="Incendio, evacuación, sismo…"
              required
            />
          </Field>

          <Field label="Fecha programada" htmlFor="drill-scheduled" required error={fieldErrors.scheduledAt?.[0]}>
            <Input
              id="drill-scheduled"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              required
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Programando…" : "Programar simulacro"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
