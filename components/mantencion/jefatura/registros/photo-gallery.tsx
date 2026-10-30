"use client"

import * as React from "react"
import { MagnifyingGlassPlus } from "@phosphor-icons/react"
import { formatDateTime } from "@/lib/utils"
import { PhotoLightbox, type LightboxPhoto } from "./photo-lightbox"

/**
 * Miniaturas de las fotos de respaldo. Cada una abre el visor a pantalla
 * completa. Las imágenes salen de `/api/mantencion/fotos/{id}`, que verifica
 * sesión y alcance en cada petición: nunca hay una URL pública.
 */
export function PhotoGallery({ photos }: { photos: LightboxPhoto[] }) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null)

  if (photos.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Este registro no trae fotos de respaldo.</p>
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-3">
        {photos.map((photo, index) => (
          // `id` + `:target`: las alertas del registro enlazan a la foto que las explica (`#foto-…`).
          <li
            key={photo.id}
            id={`foto-${photo.id}`}
            tabIndex={-1}
            className="scroll-mt-4 rounded-lg outline-offset-4 target:outline-2 target:outline-[var(--color-signal)]"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group relative block w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/mantencion/fotos/${photo.id}`} alt={photo.alt} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 px-2 py-1 text-xs font-medium text-white">
                Ampliar
                <MagnifyingGlassPlus size={14} aria-hidden />
              </span>
            </button>
            <p className="mt-1 text-xs font-semibold text-[var(--color-text)]">{photo.caption}</p>
            <p className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(photo.stampedAt)}</p>
          </li>
        ))}
      </ul>
      <PhotoLightbox photos={photos} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
    </>
  )
}
