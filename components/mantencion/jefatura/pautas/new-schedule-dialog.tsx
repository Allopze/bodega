"use client"

import * as React from "react"
import { useActionState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import type { MantUnit } from "@/lib/mantencion/types"
import type { ActionState } from "@/lib/validation/operations"
import { createScheduleAction } from "@/app/(app)/mantencion/pautas/actions"

export interface CopyableSchedule { id: string; name: string; unit: MantUnit }

/**
 * «Nueva pauta»: vacía o copia de otra de la misma unidad, con nombre e
 * intervalos. Al crearla el servidor lleva directo a su editor, donde se ajustan
 * los ítems y se asignan los equipos.
 */
export function NewScheduleDialog({ schedules }: { schedules: CopyableSchedule[] }) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState(createScheduleAction, { ok: false } as ActionState)
  const [unit, setUnit] = React.useState<MantUnit>("km")
  const [copyFromId, setCopyFromId] = React.useState("")
  const error = (field: string) => state.fieldErrors?.[field]?.[0]
  const copyable = schedules.filter((item) => item.unit === unit)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus size={14} aria-hidden />Nueva pauta</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} noValidate>
          <DialogHeader>
            <DialogTitle>Nueva pauta</DialogTitle>
            <DialogDescription>Define cómo se mide y cada cuánto se hace. Después ajustas las actividades y asignas los equipos.</DialogDescription>
          </DialogHeader>
          {!state.ok && state.message && !state.fieldErrors && <Callout tone="danger" role="alert" className="mb-3">{state.message}</Callout>}
          <div className="flex flex-col gap-4">
            <Field label="Nombre" required htmlFor="np-name" error={error("name")}>
              <Input id="np-name" name="name" autoComplete="off" maxLength={80} placeholder="Ej: Camionetas" error={!!error("name")} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Se mide en</legend>
              <div className="flex gap-5">
                {([["km", "Kilómetros"], ["h", "Horas"]] as const).map(([value, label]) => (
                  <label key={value} className="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="unit" value={value} checked={unit === value} onChange={() => { setUnit(value); setCopyFromId("") }} className="h-4 w-4 accent-[var(--color-primary)]" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Intervalos" required htmlFor="np-intervals" error={error("intervals")} helper="Separados por coma. El menor es el intervalo base.">
              <Input id="np-intervals" name="intervals" className="font-mono" autoComplete="off" placeholder={unit === "km" ? "10000, 20000, 40000" : "250, 500, 1000"} error={!!error("intervals")} />
            </Field>
            <Field label="Partir de" htmlFor="np-copy" error={error("copyFromId")} helper="Al copiar se traen los sistemas, ítems y reglas por marca; luego se ajustan.">
              <OptionSelect id="np-copy" name="copyFromId" className="h-11 w-full sm:h-9" emptyLabel="Pauta vacía" value={copyFromId} onValueChange={setCopyFromId} options={copyable.map((item) => ({ value: item.id, label: `Copia de «${item.name}»`, textValue: item.name }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Crear pauta" loadingLabel="Creando…" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
