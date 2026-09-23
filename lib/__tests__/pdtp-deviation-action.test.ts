/**
 * Task 9 (M2.1): `recordPdtpDeviationAction`/`withdrawPdtpDeviationAction`
 * aceptan `prevention:constancias:execute` como alternativa a
 * `prevention:pdtp:execute` (`not_performed`) y a
 * `prevention:pdtp:override:manage` (`not_applicable`), pero acotado por
 * mecanismo: sólo sobre actividades `mechanism = 'constancia'` — mismo
 * criterio que ya usa `markPdtpExecutionAction` (G17). `reprogrammed` NO
 * tiene esa alternativa: sigue exigiendo el permiso de metas por faena sin
 * excepción.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockGuardAnyPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockRecordPdtpDeviation = vi.hoisted(() => vi.fn())
const mockWithdrawPdtpDeviation = vi.hoisted(() => vi.fn())
const mockGetPdtpDeviationKindAndActivity = vi.hoisted(() => vi.fn())
const mockAssertPdtpActivityMechanism = vi.hoisted(() => vi.fn())
const mockRevalidateOperationalViews = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", async (importOriginal) => {
  // `can(session, permission)` se deja real: la acción lo usa para decidir
  // si tiene que acotar por mecanismo, y un mock roto lo rompería antes de
  // llegar a esa decisión.
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
  recordPdtpDeviation: mockRecordPdtpDeviation,
  withdrawPdtpDeviation: mockWithdrawPdtpDeviation,
  getPdtpDeviationKindAndActivity: mockGetPdtpDeviationKindAndActivity,
  assertPdtpActivityMechanism: mockAssertPdtpActivityMechanism,
}))
vi.mock("@/lib/services/operational-cache", () => ({
  revalidateOperationalViews: mockRevalidateOperationalViews,
}))

function sessionWith(...permissions: string[]) {
  return { user: { id: "user-1", permissions } }
}

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const BASE_FIELDS = {
  activityId: "act-1",
  worksiteId: "ws-1",
  year: "2026",
  month: "3",
  week: "2",
  reason: "Motivo suficientemente largo para pasar la validación del formulario.",
}

describe("recordPdtpDeviationAction — permisos por mecanismo (Task 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockRecordPdtpDeviation.mockResolvedValue({ id: "dev-1" })
  })

  it("un usuario con sólo prevention:constancias:execute puede declarar not_applicable sobre una actividad mechanism='constancia'", async () => {
    const { recordPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    const session = sessionWith("prevention:constancias:execute")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockAssertPdtpActivityMechanism.mockResolvedValue(undefined)

    const fd = makeFormData({ ...BASE_FIELDS, kind: "not_applicable" })
    const result = await recordPdtpDeviationAction(fd)

    expect(mockGuardAnyPermission).toHaveBeenCalledWith(["prevention:pdtp:override:manage", "prevention:constancias:execute"])
    // Sin el permiso fuerte (override:manage), la acción no confía en la UI:
    // acota por mecanismo antes de llamar al servicio.
    expect(mockAssertPdtpActivityMechanism).toHaveBeenCalledWith("act-1", "constancia")
    expect(mockRecordPdtpDeviation).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    // Constancias tiene que enterarse de este desvío igual que /prevencion/pdtp.
    expect(mockRevalidateOperationalViews).toHaveBeenCalledWith(
      ["/prevencion/pdtp", "/prevencion/constancias"],
      { worksiteId: "ws-1" },
    )
  })

  it("el mismo usuario NO puede declarar not_applicable sobre una actividad que no es 'constancia'", async () => {
    const { recordPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    const session = sessionWith("prevention:constancias:execute")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockAssertPdtpActivityMechanism.mockRejectedValue(new Error("Esta actividad no se puede registrar desde Constancias."))

    const fd = makeFormData({ ...BASE_FIELDS, kind: "not_applicable" })
    const result = await recordPdtpDeviationAction(fd)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no se puede registrar desde Constancias/)
    expect(mockRecordPdtpDeviation).not.toHaveBeenCalled()
  })

  it("un usuario con prevention:pdtp:override:manage no necesita el acotamiento por mecanismo", async () => {
    const { recordPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    const session = sessionWith("prevention:pdtp:override:manage")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })

    const fd = makeFormData({ ...BASE_FIELDS, kind: "not_applicable" })
    const result = await recordPdtpDeviationAction(fd)

    expect(result.ok).toBe(true)
    expect(mockAssertPdtpActivityMechanism).not.toHaveBeenCalled()
    expect(mockRecordPdtpDeviation).toHaveBeenCalledTimes(1)
  })

  it("not_performed acepta indistintamente prevention:pdtp:execute o prevention:constancias:execute", async () => {
    const { recordPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    const session = sessionWith("prevention:constancias:execute")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockAssertPdtpActivityMechanism.mockResolvedValue(undefined)

    const fd = makeFormData({ ...BASE_FIELDS, kind: "not_performed" })
    const result = await recordPdtpDeviationAction(fd)

    expect(mockGuardAnyPermission).toHaveBeenCalledWith(["prevention:pdtp:execute", "prevention:constancias:execute"])
    expect(mockAssertPdtpActivityMechanism).toHaveBeenCalledWith("act-1", "constancia")
    expect(result.ok).toBe(true)
  })

  it("reprogrammed sigue exigiendo únicamente prevention:pdtp:override:manage, sin alternativa de Constancias", async () => {
    const { recordPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    mockGuardAnyPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })

    const fd = makeFormData({ ...BASE_FIELDS, kind: "reprogrammed", targetMonth: "4", targetWeek: "1" })
    const result = await recordPdtpDeviationAction(fd)

    expect(mockGuardAnyPermission).toHaveBeenCalledWith(["prevention:pdtp:override:manage"])
    expect(result.ok).toBe(false)
    expect(mockRecordPdtpDeviation).not.toHaveBeenCalled()
  })
})

describe("withdrawPdtpDeviationAction — mismo criterio de permisos que declarar (Task 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockWithdrawPdtpDeviation.mockResolvedValue({ id: "dev-1" })
  })

  it("retira un not_applicable declarado desde Constancias con sólo prevention:constancias:execute, acotado por mecanismo", async () => {
    const { withdrawPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    mockGetPdtpDeviationKindAndActivity.mockResolvedValue({ kind: "not_applicable", activityId: "act-1" })
    const session = sessionWith("prevention:constancias:execute")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockAssertPdtpActivityMechanism.mockResolvedValue(undefined)

    const fd = makeFormData({
      deviationId: "dev-1",
      reason: "Motivo suficientemente largo para retirar el desvío.",
    })
    const result = await withdrawPdtpDeviationAction(fd)

    expect(mockGuardAnyPermission).toHaveBeenCalledWith(["prevention:pdtp:override:manage", "prevention:constancias:execute"])
    expect(mockAssertPdtpActivityMechanism).toHaveBeenCalledWith("act-1", "constancia")
    expect(result.ok).toBe(true)
    expect(mockRevalidateOperationalViews).toHaveBeenCalledWith(["/prevencion/pdtp", "/prevencion/constancias"])
  })

  it("no permite retirar un not_applicable de una actividad que no es 'constancia' con sólo el permiso de Constancias", async () => {
    const { withdrawPdtpDeviationAction } = await import("@/app/(app)/prevencion/pdtp/actions/deviations")
    mockGetPdtpDeviationKindAndActivity.mockResolvedValue({ kind: "not_applicable", activityId: "act-planilla" })
    const session = sessionWith("prevention:constancias:execute")
    mockGuardAnyPermission.mockResolvedValue({ session, error: null })
    mockAssertPdtpActivityMechanism.mockRejectedValue(new Error("Esta actividad no se puede registrar desde Constancias."))

    const fd = makeFormData({ deviationId: "dev-1", reason: "Motivo suficientemente largo para retirar el desvío." })
    const result = await withdrawPdtpDeviationAction(fd)

    expect(result.ok).toBe(false)
    expect(mockWithdrawPdtpDeviation).not.toHaveBeenCalled()
  })
})
