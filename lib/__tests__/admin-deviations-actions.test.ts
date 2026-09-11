/**
 * Server actions del catálogo maestro de desviaciones.
 *
 * Lo que importa acá no es que guarde —eso lo prueba el servicio contra
 * Postgres—, sino las tres cosas que la capa de acción aporta: el permiso, la
 * validación del formulario, y que se revalide también la pantalla de
 * plantillas, que es donde el maestro se usa para elegir qué ofrece cada
 * instrumento.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all" }) }))
vi.mock("@/lib/services/prevention-deviations", () => ({
  createMasterDeviation: mockCreate,
  updateMasterDeviation: mockUpdate,
}))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))

import { saveDeviationAction, setDeviationStatusAction } from "@/app/(app)/admin/desviaciones/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "prev@test.cl",
      name: "Prevención",
      roles: ["prevencionista"],
      permissions: ["admin:deviation_catalog"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function formOf(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

describe("saveDeviationAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("exige el permiso del catálogo maestro", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))
    const result = await saveDeviationAction(prevState, formOf({ label: "Piso resbaloso", danoPotencial: "grave" }))
    expect(result.ok).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza una etiqueta demasiado corta sin llamar al servicio", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    const result = await saveDeviationAction(prevState, formOf({ label: "ab", danoPotencial: "grave" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.label).toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rechaza una gravedad fuera de la escala", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    const result = await saveDeviationAction(prevState, formOf({ label: "Piso resbaloso", danoPotencial: "altísimo" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.danoPotencial).toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("crea, audita y revalida también la pantalla de plantillas", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockCreate.mockResolvedValue({ id: "devcat-1", label: "Piso resbaloso", danoPotencial: "grave" })

    const result = await saveDeviationAction(prevState, formOf({ label: "Piso resbaloso", danoPotencial: "grave" }))

    expect(result.ok).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith({ label: "Piso resbaloso", danoPotencial: "grave" }, expect.anything())
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "create", entityType: "prevention_deviation", entityId: "devcat-1",
    }))
    // Sin esto, una desviación recién creada no aparece en el selector de
    // plantillas hasta la siguiente recarga completa.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/inspecciones/plantillas")
  })

  it("con id edita en vez de crear", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockUpdate.mockResolvedValue({
      before: { label: "Piso resbaloso", danoPotencial: "moderado" },
      after: { id: "devcat-1", label: "Piso resbaloso", danoPotencial: "grave" },
    })

    const result = await saveDeviationAction(prevState, formOf({
      id: "devcat-1", label: "Piso resbaloso", danoPotencial: "grave",
    }))

    expect(result.ok).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      { id: "devcat-1", label: "Piso resbaloso", danoPotencial: "grave" },
      expect.anything(),
    )
  })

  it("devuelve el mensaje del servicio cuando la etiqueta ya existe", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockCreate.mockRejectedValue(new Error("Esa desviación ya está en el catálogo maestro."))
    const result = await saveDeviationAction(prevState, formOf({ label: "Piso resbaloso", danoPotencial: "grave" }))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/ya está en el catálogo/)
  })
})

describe("setDeviationStatusAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("exige el permiso del catálogo maestro", async () => {
    mockRequirePermission.mockRejectedValue(new Error("forbidden"))
    const result = await setDeviationStatusAction(prevState, formOf({ id: "devcat-1", isActive: "false" }))
    expect(result.ok).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("retira dejando constancia de por qué", async () => {
    mockRequirePermission.mockResolvedValue(makeSession())
    mockUpdate.mockResolvedValue({
      before: { isActive: true },
      after: { id: "devcat-1", label: "Piso resbaloso", isActive: false },
    })

    const result = await setDeviationStatusAction(prevState, formOf({ id: "devcat-1", isActive: "false" }))

    expect(result.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith({ id: "devcat-1", isActive: false }, expect.anything())
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      reason: "Retirada del catálogo maestro",
    }))
  })
})
