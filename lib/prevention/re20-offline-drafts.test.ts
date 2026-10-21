// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  deleteRe20OfflineDraft,
  getRe20OfflineDraft,
  lastRe20OfflineDraftOwner,
  listRe20OfflineDrafts,
  purgeRe20OfflineDrafts,
  putRe20OfflineDraft,
} from "./re20-offline-drafts"

const ANA = "user-ana"
const BETO = "user-beto"

function draft(id: string, extra: Record<string, unknown> = {}) {
  return { id, kind: "incident_report" as const, payload: { narrative: `relato ${id}`, ...extra }, attempts: 0 }
}

beforeEach(async () => {
  await purgeRe20OfflineDrafts()
})

describe("almacén de borradores RE-20 por usuario", () => {
  it("guarda, lee, lista y borra sin frase ni cifrado, cada cosa con su dueño", async () => {
    await putRe20OfflineDraft(ANA, draft("a-1"))
    await putRe20OfflineDraft(ANA, draft("a-2"))
    await putRe20OfflineDraft(BETO, draft("a-1", { de: "beto" }))

    expect(await getRe20OfflineDraft(ANA, "a-1")).toMatchObject({ id: "a-1", kind: "incident_report", payload: { narrative: "relato a-1" } })
    expect(await getRe20OfflineDraft(BETO, "a-1")).toMatchObject({ payload: { de: "beto" } })
    expect((await listRe20OfflineDrafts(ANA)).map((entry) => entry.id).sort()).toEqual(["a-1", "a-2"])
    expect((await listRe20OfflineDrafts(BETO)).map((entry) => entry.id)).toEqual(["a-1"])

    await deleteRe20OfflineDraft(ANA, "a-1")
    expect(await getRe20OfflineDraft(ANA, "a-1")).toBeNull()
    expect(await getRe20OfflineDraft(BETO, "a-1")).not.toBeNull()
  })

  it("una persona no lee ni borra lo de otra aunque conozca el id", async () => {
    await putRe20OfflineDraft(ANA, draft("privado"))
    expect(await getRe20OfflineDraft(BETO, "privado")).toBeNull()
    expect(await listRe20OfflineDrafts(BETO)).toEqual([])
    await deleteRe20OfflineDraft(BETO, "privado")
    expect(await getRe20OfflineDraft(ANA, "privado")).not.toBeNull()
  })

  it("al reescribir conserva la fecha de creación y avanza la de actualización", async () => {
    const first = await putRe20OfflineDraft(ANA, draft("a-1"))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await putRe20OfflineDraft(ANA, { ...draft("a-1"), attempts: 2, lastError: "Sin conexión" })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt > first.updatedAt).toBe(true)
    expect(await getRe20OfflineDraft(ANA, "a-1")).toMatchObject({ attempts: 2, lastError: "Sin conexión", createdAt: first.createdAt })
  })

  it("guarda el rechazo permanente de un reporte", async () => {
    await putRe20OfflineDraft(ANA, { ...draft("a-1"), lastError: "La faena no existe", rejected: true })
    expect(await getRe20OfflineDraft(ANA, "a-1")).toMatchObject({ rejected: true, lastError: "La faena no existe" })
  })

  it("`purgeRe20OfflineDrafts` vacía lo de todas las personas y dice cuántos había", async () => {
    await putRe20OfflineDraft(ANA, draft("a-1"))
    await putRe20OfflineDraft(BETO, draft("b-1"))
    expect(await purgeRe20OfflineDrafts()).toBe(2)
    expect(await listRe20OfflineDrafts(ANA)).toEqual([])
    expect(await listRe20OfflineDrafts(BETO)).toEqual([])
    expect(await lastRe20OfflineDraftOwner()).toBeNull()
  })

  it("el último dueño es de quien guardó lo más reciente", async () => {
    expect(await lastRe20OfflineDraftOwner()).toBeNull()
    await putRe20OfflineDraft(ANA, { ...draft("a-1"), updatedAt: "2026-10-20T10:00:00.000Z" })
    await putRe20OfflineDraft(BETO, { ...draft("b-1"), updatedAt: "2026-10-20T11:00:00.000Z" })
    expect(await lastRe20OfflineDraftOwner()).toBe(BETO)
    await putRe20OfflineDraft(ANA, { ...draft("a-2"), updatedAt: "2026-10-20T12:00:00.000Z" })
    expect(await lastRe20OfflineDraftOwner()).toBe(ANA)
  })

  it("al abrirse borra la base antigua de la bóveda cifrada con frase", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("chome-re20-encrypted-vault", 1)
      request.onupgradeneeded = () => { request.result.createObjectStore("encrypted-drafts", { keyPath: "id" }) }
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
    expect((await indexedDB.databases()).map((database) => database.name)).toContain("chome-re20-encrypted-vault")

    // Módulo nuevo: la limpieza corre una vez por carga de página.
    vi.resetModules()
    const fresh = await import("./re20-offline-drafts")
    await fresh.listRe20OfflineDrafts(ANA)

    await vi.waitFor(async () => {
      expect((await indexedDB.databases()).map((database) => database.name)).not.toContain("chome-re20-encrypted-vault")
    })
    expect((await indexedDB.databases()).map((database) => database.name)).toContain("chome-re20-offline-drafts")
  })
})
