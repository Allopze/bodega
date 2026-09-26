import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/pdtp/accreditation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/pdtp/accreditation")>()),
  resolvePdtpActivityIdsForNumbers: resolveMock,
}))

// Import dinámico por caso: los módulos se resuelven ya con el mock activo.
async function load() {
  const { resolvePdtpActivityIdsOrSkip } = await import("@/lib/services/pdtp-adapters/obligation-kit")
  const errors = await import("@/lib/services/pdtp/accreditation")
  return { resolvePdtpActivityIdsOrSkip, ...errors }
}

const input = { worksiteId: "ws-1", occurredAt: "2026-05-01T12:00:00.000Z", activityNumbers: [18], sourceType: "riohs", sourceId: "doc-1" }

beforeEach(() => { resolveMock.mockReset() })

describe("resolvePdtpActivityIdsOrSkip (PREV-I07)", () => {
  it("sin programa activo es 'no aplica': devuelve null", async () => {
    const { resolvePdtpActivityIdsOrSkip, PdtpNoActiveProgramError } = await load()
    resolveMock.mockImplementation(async () => { throw new PdtpNoActiveProgramError("sin programa") })
    await expect(resolvePdtpActivityIdsOrSkip(input)).resolves.toBeNull()
  })

  it("una faena fuera del programa es 'no aplica': devuelve null", async () => {
    const { resolvePdtpActivityIdsOrSkip, PdtpWorksiteNotInProgramError } = await load()
    resolveMock.mockImplementation(async () => { throw new PdtpWorksiteNotInProgramError("fuera") })
    await expect(resolvePdtpActivityIdsOrSkip(input)).resolves.toBeNull()
  })

  it("una falla de base de datos no se traga: se relanza", async () => {
    const { resolvePdtpActivityIdsOrSkip } = await load()
    resolveMock.mockImplementation(async () => { throw new Error("connection terminated unexpectedly") })
    await expect(resolvePdtpActivityIdsOrSkip(input)).rejects.toThrow(/connection terminated/)
  })

  it("devuelve la resolución cuando existe", async () => {
    const { resolvePdtpActivityIdsOrSkip } = await load()
    const resolved = { programId: "p", activityIdByN: new Map([[18, "a"]]) }
    resolveMock.mockResolvedValue(resolved)
    await expect(resolvePdtpActivityIdsOrSkip(input)).resolves.toBe(resolved)
  })
})
