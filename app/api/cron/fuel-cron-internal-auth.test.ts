import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Sin mock de `@/lib/security/cron-auth`: lo que se prueba es esa compuerta.
// El 2026-10-29 el cron de Copec llevaba desde su creación respondiendo 401 en
// producción: `CRON_ALLOWED_SOURCES` estaba vacío y el scheduler interno llama a
// `http://app:3000` sin `X-Forwarded-For`, así que el origen nunca calzaba.
const mocks = vi.hoisted(() => ({
  isRouteOperational: vi.fn(async () => true),
  syncCopecReports: vi.fn(),
  syncAramco: vi.fn(),
  readAramcoConfig: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
  consumeFixedWindowLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
}))

vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/combustibles/copec-sync", () => ({ syncCopecReports: (...args: unknown[]) => Reflect.apply(mocks.syncCopecReports, null, args) }))
vi.mock("@/lib/combustibles/aramco-sync", () => ({ syncAramco: (...args: unknown[]) => Reflect.apply(mocks.syncAramco, null, args) }))
vi.mock("@/lib/combustibles/aramco-settings", () => ({ readAramcoConfig: (...args: unknown[]) => Reflect.apply(mocks.readAramcoConfig, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const copecRoute = await import("./fuel-copec-sync/route")
const aramcoRoute = await import("./fuel-aramco-sync/route")

const ROUTES = [
  { name: "fuel-copec-sync", GET: copecRoute.GET, sync: mocks.syncCopecReports },
  { name: "fuel-aramco-sync", GET: aramcoRoute.GET, sync: mocks.syncAramco },
] as const

/** Lo que manda `scripts/cron-runner.mjs` desde el contenedor `cron`: sin cabeceras de proxy. */
function schedulerRequest(name: string, extra: Record<string, string> = {}) {
  return new NextRequest(`http://app:3000/api/cron/${name}`, { headers: { authorization: "Bearer cron-secret", ...extra } })
}

describe.each(ROUTES)("autenticación del scheduler interno en /api/cron/$name", ({ name, GET, sync }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CRON_SECRET", "cron-secret")
    vi.stubEnv("CRON_ALLOWED_SOURCES", "")
    vi.stubEnv("FUEL_CRON_INTERNAL_SECRET", "fuel-internal-secret")
    vi.stubEnv("COPEC_USERNAME", "usuario")
    vi.stubEnv("COPEC_PASSWORD", "clave")
    mocks.readAramcoConfig.mockResolvedValue({ hasCredentials: true, syncEnabled: true })
    mocks.syncCopecReports.mockResolvedValue({ imported: 0 })
    mocks.syncAramco.mockResolvedValue({ imported: 0 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("rechaza el Bearer solo cuando no hay origen permitido (el 401 de producción)", async () => {
    const response = await GET(schedulerRequest(name))
    expect(response.status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })

  it("acepta al scheduler interno con el secreto propio de combustibles", async () => {
    const response = await GET(schedulerRequest(name, { "x-fuel-cron-secret": "fuel-internal-secret" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FUEL_CRON_SUCCESS" })
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it("rechaza un secreto interno equivocado", async () => {
    const response = await GET(schedulerRequest(name, { "x-fuel-cron-secret": "otro-secreto" }))
    expect(response.status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })

  it("no acepta el camino interno si su secreto es el mismo CRON_SECRET", async () => {
    vi.stubEnv("FUEL_CRON_INTERNAL_SECRET", "cron-secret")
    const response = await GET(schedulerRequest(name, { "x-fuel-cron-secret": "cron-secret" }))
    expect(response.status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })

  it("exige además el Bearer: el secreto interno solo no basta", async () => {
    const response = await GET(new NextRequest(`http://app:3000/api/cron/${name}`, { headers: { "x-fuel-cron-secret": "fuel-internal-secret" } }))
    expect(response.status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })

  it("sigue aceptando a un llamador externo cuyo origen está en la lista", async () => {
    vi.stubEnv("CRON_ALLOWED_SOURCES", "203.0.113.7")
    const response = await GET(schedulerRequest(name, { "x-forwarded-for": "203.0.113.7" }))
    expect(response.status).toBe(200)
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
