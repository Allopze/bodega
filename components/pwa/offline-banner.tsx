"use client"

/**
 * components/pwa/offline-banner.tsx
 *
 * Sticky banner at the top of the PPA form showing:
 *  - "Sin conexión" when offline
 *  - "X PPA pendientes de envío" when there are queued items
 *  - Syncing spinner when syncing
 */

import * as React from "react"
import { ArrowClockwise, WifiHigh, WifiSlash } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { usePpaOfflineQueue } from "@/lib/pwa/hooks"

export function OfflineBanner() {
  const { online, pendingCount, syncing, triggerSync } = usePpaOfflineQueue()
  const [dismissed, setDismissed] = React.useState(false)

  // Reset dismiss when status changes significantly
  React.useEffect(() => {
    if (!online) setDismissed(false)
  }, [online])

  if (dismissed && (online || pendingCount === 0)) return null

  // Offline state
  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "sticky top-0 z-50 flex items-center gap-2 px-4 py-2.5",
          "border-b border-[var(--color-warning-line)]",
          "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
          "text-sm font-medium",
        )}
      >
        <WifiSlash size={16} weight="fill" className="shrink-0" />
        <span className="flex-1">
          Sin conexión — tu PPA se guardará y enviará automáticamente.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs underline opacity-70 hover:opacity-100"
          aria-label="Cerrar aviso"
        >
          Cerrar
        </button>
      </div>
    )
  }

  // Online but pending items
  if (pendingCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "sticky top-0 z-50 flex items-center gap-2 px-4 py-2.5",
          "border-b border-[var(--color-info-line)]",
          "bg-[var(--color-info-tint)] text-[var(--color-info-ink)]",
          "text-sm font-medium",
        )}
      >
        {syncing ? (
          <ArrowClockwise size={16} weight="fill" className="shrink-0 animate-spin" />
        ) : (
          <WifiHigh size={16} weight="fill" className="shrink-0" />
        )}
        <span className="flex-1">
          {syncing
            ? "Sincronizando PPA pendientes..."
            : `${pendingCount} PPA${pendingCount > 1 ? "s" : ""} pendiente${pendingCount > 1 ? "s" : ""} de envío`}
        </span>
        {!syncing && (
          <button
            type="button"
            onClick={() => { triggerSync() }}
            className="shrink-0 rounded-md bg-[var(--color-info)] px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            Enviar ahora
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs underline opacity-70 hover:opacity-100"
          aria-label="Cerrar aviso"
        >
          Cerrar
        </button>
      </div>
    )
  }

  return null
}
