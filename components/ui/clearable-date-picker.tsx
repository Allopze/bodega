"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { DatePicker, type DatePickerProps } from "@/components/ui/date-picker"

export interface ClearableDatePickerProps extends Omit<DatePickerProps, "value" | "onChange" | "defaultValue"> {
  /** `YYYY-MM-DD`, o `""` sin fecha. Es controlado: quitar la fecha tiene que poder vaciar el campo. */
  value: string
  onChange: (iso: string) => void
  /** Texto del botón (por defecto «Quitar fecha»). */
  clearLabel?: string
  /**
   * Nombre accesible del botón cuando hay varios campos en pantalla
   * («Quitar fecha de SOAP»). Debe empezar con el texto visible.
   */
  clearAriaLabel?: string
}

/**
 * `DatePicker` que además puede quedar vacío.
 *
 * El `DatePicker` solo sabe elegir una fecha: una vez puesta no hay forma de
 * quitarla, y un vencimiento mal cargado (o un documento que dejó de regir) se
 * quedaba para siempre. El botón aparece solo cuando hay fecha y, al usarlo,
 * devuelve el foco al campo: si no, al desaparecer el botón el foco caía en
 * `<body>`.
 *
 * Con `name`, el campo viaja vacío en el formulario (`""`): el servidor lo lee
 * como «quitar el dato», distinto de un campo ausente (no tocar).
 */
export function ClearableDatePicker({
  value,
  onChange,
  clearLabel = "Quitar fecha",
  clearAriaLabel,
  disabled,
  id,
  ...datePickerProps
}: ClearableDatePickerProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="w-full">
        <DatePicker {...datePickerProps} id={id} value={value} onChange={onChange} disabled={disabled} />
      </div>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={clearAriaLabel}
          // El texto va pegado al borde del campo, no sangrado por el padding del botón.
          className="-ml-2.5"
          onClick={() => {
            onChange("")
            if (id) document.getElementById(id)?.focus()
          }}
        >
          {clearLabel}
        </Button>
      )}
    </div>
  )
}
