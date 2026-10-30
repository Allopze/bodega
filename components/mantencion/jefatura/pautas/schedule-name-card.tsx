"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { renameScheduleAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { SectionCard } from "../shared/section-card"
import { useScheduleEdit } from "./use-schedule-edit"

/** Cuánto dura el «Guardado» bajo el campo. */
const SAVED_MS = 3000

/**
 * Nombre de la pauta, editable en línea: se guarda al salir del campo o con
 * Enter, sólo si cambió. Como no hay botón «Guardar», el campo lo dice solo:
 * «Guardando…» y después «Guardado» bajo el campo (una línea discreta, sin toast).
 * Si el servidor lo rechaza (nombre repetido), el campo vuelve al nombre guardado
 * y el motivo queda en el aviso de error.
 */
export function ScheduleNameCard({ scheduleId, name, origin }: { scheduleId: string; name: string; origin: string | null }) {
  const [value, setValue] = React.useState(name)
  const [saved, setSaved] = React.useState(false)
  const { pending, edit } = useScheduleEdit()
  React.useEffect(() => setValue(name), [name])
  React.useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), SAVED_MS)
    return () => clearTimeout(timer)
  }, [saved])

  function save() {
    const next = value.trim()
    if (next === name) { setValue(name); return }
    setSaved(false)
    // Un rechazo (nombre repetido) no cambia la prop `name`: el campo vuelve al nombre guardado.
    edit(() => renameScheduleAction({ scheduleId, name: next }), () => setSaved(true), () => setValue(name))
  }

  return (
    <SectionCard title="Nombre" description={origin ?? undefined}>
      <Field label="Nombre de la pauta" htmlFor="schedule-name">
        <Input
          id="schedule-name"
          value={value}
          disabled={pending}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() } }}
        />
      </Field>
      {/* Altura reservada: el aviso aparece y se va sin mover lo que hay debajo. */}
      <p role="status" aria-live="polite" className="mt-1.5 flex min-h-4 items-center gap-1 text-xs text-[var(--color-text-muted)]">
        {pending
          ? "Guardando…"
          : saved && (
            <span className="inline-flex items-center gap-1 text-[var(--color-success-ink)]">
              <Check size={12} weight="bold" aria-hidden />
              Guardado
            </span>
          )}
      </p>
    </SectionCard>
  )
}
