import * as React from "react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Label text rendered next to the checkbox. */
  label: string
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
      className="flex items-center gap-2 cursor-pointer select-none"
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
