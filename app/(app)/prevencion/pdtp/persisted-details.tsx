"use client"

import * as React from "react"

export function PersistedDetails({
  storageKey,
  summary,
  children,
}: {
  storageKey: string
  /**
   * Contenido del `<summary>`. Se renderiza dentro de un `<summary>` con los
   * estilos base de colapsable ya aplicados, para que el caller solo pase el
   * contenido interior (ícono, texto, etc.).
   */
  summary: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem(`pdtp-details:${storageKey}`)
      if (stored !== null) setOpen(stored === "1")
    } catch {}
  }, [storageKey])

  React.useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem(`pdtp-details:${storageKey}`, open ? "1" : "0")
    } catch {}
  }, [open, storageKey, mounted])

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
        {summary}
      </summary>
      {children}
    </details>
  )
}
