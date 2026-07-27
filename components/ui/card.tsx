import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Card — superficie contenedora base del design system.
 *
 * Variantes:
 * - `default` (sin prop): borde + radius-2xl, sin sombra. Para tablas, listas,
 *   paneles donde el borde basta como separador (regla screen-density A1).
 * - `feature` (C2 PLAN_MIGRACION_VISUAL): borde + radius-xl + p-6 + sombra suave.
 *   Para tarjetas editoriales del dashboard (KPIs agrupados, gráficos, bloques
 *   de lectura) que necesitan "flotar" sobre el lienzo como en la referencia.
 *
 * La variante se elige con la prop `variant`. Para retrocompatibilidad, omitir
 * la prop equivale a `default` y permite seguir pasando `className` ad-hoc.
 */
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "feature"
}

const CARD_VARIANT = {
  default: "rounded-[var(--radius-2xl)]",
  feature:
    "rounded-[var(--radius-xl)] p-6 shadow-[var(--shadow-card)]",
} as const

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-[var(--color-surface)] border border-[var(--color-border)]",
        CARD_VARIANT[variant],
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1 p-5 pb-3", className)}
      {...props}
    />
  ),
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-h3 text-[var(--color-text)]", className)}
      {...props}
    />
  ),
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sub", className)}
      {...props}
    />
  ),
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("px-5 pb-5", className)}
      {...props}
    />
  ),
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center px-5 pb-5 pt-0 border-t border-[var(--color-border)] mt-3",
        className,
      )}
      {...props}
    />
  ),
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
