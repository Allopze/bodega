import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { saveAccount } from "../accounts"
import { postWorkOrderOp } from "../api"
import { commitRecord, discardRejectedOtOp, enqueueSimple, getQueueItem, listQueue, newRecordItem } from "../queue"
import { waitsForDependency } from "../queue-order"
import { runSync } from "../sync-engine"
import { putPhoto } from "../photo-store"
import type { QueueItem } from "../types"
import { ENTRY, UUID, account, correctivePayload, freshDb, json, legacyTakeItem, otOpItem, photo } from "./fixtures"

const ENTRY_BODY = { ...ENTRY, workshopId: null, operatorDriverId: null }
const START = (n = 2) => otOpItem(n, { action: "start", entry: ENTRY_BODY })
/** Un «tomar» viejo de la cola: la cola lo sigue enviando (el servidor lo rechaza) y respeta su orden. */
const TAKE = (n = 1) => legacyTakeItem(n)
const FINISH = (n = 5) => otOpItem(n, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null })

function linkedRecord(n: number, createdAt: string, workOrderId: string | null = "ot-1") {
  return newRecordItem({
    authorUserId: "u-1",
    payload: correctivePayload(UUID(n), UUID(n + 50), { workOrderId, inWorkshop: false, workshopEntryDate: null, workshopReason: null }),
    photoIds: [UUID(n + 50)],
    summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
  }, createdAt)
}

/** Anota el orden de llegada de cada POST; responde según lo que se le pida. */
function server(handlers: { ot?: (body: { id: string; action: string }) => Response; record?: () => Response } = {}) {
  const order: string[] = []
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    if (init?.method === "PUT" && path.includes("/sync/fotos/")) return new Response(null, { status: 200 })
    if (init?.method === "POST" && path.endsWith("/sync/ot")) {
      const body = JSON.parse(String(init.body)) as { id: string; action: string }
      order.push(body.action)
      return handlers.ot?.(body) ?? json(200, { ok: true, id: body.id, workOrderId: "ot-1", status: "asignada", receivedAt: "2026-10-28T15:01:00.000Z", duplicate: false, warnings: [] })
    }
    if (init?.method === "POST" && path.endsWith("/sync/registros")) {
      const body = JSON.parse(String(init.body)) as { id: string }
      order.push("record")
      return handlers.record?.() ?? json(200, { ok: true, id: body.id, folio: "MC-BIO-0009", receivedAt: "2026-10-28T15:01:00.000Z", duplicate: false, warnings: [] })
    }
    throw new TypeError("sin red")
  })
  return { fetchImpl, order }
}

const sync = (s: ReturnType<typeof server>, now?: number) => runSync({ fetchImpl: s.fetchImpl as unknown as typeof fetch, skipCatalogRefresh: true, now: now ? () => now : undefined })

async function seed(...items: QueueItem[]) {
  await saveAccount(account("u-1"))
  for (const item of items) {
    if (item.type === "record") {
      await putPhoto(photo(item.photoIds[0]!, "u-1", { kind: "correctiva" }))
      await commitRecord(item, { draftKey: "u-1:C" })
    } else await enqueueSimple(item)
  }
}

describe("cola de OT: envío", () => {
  beforeEach(freshDb)

  it("postWorkOrderOp envía la operación a /api/mantencion/sync/ot con la credencial del autor", async () => {
    const s = server()
    await seed(TAKE())
    expect((await sync(s)).sent).toBe(1)
    const [url, init] = s.fetchImpl.mock.calls[0]!
    expect(String(url)).toBe("/api/mantencion/sync/ot")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-u-1")
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: "take", workOrderId: "ot-1" })
    expect((await getQueueItem(TAKE().id))?.status).toBe("sent")
  })

  it("409/422 deja la operación rechazada con el motivo del servidor; 401 pide entrar de nuevo; 503 reintenta", async () => {
    await seed(TAKE())
    expect((await sync(server({ ot: () => json(409, { ok: false, code: "rejected", message: "La OT ya la tomó otra persona." }) }))).rejected).toBe(1)
    const rejected = await getQueueItem(TAKE().id)
    expect(rejected).toMatchObject({ status: "rejected", lastError: "La OT ya la tomó otra persona." })

    await freshDb()
    await seed(TAKE())
    const report = await sync(server({ ot: () => json(401, { message: "vencida" }) }))
    expect(report.needsLogin).toEqual(["u-1"])
    expect((await getQueueItem(TAKE().id))?.status).toBe("needs_login")

    await freshDb()
    await seed(TAKE())
    expect((await sync(server({ ot: () => json(503, { message: "caído" }) }))).retried).toBe(1)
    expect((await getQueueItem(TAKE().id))?.status).toBe("pending")
  })

  it("las operaciones de una OT salen en el orden en que se hicieron", async () => {
    const s = server()
    await seed(START(2), TAKE(1), FINISH(5))
    // Cada pasada deja salir lo que ya no espera nada: tomar → ingreso → terminar (esto último, sin registro enlazado pendiente).
    await sync(s)
    await sync(s)
    await sync(s)
    expect(s.order).toEqual(["take", "start", "finish"])
  })

  it("si «tomar» falla y espera, «ingreso» no se adelanta", async () => {
    const down = server({ ot: () => json(503, { message: "caído" }) })
    await seed(TAKE(1), START(2))
    const now = Date.now()
    await sync(down, now)
    expect(down.order).toEqual(["take"])
    expect((await getQueueItem(START().id))?.status).toBe("pending")
    // «tomar» sigue esperando su backoff: «ingreso» tampoco sale.
    const still = server()
    await sync(still, now + 1_000)
    expect(still.order).toEqual([])
  })

  it("un registro enlazado a una OT espera a que su «ingreso» llegue; sin OT no espera nada", async () => {
    const s = server()
    await seed(START(2), linkedRecord(3, "2026-10-28T15:03:00.000Z"), linkedRecord(4, "2026-10-28T15:04:00.000Z", null))
    await sync(s)
    // En la primera pasada salen el ingreso y el registro sin OT; el enlazado espera.
    expect(s.order).toEqual(["start", "record"])
    await sync(s)
    expect(s.order).toEqual(["start", "record", "record"])
  })

  it("«terminar» espera a los registros enlazados pendientes, y tras enviarlos sale en la pasada siguiente", async () => {
    const s = server()
    await seed(linkedRecord(3, "2026-10-28T15:03:00.000Z"), FINISH(5))
    await sync(s)
    expect(s.order).toEqual(["record"])
    await sync(s)
    expect(s.order).toEqual(["record", "finish"])
  })

  it("un «ingreso» rechazado no deja al registro esperando para siempre: el servidor responde con su motivo", async () => {
    const s = server({ ot: () => json(422, { ok: false, code: "rejected", message: "La OT no está asignada a ti." }), record: () => json(422, { ok: false, code: "rejected", message: "La OT no está en ejecución." }) })
    await seed(START(2), linkedRecord(3, "2026-10-28T15:03:00.000Z"))
    await sync(s)
    expect(s.order).toEqual(["start"])
    await sync(s)
    expect(s.order).toEqual(["start", "record"])
    expect((await getQueueItem(UUID(3)))?.status).toBe("rejected")
  })

  it("discardRejectedOtOp quita sólo operaciones de OT rechazadas", async () => {
    await seed(TAKE())
    await sync(server({ ot: () => json(409, { message: "no" }) }))
    await discardRejectedOtOp(TAKE().id)
    expect(await getQueueItem(TAKE().id)).toBeNull()
    await enqueueSimple(TAKE())
    await discardRejectedOtOp(TAKE().id)
    expect((await listQueue()).map((item) => item.id)).toEqual([TAKE().id])
  })

  it("postWorkOrderOp clasifica el 409 como rechazo y la red caída como reintento", async () => {
    const payload = TAKE().payload
    expect((await postWorkOrderOp("t", payload, (async () => json(409, { message: "x" })) as unknown as typeof fetch)).kind).toBe("reject")
    expect(await postWorkOrderOp("t", payload, (async () => { throw new TypeError("net") }) as unknown as typeof fetch)).toMatchObject({ kind: "retry", network: true })
  })
})

describe("waitsForDependency (puro)", () => {
  it("lo anterior vivo bloquea; lo enviado, lo rechazado y lo posterior no", () => {
    const take = TAKE(1)
    const start = START(2)
    const queue: QueueItem[] = [take, start]
    expect(waitsForDependency(start, queue)).toBe(true)
    expect(waitsForDependency(take, queue)).toBe(false)
    expect(waitsForDependency(start, [{ ...take, status: "sent" }, start])).toBe(false)
    expect(waitsForDependency(start, [{ ...take, status: "rejected" }, start])).toBe(false)
    // Otra OT no cuenta.
    expect(waitsForDependency(start, [legacyTakeItem(1, { workOrderId: "ot-2" }), start])).toBe(false)
  })

  it("dos elementos con la misma hora no se esperan entre sí", () => {
    const at = "2026-10-28T15:00:00.000Z"
    const finish = otOpItem(1, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null }, { createdAt: at })
    const record = linkedRecord(3, at)
    expect(waitsForDependency(finish, [finish, record])).toBe(false)
    expect(waitsForDependency(record, [finish, record])).toBe(false)
  })
})
