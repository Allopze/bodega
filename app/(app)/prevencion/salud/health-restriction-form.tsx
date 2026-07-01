"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { addHealthRestrictionAction } from "./actions"

interface Props {
  workerId: string
  onDone: () => void
}

const RESTRICTION_KINDS = [
  { value: "no_altura",           label: "No altura" },
  { value: "no_ruido",            label: "No exposición a ruido" },
  { value: "no_quimicos",         label: "No exposición a químicos" },
  { value: "no_levantar_carga",   label: "No levantar carga" },
  { value: "no_conducir",         label: "No conducir vehículos" },
  { value: "no_horas_extras",     label: "No horas extras" },
  { value: "no_turno_noche",      label: "No turno noche" },
  { value: "reubicacion",         label: "Reubicación laboral" },
  { value: "otro",                label: "Otro" },
] as const

export function HealthRestrictionForm({ workerId, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    kind: "no_altura",
    description: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
  })

  function resetError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev
      const { [field]: _drop, ...rest } = prev
      return rest
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const result = await addHealthRestrictionAction({ workerId, ...form })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      setFieldErrors(result.fieldErrors ?? {})
      return
    }
    toast.success(result.message ?? "Restricción registrada.")
    onDone()
    router.refresh()
  }

  const fe = (k: string) => fieldErrors[k]?.[0]

  return (
    <form onSubmit={onSubmit} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <FieldGroup>
        <Field label="Tipo de restricción" htmlFor="hr-kind" required error={fe("kind")}>
          <Select value={form.kind} onValueChange={(v) => { resetError("kind"); setForm((f) => ({ ...f, kind: v })) }}>
            <SelectTrigger id="hr-kind" aria-invalid={!!fe("kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESTRICTION_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Descripción" htmlFor="hr-desc" required error={fe("description")}>
          <Textarea
            id="hr-desc"
            rows={2}
            value={form.description}
            onChange={(e) => { resetError("description"); setForm((f) => ({ ...f, description: e.target.value })) }}
            aria-invalid={!!fe("description")}
            required
          />
        </Field>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Field label="Vigente desde" htmlFor="hr-from" required error={fe("effectiveFrom")}>
            <Input
              id="hr-from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => { resetError("effectiveFrom"); setForm((f) => ({ ...f, effectiveFrom: e.target.value })) }}
              aria-invalid={!!fe("effectiveFrom")}
              required
            />
          </Field>
          <Field label="Vence (opcional)" htmlFor="hr-to" error={fe("effectiveTo")}>
            <Input
              id="hr-to"
              type="date"
              value={form.effectiveTo}
              onChange={(e) => { resetError("effectiveTo"); setForm((f) => ({ ...f, effectiveTo: e.target.value })) }}
              aria-invalid={!!fe("effectiveTo")}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar restricción"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
