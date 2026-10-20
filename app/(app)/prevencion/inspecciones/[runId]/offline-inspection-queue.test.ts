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
  purgeInspectionSubmissionsOfOthers,
  queueInspectionSubmission,
  type InspectionSubmissionSendResult,
  type OfflineInspectionSubmission,
} from "./offline-inspection-queue"

const MAX_RETRIES = 8
const USER = "user-1"

function submission(runId: string, overrides: Partial<OfflineInspectionSubmission> = {}): OfflineInspectionSubmission {
  return { runId, expectedVersion: 3, answers: [], ...overrides }
}

/** Siembra una entrada tal cual, sin pasar por `queueInspectionSubmission` (que ya barre lo ajeno al encolar). */
async function sembrarCrudo(entry: { id: string; userId?: string; payload: OfflineInspectionSubmission }) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("chome-prevention-offline", 2)
    request.onupgradeneeded = () => {
      const created = request.result
      if (!created.objectStoreNames.contains("incident-reports")) created.createObjectStore("incident-reports", { keyPath: "id" })
      if (!created.objectStoreNames.contains("inspection-submissions")) created.createObjectStore("inspection-submissions", { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("inspection-submissions", "readwrite")
    tx.objectStore("inspection-submissions").put({ queuedAt: new Date().toISOString(), attempts: 0, ...entry })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  database.close()
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
    await queueInspectionSubmission(submission("run-1"), USER)
    const sender = vi.fn(async () => ({ ok: true }))

    expect(await flushInspectionSubmissionQueue(sender, USER)).toEqual({
      synchronized: 1, pending: 0, rejected: 0, dead: 0, rejectedRunIds: [],
    })
    expect(sender).toHaveBeenCalledTimes(1)
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("un rechazo con código se quema de golpe, con su mensaje y su código", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => versionConflict, USER)

    expect(result).toEqual({ synchronized: 0, pending: 0, rejected: 1, dead: 0, rejectedRunIds: ["run-1"] })
    const entry = await getQueuedInspectionSubmission("run-1", USER)
    expect(entry).toMatchObject({
      attempts: MAX_RETRIES,
      lastError: versionConflict.message,
      lastCode: "version_conflict",
    })
    expect(isInspectionSubmissionRejected(entry!)).toBe(true)
  })

  it("el código también se lee de `code`, sin pasar por `data`", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Ya no se puede editar", code: "not_editable" }), USER)

    expect(result.rejected).toBe(1)
    expect(await getQueuedInspectionSubmission("run-1", USER)).toMatchObject({ attempts: MAX_RETRIES, lastCode: "not_editable" })
  })

  /*
   * Regresión de P1-5: las entradas ya quemadas se sumaban otra vez a
   * `rejected` en cada pasada, así que un cierre ya descartado seguía diciendo
   * «1 pendiente» y «Sincronizar» no hacía nada visible.
   */
  it("una entrada ya quemada se cuenta en `dead`, no se reenvía y no vuelve a contar como rechazo", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
    await flushInspectionSubmissionQueue(async () => versionConflict, USER)
    const sender = vi.fn(async () => ({ ok: true }))

    const second = await flushInspectionSubmissionQueue(sender, USER)

    expect(second).toEqual({ synchronized: 0, pending: 0, rejected: 0, dead: 1, rejectedRunIds: [] })
    expect(sender).not.toHaveBeenCalled()
    // Sigue en la cola: es lo que quien ejecutó tiene que recuperar o descartar.
    expect(await getQueuedInspectionSubmission("run-1", USER)).not.toBeNull()
  })

  it("un código desconocido no quema: sigue siendo reintentable", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Algo raro", data: { code: "codigo_inventado" } }), USER)

    expect(result).toEqual({ synchronized: 0, pending: 1, rejected: 0, dead: 0, rejectedRunIds: [] })
    expect(await getQueuedInspectionSubmission("run-1", USER)).toMatchObject({ attempts: 1, lastError: "Algo raro" })
  })

  it("un `ok:false` sin código suma un intento y queda pendiente", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "Error del servidor" }), USER)

    expect(result.pending).toBe(1)
    expect(result.rejected).toBe(0)
    const entry = await getQueuedInspectionSubmission("run-1", USER)
    expect(entry).toMatchObject({ attempts: 1, lastError: "Error del servidor" })
    expect(entry?.lastCode).toBeUndefined()
    expect(isInspectionSubmissionRejected(entry!)).toBe(false)
  })

  it("`retriable: false` sigue quemando aunque no traiga código (compatibilidad)", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => ({ ok: false, message: "No", retriable: false }), USER)

    expect(result).toMatchObject({ rejected: 1, rejectedRunIds: ["run-1"] })
  })

  it("una excepción del sender es un fallo de red reintentable", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    const result = await flushInspectionSubmissionQueue(async () => { throw new Error("socket hang up") }, USER)

    expect(result).toMatchObject({ pending: 1, rejected: 0 })
    expect(await getQueuedInspectionSubmission("run-1", USER)).toMatchObject({ attempts: 1, lastError: "socket hang up" })
  })

  it("un TypeError de red deja un motivo en español, no el del navegador", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    await flushInspectionSubmissionQueue(async () => { throw new TypeError("Failed to fetch") }, USER)

    expect((await getQueuedInspectionSubmission("run-1", USER))?.lastError).toBe("Sin conexión con el servidor")
  })

  it("agota los reintentos: pendiente hasta el último, y el que lo quema lo cuenta como rechazado", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
    const failing = async () => ({ ok: false, message: "Sigue fallando" })

    for (let attempt = 1; attempt < MAX_RETRIES; attempt++) {
      expect(await flushInspectionSubmissionQueue(failing, USER)).toMatchObject({ pending: 1, rejected: 0, dead: 0 })
    }
    const last = await flushInspectionSubmissionQueue(failing, USER)

    expect(last).toEqual({ synchronized: 0, pending: 0, rejected: 1, dead: 0, rejectedRunIds: ["run-1"] })
    expect(await flushInspectionSubmissionQueue(failing, USER)).toMatchObject({ rejected: 0, dead: 1 })
  })

  it("mezcla entregas, pendientes y quemadas en una sola pasada", async () => {
    for (const id of ["ok", "red", "conflicto"]) await queueInspectionSubmission(submission(id), USER)

    const result = await flushInspectionSubmissionQueue(async (payload) => {
      if (payload.runId === "ok") return { ok: true }
      if (payload.runId === "red") throw new Error("sin red")
      return versionConflict
    }, USER)

    expect(result).toEqual({ synchronized: 1, pending: 1, rejected: 1, dead: 0, rejectedRunIds: ["conflicto"] })
    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()).toEqual(["conflicto", "red"])
  })
})

describe("cola offline de cierres de inspección: una entrada por inspección", () => {
  it("la busca por runId y devuelve null si no hay", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 5 }), USER)
    await queueInspectionSubmission(submission("run-2"), USER)

    expect((await getQueuedInspectionSubmission("run-1", USER))?.payload).toMatchObject({ runId: "run-1", expectedVersion: 5 })
    expect(await getQueuedInspectionSubmission("run-9", USER)).toBeNull()
  })

  it("descartar borra sólo esa entrada y avisa si no había nada", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
    await queueInspectionSubmission(submission("run-2"), USER)

    expect(await discardQueuedInspectionSubmission("run-1")).toBe(true)
    expect(await discardQueuedInspectionSubmission("run-1")).toBe(false)
    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["run-2"])
  })

  it("reencolar una entrada quemada la reemplaza y la deja lista para reenviar", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 3 }), USER)
    await flushInspectionSubmissionQueue(async () => versionConflict, USER)

    await queueInspectionSubmission(submission("run-1", { expectedVersion: 4 }), USER)

    const entry = await getQueuedInspectionSubmission("run-1", USER)
    expect(entry).toMatchObject({ attempts: 0, payload: { expectedVersion: 4 } })
    expect(entry?.lastCode).toBeUndefined()
    expect(entry?.lastError).toBeUndefined()
    expect(await listQueuedInspectionSubmissions()).toHaveLength(1)
  })

  it("encolar otra inspección no borra en silencio un cierre rechazado", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
    await flushInspectionSubmissionQueue(async () => versionConflict, USER)

    await queueInspectionSubmission(submission("run-2"), USER)

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()).toEqual(["run-1", "run-2"])
  })

  it("con la cola llena desaloja primero al cierre rechazado más viejo", async () => {
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`run-${index}`), USER)
    await flushInspectionSubmissionQueue(async (payload) => (payload.runId === "run-2" ? versionConflict : { ok: false }), USER)

    await queueInspectionSubmission(submission("run-6"), USER)

    const ids = (await listQueuedInspectionSubmissions()).map((entry) => entry.id).sort()
    expect(ids).toEqual(["run-1", "run-3", "run-4", "run-5", "run-6"])
  })

  it("con la cola llena de pendientes vivos se niega, con el aviso de cola llena", async () => {
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`run-${index}`), USER)

    await expect(queueInspectionSubmission(submission("run-6"), USER)).rejects.toBeInstanceOf(OfflineQueueFullError)
    await expect(queueInspectionSubmission(submission("run-6"), USER)).rejects.toThrow(/llena/i)
    expect(await listQueuedInspectionSubmissions()).toHaveLength(5)
    // Reencolar una de las que ya están no suma otra: se permite.
    await expect(queueInspectionSubmission(submission("run-3", { expectedVersion: 9 }), USER)).resolves.toBeDefined()
  })

  it("purga por edad las entradas de más de 30 días al encolar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"))
    await queueInspectionSubmission(submission("run-viejo"), USER)
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"))

    await queueInspectionSubmission(submission("run-nuevo"), USER)

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["run-nuevo"])
  })
})

describe("cola offline de cierres de inspección: concurrencia", () => {
  it("dos flush simultáneos se encadenan y la entrada se envía una sola vez", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
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
      flushInspectionSubmissionQueue(sender, USER),
      flushInspectionSubmissionQueue(sender, USER),
    ])

    expect(maxInFlight).toBe(1)
    expect(sender).toHaveBeenCalledTimes(1)
    expect(first.synchronized + second.synchronized).toBe(1)
  })

  it("tres flush simultáneos tampoco se pisan (el candado anterior liberaba a dos juntos)", async () => {
    for (const id of ["a", "b"]) await queueInspectionSubmission(submission(id), USER)
    let inFlight = 0
    let maxInFlight = 0
    const sender = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return { ok: true }
    }

    await Promise.all([1, 2, 3].map(() => flushInspectionSubmissionQueue(sender, USER)))

    expect(maxInFlight).toBe(1)
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("un fallo no resucita una entrada que otra pestaña ya entregó", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)

    await flushInspectionSubmissionQueue(async () => {
      // Mientras este envío está en vuelo, otra pestaña lo entrega y lo borra.
      await discardQueuedInspectionSubmission("run-1")
      return versionConflict
    }, USER)

    expect(await getQueuedInspectionSubmission("run-1", USER)).toBeNull()
  })

  it("un fallo del envío anterior no quema el cierre que se reencoló mientras tanto", async () => {
    await queueInspectionSubmission(submission("run-1", { expectedVersion: 3 }), USER)

    const result = await flushInspectionSubmissionQueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await queueInspectionSubmission(submission("run-1", { expectedVersion: 4 }), USER)
      return versionConflict
    }, USER)

    expect(result).toMatchObject({ rejected: 0, pending: 0 })
    expect(await getQueuedInspectionSubmission("run-1", USER)).toMatchObject({ attempts: 0, payload: { expectedVersion: 4 } })
  })
})

/*
 * El envío registra el cierre a nombre de la sesión vigente (`executedByUserId`,
 * firmas). Si la sesión de quien lo guardó terminó sin cerrar sesión y entra otra
 * persona al mismo equipo, el cierre ajeno no puede salir con la identidad
 * equivocada.
 */
describe("cola offline de cierres de inspección: dueño de cada cierre", () => {
  const OTRO = "user-2"

  it("guarda quién lo encoló", async () => {
    await queueInspectionSubmission(submission("run-1"), USER)
    expect(await getQueuedInspectionSubmission("run-1", USER)).toMatchObject({ userId: USER })
  })

  it("una entrada de otro usuario no se envía y se borra", async () => {
    await queueInspectionSubmission(submission("run-propia"), USER)
    await sembrarCrudo({ id: "run-ajena", userId: OTRO, payload: submission("run-ajena") })
    const sender = vi.fn(async () => ({ ok: true }))

    const result = await flushInspectionSubmissionQueue(sender, USER)

    expect(sender).toHaveBeenCalledTimes(1)
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-propia" }))
    expect(result).toEqual({ synchronized: 1, pending: 0, rejected: 0, dead: 0, rejectedRunIds: [] })
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("una entrada sin dueño (anterior a guardarlo) tampoco se envía", async () => {
    await sembrarCrudo({ id: "run-vieja", payload: submission("run-vieja") })
    const sender = vi.fn(async () => ({ ok: true }))

    await flushInspectionSubmissionQueue(sender, USER)

    expect(sender).not.toHaveBeenCalled()
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("no devuelve ni conserva el cierre de otro usuario al leer el de una inspección", async () => {
    await queueInspectionSubmission(submission("run-1"), OTRO)

    expect(await getQueuedInspectionSubmission("run-1", USER)).toBeNull()
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })

  it("encolar descarta lo ajeno en vez de dejar que ocupe un lugar de los cinco", async () => {
    for (let index = 1; index <= 5; index++) await queueInspectionSubmission(submission(`ajena-${index}`), OTRO)

    await expect(queueInspectionSubmission(submission("propia"), USER)).resolves.toBeDefined()

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["propia"])
  })

  it("purgeInspectionSubmissionsOfOthers borra lo ajeno y deja lo propio", async () => {
    await queueInspectionSubmission(submission("propia"), USER)
    await sembrarCrudo({ id: "ajena", userId: OTRO, payload: submission("ajena") })
    await sembrarCrudo({ id: "sin-dueno", payload: submission("sin-dueno") })

    expect(await purgeInspectionSubmissionsOfOthers(USER)).toBe(2)

    expect((await listQueuedInspectionSubmissions()).map((entry) => entry.id)).toEqual(["propia"])
  })

  it("purgeInspectionSubmissionsOfOthers también borra lo propio que pasó de los 30 días", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"))
    await queueInspectionSubmission(submission("propia-vieja"), USER)
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"))

    expect(await purgeInspectionSubmissionsOfOthers(USER)).toBe(1)
    expect(await listQueuedInspectionSubmissions()).toEqual([])
  })
})
