import type { RecordAccepted } from "./api"
import { STORE, idbGet, idbGetAll, req, runTx } from "./db"
import { emit } from "./events"
import type { QueueItem, QueueRecordItem, QueueReplyItem, QueueStatus, QueueWorkshopItem } from "./types"

/**
 * Cola de envío. Cada elemento lleva su autor y se manda con la credencial de ESE
 * autor. Estados: pending → sending → sent; un rechazo definitivo queda
 * `rejected` con su motivo (nunca se descarta); sin credencial válida queda
 * `needs_login` hasta que el autor entre de nuevo.
 */

/** Los enviados se conservan un tiempo para mostrarlos en «Mis últimos registros» y se podan después. */
export const SENT_RETENTION_MS = 48 * 60 * 60 * 1000
export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_CAP_MS = 15 * 60_000

/**
 * Espera antes del siguiente intento: `min(5 s × 2^n, 15 min)`, con `n` los
 * intentos fallidos ANTES de éste (el primer fallo espera 5 s, el segundo 10 s…).
 */
export function backoffMs(previousFailures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, previousFailures), BACKOFF_CAP_MS)
}

export async function listQueue(): Promise<QueueItem[]> {
  const items = await idbGetAll<QueueItem>(STORE.queue)
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  return (await idbGet<QueueItem>(STORE.queue, id)) ?? null
}

const base = (id: string, authorUserId: string, now: string) => ({
  id, authorUserId, status: "pending" as QueueStatus, attempts: 0, nextAttemptAt: 0,
  lastError: null, createdAt: now, updatedAt: now, sentAt: null,
})

export function newRecordItem(input: Pick<QueueRecordItem, "payload" | "summary" | "photoIds"> & { authorUserId: string }, now = new Date().toISOString()): QueueRecordItem {
  return { ...base(input.payload.id, input.authorUserId, now), type: "record", payload: input.payload, summary: input.summary, photoIds: input.photoIds, folio: null, receivedAt: null, warnings: [], rejection: null }
}

export async function enqueueSimple(item: QueueWorkshopItem | QueueReplyItem): Promise<void> {
  await runTx([STORE.queue], "readwrite", async (s) => { await req(s.queue.put(item)) })
  emit("queue")
}

export function newWorkshopItem(input: Pick<QueueWorkshopItem, "payload" | "summary"> & { authorUserId: string }, now = new Date().toISOString()): QueueWorkshopItem {
  return { ...base(input.payload.id, input.authorUserId, now), type: "workshop", payload: input.payload, summary: input.summary }
}

export function newReplyItem(input: Pick<QueueReplyItem, "payload" | "summary"> & { authorUserId: string }, id: string, now = new Date().toISOString()): QueueReplyItem {
  return { ...base(id, input.authorUserId, now), type: "reply", payload: input.payload, summary: input.summary }
}

/**
 * Firma: en UNA transacción entra el registro a la cola y sale el borrador (y el
 * rechazado que se está corrigiendo, si lo hay). Si algo falla —espacio incluido—
 * no se guarda nada y el borrador sigue intacto.
 */
export async function commitRecord(item: QueueRecordItem, options: { draftKey: string; replaceQueueId?: string | null }): Promise<void> {
  await runTx([STORE.queue, STORE.drafts], "readwrite", async (s) => {
    await req(s.queue.put(item))
    await req(s.drafts.delete(options.draftKey))
    if (options.replaceQueueId) await req(s.queue.delete(options.replaceQueueId))
  })
  emit("queue")
  emit("drafts")
}

async function updateItem(id: string, change: (item: QueueItem) => QueueItem | null, options: { photosToDelete?: (item: QueueItem) => string[] } = {}): Promise<QueueItem | null> {
  const result = await runTx([STORE.queue, STORE.photos], "readwrite", async (s) => {
    const current = (await req(s.queue.get(id))) as QueueItem | undefined
    if (!current) return null
    const next = change(current)
    if (!next) return null
    await req(s.queue.put({ ...next, updatedAt: new Date().toISOString() }))
    for (const photoId of options.photosToDelete?.(next) ?? []) await req(s.photos.delete(photoId))
    return next
  })
  emit("queue")
  return result
}

/** Toma el elemento para enviarlo (cuenta el intento). `null` si ya no está o ya lo tomó otro. */
export async function claimForSending(id: string): Promise<QueueItem | null> {
  return updateItem(id, (item) => (item.status === "pending" ? { ...item, status: "sending", attempts: item.attempts + 1 } : null))
}

/** El servidor confirmó el registro completo: recién ahora se liberan las fotos locales. */
export async function markRecordSent(id: string, accepted: RecordAccepted): Promise<void> {
  const sentAt = new Date().toISOString()
  await updateItem(id, (item) => item.type !== "record" ? null : ({
    ...item, status: "sent", sentAt, nextAttemptAt: 0, lastError: null, rejection: null,
    folio: accepted.folio, receivedAt: accepted.receivedAt, warnings: accepted.warnings,
  }), { photosToDelete: (item) => (item.type === "record" ? item.photoIds : []) })
}

export async function markSimpleSent(id: string): Promise<void> {
  await updateItem(id, (item) => ({ ...item, status: "sent", sentAt: new Date().toISOString(), nextAttemptAt: 0, lastError: null }))
}

/** Rechazo definitivo: se conserva todo (datos y fotos) para corregir y reenviar. */
export async function markRejected(id: string, message: string, field: string | null): Promise<void> {
  await updateItem(id, (item) => item.type === "record"
    ? { ...item, status: "rejected", lastError: message, rejection: { message, field } }
    : { ...item, status: "rejected", lastError: message })
}

/** Falla pasajera (red, 408, 429, 5xx): vuelve a `pending` con su espera. */
export async function markRetry(id: string, message: string, nextAttemptAt: number): Promise<void> {
  await updateItem(id, (item) => ({ ...item, status: "pending", lastError: message, nextAttemptAt }))
}

/** La credencial del autor ya no sirve: todo lo suyo sin enviar espera a que entre de nuevo. */
export async function markAuthorNeedsLogin(authorUserId: string): Promise<void> {
  const items = await listQueue()
  for (const item of items) {
    if (item.authorUserId === authorUserId && (item.status === "pending" || item.status === "sending")) {
      await updateItem(item.id, (current) => ({ ...current, status: "needs_login" }))
    }
  }
}

/** El autor volvió a entrar: lo que esperaba su credencial se reintenta ya. */
export async function requeueAuthor(authorUserId: string): Promise<void> {
  const items = await listQueue()
  for (const item of items) {
    if (item.authorUserId === authorUserId && item.status === "needs_login") {
      await updateItem(item.id, (current) => ({ ...current, status: "pending", nextAttemptAt: 0 }))
    }
  }
}

/** Al abrir la app: lo que quedó «enviando» porque se cerró a media subida vuelve a pendiente. */
export async function resetInterruptedSending(): Promise<void> {
  const items = await listQueue()
  for (const item of items) {
    if (item.status === "sending") await updateItem(item.id, (current) => ({ ...current, status: "pending", nextAttemptAt: 0 }))
  }
}

/** Poda lo enviado hace más de 48 horas (ya no tiene fotos ni nada que perder). */
export async function pruneSent(now = Date.now()): Promise<void> {
  const items = await listQueue()
  const old = items.filter((item) => item.status === "sent" && item.sentAt && now - Date.parse(item.sentAt) > SENT_RETENTION_MS)
  if (old.length === 0) return
  await runTx([STORE.queue], "readwrite", async (s) => { await Promise.all(old.map((item) => req(s.queue.delete(item.id)))) })
  emit("queue")
}

export interface QueueStats {
  /** Esperando enviarse (incluye los que esperan que su autor entre de nuevo). */
  pending: number
  needsLogin: number
  rejected: number
  /** Milisegundos desde el elemento pendiente más antiguo; `null` si no hay. */
  oldestPendingMs: number | null
}

export const STALE_PENDING_MS = 24 * 60 * 60 * 1000

export function queueStats(items: readonly QueueItem[], authorUserId?: string, now = Date.now()): QueueStats {
  let pending = 0, needsLogin = 0, rejected = 0
  let oldest: number | null = null
  for (const item of items) {
    if (authorUserId && item.authorUserId !== authorUserId) continue
    if (item.status === "rejected") { rejected++; continue }
    if (item.status === "sent") continue
    pending++
    if (item.status === "needs_login") needsLogin++
    const age = now - Date.parse(item.createdAt)
    if (oldest === null || age > oldest) oldest = age
  }
  return { pending, needsLogin, rejected, oldestPendingMs: oldest }
}
