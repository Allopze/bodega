import * as React from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?:        React.ReactNode
  title:        string
  description?: string
  action?:      React.ReactNode
  className?:   string
  compact?:     boolean   // for use inside panels/cells
  /** Heading element for the title. Use "h1" when the EmptyState is the whole
   *  page (error/404) so screen-reader heading navigation still works. */
  as?:          "h1" | "h2" | "p"
}

/**
 * Teaching empty states — not just "nothing here."
 * Explains the context and provides a clear path forward.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  as: TitleTag = "h2",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "animate-in fade-in slide-in-from-bottom-3 duration-[var(--duration-default)] ease-[var(--ease-out)]",
        compact ? "py-8 px-4" : "py-16 px-8",
        className,
      )}
    >
      {icon && (
        <div className={cn(
          "flex items-center justify-center rounded-xl",
          "bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
          compact ? "h-10 w-10 mb-3" : "h-14 w-14 mb-4",
        )}>
          {icon}
        </div>
      )}
      <TitleTag className={cn(
        "font-sans font-semibold text-[var(--color-text)]",
        compact ? "text-sm" : "text-base",
      )}>
        {title}
      </TitleTag>
      {description && (
        <p className={cn(
          "mt-1 text-[var(--color-text-subtle)] max-w-[40ch]",
          compact ? "text-xs" : "text-sm",
        )}>
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  )
}
