"use client"

/**
 * TIUX-09 — estado físico del equipo SIN valor preseleccionado. Con un «Bueno»
 * ya marcado, el camino corto es firmar un acta que afirma el estado de un
 * equipo que nadie miró. El grupo es un `radiogroup` (flechas, una sola parada
 * de Tab) y el valor viaja en un `<input type="hidden">` para la acción.
 */

import { Field } from "@/components/ui/field"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"

export function PhysicalStateChoice({ name, label, states, value, onChange, error, helper }: {
  name: string
  label: string
  states: readonly string[]
  value: string | null
  onChange: (value: string) => void
  error?: string
  helper?: string
}) {
  return (
    <Field label={label} required error={error} helper={helper}>
      <div>
        <input type="hidden" name={name} value={value ?? ""} />
        <ChoiceCardGroup
          label={label}
          value={value}
          onChange={onChange}
          options={states.map((state) => ({ value: state, title: IT_PHYSICAL_STATE_META[state]?.label ?? state }))}
          className={states.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}
        />
      </div>
    </Field>
  )
}
