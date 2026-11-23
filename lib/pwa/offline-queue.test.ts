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
  purgeExpiredPpas,
  requeueNetworkFailedPpas,
  countUnsentPpas,
  MAX_PPA_AGE_DAYS,
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
      expect(item.payload).toEqual({ test: "data", clientSubmissionId: item.id, filledAt: expect.any(String) })

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
      expect(found!.payload).toEqual({ id: "test", clientSubmissionId: item.id, filledAt: expect.any(String) })
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
      expect(updated!.payload).toEqual({ orig: true, clientSubmissionId: item.id, filledAt: expect.any(String) })
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

/**
 * Una evaluación de terreno que no salió es la prueba de que se hizo: el borrado
 * por edad tocaba también los `pending` y `failed` de más de 30 días, y un
 * teléfono un mes sin señal perdía todo sin dejar rastro. Caducan sólo lo enviado
 * y lo que el servidor rechazó (no hay nada que reintentar y lleva nombre y RUT).
 */
describe("purgeExpiredPpas", () => {
  /** `enqueuePpa` estampa «ahora»; para envejecer un ítem se reescribe su `createdAt` directo en IndexedDB. */
  async function backdate(id: string, days: number) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("ppa-offline", 1)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("submissions", "readwrite")
      const store = tx.objectStore("submissions")
      const get = store.get(id)
      get.onsuccess = () => {
        const createdAt = new Date(Date.now() - days * 86_400_000).toISOString()
        store.put({ ...get.result, createdAt })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  it("un PPA sin enviar de 40 días no se borra: pendiente, en vuelo ni rendido por red", async () => {
    const pending = await enqueuePpa({ a: 1 })
    const syncing = await enqueuePpa({ a: 2 })
    const network = await enqueuePpa({ a: 3 })
    const legacyNetwork = await enqueuePpa({ a: 4 })
    await updatePpaStatus(syncing.id, { status: "syncing" })
    await updatePpaStatus(network.id, { status: "failed", failureKind: "network", lastError: "Sin conexión" })
    // Guardado antes de `failureKind`: «Sin conexión» lo delata como falta de red.
    await updatePpaStatus(legacyNetwork.id, { status: "failed", lastError: "Sin conexión" })
    for (const item of [pending, syncing, network, legacyNetwork]) await backdate(item.id, 40)

    expect(await purgeExpiredPpas()).toBe(0)
    for (const item of [pending, syncing, network, legacyNetwork]) expect(await getPpaById(item.id)).toBeDefined()
  })

  it("un rechazado por el servidor de 40 días sí se borra (lleva nombre y RUT); uno reciente no", async () => {
    const old = await enqueuePpa({ a: 1 })
    const oldLegacy = await enqueuePpa({ a: 2 })
    const recent = await enqueuePpa({ a: 3 })
    await updatePpaStatus(old.id, { status: "failed", failureKind: "rejected", lastError: "motivo" })
    // Sin `failureKind` y con un error que no es de red: se infiere rechazo.
    await updatePpaStatus(oldLegacy.id, { status: "failed", lastError: "RUT inválido" })
    await updatePpaStatus(recent.id, { status: "failed", failureKind: "rejected", lastError: "motivo" })
    await backdate(old.id, MAX_PPA_AGE_DAYS + 10)
    await backdate(oldLegacy.id, MAX_PPA_AGE_DAYS + 10)

    expect(await purgeExpiredPpas()).toBe(2)
    expect(await getPpaById(old.id)).toBeUndefined()
    expect(await getPpaById(oldLegacy.id)).toBeUndefined()
    expect(await getPpaById(recent.id)).toBeDefined()
  })

  it("uno enviado de 40 días sí", async () => {
    const synced = await enqueuePpa({ a: 1 })
    await updatePpaStatus(synced.id, { status: "synced" })
    await backdate(synced.id, MAX_PPA_AGE_DAYS + 10)

    expect(await purgeExpiredPpas()).toBe(1)
    expect(await getPpaById(synced.id)).toBeUndefined()
  })

  it("uno enviado hace poco se queda", async () => {
    const synced = await enqueuePpa({ a: 1 })
    await updatePpaStatus(synced.id, { status: "synced" })
    expect(await purgeExpiredPpas()).toBe(0)
    expect(await getPpaById(synced.id)).toBeDefined()
  })
})

describe("requeueNetworkFailedPpas / countUnsentPpas", () => {
  it("devuelve a la fila lo rendido por red, con intentos en cero y conservando el error", async () => {
    const network = await enqueuePpa({ a: 1 })
    const legacy = await enqueuePpa({ a: 2 })
    const rejected = await enqueuePpa({ a: 3 })
    const synced = await enqueuePpa({ a: 4 })
    await updatePpaStatus(network.id, { status: "failed", failureKind: "network", attempts: 3, lastError: "Sin conexión" })
    await updatePpaStatus(legacy.id, { status: "failed", attempts: 3, lastError: "Sin conexión" })
    await updatePpaStatus(rejected.id, { status: "failed", failureKind: "rejected", attempts: 3, lastError: "Faena no permitida" })
    await updatePpaStatus(synced.id, { status: "synced" })

    expect(await requeueNetworkFailedPpas()).toBe(2)
    for (const id of [network.id, legacy.id]) {
      const saved = await getPpaById(id)
      expect(saved).toMatchObject({ status: "pending", attempts: 0, lastError: "Sin conexión" })
      expect(saved?.failureKind).toBeUndefined()
    }
    expect(await getPpaById(rejected.id)).toMatchObject({ status: "failed", failureKind: "rejected", attempts: 3 })
    expect(await getPpaById(synced.id)).toMatchObject({ status: "synced" })
    expect(await countPendingPpas()).toBe(2)
    // Idempotente.
    expect(await requeueNetworkFailedPpas()).toBe(0)
  })

  it("countUnsentPpas = pendientes + en vuelo + rendidos por red; no cuenta rechazados ni enviados", async () => {
    const [a, b, c, d, e] = [
      await enqueuePpa({ a: 1 }), await enqueuePpa({ a: 2 }), await enqueuePpa({ a: 3 }),
      await enqueuePpa({ a: 4 }), await enqueuePpa({ a: 5 }),
    ]
    void a
    await updatePpaStatus(b.id, { status: "syncing" })
    await updatePpaStatus(c.id, { status: "failed", failureKind: "network" })
    await updatePpaStatus(d.id, { status: "failed", failureKind: "rejected" })
    await updatePpaStatus(e.id, { status: "synced" })
    expect(await countUnsentPpas()).toBe(3)
    expect(await countPendingPpas()).toBe(1)
  })
})

/**
 * PPA-003. `createPpaSubmissionId` es la clave de idempotencia del envío y, por
 * derivación HMAC, la del enlace público al resultado: reenviar con una clave
 * existente devuelve la fila y el enlace originales. La ruta de respaldo
 * —navegador sin `crypto.randomUUID`, es decir contexto no seguro o navegador
 * antiguo— la armaba con `ppa-<Date.now()>-<8 caracteres de Math.random>`, un
 * PRNG no criptográfico sobre un prefijo de reloj sin azar alguno.
 */
describe("createPpaSubmissionId (PPA-003)", () => {
  const originalCrypto = globalThis.crypto
  const originalRandom = Math.random

  /** Deja un `crypto` sin `randomUUID`: fuerza la ruta de respaldo. */
  function useLegacyCrypto(): { calls: number } {
    const counter = { calls: 0 }
    const source = originalCrypto
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (array: Uint8Array) => {
          counter.calls++
          return source.getRandomValues(array)
        },
      },
    })
    return counter
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto })
    Math.random = originalRandom
  })

  it("la ruta preferente sigue usando crypto.randomUUID", async () => {
    const { createPpaSubmissionId } = await import("./offline-queue")
    expect(createPpaSubmissionId()).toMatch(
      /^ppa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it("sin randomUUID el respaldo toma la entropía de crypto.getRandomValues, no de Math.random", async () => {
    const { createPpaSubmissionId } = await import("./offline-queue")
    const counter = useLegacyCrypto()
    // Con Math.random congelado, la versión anterior producía siempre el mismo
    // sufijo y, dentro del mismo milisegundo, la MISMA clave para dos envíos.
    Math.random = () => 0.5

    const first = createPpaSubmissionId()
    const second = createPpaSubmissionId()

    expect(counter.calls).toBeGreaterThan(0)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^ppa-[A-Za-z0-9_-]{24}$/)
    // El reloj no aporta azar: la clave no puede llevarlo incrustado.
    expect(first).not.toContain(String(Date.now()).slice(0, 8))
  })

  it("sin Web Crypto falla en vez de degradar a una clave adivinable", async () => {
    const { createPpaSubmissionId } = await import("./offline-queue")
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined })
    expect(() => createPpaSubmissionId()).toThrow(/Web Crypto/)
  })
})
