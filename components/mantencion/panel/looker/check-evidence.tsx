"use client"

import * as React from "react"
import { Warning } from "@phosphor-icons/react"
import { PhotoLightbox, type LightboxPhoto } from "@/components/mantencion/jefatura/registros/photo-lightbox"
import type { CheckDetail, CheckPhoto } from "@/lib/services/mantencion/looker/equipment-check-summary"

const MISSING = "Falta la foto: la pauta no debió cerrarse"

interface Slot {
  key: "filters" | "sticker"
  label: string
  photo: CheckPhoto
}

/**
 * Evidencia de una pauta: la foto de los filtros y la del sticker. Las de la plataforma se abren en el visor de
 * siempre; las del histórico son enlaces de Drive (se abren aparte, no se descargan). Una que falta se dice con
 * palabras y en rojo: una pauta cerrada sin evidencia es un hallazgo, no un hueco.
 */
export function CheckEvidence({ detail, equipment }: { detail: CheckDetail; equipment: string }) {
  const [open, setOpen] = React.useState<number | null>(null)
  const slots: Slot[] = [
    { key: "filters", label: "Foto de los filtros", photo: detail.filtersPhoto },
    { key: "sticker", label: "Foto del sticker", photo: detail.stickerPhoto },
  ]
  const lightbox: LightboxPhoto[] = []
  const lightboxIndex = new Map<Slot["key"], number>()
  for (const slot of slots) {
    if (slot.photo.status !== "native") continue
    lightboxIndex.set(slot.key, lightbox.length)
    lightbox.push({
      id: slot.photo.id,
      caption: slot.label,
      alt: `${slot.label} de la pauta de ${equipment}`,
      stampedAt: slot.photo.stampedAt,
      receivedAt: slot.photo.receivedAt,
    })
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {slots.map((slot) => (
          <li key={slot.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
            <p className="text-xs font-semibold text-[var(--color-text)]">{slot.label}</p>
            <div className="mt-2">
              {slot.photo.status === "native" ? (
                <button
                  type="button"
                  onClick={() => setOpen(lightboxIndex.get(slot.key) ?? null)}
                  aria-label={`Ampliar: ${slot.label.toLowerCase()} de la pauta de ${equipment}`}
                  className="overflow-hidden rounded border border-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/mantencion/fotos/${slot.photo.id}`} alt="" loading="lazy" className="h-20 w-28 object-cover" />
                </button>
              ) : slot.photo.status === "link" ? (
                <a
                  href={slot.photo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-8 items-center text-xs font-medium text-[var(--color-primary-ink)] underline underline-offset-2"
                >
                  Abrir la foto (Google Drive)
                </a>
              ) : slot.photo.status === "invalid_link" ? (
                <p className="text-xs text-[var(--color-warning-ink)]">El formulario trae un texto que no es un enlace a Drive; no se puede abrir.</p>
              ) : (
                <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--color-danger-ink)]">
                  <Warning size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
                  {MISSING}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <PhotoLightbox photos={lightbox} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </>
  )
}
