"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import { savePreventionIncidentRe20PolicyAction } from "../actions"
import { RE20_POLICY_FIELDS, type Re20PolicyKey } from "./catalog-labels"

type PolicyValues = Record<Re20PolicyKey, number>

export function PolicyPanel({ policy, version }: { policy: PolicyValues; version: number }) {
  const router = useRouter()
  const { pending, run, message, fieldErrors } = useOperation({ feedback: "toast" })
  const [draft, setDraft] = React.useState<Record<Re20PolicyKey, string>>(
    () => Object.fromEntries(RE20_POLICY_FIELDS.map((field) => [field.key, String(policy[field.key])])) as Record<Re20PolicyKey, string>,
  )
  const invalid = (field: typeof RE20_POLICY_FIELDS[number]) => {
    const value = Number(draft[field.key])
    return !Number.isInteger(value) || value < 1 || value > field.max
  }
  const hasInvalid = RE20_POLICY_FIELDS.some(invalid)
  const dirty = RE20_POLICY_FIELDS.some((field) => Number(draft[field.key]) !== policy[field.key])

  function save() {
    const values = Object.fromEntries(RE20_POLICY_FIELDS.map((field) => [field.key, Number(draft[field.key])]))
    run(() => savePreventionIncidentRe20PolicyAction(values), () => router.refresh())
  }

  return (
    <section aria-labelledby="re20-plazos" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="re20-plazos" className="text-base font-semibold text-[var(--color-text)]">Plazos operacionales internos</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Orientan las tareas de cada investigación. Un cambio rige para los expedientes nuevos: los que ya están abiertos conservan los plazos con que se crearon.
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Versión vigente {version}</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {RE20_POLICY_FIELDS.map((field) => {
          const id = `plazo-${field.key}`
          const bad = invalid(field)
          return (
            <Field
              key={field.key}
              htmlFor={id}
              label={`${field.label} (${field.sheet})`}
              helper={field.help}
              error={bad ? `Indica un número entero de 1 a ${field.max}.` : fieldErrors[field.key]?.[0]}
            >
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={field.max}
                  step={1}
                  className="w-28"
                  value={draft[field.key]}
                  disabled={pending}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                />
                <span className="text-sm text-[var(--color-text-muted)]">{field.unit}</span>
              </div>
            </Field>
          )
        })}
      </div>

      <Callout tone="info" title="La DIAT es un plazo legal" className="mt-4">
        El plazo para denunciar un accidente (DIAT) lo fija la ley y corre desde que se conoce el hecho: no se configura aquí ni lo alteran estos valores.
      </Callout>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" variant="primary" disabled={pending || hasInvalid || !dirty} onClick={save}>
          {pending ? "Guardando…" : "Guardar plazos"}
        </Button>
        {message && <span role="status" className="text-sm text-[var(--color-text-muted)]">{message}</span>}
      </div>
    </section>
  )
}
