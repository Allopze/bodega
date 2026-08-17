// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import "fake-indexeddb/auto"
import {
  enqueuePpa,
  getPendingPpas,
  getPpaById,
  updatePpaStatus,
  deletePpa,
  countPendingPpas,
  getAllPpas,
  recoverStalePpas,
} from "./offline-queue"

beforeEach(async () => {
  const all = await getAllPpas()
  await Promise.all(all.map((item) => deletePpa(item.id)))
})

afterEach(async () => {
  const all = await getAllPpas()
  await Promise.all(all.map((item) => deletePpa(item.id)))
})

describe("offline-queue", () => {
  describe("enqueuePpa", () => {
    it("adds a pending PPA to the queue", async () => {
      const item = await enqueuePpa({ test: "data" })
      expect(item.status).toBe("pending")
      expect(item.attempts).toBe(0)
      // enqueuePpa inyecta la clave de idempotencia si el payload no la trae.
      expect(item.payload).toEqual({ test: "data", clientSubmissionId: item.id })

      const count = await countPendingPpas()
      expect(count).toBe(1)
    })
  })

  describe("getPendingPpas", () => {
    it("returns all pending items", async () => {
      await enqueuePpa({ a: 1 })
      await enqueuePpa({ b: 2 })

      const pending = await getPendingPpas()
      expect(pending).toHaveLength(2)
    })

    it("excludes synced and failed items", async () => {
      const item = await enqueuePpa({ x: 1 })
      await updatePpaStatus(item.id, { status: "synced" })

      const pending = await getPendingPpas()
      expect(pending).toHaveLength(0)
    })
  })

  describe("getPpaById", () => {
    it("retrieves an item by ID", async () => {
      const item = await enqueuePpa({ id: "test" })
      const found = await getPpaById(item.id)
      expect(found).toBeDefined()
      expect(found!.payload).toEqual({ id: "test", clientSubmissionId: item.id })
    })

    it("returns undefined for unknown ID", async () => {
      const found = await getPpaById("nonexistent")
      expect(found).toBeUndefined()
    })
  })

  describe("updatePpaStatus", () => {
    it("updates status, attempts, lastError, and token", async () => {
      const item = await enqueuePpa({})
      await updatePpaStatus(item.id, {
        status: "syncing",
        attempts: 2,
        lastError: "timeout",
        token: "tok-123",
      })

      const updated = await getPpaById(item.id)
      expect(updated!.status).toBe("syncing")
      expect(updated!.attempts).toBe(2)
      expect(updated!.lastError).toBe("timeout")
      expect(updated!.token).toBe("tok-123")
    })

    it("preserves existing fields on partial update", async () => {
      const item = await enqueuePpa({ orig: true })
      await updatePpaStatus(item.id, { status: "syncing" })

      const updated = await getPpaById(item.id)
      expect(updated!.status).toBe("syncing")
      expect(updated!.payload).toEqual({ orig: true, clientSubmissionId: item.id })
      expect(updated!.attempts).toBe(0)
    })

    it("does not throw for unknown ID", async () => {
      await expect(updatePpaStatus("unknown", { status: "synced" })).resolves.toBeUndefined()
    })
  })

  describe("deletePpa", () => {
    it("deletes an item", async () => {
      const item = await enqueuePpa({})
      await deletePpa(item.id)

      const found = await getPpaById(item.id)
      expect(found).toBeUndefined()
      expect(await countPendingPpas()).toBe(0)
    })
  })

  describe("countPendingPpas", () => {
    it("returns zero with no items", async () => {
      expect(await countPendingPpas()).toBe(0)
    })

    it("counts only pending items", async () => {
      await enqueuePpa({})
      const b = await enqueuePpa({})
      await updatePpaStatus(b.id, { status: "synced" })

      expect(await countPendingPpas()).toBe(1)
    })
  })

  describe("getAllPpas", () => {
    it("returns all items regardless of status", async () => {
      const a = await enqueuePpa({ a: 1 })
      await updatePpaStatus(a.id, { status: "synced" })

      const all = await getAllPpas()
      expect(all).toHaveLength(1)
      expect(all[0]!.status).toBe("synced")
    })
  })

  describe("clave de idempotencia", () => {
    it("adopta el clientSubmissionId del payload como id de la entrada", async () => {
      const item = await enqueuePpa({ clientSubmissionId: "ppa-abc-123", worksiteId: "ws-1" })
      expect(item.id).toBe("ppa-abc-123")
    })

    it("reencolar el mismo envío no crea una segunda entrada", async () => {
      const payload = { clientSubmissionId: "ppa-abc-123", worksiteId: "ws-1" }
      await enqueuePpa(payload)
      await enqueuePpa(payload)

      expect(await getAllPpas()).toHaveLength(1)
      expect(await countPendingPpas()).toBe(1)
    })

    it("genera y persiste una clave cuando el payload no la trae", async () => {
      const item = await enqueuePpa({ worksiteId: "ws-1" })
      expect(item.payload.clientSubmissionId).toBe(item.id)
    })
  })

  describe("recoverStalePpas", () => {
    it("devuelve a pending un envío que quedó en syncing y lo deja re-entregable", async () => {
      const item = await enqueuePpa({ worksiteId: "ws-1" })
      await updatePpaStatus(item.id, { status: "syncing", attempts: 1 })
      // Mientras está en "syncing" no lo ve nadie: getPendingPpas sólo lee "pending".
      expect(await countPendingPpas()).toBe(0)
      expect(await getPendingPpas()).toHaveLength(0)

      // Diez minutos después nadie confirmó la sincronización.
      const recovered = await recoverStalePpas(Date.now() + 10 * 60 * 1000)
      expect(recovered).toBe(1)

      const pending = await getPendingPpas()
      expect(pending).toHaveLength(1)
      expect(pending[0]!.id).toBe(item.id)
      expect(pending[0]!.attempts).toBe(1)
      // Se re-entrega con la MISMA clave: el servidor recupera la fila original
      // en vez de crear un segundo PPA (ver prevention-ppa-workflow-persistence).
      expect(pending[0]!.payload.clientSubmissionId).toBe(item.id)
    })

    it("no interrumpe un envío que acaba de empezar a sincronizar", async () => {
      const item = await enqueuePpa({ worksiteId: "ws-1" })
      await updatePpaStatus(item.id, { status: "syncing" })

      expect(await recoverStalePpas()).toBe(0)
      expect(await countPendingPpas()).toBe(0)
    })
  })
})
