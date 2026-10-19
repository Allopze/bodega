// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  OfflineQueueFullError,
  clearInspectionSubmissionQueue,
  discardQueuedInspectionSubmission,
  flushInspectionSubmissionQueue,
  getQueuedInspectionSubmission,
  isInspectionSubmissionRejected,
  listQueuedInspectionSubmissions,
  queueInspectionSubmission,
  type InspectionSubmissionSendResult,
  type OfflineInspectionSubmission,
} from "./offline-inspection-queue"

const MAX_RETRIES = 8

function submission(runId: string, overrides: Partial<OfflineInspectionSubmission> = {}): OfflineInspectionSubmission {
  return { runId, expectedVersion: 3, answers: [], ...overrides }
}

const versionConflict: InspectionSubmissionSendResult = {
  ok: false,
  message: "La inspección cambió en otra sesión. Recarga la página.",
  data: { code: "version_conflict" },
}

beforeEach(async () => {
  await clearInspectionSubmissionQueue()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("cola offline de cierres de inspección: resultado del flush", () => {
  it("entrega, borra y devuelve el resultado con todos sus campos", async () => {
    await queueInspectionSubmission(submission("run-1"))
    const sender = vi.fn(async () => ({ ok: true }))

    expect(await flushInspectionSubmissionQueue(sender)).toEqual({
      synchronized: 1, pending: 0, rejected: 0, dead: 0, rejectedRunIds: [],
    })
    expect(sender).toHaveBeenCalledTimes(1)
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("un rechazo con código se quema de golpe, con su mensaje y su código", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => versionConflict)

    expect(result).toEqual({ synchronized: 0, pending: 0, rejected: 1, dead: 0, rejectedRunIds: ["run-1"] })
    const entry = await getQueuedInspectionSubmission("run-1")
    expect(entry).toMatchObject({
      attempts: MAX_RETRIES,
      lastError: versionConflict.message,
      lastCode: "version_conflict",
    })
    expect(isInspectionSubmissionRejected(entry!)).toBe(true)
  })

  it("el código también se lee de `code`, sin pasar por `data`", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Ya no se puede editar", code: "not_editable" }))

    expect(result.rejected).toBe(1)
    expect(await getQueuedInspectionSubmission("run-1")).toMatchObject({ attempts: MAX_RETRIES, lastCode: "not_editable" })
  })

  /*
   * Regresión de P1-5: las entradas ya quemadas se sumaban otra vez a
   * `rejected` en cada pasada, así que un cierre ya descartado seguía diciendo
   * «1 pendiente» y «Sincronizar» no hacía nada visible.
   */
  it("una entrada ya quemada se cuenta en `dead`, no se reenvía y no vuelve a contar como rechazo", async () => {
    await queueInspectionSubmission(submission("run-1"))
    await flushInspectionSubmissionQueue(async () => versionConflict)
    const sender = vi.fn(async () => ({ ok: true }))

    const second = await flushInspectionSubmissionQueue(sender)

    expect(second).toEqual({ synchronized: 0, pending: 0, rejected: 0, dead: 1, rejectedRunIds: [] })
    expect(sender).not.toHaveBeenCalled()
    // Sigue en la cola: es lo que quien ejecutó tiene que recuperar o descartar.
    expect(await getQueuedInspectionSubmission("run-1")).not.toBeNull()
  })

  it("un código desconocido no quema: sigue siendo reintentable", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Algo raro", data: { code: "codigo_inventado" } }))

    expect(result).toEqual({ synchronized: 0, pending: 1, rejected: 0, dead: 0, rejectedRunIds: [] })
    expect(await getQueuedInspectionSubmission("run-1")).toMatchObject({ attempts: 1, lastError: "Algo raro" })
  })

  it("un `ok:false` sin código suma un intento y queda pendiente", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Error del servidor" }))

    expect(result.pending).toBe(1)
    expect(result.rejected).toBe(0)
    const entry = await getQueuedInspectionSubmission("run-1")
    expect(entry).toMatchObject({ attempts: 1, lastError: "Error del servidor" })
    expect(entry?.lastCode).toBeUndefined()
    expect(isInspectionSubmissionRejected(entry!)).toBe(false)
  })

  it("`retriable: false` sigue quemando aunque no traiga código (compatibilidad)", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "No", retriable: false }))

    expect(result).toMatchObject({ rejected: 1, rejectedRunIds: ["run-1"] })
  })

  it("una excepción del sender es un fallo de red reintentable", async () => {
    await queueInspectionSubmission(submission("run-1"))

    const result = await flushInspectionSubmissionQueue(async () => { throw new Error("socket hang up") })

    expect(result).toMatchObject({ pending: 1, rejected: 0 })
    expect(await getQueuedInspectionSubmission("run-1")).toMatchObject({ attempts: 1, lastError: "socket hang up" })
  })

  it("un TypeError de red deja un motivo en español, no el del navegador", async () => {
    await queueInspectionSubmission(submission("run-1"))

    await flushInspectionSubmissionQueue(async () => { throw new TypeError("Failed to fetch") })

    expect((await getQueuedInspectionSubmission("run-1"))?.lastError).toBe("Sin conexión con el servidor")
  })

  it("agota los reintentos: pendiente hasta el último, y el que lo quema lo cuenta como rechazado", async () => {
    await queueInspectionSubmission(submission("run-1"))
    const failing = async () => ({ ok: false, message: "Sigue fallando" })

    for (let attempt = 1; attempt < MAX_RETRIES; attempt++) {
      expect(await flushInspectionSubmissionQueue(failing)).toMatchObject({ pending: 1, rejected: 0, dead: 0 })
    }
    const last = await flushInspectionSubmissionQueue(failing)

    expect(last).toEqual({ synchronized: 0, pending: 0, rejected: 1, dead: 0, rejectedRunIds: ["run-1"] })
    expect(await flushInspectionSubmissionQueue(failing)).toMatchObject({ rejected: 0, dead: 1 })
  })

  it("mezcla entregas, pendientes y quemadas en una sola pasada", async () => {
    for (const id of ["ok", "red", "conflicto"]) await queueInspectionSubmission(submission(id))

    const result = await flushInspectionSubmissionQueue(async (payload) => {
      if (payload.runId === "ok") return { ok: true }
      if (payload.runId === "red") throw new Error("sin red")
      return versionConflict
    })

    expect(result).toEqual({ synchronized: 1, pending: 1, rejected: 1, dead: 0, rejectedRunIds: ["conflicto"] })
    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()).toEqual(["conflicto", "red"])
  })
})

describe("cola offline de cierres de inspección: una entrada por inspección", () => {
  it("la busca por runId y devuelve null si no hay", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 5 }))
    await queueInspectionSubmission(submission("run-2"))

    expect((await getQueuedInspectionSubmission("run-1"))?.payload).toMatchObject({ runId: "run-1", expectedVersion: 5 })
    expect(await getQueuedInspectionSubmission("run-9")).toBeNull()
  })

  it("descartar borra sólo esa entrada y avisa si no había nada", async () => {
    await queueInspectionSubmission(submission("run-1"))
    await queueInspectionSubmission(submission("run-2"))

    expect(await discardQueuedInspectionSubmission("run-1")).toBe(true)
    expect(await discardQueuedInspectionSubmission("run-1")).toBe(false)
    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["run-2"])
  })

  it("reencolar una entrada quemada la reemplaza y la deja lista para reenviar", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 3 }))
    await flushInspectionSubmissionQueue(async () => versionConflict)

    await queueInspectionSubmission(submission("run-1", { expectedVersion: 4 }))

    const entry = await getQueuedInspectionSubmission("run-1")
    expect(entry).toMatchObject({ attempts: 0, payload: { expectedVersion: 4 } })
    expect(entry?.lastCode).toBeUndefined()
    expect(entry?.lastError).toBeUndefined()
    expect(await listQueuedInspectionSubmissions()).toHaveLength(1)
  })

  it("encolar otra inspección no borra en silencio un cierre rechazado", async () => {
    await queueInspectionSubmission(submission("run-1"))
    await flushInspectionSubmissionQueue(async () => versionConflict)

    await queueInspectionSubmission(submission("run-2"))

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()).toEqual(["run-1", "run-2"])
  })

  it("con la cola llena desaloja primero al cierre rechazado más viejo", async () => {
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`run-${index}`))
    await flushInspectionSubmissionQueue(async (payload) => (payload.runId === "run-2" ? versionConflict : { ok: false }))

    await queueInspectionSubmission(submission("run-6"))

    const ids = (await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()
    expect(ids).toEqual(["run-1", "run-3", "run-4", "run-5", "run-6"])
  })

  it("con la cola llena de pendientes vivos se niega, con el aviso de cola llena", async () => {
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`run-${index}`))

    await expect(queueInspectionSubmission(submission("run-6"))).rejects.toBeInstanceOf(OfflineQueueFullError)
    await expect(queueInspectionSubmission(submission("run-6"))).rejects.toThrow(/llena/i)
    expect(await listQueuedInspectionSubmissions()).toHaveLength(5)
    // Reencolar una de las que ya están no suma otra: se permite.
    await expect(queueInspectionSubmission(submission("run-3", { expectedVersion: 9 }))).resolves.toBeDefined()
  })

  it("purga por edad las entradas de más de 30 días al encolar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"))
    await queueInspectionSubmission(submission("run-viejo"))
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"))

    await queueInspectionSubmission(submission("run-nuevo"))

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["run-nuevo"])
  })
})

describe("cola offline de cierres de inspección: concurrencia", () => {
  it("dos flush simultáneos se encadenan y la entrada se envía una sola vez", async () => {
    await queueInspectionSubmission(submission("run-1"))
    let inFlight = 0
    let maxInFlight = 0
    const sender = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight--
      return { ok: true }
    })

    const [first, second] = await Promise.all([
      flushInspectionSubmissionQueue(sender),
      flushInspectionSubmissionQueue(sender),
    ])

    expect(maxInFlight).toBe(1)
    expect(sender).toHaveBeenCalledTimes(1)
    expect(first.synchronized + second.synchronized).toBe(1)
  })

  it("tres flush simultáneos tampoco se pisan (el candado anterior liberaba a dos juntos)", async () => {
    for (const id of ["a", "b"]) await queueInspectionSubmission(submission(id))
    let inFlight = 0
    let maxInFlight = 0
    const sender = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return { ok: true }
    }

    await Promise.all([1, 2, 3].map(() => flushInspectionSubmissionQueue(sender)))

    expect(maxInFlight).toBe(1)
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("un fallo no resucita una entrada que otra pestaña ya entregó", async () => {
    await queueInspectionSubmission(submission("run-1"))

    await flushInspectionSubmissionQueue(async () => {
      // Mientras este envío está en vuelo, otra pestaña lo entrega y lo borra.
      await discardQueuedInspectionSubmission("run-1")
      return versionConflict
    })

    expect(await getQueuedInspectionSubmission("run-1")).toBeNull()
  })

  it("un fallo del envío anterior no quema el cierre que se reencoló mientras tanto", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 3 }))

    const result = await flushInspectionSubmissionQueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await queueInspectionSubmission(submission("run-1", { expectedVersion: 4 }))
      return versionConflict
    })

    expect(result).toMatchObject({ rejected: 0, pending: 0 })
    expect(await getQueuedInspectionSubmission("run-1")).toMatchObject({ attempts: 0, payload: { expectedVersion: 4 } })
  })
})
