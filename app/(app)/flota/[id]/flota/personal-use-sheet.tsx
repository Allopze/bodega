"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { ClearableDatePicker } from "@/components/ui/clearable-date-picker"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import type { PersonalUsePeriod } from "@/lib/fleet/personal-use"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"
import { savePersonalUsePeriodAction } from "../../actions"

interface PersonalUseSheetProps {
  open: boolean
  onClose: () => void
  vehicleId: string
  /** El período que se edita; sin él, la hoja marca uno nuevo. */
  period: PersonalUsePeriod | null
  /** Hoy en Chile (`YYYY-MM-DD`): el día por defecto del inicio y el tope de ambas fechas. */
  today: string
}

/**
 * «Marcar uso personal» / «Editar uso personal»: desde qué día el dueño se lleva el equipo y,
 * si ya lo devolvió, hasta cuál (ambos inclusivos). Una sola vista, sin pestañas: no necesita
 * `stableHeight`.
 */
export function PersonalUseSheet({ open, onClose, ...form }: PersonalUseSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        {/* El formulario vive dentro del contenido: al cerrar la hoja se desmonta y lo escrito sin guardar no reaparece. */}
        <PersonalUseForm onClose={onClose} {...form} />
      </SheetContent>
    </Sheet>
  )
}

function PersonalUseForm({ onClose, vehicleId, period, today }: Omit<PersonalUseSheetProps, "open">) {
  const [startedOn, setStartedOn] = React.useState(period?.startedOn ?? today)
  const [endedOn, setEndedOn] = React.useState(period?.endedOn ?? "")
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await savePersonalUsePeriodAction(previous, formData)
      if (result.ok) {
        toast.success(result.message ?? "Uso personal guardado")
        onClose()
      }
      return result
    },
    { ok: false },
  )

  const startError = state.fieldErrors?.startedOn?.[0]
  const endError = state.fieldErrors?.endedOn?.[0]
  const title = period ? "Editar uso personal" : "Marcar uso personal"

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="id" value={period?.id ?? ""} />
      <SheetHeader>
        <div>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            En esos días el equipo no suma costos, litros, km ni horas en las cifras de gestión. Los pagos y los registros no cambian.
          </SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody>
        {state.message && !state.ok && !state.fieldErrors && (
          <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}
        <FieldGroup className="gap-5">
          <Field label="Desde" htmlFor="personal-use-from" error={startError}>
            <DatePicker
              id="personal-use-from"
              name="startedOn"
              value={startedOn}
              onChange={setStartedOn}
              max={today}
              ariaLabel="Desde"
              error={!!startError}
            />
          </Field>
          <Field label="Hasta" htmlFor="personal-use-to" helper="Déjalo vacío si el equipo aún no vuelve" error={endError}>
            <ClearableDatePicker
              id="personal-use-to"
              name="endedOn"
              value={endedOn}
              onChange={setEndedOn}
              min={startedOn || undefined}
              max={today}
              ariaLabel="Hasta"
              error={!!endError}
            />
          </Field>
          <Field label="Nota" htmlFor="personal-use-note" hint="Opcional">
            <Input id="personal-use-note" name="note" defaultValue={period?.note ?? ""} maxLength={500} />
          </Field>
        </FieldGroup>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label="Guardar" loadingLabel="Guardando..." disabled={!startedOn} />
      </SheetFooter>
    </form>
  )
}
