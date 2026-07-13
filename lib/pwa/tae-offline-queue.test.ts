// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest"
import "fake-indexeddb/auto"
import {
  enqueueTaeSubmission,
  countPendingTaeSubmissions,
  updateTaeSubmission,
  deleteTaeSubmission,
  purgeSyncedTaeSubmissions,
  saveTaeIdentity,
  getTaeIdentity,
  SYNCED_RETENTION_MS,
} from "./tae-offline-queue"

const createdIds: string[] = []

async function enqueue(overrides: Partial<{ clientSubmissionId: string }> = {}) {
  const clientSubmissionId = overrides.clientSubmissionId ?? `tae-${Math.random().toString(36).slice(2)}`
  const item = await enqueueTaeSubmission("token-test", { clientSubmissionId, worksiteId: "ws-1" }, [])
  createdIds.push(item.id)
  return item
}

afterEach(async () => {
  await Promise.all(createdIds.splice(0).map((id) => deleteTaeSubmission(id)))
})

describe("tae-offline-queue", () => {
  it("enqueueTaeSubmission crea un pendiente", async () => {
    const item = await enqueue()
    expect(item.status).toBe("pending")
    expect(await countPendingTaeSubmissions()).toBeGreaterThanOrEqual(1)
  })

  describe("purgeSyncedTaeSubmissions", () => {
    it("borra una carga sincronizada hace más de 48h", async () => {
      const item = await enqueue()
      const staleSyncedAt = new Date(Date.now() - SYNCED_RETENTION_MS - 60_000).toISOString()
      await updateTaeSubmission(item.id, { status: "synced", syncedAt: staleSyncedAt })

      const purged = await purgeSyncedTaeSubmissions()
      expect(purged).toBe(1)
    })

    it("no toca una carga sincronizada hace menos de 48h", async () => {
      const item = await enqueue()
      const freshSyncedAt = new Date(Date.now() - 60_000).toISOString()
      await updateTaeSubmission(item.id, { status: "synced", syncedAt: freshSyncedAt })

      const purged = await purgeSyncedTaeSubmissions()
      expect(purged).toBe(0)
    })

    it("nunca borra un pendiente no confirmado, sin importar su antigüedad", async () => {
      await enqueue()
      // "pending" nunca debe purgarse aunque el reloj avance mucho — solo
      // "synced" con syncedAt vencido es candidato.
      const purged = await purgeSyncedTaeSubmissions(Date.now() + SYNCED_RETENTION_MS * 10)
      expect(purged).toBe(0)
      expect(await countPendingTaeSubmissions()).toBeGreaterThanOrEqual(1)
    })
  })

  describe("identidad verificada por RUT (cache offline)", () => {
    // Orden importa: "devuelve null" debe correr antes de que otro caso
    // escriba en la misma clave de settings ("identity:driver"), que no se
    // limpia en afterEach (solo se limpian los envíos creados en cada test).
    it("devuelve null cuando no hay identidad cacheada", async () => {
      expect(await getTaeIdentity("ws-empty", "driver")).toBeNull()
    })

    it("guarda y recupera la identidad del conductor y del supervisor por separado", async () => {
      await saveTaeIdentity("ws-1:point-1", "driver", { id: "wk-1", name: "Carlos N." })
      await saveTaeIdentity("ws-1:point-1", "supervisor", { id: "wk-2", name: "Luis R." })

      expect(await getTaeIdentity("ws-1:point-1", "driver")).toEqual({ id: "wk-1", name: "Carlos N." })
      expect(await getTaeIdentity("ws-1:point-1", "supervisor")).toEqual({ id: "wk-2", name: "Luis R." })
      expect(await getTaeIdentity("ws-2:point-2", "driver")).toBeNull()
    })
  })
})
