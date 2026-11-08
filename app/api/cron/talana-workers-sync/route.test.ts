import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  isRouteOperational: vi.fn(),
  readTalanaConfig: vi.fn(),
  runTalanaSync: vi.fn(),
  hasStalledTalanaRun: vi.fn(async () => false),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
  consumeFixedWindowLimit: vi.fn(async (_key: string, _options: unknown) => ({ allowed: true, remaining: 9 })),
  loggerError: vi.fn(),
}))

vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/integrations/talana/talana-settings", () => ({ readTalanaConfig: (...args: unknown[]) => Reflect.apply(mocks.readTalanaConfig, null, args) }))
vi.mock("@/lib/integrations/talana/talana-sync", () => ({
  runTalanaSync: (...args: unknown[]) => Reflect.apply(mocks.runTalanaSync, null, args),
  hasStalledTalanaRun: (...args: unknown[]) => Reflect.apply(mocks.hasStalledTalanaRun, null, args),
  // La ruta distingue la falla propia con `instanceof`: la clase tiene que ser
  // la misma que importa el test, así que se define aquí y no se importa el
  // orquestador real (que arrastra la base de datos).
  TalanaSyncFailure: class TalanaSyncFailure extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = "TalanaSyncFailure"
    }
  },
}))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: [string, unknown]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))
vi.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))

const { GET } = await import("./route")
const { TalanaSyncFailure } = await import("@/lib/integrations/talana/talana-sync")

const COUNTS = {
  contractsReceived: 120, contractsRejected: 0, activeContracts: 110, absencesReceived: 4,
  altas: 2, reactivaciones: 0, bajas: 1, traslados: 3, cargos: 5, jefes: 0, sexos: 0, skipped: 0, failed: 0,
}
const TOKEN = "talana-token-must-never-appear"

function request(authorization: string | null = "Bearer cron-secret") {
  return new NextRequest("http://localhost/api/cron/talana-workers-sync", {
    headers: authorization ? { authorization } : {},
  })
}

describe("GET /api/cron/talana-workers-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.readTalanaConfig.mockReturnValue({ token: TOKEN, mode: "simulate", hasCredentials: true, enabled: true })
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.hasStalledTalanaRun.mockResolvedValue(false)
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: true, remaining: 9 })
    mocks.runTalanaSync.mockResolvedValue({
      runId: "run-1", mode: "simulate", status: "success", fusibleReason: null, counts: COUNTS,
    })
  })

  it("rechaza una petición sin Bearer o con un Bearer ajeno antes de tocar Talana", async () => {
    for (const authorization of [null, "Bearer otro-secreto", "cron-secret"]) {
      const response = await GET(request(authorization))
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ ok: false, outcome: "unauthorized", code: "TALANA_CRON_UNAUTHORIZED" })
    }
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
    expect(mocks.withCronLock).not.toHaveBeenCalled()
  })

  it("rechaza todo si el servidor no tiene CRON_SECRET", async () => {
    delete process.env.CRON_SECRET
    const response = await GET(request("Bearer "))
    expect(response.status).toBe(401)
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })

  it("no acepta el camino de origen ni secreto interno: es Bearer únicamente", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/talana-workers-sync", {
      headers: { "x-forwarded-for": "10.0.0.1", "x-fleet-gps-cron-secret": "cron-secret" },
    }))
    expect(response.status).toBe(401)
  })

  it("responde deshabilitado, sin error, cuando no hay token", async () => {
    mocks.readTalanaConfig.mockReturnValue({ token: "", mode: "simulate", hasCredentials: false, enabled: false })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcome: "disabled", code: "TALANA_CRON_DISABLED", reason: "sin token" })
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })

  it("responde deshabilitado cuando TALANA_SYNC_MODE está apagado", async () => {
    mocks.readTalanaConfig.mockReturnValue({ token: TOKEN, mode: "off", hasCredentials: true, enabled: false })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      outcome: "disabled",
      reason: "sincronización apagada (TALANA_SYNC_MODE)",
    })
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })

  it("respeta el interruptor del módulo de Administración", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ ok: true, outcome: "disabled", code: "TALANA_CRON_DISABLED" })
    expect(mocks.isRouteOperational).toHaveBeenCalledWith("/admin/trabajadores")
    expect(mocks.readTalanaConfig).not.toHaveBeenCalled()
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })

  it("corre en simulación con el modo y el token de la configuración, bajo el candado del job", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      outcome: "success",
      code: "TALANA_CRON_SUCCESS",
      health: "healthy",
      runId: "run-1",
      mode: "simulate",
      status: "success",
      fusibleReason: null,
      counts: COUNTS,
    })
    expect(mocks.withCronLock).toHaveBeenCalledWith("talana-workers-sync", expect.any(Function))
    expect(mocks.runTalanaSync).toHaveBeenCalledWith({ trigger: "cron", mode: "simulate", token: TOKEN })
  })

  it("pasa el modo apply tal cual cuando está configurado", async () => {
    mocks.readTalanaConfig.mockReturnValue({ token: TOKEN, mode: "apply", hasCredentials: true, enabled: true })
    mocks.runTalanaSync.mockResolvedValue({ runId: "run-2", mode: "apply", status: "success", fusibleReason: null, counts: COUNTS })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.runTalanaSync).toHaveBeenCalledWith({ trigger: "cron", mode: "apply", token: TOKEN })
    expect(await response.json()).toMatchObject({ outcome: "success", mode: "apply" })
  })

  it("trata el fusible disparado (blocked) como degradado y expone la razón", async () => {
    mocks.runTalanaSync.mockResolvedValue({
      runId: "run-3", mode: "apply", status: "blocked", fusibleReason: "active_drop", counts: COUNTS,
    })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      ok: false,
      outcome: "partial",
      code: "TALANA_CRON_PARTIAL",
      health: "degraded",
      status: "blocked",
      fusibleReason: "active_drop",
      runId: "run-3",
    })
  })

  it("trata una corrida con personas que fallaron (partial) como degradada", async () => {
    mocks.runTalanaSync.mockResolvedValue({
      runId: "run-4", mode: "apply", status: "partial", fusibleReason: null, counts: { ...COUNTS, failed: 2 },
    })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      outcome: "partial",
      code: "TALANA_CRON_PARTIAL",
      status: "partial",
      fusibleReason: null,
      counts: { failed: 2 },
    })
  })

  it("responde con el código de una falla propia del orquestador y registra sólo el código", async () => {
    mocks.runTalanaSync.mockRejectedValue(new TalanaSyncFailure("TALANA_AUTH_FAILED"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      ok: false,
      outcome: "failed",
      code: "TALANA_CRON_FAILED",
      health: "unhealthy",
      errorCode: "TALANA_AUTH_FAILED",
    })
    expect(mocks.loggerError).toHaveBeenCalledWith("[cron/talana-workers-sync]", { code: "TALANA_AUTH_FAILED" })
  })

  it("clasifica un error desconocido como TALANA_SYNC_FAILED sin filtrar su mensaje", async () => {
    mocks.runTalanaSync.mockRejectedValue(new Error(`boom con ${TOKEN} y 12.345.678-5`))
    const response = await GET(request())
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(JSON.parse(body)).toMatchObject({ outcome: "failed", errorCode: "TALANA_SYNC_FAILED" })
    expect(body).not.toContain(TOKEN)
    expect(mocks.loggerError).toHaveBeenCalledWith("[cron/talana-workers-sync]", { code: "TALANA_SYNC_FAILED" })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(TOKEN)
  })

  it("informa una corrida solapada como conflicto", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "TALANA_CRON_ACTIVE_RUN" })
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })

  it("informa como falla, no como conflicto sano, una corrida que retiene el candado más allá del umbral", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    mocks.hasStalledTalanaRun.mockResolvedValue(true)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", health: "unhealthy", errorCode: "TALANA_SYNC_STALLED" })
    expect(mocks.loggerError).toHaveBeenCalledWith("[cron/talana-workers-sync]", { code: "TALANA_SYNC_STALLED" })
  })

  it("si no puede comprobar la corrida colgada, lo trata como conflicto", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    mocks.hasStalledTalanaRun.mockRejectedValue(new Error("db caída"))
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict" })
  })

  it("limita la frecuencia antes de autenticar o tocar Talana", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ outcome: "rate_limited", code: "TALANA_CRON_RATE_LIMITED" })
    expect(mocks.consumeFixedWindowLimit).toHaveBeenCalledWith("cron:talana-workers:unknown", { maxAttempts: 10, lockMs: 60_000 })
    expect(mocks.runTalanaSync).not.toHaveBeenCalled()
  })
})
