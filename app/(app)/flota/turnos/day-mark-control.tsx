"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useOperation } from "@/lib/hooks/use-operation"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import { toast } from "@/lib/toast"
import { clearDayMarkAction, setDayMarkAction } from "./actions"

export const DAY_MARK_LABEL: Record<string, string> = {
  sin_operacion_programada: "Sin operación programada",
  otro: "Otro motivo",
}

const REASON_OPTIONS = [
  { value: "sin_operacion_programada", label: DAY_MARK_LABEL.sin_operacion_programada },
  { value: "otro", label: DAY_MARK_LABEL.otro },
]
const MAX_NOTES = 500

/**
 * Marca de un equipo en un día: «Sin operación programada» u «Otro motivo», con notas. No apaga el aviso de
 * «motor sin turno»: un equipo sin operación programada que igual tuvo motor es justo lo que hay que mirar
 * (sólo mantención y fuera de servicio lo apagan). Una avería o una mantención no se marcan aquí: es el estado del
 * equipo, que se cambia en su ficha (el enlace va dentro del mismo panel para no duplicar ese flujo).
 */
export function DayMarkControl({ vehicleId, vehicleCode, day, mark }: {
  vehicleId: string
  vehicleCode: string
  day: string
  mark: { reason: string; notes: string } | null
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState(mark?.reason ?? "sin_operacion_programada")
  const [notes, setNotes] = React.useState(mark?.notes ?? "")
  const save = useOperation()
  const clear = useOperation()
  const pending = save.pending || clear.pending

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      // Cada apertura parte de lo guardado, no de una edición abandonada.
      setReason(mark?.reason ?? "sin_operacion_programada")
      setNotes(mark?.notes ?? "")
      save.setMessage("")
      clear.setMessage("")
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    save.run(
      () => setDayMarkAction({ vehicleId, day, reason: reason as "sin_operacion_programada" | "otro", notes: notes.trim() }),
      () => { toast.success("Marca guardada."); setOpen(false) },
    )
  }

  function remove() {
    clear.run(
      () => clearDayMarkAction({ vehicleId, day }),
      () => { toast.success("Marca quitada."); setOpen(false) },
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="secondary" aria-label={`${mark ? "Editar marca de" : "Marcar el día de"} ${vehicleCode}`}>
          {mark ? "Editar marca" : "Marcar día"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-4">
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm font-semibold">Marca de {vehicleCode}</p>
          <Field label="Motivo" htmlFor={`mark-reason-${vehicleId}`}>
            <OptionSelect id={`mark-reason-${vehicleId}`} options={REASON_OPTIONS} value={reason} onValueChange={setReason} />
          </Field>
          <Field label="Notas" htmlFor={`mark-notes-${vehicleId}`}>
            <Input id={`mark-notes-${vehicleId}`} type="text" maxLength={MAX_NOTES} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {(save.message || clear.message) && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{save.message || clear.message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mark
              ? <Button type="button" size="sm" variant="ghost" onClick={remove} loading={clear.pending} disabled={pending}>Quitar marca</Button>
              : <span />}
            <Button type="submit" size="sm" loading={save.pending} disabled={pending}>Guardar marca</Button>
          </div>
          <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
            ¿En mantención o con una avería? Eso es el estado del equipo:{" "}
            <Link href={vehicleFichaHref(vehicleId)} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">
              Cambiar estado en la ficha
            </Link>
          </p>
        </form>
      </PopoverContent>
    </Popover>
  )
}
