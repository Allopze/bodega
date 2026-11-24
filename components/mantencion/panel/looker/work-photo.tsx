"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

/**
 * Miniatura de la foto de respaldo de una correctiva. Se abre en un visor modal; la imagen
 * sale de `/api/mantencion/fotos/{id}`, que verifica sesión y alcance en cada petición.
 * Los trabajos históricos no traen foto local: se dice «Sin foto» en vez de inventar una.
 */
export function WorkPhoto({ photoId, alt, compact = false }: { photoId: string | null; alt: string; compact?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  if (!photoId || failed) return <span className="text-2xs text-[var(--color-text-subtle)]">Sin foto</span>
  return (
    <>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(true) }}
        className="overflow-hidden rounded border border-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        aria-label={`Ampliar la foto de respaldo de ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/mantencion/fotos/${photoId}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={compact ? "h-7 w-9 object-cover" : "h-9 w-12 object-cover"}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Foto de respaldo de {alt}</DialogTitle>
          <DialogDescription className="sr-only">Vista ampliada de la foto del trabajo realizado.</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/mantencion/fotos/${photoId}`}
            alt={`Foto de respaldo de ${alt}`}
            onError={() => { setFailed(true); setOpen(false) }}
            className="max-h-[80vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
