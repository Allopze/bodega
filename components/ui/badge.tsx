import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "font-mono font-semibold uppercase tracking-wider",
    "rounded-[var(--radius-full)]",
    "px-2 py-0.5",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default:  "text-[var(--color-text-muted)] bg-[var(--color-surface-2)]",
        primary:  "text-[var(--color-primary-ink)] bg-[var(--color-primary-tint)]",
        success:  "text-[var(--color-success-ink)] bg-[var(--color-success-tint)]",
        warning:  "text-[var(--color-warning-ink)] bg-[var(--color-warning-tint)]",
        signal:   "text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)]",
        info:     "text-[var(--color-info-ink)] bg-[var(--color-info-tint)]",
        danger:   "text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)]",
        outline:  "text-[var(--color-text-muted)] border border-[var(--color-border)] bg-transparent",
      },
      size: {
        sm:      "text-[9px]",
        default: "text-[10px]",
        lg:      "text-[11px]",
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
