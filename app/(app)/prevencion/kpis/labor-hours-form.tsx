"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { setLaborHoursAction } from "./actions"

interface Props {
  worksiteId: string
  onDone?: () => void
}

export function LaborHoursForm({ worksiteId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    period: new Date().toISOString().slice(0, 7),
    hours: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await setLaborHoursAction({ ...form, worksiteId })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudieron registrar las horas hombre.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success(result.message ?? "Horas hombre registradas.")
    setForm((f) => ({ ...f, hours: "" }))
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Período (mes)" htmlFor="lh-period" required error={fieldErrors.period?.[0]}>
            <Input id="lh-period" type="month" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} required />
          </Field>
          <Field label="Horas hombre trabajadas (HHT)" htmlFor="lh-hours" required error={fieldErrors.hours?.[0]}>
            <Input id="lh-hours" type="number" min={0} step="0.01" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} required />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar horas hombre"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
