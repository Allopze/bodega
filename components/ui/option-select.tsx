"use client"

import * as React from "react"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

/**
 * Select de la casa sobre una lista de opciones planas — el reemplazo directo
 * de un `<select>` nativo.
 *
 * Dos cosas que el nativo daba gratis y Radix no, resueltas acá una sola vez en
 * vez de en cada formulario:
 *
 * 1. **La opción vacía.** Radix prohíbe `<SelectItem value="">` (la cadena vacía
 *    es su forma de decir "sin valor", la que pinta el placeholder). Acá la
 *    opción vacía se rinde con el centinela `__none__` —el mismo que ya usa el
 *    resto del repo— y se traduce de vuelta a `""` hacia afuera.
 * 2. **El envío del formulario.** El valor viaja en un `<input type="hidden">`
 *    propio, no en el select oculto de Radix: así lo que llega al `FormData` es
 *    `""` y no el centinela, y `formData.get(...) || null` sigue funcionando
 *    igual que con el nativo.
 *
 * Ojo: al no haber un control nativo visible, `required` del navegador ya no
 * bloquea el envío. Quien lo necesite valida en el submit (y el servidor valida
 * siempre, que es donde importa).
 */

const NONE = "__none__"

export interface OptionSelectOption {
  value: string
  label: React.ReactNode
  /** Texto para buscar/anunciar cuando `label` no es una cadena. */
  textValue?: string
  disabled?: boolean
}

export interface OptionSelectProps {
  options: OptionSelectOption[]
  /** Etiqueta de la opción vacía ("Sin asignar", "Todos"…). Sin ella no hay opción vacía. */
  emptyLabel?: React.ReactNode
  /** Controlado. La cadena vacía representa "sin selección". */
  value?: string
  /** No controlado. */
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Si se entrega, el valor se envía con el formulario bajo este nombre. */
  name?: string
  placeholder?: string
  id?: string
  disabled?: boolean
  error?: boolean
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

export function OptionSelect({
  options,
  emptyLabel,
  value,
  defaultValue,
  onValueChange,
  name,
  placeholder = "Selecciona…",
  id,
  disabled,
  error,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: OptionSelectProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  const current = value ?? uncontrolled
  const hasEmptyOption = emptyLabel !== undefined

  function handleValueChange(next: string) {
    const resolved = next === NONE ? "" : next
    if (value === undefined) setUncontrolled(resolved)
    onValueChange?.(resolved)
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <Select
        value={current === "" && hasEmptyOption ? NONE : current}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={className}
          error={error}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {hasEmptyOption && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              textValue={option.textValue}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
