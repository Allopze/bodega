import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans font-medium text-xs leading-[var(--leading-label)]",
    "rounded-[var(--radius-md)]",
    "select-none cursor-pointer",
    "transition-[background-color,box-shadow,border-color,color] duration-(--duration-fast) ease-out",
    "motion-safe:active:scale-[0.98]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-primary)_35%,transparent)]",
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
      size: {
        sm:        "h-11 px-2.5 text-xs sm:h-[30px]",
        default:   "h-11 px-3 text-xs sm:h-[34px] sm:px-[10px]",
        lg:        "h-11 px-4 text-xs sm:h-[38px]",
        icon:      "h-11 w-11 p-0 sm:h-[34px] sm:w-[34px]",
        "icon-sm": "h-11 w-11 p-0 sm:h-[30px] sm:w-[30px]",
        "icon-mobile":    "h-11 w-11 sm:h-[34px] sm:w-[34px] p-0",
        "icon-mobile-sm": "h-11 w-11 sm:h-[30px] sm:w-[30px] p-0",
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
