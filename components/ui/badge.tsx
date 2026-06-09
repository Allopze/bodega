import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full",
    "text-xs font-medium leading-[var(--leading-label)]",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default:     "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
        // primary and success intentionally share the same green palette; they are semantically
        // distinct (primary = confirmed/action, success = completed/approved) but visually unified.
        primary:     "bg-[var(--color-primary-50)] text-[var(--color-primary-700)] border border-[var(--color-primary-100)]",
        success:     "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-[var(--color-success-100)]",
        warning:     "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border border-[var(--color-warning-100)]",
        signal:      "bg-[var(--color-signal-50)] text-[var(--color-signal-700)] border border-[var(--color-signal-100)]",
        info:        "bg-[var(--color-info-50)] text-[var(--color-info-700)] border border-[var(--color-info-100)]",
        danger:      "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border border-[var(--color-danger-100)]",
        outline:     "border border-[var(--color-border)] text-[var(--color-text-muted)]",
      },
      size: {
        sm:      "px-1.5 py-0.5 text-[10px]",
        default: "px-2 py-1",
        lg:      "px-2.5 py-1 text-sm",
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
