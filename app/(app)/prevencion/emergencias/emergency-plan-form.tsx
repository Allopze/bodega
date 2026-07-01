"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createEmergencyPlanAction } from "./actions"

interface Props {
  worksites: { id: string; name: string }[]
  onDone?: () => void
}

export function EmergencyPlanForm({ worksites, onDone }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})
  const [form, setForm] = React.useState({
    worksiteId: worksites[0]?.id ?? "",
    threats: "",
    roles: "",
    routes: "",
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.worksiteId) {
      toast.error("Selecciona una faena.")
      return
    }
    setSubmitting(true)
    setFieldErrors({})
    const result = await createEmergencyPlanAction(form)
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      if (result.fieldErrors) setFieldErrors(result.fieldErrors)
      return
    }
    toast.success("Plan de emergencia creado.")
    onDone?.()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <FieldGroup>
        <Field label="Faena" htmlFor="emerplan-worksite" required error={fieldErrors.worksiteId?.[0]}>
          <Select value={form.worksiteId} onValueChange={(v) => setForm((f) => ({ ...f, worksiteId: v }))}>
            <SelectTrigger id="emerplan-worksite">
              <SelectValue placeholder="Selecciona faena" />
            </SelectTrigger>
            <SelectContent>
              {worksites.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Amenazas"
          htmlFor="emerplan-threats"
          helper="Texto libre o JSON (ej: incendio, sismo, derrame)."
          error={fieldErrors.threats?.[0]}
        >
          <Textarea
            id="emerplan-threats"
            value={form.threats}
            onChange={(e) => setForm((f) => ({ ...f, threats: e.target.value }))}
            placeholder="Incendio forestal, sismo, derrame de sustancias peligrosas…"
          />
        </Field>

        <Field
          label="Roles"
          htmlFor="emerplan-roles"
          helper="Texto libre o JSON (ej: coordinador, brigadista, vocero)."
          error={fieldErrors.roles?.[0]}
        >
          <Textarea
            id="emerplan-roles"
            value={form.roles}
            onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
            placeholder="Coordinador de emergencia: Juan Pérez. Brigada de evacuación: …"
          />
        </Field>

        <Field
          label="Rutas de evacuación"
          htmlFor="emerplan-routes"
          helper="Texto libre o JSON (ej: punto de encuentro, rutas por sector)."
          error={fieldErrors.routes?.[0]}
        >
          <Textarea
            id="emerplan-routes"
            value={form.routes}
            onChange={(e) => setForm((f) => ({ ...f, routes: e.target.value }))}
            placeholder="Punto de encuentro: estacionamiento norte. Ruta sector A: …"
          />
        </Field>

        <div className="flex justify-end gap-2">
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creando…" : "Crear plan"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
