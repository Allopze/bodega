// @vitest-environment jsdom
/**
 * La cola de PPA vuelve a intentar lo que se rindió por falta de red, a nivel de
 * hook: al abrir la app y al volver la señal (no en cada pasada), sin bucle
 * cerrado cuando hay red pero el servidor no responde, y sin tocar nunca un
 * rechazo del servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { renderHook } from "@testing-library/react"
import { __resetHeartbeatThrottle } from "@/lib/pwa/heartbeat"
import { usePpaOfflineQueue } from "@/lib/pwa/hooks"
import { deletePpa, enqueuePpa, getAllPpas, getPpaById, updatePpaStatus } from "@/lib/pwa/offline-queue"

vi.mock("@/lib/validation/ppa", () => ({ ppaSubmitSchema: { safeParse: () => ({ success: true }) } }))
const submit = vi.hoisted(() => vi.fn())
vi.mock("@/app/(public)/ppa/actions", () => ({ submitPpaAction: submit }))
vi.mock("@/lib/pwa/notifications", () => ({ showSyncNotification: vi.fn() }))

const OK = { ok: true, data: { token: "tok-ok", resultado: "autorizado_auto" } }

/** Deja correr IndexedDB (usa `setImmediate` real) sin mover el reloj falso. */
async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Avanza el reloj falso de a poco, dejando que la cola (IndexedDB + efectos) asiente
 * entre pasos. Sin `act`: dentro de uno React junta `syncing` true→false en un solo
 * render y el efecto del envío automático nunca vuelve a armar su temporizador, que
 * en el navegador sí ocurre (cada estado se pinta por separado).
 */
async function advance(ms: number, step = 500) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await vi.advanceTimersByTimeAsync(step)
    await settle(10)
  }
}

async function seedNetworkFailed(): Promise<string> {
  const item = await enqueuePpa({ a: 1 })
  await updatePpaStatus(item.id, { status: "failed", failureKind: "network", attempts: 3, lastError: "Sin conexión" })
  return item.id
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false)
  __resetHeartbeatThrottle()
  submit.mockReset()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true)
  const all = await getAllPpas()
  await Promise.all(all.map((item) => deletePpa(item.id)))
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("usePpaOfflineQueue: reintento de lo que se rindió por falta de red", () => {
  it("una cola con sólo un ítem rendido por red se reintenta al abrir y termina enviada", async () => {
    submit.mockResolvedValue(OK)
    const id = await seedNetworkFailed()

    const { result } = renderHook(() => usePpaOfflineQueue())
    await advance(5_000)

    expect(submit).toHaveBeenCalledTimes(1)
    expect(await getPpaById(id)).toMatchObject({ status: "synced", token: "tok-ok" })
    expect(result.current.pendingCount).toBe(0)
  })

  it("mientras no sale, el trabajador lo sigue viendo como pendiente (el aviso y «Enviar ahora» no se esconden)", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    await seedNetworkFailed()

    const { result } = renderHook(() => usePpaOfflineQueue())
    await advance(30_000)

    expect(await getAllPpas()).toMatchObject([{ status: "failed", failureKind: "network" }])
    expect(result.current.pendingCount).toBe(1)
  })

  it("con red pero sin servidor no hay bucle: los envíos quedan acotados en 60 s", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    await seedNetworkFailed()

    renderHook(() => usePpaOfflineQueue())
    await advance(60_000)

    // Un reencolado al abrir = tres intentos (`MAX_SYNC_ATTEMPTS`), y se vuelve a rendir.
    expect(submit.mock.calls.length).toBeGreaterThan(0)
    expect(submit.mock.calls.length).toBeLessThanOrEqual(3)
    const after = submit.mock.calls.length
    await advance(60_000)
    expect(submit).toHaveBeenCalledTimes(after)
  })

  it("al volver la señal se reencola de nuevo y se envía", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    const id = await seedNetworkFailed()

    const { result } = renderHook(() => usePpaOfflineQueue())
    await advance(30_000)
    expect(await getPpaById(id)).toMatchObject({ status: "failed", failureKind: "network" })

    submit.mockResolvedValue(OK)
    window.dispatchEvent(new Event("online"))
    await settle()
    await advance(5_000)

    expect(await getPpaById(id)).toMatchObject({ status: "synced" })
    expect(result.current.pendingCount).toBe(0)
  })

  it("«Enviar ahora» reencola lo rendido por red antes de sincronizar", async () => {
    submit.mockRejectedValue(new TypeError("Failed to fetch"))
    const id = await seedNetworkFailed()

    const { result } = renderHook(() => usePpaOfflineQueue())
    await advance(30_000)
    expect(await getPpaById(id)).toMatchObject({ status: "failed", failureKind: "network" })

    submit.mockResolvedValue(OK)
    let remaining: unknown[] = [1]
    remaining = await result.current.triggerSync()
    await settle()

    expect(remaining).toHaveLength(0)
    expect(await getPpaById(id)).toMatchObject({ status: "synced" })
    expect(result.current.pendingCount).toBe(0)
  })

  it("un rechazo del servidor nunca se reintenta (ni al abrir, ni al volver la señal, ni con «Enviar ahora») y no cuenta como pendiente", async () => {
    submit.mockResolvedValue(OK)
    const item = await enqueuePpa({ a: 1 })
    await updatePpaStatus(item.id, { status: "failed", failureKind: "rejected", attempts: 3, lastError: "Faena no permitida" })

    const { result } = renderHook(() => usePpaOfflineQueue())
    await advance(10_000)
    window.dispatchEvent(new Event("online"))
    await settle()
    await advance(10_000)
    await result.current.triggerSync()
    await settle()

    expect(submit).not.toHaveBeenCalled()
    expect(await getPpaById(item.id)).toMatchObject({ status: "failed", failureKind: "rejected", lastError: "Faena no permitida" })
    expect(result.current.pendingCount).toBe(0)
  })
})
