import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { saveAccount } from "../accounts"
import { BACKOFF_CAP_MS, commitRecord, discardRejectedNote, enqueueSimple, getQueueItem, listQueue, newRecordItem } from "../queue"
import { waitsForDependency } from "../queue-order"
import { runSync } from "../sync-engine"
import { putPhoto } from "../photo-store"
import type { QueueItem, QueuePartsNoteItem } from "../types"
import { UUID, account, correctivePayload, freshDb, json, partsNoteItem, photo } from "./fixtures"

const ACCEPTED = (id: string, duplicate = false) => ({ ok: true, id, noteId: "np-db-1", code: "NP-2026-0001", receivedAt: "2026-10-28T15:01:00.000Z", duplicate })

function linkedRecord(n: number, createdAt: string, workOrderId: string | null = "ot-1") {
  return newRecordItem({
    authorUserId: "u-1",
    payload: correctivePayload(UUID(n), UUID(n + 50), { workOrderId, inWorkshop: false, workshopEntryDate: null, workshopReason: null }),
    photoIds: [UUID(n + 50)],
    summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
  }, createdAt)
}

/** Anota el orden de llegada de cada POST; responde según lo que se le pida; sin handler, sin red. */
function server(handlers: { note?: (body: { id: string }) => Response; record?: () => Response; offline?: boolean } = {}) {
  const order: string[] = []
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    if (handlers.offline) throw new TypeError("sin red")
    if (init?.method === "PUT" && path.includes("/sync/fotos/")) return new Response(null, { status: 200 })
    if (init?.method === "POST" && path.endsWith("/sync/notas-pedido")) {
      const body = JSON.parse(String(init.body)) as { id: string }
      order.push("note")
      return handlers.note?.(body) ?? json(200, ACCEPTED(body.id))
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

const NOTE = () => partsNoteItem(1)

describe("cola de notas de pedido", () => {
  beforeEach(freshDb)

  it("una nota hecha sin señal queda en la cola, con su motivo de espera, y se envía al volver la señal", async () => {
    await seed(NOTE())
    const now = Date.now()
    const down = server({ offline: true })
    const first = await sync(down, now)
    expect(first).toMatchObject({ sent: 0, retried: 1 })
    expect(await getQueueItem(NOTE().id)).toMatchObject({ type: "parts_note", status: "pending", attempts: 1 })

    const up = server()
    const second = await sync(up, now + BACKOFF_CAP_MS + 1_000)
    expect(second.sent).toBe(1)
    const [url, init] = up.fetchImpl.mock.calls[0]!
    expect(String(url)).toBe("/api/mantencion/sync/notas-pedido")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-u-1")
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: NOTE().payload.id, workOrderId: "ot-1", lines: [{ description: "Filtro de aceite", quantity: 2 }] })
    expect(await getQueueItem(NOTE().id)).toMatchObject({ status: "sent" })
  })

  it("un duplicado (200 con duplicate:true) también la saca de la cola", async () => {
    await seed(NOTE())
    const s = server({ note: (body) => json(200, ACCEPTED(body.id, true)) })
    expect((await sync(s)).sent).toBe(1)
    expect((await getQueueItem(NOTE().id))?.status).toBe("sent")
  })

  it("409 y 422 dejan el pedido rechazado a la vista, con el mensaje del servidor", async () => {
    await seed(NOTE())
    const s409 = server({ note: () => json(409, { ok: false, code: "rejected", message: "La OT ya no admite pedidos de repuestos." }) })
    expect((await sync(s409)).rejected).toBe(1)
    expect(await getQueueItem(NOTE().id)).toMatchObject({ status: "rejected", lastError: "La OT ya no admite pedidos de repuestos." })

    await freshDb()
    await seed(NOTE())
    const s422 = server({ note: () => json(422, { ok: false, code: "invalid", message: "Revisa las cantidades.", field: "lines" }) })
    expect((await sync(s422)).rejected).toBe(1)
    expect(await getQueueItem(NOTE().id)).toMatchObject({ status: "rejected", lastError: "Revisa las cantidades." })
    // Un rechazado no se reintenta solo.
    const again = server()
    expect((await sync(again, Date.now() + BACKOFF_CAP_MS + 1_000)).sent).toBe(0)
    expect(again.fetchImpl).not.toHaveBeenCalled()
  })

  it("un 403 (la cuenta no puede pedir) también se muestra rechazado con su motivo, no queda esperando en silencio", async () => {
    await seed(NOTE())
    const s = server({ note: () => json(403, { message: "No tienes permiso para pedir repuestos." }) })
    expect((await sync(s)).rejected).toBe(1)
    expect(await getQueueItem(NOTE().id)).toMatchObject({ status: "rejected", lastError: "No tienes permiso para pedir repuestos." })
  })

  it("401 pide entrar de nuevo y 503 reintenta", async () => {
    await seed(NOTE())
    const report = await sync(server({ note: () => json(401, { message: "vencida" }) }))
    expect(report.needsLogin).toEqual(["u-1"])
    expect((await getQueueItem(NOTE().id))?.status).toBe("needs_login")

    await freshDb()
    await seed(NOTE())
    expect((await sync(server({ note: () => json(503, { message: "caído" }) }))).retried).toBe(1)
    expect((await getQueueItem(NOTE().id))?.status).toBe("pending")
  })

  it("«Entendido» saca de la cola la nota rechazada", async () => {
    await seed(NOTE())
    await sync(server({ note: () => json(409, { ok: false, code: "rejected", message: "Ya no." }) }))
    await discardRejectedNote(NOTE().id)
    expect((await listQueue()).some((item) => item.type === "parts_note")).toBe(false)
  })
})

describe("orden: la nota de pedido antes que el registro de su OT", () => {
  beforeEach(freshDb)

  it("el registro enlazado espera a la nota anterior de la misma OT, y sale después", async () => {
    const note = partsNoteItem(1)
    const record = linkedRecord(3, "2026-10-28T15:03:00.000Z")
    await seed(note, record)
    const queue = await listQueue()
    expect(waitsForDependency(queue.find((item) => item.id === record.id)!, queue)).toBe(true)

    const s = server()
    await sync(s)
    expect(s.order).toEqual(["note"])
    await sync(s)
    expect(s.order).toEqual(["note", "record"])
  })

  it("si la nota falla y espera su reintento, el registro de esa OT no se le adelanta", async () => {
    await seed(partsNoteItem(1), linkedRecord(3, "2026-10-28T15:03:00.000Z"))
    const now = Date.now()
    const down = server({ note: () => json(503, { message: "caído" }) })
    await sync(down, now)
    expect(down.order).toEqual(["note"])
    const still = server()
    await sync(still, now + 1_000)
    expect(still.order).toEqual([])
  })

  it("no espera una nota de otra OT, ni una posterior, ni una rechazada", () => {
    const base = linkedRecord(3, "2026-10-28T15:03:00.000Z")
    const waits = (queue: QueueItem[]) => waitsForDependency(base, queue)
    expect(waits([partsNoteItem(1, { workOrderId: "ot-2" })])).toBe(false)
    expect(waits([partsNoteItem(5, { createdAt: "2026-10-28T15:05:00.000Z" })])).toBe(false)
    const rejected: QueuePartsNoteItem = { ...partsNoteItem(1), status: "rejected" }
    expect(waits([rejected])).toBe(false)
    const sent: QueuePartsNoteItem = { ...partsNoteItem(1), status: "sent" }
    expect(waits([sent])).toBe(false)
    // Un registro sin OT nunca espera notas.
    expect(waitsForDependency(linkedRecord(4, "2026-10-28T15:04:00.000Z", null), [partsNoteItem(1)])).toBe(false)
  })
})
