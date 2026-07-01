"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import type { HealthExam } from "@/db/schema"
import { setHealthAptitudeAction } from "./actions"

interface Props {
  workerId: string
  exams: HealthExam[]
  onDone: () => void
}

const APTITUDE_OPTIONS = [
  { value: "apto", label: "Apto" },
  { value: "apto_con_restricciones", label: "Apto con restricciones" },
  { value: "no_apto", label: "No apto" },
]

export function HealthAptitudeForm({ workerId, exams, onDone }: Props) {
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    examId: "",
    position: "",
    aptitude: "apto",
    validUntil: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await setHealthAptitudeAction({ workerId, ...form, restrictions: {} })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      setFieldErrors(result.fieldErrors ?? {})
      return
    }
    toast.success(result.message ?? "Aptitud registrada.")
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Cargo evaluado" htmlFor="hapt-position" required error={fieldErrors.position?.[0]}>
            <Input
              id="hapt-position"
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              placeholder="Operador"
              required
            />
          </Field>

          <Field label="Aptitud" htmlFor="hapt-aptitude" required error={fieldErrors.aptitude?.[0]}>
            <Select value={form.aptitude} onValueChange={(v) => setForm((f) => ({ ...f, aptitude: v }))}>
              <SelectTrigger id="hapt-aptitude">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APTITUDE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Examen asociado" htmlFor="hapt-exam" helper="Opcional">
            <Select value={form.examId} onValueChange={(v) => setForm((f) => ({ ...f, examId: v }))}>
              <SelectTrigger id="hapt-exam">
                <SelectValue placeholder="Sin examen asociado" />
              </SelectTrigger>
              <SelectContent>
                {exams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.type} · {e.performedAt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Válida hasta" htmlFor="hapt-valid" helper="Opcional">
            <Input
              id="hapt-valid"
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Registrar aptitud"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
