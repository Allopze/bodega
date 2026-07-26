"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SwitchProps {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  /** Screen-reader label. */
  label: string
}

/**
 * Minimal toggle switch component — styled checkbox pattern.
 * Pure CSS, no external dependencies.
 */
export function Switch({ checked, onCheckedChange, disabled, id, label }: SwitchProps) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-[var(--duration-fast)] ease-out",
        checked
          ? "bg-[var(--color-primary)]"
          // WCAG 1.4.11: el track apagado es el único identificador del control.
          // --color-border-strong rendía 1.59:1; border-control rinde 3.11:1.
          : "bg-[var(--color-border-control)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={() => onCheckedChange?.(!checked)}
        id={id}
        aria-label={label}
      />
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-fast)] ease-out",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
        aria-hidden
      />
    </label>
  )
}
