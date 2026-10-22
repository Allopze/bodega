"use client"

import {
  enqueueTaeSubmission,
  registerTaeBackgroundSync,
  updateTaeSubmission,
  type QueuedTaeEvidence,
} from "@/lib/pwa/tae-offline-queue"
import type { FieldLoadSubmitter } from "@/components/combustibles/field-load/types"

export class TaeSubmissionError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly field?: string) {
    super(message)
    this.name = "TaeSubmissionError"
  }
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError"
}

/**
 * Las cargas encoladas antes de este cambio traían `loadedAt` (hora del
 * dispositivo). Ahora el servidor sella la hora y solo acepta la del
 * dispositivo si el envío declara `offline: true`: se traduce el formato
 * antiguo para que una carga pendiente no pierda la hora real en que se hizo.
 */
export function normalizeQueuedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.offline !== undefined || typeof payload.loadedAt !== "string") return payload
  const { loadedAt, ...rest } = payload
  return { ...rest, offline: true, capturedAt: loadedAt }
}

export async function sendQueued(item: { id: string; accessToken: string; payload: Record<string, unknown>; evidence: QueuedTaeEvidence[]; attempts: number }) {
  await updateTaeSubmission(item.id, { status: "syncing", attempts: item.attempts + 1 })
  const form = new FormData()
  form.set("accessToken", item.accessToken)
  form.set("payload", JSON.stringify(normalizeQueuedPayload(item.payload)))
  for (const evidence of item.evidence) form.set(evidence.kind, new File([evidence.blob], evidence.fileName, { type: evidence.blob.type }))
  try {
    const response = await fetch("/api/tae/submit", { method: "POST", body: form })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string; field?: string }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      const message = body.message ?? "No se pudo sincronizar"
      await updateTaeSubmission(item.id, { status: retryable ? "pending" : "failed", lastError: message, lastErrorField: body.field })
      throw new TaeSubmissionError(message, retryable, body.field)
    }
    const body = await response.json() as { ok: boolean; message?: string; data?: { publicResultToken: string } }
    if (!body.ok || !body.data?.publicResultToken) {
      const message = body.message ?? "No se pudo sincronizar"
      await updateTaeSubmission(item.id, { status: "failed", lastError: message })
      throw new TaeSubmissionError(message, false)
    }
    await updateTaeSubmission(item.id, { status: "synced", publicResultToken: body.data.publicResultToken, syncedAt: new Date().toISOString() })
    return body.data.publicResultToken
  } catch (error) {
    if (error instanceof TaeSubmissionError) throw error
    await updateTaeSubmission(item.id, { status: "pending", lastError: error instanceof Error ? error.message : "Sin conexión" })
    throw error
  }
}

/**
 * Envío de la PWA pública. En línea va directo; sin señal, o si el servidor no
 * responde, la carga queda en la cola del dispositivo con la hora de captura
 * (`offline: true`, S-5) y se reenvía sola. Un rechazo del servidor NO se
 * encola: vuelve al formulario con el motivo para corregirlo.
 */
export function createPublicSubmitter(accessToken: string, refreshQueue: () => Promise<void>): FieldLoadSubmitter {
  async function enqueue(payload: Record<string, unknown>, evidence: QueuedTaeEvidence[]) {
    // No se puede afirmar «guardado» si el navegador no logró escribir las
    // fotos: QuotaExceededError bloquea con un mensaje explícito (decisión de Fase 0).
    try {
      await enqueueTaeSubmission(accessToken, { ...payload, offline: true, capturedAt: new Date().toISOString() }, evidence)
      void registerTaeBackgroundSync()
    } catch (error) {
      return { kind: "failed" as const, message: isQuotaExceeded(error)
        ? "No hay espacio en este teléfono para guardar las fotos. Libera espacio e inténtalo de nuevo."
        : "No se pudo guardar la carga en este teléfono. Inténtalo nuevamente." }
    }
    await refreshQueue()
    return { kind: "queued" as const }
  }

  return async (payload, evidence) => {
    if (!navigator.onLine) return enqueue(payload, evidence)
    try {
      const token = await sendQueued({ id: String(payload.clientSubmissionId), accessToken, payload, evidence, attempts: 0 })
      return { kind: "sent", href: `/tae/resultado/${token}` }
    } catch (error) {
      if (error instanceof TaeSubmissionError && !error.retryable) return { kind: "rejected", message: error.message, field: error.field }
      return enqueue(payload, evidence)
    }
  }
}
