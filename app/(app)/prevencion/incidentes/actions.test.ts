import { beforeEach, describe, expect, it, vi } from "vitest"

const guardMock = vi.fn()
const triageMock = vi.fn()
const reportMock = vi.fn()
const sensitiveMock = vi.fn()
const convertMock = vi.fn()
const discardMock = vi.fn()

vi.mock("@/lib/auth/can", () => ({ guardPermission: guardMock }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-a"] }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-incidents", () => ({
  addPreventionIncidentEvidence: vi.fn(),
  authorizePreventionIncidentRestart: vi.fn(),
  createPreventionIncidentCapa: vi.fn(),
  recordPreventionIncidentNotification: vi.fn(),
  reportPreventionIncident: reportMock,
  savePreventionIncidentInvestigation: vi.fn(),
  transitionPreventionIncident: vi.fn(),
  triagePreventionIncident: triageMock,
  savePreventionIncidentPersonSensitive: sensitiveMock,
}))
vi.mock("@/lib/services/prevention-incident-reports", () => ({
  convertPublicIncidentReport: convertMock,
  discardPublicIncidentReport: discardMock,
}))

describe("incident server actions are authorization boundaries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("blocks a forged triage action before the service is called", async () => {
    guardMock.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const { triagePreventionIncidentAction } = await import("./actions")
    await expect(triagePreventionIncidentAction({ incidentId: "inc-foreign" })).resolves.toEqual({ ok: false, message: "No tienes permisos" })
    expect(guardMock).toHaveBeenCalledWith("prevention:incidents:triage")
    expect(triageMock).not.toHaveBeenCalled()
  })

  it("derives actor and scope from the authenticated session, not from input", async () => {
    guardMock.mockResolvedValue({
      session: { user: { id: "trusted-user", permissions: ["prevention:incidents:report"] } },
      error: null,
    })
    reportMock.mockResolvedValue({ incident: { id: "inc-created" }, idempotentReplay: false })
    const { reportPreventionIncidentAction } = await import("./actions")
    await reportPreventionIncidentAction({ reportedByUserId: "forged-user", worksiteId: "ws-a" })
    expect(reportMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ reportedByUserId: "forged-user" }),
      access: expect.objectContaining({ ctx: { userId: "trusted-user" }, scope: { mode: "some", ids: ["ws-a"] } }),
    }))
  })

  /* FX-B: las acciones nuevas cortan antes del servicio con el permiso que
   * corresponde al acto, no con uno más laxo. */
  it("guards the reserved person record with view_sensitive", async () => {
    guardMock.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const { savePreventionIncidentPersonSensitiveAction } = await import("./actions")
    await expect(savePreventionIncidentPersonSensitiveAction({ incidentId: "inc-1" })).resolves.toEqual({ ok: false, message: "No tienes permisos" })
    expect(guardMock).toHaveBeenCalledWith("prevention:incidents:view_sensitive")
    expect(sensitiveMock).not.toHaveBeenCalled()
  })

  it("guards converting and discarding a public report with triage", async () => {
    guardMock.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const { convertPublicIncidentReportAction, discardPublicIncidentReportAction } = await import("./actions")
    await convertPublicIncidentReportAction({ reportId: "rpt-1" })
    await discardPublicIncidentReportAction({ reportId: "rpt-1", reason: "Reporte repetido del mismo evento." })
    expect(guardMock.mock.calls).toEqual([["prevention:incidents:triage"], ["prevention:incidents:triage"]])
    expect(convertMock).not.toHaveBeenCalled()
    expect(discardMock).not.toHaveBeenCalled()
  })
})
