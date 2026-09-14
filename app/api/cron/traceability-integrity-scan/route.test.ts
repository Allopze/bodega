/**
 * Contrato de la ruta de cron `traceability-integrity-scan` — patrón P3 de la
 * auditoría 2026-09-14: el escaneo del libro anterior de integridad no tenía cron y dependía del botón «Escanear» del banco de trabajo (TRZ-001).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  work: vi.fn(),
  withCronLock: vi.fn(),
  loggerInfo: vi.fn(), loggerWarn: vi.fn(), loggerError: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args),
}))
vi.mock("@/lib/services/traceability-integrity-cases", () => ({
  scanTraceabilityIntegrityAsSystem: (...args: unknown[]) => mocks.work(...args),
}))
vi.mock("@/lib/services/cron-lock", () => ({
  withCronLock: (...args: unknown[]) => mocks.withCronLock(...args),
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
  new NextRequest("http://localhost/api/cron/traceability-integrity-scan", { headers: { authorization: auth } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "secreto"
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.work.mockResolvedValue({ findings: [], recordedCount: 0 })
  mocks.withCronLock.mockImplementation(async (_n: string, run: () => Promise<unknown>) => run())
})

describe("GET /api/cron/traceability-integrity-scan", () => {
  it("corre el barrido y responde 200", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.outcome).toBe("success")
    expect(mocks.work).toHaveBeenCalledTimes(1)
  })

  it("rechaza sin secreto correcto y no ejecuta nada", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)
    const response = await GET(request("Bearer otro"))
    expect(response.status).toBe(401)
    expect(mocks.work).not.toHaveBeenCalled()
  })

  it("sin CRON_SECRET configurado falla con 500, no con 200 en silencio", async () => {
    delete process.env.CRON_SECRET
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(mocks.work).not.toHaveBeenCalled()
  })

  it("pasa por el lock de corrida, con el nombre del job", async () => {
    await GET(request())
    expect(mocks.withCronLock).toHaveBeenCalledWith("traceability-integrity-scan", expect.any(Function))
  })

  it("un disparo solapado se salta sin ensuciar el resultado", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).outcome).toBe("skipped")
  })

  it("un fallo del barrido responde 503 para que el runner lo note", async () => {
    mocks.work.mockRejectedValue(new Error("se cayó"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.outcome).toBe("failed")
  })
})
