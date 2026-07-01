"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import type { MinsalProtocol } from "@/db/schema"
import { registerHealthExamAction } from "./actions"

interface Props {
  workerId: string
  protocols: MinsalProtocol[]
  onDone: () => void
}

const RESULT_OPTIONS = [
  { value: "apto", label: "Apto" },
  { value: "apto_con_restricciones", label: "Apto con restricciones" },
  { value: "no_apto", label: "No apto" },
  { value: "pendiente", label: "Pendiente" },
]

export function HealthExamForm({ workerId, protocols, onDone }: Props) {
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    type: "",
    protocolId: "",
    performedAt: new Date().toISOString().slice(0, 10),
    result: "pendiente",
    expiresAt: "",
    evidenceUrl: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await registerHealthExamAction({ workerId, ...form })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      setFieldErrors(result.fieldErrors ?? {})
      return
    }
    toast.success(result.message ?? "Examen registrado.")
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tipo de examen" htmlFor="hexm-type" required error={fieldErrors.type?.[0]}>
            <Input
              id="hexm-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              placeholder="Examen preocupacional"
              required
            />
          </Field>

          <Field label="Protocolo MINSAL" htmlFor="hexm-protocol" helper="Opcional">
            <Select value={form.protocolId} onValueChange={(v) => setForm((f) => ({ ...f, protocolId: v }))}>
              <SelectTrigger id="hexm-protocol">
                <SelectValue placeholder="Sin protocolo" />
              </SelectTrigger>
              <SelectContent>
                {protocols.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fecha de realización" htmlFor="hexm-performed" required error={fieldErrors.performedAt?.[0]}>
            <Input
              id="hexm-performed"
              type="date"
              value={form.performedAt}
              onChange={(e) => setForm((f) => ({ ...f, performedAt: e.target.value }))}
              required
            />
          </Field>

          <Field label="Resultado" htmlFor="hexm-result" required error={fieldErrors.result?.[0]}>
            <Select value={form.result} onValueChange={(v) => setForm((f) => ({ ...f, result: v }))}>
              <SelectTrigger id="hexm-result">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESULT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Vence" htmlFor="hexm-expires" helper="Opcional">
            <Input
              id="hexm-expires"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
            />
          </Field>

          <Field label="URL de evidencia" htmlFor="hexm-evidence" helper="Opcional">
            <Input
              id="hexm-evidence"
              value={form.evidenceUrl}
              onChange={(e) => setForm((f) => ({ ...f, evidenceUrl: e.target.value }))}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Registrar examen"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
