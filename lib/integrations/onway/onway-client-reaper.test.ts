import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Regresión del 2026-11-24: cada `ONWAY_PORTAL_TIMEOUT` dejaba un Chromium vivo
 * girando al 100 % de CPU. `server.kill()` mataba al driver de Playwright, y
 * Chromium —su hijo— quedaba reparentado a PID 1 sin que nadie lo terminara.
 * Se encontraron árboles de 4 h y 18 h, ocho renderers al 100 % y load average
 * 12 sobre 12 núcleos, en producción y en dev.
 *
 * Lo que se fija aquí: al cerrar la sesión se matan los grupos de proceso del
 * lanzamiento, aunque el cierre ordenado de Playwright haya tenido éxito. Esa
 * última parte es la que faltaba — el camino de `close()` no lanzaba error, así
 * que el `catch` con el `kill` nunca corría.
 */
const reaper = vi.hoisted(() => ({
  listChromiumProcesses: vi.fn(),
  killProcessGroupsAndWait: vi.fn(async (
    _groups: readonly number[],
    _options?: { graceMs?: number },
  ): Promise<{ terminated: number; killed: number; survived: number[] }> => (
    { terminated: 1, killed: 0, survived: [] }
  )),
  processGroups: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("./browser-reaper", () => ({
  listChromiumProcesses: (...args: unknown[]) => Reflect.apply(reaper.listChromiumProcesses, null, args),
  killProcessGroupsAndWait: (...args: unknown[]) => Reflect.apply(reaper.killProcessGroupsAndWait, null, args),
  processGroups: (...args: unknown[]) => Reflect.apply(reaper.processGroups, null, args),
}))

const play = vi.hoisted(() => ({ close: vi.fn(), serverClose: vi.fn(), kill: vi.fn(), launched: 0 }))

vi.mock("playwright", () => {
  const page = {
    isClosed: () => false,
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    // La respuesta del snapshot nunca llega: la corrida se va por deadline.
    waitForResponse: () => new Promise(() => undefined),
    locator: () => ({ isVisible: async () => false, count: async () => 0 }),
    evaluate: () => new Promise(() => undefined),
  }
  return {
    chromium: {
      launchServer: async () => {
        play.launched++
        return {
          wsEndpoint: () => "ws://127.0.0.1/onway",
          close: play.serverClose,
          kill: play.kill,
        }
      },
      connect: async () => ({
        isConnected: () => true,
        close: play.close,
        newContext: async () => ({ newPage: async () => page }),
      }),
    },
  }
})

const credentials = { username: "operador@example.com", password: "x" }

afterEach(() => {
  vi.clearAllMocks()
  reaper.killProcessGroupsAndWait.mockResolvedValue({ terminated: 1, killed: 0, survived: [] })
  reaper.processGroups.mockReturnValue([])
  reaper.listChromiumProcesses.mockReturnValue([])
})

describe("cierre del navegador de OnWay", () => {
  it("mata los grupos del lanzamiento aunque `close()` termine bien", async () => {
    // `close()` resuelve sin error: este es el caso que dejaba el Chromium vivo,
    // porque el `kill` sólo estaba en el `catch`.
    reaper.listChromiumProcesses
      .mockReturnValueOnce([]) // censo previo al lanzamiento
      .mockReturnValueOnce([]) // censo tras el lanzamiento
      .mockReturnValueOnce([]) // censo en el cierre
    reaper.processGroups
      .mockReturnValueOnce([])      // grupos antes
      .mockReturnValueOnce([4242])  // grupos que aparecieron
      .mockReturnValueOnce([4242])  // censo en el cierre: el mismo

    const { fetchOnwayTelemetry } = await import("./onway-client")
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 30 })).rejects.toMatchObject({
      code: "ONWAY_PORTAL_TIMEOUT",
    })

    // El camino de timeout cierra la sesión: el grupo debe morir igual.
    expect(reaper.killProcessGroupsAndWait).toHaveBeenCalledWith([4242], expect.anything())
  })

  it("mata también los grupos que Chromium crea tarde (chrome_crashpad)", async () => {
    // Los crashpad nacen en su propio grupo después de `newPage`: con la foto
    // del lanzamiento quedaban vivos. El cierre vuelve a censar para atraparlos.
    reaper.listChromiumProcesses
      .mockReturnValueOnce([]) // antes de lanzar
      .mockReturnValueOnce([]) // al lanzar
      .mockReturnValueOnce([]) // en el cierre
    reaper.processGroups
      .mockReturnValueOnce([])          // antes de lanzar
      .mockReturnValueOnce([4242])      // al lanzar
      .mockReturnValueOnce([4242, 9001]) // en el cierre: apareció 9001

    const { fetchOnwayTelemetry } = await import("./onway-client")
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 30 })).rejects.toMatchObject({
      code: "ONWAY_PORTAL_TIMEOUT",
    })

    expect(reaper.killProcessGroupsAndWait).toHaveBeenCalledWith([4242, 9001], expect.anything())
  })

  it("no mata grupos que ya existían antes de lanzar (la vista de otra persona)", async () => {
    reaper.listChromiumProcesses.mockReturnValue([])
    reaper.processGroups
      .mockReturnValueOnce([1111])  // ya estaba antes
      .mockReturnValueOnce([1111])  // sigue siendo el único
      .mockReturnValueOnce([1111])  // en el cierre tampoco hay nuevos

    const { fetchOnwayTelemetry } = await import("./onway-client")
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 30 })).rejects.toMatchObject({
      code: "ONWAY_PORTAL_TIMEOUT",
    })

    expect(reaper.killProcessGroupsAndWait).not.toHaveBeenCalled()
  })

  it("si un grupo sobrevive al SIGKILL, lo registra como error", async () => {
    reaper.listChromiumProcesses.mockReturnValue([])
    reaper.processGroups
      .mockReturnValueOnce([])
      .mockReturnValueOnce([777])
    reaper.killProcessGroupsAndWait.mockResolvedValue({ terminated: 1, killed: 1, survived: [9001] })

    const { logger } = await import("@/lib/logger")
    const { fetchOnwayTelemetry } = await import("./onway-client")
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 30 })).rejects.toMatchObject({
      code: "ONWAY_PORTAL_TIMEOUT",
    })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Chromium vivos"),
      expect.objectContaining({ survived: [9001] }),
    )
  })
})
