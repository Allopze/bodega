"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { ClearableDatePicker } from "@/components/ui/clearable-date-picker"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import type { VehicleExpiryField } from "@/lib/combustibles/validation"
import { expiryState } from "@/lib/expiry"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"
import { updateVehicleExpiriesAction } from "../actions"

export interface VehicleExpiryRow {
  field: VehicleExpiryField
  label: string
  /** Lo guardado en el equipo: es lo que edita la hoja. */
  declared: string | null
  /**
   * Fecha del documento subido vigente de este tipo. Solo viene cuando el equipo no tiene la suya:
   * con una fecha guardada, esa manda y el documento no aporta (`expiringDocuments`).
   */
  documentExpiresAt: string | null
}

/** Id del campo de fecha: la fila desde la que se abrió la hoja le pasa el foco. */
export function vehicleExpiryFieldId(field: VehicleExpiryField) {
  return `vehicle-expiry-${field}`
}

interface VehicleExpiriesSheetProps {
  open: boolean
  onClose: () => void
  vehicleId: string
  /** «KA-90 · BPDH-67», o la patente sola si el equipo no tiene código. */
  vehicleLabel: string
  /** En el orden fijo de la ficha (no el de urgencia): los campos no se mueven al editarlos. */
  rows: VehicleExpiryRow[]
  /** Campo de la fila desde la que se abrió la hoja. */
  focusField: VehicleExpiryField
  today: string
  warningDays: number
}

/**
 * «Actualizar vencimientos»: las cuatro fechas del equipo en una sola hoja, con
 * lo que quedará a la vista antes de guardar. Una sola vista, sin pestañas: el
 * alto no cambia entre campos, así que no necesita `stableHeight`.
 */
export function VehicleExpiriesSheet({ open, onClose, focusField, ...form }: VehicleExpiriesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        // El foco entra al campo de la fila que se pulsó, no al botón de cerrar. `SheetContent` recuerda el
        // elemento enfocado al abrir (el botón «Actualizar» de la fila) y se lo devuelve al cerrar.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(vehicleExpiryFieldId(focusField))?.focus()
        }}
      >
        {/* El formulario vive dentro del contenido: al cerrar el sheet se desmonta y las fechas elegidas sin guardar no reaparecen. */}
        <ExpiriesForm onClose={onClose} {...form} />
      </SheetContent>
    </Sheet>
  )
}

function ExpiriesForm({
  onClose, vehicleId, vehicleLabel, rows, today, warningDays,
}: Omit<VehicleExpiriesSheetProps, "open" | "focusField">) {
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((row) => [row.field, row.declared ?? ""])),
  )
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await updateVehicleExpiriesAction(previous, formData)
      if (result.ok) {
        toast.success(result.message ?? "Vencimientos actualizados")
        onClose()
      }
      return result
    },
    { ok: false },
  )
  // Sin cambios no hay nada que guardar: el botón queda apagado en vez de aceptar un envío vacío.
  const changed = rows.some((row) => (values[row.field] ?? "") !== (row.declared ?? ""))

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <SheetHeader>
        <div>
          <SheetTitle>Actualizar vencimientos</SheetTitle>
          <SheetDescription>{vehicleLabel}</SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody>
        {state.message && !state.ok && !state.fieldErrors && (
          <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}
        <FieldGroup className="gap-5">
          {rows.map((row) => {
            const value = values[row.field] ?? ""
            const error = state.fieldErrors?.[row.field]?.[0]
            return (
              <div key={row.field}>
                <Field label={row.label} htmlFor={vehicleExpiryFieldId(row.field)} error={error}>
                  <ClearableDatePicker
                    id={vehicleExpiryFieldId(row.field)}
                    name={row.field}
                    value={value}
                    onChange={(iso) => setValues((current) => ({ ...current, [row.field]: iso }))}
                    ariaLabel={row.label}
                    clearAriaLabel={`Quitar fecha de ${row.label}`}
                    error={!!error}
                  />
                </Field>
                <ExpiryPreview value={value} documentExpiresAt={row.documentExpiresAt} today={today} warningDays={warningDays} />
              </div>
            )
          })}
        </FieldGroup>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label="Guardar" loadingLabel="Guardando..." disabled={!changed} />
      </SheetFooter>
    </form>
  )
}

/**
 * «Quedará: …»: el estado que tendrá el vencimiento con la fecha que hay en el
 * campo, para ver el efecto antes de guardar. Con el campo vacío rige la fecha
 * del documento subido, si la hay (la columna del equipo manda, el documento
 * solo la suple), y se dice.
 */
function ExpiryPreview({ value, documentExpiresAt, today, warningDays }: {
  value: string
  documentExpiresAt: string | null
  today: string
  warningDays: number
}) {
  const fromDocument = !value && !!documentExpiresAt
  const status = expiryState(value || documentExpiresAt, today, warningDays)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-muted)]" aria-live="polite">
      <span>Quedará:</span>
      <ExpiryStatus status={status} warningDays={warningDays} emptyText="sin fecha" />
      {fromDocument && <span>según documento subido</span>}
    </div>
  )
}
