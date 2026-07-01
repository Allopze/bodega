"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createPermitTemplateAction } from "./actions"

interface Props {
  onDone?: () => void
}

const RISK_TYPES = [
  { value: "altura", label: "Trabajo en altura" },
  { value: "confinado", label: "Espacio confinado" },
  { value: "caliente", label: "Trabajo en caliente" },
  { value: "excavacion", label: "Excavación" },
  { value: "izaje", label: "Izaje" },
  { value: "electrico", label: "Eléctrico" },
  { value: "otro", label: "Otro" },
]

export function PermitTemplateForm({ onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    code: "",
    title: "",
    riskType: "altura",
    validityHours: "24",
    requiresSignoffRoles: "prevencionista, jefe_terreno",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    const roles = form.requiresSignoffRoles.split(",").map((r) => r.trim()).filter(Boolean)
    const result = await createPermitTemplateAction({
      code: form.code,
      title: form.title,
      riskType: form.riskType,
      astFields: {},
      validityHours: form.validityHours ? Number(form.validityHours) : undefined,
      requiresSignoff: Object.fromEntries(roles.map((r) => [r, true])),
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo crear la plantilla.")
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Plantilla de permiso creada.")
    setForm({ code: "", title: "", riskType: "altura", validityHours: "24", requiresSignoffRoles: "prevencionista, jefe_terreno" })
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Código" htmlFor="ptpl-code" required error={fieldErrors.code?.[0]}>
            <Input id="ptpl-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="AST-ALTURA-01" required />
          </Field>
          <Field label="Título" htmlFor="ptpl-title" required error={fieldErrors.title?.[0]}>
            <Input id="ptpl-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="AST trabajo en altura" required />
          </Field>
          <Field label="Tipo de riesgo" htmlFor="ptpl-risk" required error={fieldErrors.riskType?.[0]}>
            <Select value={form.riskType} onValueChange={(v) => setForm((f) => ({ ...f, riskType: v }))}>
              <SelectTrigger id="ptpl-risk">
                <SelectValue placeholder="Selecciona tipo de riesgo" />
              </SelectTrigger>
              <SelectContent>
                {RISK_TYPES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vigencia (horas)" htmlFor="ptpl-validity" error={fieldErrors.validityHours?.[0]}>
            <Input id="ptpl-validity" type="number" min={1} value={form.validityHours} onChange={(e) => setForm((f) => ({ ...f, validityHours: e.target.value }))} />
          </Field>
        </div>

        <Field label="Roles que deben firmar (coma)" htmlFor="ptpl-signoff" helper="prevencionista, jefe_terreno, admin_contrato" error={fieldErrors.requiresSignoff?.[0]}>
          <Input id="ptpl-signoff" value={form.requiresSignoffRoles} onChange={(e) => setForm((f) => ({ ...f, requiresSignoffRoles: e.target.value }))} />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button> : null}
          <Button type="submit" disabled={submitting}>{submitting ? "Creando…" : "Crear plantilla"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
