import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveAccount } from "../accounts"
import { SERVER_DOWN_MESSAGE, openApp } from "../bootstrap"
import { CLOCK_PROBE_URL, FRESH_WINDOW_MS, checkFreshness, isFreshAt } from "../freshness"
import { account, freshDb } from "./fixtures"

const SERVER_NOW = Date.parse("2026-11-22T15:00:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()
const asFetch = (fn: unknown) => fn as typeof fetch
const withDate = (status: number, serverNow: number | null) =>
  new Response(null, { status, headers: serverNow === null ? {} : { date: new Date(serverNow).toUTCString() } })

describe("frescura del HTML con el reloj del servidor (APP-1)", () => {
  afterEach(() => vi.useRealTimers())

  it("isFreshAt: dentro de la ventana es fresco; vencida o muy en el futuro, no", () => {
    expect(isFreshAt(SERVER_NOW, SERVER_NOW - 5_000)).toBe(true)
    expect(isFreshAt(SERVER_NOW, SERVER_NOW - FRESH_WINDOW_MS)).toBe(true)
    expect(isFreshAt(SERVER_NOW, SERVER_NOW - FRESH_WINDOW_MS - 1)).toBe(false)
    expect(isFreshAt(SERVER_NOW, SERVER_NOW + 1_000)).toBe(true) // resolución de segundos de `Date`
    expect(isFreshAt(SERVER_NOW, SERVER_NOW + 10 * 60_000)).toBe(false)
    expect(isFreshAt(SERVER_NOW, Number.NaN)).toBe(false)
  })

  it("un teléfono ADELANTADO una hora ve fresco un HTML recién servido (antes caía en «Necesitas señal»)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(SERVER_NOW + 60 * 60_000) // el reloj del teléfono, una hora adelante
    const probe = vi.fn(async () => withDate(405, SERVER_NOW))
    expect(await checkFreshness(iso(SERVER_NOW - 20_000), { fetchImpl: asFetch(probe) })).toEqual({ fresh: true, reachability: "ok" })
  })

  it("un teléfono ATRASADO ve viejo un HTML de caché de hace días (antes pasaba por fresco)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const renderedAt = SERVER_NOW - 3 * 86_400_000
    vi.setSystemTime(renderedAt + 30_000) // el teléfono cree que son 30 s después de que se armó la página
    const probe = vi.fn(async () => withDate(200, SERVER_NOW))
    expect(await checkFreshness(iso(renderedAt), { fetchImpl: asFetch(probe) })).toEqual({ fresh: false, reachability: "ok" })
  })

  it("una primera carga lenta (3 minutos entre el HTML y el arranque) sigue siendo fresca", async () => {
    const probe = vi.fn(async () => withDate(405, SERVER_NOW))
    expect((await checkFreshness(iso(SERVER_NOW - 3 * 60_000), { fetchImpl: asFetch(probe) })).fresh).toBe(true)
  })

  it("consulta sin caché, por HEAD y a la API (que el service worker no intercepta)", async () => {
    const probe = vi.fn(async (..._args: unknown[]) => withDate(405, SERVER_NOW))
    await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(probe) })
    expect(probe).toHaveBeenCalledTimes(1)
    const [url, init] = probe.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CLOCK_PROBE_URL)
    expect(url.startsWith("/api/")).toBe(true)
    expect(init).toMatchObject({ method: "HEAD", cache: "no-store" })
  })

  it("sin red: no fresco, y un tropiezo rápido se reintenta una vez", async () => {
    const down = vi.fn(async () => { throw new TypeError("net") })
    expect(await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(down) })).toEqual({ fresh: false, reachability: "offline" })
    expect(down).toHaveBeenCalledTimes(2)

    const flaky = vi.fn()
      .mockRejectedValueOnce(new TypeError("net"))
      .mockResolvedValueOnce(withDate(405, SERVER_NOW))
    expect(await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(flaky) })).toEqual({ fresh: true, reachability: "ok" })
  })

  it("wifi sin salida (la consulta se cuelga): agota el tiempo, no fresco y sin segundo intento", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    }))
    const result = await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(hang), timeoutMs: 20 })
    expect(result).toEqual({ fresh: false, reachability: "offline" })
    expect(hang).toHaveBeenCalledTimes(1)
  })

  it("con un 5xx: no fresco y marcado como error del servidor, sin insistir", async () => {
    const broken = vi.fn(async () => withDate(503, SERVER_NOW))
    expect(await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(broken) })).toEqual({ fresh: false, reachability: "server-error" })
    expect(broken).toHaveBeenCalledTimes(1)
  })

  it("una respuesta sin cabecera Date no se puede comparar: no fresco", async () => {
    const noDate = vi.fn(async () => withDate(405, null))
    expect((await checkFreshness(iso(SERVER_NOW), { fetchImpl: asFetch(noDate), attempts: 1 })).fresh).toBe(false)
  })
})

describe("openApp: el arranque que usa la página", () => {
  const user = { id: "u-1", name: "Mecánico", email: "u-1@e2e.chome.cl" }
  beforeEach(freshDb)

  it("con un 5xx y sin cuenta guardada dice que la plataforma no respondió (no «Necesitas señal»)", async () => {
    const broken = vi.fn(async () => withDate(502, SERVER_NOW))
    await expect(openApp({ sessionUser: user, renderedAt: iso(SERVER_NOW), freshness: { fetchImpl: asFetch(broken) } }))
      .rejects.toThrow(SERVER_DOWN_MESSAGE)
    expect(SERVER_DOWN_MESSAGE).not.toMatch(/señal/i)
  })

  it("con un 5xx pero con una cuenta ya guardada, abre con ella", async () => {
    await saveAccount(account("u-1"))
    const broken = vi.fn(async () => withDate(500, SERVER_NOW))
    const result = await openApp({ sessionUser: user, renderedAt: iso(SERVER_NOW), freshness: { fetchImpl: asFetch(broken) } })
    expect(result.activeUserId).toBe("u-1")
    expect(result.blocker).toBeNull()
  })

  it("sin red y sin cuenta, sigue siendo «necesita señal» (no se confunde con el 5xx)", async () => {
    const down = vi.fn(async () => { throw new TypeError("net") })
    const result = await openApp({ sessionUser: user, renderedAt: iso(SERVER_NOW), freshness: { fetchImpl: asFetch(down) } })
    expect(result.blocker).toBe("needs-signal")
  })
})
