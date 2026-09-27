/**
 * W5-GC (T7a, D13): el endpoint manual de administración borraba por omisión,
 * mientras el cron quedó en modo de prueba. Dos puertas al mismo barrido con
 * políticas distintas son una puerta abierta: las dos obedecen ahora a
 * `PDTP_EVIDENCE_GC_DELETE`, y la fila de auditoría lleva a la persona.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  cleanup: vi.fn(),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: () => mocks.auth() }))
vi.mock("@/lib/auth/can", () => ({ can: (...args: unknown[]) => Reflect.apply(mocks.can, null, args) }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/services/pdtp/evidence-gc", () => ({
  MIN_ORPHAN_AGE_MS: 60 * 60 * 1000,
  cleanupPdtpEvidenceOrphans: (...args: unknown[]) => Reflect.apply(mocks.cleanup, null, args),
}))

const { POST } = await import("./route")

function call(query = "") {
  return POST(new NextRequest(`http://app:3000/api/prevencion/pdtp/evidence/gc${query}`, { method: "POST" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.PDTP_EVIDENCE_GC_DELETE
  mocks.auth.mockResolvedValue({ user: { id: "admin-1" } })
  mocks.can.mockReturnValue(true)
  mocks.cleanup.mockResolvedValue({ scanned: 0, deleted: 0, kept: 0, failed: 0, deletedNames: [] })
})

describe("POST /api/prevencion/pdtp/evidence/gc", () => {
  it("sin la variable no borra aunque no se pida dryRun", async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ dryRun: true })
    expect(mocks.cleanup).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, actorUserId: "admin-1" }))
  })

  it("con PDTP_EVIDENCE_GC_DELETE=true borra, y ?dryRun=true lo evita", async () => {
    process.env.PDTP_EVIDENCE_GC_DELETE = "true"
    await call()
    expect(mocks.cleanup).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }))
    await call("?dryRun=true")
    expect(mocks.cleanup).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it("rechaza una ventana menor a una hora", async () => {
    const response = await call("?olderThanMs=1000")
    expect(response.status).toBe(400)
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })

  it("sin permiso responde 403", async () => {
    mocks.can.mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })
})
