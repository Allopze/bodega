/**
 * PREV-I13: el escaneo de integridad sigue respondiendo `success` cuando
 * encuentra pérdidas (detectarlas es que el cron funciona), pero ahora además
 * avisa. La alerta nunca cambia el contrato de la ruta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  withCronLock: vi.fn(),
  scan: vi.fn(),
  alert: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: (...args: unknown[]) => Reflect.apply(mocks.verifyCronSecret, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: unknown[]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/pdtp/evidence-integrity", () => ({ scanPdtpEvidenceIntegrity: (...args: unknown[]) => Reflect.apply(mocks.scan, null, args) }))
vi.mock("@/lib/services/prevention-ops-alerts", () => ({ alertPdtpEvidenceIntegrityIssues: (...args: unknown[]) => Reflect.apply(mocks.alert, null, args) }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { GET } = await import("./route")

const request = () => new NextRequest("http://app:3000/api/cron/pdtp-evidence-integrity", { headers: { authorization: "Bearer secreto" } })

const LOSSES = {
  ok: false, references: 3, checkedFiles: 3, missingCount: 1, checksumMismatchCount: 0, withoutChecksum: 0,
  missing: [{ path: "storage/pdtp-evidence/perdida.pdf", owners: [] }], checksumMismatches: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "secreto"
  mocks.verifyCronSecret.mockReturnValue(true)
  mocks.withCronLock.mockImplementation(async (_name: string, run: () => Promise<unknown>) => run())
  mocks.alert.mockResolvedValue(undefined)
})

describe("GET /api/cron/pdtp-evidence-integrity — alerta", () => {
  it("con pérdidas avisa y sigue respondiendo success", async () => {
    mocks.scan.mockResolvedValue(LOSSES)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).outcome).toBe("success")
    expect(mocks.alert).toHaveBeenCalledWith(LOSSES)
  })

  it("una corrida saltada por el lock no avisa", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })
    const response = await GET(request())
    expect((await response.json()).outcome).toBe("skipped")
    expect(mocks.alert).not.toHaveBeenCalled()
  })
})
