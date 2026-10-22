"use client"

import * as React from "react"
import { BigButton } from "@/components/combustibles/field-load/big-controls"
import { formatDateTime } from "@/lib/utils"
import type { QueuedTaeSubmission } from "@/lib/pwa/tae-offline-queue"

/** Cargas que el servidor rechazó: se pueden corregir y reenviar, o descartar con confirmación. */
export function TaeOutbox({
  failed,
  onFix,
  onDiscard,
}: {
  failed: QueuedTaeSubmission[]
  onFix: (item: QueuedTaeSubmission) => void
  onDiscard: (id: string) => void
}) {
  const [confirming, setConfirming] = React.useState<string | null>(null)
  if (failed.length === 0) return null
  return (
    <section className="mb-5 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-4" aria-label="Cargas rechazadas">
      <p className="text-lg font-semibold text-[var(--color-danger-ink)]">
        {failed.length === 1 ? "Hay 1 carga que no se pudo enviar" : `Hay ${failed.length} cargas que no se pudieron enviar`}
      </p>
      <ul className="space-y-4">
        {failed.map((item) => (
          <li key={item.id} className="space-y-2 text-base text-[var(--color-danger-ink)]">
            <p><strong>{item.lastError ?? "La plataforma rechazó esta carga."}</strong></p>
            <p className="text-sm">Registrada el {formatDateTime(item.createdAt)}. Corrígela y vuelve a enviarla.</p>
            {confirming === item.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Se perderá esta carga y sus fotos.</span>
                <BigButton type="button" variant="destructive" onClick={() => { setConfirming(null); onDiscard(item.id) }}>Sí, descartar</BigButton>
                <BigButton type="button" variant="secondary" onClick={() => setConfirming(null)}>No</BigButton>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <BigButton type="button" onClick={() => onFix(item)}>Corregir y reenviar</BigButton>
                <BigButton type="button" variant="secondary" onClick={() => setConfirming(item.id)}>Descartar</BigButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
