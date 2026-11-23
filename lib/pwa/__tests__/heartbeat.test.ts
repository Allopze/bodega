// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { pwaHeartbeatSchema } from "@/lib/pwa/heartbeat-contract"
import {
  HEARTBEAT_MIN_INTERVAL_MS,
  __resetHeartbeatThrottle,
  getOrCreateDeviceId,
  sendHeartbeat,
  type QueueSnapshot,
} from "@/lib/pwa/heartbeat"
import { syncAllPending } from "@/lib/pwa/hooks"
import { deletePpa, enqueuePpa, getAllPpas, getPpaById, requeueNetworkFailedPpas, summarizePpaQueue, updatePpaStatus } from "@/lib/pwa/offline-queue"

// `syncOne` valida el payload y llama a la server action: las dos cosas se controlan desde acá.
const shape = vi.hoisted(() => ({ ok: true }))
const submit = vi.hoisted(() => vi.fn())
vi.mock("@/lib/validation/ppa", () => ({
  ppaSubmitSchema: { safeParse: () => (shape.ok ? { success: true } : { success: false, error: { issues: [{ message: "forma antigua" }] } }) },
}))
vi.mock("@/app/(public)/ppa/actions", () => ({ submitPpaAction: submit }))
vi.mock("@/lib/pwa/notifications", () => ({ showSyncNotification: vi.fn() }))

/** Reloj de referencia: el cliente descarta (no manda) un aviso con el reloj antes de 2020. */
const T0 = Date.UTC(2026, 10, 22, 12)
const DEVICE = "7b1f6c52-3f4e-4c3e-9a0c-0d9d5f8a1e11"
const IDLE: QueueSnapshot = { pending: 0, failed: 0, oldestPendingAt: null, lastAttemptAt: null, lastError: null }

const fetchMock = vi.fn()
let online = true

function setOnline(value: boolean) {
  online = value
}

function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string)
}

beforeEach(() => {
  __resetHeartbeatThrottle()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
  online = true
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => online)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sendHeartbeat", () => {
  it("al abrir sale siempre", async () => {
    expect(await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true, now: T0 + 1_000 })).toBe(true)
    // Abrir otra vez, un segundo después y con el mismo estado, vuelve a salir.
    expect(await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true, now: T0 + 2_000 })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe("/api/pwa/aviso")
    expect(init.method).toBe("POST")
    expect(init.keepalive).toBe(true)
  })

  it("sin red no sale", async () => {
    setOnline(false)
    expect(await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("tras un intento, igual estado y menos de 5 min no sale (el motor intenta cada 60 s)", async () => {
    const snapshot = { ...IDLE, pending: 2 }
    const results = [
      await sendHeartbeat("mantencion", DEVICE, snapshot, {}, { now: T0 }),
      await sendHeartbeat("mantencion", DEVICE, snapshot, {}, { now: T0 + 60_000 }),
      await sendHeartbeat("mantencion", DEVICE, snapshot, {}, { now: T0 + 120_000 }),
    ]
    expect(results).toEqual([true, false, false])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("cambia el conteo y sale de inmediato", async () => {
    await sendHeartbeat("mantencion", DEVICE, { ...IDLE, pending: 2 }, {}, { now: T0 })
    expect(await sendHeartbeat("mantencion", DEVICE, { ...IDLE, pending: 1 }, {}, { now: T0 + 60_000 })).toBe(true)
    expect(await sendHeartbeat("mantencion", DEVICE, { ...IDLE, pending: 1, failed: 1 }, {}, { now: T0 + 61_000 })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("pasados 5 min sale aunque no haya cambiado nada", async () => {
    const snapshot = { ...IDLE, pending: 2 }
    await sendHeartbeat("tae", DEVICE, snapshot, {}, { now: T0 })
    expect(await sendHeartbeat("tae", DEVICE, snapshot, {}, { now: T0 + HEARTBEAT_MIN_INTERVAL_MS - 1 })).toBe(false)
    expect(await sendHeartbeat("tae", DEVICE, snapshot, {}, { now: T0 + HEARTBEAT_MIN_INTERVAL_MS })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("el freno es por app: lo que manda una no frena a la otra", async () => {
    await sendHeartbeat("ppa", DEVICE, IDLE, {}, { now: T0 })
    expect(await sendHeartbeat("tae", DEVICE, IDLE, {}, { now: T0 + 1_000 })).toBe(true)
  })

  it("el token de TAE viaja hasheado, nunca en claro", async () => {
    await sendHeartbeat("tae", DEVICE, IDLE, { linkToken: "tok-1" }, { force: true })
    const raw = (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    expect(raw).not.toContain("tok-1")
    const body = sentBody()
    expect(body.linkHash).toMatch(/^[0-9a-f]{64}$/)
    // SHA-256 de "tok-1", calculado aparte con el mismo algoritmo.
    const { createHash } = await import("node:crypto")
    expect(body.linkHash).toBe(createHash("sha256").update("tok-1").digest("hex"))
  })

  it("la credencial del mecánico va en el encabezado, no en el cuerpo", async () => {
    await sendHeartbeat("mantencion", DEVICE, IDLE, { bearer: "secreto-xyz" }, { force: true })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secreto-xyz")
    expect(init.body as string).not.toContain("secreto-xyz")
  })

  it("un fetch que falla no lanza", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true })).resolves.toBe(true)
    vi.stubGlobal("fetch", () => { throw new Error("boom") })
    await expect(sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true })).resolves.toBe(false)
  })

  it("el cuerpo no lleva datos del trabajador: sus claves son exactamente las del esquema", async () => {
    await sendHeartbeat(
      "ppa", DEVICE,
      { pending: 1, failed: 0, oldestPendingAt: "2026-11-22T10:00:00.000Z", lastAttemptAt: "2026-11-22T11:00:00.000Z", lastError: "Sin conexión" },
      { worksiteId: "ws-1", linkToken: "tok-1" },
      { force: true },
    )
    const body = sentBody()
    // `.strict()`: una clave de más (rut, nombre, empresa…) haría fallar el parseo.
    expect(pwaHeartbeatSchema.safeParse(body).success).toBe(true)
    expect(Object.keys(body).sort()).toEqual(Object.keys(pwaHeartbeatSchema.shape).sort())
    expect(Object.keys(body)).toContain("sentAt")
  })

  it("sentAt es el reloj del teléfono al enviar (el mismo `now` del freno), en ISO con zona", async () => {
    await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true, now: T0 + 5_000 })
    expect(sentBody().sentAt).toBe(new Date(T0 + 5_000).toISOString())
    expect(pwaHeartbeatSchema.safeParse(sentBody()).success).toBe(true)
  })

  it("con el reloj del teléfono antes de 2020 no manda nada (el servidor rechazaría el aviso)", async () => {
    expect(await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true, now: 0 })).toBe(false)
    expect(await sendHeartbeat("ppa", DEVICE, IDLE, {}, { force: true, now: Date.UTC(2019, 11, 31) })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("las cadenas viajan sin caracteres de control y el cuerpo sigue siendo válido", async () => {
    await sendHeartbeat(
      "ppa", DEVICE,
      { ...IDLE, lastError: "\n  Falló\r\nel envío\u0000\t\u007F  " },
      { worksiteId: "ws\u0000-1\n" },
      { force: true, now: T0 },
    )
    const body = sentBody()
    expect(body.lastError).toBe("Falló  el envío")
    expect(body.worksiteId).toBe("ws -1")
    expect(pwaHeartbeatSchema.safeParse(body).success).toBe(true)
    // Ninguna cadena del cuerpo lleva un carácter de control.
    for (const value of Object.values(body)) {
      if (typeof value === "string") expect(value).not.toMatch(/[\u0000-\u001F\u007F]/)
    }
  })

  it("un error de sólo caracteres de control queda en null y una faena vacía no viaja", async () => {
    await sendHeartbeat("ppa", DEVICE, { ...IDLE, lastError: "\n\u0000 " }, { worksiteId: "\n" }, { force: true, now: T0 })
    const body = sentBody()
    expect(body.lastError).toBeNull()
    expect("worksiteId" in body).toBe(false)
    expect(pwaHeartbeatSchema.safeParse(body).success).toBe(true)
  })

  it("las fechas anteriores a 2020 se mandan como null", async () => {
    await sendHeartbeat(
      "ppa", DEVICE,
      { ...IDLE, pending: 1, oldestPendingAt: "1970-01-01T00:00:00.000Z", lastAttemptAt: "2019-12-31T23:59:59.000Z" },
      {}, { force: true, now: T0 },
    )
    const body = sentBody()
    expect(body.oldestPendingAt).toBeNull()
    expect(body.lastAttemptAt).toBeNull()
    expect(pwaHeartbeatSchema.safeParse(body).success).toBe(true)
  })

  it("recorta lo que excede los topes en vez de mandar un cuerpo que el servidor rechazaría", async () => {
    await sendHeartbeat("ppa", DEVICE, { ...IDLE, pending: 99_999, lastError: "x".repeat(500), oldestPendingAt: "no es fecha" }, {}, { force: true, now: T0 })
    const body = sentBody()
    expect(pwaHeartbeatSchema.safeParse(body).success).toBe(true)
    expect(body.pending).toBe(10_000)
    expect((body.lastError as string).length).toBe(200)
    expect(body.oldestPendingAt).toBeNull()
  })
})

describe("getOrCreateDeviceId", () => {
  afterEach(() => { localStorage.clear() })

  it("crea un UUID por app y lo conserva", () => {
    const ppa = getOrCreateDeviceId("ppa")
    expect(ppa).toMatch(/^[0-9a-f-]{36}$/)
    expect(getOrCreateDeviceId("ppa")).toBe(ppa)
    expect(localStorage.getItem("chome:pwa-device:ppa")).toBe(ppa)
    expect(getOrCreateDeviceId("tae")).not.toBe(ppa)
  })

  it("si el almacenamiento falla, vale un UUID por sesión", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado") })
    const first = getOrCreateDeviceId("ppa")
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(getOrCreateDeviceId("ppa")).toBe(first)
  })
})

describe("summarizePpaQueue", () => {
  afterEach(async () => {
    const all = await getAllPpas()
    await Promise.all(all.map((item) => deletePpa(item.id)))
  })

  it("sólo los rechazos del servidor son `failed`; lo que se rindió por red sigue pendiente", async () => {
    const pending = await enqueuePpa({ a: 1 })
    const syncing = await enqueuePpa({ a: 2 })
    const rejected = await enqueuePpa({ a: 3 })
    const network = await enqueuePpa({ a: 4 })
    const legacyRejected = await enqueuePpa({ a: 5 })
    const legacyNetwork = await enqueuePpa({ a: 6 })
    const synced = await enqueuePpa({ a: 7 })
    await updatePpaStatus(syncing.id, { status: "syncing", attempts: 1 })
    await updatePpaStatus(rejected.id, { status: "failed", failureKind: "rejected", attempts: 3, lastError: "Faena no permitida" })
    await updatePpaStatus(network.id, { status: "failed", failureKind: "network", attempts: 3, lastError: "Sin conexión" })
    // Guardados antes de `failureKind`: se infieren del último error.
    await updatePpaStatus(legacyRejected.id, { status: "failed", attempts: 3, lastError: "RUT inválido" })
    await updatePpaStatus(legacyNetwork.id, { status: "failed", attempts: 3, lastError: "Sin conexión" })
    await updatePpaStatus(synced.id, { status: "synced" })
    void pending

    const summary = summarizePpaQueue(await getAllPpas())
    expect(summary.failed).toBe(2)
    expect(summary.pending).toBe(4)
    expect(summary.oldestPendingAt).not.toBeNull()
    expect(summary.lastError).not.toBeNull()
    expect(summary.lastAttemptAt).not.toBeNull()
  })

  it("cola vacía: todo en cero", () => {
    expect(summarizePpaQueue([])).toEqual(IDLE)
  })

  it("failureKind se conserva al guardarlo", async () => {
    const item = await enqueuePpa({ a: 1 })
    await updatePpaStatus(item.id, { status: "failed", failureKind: "network" })
    expect((await getPpaById(item.id))?.failureKind).toBe("network")
  })
})

describe("syncAllPending: failureKind y aviso", () => {
  const avisos = () => fetchMock.mock.calls.filter(([url]) => url === "/api/pwa/aviso")

  beforeEach(() => { shape.ok = true; submit.mockReset() })
  afterEach(async () => {
    const all = await getAllPpas()
    await Promise.all(all.map((item) => deletePpa(item.id)))
    localStorage.clear()
  })

  it("el servidor rechaza: failed con failureKind `rejected`", async () => {
    submit.mockResolvedValue({ ok: false, message: "Faena no permitida" })
    const item = await enqueuePpa({ a: 1 })
    await syncAllPending()
    const saved = await getPpaById(item.id)
    expect(saved).toMatchObject({ status: "failed", failureKind: "rejected", lastError: "Faena no permitida" })
    expect(summarizePpaQueue([saved!])).toMatchObject({ failed: 1, pending: 0 })
  })

  it("un payload con la forma antigua también es un rechazo", async () => {
    shape.ok = false
    const item = await enqueuePpa({ a: 1 })
    await syncAllPending()
    expect(await getPpaById(item.id)).toMatchObject({ status: "failed", failureKind: "rejected" })
  })

  it("se agotan los reintentos sin red: failed con failureKind `network`, y cuenta como pendiente", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    const item = await enqueuePpa({ a: 1 })
    await updatePpaStatus(item.id, { attempts: 2 })
    await syncAllPending()
    const saved = await getPpaById(item.id)
    expect(saved).toMatchObject({ status: "failed", failureKind: "network", lastError: "Sin conexión" })
    expect(summarizePpaQueue([saved!])).toMatchObject({ failed: 0, pending: 1 })
  })

  it("lo que se rindió por red NO se reintenta en cada pasada: sólo tras `requeueNetworkFailedPpas`", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    const item = await enqueuePpa({ a: 1 })
    await updatePpaStatus(item.id, { attempts: 2 })
    await syncAllPending()
    expect(await getPpaById(item.id)).toMatchObject({ status: "failed", failureKind: "network" })

    // Otra pasada, sin reencolar: no toca el ítem (evita el bucle con red pero sin servidor).
    submit.mockClear()
    await syncAllPending()
    expect(submit).not.toHaveBeenCalled()

    submit.mockResolvedValue({ ok: true, data: { token: "tok-ok", resultado: "autorizado_auto" } })
    expect(await requeueNetworkFailedPpas()).toBe(1)
    expect(await getPpaById(item.id)).toMatchObject({ status: "pending", attempts: 0, lastError: "Sin conexión" })
    await syncAllPending()
    const saved = await getPpaById(item.id)
    expect(saved).toMatchObject({ status: "synced", token: "tok-ok" })
    expect(saved?.failureKind).toBeUndefined()
  })

  it("un rechazo del servidor no se reintenta solo", async () => {
    submit.mockResolvedValue({ ok: false, message: "Faena no permitida" })
    const item = await enqueuePpa({ a: 1 })
    await syncAllPending()
    submit.mockClear()
    await syncAllPending()
    expect(submit).not.toHaveBeenCalled()
    expect(await getPpaById(item.id)).toMatchObject({ status: "failed", failureKind: "rejected" })
  })

  it("con intentos por delante, un fallo de red lo deja pendiente y sin failureKind", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    const item = await enqueuePpa({ a: 1 })
    await syncAllPending()
    const saved = await getPpaById(item.id)
    expect(saved?.status).toBe("pending")
    expect(saved?.failureKind).toBeUndefined()
  })

  it("avisa una sola vez por pasada, con la faena del último envío", async () => {
    localStorage.setItem("chome:pwa-worksite:ppa", "ws-9")
    submit.mockResolvedValue({ ok: false, message: "no" })
    await enqueuePpa({ a: 1 })
    await enqueuePpa({ a: 2 })
    await syncAllPending()
    await vi.waitFor(() => expect(avisos()).toHaveLength(1))
    expect(sentBody()).toMatchObject({ app: "ppa", pending: 0, failed: 2, worksiteId: "ws-9" })
  })
})
