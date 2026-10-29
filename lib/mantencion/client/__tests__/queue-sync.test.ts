import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { saveAccount } from "../accounts"
import { STORE, idbGetAll } from "../db"
import { getPhoto, putPhoto } from "../photo-store"
import { backoffMs, BACKOFF_CAP_MS, claimForSending, commitRecord, getQueueItem, listQueue, markRecordSent, queueStats } from "../queue"
import { runSync } from "../sync-engine"
import type { QueueRecordItem } from "../types"
import { UUID, account, freshDb, json, photo, recordItem } from "./fixtures"

const R1 = UUID(1)
const PHOTOS: [string, string] = [UUID(11), UUID(12)]

async function seed(options: { accountOverrides?: Parameters<typeof account>[1]; id?: string } = {}): Promise<QueueRecordItem> {
  await saveAccount(account("u-1", options.accountOverrides))
  await putPhoto(photo(PHOTOS[0]))
  await putPhoto(photo(PHOTOS[1], "u-1", { kind: "sticker" }))
  const item = recordItem(options.id ?? R1, "u-1", PHOTOS)
  await commitRecord(item, { draftKey: "u-1:P" })
  return item
}

const ACCEPTED = { ok: true, id: R1, folio: "MP-BIO-0007", receivedAt: "2026-10-28T15:01:00.000Z", duplicate: false, warnings: [] }

/** Responde según método y ruta; lo no previsto es un fallo de red. */
function routes(handlers: { photo?: () => Response; record?: () => Response }) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    if (init?.method === "PUT" && path.includes("/sync/fotos/")) return handlers.photo?.() ?? new Response(null, { status: 200 })
    if (init?.method === "POST" && path.endsWith("/sync/registros")) return handlers.record?.() ?? json(200, ACCEPTED)
    throw new TypeError("sin red")
  })
}

const sync = (fetchImpl: ReturnType<typeof routes>, now?: number) => runSync({ fetchImpl: fetchImpl as unknown as typeof fetch, skipCatalogRefresh: true, now: now ? () => now : undefined })

describe("cola de envío", () => {
  beforeEach(freshDb)

  it("pending → sending → sent: sube las fotos, envía el registro y guarda el folio", async () => {
    await seed()
    const fetchImpl = routes({})
    const report = await sync(fetchImpl)
    expect(report.sent).toBe(1)
    const item = (await getQueueItem(R1)) as QueueRecordItem
    expect(item.status).toBe("sent")
    expect(item.folio).toBe("MP-BIO-0007")
    expect(item.attempts).toBe(1)
    const puts = fetchImpl.mock.calls.filter(([, init]) => init?.method === "PUT")
    expect(puts).toHaveLength(2)
    const post = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")
    expect((post?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer token-u-1")
  })

  it("claimForSending pasa a sending y cuenta el intento", async () => {
    await seed()
    const claimed = await claimForSending(R1)
    expect(claimed?.status).toBe("sending")
    expect(claimed?.attempts).toBe(1)
    expect(await claimForSending(R1)).toBeNull()
  })

  it("la foto local se borra SÓLO cuando el servidor confirmó el registro completo", async () => {
    await seed()
    // El registro falla por red tras subir las fotos: las fotos siguen en el teléfono.
    const failing = routes({ record: () => json(503, { message: "caído" }) })
    await sync(failing, Date.now())
    expect(await getPhoto(PHOTOS[0])).not.toBeNull()
    expect(await getPhoto(PHOTOS[1])).not.toBeNull()
    expect((await getQueueItem(R1))?.status).toBe("pending")

    // Confirmado: recién ahora se liberan.
    await sync(routes({}), Date.now() + BACKOFF_CAP_MS + 1_000)
    expect((await getQueueItem(R1))?.status).toBe("sent")
    expect(await getPhoto(PHOTOS[0])).toBeNull()
    expect(await getPhoto(PHOTOS[1])).toBeNull()
  })

  it("una foto ya subida no se vuelve a subir en el siguiente intento", async () => {
    await seed()
    await sync(routes({ record: () => json(500, { message: "x" }) }), Date.now())
    const second = routes({})
    await sync(second, Date.now() + BACKOFF_CAP_MS + 1_000)
    expect(second.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0)
  })

  it("un rechazo 422 deja el registro «rejected» con su motivo y conserva datos y fotos", async () => {
    await seed()
    const fetchImpl = routes({ record: () => json(422, { ok: false, code: "invalid", message: "La lectura es menor que la anterior.", field: "reading" }) })
    const report = await sync(fetchImpl)
    expect(report.rejected).toBe(1)
    const item = (await getQueueItem(R1)) as QueueRecordItem
    expect(item.status).toBe("rejected")
    expect(item.rejection).toEqual({ message: "La lectura es menor que la anterior.", field: "reading" })
    expect(item.payload.reading).toBe(40_312)
    expect(await getPhoto(PHOTOS[0])).not.toBeNull()
    // Un rechazado no se reintenta solo.
    const again = routes({})
    expect((await sync(again, Date.now() + BACKOFF_CAP_MS + 1_000)).sent).toBe(0)
    expect(again).not.toHaveBeenCalled()
  })

  it("409 missing_photos: vuelve a subir las fotos y reintenta en la misma pasada", async () => {
    await seed()
    let posts = 0
    const fetchImpl = routes({
      record: () => (++posts === 1 ? json(409, { ok: false, code: "missing_photos", message: "Faltan fotos" }) : json(200, ACCEPTED)),
    })
    const report = await sync(fetchImpl)
    expect(report.sent).toBe(1)
    expect(posts).toBe(2)
    // 2 fotos la primera vez + 2 al re-subir.
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(4)
  })

  it("401: la cuenta queda needs_login y sus elementos esperan; no se pierde nada", async () => {
    await seed()
    const report = await sync(routes({ record: () => json(401, { message: "vencida" }) }))
    expect(report.needsLogin).toEqual(["u-1"])
    const item = await getQueueItem(R1)
    expect(item?.status).toBe("needs_login")
    expect(await getPhoto(PHOTOS[0])).not.toBeNull()
    const accounts = await idbGetAll<{ userId: string; status: string }>(STORE.accounts)
    expect(accounts[0]?.status).toBe("needs_login")
    // Mientras no entre de nuevo, no se envía nada.
    const again = routes({})
    await sync(again)
    expect(again).not.toHaveBeenCalled()
  })

  it("credencial vencida: no se intenta enviar y queda needs_login", async () => {
    await seed({ accountOverrides: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
    const fetchImpl = routes({})
    const report = await sync(fetchImpl)
    expect(report.needsLogin).toEqual(["u-1"])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("red caída: vuelve a pending con backoff y no sigue con el resto", async () => {
    await seed()
    const now = Date.now()
    const report = await sync(vi.fn(async () => { throw new TypeError("sin red") }) as unknown as ReturnType<typeof routes>, now)
    expect(report.retried).toBe(1)
    const item = (await getQueueItem(R1)) as QueueRecordItem
    expect(item.status).toBe("pending")
    expect(item.nextAttemptAt).toBe(now + backoffMs(0))
    expect(report.nextAttemptAt).toBe(item.nextAttemptAt)
  })

  it("no reintenta antes de la hora del backoff", async () => {
    await seed()
    const now = Date.now()
    await sync(routes({ record: () => json(503, {}) }), now)
    const early = routes({})
    await sync(early, now + 1_000)
    expect(early).not.toHaveBeenCalled()
    expect((await sync(routes({}), now + 6_000)).sent).toBe(1)
  })

  it("un solo sincronizador a la vez", async () => {
    await seed()
    const fetchImpl = routes({})
    const [a, b] = await Promise.all([sync(fetchImpl), sync(fetchImpl)])
    expect(a).toBe(b)
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
  })

  it("cada elemento se envía con la credencial de SU autor", async () => {
    await saveAccount(account("u-1"))
    await saveAccount(account("u-2"))
    for (const [id, author, base] of [[UUID(1), "u-1", 20], [UUID(2), "u-2", 30]] as const) {
      await putPhoto(photo(UUID(base), author))
      await putPhoto(photo(UUID(base + 1), author, { kind: "sticker" }))
      await commitRecord(recordItem(id, author, [UUID(base), UUID(base + 1)], `2026-10-28T15:0${base / 10}:00.000Z`), { draftKey: `${author}:P` })
    }
    const fetchImpl = routes({ record: () => json(200, { ...ACCEPTED, id: "x" }) })
    await sync(fetchImpl)
    const tokens = fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => (init?.headers as Record<string, string>).Authorization)
    expect(tokens).toEqual(["Bearer token-u-1", "Bearer token-u-2"])
  })

  it("una actualización de taller espera a que llegue su registro", async () => {
    const { newWorkshopItem, enqueueSimple } = await import("../queue")
    await seed()
    await enqueueSimple(newWorkshopItem({
      authorUserId: "u-1",
      payload: { id: UUID(50), recordId: R1, kind: "salio", exitDate: "2026-10-29", createdAt: "2026-10-29T10:00:00.000Z", deviceId: UUID(900) },
      summary: { vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84" },
    }, "2026-10-29T10:00:00.000Z"))
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url)}`)
      if (String(url).endsWith("/sync/registros")) return json(503, {})
      return new Response(null, { status: 200 })
    })
    await runSync({ fetchImpl: fetchImpl as unknown as typeof fetch, skipCatalogRefresh: true })
    expect(calls.some((call) => call.includes("/sync/taller"))).toBe(false)
  })
})

describe("backoff", () => {
  it("min(5 s × 2^n, 15 min)", () => {
    expect(backoffMs(0)).toBe(5_000)
    expect(backoffMs(1)).toBe(10_000)
    expect(backoffMs(3)).toBe(40_000)
    expect(backoffMs(7)).toBe(640_000)
    expect(backoffMs(8)).toBe(BACKOFF_CAP_MS)
    expect(backoffMs(50)).toBe(BACKOFF_CAP_MS)
  })
})

describe("estadísticas de la cola", () => {
  beforeEach(freshDb)

  it("cuenta pendientes, rechazados y la edad del más antiguo", async () => {
    await seed()
    await markRecordSent(R1, { id: R1, folio: "MP-BIO-0001", receivedAt: "x", duplicate: false, warnings: [] })
    const sent = await listQueue()
    expect(queueStats(sent).pending).toBe(0)
    const old = recordItem(UUID(3), "u-1", [UUID(31), UUID(32)], "2026-10-26T10:00:00.000Z")
    const stats = queueStats([old], "u-1", Date.parse("2026-10-28T10:00:00.000Z"))
    expect(stats.pending).toBe(1)
    expect(stats.oldestPendingMs).toBe(48 * 3600_000)
  })
})

describe("espacio del teléfono", () => {
  beforeEach(freshDb)

  it("sin espacio: guardar una foto lanza StorageFullError con un mensaje claro y no deja nada a medias", async () => {
    const { StorageFullError } = await import("../db")
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("sin espacio", "QuotaExceededError") })
    await expect(putPhoto(photo(UUID(70)))).rejects.toBeInstanceOf(StorageFullError)
    await expect(putPhoto(photo(UUID(70)))).rejects.toThrow(/no tiene espacio/)
    spy.mockRestore()
    expect(await getPhoto(UUID(70))).toBeNull()
  })

  it("sin espacio al firmar: no entra a la cola y el borrador sigue", async () => {
    const { StorageFullError, idbPut } = await import("../db")
    await idbPut(STORE.drafts, { key: "u-1:P", userId: "u-1", kind: "P", updatedAt: "x", draft: { id: R1 } })
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      if (this.name === STORE.queue) throw new DOMException("sin espacio", "QuotaExceededError")
      return original.apply(this, args)
    })
    await expect(commitRecord(recordItem(R1, "u-1", PHOTOS), { draftKey: "u-1:P" })).rejects.toBeInstanceOf(StorageFullError)
    spy.mockRestore()
    expect(await getQueueItem(R1)).toBeNull()
    expect(await idbGetAll(STORE.drafts)).toHaveLength(1)
  })
})


describe("fallo inesperado al enviar", () => {
  beforeEach(freshDb)

  it("un error local no deja el registro «enviando» para siempre: vuelve a pendiente con espera y conserva las fotos", async () => {
    await seed()
    const now = Date.now()
    const fetchImpl = vi.fn(async () => { throw new Error("boom") })
    // Un error que NO es de red (p. ej. una excepción al armar el envío) sale del motor, no del servidor.
    const spy = vi.spyOn(FormData.prototype, "set").mockImplementation(() => { throw new Error("no se pudo armar el envío") })
    const report = await runSync({ fetchImpl: fetchImpl as unknown as typeof fetch, skipCatalogRefresh: true, now: () => now })
    spy.mockRestore()
    expect(report.retried).toBe(1)
    const item = (await getQueueItem(R1)) as QueueRecordItem
    expect(item.status).toBe("pending")
    expect(item.nextAttemptAt).toBe(now + backoffMs(0))
    expect(item.lastError).toMatch(/no se pudo armar/)
    expect(await getPhoto(PHOTOS[0])).not.toBeNull()
  })
})
