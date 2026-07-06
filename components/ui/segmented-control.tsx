import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface SegmentedControlItem {
  /** Unique key for React list rendering */
  key: string
  /** Display label */
  label: string
  /** Navigation URL (renders as Link) */
  href: string
  /** Whether this item is currently active */
  active: boolean
}

interface SegmentedControlProps {
  /** Items to render */
  items: SegmentedControlItem[]
  /** Layout variant: pills = wrap with gap, segmented = inline with shared border */
  variant?: "pills" | "segmented"
  /** Accessible label for the group */
  ariaLabel: string
  /** Optional eyebrow label above the control */
  eyebrow?: string
  className?: string
}

/**
 * Reusable segmented control for URL-synced navigation pickers.
 * Renders `<Link>` elements with consistent active/inactive styling
 * using design tokens instead of inline ad-hoc styles.
 */
export function SegmentedControl({
  items,
  variant = "pills",
  ariaLabel,
  eyebrow,
  className,
}: SegmentedControlProps) {
  return (
    <div className={cn("space-y-1", className)}>
      {eyebrow && (
        <p className="text-eyebrow pl-0.5 text-[var(--color-text-faint)]">{eyebrow}</p>
      )}
      <nav aria-label={ariaLabel} role="group">
        {variant === "segmented" ? (
          <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
            {items.map((item, i) => (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "px-4 py-1.5 text-sm transition-colors",
                  i === 0 && "rounded-l-md",
                  i > 0 && "border-l border-[var(--color-border)]",
                  i === items.length - 1 && "rounded-r-md",
                  item.active
                    ? "bg-[var(--color-primary-tint)] text-[var(--color-text)] font-medium"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  item.active
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
    </div>
  )
}
