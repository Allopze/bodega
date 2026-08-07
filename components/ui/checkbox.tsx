import * as React from "react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Label rendered next to the checkbox. Acepta nodos para poder anotar el
   *  texto principal (código, unidad, badge) sin perder el nombre accesible,
   *  que se calcula del contenido renderizado del `<label>`. */
  label: React.ReactNode
  /** Casillas sueltas (seleccionar fila, marcar asistencia): la etiqueta sigue
   *  existiendo para lectores de pantalla, pero no ocupa espacio en la fila. */
  labelHidden?: boolean
}

/**
 * Checkbox row: renders a native checkbox + label side by side.
 * Supports both uncontrolled (name/value/defaultChecked) and
 * controlled (checked/onChange) usage.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, labelHidden, id, className, ...props },
  // La casilla de "seleccionar todo" necesita el nodo para poner
  // `indeterminate`, que no existe como atributo HTML.
  ref,
) {
  return (
    <label
      htmlFor={id}
      // `min-h-6` lleva el objetivo pulsable —la fila entera, no solo la
      // casilla— al mínimo de 24px que exige WCAG 2.5.8, sin agrandar la
      // casilla (16px) ni romper la densidad de las filas existentes.
      className={cn(
        "flex min-h-6 items-center cursor-pointer select-none",
        !labelHidden && "gap-2",
      )}
    >
      <input
        {...props}
        ref={ref}
        type="checkbox"
        id={id}
        className={cn(
          "h-4 w-4 shrink-0 accent-[var(--color-primary)]",
          className,
        )}
      />
      <span className={labelHidden ? "sr-only" : "text-sm text-[var(--color-text)]"}>{label}</span>
    </label>
  )
})
