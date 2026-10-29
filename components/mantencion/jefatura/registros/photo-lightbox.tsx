"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from "@phosphor-icons/react"
import { useReturnFocus } from "@/components/ui/dialog-focus"
import { formatDateTime } from "@/lib/utils"

export interface LightboxPhoto {
  id: string
  /** «Filtros usados», «Foto del trabajo 2 de 3». */
  caption: string
  /** Texto alternativo descriptivo de la imagen. */
  alt: string
  stampedAt: string
  receivedAt: string
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const
const CONTROL = [
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-white",
  "bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
].join(" ")

/**
 * Visor de fotos a pantalla completa (§10): zoom, flechas, Esc y foco atrapado.
 * Se apoya en el diálogo modal de Radix —que atrapa el foco, cierra con Esc y
 * oculta el resto de la página a los lectores— pero con un lienzo oscuro propio:
 * el diálogo estándar de la plataforma es una tarjeta centrada y no sirve para
 * mirar una foto. El sello (fecha, hora, código y patente) está dibujado EN la
 * imagen; por eso el zoom parte en «Ajustar» y deja ver la foto entera, y el pie
 * repite los dos instantes (sello y recepción) como texto.
 */
export function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: LightboxPhoto[]
  /** `null` = cerrado. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const [zoomStep, setZoomStep] = React.useState(0)
  const returnFocus = useReturnFocus()
  const open = index !== null
  const count = photos.length
  const photo = index !== null ? photos[index] : undefined

  // Al cambiar de foto (o reabrir) el zoom vuelve a «Ajustar».
  const [lastIndex, setLastIndex] = React.useState(index)
  if (lastIndex !== index) {
    setLastIndex(index)
    setZoomStep(0)
  }

  const go = React.useCallback((delta: number) => {
    if (index === null || count === 0) return
    onIndexChange((index + delta + count) % count)
  }, [index, count, onIndexChange])

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") { event.preventDefault(); go(1) }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1) }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoomStep((step) => Math.min(step + 1, ZOOM_STEPS.length - 1)) }
    else if (event.key === "-") { event.preventDefault(); setZoomStep((step) => Math.max(step - 1, 0)) }
    else if (event.key === "0") { event.preventDefault(); setZoomStep(0) }
  }

  const zoom = ZOOM_STEPS[zoomStep] ?? 1

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        >
          {photo && (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <DialogPrimitive.Title className="truncate text-base font-semibold">
                    {photo.caption} <span className="font-normal text-white/80">· {(index ?? 0) + 1} de {count}</span>
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="sr-only">
                    Visor de fotos. Flechas izquierda y derecha cambian de foto; más y menos acercan o alejan; Escape cierra.
                  </DialogPrimitive.Description>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className={CONTROL} onClick={() => setZoomStep((step) => Math.max(step - 1, 0))} disabled={zoomStep === 0} aria-label="Alejar">
                    <MagnifyingGlassMinus size={18} aria-hidden />
                  </button>
                  <button type="button" className={CONTROL} onClick={() => setZoomStep(0)} disabled={zoomStep === 0} aria-label="Ajustar a la pantalla">
                    <span aria-hidden className="font-mono text-xs tabular-nums">{Math.round(zoom * 100)} %</span>
                  </button>
                  <button type="button" className={CONTROL} onClick={() => setZoomStep((step) => Math.min(step + 1, ZOOM_STEPS.length - 1))} disabled={zoomStep === ZOOM_STEPS.length - 1} aria-label="Acercar">
                    <MagnifyingGlassPlus size={18} aria-hidden />
                  </button>
                  <DialogPrimitive.Close className={CONTROL}>
                    <X size={18} aria-hidden />
                    Cerrar
                  </DialogPrimitive.Close>
                </div>
              </header>

              <div className="relative min-h-0 flex-1">
                {/* Con zoom la imagen crece dentro de este contenedor y se recorre con scroll. */}
                <div
                  className="flex h-full w-full overflow-auto"
                  tabIndex={zoomStep > 0 ? 0 : -1}
                  role="group"
                  aria-label="Foto ampliada"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={photo.id}
                    src={`/api/mantencion/fotos/${photo.id}`}
                    alt={photo.alt}
                    draggable={false}
                    className={zoom === 1 ? "m-auto max-h-full max-w-full object-contain" : "m-auto max-w-none shrink-0"}
                    style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }}
                  />
                </div>
                {count > 1 && (
                  <>
                    <button type="button" className={`${CONTROL} absolute left-3 top-1/2 -translate-y-1/2`} onClick={() => go(-1)} aria-label="Foto anterior">
                      <CaretLeft size={22} aria-hidden />
                    </button>
                    <button type="button" className={`${CONTROL} absolute right-3 top-1/2 -translate-y-1/2`} onClick={() => go(1)} aria-label="Foto siguiente">
                      <CaretRight size={22} aria-hidden />
                    </button>
                  </>
                )}
              </div>

              <footer className="px-4 py-3 text-sm text-white/85">
                <span className="font-mono tabular-nums">Sello {formatDateTime(photo.stampedAt)}</span>
                <span aria-hidden> · </span>
                <span className="font-mono tabular-nums">Recibida {formatDateTime(photo.receivedAt)}</span>
              </footer>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
