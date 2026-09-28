"use client"

import type { FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { savePreventionIncidentPersonSensitiveAction } from "../actions"

/** Los campos de la ficha reservada, en el orden del reporte. */
const FIELDS = [
  { name: "fullName", label: "Nombre completo", multiline: false },
  { name: "nationalIdentifier", label: "RUN o documento", multiline: false },
  { name: "affectedBodyPart", label: "Parte del cuerpo afectada", multiline: false },
  { name: "injuryDescription", label: "Descripción de la lesión", multiline: true },
  { name: "clinicalNotes", label: "Notas clínicas", multiline: true },
] as const

/**
 * Ficha reservada de una persona, dentro de la vista reservada. El reporte
 * promete que estos datos se completan aquí; el propósito es el mismo con que se
 * abrió la vista, y queda en la auditoría de acceso sensible junto al guardado.
 */
export function SensitivePersonForm({ incidentId, personId, personLabel, purpose, payload }: {
  incidentId: string
  personId: string
  personLabel: string
  purpose: string
  payload: Record<string, unknown> | null
}) {
  const { pending, run, fieldError } = useOperation({ feedback: "toast" })
  const prefix = `sensitive-${personId}`

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const sensitive = Object.fromEntries(FIELDS.map(({ name }) => {
      const value = String(formData.get(name) ?? "").trim()
      return [name, value || undefined]
    }))
    run(() => savePreventionIncidentPersonSensitiveAction({ incidentId, personId, purpose, sensitive }))
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2" aria-label={`Ficha reservada de ${personLabel}`}>
      <p className="text-xs font-semibold">{personLabel}</p>
      {FIELDS.map(({ name, label, multiline }) => {
        const id = `${prefix}-${name}`
        const current = typeof payload?.[name] === "string" ? String(payload[name]) : ""
        return (
          <Field key={name} label={label} htmlFor={id} error={fieldError(`sensitive.${name}`)}>
            {multiline
              ? <Textarea id={id} name={name} defaultValue={current} rows={2} maxLength={3000} />
              : <Input id={id} name={name} defaultValue={current} maxLength={300} />}
          </Field>
        )
      })}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {payload ? "Actualizar ficha reservada" : "Guardar ficha reservada"}
      </Button>
    </form>
  )
}
