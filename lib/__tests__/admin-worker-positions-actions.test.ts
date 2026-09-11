import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockCreatePosition = vi.hoisted(() => vi.fn())
const mockUpdatePosition = vi.hoisted(() => vi.fn())
const mockAddAlias = vi.hoisted(() => vi.fn())
const mockRemoveAlias = vi.hoisted(() => vi.fn())
const mockReplaceCapabilities = vi.hoisted(() => vi.fn())
const mockMergePositions = vi.hoisted(() => vi.fn())
const mockCreateCapability = vi.hoisted(() => vi.fn())
const mockUpdateCapability = vi.hoisted(() => vi.fn())
const actualDomainError = vi.hoisted(() => class WorkerPositionDomainError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = "WorkerPositionDomainError"
  }
})

vi.mock("@/lib/auth/can", () => ({ requirePermission: mockRequirePermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/worker-positions", () => ({
  createWorkerPosition: mockCreatePosition,
  updateWorkerPosition: mockUpdatePosition,
  addWorkerPositionAlias: mockAddAlias,
  removeWorkerPositionAlias: mockRemoveAlias,
  replaceWorkerPositionCapabilities: mockReplaceCapabilities,
  mergeWorkerPositions: mockMergePositions,
  createWorkerCapability: mockCreateCapability,
  updateWorkerCapability: mockUpdateCapability,
  WorkerPositionDomainError: actualDomainError,
}))

import {
  addWorkerPositionAliasAction,
  mergeWorkerPositionsAction,
  createWorkerPositionAction,
  reviewWorkerPositionAction,
  toggleWorkerPositionActiveAction,
} from "@/app/(app)/admin/cargos/actions"
import type { ActionState } from "@/lib/form-state"

const previous: ActionState = { ok: false }

function session() {
  return {
    user: {
      id: "user-1",
      email: "prevencion@test.cl",
      permissions: ["admin:worker_positions"],
    },
  }
}

describe("acciones del catálogo de cargos", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(session())
  })

  it("protege cada mutación con admin:worker_positions", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("forbidden"))
    const result = await createWorkerPositionAction(previous, new FormData())

    expect(result).toEqual({ ok: false, message: "Sin permisos para administrar cargos." })
    expect(mockCreatePosition).not.toHaveBeenCalled()
  })

  it("crea un cargo y sus capacidades en una sola acción visible", async () => {
    mockCreatePosition.mockResolvedValue({
      id: "pos-conductor",
      code: "CONDUCTOR",
      name: "Conductor",
      isActive: true,
      needsReview: false,
    })
    const form = new FormData()
    form.set("code", "CONDUCTOR")
    form.set("name", "Conductor")
    form.append("capabilityIds", "cap-drive")
    form.append("capabilityIds", "cap-equipment")

    const result = await createWorkerPositionAction(previous, form)

    expect(result).toEqual({ ok: true, message: "Cargo Conductor creado." })
    expect(mockCreatePosition).toHaveBeenCalledWith({
      code: "CONDUCTOR",
      name: "Conductor",
      isActive: true,
      needsReview: false,
    })
    expect(mockReplaceCapabilities).toHaveBeenCalledWith({
      positionId: "pos-conductor",
      capabilityIds: ["cap-drive", "cap-equipment"],
      actorUserId: "user-1",
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "worker_position",
      entityId: "pos-conductor",
    }))
  })

  it("marca un cargo como revisado sin alterar su identidad", async () => {
    mockUpdatePosition.mockResolvedValue({
      id: "pos-operador",
      code: "OPERADOR",
      name: "Operador",
      isActive: true,
      needsReview: false,
    })
    const form = new FormData()
    form.set("id", "pos-operador")
    form.set("code", "OPERADOR")
    form.set("name", "Operador")

    const result = await reviewWorkerPositionAction(previous, form)

    expect(mockUpdatePosition).toHaveBeenCalledWith("pos-operador", {
      code: "OPERADOR",
      name: "Operador",
      isActive: true,
      needsReview: false,
    })
    expect(result.ok).toBe(true)
  })

  it("desactiva el cargo conservando trabajadores e historia", async () => {
    mockUpdatePosition.mockResolvedValue({
      id: "pos-operador",
      code: "OPERADOR",
      name: "Operador",
      isActive: false,
      needsReview: false,
    })
    const form = new FormData()
    form.set("id", "pos-operador")
    form.set("code", "OPERADOR")
    form.set("name", "Operador")
    form.set("activate", "false")

    const result = await toggleWorkerPositionActiveAction(previous, form)

    expect(mockUpdatePosition).toHaveBeenCalledWith("pos-operador", expect.objectContaining({ isActive: false }))
    expect(result.message).toBe("Cargo Operador desactivado.")
  })

  it("devuelve el mensaje del error de dominio en vez de uno genérico", async () => {
    // La envoltura distingue el error de dominio con `instanceof`: si el
    // servicio y las acciones dejan de compartir la clase, esto se cae.
    mockCreatePosition.mockRejectedValue(new actualDomainError("El código OPERADOR ya está en uso.", "CONFLICT"))
    const form = new FormData()
    form.set("code", "OPERADOR")
    form.set("name", "Operador")

    const result = await createWorkerPositionAction(previous, form)

    expect(result).toEqual({ ok: false, message: "El código OPERADOR ya está en uso." })
  })

  it("agrega un alias auditado al cargo canónico", async () => {
    mockAddAlias.mockResolvedValue({ id: "alias-1", alias: "Chofer", positionId: "pos-conductor" })
    const form = new FormData()
    form.set("positionId", "pos-conductor")
    form.set("alias", "Chofer")

    const result = await addWorkerPositionAliasAction(previous, form)

    expect(mockAddAlias).toHaveBeenCalledWith({
      positionId: "pos-conductor",
      alias: "Chofer",
      source: "manual",
      actorUserId: "user-1",
    })
    expect(result.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "worker_position_alias" }))
  })

  it("fusiona un cargo duplicado y audita a dónde fue a parar", async () => {
    mockMergePositions.mockResolvedValue({
      target: { id: "pos-conductor", code: "CONDUCTOR", name: "Conductor" },
      movedWorkers: 3,
      movedAliases: 1,
    })
    const form = new FormData()
    form.set("sourceId", "pos-chofer")
    form.set("targetId", "pos-conductor")

    const result = await mergeWorkerPositionsAction(previous, form)

    expect(mockMergePositions).toHaveBeenCalledWith({
      sourceId: "pos-chofer", targetId: "pos-conductor", actorUserId: "user-1",
    })
    expect(result).toMatchObject({ ok: true })
    expect(result.message).toContain("3 trabajador(es)")
    // La auditoría tiene que dejar dicho a qué cargo fue a parar el duplicado:
    // es lo único que explica después por qué esa gente cambió de cargo.
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "pos-chofer",
      newState: expect.objectContaining({ mergedInto: "pos-conductor", movedWorkers: 3 }),
    }))
  })

  it("exige elegir el cargo que se conserva", async () => {
    const form = new FormData()
    form.set("sourceId", "pos-chofer")

    const result = await mergeWorkerPositionsAction(previous, form)

    expect(result.fieldErrors?.targetId).toBeTruthy()
    expect(mockMergePositions).not.toHaveBeenCalled()
  })
})
