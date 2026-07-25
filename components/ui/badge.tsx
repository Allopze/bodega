import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* Estados de severidad (primary/success/warning/signal/danger) mantienen el
   tratamiento mono-uppercase; los neutros/informativos (default/info/outline)
   usan sans en caja normal para que la información rutinaria no grite. */
const severityType = "font-mono font-semibold uppercase tracking-wider"
const proseType    = "font-sans font-medium normal-case tracking-normal"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "rounded-[var(--radius-full)]",
    "px-2 py-0.5",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default:  `${proseType} text-[var(--color-text-muted)] bg-[var(--color-surface-2)]`,
        // Mismo tratamiento tipográfico que las severidades, pero cromáticamente
        // neutro. Para el valor "apagado" de una dimensión de estado (Inactivo,
        // Sin registro): antes caía en `default` (sans, caja normal) y la misma
        // columna mezclaba dos sistemas tipográficos — ACTIVO junto a Inactivo.
        neutral:  `${severityType} text-[var(--color-text-muted)] bg-[var(--color-surface-2)]`,
        primary:  `${severityType} text-[var(--color-primary-ink)] bg-[var(--color-primary-tint)]`,
        success:  `${severityType} text-[var(--color-success-ink)] bg-[var(--color-success-tint)]`,
        warning:  `${severityType} text-[var(--color-warning-ink)] bg-[var(--color-warning-tint)]`,
        signal:   `${severityType} text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)]`,
        info:     `${proseType} text-[var(--color-info-ink)] bg-[var(--color-info-tint)]`,
        danger:   `${severityType} text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)]`,
        outline:  `${proseType} text-[var(--color-text-muted)] border border-[var(--color-border)] bg-transparent`,
      },
      // Piso de 11px: por debajo el badge deja de ser legible de un vistazo, que
      // es justo su función. `sm` rendía 9px y `default` 10px.
      size: {
        sm:      "text-[11px]",
        default: "text-[11px]",
        lg:      "text-xs",
      },
    },
    // Sin uppercase la caja óptica se achica: las variantes prose suben 1px.
    compoundVariants: [
      { variant: ["default", "info", "outline"], size: "sm",      className: "text-[11px]" },
      { variant: ["default", "info", "outline"], size: "default", className: "text-xs" },
      { variant: ["default", "info", "outline"], size: "lg",      className: "text-[13px]" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, size, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current shrink-0"
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
