"use client"

import * as React from "react"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { renameScheduleAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { SectionCard } from "../shared/section-card"
import { useScheduleEdit } from "./use-schedule-edit"

/**
 * Nombre de la pauta, editable en línea: se guarda al salir del campo o con
 * Enter, sólo si cambió. Si el servidor lo rechaza (nombre repetido), el campo
 * vuelve al nombre guardado y el motivo queda en el aviso.
 */
export function ScheduleNameCard({ scheduleId, name, origin }: { scheduleId: string; name: string; origin: string | null }) {
  const [value, setValue] = React.useState(name)
  const { pending, edit } = useScheduleEdit()
  React.useEffect(() => setValue(name), [name])

  function save() {
    const next = value.trim()
    if (next === name) { setValue(name); return }
    // Un rechazo (nombre repetido) no cambia la prop `name`: el campo vuelve al nombre guardado.
    edit(() => renameScheduleAction({ scheduleId, name: next }), () => toast.success("Nombre guardado."), () => setValue(name))
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
    </SectionCard>
  )
}
