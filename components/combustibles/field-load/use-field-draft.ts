"use client"

import * as React from "react"
import {
  clearTaeDraft,
  getTaeDraft,
  getTaeDraftPhotos,
  saveTaeDraft,
  saveTaeDraftPhotos,
  type TaeDraftPhoto,
} from "@/lib/pwa/tae-offline-queue"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import type { FieldLoadDraft, FieldLoadPhotos, FieldLoadStep } from "./types"

interface StoredDraft extends Record<string, unknown> {
  draft: FieldLoadDraft
  step: FieldLoadStep
}

/**
 * Persiste la carga en curso (campos y fotos) en el dispositivo y la restaura al
 * volver. Todo es opcional: sin `scopeKey` o sin IndexedDB no hace nada.
 */
export function useFieldDraft({
  scopeKey,
  draft,
  step,
  photos,
  enabled,
  onRestore,
}: {
  scopeKey: string | null
  draft: FieldLoadDraft
  step: FieldLoadStep
  photos: FieldLoadPhotos
  /** Se activa cuando el formulario ya se restauró o se descartó: evita pisar el borrador guardado con el vacío inicial. */
  enabled: boolean
  /** Devuelve `false` si el borrador ya no corresponde (p. ej. el equipo dejó de existir). */
  onRestore: (restored: { draft: FieldLoadDraft; step: FieldLoadStep; photos: FieldLoadPhotos }) => boolean
}) {
  const restoreRef = React.useRef(onRestore)
  React.useEffect(() => { restoreRef.current = onRestore })
  const [restored, setRestored] = React.useState(false)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!scopeKey) { setReady(true); return }
    let active = true
    void (async () => {
      const stored = await getTaeDraft<StoredDraft>(scopeKey)
      if (!active) return
      if (stored?.draft?.vehicleId) {
        const storedPhotos = await getTaeDraftPhotos(scopeKey)
        const files: FieldLoadPhotos = {}
        for (const [kind, photo] of Object.entries(storedPhotos) as Array<[TaeEvidenceKind, TaeDraftPhoto]>) {
          if (photo?.blob) files[kind] = new File([photo.blob], photo.fileName, { type: photo.blob.type })
        }
        if (!active) return
        if (restoreRef.current({ draft: stored.draft, step: stored.step ?? "vehicle", photos: files })) setRestored(true)
      }
      setReady(true)
    })()
    return () => { active = false }
  }, [scopeKey])

  React.useEffect(() => {
    if (!scopeKey || !ready || !enabled) return
    const timer = setTimeout(() => { void saveTaeDraft(scopeKey, { draft, step }) }, 400)
    return () => clearTimeout(timer)
  }, [scopeKey, ready, enabled, draft, step])

  React.useEffect(() => {
    if (!scopeKey || !ready || !enabled) return
    const stored: Partial<Record<TaeEvidenceKind, TaeDraftPhoto>> = {}
    for (const [kind, file] of Object.entries(photos) as Array<[TaeEvidenceKind, File | undefined]>) {
      if (file) stored[kind] = { blob: file, fileName: file.name }
    }
    void saveTaeDraftPhotos(scopeKey, stored)
  }, [scopeKey, ready, enabled, photos])

  const discard = React.useCallback(() => {
    setRestored(false)
    if (scopeKey) void clearTaeDraft(scopeKey)
  }, [scopeKey])

  return { restored, discard, ready }
}
