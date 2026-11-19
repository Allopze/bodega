"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { addDaysToPlainDate, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { changeVehicleContractAction } from "../../actions"

export interface ContractChoice {
  id: string
  name: string
  code: string
}

interface ChangeContractSheetProps {
  open: boolean
  onClose: () => void
  vehicleId: string
  /** «KA-90 · BPDH-67», o la patente sola si el equipo no tiene código. */
  vehicleLabel: string
  /** Contrato que rige hoy; con él la hoja sabe cuándo no hay nada que cambiar. */
  current: ContractChoice | null
  /** Contratos activos de la faena del equipo. */
  options: ContractChoice[]
  /** Hoy en Chile (`YYYY-MM-DD`): el día por defecto del cambio. */
  today: string
}

/**
 * «Cambiar contrato»: elige el contrato de la faena para el que trabajará el equipo, o «Sin
 * contrato», y desde qué día. El contrato anterior termina el día previo (las vigencias son por
 * día y no se traslapan). Una sola vista, sin pestañas: no necesita `stableHeight`.
 */
export function ChangeContractSheet({ open, onClose, ...form }: ChangeContractSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        {/* El formulario vive dentro del contenido: al cerrar la hoja se desmonta y lo elegido sin guardar no reaparece. */}
        <ChangeContractForm onClose={onClose} {...form} />
      </SheetContent>
    </Sheet>
  )
}

function ChangeContractForm({
  onClose, vehicleId, vehicleLabel, current, options, today,
}: Omit<ChangeContractSheetProps, "open">) {
  const [contractId, setContractId] = React.useState(current?.id ?? "")
  const [validFrom, setValidFrom] = React.useState(today)
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await changeVehicleContractAction(previous, formData)
      if (result.ok) {
        toast.success(result.message ?? "Contrato actualizado")
        onClose()
      }
      return result
    },
    { ok: false },
  )

  // Un contrato que ya no está activo (suspendido o cerrado) sigue rigiendo al equipo: debe verse elegido.
  const choices = current && !options.some((option) => option.id === current.id) ? [current, ...options] : options
  const unchanged = contractId === (current?.id ?? "")
  const fromError = state.fieldErrors?.validFrom?.[0]

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <SheetHeader>
        <div>
          <SheetTitle>Cambiar contrato</SheetTitle>
          <SheetDescription>{vehicleLabel}</SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody>
        {state.message && !state.ok && !state.fieldErrors && (
          <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}
        <FieldGroup className="gap-5">
          <Field label="Contrato" htmlFor="change-contract-id">
            <OptionSelect
              id="change-contract-id"
              name="contractId"
              value={contractId}
              onValueChange={setContractId}
              emptyLabel="Sin contrato"
              options={choices.map((choice) => ({ value: choice.id, label: choice.name, textValue: choice.name }))}
              aria-label="Contrato"
            />
          </Field>
          <Field
            label="Desde"
            htmlFor="change-contract-from"
            error={fromError}
            helper={validFrom ? helperFor(contractId, validFrom, current) : undefined}
          >
            <DatePicker
              id="change-contract-from"
              name="validFrom"
              value={validFrom}
              onChange={setValidFrom}
              ariaLabel="Desde"
              error={!!fromError}
            />
          </Field>
        </FieldGroup>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label="Guardar" loadingLabel="Guardando..." disabled={unchanged || !validFrom} />
      </SheetFooter>
    </form>
  )
}

/** Qué pasará con el contrato que rige hoy, dicho con el día en que termina. */
function helperFor(contractId: string, validFrom: string, current: ContractChoice | null): string {
  const previousDay = formatDate(addDaysToPlainDate(validFrom, -1))
  if (!contractId) return `El contrato actual termina el ${previousDay}.`
  return current
    ? `${current.name} termina el ${previousDay}.`
    : "El equipo trabajará para este contrato desde ese día."
}
