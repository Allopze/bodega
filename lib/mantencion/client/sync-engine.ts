import { canSync, getAccount, markAccountNeedsLogin } from "./accounts"
import { postObservationReply, postRecord, postWorkshopUpdate, uploadPhoto, type ApiFailure } from "./api"
import { refreshCatalog } from "./catalog-sync"
import { emit } from "./events"
import { getPhotos, resetUploaded, setPhotoUploaded } from "./photo-store"
import {
  backoffMs, claimForSending, listQueue, markAuthorNeedsLogin, markRecordSent, markRejected, markRetry, markSimpleSent, pruneSent,
} from "./queue"
import { reportReachable } from "./signal"
import type { DeviceAccount, QueueItem, QueueRecordItem } from "./types"

/**
 * Motor de sincronización. Un solo sincronizador a la vez (cerrojo en memoria y
 * `navigator.locks` entre pestañas). Cada elemento de la cola se envía con la
 * credencial de SU autor, en el orden en que se creó:
 *
 *   registro → sube cada foto (PUT idempotente) y luego el POST con su id;
 *   taller / respuesta → un POST (el de taller espera a que su registro llegue).
 *
 * Lo que decide cada respuesta está en `lib/mantencion/contracts.ts`
 * (`SyncRecordResponse`): 401/403 pide entrar de nuevo; 409/422 es un rechazo
 * definitivo que se conserva; red, 408, 429 y 5xx reintentan con backoff.
 */

export interface SyncDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  /** Pruebas: no refrescar el catálogo tras enviar. */
  skipCatalogRefresh?: boolean
}

export interface SyncReport {
  sent: number
  rejected: number
  retried: number
  /** Autores cuya credencial no sirve: sus elementos esperan que entren de nuevo. */
  needsLogin: string[]
  /** Epoch ms del próximo intento que conviene programar; `null` si no hay ninguno con espera. */
  nextAttemptAt: number | null
  /** Otra sincronización ya estaba corriendo. */
  busy: boolean
}

type Outcome = "sent" | "rejected" | "retry" | "auth" | "network"

const EMPTY: SyncReport = { sent: 0, rejected: 0, retried: 0, needsLogin: [], nextAttemptAt: null, busy: false }

let running: Promise<SyncReport> | null = null

export function runSync(deps: SyncDeps = {}): Promise<SyncReport> {
  if (running) return running
  running = withCrossTabLock(() => syncPass(deps))
    .catch((): SyncReport => ({ ...EMPTY }))
    .finally(() => { running = null; emit("queue") })
  return running
}

async function withCrossTabLock(work: () => Promise<SyncReport>): Promise<SyncReport> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!locks?.request) return work()
  const result = await locks.request("mant-sync", { ifAvailable: true }, async (lock) => (lock ? work() : null))
  return result ?? { ...EMPTY, busy: true }
}

function failureMessage(failure: ApiFailure): string {
  return failure.message
}

function retryDelay(item: QueueItem, failure: ApiFailure | null, now: number): number {
  const wait = backoffMs(item.attempts - 1)
  const asked = failure?.kind === "retry" ? failure.retryAfterMs ?? 0 : 0
  return now + Math.max(wait, asked)
}

async function settleFailure(item: QueueItem, failure: ApiFailure, account: DeviceAccount, now: number): Promise<Outcome> {
  if (failure.kind === "auth") {
    await markAccountNeedsLogin(account.userId)
    await markAuthorNeedsLogin(account.userId)
    return "auth"
  }
  if (failure.kind === "reject") {
    await markRejected(item.id, failureMessage(failure), failure.field)
    return "rejected"
  }
  reportReachable(!failure.network)
  await markRetry(item.id, failureMessage(failure), retryDelay(item, failure, now))
  return failure.network ? "network" : "retry"
}

async function uploadMissingPhotos(item: QueueRecordItem, account: DeviceAccount, deps: SyncDeps): Promise<ApiFailure | "missing" | null> {
  const photos = await getPhotos(item.photoIds)
  for (const photo of photos) {
    if (!photo) return "missing"
    if (photo.uploaded) continue
    const result = await uploadPhoto(account.token, photo, deps.fetchImpl)
    if (result.kind !== "ok") return result
    await setPhotoUploaded(photo.id, true)
  }
  return null
}

async function sendRecord(item: QueueRecordItem, account: DeviceAccount, deps: SyncDeps, now: number): Promise<Outcome> {
  // Una vez por pasada se permite re-subir las fotos si el servidor dice que no las tiene (`missing_photos`).
  for (let round = 0; round < 2; round++) {
    const uploaded = await uploadMissingPhotos(item, account, deps)
    if (uploaded === "missing") {
      await markRejected(item.id, "Faltan fotos en el teléfono. Corrige el registro y vuelve a sacarlas.", "photos")
      return "rejected"
    }
    if (uploaded) {
      // Una foto que el servidor no acepta (formato, tamaño, huella) es un rechazo con su motivo, no un reintento.
      return settleFailure(item, uploaded, account, now)
    }
    const result = await postRecord(account.token, item.payload, deps.fetchImpl)
    if (result.kind === "ok") {
      reportReachable(true)
      await markRecordSent(item.id, result.value)
      return "sent"
    }
    if (result.kind === "reject" && result.code === "missing_photos") {
      await resetUploaded(item.photoIds)
      if (round === 0) continue
      await markRetry(item.id, result.message, retryDelay(item, null, now))
      return "retry"
    }
    return settleFailure(item, result, account, now)
  }
  return "retry"
}

async function sendOne(item: QueueItem, account: DeviceAccount, deps: SyncDeps, now: number): Promise<Outcome> {
  if (item.type === "record") return sendRecord(item, account, deps, now)
  const result = item.type === "workshop"
    ? await postWorkshopUpdate(account.token, item.payload, deps.fetchImpl)
    : await postObservationReply(account.token, item.payload, deps.fetchImpl)
  if (result.kind === "ok") {
    reportReachable(true)
    await markSimpleSent(item.id)
    return "sent"
  }
  return settleFailure(item, result, account, now)
}

/** Una actualización de taller sólo puede llegar después de su registro. */
function waitsForItsRecord(item: QueueItem, queue: readonly QueueItem[]): boolean {
  if (item.type !== "workshop") return false
  return queue.some((other) => other.type === "record" && other.id === item.payload.recordId && other.status !== "sent")
}

async function syncPass(deps: SyncDeps): Promise<SyncReport> {
  const now = deps.now?.() ?? Date.now()
  const report: SyncReport = { ...EMPTY, needsLogin: [] }
  const queue = await listQueue()
  const blocked = new Set<string>()
  const sentBy = new Set<string>()

  for (const item of queue) {
    if (item.status !== "pending" || item.nextAttemptAt > now || blocked.has(item.authorUserId)) continue
    if (waitsForItsRecord(item, queue)) continue

    const account = await getAccount(item.authorUserId)
    if (!account || !canSync(account, now)) {
      await markAuthorNeedsLogin(item.authorUserId)
      if (account) await markAccountNeedsLogin(account.userId)
      blocked.add(item.authorUserId)
      report.needsLogin.push(item.authorUserId)
      continue
    }
    const claimed = await claimForSending(item.id)
    if (!claimed) continue

    // Un fallo inesperado (un error local, no del servidor) nunca deja el envío «enviando» ni lo descarta: reintenta con espera.
    const outcome = await sendOne(claimed, account, deps, now).catch(async (cause): Promise<Outcome> => {
      await markRetry(claimed.id, cause instanceof Error && cause.message ? cause.message : "No pudimos enviarlo. Se reintenta solo.", retryDelay(claimed, null, now))
      return "retry"
    })
    if (outcome === "sent") { report.sent++; sentBy.add(account.userId) }
    else if (outcome === "rejected") report.rejected++
    else if (outcome === "retry") report.retried++
    else if (outcome === "auth") { blocked.add(account.userId); report.needsLogin.push(account.userId) }
    else if (outcome === "network") { report.retried++; break }
  }

  if (report.sent > 0) {
    await pruneSent(now)
    if (!deps.skipCatalogRefresh) await Promise.all([...sentBy].map((userId) => refreshCatalog(userId, { withOthers: false, fetchImpl: deps.fetchImpl })))
  }
  const remaining = (await listQueue()).filter((item) => item.status === "pending")
  const delayed = remaining.filter((item) => item.nextAttemptAt > now).map((item) => item.nextAttemptAt)
  // Si algo llegó, lo que quedaba esperándolo (una actualización de taller tras su registro) sale enseguida.
  if (report.sent > 0 && remaining.length > 0) report.nextAttemptAt = now + 1_000
  else report.nextAttemptAt = delayed.length > 0 ? Math.min(...delayed) : null
  return report
}

export interface SyncLoop {
  /** Pide una pasada pronto (al guardar, al volver la señal…). */
  kick(): void
  stop(): void
}

const POLL_MS = 60_000

/**
 * Dispara la sincronización: al abrir, al volver la señal, al volver a la app,
 * cuando el service worker avisa y cada 60 s mientras haya algo pendiente. Entre
 * medio reprograma el próximo intento según el backoff de cada elemento.
 */
export function startSyncLoop(onReport?: (report: SyncReport) => void): SyncLoop {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (report: SyncReport | null) => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    const due = report?.nextAttemptAt != null ? Math.max(1_000, Math.min(report.nextAttemptAt - Date.now(), POLL_MS)) : POLL_MS
    timer = setTimeout(() => { void tick() }, due)
  }
  const tick = async () => {
    if (stopped) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) { schedule(null); return }
    const queue = await listQueue().catch(() => [])
    if (!queue.some((item) => item.status === "pending")) { schedule(null); return }
    const report = await runSync()
    if (!report.busy) onReport?.(report)
    schedule(report)
  }
  const kick = () => { void tick() }
  const onOnline = () => kick()
  const onVisible = () => { if (document.visibilityState === "visible") kick() }
  const onMessage = (event: MessageEvent) => { if ((event.data as { type?: string } | null)?.type === "mant-sync") kick() }

  window.addEventListener("online", onOnline)
  document.addEventListener("visibilitychange", onVisible)
  navigator.serviceWorker?.addEventListener("message", onMessage)
  kick()

  return {
    kick,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisible)
      navigator.serviceWorker?.removeEventListener("message", onMessage)
    },
  }
}

