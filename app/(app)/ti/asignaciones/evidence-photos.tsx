"use client"

/**
 * TIUX-34 / TIUX-28 — carga de fotos de evidencia compartida por la entrega,
 * la devolución y la transferencia. Antes vivía copiada en `assignment-sheet`
 * y `return-sheet` (y la transferencia ni la tenía: mandaba `photoIdsJson="[]"`).
 *
 * Las fotos se suben de inmediato a `/api/ti/photos` como *pendientes*: solo se
 * vuelven evidencia cuando el servicio las ancla dentro de la transacción del
 * acta. Por eso cancelar o cerrar la hoja las descarta (DELETE), y por eso este
 * módulo separa dos salidas: `discardAll` (el usuario se arrepintió) y
 * `releaseAfterSubmit` (el acta ya las ancló; no hay nada que borrar).
 */

import * as React from "react"
import Image from "next/image"
import { Camera, X } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"

export interface PendingPhoto {
  id: string
  previewUrl: string
  caption: string
}

interface UseEvidencePhotosOptions {
  stage: "delivery" | "return"
  /** Obligatoria en `stage: "return"`: la foto queda pendiente de esa asignación. */
  assignmentId?: string
}

export function useEvidencePhotos({ stage, assignmentId }: UseEvidencePhotosOptions) {
  const [photos, setPhotos] = React.useState<PendingPhoto[]>([])
  const [uploading, setUploading] = React.useState(false)
  // Espejo de `photos` para los callbacks que corren fuera del render (cierre
  // de la hoja, desmontaje) y no pueden leer el estado más reciente.
  const photosRef = React.useRef<PendingPhoto[]>([])
  React.useEffect(() => { photosRef.current = photos }, [photos])
  React.useEffect(() => () => {
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
  }, [])

  const discard = React.useCallback(async (ids: string[]) => {
    await Promise.all(ids.map(async (id) => {
      await fetch(`/api/ti/photos/${id}`, { method: "DELETE" }).catch(() => undefined)
    }))
  }, [])

  /** El usuario cierra sin confirmar: se borran las cargas pendientes. */
  const discardAll = React.useCallback(() => {
    const current = photosRef.current
    photosRef.current = []
    current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
    setPhotos([])
    if (current.length > 0) void discard(current.map((photo) => photo.id))
  }, [discard])

  /** El acta se guardó y ancló las fotos: solo se libera la memoria local. */
  const releaseAfterSubmit = React.useCallback(() => {
    const current = photosRef.current
    photosRef.current = []
    current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
    setPhotos([])
  }, [])

  const remove = React.useCallback((photo: PendingPhoto) => {
    URL.revokeObjectURL(photo.previewUrl)
    photosRef.current = photosRef.current.filter((item) => item.id !== photo.id)
    setPhotos((current) => current.filter((item) => item.id !== photo.id))
    void discard([photo.id])
  }, [discard])

  const upload = React.useCallback(async (files: File[]) => {
    setUploading(true)
    try {
      for (const file of files) {
        try {
          const form = new FormData()
          form.append("file", file)
          form.append("stage", stage)
          if (assignmentId) form.append("assignmentId", assignmentId)
          form.append("caption", "")
          const response = await fetch("/api/ti/photos", { method: "POST", body: form })
          let payload: { id?: unknown; error?: string } = {}
          try {
            payload = await response.json() as { id?: unknown; error?: string }
          } catch {
            // Un proxy o el runtime pueden responder vacío o sin JSON.
          }
          if (!response.ok) {
            toast.error(payload.error ?? "No se pudo subir la fotografía")
            continue
          }
          if (typeof payload.id !== "string" || !payload.id) {
            toast.error("La fotografía se subió sin un identificador válido")
            continue
          }
          const photo = { id: payload.id, previewUrl: URL.createObjectURL(file), caption: "" }
          photosRef.current = [...photosRef.current, photo]
          setPhotos((current) => [...current, photo])
        } catch {
          toast.error("No se pudo subir la fotografía")
        }
      }
    } finally {
      setUploading(false)
    }
  }, [stage, assignmentId])

  return { photos, uploading, upload, remove, discardAll, releaseAfterSubmit }
}

export type EvidencePhotosController = ReturnType<typeof useEvidencePhotos>

/**
 * Botón de carga + grilla de miniaturas + el `photoIdsJson` que lee la acción.
 * El `<input type="file">` va fuera del orden de tabulación y del árbol de
 * accesibilidad: el botón visible es quien lo dispara. Como `sr-only` seguía
 * siendo una parada de Tab sin nombre (y empujaba el diálogo 52 px al recibir
 * foco), se oculta con `hidden`; `click()` programático funciona igual.
 */
export function EvidencePhotos({ controller, alt }: { controller: EvidencePhotosController; alt: string }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { photos, uploading, upload, remove } = controller

  return (
    <div className="space-y-2">
      <input type="hidden" name="photoIdsJson" value={JSON.stringify(photos.map((photo) => photo.id))} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          await upload(files)
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <Camera size={14} className="mr-1.5" />
        {uploading ? "Subiendo..." : "Subir fotografías"}
      </Button>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-[var(--color-border)]">
              <Image src={photo.previewUrl} alt={alt} width={200} height={150} unoptimized className="aspect-[4/3] w-full object-cover" />
              {/*
                Visible con teclado (`focus-visible`) y sin hover en táctil: en
                móvil no hay hover, así que antes la acción no existía. El
                objetivo mide 44 px en móvil; el disco visible es más chico para
                no tapar la foto.
              */}
              <button
                type="button"
                onClick={() => remove(photo)}
                aria-label="Quitar fotografía"
                className="absolute right-0 top-0 flex size-11 items-center justify-center opacity-100 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 sm:size-8 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-black/70 text-white">
                  <X size={12} />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
