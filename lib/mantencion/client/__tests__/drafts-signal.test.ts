import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { commitRecord } from "../queue"
import { STORE, idbGetAll } from "../db"
import { createDraftSaver, discardDraft, listDrafts, loadDraft, referencedPhotoIds, releasePhoto, saveDraft } from "../drafts"
import { newDraft } from "../flow-types"
import { collectOrphanPhotos, getPhoto, ORPHAN_PHOTO_MS, putPhoto } from "../photo-store"
import { UUID, freshDb, photo, recordItem } from "./fixtures"

const draftWith = (userId: string, kind: "P" | "C", photos: string[] = []) => ({ ...newDraft({ userId, kind, vehicleId: "veh-1" }), photos: { filtros: photos[0] ?? null, sticker: photos[1] ?? null, correctiva: [] } })

describe("borradores", () => {
  beforeEach(freshDb)

  it("uno por cuenta y tipo: guardar de nuevo reemplaza, y se recupera para seguir", async () => {
    await saveDraft({ ...draftWith("u-1", "P"), readingText: "40312" })
    await saveDraft({ ...draftWith("u-1", "P"), readingText: "40500" })
    await saveDraft(draftWith("u-1", "C"))
    await saveDraft(draftWith("u-2", "P"))
    expect((await loadDraft("u-1", "P"))?.readingText).toBe("40500")
    expect((await listDrafts("u-1")).map((draft) => draft.kind).sort()).toEqual(["C", "P"])
    expect(await listDrafts("u-2")).toHaveLength(1)
  })

  it("el guardado automático junta los cambios seguidos en una sola escritura", async () => {
    // Con reloj real: los temporizadores falsos dejan colgado a IndexedDB (usa los mismos).
    const saver = createDraftSaver({ delayMs: 250, onError: vi.fn() })
    saver.schedule({ ...draftWith("u-1", "P"), readingText: "1" })
    saver.schedule({ ...draftWith("u-1", "P"), readingText: "12" })
    saver.schedule({ ...draftWith("u-1", "P"), readingText: "123" })
    expect(await loadDraft("u-1", "P")).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect((await loadDraft("u-1", "P"))?.readingText).toBe("123")
  })

  it("flush guarda ya lo pendiente y cancel lo suelta", async () => {
    const saver = createDraftSaver({ delayMs: 60_000, onError: vi.fn() })
    saver.schedule({ ...draftWith("u-1", "P"), readingText: "777" })
    await saver.flush()
    expect((await loadDraft("u-1", "P"))?.readingText).toBe("777")
    saver.schedule({ ...draftWith("u-1", "C"), description: "no debe guardarse" })
    saver.cancel()
    await saver.flush()
    expect(await loadDraft("u-1", "C")).toBeNull()
  })

  it("si no hay espacio avisa del error en vez de tragarlo", async () => {
    const onError = vi.fn()
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("sin espacio", "QuotaExceededError") })
    const saver = createDraftSaver({ delayMs: 1, onError })
    saver.schedule(draftWith("u-1", "P"))
    await saver.flush()
    spy.mockRestore()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/no tiene espacio/)
  })

  it("descartar el borrador borra sus fotos, menos las que un envío todavía necesita", async () => {
    await putPhoto(photo(UUID(11)))
    await putPhoto(photo(UUID(12)))
    await putPhoto(photo(UUID(13)))
    // La 11 y la 12 son de un registro rechazado que se está corrigiendo; la 13 sólo del borrador.
    await commitRecord(recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), { draftKey: "otro" })
    const draft = { ...draftWith("u-1", "P", [UUID(11), UUID(13)]) }
    await saveDraft(draft)
    await discardDraft(draft)
    expect(await loadDraft("u-1", "P")).toBeNull()
    expect(await getPhoto(UUID(11))).not.toBeNull()
    expect(await getPhoto(UUID(13))).toBeNull()
  })

  it("quitar o repetir una foto nunca borra la que un envío necesita", async () => {
    await putPhoto(photo(UUID(11)))
    await putPhoto(photo(UUID(14)))
    await commitRecord(recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), { draftKey: "otro" })
    await releasePhoto(UUID(11))
    await releasePhoto(UUID(14))
    expect(await getPhoto(UUID(11))).not.toBeNull()
    expect(await getPhoto(UUID(14))).toBeNull()
  })

  it("firmar saca el borrador y entra el registro a la cola en una sola transacción", async () => {
    await saveDraft(draftWith("u-1", "P", [UUID(11), UUID(12)]))
    await commitRecord(recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), { draftKey: "u-1:P" })
    expect(await loadDraft("u-1", "P")).toBeNull()
    expect(await idbGetAll(STORE.queue)).toHaveLength(1)
  })

  it("corregir un rechazado: al firmar, el rechazado sale de la cola y entra el nuevo", async () => {
    await commitRecord({ ...recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), status: "rejected" }, { draftKey: "x" })
    await commitRecord(recordItem(UUID(2), "u-1", [UUID(11), UUID(12)]), { draftKey: "u-1:P", replaceQueueId: UUID(1) })
    const queue = await idbGetAll<{ id: string }>(STORE.queue)
    expect(queue.map((item) => item.id)).toEqual([UUID(2)])
  })

  it("la limpieza de fotos huérfanas respeta lo que algo referencia y lo reciente", async () => {
    const old = new Date(Date.now() - ORPHAN_PHOTO_MS - 60_000).toISOString()
    await putPhoto(photo(UUID(21), "u-1", { createdAt: old }))
    await putPhoto(photo(UUID(22), "u-1", { createdAt: old }))
    await putPhoto(photo(UUID(23), "u-1", { createdAt: new Date().toISOString() }))
    await saveDraft(draftWith("u-1", "P", [UUID(22)]))
    await collectOrphanPhotos(await referencedPhotoIds(["u-1"]))
    expect(await getPhoto(UUID(21))).toBeNull()
    expect(await getPhoto(UUID(22))).not.toBeNull()
    expect(await getPhoto(UUID(23))).not.toBeNull()
  })
})
