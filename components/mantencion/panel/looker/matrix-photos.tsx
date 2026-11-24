"use client"

import * as React from "react"
import { PhotoLightbox, type LightboxPhoto } from "@/components/mantencion/jefatura/registros/photo-lightbox"
import type { MatrixCheck } from "@/lib/services/mantencion/looker/types"

/**
 * Fotos de una columna de la matriz. Las nativas se abren en el visor de siempre; las del
 * histórico son enlaces de Google Drive y se ofrecen como enlaces, no como imágenes inline.
 */
export function MatrixPhotos({
  photos,
  links,
  equipment,
}: {
  photos: MatrixCheck["photoIds"]
  links: MatrixCheck["photoUrls"]
  equipment: string
}) {
  const [open, setOpen] = React.useState<number | null>(null)
  const lightbox: LightboxPhoto[] = photos.map((photo) => ({
    id: photo.id,
    caption: photo.caption,
    alt: `${photo.caption} del equipo ${equipment}`,
    stampedAt: photo.stampedAt,
    receivedAt: photo.receivedAt,
  }))
  if (photos.length === 0 && links.length === 0) {
    return <span className="text-2xs text-[var(--color-text-subtle)]">Sin foto</span>
  }
  return (
    <>
      <span className="mt-1 flex flex-wrap items-center gap-1">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={(event) => { event.stopPropagation(); setOpen(index) }}
            className="overflow-hidden rounded border border-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            aria-label={`Ampliar ${photo.caption} del equipo ${equipment}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/mantencion/fotos/${photo.id}`} alt="" loading="lazy" className="h-7 w-9 object-cover" />
          </button>
        ))}
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-2xs font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </span>
      <PhotoLightbox photos={lightbox} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </>
  )
}
