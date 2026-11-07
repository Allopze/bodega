import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* Un solo tratamiento tipográfico para todas las variantes: Myriad, peso 500,
   caja de oración, sin espaciado. La severidad la llevan el color (fondo -tint,
   texto -ink) y el punto opcional, no la tipografía.

   Decisión 2026-11-07 (auditoría UX-04): las severidades iban en mono
   MAYÚSCULAS y las neutras en sans, así que una misma columna mezclaba
   «Normal» con «● ALTA» y se leían como dos cosas distintas; además las
   mayúsculas anchas partían o cortaban las insignias largas. Para los estados
   largos conviene una insignia corta y el detalle en la fila. */
const badgeType = "font-sans font-medium normal-case tracking-normal"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "rounded-[var(--radius-full)]",
    "px-2 py-0.5",
    "whitespace-nowrap",
    badgeType,
  ],
  {
    variants: {
      variant: {
        default:  "text-[var(--color-text-muted)] bg-[var(--color-surface-2)]",
        // Cromáticamente neutro, para el valor "apagado" de una dimensión de
        // estado (Inactivo, Sin registro). Hoy es idéntico a `default`; se
        // conserva porque `neutral` es parte de la API pública (MetaBadge).
        neutral:  "text-[var(--color-text-muted)] bg-[var(--color-surface-2)]",
        primary:  "text-[var(--color-primary-ink)] bg-[var(--color-primary-tint)]",
        success:  "text-[var(--color-success-ink)] bg-[var(--color-success-tint)]",
        warning:  "text-[var(--color-warning-ink)] bg-[var(--color-warning-tint)]",
        signal:   "text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)]",
        info:     "text-[var(--color-info-ink)] bg-[var(--color-info-tint)]",
        danger:   "text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)]",
        outline:  "text-[var(--color-text-muted)] border border-[var(--color-border)] bg-transparent",
      },
      // Piso de 11px (`text-2xs`): por debajo el badge deja de ser legible de un
      // vistazo, que es justo su función.
      size: {
        sm:      "text-2xs",
        default: "text-xs",
        lg:      "text-sm",
      },
    },
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
