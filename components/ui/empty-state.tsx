import * as React from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  /**
   * @deprecated Ya no se pinta: un estado vacío se dice con palabras, sin ícono en una caja
   * tintada (decisión 2026-11-23). La prop se acepta para no romper llamadores; quítala.
   */
  icon?:        React.ReactNode
  title:        string
  description?: string
  action?:      React.ReactNode
  secondaryAction?: React.ReactNode
  className?:   string
  compact?:     boolean   // for use inside panels/cells
  align?:       "center" | "start"
  tone?:        "neutral" | "warning" | "danger" | "success"
  /** Heading element for the title. Use "h1" when the EmptyState is the whole
   *  page (error/404) so screen-reader heading navigation still works. */
  as?:          "h1" | "h2" | "p"
}

/**
 * El tono colorea el título, con la variante `-ink` (la única que pasa AA como texto, regla 8 de
 * AGENTS.md). `neutral` y `success` no cambian el color: `--color-success-ink` casi no se distingue
 * del texto normal, así que el estado de «todo en orden» lo dice la frase, no el color.
 */
const EMPTY_STATE_TITLE_TONE: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  neutral: "text-[var(--color-text)]",
  success: "text-[var(--color-text)]",
  warning: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
}

/**
 * Teaching empty states — not just "nothing here."
 * Explains the context and provides a clear path forward.
 */
export function EmptyState({
  icon: _icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
  align = "center",
  tone = "neutral",
  as: TitleTag = "h2",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center",
        align === "center" ? "items-center text-center" : "items-start text-left",
        "animate-in fade-in slide-in-from-bottom-3 duration-[var(--duration-default)] ease-[var(--ease-out)]",
        compact ? "py-8 px-4" : "py-16 px-8",
        className,
      )}
    >
      <TitleTag className={cn(
        "font-sans font-semibold",
        EMPTY_STATE_TITLE_TONE[tone],
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
      {(action || secondaryAction) && (
        <div className={cn(
          "mt-4 flex flex-wrap gap-2",
          align === "center" ? "justify-center" : "justify-start",
        )}>
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
