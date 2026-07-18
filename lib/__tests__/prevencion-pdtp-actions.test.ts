/**
 * Unit tests para Server Actions de app/(app)/prevencion/pdtp/actions.ts
 * (cobertura previa: 4.66% statements).
 *
 * markPdtpExecutionAction ya está cubierto en pdtp-execution-action.test.ts;
 * este archivo cubre el resto: lifecycle, aprobaciones de ejecución,
 * CRUD de programa/hoja/actividad y las form-actions basadas en redirect.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn(() => ({ mode: "all" as const, ids: [] })))
const mockRedirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }))

const mockApprovePdtpProgramJdpr = vi.hoisted(() => vi.fn(async () => undefined))
const mockSignPdtpProgramLegal = vi.hoisted(() => vi.fn(async () => undefined))
const mockActivatePdtpProgram = vi.hoisted(() => vi.fn(async () => undefined))
const mockApprovePdtpExecution = vi.hoisted(() => vi.fn(async () => undefined))
const mockRejectPdtpExecution = vi.hoisted(() => vi.fn(async () => undefined))
const mockUpdatePdtpActivity = vi.hoisted(() => vi.fn(async () => undefined))
const mockAddPdtpActivity = vi.hoisted(() => vi.fn(async () => undefined))
const mockDeletePdtpActivity = vi.hoisted(() => vi.fn(async () => undefined))
const mockReorderPdtpActivities = vi.hoisted(() => vi.fn(async () => undefined))
const mockSetPdtpActivityOverride = vi.hoisted(() => vi.fn(async () => undefined))
const mockDeletePdtpActivityOverride = vi.hoisted(() => vi.fn(async () => undefined))
const mockCreatePdtpProgram = vi.hoisted(() => vi.fn(async () => ({ id: "prog-1" })))
const mockUpdatePdtpProgram = vi.hoisted(() => vi.fn(async () => undefined))
const mockDeletePdtpProgram = vi.hoisted(() => vi.fn(async () => undefined))
const mockCreatePdtpSheet = vi.hoisted(() => vi.fn(async () => undefined))
const mockDeletePdtpSheet = vi.hoisted(() => vi.fn(async () => undefined))
const mockRenamePdtpObjective = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/lib/auth/can", () => ({
  guardPermission: mockGuardPermission,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  markPdtpExecution: vi.fn(async () => undefined),
  approvePdtpProgramJdpr: mockApprovePdtpProgramJdpr,
  signPdtpProgramLegal: mockSignPdtpProgramLegal,
  activatePdtpProgram: mockActivatePdtpProgram,
  approvePdtpExecution: mockApprovePdtpExecution,
  rejectPdtpExecution: mockRejectPdtpExecution,
  updatePdtpActivity: mockUpdatePdtpActivity,
  addPdtpActivity: mockAddPdtpActivity,
  deletePdtpActivity: mockDeletePdtpActivity,
  reorderPdtpActivities: mockReorderPdtpActivities,
  setPdtpActivityOverride: mockSetPdtpActivityOverride,
  deletePdtpActivityOverride: mockDeletePdtpActivityOverride,
  createPdtpProgram: mockCreatePdtpProgram,
  updatePdtpProgram: mockUpdatePdtpProgram,
  deletePdtpProgram: mockDeletePdtpProgram,
  createPdtpSheet: mockCreatePdtpSheet,
  deletePdtpSheet: mockDeletePdtpSheet,
  renamePdtpObjective: mockRenamePdtpObjective,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))

import {
  approvePdtpProgramJdprAction,
  signPdtpProgramLegalAction,
  activatePdtpProgramAction,
  approvePdtpExecutionAction,
  rejectPdtpExecutionAction,
  updatePdtpActivityAction,
  addPdtpActivityAction,
  setPdtpActivityOverrideFormAction,
  createPdtpProgramAction,
  updatePdtpProgramAction,
  deletePdtpProgramAction,
  createPdtpSheetAction,
  deletePdtpSheetAction,
  deletePdtpActivityAction,
  reorderPdtpActivitiesAction,
  addPdtpActivityFormAction,
  renamePdtpObjectiveAction,
} from "@/app/(app)/prevencion/pdtp/actions"

function makeSession(permissions: string[] = ["prevention:pdtp:execute", "prevention:pdtp:program:manage", "prevention:pdtp:approve", "prevention:pdtp:sign_legal"]) {
  return { user: { id: "user-1", permissions } }
}

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
  mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
})

describe("Program lifecycle actions", () => {
  it("approvePdtpProgramJdprAction requiere permiso prevention:pdtp:approve", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const res = await approvePdtpProgramJdprAction("prog-1")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos")
  })

  it("approvePdtpProgramJdprAction aprueba con permiso", async () => {
    const res = await approvePdtpProgramJdprAction("prog-1")
    expect(res.ok).toBe(true)
    expect(mockApprovePdtpProgramJdpr).toHaveBeenCalledWith("prog-1", "user-1")
  })

  it("signPdtpProgramLegalAction requiere permiso prevention:pdtp:sign_legal", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const res = await signPdtpProgramLegalAction("prog-1")
    expect(res.ok).toBe(false)
  })

  it("signPdtpProgramLegalAction firma con permiso", async () => {
    const res = await signPdtpProgramLegalAction("prog-1")
    expect(res.ok).toBe(true)
    expect(mockSignPdtpProgramLegal).toHaveBeenCalledWith("prog-1", "user-1")
  })

  it("activatePdtpProgramAction activa con permiso", async () => {
    const res = await activatePdtpProgramAction("prog-1")
    expect(res.ok).toBe(true)
    expect(mockActivatePdtpProgram).toHaveBeenCalledWith("prog-1", "user-1")
  })

  it("oculta el detalle interno de un error de servicio", async () => {
    mockActivatePdtpProgram.mockRejectedValueOnce(new Error("Programa ya activo"))
    const res = await activatePdtpProgramAction("prog-1")
    expect(res.ok).toBe(false)
    expect(res.message).toBe("No se pudo completar la acción. Intenta nuevamente.")
  })
})

describe("Execution approval actions", () => {
  it("approvePdtpExecutionAction rechaza sin permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const res = await approvePdtpExecutionAction("exec-1")
    expect(res.ok).toBe(false)
  })

  it("approvePdtpExecutionAction aprueba ejecución válida", async () => {
    const res = await approvePdtpExecutionAction("exec-1")
    expect(res.ok).toBe(true)
    expect(mockApprovePdtpExecution).toHaveBeenCalledWith("exec-1", "user-1", "all")
  })

  it("rejectPdtpExecutionAction requiere motivo de al menos 3 caracteres", async () => {
    const res = await rejectPdtpExecutionAction("exec-1", "no")
    expect(res.ok).toBe(false)
  })

  it("rejectPdtpExecutionAction rechaza ejecución con motivo válido", async () => {
    const res = await rejectPdtpExecutionAction("exec-1", "Evidencia insuficiente")
    expect(res.ok).toBe(true)
    expect(mockRejectPdtpExecution).toHaveBeenCalledWith("exec-1", "user-1", "Evidencia insuficiente", "all")
  })
})

describe("Activity edit/add actions", () => {
  it("updatePdtpActivityAction actualiza actividad válida", async () => {
    const res = await updatePdtpActivityAction({ activityId: "act-1", activity: "Nueva descripción" })
    expect(res.ok).toBe(true)
    expect(mockUpdatePdtpActivity).toHaveBeenCalled()
  })

  it("updatePdtpActivityAction retorna error con input inválido", async () => {
    const res = await updatePdtpActivityAction({ activityId: "" })
    expect(res.ok).toBe(false)
  })

  it("addPdtpActivityAction agrega actividad válida", async () => {
    const res = await addPdtpActivityAction({
      programId: "prog-1",
      objectiveOrder: 1,
      objective: "Objetivo 1",
      activity: "Actividad 1",
      program: "Programa X",
      responsibleSlugs: ["resp-1"],
      responsibleDisplay: "Responsable Uno",
      sheetCodes: ["hoja-1"],
    })
    expect(res.ok).toBe(true)
    expect(mockAddPdtpActivity).toHaveBeenCalled()
  })

  it("deletePdtpActivityAction elimina actividad válida", async () => {
    const res = await deletePdtpActivityAction({ activityId: "act-1" })
    expect(res.ok).toBe(true)
    expect(mockDeletePdtpActivity).toHaveBeenCalledWith("act-1", "user-1")
  })

  it("reorderPdtpActivitiesAction reordena actividades", async () => {
    const res = await reorderPdtpActivitiesAction({ programId: "prog-1", orderedIds: ["act-1", "act-2"] })
    expect(res.ok).toBe(true)
    expect(mockReorderPdtpActivities).toHaveBeenCalledWith("prog-1", ["act-1", "act-2"], "user-1")
  })

  it("renamePdtpObjectiveAction renombra objetivo", async () => {
    const res = await renamePdtpObjectiveAction({ programId: "prog-1", objectiveOrder: 1, objective: "Nuevo objetivo" })
    expect(res.ok).toBe(true)
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:pdtp:program:manage")
    expect(mockRenamePdtpObjective).toHaveBeenCalled()
  })
})

describe("setPdtpActivityOverrideFormAction (redirect-based)", () => {
  it("redirige con error si falta permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const fd = makeFormData({ programId: "prog-1", activityId: "act-1", worksiteId: "ws-1", year: "2026", month: "1", week: "1", plannedQuantity: "5" })
    await expect(setPdtpActivityOverrideFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining("overrideError="))
  })

  it("fija override y redirige al detalle del programa", async () => {
    const fd = makeFormData({ programId: "prog-1", activityId: "act-1", worksiteId: "ws-1", year: "2026", month: "1", week: "1", plannedQuantity: "5" })
    await expect(setPdtpActivityOverrideFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:pdtp:program:manage")
    expect(mockSetPdtpActivityOverride).toHaveBeenCalled()
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining("/prevencion/pdtp/prog-1"))
  })

  it("elimina override cuando mode=delete", async () => {
    const fd = makeFormData({ programId: "prog-1", activityId: "act-1", worksiteId: "ws-1", year: "2026", month: "1", week: "1", plannedQuantity: "5", mode: "delete" })
    await expect(setPdtpActivityOverrideFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockDeletePdtpActivityOverride).toHaveBeenCalled()
    expect(mockSetPdtpActivityOverride).not.toHaveBeenCalled()
  })
})

describe("addPdtpActivityFormAction (redirect-based)", () => {
  it("redirige una sola vez con error si falta responsable", async () => {
    const fd = makeFormData({ programId: "prog-1", objectiveOrder: "1", objective: "Obj 1", activity: "Act 1", program: "Prog X", responsibleDisplay: "R1" })
    fd.append("sheetCodes[]", "hoja-1")
    await expect(addPdtpActivityFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining("al+menos+un+responsable"))
  })

  it("redirige una sola vez con error si falta hoja", async () => {
    const fd = makeFormData({ programId: "prog-1", objectiveOrder: "1", objective: "Obj 1", activity: "Act 1", program: "Prog X", responsibleDisplay: "R1" })
    fd.append("responsibleSlugs[]", "resp-1")
    await expect(addPdtpActivityFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringContaining("al+menos+una+hoja"))
  })

  it("agrega actividad y redirige al detalle sin error", async () => {
    const fd = makeFormData({ programId: "prog-1", objectiveOrder: "1", objective: "Obj 1", activity: "Act 1", program: "Prog X", responsibleDisplay: "R1" })
    fd.append("responsibleSlugs[]", "resp-1")
    fd.append("sheetCodes[]", "hoja-1")
    await expect(addPdtpActivityFormAction(fd)).rejects.toThrow("REDIRECT:")
    expect(mockAddPdtpActivity).toHaveBeenCalled()
    const redirectUrl = mockRedirect.mock.calls[0]![0] as string
    expect(redirectUrl).toContain("/prevencion/pdtp/prog-1")
    expect(redirectUrl).not.toContain("actividadError")
  })
})

describe("Program CRUD actions", () => {
  it("createPdtpProgramAction rechaza sin permiso", async () => {
    mockGuardPermission.mockResolvedValueOnce({ session: null, error: { ok: false, message: "No tienes permisos" } })
    const fd = makeFormData({ year: "2026", title: "Programa 2026" })
    const res = await createPdtpProgramAction(null, fd)
    expect(res.ok).toBe(false)
  })

  it("createPdtpProgramAction crea programa válido y redirige al editor", async () => {
    // redirect() server-side en éxito, no un router.push cliente — evita la
    // carrera con revalidatePath que dejaba el form varado en /nuevo (ver
    // AUDITORIA_INTEGRAL_CHOME.md Pasada 9).
    const fd = makeFormData({ year: "2026", title: "Programa 2026" })
    await expect(createPdtpProgramAction(null, fd)).rejects.toThrow("REDIRECT:")
    expect(mockGuardPermission).toHaveBeenCalledWith("prevention:pdtp:program:manage")
    expect(mockRedirect).toHaveBeenCalledWith("/prevencion/pdtp/prog-1/editar")
  })

  it("createPdtpProgramAction retorna error con año inválido", async () => {
    const fd = makeFormData({ year: "1999", title: "Programa antiguo" })
    const res = await createPdtpProgramAction(null, fd)
    expect(res.ok).toBe(false)
  })

  it("updatePdtpProgramAction actualiza programa válido", async () => {
    const fd = makeFormData({ programId: "prog-1", title: "Título actualizado" })
    const res = await updatePdtpProgramAction(null, fd)
    expect(res.ok).toBe(true)
    expect(mockUpdatePdtpProgram).toHaveBeenCalled()
  })

  it("deletePdtpProgramAction elimina programa válido", async () => {
    const fd = makeFormData({ programId: "prog-1" })
    const res = await deletePdtpProgramAction(null, fd)
    expect(res.ok).toBe(true)
    expect(mockDeletePdtpProgram).toHaveBeenCalledWith("prog-1")
  })
})

describe("Sheet CRUD actions", () => {
  it("createPdtpSheetAction crea hoja válida", async () => {
    const fd = makeFormData({ programId: "prog-1", code: "hoja_1", label: "Hoja 1", area: "Operaciones" })
    const res = await createPdtpSheetAction(null, fd)
    expect(res.ok).toBe(true)
    expect(mockCreatePdtpSheet).toHaveBeenCalled()
  })

  it("createPdtpSheetAction retorna error con código inválido", async () => {
    const fd = makeFormData({ programId: "prog-1", code: "Hoja Uno!", label: "Hoja 1", area: "Operaciones" })
    const res = await createPdtpSheetAction(null, fd)
    expect(res.ok).toBe(false)
  })

  it("deletePdtpSheetAction elimina hoja válida", async () => {
    const fd = makeFormData({ sheetId: "sheet-1", programId: "prog-1" })
    const res = await deletePdtpSheetAction(null, fd)
    expect(res.ok).toBe(true)
    expect(mockDeletePdtpSheet).toHaveBeenCalledWith("sheet-1", "prog-1")
  })
})
