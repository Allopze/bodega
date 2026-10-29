"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { addScheduleItemAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { useScheduleEdit } from "./use-schedule-edit"

/**
 * «Agregar sistema» al final de la matriz: un sistema nuevo nace con su primer
 * ítem (un sistema vacío no existe en la pauta). Si el nombre coincide con uno
 * existente, el ítem se suma a ese sistema en vez de duplicarlo.
 */
export function ScheduleAddSystem({ scheduleId, systems }: { scheduleId: string; systems: string[] }) {
  const [system, setSystem] = React.useState("")
  const [item, setItem] = React.useState("")
  const { pending, edit } = useScheduleEdit()

  function submit() {
    if (!system.trim() || !item.trim()) { toast.error("Escribe el nombre del sistema y de su primer ítem."); return }
    edit(
      () => addScheduleItemAction({ scheduleId, groupName: system, name: item }),
      (outcome) => { setSystem(""); setItem(""); toast.success(outcome.message ?? "Sistema agregado.") },
    )
  }

  return (
    <form className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-4" onSubmit={(event) => { event.preventDefault(); submit() }} aria-label="Agregar un sistema nuevo">
      <Field label="Sistema nuevo" htmlFor="schedule-new-system" className="w-56">
        <Input id="schedule-new-system" list="schedule-systems" value={system} maxLength={120} autoComplete="off" placeholder="Ej: Carrocería" onChange={(event) => setSystem(event.target.value)} />
        <datalist id="schedule-systems">{systems.map((name) => <option key={name} value={name} />)}</datalist>
      </Field>
      <Field label="Primer ítem" htmlFor="schedule-new-system-item" className="w-72 max-w-full">
        <Input id="schedule-new-system-item" value={item} maxLength={120} autoComplete="off" placeholder="Nombre de la actividad" onChange={(event) => setItem(event.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" loading={pending}>Agregar sistema</Button>
    </form>
  )
}
