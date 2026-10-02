"use client"

import type { SaveStatus } from "../use-entry-autosave"

// `hourCycle: "h23"` como `formatDateTime` (lib/utils): sin él, es-CL rinde «06:49 p. m.».
const TIME = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago" })

export function SaveStatusIndicator({ status, editable }: { status: SaveStatus; editable: boolean }) {
  const text = !editable ? "Solo lectura"
    : status.state === "saving" ? "Guardando…"
    : status.state === "error" ? `No se guardó: ${status.message ?? "intenta de nuevo"}`
    : status.state === "saved" && status.savedAt ? `Guardado a las ${TIME.format(status.savedAt)}`
    : "Los cambios se guardan solos"
  const tone = status.state === "error" ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-subtle)]"
  return <p role="status" aria-live="polite" className={`text-xs ${tone}`}>{text}</p>
}
