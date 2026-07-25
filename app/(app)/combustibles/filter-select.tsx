"use client"

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * Radix Select prohíbe `value=""` en un `SelectItem`: la cadena vacía está
 * reservada para limpiar la selección y mostrar el placeholder. Usarla lanza en
 * cliente y tumba la página entera — era el motivo por el que
 * `/combustibles/bitacora` renderizaba su error boundary con status 200.
 * Mismo centinela que `components/adquisiciones/list-filters.tsx`.
 */
const ALL = "_all"

interface FilterOption {
  value: string
  label: string
}

export function FilterSelect({
  name,
  defaultValue = "",
  options,
  placeholder = "Todas",
  ariaLabel,
  className,
}: {
  name: string
  defaultValue?: string
  options: FilterOption[]
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const [value, setValue] = useState(defaultValue || ALL)
  return (
    <>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label={ariaLabel} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* El formulario sigue recibiendo "" para "sin filtro": el centinela es
          sólo para Radix, no parte del contrato con el servidor. */}
      <input type="hidden" name={name} value={value === ALL ? "" : value} />
    </>
  )
}
