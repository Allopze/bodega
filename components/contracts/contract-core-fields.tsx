"use client"

import * as React from "react"
import { ClearableDatePicker } from "@/components/ui/clearable-date-picker"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"

export interface ContractCoreFieldsProps {
  clients: { id: string; name: string }[]
  defaults?: { name?: string; clientId?: string; startDate?: string | null; endDate?: string | null }
  errors?: Record<string, string[] | undefined>
  /** Reemplaza el selector de mandante (p. ej. uno con «Crear mandante» al pie). */
  clientSlot?: React.ReactNode
}

/**
 * Los campos que todo contrato lleva, vengan de la faena o de Facturación:
 * nombre, mandante (el cliente para el que se presta el servicio) y vigencia.
 * Sale como fragmento para que el formulario que lo contiene decida la grilla.
 * Nombres de input: `name`, `clientId`, `startDate`, `endDate` (viajan en el
 * `FormData`; «Hasta» vacío viaja como `""`).
 */
export function ContractCoreFields({ clients, defaults, errors, clientSlot }: ContractCoreFieldsProps) {
  const uid = React.useId()
  const [endDate, setEndDate] = React.useState(defaults?.endDate ?? "")
  const nameId = `${uid}-name`
  const clientId = `${uid}-client`
  const startId = `${uid}-start`
  const endId = `${uid}-end`

  return (
    <>
      <Field label="Nombre del contrato" htmlFor={nameId} required error={errors?.name?.[0]}>
        <Input id={nameId} name="name" required defaultValue={defaults?.name ?? ""} />
      </Field>
      <Field label="Mandante" htmlFor={clientId} required error={errors?.clientId?.[0]}>
        {clientSlot ?? (
          <OptionSelect
            id={clientId}
            name="clientId"
            defaultValue={defaults?.clientId ?? ""}
            options={clients.map((client) => ({ value: client.id, label: client.name }))}
            placeholder="Elige el mandante"
            aria-label="Mandante"
          />
        )}
      </Field>
      <Field label="Desde" htmlFor={startId} error={errors?.startDate?.[0]}>
        <DatePicker id={startId} name="startDate" defaultValue={defaults?.startDate ?? ""} ariaLabel="Inicio del contrato" />
      </Field>
      <Field label="Hasta" htmlFor={endId} error={errors?.endDate?.[0]}>
        <ClearableDatePicker
          id={endId}
          name="endDate"
          value={endDate}
          onChange={setEndDate}
          ariaLabel="Término del contrato"
          clearAriaLabel="Quitar fecha de término"
        />
      </Field>
    </>
  )
}
