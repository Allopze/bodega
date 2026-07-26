import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans font-semibold text-[13px] leading-[var(--leading-label)]",
    "rounded-[var(--radius)]",
    "select-none cursor-pointer",
    "transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    // Press feedback — buttons must feel responsive to touch.
    // motion-safe: respeta prefers-reduced-motion (WCAG 2.3.3).
    "motion-safe:active:scale-[0.97]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
    "disabled:pointer-events-none disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-primary)] text-white",
          "hover:bg-[var(--color-primary-strong)]",
        ],
        secondary: [
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border-control)]",
          "hover:bg-[var(--color-surface-2)] hover:border-[var(--color-border-control-hover)]",
          "shadow-[var(--shadow-xs)]",
        ],
        ghost: [
          "text-[var(--color-text-muted)]",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        ],
        destructive: [
          "bg-[var(--color-danger)] text-white",
          "hover:bg-[var(--color-danger-ink)]",
        ],
        signal: [
          "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]",
          "border border-[var(--color-signal-line)]",
          "hover:bg-[var(--color-signal-line)]",
        ],
        link: [
          "text-[var(--color-primary-ink)] underline-offset-4",
          "hover:underline",
          "p-0 h-auto",
        ],
      },
      // A-2: la escala responde al medio de entrada, no al tamaño visual.
      // Bajo `sm` (móvil, dedo) todo control mide 44px de alto — el mínimo de
      // Apple HIG / Material y de responsive-design/touch-targets.md. Desde
      // `sm:` en adelante (puntero) vuelve a la altura compacta de escritorio,
      // que es la que da la densidad que un backoffice necesita.
      // Antes: `sm` = 28px también en móvil, con 541 usos en la aplicación.
      size: {
        sm:        "h-11 px-3 text-xs sm:h-7",
        default:   "h-11 px-4 sm:h-8",
        lg:        "h-11 px-5 text-[13px] sm:h-9",
        icon:      "h-11 w-11 p-0 sm:h-8 sm:w-8",
        "icon-sm": "h-11 w-11 p-0 sm:h-7 sm:w-7",
        // Ya cumplían 44px en móvil antes de A-2; se mantienen como alias
        // para no tocar los 12 sitios que los usan explícitamente.
        "icon-mobile":    "h-11 w-11 sm:h-8 sm:w-8 p-0",
        "icon-mobile-sm": "h-11 w-11 sm:h-7 sm:w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <>
            <LoadingSpinner />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export { Button, buttonVariants }
