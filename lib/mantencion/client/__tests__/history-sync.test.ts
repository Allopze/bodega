import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppHistory } from "../../contracts"
import { removeAccount, saveAccount } from "../accounts"
import { HISTORY_URL, getHistory, getPhoto, historyPhotoUrl } from "../api"
import { STORE, idbGet, idbGetAll, idbPut, openDb, resetDbConnectionForTests } from "../db"
import {
  PHOTO_CACHE_MAX_BYTES, PHOTO_CACHE_MAX_ITEMS, getHistoryStatus, getPhotoBlob, loadStoredHistory, refreshHistory, resetHistoryStatusForTests,
} from "../history-sync"
import { listQueue } from "../queue"
import { reportReachable } from "../signal"
import type { CachedPhoto, StoredHistory } from "../types"
import { account, freshDb, json, photo, recordItem, UUID } from "./fixtures"

const HISTORY: AppHistory = {
  version: "h1", generatedAt: "2026-11-02T12:00:00.000Z",
  byVehicle: { "veh-1": [{
    id: UUID(1), folio: "MP-BIO-0001", kind: "P", vehicleId: "veh-1", worksiteName: "Biodiversa", workDate: "2026-10-28", reading: 40_000, unit: "km",
    executorKind: "yo", executorName: "Javier Roa", workOrderFolio: null, notes: null, schedule: { name: "Camiones", intervalValue: 40_000 },
    itemsDone: 4, itemsFlagged: [], corrective: null, photos: [{ id: UUID(50), kind: "filtros", width: 1600, height: 1200 }],
  }] },
}
const request = (fetchImpl: ReturnType<typeof vi.fn>, index = 0) => ({ url: String(fetchImpl.mock.calls[index]?.[0]), init: fetchImpl.mock.calls[index]?.[1] as RequestInit })
const asFetch = (fn: unknown) => fn as typeof fetch

beforeEach(async () => { await freshDb(); resetHistoryStatusForTests() })
afterEach(() => { vi.restoreAllMocks() })

describe("historial con ETag", () => {
  it("guarda el historial con su ETag y la segunda vez pregunta con If-None-Match (304 = sin cambios, anota la hora)", async () => {
    await saveAccount(account("u-1"))
    const first = vi.fn(async () => json(200, HISTORY, { etag: '"h1"' }))
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(first) })).toBe("updated")
    const stored = await loadStoredHistory("u-1")
    expect(stored).toMatchObject({ userId: "u-1", etag: '"h1"', data: HISTORY })
    expect(request(first).url).toBe(HISTORY_URL)
    expect((request(first).init.headers as Record<string, string>).Authorization).toBe("Bearer token-u-1")
    expect(getHistoryStatus("u-1")).toEqual({ refreshing: false, failed: false })

    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = vi.fn(async () => new Response(null, { status: 304 }))
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(second) })).toBe("unchanged")
    expect((request(second).init.headers as Record<string, string>)["If-None-Match"]).toBe('"h1"')
    const again = await loadStoredHistory("u-1")
    expect(again?.data).toEqual(HISTORY)
    expect(again!.fetchedAt > stored!.fetchedAt).toBe(true)
  })

  it("sin ETag propio usa el version del cuerpo", async () => {
    const result = await getHistory("t", null, asFetch(vi.fn(async () => json(200, HISTORY))))
    expect(result).toMatchObject({ kind: "ok", value: { notModified: false, etag: '"h1"' } })
  })

  it("conserva la copia anterior si falla la red o la plataforma, y lo marca como fallido", async () => {
    await saveAccount(account("u-1"))
    await refreshHistory("u-1", { fetchImpl: asFetch(vi.fn(async () => json(200, HISTORY, { etag: '"h1"' }))) })
    const before = await loadStoredHistory("u-1")

    const down = vi.fn(async () => { throw new TypeError("Failed to fetch") })
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(down) })).toBe("offline")
    expect(getHistoryStatus("u-1").failed).toBe(true)
    expect(await loadStoredHistory("u-1")).toEqual(before)

    const broken = vi.fn(async () => json(500, { message: "boom" }))
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(broken) })).toBe("error")
    expect(await loadStoredHistory("u-1")).toEqual(before)

    const garbage = vi.fn(async () => json(200, { nada: true }))
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(garbage) })).toBe("error")
    expect(await loadStoredHistory("u-1")).toEqual(before)

    // Al volver la señal, deja de estar fallido.
    reportReachable(true)
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(vi.fn(async () => new Response(null, { status: 304 }))) })).toBe("unchanged")
    expect(getHistoryStatus("u-1").failed).toBe(false)
  })

  it("un 401 no marca la cuenta como vencida (eso lo decide el catálogo)", async () => {
    await saveAccount(account("u-1"))
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(vi.fn(async () => json(401, { message: "no" }))) })).toBe("needs_login")
    expect((await idbGet<{ status: string }>(STORE.accounts, "u-1"))?.status).toBe("ok")
  })

  it("sin cuenta utilizable se omite sin pedir nada y sin marcar falla", async () => {
    await saveAccount(account("u-1", { status: "needs_login" }))
    const fetchImpl = vi.fn()
    expect(await refreshHistory("u-1", { fetchImpl: asFetch(fetchImpl) })).toBe("skipped")
    expect(await refreshHistory("nadie", { fetchImpl: asFetch(fetchImpl) })).toBe("skipped")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getHistoryStatus("u-1").failed).toBe(false)
  })

  it("quitar la cuenta borra su historial (y la caché de fotos al irse la última)", async () => {
    await saveAccount(account("u-1"))
    await saveAccount(account("u-2"))
    await idbPut(STORE.history, { userId: "u-1", etag: '"h1"', data: HISTORY, fetchedAt: "2026-11-02T12:00:00.000Z" } satisfies StoredHistory)
    await idbPut(STORE.history, { userId: "u-2", etag: '"h1"', data: HISTORY, fetchedAt: "2026-11-02T12:00:00.000Z" } satisfies StoredHistory)
    await idbPut(STORE.photoCache, { photoId: "p", blob: new Blob(["x"]), size: 1, lastUsedAt: 1 } satisfies CachedPhoto)
    await removeAccount("u-1")
    expect(await loadStoredHistory("u-1")).toBeNull()
    expect(await loadStoredHistory("u-2")).not.toBeNull()
    expect(await idbGetAll(STORE.photoCache)).toHaveLength(1)
    await removeAccount("u-2")
    expect(await idbGetAll(STORE.history)).toHaveLength(0)
    expect(await idbGetAll(STORE.photoCache)).toHaveLength(0)
  })
})

describe("foto del historial", () => {
  const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: "image/jpeg" })
  const imageResponse = (size = 10) => new Response(blobOf(size), { status: 200, headers: { "content-type": "image/jpeg" } })

  it("getPhoto pide con Bearer a la URL centralizada y clasifica los fallos", async () => {
    const ok = vi.fn(async () => imageResponse())
    const result = await getPhoto("tok", UUID(50), asFetch(ok))
    expect(result.kind).toBe("ok")
    expect(request(ok).url).toBe(historyPhotoUrl(UUID(50)))
    expect((request(ok).init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    expect(await getPhoto("tok", UUID(50), asFetch(vi.fn(async () => json(404, { message: "no" }))))).toMatchObject({ kind: "reject", status: 404 })
    expect(await getPhoto("tok", UUID(50), asFetch(vi.fn(async () => { throw new TypeError("x") })))).toMatchObject({ kind: "retry", network: true })
  })

  it("la primera vez baja y guarda; la segunda sale de la caché sin red", async () => {
    const fetchImpl = vi.fn(async () => imageResponse(10))
    expect((await getPhotoBlob(account("u-1"), UUID(50), asFetch(fetchImpl)))?.size).toBe(10)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    reportReachable(false)
    expect((await getPhotoBlob(account("u-1"), UUID(50), asFetch(fetchImpl)))?.size).toBe(10)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("sin señal y sin copia devuelve null sin pedir nada; con señal, un fallo también es null", async () => {
    const fetchImpl = vi.fn(async () => imageResponse())
    reportReachable(false)
    expect(await getPhotoBlob(account("u-1"), UUID(51), asFetch(fetchImpl))).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    reportReachable(true)
    expect(await getPhotoBlob(account("u-1"), UUID(51), asFetch(vi.fn(async () => json(404, {}))))).toBeNull()
    expect(await getPhotoBlob(account("u-1"), UUID(51), asFetch(vi.fn(async () => { throw new TypeError("x") })))).toBeNull()
    expect(await idbGetAll(STORE.photoCache)).toHaveLength(0)
  })

  it("al pasar de 80 fotos expulsa la menos usada, y leer una la salva", async () => {
    let clock = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 10))
    const fetchImpl = vi.fn(async () => imageResponse(10))
    for (let i = 0; i < PHOTO_CACHE_MAX_ITEMS; i++) await getPhotoBlob(account("u-1"), `p${i}`, asFetch(fetchImpl))
    expect(await idbGetAll(STORE.photoCache)).toHaveLength(PHOTO_CACHE_MAX_ITEMS)
    // p0 era la más vieja; al leerla pasa a ser la más reciente.
    await getPhotoBlob(account("u-1"), "p0", asFetch(fetchImpl))
    await getPhotoBlob(account("u-1"), "nueva", asFetch(fetchImpl))
    const ids = (await idbGetAll<CachedPhoto>(STORE.photoCache)).map((entry) => entry.photoId)
    expect(ids).toHaveLength(PHOTO_CACHE_MAX_ITEMS)
    expect(ids).toContain("p0")
    expect(ids).toContain("nueva")
    expect(ids).not.toContain("p1")
  })

  it("también expulsa por peso (40 MB)", async () => {
    let clock = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 10))
    const big = Math.floor(PHOTO_CACHE_MAX_BYTES / 2.5)
    for (const id of ["a", "b", "c"]) await getPhotoBlob(account("u-1"), id, asFetch(vi.fn(async () => imageResponse(big))))
    const ids = (await idbGetAll<CachedPhoto>(STORE.photoCache)).map((entry) => entry.photoId).sort()
    expect(ids).toEqual(["b", "c"])
  })
})

describe("migración de la base v1 → v2", () => {
  it("agrega history y photoCache sin tocar la cola, los borradores ni las fotos pendientes", async () => {
    await resetDbConnectionForTests()
    const factory = new IDBFactory()
    ;(globalThis as { indexedDB: IDBFactory }).indexedDB = factory

    // Una base v1 tal como la dejó la versión anterior de la app, con datos adentro.
    const queued = recordItem(UUID(1), "u-1", [UUID(11), UUID(12)])
    const pending = photo(UUID(11))
    const draft = { key: "u-1:P", userId: "u-1", kind: "P", updatedAt: "2026-10-28T15:00:00.000Z" }
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("mant-offline", 1)
      open.onupgradeneeded = () => {
        const db = open.result
        db.createObjectStore("meta")
        db.createObjectStore("accounts", { keyPath: "userId" })
        db.createObjectStore("catalogs", { keyPath: "userId" })
        db.createObjectStore("drafts", { keyPath: "key" }).createIndex("userId", "userId", { unique: false })
        const queue = db.createObjectStore("queue", { keyPath: "id" })
        queue.createIndex("authorUserId", "authorUserId", { unique: false })
        queue.createIndex("status", "status", { unique: false })
        db.createObjectStore("photos", { keyPath: "id" })
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(["queue", "photos", "drafts", "accounts"], "readwrite")
        tx.objectStore("queue").put(queued)
        tx.objectStore("photos").put(pending)
        tx.objectStore("drafts").put(draft)
        tx.objectStore("accounts").put(account("u-1"))
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })

    const db = await openDb()
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(["history", "photoCache", "queue", "photos", "drafts", "catalogs", "accounts", "meta"]))
    expect((await listQueue()).map((item) => item.id)).toEqual([UUID(1)])
    expect((await idbGet<{ id: string; uploaded: boolean }>(STORE.photos, UUID(11)))).toMatchObject({ id: UUID(11), uploaded: false })
    expect(await idbGet(STORE.drafts, "u-1:P")).toMatchObject({ userId: "u-1" })
    expect(await idbGet(STORE.accounts, "u-1")).toMatchObject({ userId: "u-1" })
    // Y los stores nuevos funcionan.
    expect(await loadStoredHistory("u-1")).toBeNull()
    await idbPut(STORE.history, { userId: "u-1", etag: null, data: HISTORY, fetchedAt: "x" } satisfies StoredHistory)
    expect((await loadStoredHistory("u-1"))?.data.version).toBe("h1")
  })
})
