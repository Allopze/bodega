import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Tarjeta seleccionable estilo radio: borde + fondo teñido cuando está
 * activa. Extrae el patrón que se repetía a mano (year picker, selector de
 * plantilla/programa a copiar) en un solo componente.
 */
export const SelectableCard = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    selected: boolean
    icon?: React.ReactNode
  }
>(({ selected, icon, className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="radio"
    aria-checked={selected}
    className={cn(
      "w-full rounded-[var(--radius)] border p-3 text-left transition-all",
      selected
        ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] ring-1 ring-[var(--color-primary)]"
        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]",
      className,
    )}
    {...props}
  >
    <div className="flex items-start gap-3">
      {icon && (
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
            selected
              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
              : "border-[var(--color-border)] text-[var(--color-text-faint)]",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </button>
))
SelectableCard.displayName = "SelectableCard"

export function SelectableCardTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("truncate text-sm font-medium text-[var(--color-text)]", className)} {...props} />
}

export function SelectableCardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-[var(--color-text-muted)]", className)} {...props} />
}
