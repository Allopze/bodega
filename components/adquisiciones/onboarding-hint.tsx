"use client"

import * as React from "react"
import { Info, X } from "@phosphor-icons/react"

interface OnboardingHintProps {
  storageKey: string
  title: string
  body: string
}

const OnboardingHintInner = React.memo(function OnboardingHintInner({ storageKey, title, body }: OnboardingHintProps) {
  const [visible, setVisible] = React.useState(() => {
    try { return localStorage.getItem(storageKey) ? false : true }
    catch { return false }
  })

  function dismiss() {
    try { localStorage.setItem(storageKey, "1") } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3">
      <Info size={15} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-info-ink)]" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[var(--color-info-ink)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-info-ink)] opacity-80">{body}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar ayuda"
        className="shrink-0 rounded p-0.5 text-[var(--color-info-ink)] opacity-50 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  )
})

export const OnboardingHint = OnboardingHintInner
