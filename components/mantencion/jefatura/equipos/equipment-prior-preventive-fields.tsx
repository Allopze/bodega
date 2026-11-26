"use client"

import * as React from "react"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { formatReading } from "@/lib/mantencion/format"
import { PRIOR_PREVENTIVE_LABEL } from "@/lib/mantencion/preventive-origin"
import type { MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"

const SELECT = "h-11 w-full sm:h-9"

/** Valores del formulario, como texto: lo que se escribe es lo que viaja. */
export interface PriorPreventiveValues {
  date: string
  reading: string
  interval: string
  evidence: string
}

export const EMPTY_PRIOR_PREVENTIVE: PriorPreventiveValues = { date: "", reading: "", interval: "", evidence: "" }

/**
 * «Preventiva anterior a la plataforma (declarada)» de «Editar plan de mantención»: la última preventiva
 * que se hizo antes de que el equipo estuviera en la plataforma, con su respaldo. Es una
 * declaración de jefatura, NO un registro firmado: por eso lleva siempre su rótulo y el respaldo
 * (número de orden de trabajo o factura) es obligatorio. El servidor valida todo
 * (`resolvePriorPreventive`); aquí sólo se pintan los errores que vuelven con las mismas llaves.
 * Con todo vacío se borra la declarada; sin pauta no se puede elegir el servicio.
 */
export function EquipmentPriorPreventiveFields({
  unit,
  intervals,
  hasSchedule,
  initial,
  error,
}: {
  unit: MantUnit
  /** Intervalos de la pauta elegida (la del formulario); vacío si no tiene pauta. */
  intervals: readonly number[]
  hasSchedule: boolean
  initial: PriorPreventiveValues
  error: (field: string) => string | undefined
}) {
  const [values, setValues] = React.useState(initial)
  const patch = (next: Partial<PriorPreventiveValues>) => setValues((current) => ({ ...current, ...next }))
  const today = todayInChile()
  // Si el servicio guardado ya no está en la pauta elegida se ofrece igual, para que no desaparezca en silencio.
  const options = [...new Set([...intervals, ...(values.interval && !intervals.includes(Number(values.interval)) ? [Number(values.interval)] : [])])]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: formatReading(value, unit) }))

  return (
    <fieldset className="mt-6 border-t border-[var(--color-border)] pt-5">
      <legend className="mb-1 pr-2 text-sm font-semibold">Preventiva anterior a la plataforma (declarada)</legend>
      <input type="hidden" name="priorPreventiveForm" value="1" />
      <p className="mb-4 text-sub">
        Es una declaración, no un registro firmado: se muestra siempre como «{PRIOR_PREVENTIVE_LABEL}», con su respaldo. Déjala vacía si no hay ninguna que declarar; si la completas, van los cuatro datos.
      </p>
      {!hasSchedule && (
        <Callout tone="warning" className="mb-4">
          Este equipo no tiene pauta: asígnale una arriba para poder elegir el servicio de la preventiva.
        </Callout>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Fecha de la preventiva" htmlFor="eq-prior-date" error={error("priorPreventiveDate")}>
          <DatePicker id="eq-prior-date" name="priorPreventiveDate" max={today} value={values.date} onChange={(iso) => patch({ date: iso })} error={!!error("priorPreventiveDate")} />
        </Field>
        <Field label={`Lectura de la preventiva (${unit})`} htmlFor="eq-prior-reading" error={error("priorPreventiveReading")} helper="No puede ser mayor que la lectura inicial ni que la del primer registro del equipo.">
          <Input id="eq-prior-reading" name="priorPreventiveReading" inputMode="numeric" className="font-mono" value={values.reading} onChange={(e) => patch({ reading: e.target.value })} error={!!error("priorPreventiveReading")} />
        </Field>
        <Field label="Servicio de la pauta" htmlFor="eq-prior-interval" error={error("priorPreventiveInterval")}>
          <OptionSelect
            id="eq-prior-interval" name="priorPreventiveInterval" className={SELECT} emptyLabel="Sin servicio" disabled={!hasSchedule || options.length === 0}
            value={values.interval} error={!!error("priorPreventiveInterval")} onValueChange={(v) => patch({ interval: v })} options={options}
          />
        </Field>
        <Field label="Respaldo" htmlFor="eq-prior-evidence" error={error("priorPreventiveEvidence")} helper="Número de orden de trabajo o de factura.">
          <Input id="eq-prior-evidence" name="priorPreventiveEvidence" maxLength={120} value={values.evidence} onChange={(e) => patch({ evidence: e.target.value })} error={!!error("priorPreventiveEvidence")} />
        </Field>
      </div>
    </fieldset>
  )
}
