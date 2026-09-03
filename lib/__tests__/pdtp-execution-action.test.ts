/**
 * Task W2: markPdtpExecutionAction must forward the highlighted evidence
 * URL without duplicating it in the additional-evidence array.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockGuardAnyPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockMarkPdtpExecution = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", async (importOriginal) => {
  // `can(session, "prevention:pdtp:execute")` sigue siendo el real: el action
  // lo usa para decidir si exige `assertPdtpActivityMechanism` (G17), y
  // reemplazarlo por un mock roto habría hecho que la acción fallara con
  // "can is not a function" antes de llegar a markPdtpExecution.
  const actual = await importOriginal<typeof import("@/lib/auth/can")>()
  return {
    ...actual,
    guardPermission: mockGuardPermission,
    guardAnyPermission: mockGuardAnyPermission,
  }
})
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  markPdtpExecution: mockMarkPdtpExecution,
  approvePdtpProgramJdpr: vi.fn(),
  signPdtpProgramLegal: vi.fn(),
  activatePdtpProgram: vi.fn(),
  approvePdtpExecution: vi.fn(),
  updatePdtpActivity: vi.fn(),
  addPdtpActivity: vi.fn(),
  // G17: sólo se ejercita cuando la sesión no tiene prevention:pdtp:execute;
  // estos tests siempre lo tienen, así que basta con que exista.
  assertPdtpActivityMechanism: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

const session = {
  user: {
    id: "user-1",
    permissions: ["prevention:pdtp:execute"],
  },
}

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

describe("markPdtpExecutionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    // markPdtpExecutionAction pasó a guardAnyPermission(["prevention:pdtp:execute",
    // "prevention:constancias:execute"]) desde G17 (2026-09-02): un permiso no
    // debe ser prerrequisito del otro.
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockMarkPdtpExecution.mockResolvedValue({ id: "exec-1" })
  })

  it("forwards evidenceUrl without duplicating it as an additional attachment", async () => {
    const { markPdtpExecutionAction } = await import("@/app/(app)/prevencion/pdtp/actions")

    const fd = makeFormData({
      activityId: "act-1",
      worksiteId: "ws-1",
      year: "2026",
      month: "1",
      week: "1",
      executedQuantity: "3",
      evidenceText: "Charla realizada",
      evidenceUrl: "storage/pdtp-evidence/abc123.pdf",
    })

    const res = await markPdtpExecutionAction(fd)

    expect(res.ok).toBe(true)
    expect(mockGuardAnyPermission).toHaveBeenCalledWith(["prevention:pdtp:execute", "prevention:constancias:execute"])
    expect(mockMarkPdtpExecution).toHaveBeenCalledTimes(1)
    const input = mockMarkPdtpExecution.mock.calls[0]![0]
    expect(input.evidenceUrl).toBe("storage/pdtp-evidence/abc123.pdf")
    expect(input.evidencePhotos).toEqual([])
  })

  it("passes empty evidenceUrl/evidencePhotos when no file was uploaded", async () => {
    const { markPdtpExecutionAction } = await import("@/app/(app)/prevencion/pdtp/actions")

    const fd = makeFormData({
      activityId: "act-1",
      worksiteId: "ws-1",
      year: "2026",
      month: "1",
      week: "1",
      executedQuantity: "3",
      evidenceText: "",
    })

    const res = await markPdtpExecutionAction(fd)

    expect(res.ok).toBe(true)
    const input = mockMarkPdtpExecution.mock.calls[0]![0]
    expect(input.evidenceUrl).toBe("")
    expect(input.evidencePhotos).toEqual([])
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { markPdtpExecutionAction } = await import("@/app/(app)/prevencion/pdtp/actions")

    // activityId vacío viola pdtpExecutionSchema (min 1) — debe rechazarse
    // en el boundary, sin invocar markPdtpExecution.
    const fd = makeFormData({
      activityId: "",
      worksiteId: "ws-1",
      year: "2026",
      month: "1",
      week: "1",
      executedQuantity: "3",
    })

    const res = await markPdtpExecutionAction(fd)

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.activityId).toBeDefined()
    expect(mockMarkPdtpExecution).not.toHaveBeenCalled()
  })
})
