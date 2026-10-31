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

  // El guardado diferido que está esperando su turno, para que `discard` pueda cancelarlo.
  const pendingSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (!scopeKey || !ready || !enabled) return
    const timer = setTimeout(() => {
      pendingSaveRef.current = null
      void saveTaeDraft(scopeKey, { draft, step })
    }, 400)
    pendingSaveRef.current = timer
    return () => {
      clearTimeout(timer)
      if (pendingSaveRef.current === timer) pendingSaveRef.current = null
    }
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
    // Con un envío rápido el guardado diferido de la carga que se acaba de mandar todavía no corrió: si se deja,
    // llega después del borrado y la devuelve como «carga a medias» al abrir el formulario otra vez (y se puede enviar dos veces).
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }
    if (scopeKey) void clearTaeDraft(scopeKey)
  }, [scopeKey])

  return { restored, discard, ready }
}
