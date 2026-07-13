"use client"

import type { TaeEvidenceKind } from "@/lib/services/fuel-tae"

const DB_NAME = "tae-offline"
const DB_VERSION = 2
const SUBMISSIONS = "submissions"
const SETTINGS = "settings"

export interface QueuedTaeEvidence {
  kind: TaeEvidenceKind
  blob: Blob
  fileName: string
}

export interface QueuedTaeSubmission {
  id: string
  createdAt: string
  updatedAt: string
  accessToken: string
  worksiteId: string
  payload: Record<string, unknown>
  evidence: QueuedTaeEvidence[]
  status: "pending" | "syncing" | "synced" | "failed"
  attempts: number
  lastError?: string
  publicResultToken?: string
  syncedAt?: string
}

/** Retención de blobs ya sincronizados (decisión de Fase 0, 2026-07-12): 48 horas. */
export const SYNCED_RETENTION_MS = 48 * 60 * 60 * 1000

let connection: IDBDatabase | null = null

function openDb(): Promise<IDBDatabase> {
  if (connection) return Promise.resolve(connection)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SUBMISSIONS)) {
        const store = db.createObjectStore(SUBMISSIONS, { keyPath: "id" })
        store.createIndex("status", "status", { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS)
    }
    request.onsuccess = () => {
      connection = request.result
      connection.onclose = () => { connection = null }
      connection.onversionchange = () => { connection?.close(); connection = null }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(name: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return requestValue(operation(db.transaction(name, mode).objectStore(name)))
}

export async function saveTaeAccessToken(accessToken: string) {
  await withStore(SETTINGS, "readwrite", (store) => store.put(accessToken, "accessToken"))
}

export async function getTaeAccessToken(): Promise<string | null> {
  return (await withStore(SETTINGS, "readonly", (store) => store.get("accessToken"))) ?? null
}

export async function clearTaeAccessToken() {
  await withStore(SETTINGS, "readwrite", (store) => store.delete("accessToken"))
}

export async function saveTaeAccessConfig(config: Record<string, unknown>) {
  await withStore(SETTINGS, "readwrite", (store) => store.put(config, "accessConfig"))
}

export async function clearTaeAccessConfig() {
  await withStore(SETTINGS, "readwrite", (store) => store.delete("accessConfig"))
}

export async function getTaeAccessConfig<T extends Record<string, unknown>>(): Promise<T | null> {
  return (await withStore(SETTINGS, "readonly", (store) => store.get("accessConfig"))) as T | null
}

export type TaeIdentityRole = "driver" | "supervisor"

export interface CachedTaeIdentity {
  id: string
  name: string
}

/** Identidad verificada por RUT, reutilizable sin red (Fase 0: el conductor completa el formulario). */
export async function saveTaeIdentity(scopeKey: string, role: TaeIdentityRole, identity: CachedTaeIdentity) {
  await withStore(SETTINGS, "readwrite", (store) => store.put(identity, `identity:${scopeKey}:${role}`))
}

export async function getTaeIdentity(scopeKey: string, role: TaeIdentityRole): Promise<CachedTaeIdentity | null> {
  return (await withStore(SETTINGS, "readonly", (store) => store.get(`identity:${scopeKey}:${role}`))) ?? null
}

export async function registerTaeBackgroundSync(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false
  try {
    const registration = await navigator.serviceWorker.ready
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    if (!sync) return false
    await sync.register("tae-sync")
    return true
  } catch {
    return false
  }
}

export async function enqueueTaeSubmission(accessToken: string, payload: Record<string, unknown>, evidence: QueuedTaeEvidence[]): Promise<QueuedTaeSubmission> {
  const now = new Date().toISOString()
  const item: QueuedTaeSubmission = {
    id: String(payload.clientSubmissionId),
    createdAt: now,
    updatedAt: now,
    accessToken,
    worksiteId: String(payload.worksiteId ?? ""),
    payload,
    evidence,
    status: "pending",
    attempts: 0,
  }
  await withStore(SUBMISSIONS, "readwrite", (store) => store.put(item))
  return item
}

export async function getPendingTaeSubmissions(): Promise<QueuedTaeSubmission[]> {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readonly")
  const items = await requestValue(tx.objectStore(SUBMISSIONS).index("status").getAll("pending"))
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getFailedTaeSubmissions(): Promise<QueuedTaeSubmission[]> {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readonly")
  return requestValue(tx.objectStore(SUBMISSIONS).index("status").getAll("failed"))
}

export async function countPendingTaeSubmissions(): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readonly")
  return requestValue(tx.objectStore(SUBMISSIONS).index("status").count("pending"))
}

export async function updateTaeSubmission(id: string, patch: Partial<QueuedTaeSubmission>) {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readwrite")
  const store = tx.objectStore(SUBMISSIONS)
  const current = await requestValue(store.get(id)) as QueuedTaeSubmission | undefined
  if (!current) return
  await requestValue(store.put({ ...current, ...patch, updatedAt: new Date().toISOString() }))
}

/** Recupera envíos que quedaron en `syncing` cuando el navegador se cerró. */
export async function recoverStaleTaeSubmissions(now = Date.now(), staleMs = 5 * 60 * 1000): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readwrite")
  const store = tx.objectStore(SUBMISSIONS)
  const syncing = await requestValue(store.index("status").getAll("syncing")) as QueuedTaeSubmission[]
  const stale = syncing.filter((item) => {
    const updatedAt = new Date(item.updatedAt ?? item.createdAt).getTime()
    return !Number.isFinite(updatedAt) || now - updatedAt >= staleMs
  })
  await Promise.all(stale.map((item) => requestValue(store.put({
    ...item,
    status: "pending",
    updatedAt: new Date(now).toISOString(),
    lastError: "Sincronización interrumpida; se reintentará.",
  }))))
  return stale.length
}

export async function deleteTaeSubmission(id: string) {
  await withStore(SUBMISSIONS, "readwrite", (store) => store.delete(id))
}

/**
 * Borra las cargas ya sincronizadas (con sus fotos) cuando llevan más de 48h
 * confirmadas por el servidor. Nunca toca pendientes/en curso — solo
 * "synced" con `syncedAt` vencido. Se llama de forma oportunista (al abrir
 * el formulario y tras cada sincronización exitosa), no en un timer.
 */
export async function purgeSyncedTaeSubmissions(now = Date.now()): Promise<number> {
  const db = await openDb()
  const tx = db.transaction(SUBMISSIONS, "readwrite")
  const store = tx.objectStore(SUBMISSIONS)
  const synced = await requestValue(store.index("status").getAll("synced")) as QueuedTaeSubmission[]
  const stale = synced.filter((item) => item.syncedAt && now - new Date(item.syncedAt).getTime() > SYNCED_RETENTION_MS)
  await Promise.all(stale.map((item) => requestValue(store.delete(item.id))))
  return stale.length
}
