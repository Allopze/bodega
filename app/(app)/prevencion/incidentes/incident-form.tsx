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
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({})

  function resetError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.worksiteId || !form.title || !form.description) {
      toast.error("Completa faena, título y descripción.")
      return
    }
    setSubmitting(true)
    setErrors({})
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
      if (result.fieldErrors) {
        setErrors(result.fieldErrors)
        const firstField = Object.keys(result.fieldErrors)[0]
        const firstMsg = firstField ? result.fieldErrors[firstField]?.[0] : undefined
        toast.error(firstMsg ? `${firstField}: ${firstMsg}` : (result.message ?? "Revisa los campos del formulario."))
      } else {
        toast.error(result.message ?? "Error al registrar incidente.")
      }
      return
    }
    toast.success("Incidente registrado.")
    onDone?.()
    router.refresh()
  }

  const fe = (k: string) => errors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Faena" htmlFor="inc-ws" required error={fe("worksiteId")}>
            <Select value={form.worksiteId} onValueChange={(v) => { resetError("worksiteId"); setForm((f) => ({ ...f, worksiteId: v })) }}>
              <SelectTrigger id="inc-ws" aria-invalid={!!fe("worksiteId")}>
                <SelectValue placeholder="Selecciona faena" />
              </SelectTrigger>
              <SelectContent>
                {worksites.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tipo" htmlFor="inc-type" required error={fe("type")}>
            <Select value={form.type} onValueChange={(v) => { resetError("type"); setForm((f) => ({ ...f, type: v })) }}>
              <SelectTrigger id="inc-type" aria-invalid={!!fe("type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Gravedad" htmlFor="inc-sev" required error={fe("severity")}>
            <Select value={form.severity} onValueChange={(v) => { resetError("severity"); setForm((f) => ({ ...f, severity: v })) }}>
              <SelectTrigger id="inc-sev" aria-invalid={!!fe("severity")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fecha y hora" htmlFor="inc-when" required error={fe("occurredAt")}>
            <Input
              id="inc-when"
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => { resetError("occurredAt"); setForm((f) => ({ ...f, occurredAt: e.target.value })) }}
              aria-invalid={!!fe("occurredAt")}
              required
            />
          </Field>
        </div>

        <Field label="Título" htmlFor="inc-title" required error={fe("title")}>
          <Input
            id="inc-title"
            value={form.title}
            onChange={(e) => { resetError("title"); setForm((f) => ({ ...f, title: e.target.value })) }}
            aria-invalid={!!fe("title")}
            required
          />
        </Field>

        <Field label="Descripción" htmlFor="inc-desc" required error={fe("description")}>
          <Textarea
            id="inc-desc"
            rows={4}
            value={form.description}
            onChange={(e) => { resetError("description"); setForm((f) => ({ ...f, description: e.target.value })) }}
            aria-invalid={!!fe("description")}
            required
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Causa inmediata" htmlFor="inc-immediate" error={fe("immediateCause")}>
            <Textarea
              id="inc-immediate"
              rows={3}
              value={form.immediateCause}
              onChange={(e) => { resetError("immediateCause"); setForm((f) => ({ ...f, immediateCause: e.target.value })) }}
              aria-invalid={!!fe("immediateCause")}
            />
          </Field>
          <Field label="Causa raíz" htmlFor="inc-root" error={fe("rootCause")}>
            <Textarea
              id="inc-root"
              rows={3}
              value={form.rootCause}
              onChange={(e) => { resetError("rootCause"); setForm((f) => ({ ...f, rootCause: e.target.value })) }}
              aria-invalid={!!fe("rootCause")}
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