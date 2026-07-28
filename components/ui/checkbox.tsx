import * as React from "react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Label rendered next to the checkbox. Acepta nodos para poder anotar el
   *  texto principal (código, unidad, badge) sin perder el nombre accesible,
   *  que se calcula del contenido renderizado del `<label>`. */
  label: React.ReactNode
}

/**
 * Checkbox row: renders a native checkbox + label side by side.
 * Supports both uncontrolled (name/value/defaultChecked) and
 * controlled (checked/onChange) usage.
 */
export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      // `min-h-6` lleva el objetivo pulsable —la fila entera, no solo la
      // casilla— al mínimo de 24px que exige WCAG 2.5.8, sin agrandar la
      // casilla (16px) ni romper la densidad de las filas existentes.
      className="flex min-h-6 items-center gap-2 cursor-pointer select-none"
    >
      <input
        {...props}
        type="checkbox"
        id={id}
        className={cn(
          "h-4 w-4 shrink-0 accent-[var(--color-primary)]",
          className,
        )}
      />
      <span className="text-sm text-[var(--color-text)]">{label}</span>
    </label>
  )
}
