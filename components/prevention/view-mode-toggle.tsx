"use client"

import * as React from "react"
import { ListBullets, SquaresFour } from "@phosphor-icons/react"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getStoredViewMode, setStoredViewMode, type DocumentViewMode } from "@/lib/prevention/view-mode"

interface Props {
  userId: string
  value: DocumentViewMode
  onChange: (next: DocumentViewMode) => void
  className?: string
}

/**
 * Two-button segmented toggle that switches between list and grid
 * representations of the document library. The choice is persisted in
 * `localStorage` per user, so different sessions on the same machine keep
 * independent preferences.
 */
export function ViewModeToggle({ userId, value, onChange, className }: Props) {
  const items: { mode: DocumentViewMode; label: string; icon: React.ReactNode }[] = [
    { mode: "list", label: "Cambiar a vista de lista", icon: <ListBullets size={16} weight="regular" /> },
    { mode: "grid", label: "Cambiar a vista de cuadrícula", icon: <SquaresFour size={16} weight="regular" /> },
  ]

  const handleSelect = React.useCallback(
    (mode: DocumentViewMode) => {
      if (mode === value) return
      setStoredViewMode(userId, mode)
      onChange(mode)
    },
    [onChange, userId, value],
  )

  return (
    <div
      role="group"
      aria-label="Cambiar modo de vista"
      className={cn(
        "inline-flex h-8 items-center rounded-[var(--radius)] border border-(--color-border) bg-(--color-surface) p-0.5 shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.mode === value
        return (
          <Tooltip key={item.mode} content={item.label}>
            <button
              type="button"
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => handleSelect(item.mode)}
              className={cn(
                "inline-flex h-7 w-8 items-center justify-center rounded-[calc(var(--radius)-2px)] text-(--color-text-muted) transition-colors",
                "hover:text-(--color-text)",
                active && "bg-(--color-primary-tint) text-(--color-primary-ink)",
              )}
            >
              {item.icon}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

/**
 * Hydrate the persisted view mode for a given user. Returns the initial mode
 * (always "list" on the server) and a setter that mirrors the value back
 * to `localStorage`. Consumers should call this once at the top of the
 * client view to keep SSR and the first client render in sync.
 */
export function usePersistedViewMode(userId: string): [DocumentViewMode, (next: DocumentViewMode) => void] {
  const [mode, setMode] = React.useState<DocumentViewMode>("list")

  React.useEffect(() => {
    setMode(getStoredViewMode(userId))
  }, [userId])

  const update = React.useCallback(
    (next: DocumentViewMode) => {
      setMode(next)
      setStoredViewMode(userId, next)
    },
    [userId],
  )

  // The first client paint mirrors SSR ("list"); the effect swaps in the
  // persisted mode right after. The brief flash is acceptable for now —
  // the toggle is the explicit way to change view.
  return [mode, update]
}
