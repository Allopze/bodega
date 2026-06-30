"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createIncidentAction } from "./actions"

interface Props {
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

const TYPE_OPTIONS = [
  { value: "accidente",             label: "Accidente" },
  { value: "incidente",             label: "Incidente" },
  { value: "cuasi_accidente",       label: "Cuasi accidente" },
  { value: "enfermedad_profesional", label: "Enfermedad profesional" },
] as const

const SEVERITY_OPTIONS = [
  { value: "leve",     label: "Leve" },
  { value: "moderado", label: "Moderado" },
  { value: "grave",    label: "Grave" },
  { value: "fatal",    label: "Fatal" },
] as const

export function IncidentForm({ worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    workerId: "",
    type: "incidente",
    severity: "leve",
    occurredAt: new Date().toISOString().slice(0, 16),
    title: "",
    description: "",
    immediateCause: "",
    rootCause: "",
    location: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.worksiteId || !form.title || !form.description) {
      toast.error("Completa faena, título y descripción.")
      return
    }
    setSubmitting(true)
    const result = await createIncidentAction({
      worksiteId: form.worksiteId,
      workerId: form.workerId || undefined,
      type: form.type as "accidente" | "incidente" | "cuasi_accidente" | "enfermedad_profesional",
      severity: form.severity as "leve" | "moderado" | "grave" | "fatal",
      occurredAt: new Date(form.occurredAt).toISOString(),
      title: form.title,
      description: form.description,
      immediateCause: form.immediateCause || undefined,
      rootCause: form.rootCause || undefined,
      location: form.location || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Incidente registrado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="inc-ws" required>
            <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
              <SelectTrigger id="inc-ws">
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tipo" htmlFor="inc-type" required>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
              <SelectTrigger id="inc-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Gravedad" htmlFor="inc-sev" required>
            <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
              <SelectTrigger id="inc-sev">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fecha y hora" htmlFor="inc-when" required>
            <Input
              id="inc-when"
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Título" htmlFor="inc-title" required>
          <Input
            id="inc-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </Field>

        <Field label="Descripción" htmlFor="inc-desc" required>
          <Textarea
            id="inc-desc"
            rows={4}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            required
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Causa inmediata" htmlFor="inc-immediate">
            <Textarea
              id="inc-immediate"
              rows={3}
              value={form.immediateCause}
              onChange={(e) => setForm((f) => ({ ...f, immediateCause: e.target.value }))}
            />
          </Field>
          <Field label="Causa raíz" htmlFor="inc-root">
            <Textarea
              id="inc-root"
              rows={3}
              value={form.rootCause}
              onChange={(e) => setForm((f) => ({ ...f, rootCause: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar incidente"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}