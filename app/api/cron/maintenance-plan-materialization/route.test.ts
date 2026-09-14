/**
 * Contrato de la ruta de cron `maintenance-plan-materialization` — patrón P3 de la
 * auditoría 2026-09-14: convertir un plan preventivo vencido en orden de trabajo dependía de que alguien pulsara un botón (MNT-001).
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
vi.mock("@/lib/services/maintenance", () => ({
  materializeDueMaintenancePlansAsSystem: (...args: unknown[]) => mocks.work(...args),
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
  new NextRequest("http://localhost/api/cron/maintenance-plan-materialization", { headers: { authorization: auth } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "secreto"
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.work.mockResolvedValue({ created: 2 })
  mocks.withCronLock.mockImplementation(async (_n: string, run: () => Promise<unknown>) => run())
})

describe("GET /api/cron/maintenance-plan-materialization", () => {
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
    expect(mocks.withCronLock).toHaveBeenCalledWith("maintenance-plan-materialization", expect.any(Function))
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
