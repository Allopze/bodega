"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        // Un scroll con el cursor encima de un `type="number"` cambia su valor
        // sin que el usuario lo advierta — y donde hay autoguardado, lo
        // persiste. Quitar el foco desactiva ese comportamiento del navegador;
        // si el input no estaba enfocado, `blur()` es un no-op.
        onWheel={(event) => {
          if (type === "number") event.currentTarget.blur()
          onWheel?.(event)
        }}
        className={cn(
          "flex h-11 sm:h-[34px] w-full rounded-[var(--radius-md)]",
          "border border-[var(--color-border-control)]",
          "bg-[var(--color-surface)] px-[10px] py-1.5",
          // iOS Safari hace zoom automático al enfocar un input con font-size
          // menor a 16px (rompe el layout en mobile). 16px en mobile, 12px
          // cuando el shell ya tiene más espacio y cabe el texto compacto.
          "font-sans text-base sm:text-xs text-[var(--color-text)] font-medium",
          "placeholder:text-[var(--color-text-subtle)]",
          "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:border-[var(--color-border-control-hover)]",
          "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-surface-2)] disabled:hover:border-[var(--color-border-control)]",
          "read-only:bg-[var(--color-surface-2)] read-only:cursor-default read-only:hover:border-[var(--color-border-control)]",
          error && "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger-line)]",
          className,
        )}
        aria-invalid={error}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
