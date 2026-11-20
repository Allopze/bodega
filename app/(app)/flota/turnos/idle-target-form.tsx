"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { setIdleTargetAction } from "./actions"

/**
 * Meta de ralentí (entero de 1 a 99 %), la misma para todos los equipos. Sólo la ve quien puede registrar
 * turnos; el servidor lo vuelve a comprobar. Cambiarla recolorea la grilla y re-evalúa «En meta» / «Sobre meta»
 * de todos los turnos, porque el estado se calcula al leer.
 */
export function IdleTargetForm({ target }: { target: number }) {
  const current = Math.round(target * 100)
  const [value, setValue] = React.useState(String(current))
  const { pending, message, run } = useOperation()
  const pct = Number(value)
  const valid = value.trim() !== "" && Number.isInteger(pct) && pct >= 1 && pct <= 99

  // La meta guardada manda: si la página se vuelve a pedir con otra, el campo la sigue.
  React.useEffect(() => { setValue(String(current)) }, [current])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    run(() => setIdleTargetAction(pct), () => toast.success(`Meta de ralentí: ${pct}%.`))
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <Field label="Meta % ralentí" htmlFor="turnos-meta-ralenti" className="w-48">
        <Input
          id="turnos-meta-ralenti" type="number" inputMode="numeric" min={1} max={99} step={1}
          value={value} onChange={(event) => setValue(event.target.value)} aria-describedby="turnos-meta-ayuda"
        />
      </Field>
      <Button type="submit" variant="secondary" loading={pending} disabled={!valid || pct === current}>Guardar meta</Button>
      <p id="turnos-meta-ayuda" className="basis-full text-xs text-[var(--color-text-muted)]">Entero de 1 a 99. Es la misma para todos los equipos.</p>
      {value !== "" && !valid && <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">Escribe un entero entre 1 y 99.</p>}
      {message && <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{message}</p>}
    </form>
  )
}
