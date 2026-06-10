import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "font-mono text-[10px] font-semibold uppercase tracking-wider",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default:  "text-[var(--color-text-muted)]",
        primary:  "text-[var(--color-primary-ink)]",
        success:  "text-[var(--color-success-ink)]",
        warning:  "text-[var(--color-warning-ink)]",
        signal:   "text-[var(--color-signal-ink)]",
        info:     "text-[var(--color-info-ink)]",
        danger:   "text-[var(--color-danger-ink)]",
        outline:  "text-[var(--color-text-muted)] border border-[var(--color-border)] px-1.5 py-0.5",
      },
      size: {
        sm:      "text-[9.5px]",
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
