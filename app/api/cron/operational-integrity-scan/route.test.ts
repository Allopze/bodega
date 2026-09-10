import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  scanAsSystem: vi.fn(),
  withCronLock: vi.fn(),
  isRouteOperational: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args),
}))
vi.mock("@/lib/services/operational-integrity", () => ({
  scanOperationalIntegrityAsSystem: (...args: unknown[]) => mocks.scanAsSystem(...args),
}))
vi.mock("@/lib/services/cron-lock", () => ({
  withCronLock: (...args: unknown[]) => mocks.withCronLock(...args),
}))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: (...args: unknown[]) => mocks.isRouteOperational(...args),
}))
vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mocks.loggerInfo(...args),
    warn: (...args: unknown[]) => mocks.loggerWarn(...args),
    error: (...args: unknown[]) => mocks.loggerError(...args),
  },
}))

const { GET } = await import("./route")

const request = (auth = "Bearer secreto") =>
  new NextRequest("http://localhost/api/cron/operational-integrity-scan", {
    headers: { authorization: auth },
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "secreto"
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.isRouteOperational.mockResolvedValue(true)
  mocks.scanAsSystem.mockResolvedValue({ found: 3, recorded: 2 })
  // Por defecto el lock deja pasar y devuelve lo que produce el trabajo.
  mocks.withCronLock.mockImplementation(async (_name: string, run: () => Promise<unknown>) => run())
})

describe("GET /api/cron/operational-integrity-scan", () => {
  it("escanea los tres dominios y reporta lo observado", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.scanAsSystem).toHaveBeenCalledWith(["stock", "receiving", "purchasing"])
    await expect(response.json()).resolves.toMatchObject({ ok: true, outcome: "success", code: "INTEGRITY_CRON_SUCCESS", found: 3, recorded: 2 })
  })

  it("rechaza sin el secreto y no escanea", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)

    const response = await GET(request("Bearer incorrecto"))

    expect(response.status).toBe(401)
    expect(mocks.scanAsSystem).not.toHaveBeenCalled()
  })

  it("falla explícito si CRON_SECRET no está configurado", async () => {
    delete process.env.CRON_SECRET

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ code: "INTEGRITY_CRON_MISCONFIGURED" })
    expect(mocks.scanAsSystem).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it("no escanea si el módulo de trazabilidad está apagado", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.scanAsSystem).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ outcome: "disabled" })
  })

  it("cede ante otra corrida en curso en vez de duplicar observaciones", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })

    const response = await GET(request())

    // 409 y exit 2: el runner distingue «otra corrida activa» de una falla.
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ outcome: "conflict", code: "INTEGRITY_CRON_ACTIVE_RUN" })
  })

  /**
   * `scripts/cron-runner.mjs` descarta cualquier respuesta cuyo `code` no
   * empiece por el prefijo del job: sin esto el cron quedaría en
   * DTE_CRON_RUNNER_CONTRACT en cada corrida, sin escanear nunca.
   */
  it("cumple el contrato que exige el runner en todas las salidas", async () => {
    const salidas = [
      async () => GET(request()),
      async () => { mocks.verifyCronSecret.mockReturnValue(false); return GET(request("Bearer malo")) },
      async () => { mocks.isRouteOperational.mockResolvedValue(false); return GET(request()) },
      async () => { mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "x" }); return GET(request()) },
      async () => { mocks.scanAsSystem.mockRejectedValue(new Error("boom")); return GET(request()) },
    ]

    for (const salida of salidas) {
      const body = await (await salida()).json() as { outcome?: unknown; code?: unknown }
      expect(typeof body.outcome).toBe("string")
      expect(String(body.code)).toMatch(/^INTEGRITY_CRON_/)
    }
  })

  it("toma el lock con su propio nombre de job", async () => {
    await GET(request())

    expect(mocks.withCronLock).toHaveBeenCalledWith("operational-integrity-scan", expect.any(Function))
  })

  it("no filtra el detalle interno cuando el escaneo revienta", async () => {
    const driverError = Object.assign(new Error('Failed query: select * from "operational_integrity_cases"'), {
      query: "select",
      cause: { code: "42P01" },
    })
    mocks.scanAsSystem.mockRejectedValue(driverError)

    const response = await GET(request())

    expect(response.status).toBe(503)
    const body = await response.json() as { error?: string }
    expect(body.error ?? "").not.toMatch(/operational_integrity_cases|Failed query/i)
    expect(mocks.loggerError).toHaveBeenCalled()
  })
})
