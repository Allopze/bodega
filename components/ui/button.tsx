"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: pressable affordance per Emil (scale on :active) + clean transitions
  [
    "inline-flex items-center justify-center gap-2",
    "font-sans font-medium text-sm leading-[var(--leading-label)]",
    "rounded-[var(--radius)]",
    "select-none cursor-pointer",
    "transition-[transform,opacity,background-color,box-shadow]",
    "duration-[var(--duration-fast)]",
    "ease-[var(--ease-out)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
    "disabled:pointer-events-none disabled:opacity-45",
    // Emil: :active scale — physical press feedback
    "active:scale-[0.97]",
    "data-[pressable]:active:scale-[0.97]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-primary)] text-white",
          "hover:bg-[var(--color-primary-600)]",
          "shadow-[0_1px_2px_oklch(0_0_0/0.12)]",
        ],
        secondary: [
          "bg-[var(--color-surface-2)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "hover:bg-[var(--color-primary-50)] hover:border-[var(--color-primary-100)]",
        ],
        ghost: [
          "text-[var(--color-text-muted)]",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        ],
        destructive: [
          "bg-[var(--color-danger)] text-white",
          "hover:bg-[var(--color-danger-700)]",
        ],
        signal: [
          // For the "pendiente/no-incluido" never-miss call to action
          "bg-[var(--color-signal-50)] text-[var(--color-signal-700)]",
          "border border-[var(--color-signal-100)]",
          "hover:bg-[var(--color-signal-100)]",
        ],
        link: [
          "text-[var(--color-primary-700)] underline-offset-4",
          "hover:underline",
          "p-0 h-auto",
        ],
      },
      size: {
        sm:      "h-7 px-3 text-xs rounded-[var(--radius-sm)]",
        default: "h-9 px-4",
        lg:      "h-10 px-5 text-base",
        icon:    "h-9 w-9 p-0",
        "icon-sm": "h-7 w-7 p-0",
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
        data-pressable
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
