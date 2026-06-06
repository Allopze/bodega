import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-[var(--radius)]",
          "border border-[var(--color-border)]",
          "bg-[var(--color-surface)] px-3 py-1.5",
          "font-sans text-sm text-[var(--color-text)]",
          "placeholder:text-[var(--color-text-subtle)]",
          "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:border-[var(--color-border-strong)]",
          "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-100)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--color-surface-2)] disabled:hover:border-[var(--color-border)]",
          "read-only:bg-[var(--color-surface-2)] read-only:cursor-default read-only:hover:border-[var(--color-border)]",
          error && "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger-100)]",
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
