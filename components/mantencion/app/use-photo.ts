"use client"

import { useCallback, useEffect, useState } from "react"
import { StorageFullError } from "@/lib/mantencion/client/db"
import { capturePhoto, PhotoError } from "@/lib/mantencion/client/photo-capture"
import { getPhoto, putPhoto } from "@/lib/mantencion/client/photo-store"
import type { MantPhotoKind } from "@/lib/mantencion/types"

/** URL de vista previa de una foto guardada (Blob de IndexedDB). Se libera al cambiar o desmontar. */
export function usePhotoUrl(photoId: string | null): string | null {
  const [state, setState] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    if (!photoId) return
    let cancelled = false
    let created: string | null = null
    void getPhoto(photoId).then((photo) => {
      if (cancelled || !photo) return
      created = URL.createObjectURL(photo.blob)
      setState({ id: photoId, url: created })
    }).catch(() => {})
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created) }
  }, [photoId])
  return photoId && state?.id === photoId ? state.url : null
}

export interface PhotoCaptureContext {
  authorUserId: string
  deviceId: string
  kind: MantPhotoKind
  equipment: { code: string; plate: string }
}

/**
 * Saca la foto de un archivo de la cámara: lee el EXIF, comprime, sella, calcula
 * la huella y la guarda como Blob. Devuelve su id, o `null` si algo falló (con el
 * motivo en `error`). Si no hay espacio, la foto NO se guarda y se dice.
 */
export function usePhotoCapture(context: PhotoCaptureContext) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { authorUserId, deviceId, kind, equipment } = context

  const capture = useCallback(async (file: File): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const captured = await capturePhoto(file, equipment)
      const id = crypto.randomUUID()
      await putPhoto({
        id, authorUserId, kind, deviceId, blob: captured.blob, sha256: captured.sha256, width: captured.width, height: captured.height,
        stampedAt: captured.stampedAt, takenAtExif: captured.takenAtExif, exif: captured.exif, uploaded: false, createdAt: new Date().toISOString(),
      })
      return id
    } catch (cause) {
      setError(cause instanceof StorageFullError || cause instanceof PhotoError ? cause.message : "No pudimos guardar la foto. Intenta de nuevo.")
      return null
    } finally {
      setBusy(false)
    }
  }, [authorUserId, deviceId, kind, equipment])

  return { capture, busy, error, clearError: () => setError(null) }
}
