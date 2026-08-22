import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import {
  addMaintenancePart,
  createMaintenanceRecord,
  decideMaintenanceCostApproval,
  cancelMaintenanceRecord,
  getMaintenancePageData,
  getUpcomingMaintenance,
  getUsageMaintenanceAlerts,
  materializeDueMaintenancePlans,
  saveMaintenanceDocumentPolicy,
  setMaintenanceTaskStatus,
  updateMaintenanceRecord,
  transitionMaintenanceRecord,
  type CreateMaintenanceInput,
} from "@/lib/services/maintenance"
import { recordAudit } from "@/lib/audit"

const mockFindFirst = vi.fn()
const mockVehicleFindMany = vi.fn()
const mockCostCenterFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[])
const mockSupplierFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[])
const mockWorksiteFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[])
const mockMaintenanceFindFirst = vi.fn()
const mockMaintenanceFindMany = vi.fn()
const mockMaintenancePlanFindMany = vi.fn()
const mutationResults: unknown[][] = []
const mockInsertValues = vi.fn((_values?: unknown) => createChain(mutationResults.shift() ?? []))
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues })
const mockUpdateSet = vi.fn((_values?: unknown) => createChain(mutationResults.shift() ?? []))
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet })
const mockExecute = vi.fn(async (_query?: unknown) => [{ next_document_code: 1 }])
const mockPermissionTargetsForWorksite = vi.fn(async (_permission: unknown, _worksite: unknown) => [] as string[])
const selectResults: unknown[][] = []
const whereNodes: unknown[] = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn((where?: unknown) => {
    whereNodes.push(where)
    return chain
  })
  chain.for = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.groupBy = vi.fn(() => chain)
  chain.onConflictDoUpdate = vi.fn(() => chain)
  chain.returning = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

const mockSelect = vi.fn((_projection?: unknown) => createChain(selectResults.shift() ?? []))
const mockSelectDistinctOn = vi.fn((_columns?: unknown, _projection?: unknown) => createChain(selectResults.shift() ?? []))
const mockTransaction = vi.fn(async (callback: (tx: {
  update: typeof mockUpdate
  select: typeof mockSelect
  insert: typeof mockInsert
  execute: typeof mockExecute
}) => Promise<unknown>) => callback({ update: mockUpdate, select: mockSelect, insert: mockInsert, execute: mockExecute }))

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
        findMany: (...args: unknown[]) => mockVehicleFindMany(...args),
      },
      maintenanceRecords: {
        findFirst: (...args: unknown[]) => mockMaintenanceFindFirst(...args),
        findMany: (...args: unknown[]) => mockMaintenanceFindMany(...args),
      },
      maintenancePlans: { findMany: (...args: unknown[]) => mockMaintenancePlanFindMany(...args) },
      costCenters: { findMany: (...args: unknown[]) => mockCostCenterFindMany(...args) },
      suppliers: { findMany: (...args: unknown[]) => mockSupplierFindMany(...args) },
      worksites: { findMany: (...args: unknown[]) => mockWorksiteFindMany(...args) },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    transaction: (...args: [Parameters<typeof mockTransaction>[0]]) => mockTransaction(...args),
    select: (projection?: unknown) => mockSelect(projection),
    selectDistinctOn: (columns?: unknown, projection?: unknown) => mockSelectDistinctOn(columns, projection),
    execute: (query: unknown) => mockExecute(query),
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: vi.fn(async () => []),
  getUserIdsWithPermissionForWorksite: (...args: unknown[]) => mockPermissionTargetsForWorksite(args[0], args[1]),
}))

/** Trozos literales y parámetros de un predicado de Drizzle, sin levantar Postgres. */
function sqlChunks(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) sqlChunks(item, out)
    return out
  }
  const named = node as { name?: unknown; columnType?: unknown }
  if (typeof named.name === "string" && typeof named.columnType === "string") {
    out.push(named.name)
    return out
  }
  const candidate = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) sqlChunks(chunk, out)
    return out
  }
  if (typeof candidate.value === "string") out.push(candidate.value)
  else if (Array.isArray(candidate.value)) {
    for (const part of candidate.value) if (typeof part === "string") out.push(part)
  }
  return out
}

afterEach(() => {
  vi.clearAllMocks()
  selectResults.length = 0
  mutationResults.length = 0
  whereNodes.length = 0
  vi.useRealTimers()
})

describe("Maintenance Service (createMaintenanceRecord)", () => {
  const dummySession = {
    user: { id: "user-1", email: "mantencion@chome.cl", role: "admin", isGlobal: true, permissions: ["mantenciones:create"], worksiteIds: [] },
  } as unknown as Session

  it("rejects maintenance record creation for non-existent vehicle", async () => {
    selectResults.push([])

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-nonexistent",
      maintenanceDate: "2026-07-22",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 100000,
      taxAmount: 19000,
      totalAmount: 119000,
    }

    await expect(createMaintenanceRecord(dummySession, input)).rejects.toThrow("Vehículo no encontrado")
  })

  it("checks worksite access scope when session is restricted", async () => {
    selectResults.push([{ id: "veh-1", worksiteId: "ws-restricted", isActive: true }])

    const restrictedSession = {
      user: { id: "user-2", role: "user", permissions: ["mantenciones:create"], worksiteIds: ["ws-allowed"] },
    } as unknown as Session

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-1",
      maintenanceDate: "2026-07-22",
      maintenanceType: "correctiva",
      status: "in_progress",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    }

    await expect(createMaintenanceRecord(restrictedSession, input)).rejects.toThrow("No puedes registrar mantenciones para este vehículo")
  })

  it("fuerza montos cero si el actor puede registrar pero no ver costos", async () => {
    selectResults.push([{ id: "veh-1", worksiteId: "ws-1", isActive: true }])
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:create"] } } as unknown as Session

    await createMaintenanceRecord(session, {
      vehicleId: "veh-1",
      maintenanceDate: "2026-07-22",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 100000,
      taxAmount: 19000,
      totalAmount: 119000,
    })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ netAmount: 0, taxAmount: 0, totalAmount: 0 }))
  })

  // HALLAZGO 21: imputar a una faena propia no puede habilitar escribir sobre
  // un vehículo de otra faena.
  it("rechaza un vehículo de otra faena aunque la faena imputada esté en el alcance", async () => {
    selectResults.push([{ id: "veh-2", worksiteId: "ws-antofagasta", isActive: true }])

    const restrictedSession = {
      user: { id: "user-2", role: "user", permissions: ["mantenciones:create"], worksiteIds: ["ws-santiago"] },
    } as unknown as Session

    await expect(createMaintenanceRecord(restrictedSession, {
      vehicleId: "veh-2",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      status: "scheduled",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    })).rejects.toThrow("No puedes registrar mantenciones para este vehículo")
  })

  it("rechaza asignar la OT a un usuario sin alcance y permiso en la faena", async () => {
    selectResults.push([{ id: "veh-1", worksiteId: "ws-1", isActive: true, meterType: "odometer" }])
    mockPermissionTargetsForWorksite.mockResolvedValue(["allowed-user"])

    await expect(createMaintenanceRecord(dummySession, {
      vehicleId: "veh-1",
      assignedToUserId: "other-worksite-user",
      maintenanceDate: "2026-07-22",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    })).rejects.toThrow("El responsable no está activo o no puede gestionar mantenciones en esta faena")
  })
})

describe("Maintenance Service (updateMaintenanceRecord)", () => {
  it("preserva montos existentes sin consultarlos ni sobrescribirlos si el actor edita sin view_costs", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }],
    )
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session

    await updateMaintenanceRecord(session, "man-1", {
      vehicleId: "veh-1",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      netAmount: 1,
      taxAmount: 1,
      totalAmount: 2,
    })

    const projection = mockSelect.mock.calls[1]![0] as Record<string, unknown>
    expect(projection).not.toHaveProperty("netAmount")
    expect(projection).not.toHaveProperty("taxAmount")
    expect(projection).not.toHaveProperty("totalAmount")
    const update = mockUpdateSet.mock.calls[0]![0]
    expect(update).not.toHaveProperty("netAmount")
    expect(update).not.toHaveProperty("taxAmount")
    expect(update).not.toHaveProperty("totalAmount")
  })

  it("no permite que la edición genérica cambie el estado", async () => {
    selectResults.push([{ id: "veh-1", worksiteId: "ws-1", isActive: true }])
    selectResults.push([{
      id: "man-1",
      vehicleId: "veh-1",
      worksiteId: "ws-1",
      status: "in_progress",
      inspectionFindingId: "finding-1",
      maintenanceType: "preventiva",
      maintenanceDate: "2026-08-07",
    }])
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session

    await updateMaintenanceRecord(session, "man-1", {
      vehicleId: "veh-1",
      maintenanceDate: "2026-08-07",
      maintenanceType: "preventiva",
      netAmount: 1,
      taxAmount: 1,
      totalAmount: 2,
    })

    expect(mockUpdateSet.mock.calls[0]![0]).not.toHaveProperty("status")
    expect(mockInsertValues).not.toHaveBeenCalledWith(expect.objectContaining({ reference: "mantencion:man-1" }))
  })

  // HALLAZGO 21: misma causa — re-apuntar una mantención propia a un equipo ajeno.
  it("rechaza re-apuntar una mantención propia a un vehículo de otra faena", async () => {
    selectResults.push([{ id: "veh-2", worksiteId: "ws-antofagasta", isActive: true }])

    const restrictedSession = {
      user: { id: "user-2", role: "user", permissions: ["mantenciones:edit"], worksiteIds: ["ws-santiago"] },
    } as unknown as Session

    await expect(updateMaintenanceRecord(restrictedSession, "man-1", {
      vehicleId: "veh-2",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    })).rejects.toThrow("No puedes asignar mantenciones a este vehículo")
  })

  it("impide cambiar el vehículo o el impacto mientras la OT controla el estado operacional", async () => {
    selectResults.push(
      [{ id: "veh-2", worksiteId: "ws-1", isActive: true }],
      [{
        id: "man-1",
        vehicleId: "veh-1",
        worksiteId: "ws-1",
        status: "in_progress",
        operationalImpact: "maintenance",
        managesOperationalStatus: true,
        inspectionFindingId: null,
        maintenanceType: "correctiva",
        maintenanceDate: "2026-08-07",
      }],
    )
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session

    await expect(updateMaintenanceRecord(session, "man-1", {
      vehicleId: "veh-2",
      maintenanceDate: "2026-08-07",
      maintenanceType: "correctiva",
      operationalImpact: "out_of_service",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    })).rejects.toThrow("Detén o completa la OT antes de cambiar el vehículo o su impacto operacional")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("invalida una aprobación previa cuando cambian los costos base", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{
        id: "man-1",
        vehicleId: "veh-1",
        worksiteId: "ws-1",
        status: "scheduled",
        operationalImpact: "maintenance",
        managesOperationalStatus: false,
        inspectionFindingId: null,
        maintenanceType: "preventiva",
        maintenanceDate: "2026-08-07",
        netAmount: 100,
        taxAmount: 19,
        totalAmount: 119,
        costApprovalStatus: "approved",
      }],
    )
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit", "combustibles:view_costs"] } } as unknown as Session

    await updateMaintenanceRecord(session, "man-1", {
      vehicleId: "veh-1",
      maintenanceDate: "2026-08-07",
      maintenanceType: "preventiva",
      netAmount: 200,
      taxAmount: 38,
      totalAmount: 238,
    })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      costApprovalStatus: "not_required",
      costApprovedByUserId: null,
      costApprovedAt: null,
    }))
  })
})

describe("Maintenance Service (cancelMaintenanceRecord)", () => {
  it("cancela y audita sin consultar ni copiar montos", async () => {
    selectResults.push([{ id: "man-1", worksiteId: "ws-1", status: "scheduled", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }])
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session

    await cancelMaintenanceRecord(session, "man-1", "scheduled", "Orden duplicada")

    expect(mockSelect).toHaveBeenCalled()
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "man-1",
      oldState: expect.objectContaining({ id: "man-1", worksiteId: "ws-1", status: "scheduled" }),
      newState: expect.objectContaining({ status: "cancelled", reason: "Orden duplicada" }),
    }), expect.anything())
  })
})

describe("Maintenance Service (transitionMaintenanceRecord)", () => {
  const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session

  it("completa bajo lock y activa una sola referencia CAPA con el estado nuevo", async () => {
    selectResults.push(
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", inspectionFindingId: "finding-1", maintenanceType: "preventiva", maintenanceDate: "2026-08-07", operationalImpact: "none", managesOperationalStatus: false, costApprovalStatus: "not_required" }],
      [{ equipmentTypeId: "fet-camion" }],
      [],
      [],
      [{ capaActionId: "capa-1" }],
    )
    mutationResults.push([], [{ id: "evidence-1" }], [])

    await transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "Trabajo verificado por taller",
    })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "capa-1",
      reference: "mantencion:man-1",
      status: "active",
      description: "Evidencia automática de la mantención preventiva programada para el 2026-08-07.",
    }))
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      changeSet: expect.objectContaining({ evidenceId: "evidence-1", lifecycle: "activated" }),
    }))
  })

  it("reabre y supersede la evidencia sin borrarla", async () => {
    selectResults.push(
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "completed", inspectionFindingId: "finding-1", maintenanceType: "preventiva", maintenanceDate: "2026-08-07", operationalImpact: "none", managesOperationalStatus: false, costApprovalStatus: "not_required" }],
      [{ equipmentTypeId: "fet-camion" }],
      [],
      [{ capaActionId: "capa-1" }],
    )
    mutationResults.push([], [{ id: "evidence-1" }], [])

    await transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "completed",
      transition: "reopen",
      reason: "Falla reapareció en terreno",
    })

    expect(mockUpdateSet.mock.calls[1]![0]).toEqual(expect.objectContaining({
      status: "superseded",
      supersessionReason: "Falla reapareció en terreno",
    }))
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      changeSet: expect.objectContaining({ evidenceId: "evidence-1", lifecycle: "superseded" }),
    }))
  })

  it("rechaza un estado esperado obsoleto antes de escribir", async () => {
    selectResults.push([{ id: "man-1", worksiteId: "ws-1", status: "completed", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-07" }])

    await expect(transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "Trabajo verificado por taller",
    })).rejects.toThrow("cambió en otra sesión")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("bloquea el cierre cuando falta un documento obligatorio para la clase del activo", async () => {
    selectResults.push(
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-07", operationalImpact: "maintenance", managesOperationalStatus: true, costApprovalStatus: "not_required" }],
      [{ equipmentTypeId: "fet-camion" }],
      [{ documentType: "work_order" }],
      [],
    )

    await expect(transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "Trabajo verificado por taller",
    })).rejects.toThrow("Faltan documentos obligatorios para esta transición: work_order")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("registra el inicio aunque la OT no cambie el estado operacional", async () => {
    selectResults.push(
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "scheduled", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-07", operationalImpact: "none", managesOperationalStatus: false, costApprovalStatus: "not_required" }],
      [{ equipmentTypeId: "fet-camion" }],
      [],
    )

    await transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "scheduled",
      transition: "start",
      reason: "Inicio del trabajo en taller",
    })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "in_progress",
      startedAt: expect.any(String),
      downtimeStartedAt: undefined,
    }))
  })

  it("al reabrir elimina el cierre anterior de la detención", async () => {
    selectResults.push(
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", status: "completed", inspectionFindingId: null, maintenanceType: "correctiva", maintenanceDate: "2026-08-07", operationalImpact: "maintenance", managesOperationalStatus: false, costApprovalStatus: "approved" }],
      [{ equipmentTypeId: "fet-camion" }],
      [],
    )

    await transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "completed",
      transition: "reopen",
      reason: "Falla reapareció en terreno",
    })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      downtimeStartedAt: expect.any(String),
      downtimeEndedAt: null,
    }))
  })

  it("no pisa un estado operacional posterior impuesto por otra fuente", async () => {
    selectResults.push(
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", inspectionFindingId: null, maintenanceType: "correctiva", maintenanceDate: "2026-08-07", operationalImpact: "maintenance", managesOperationalStatus: true, costApprovalStatus: "approved" }],
      [{ equipmentTypeId: "fet-camion" }],
      [],
      [],
      [],
      [{ status: "fuera_servicio", reason: "INS-2026-001 · falla crítica" }],
    )

    await transitionMaintenanceRecord(session, {
      id: "man-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "Trabajo de taller terminado",
    })

    expect(mockUpdateSet).not.toHaveBeenCalledWith(expect.objectContaining({ operationalStatus: "operativo" }))
  })
})

describe("Maintenance Service (tareas y costos mutables)", () => {
  const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit", "combustibles:view_costs"] } } as unknown as Session

  it("no permite reabrir una tarea después de cerrar la OT", async () => {
    selectResults.push(
      [{ id: "task-1", maintenanceId: "man-1", status: "completed" }],
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "completed", version: 2 }],
    )

    await expect(setMaintenanceTaskStatus(session, "task-1", false))
      .rejects.toThrow("La orden cerrada no admite cambios en sus tareas")
  })

  it("agregar un repuesto invalida una aprobación de costos previa", async () => {
    selectResults.push([{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", version: 2 }])

    await addMaintenancePart(session, {
      maintenanceId: "man-1",
      description: "Filtro de aceite",
      quantity: 1,
      unit: "un",
      unitCost: 25_000,
      partNumber: null,
    })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      costApprovalStatus: "not_required",
      costApprovedByUserId: null,
      costApprovedAt: null,
    }))
  })
})

describe("Maintenance Service (aprobación de costos)", () => {
  it("impide que quien creó la OT apruebe sus propios costos", async () => {
    const session = { user: { id: "creator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:approve_costs"] } } as unknown as Session
    selectResults.push(
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", version: 1 }],
      [{ createdBy: "creator", approval: "pending", total: 100_000 }],
    )

    await expect(decideMaintenanceCostApproval(session, { maintenanceId: "man-1", decision: "approve" }))
      .rejects.toThrow("Quien creó la OT no puede aprobar sus propios costos")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("registra la aprobación de un actor segregado", async () => {
    const session = { user: { id: "approver", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:approve_costs"] } } as unknown as Session
    selectResults.push(
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", version: 1 }],
      [{ createdBy: "creator", approval: "pending", total: 100_000 }],
    )

    await expect(decideMaintenanceCostApproval(session, { maintenanceId: "man-1", decision: "approve" }))
      .resolves.toEqual({ status: "approved" })
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      costApprovalStatus: "approved",
      costApprovedByUserId: "approver",
    }))
  })

  it("rechaza aprobar costos que nunca fueron enviados a aprobación", async () => {
    const session = { user: { id: "approver", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:approve_costs"] } } as unknown as Session
    selectResults.push(
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", version: 1 }],
      [{ createdBy: "creator", approval: "not_required", total: 100_000 }],
    )

    await expect(decideMaintenanceCostApproval(session, { maintenanceId: "man-1", decision: "approve" }))
      .rejects.toThrow("Los costos no están pendientes de aprobación")
  })

  it("permite solicitar aprobación cuando el costo está sólo en repuestos o mano de obra", async () => {
    const session = { user: { id: "editor", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit"] } } as unknown as Session
    selectResults.push(
      [{ id: "man-1", code: "OT-2026-0001", vehicleId: "veh-1", worksiteId: "ws-1", status: "in_progress", version: 1 }],
      [{ createdBy: "creator", approval: "not_required", total: 0 }],
      [{ total: 25_000 }],
      [{ total: 0 }],
    )

    await expect(decideMaintenanceCostApproval(session, { maintenanceId: "man-1", decision: "request" }))
      .resolves.toEqual({ status: "pending" })
  })
})

describe("Maintenance Service (planes y políticas)", () => {
  it("filtra la lectura por la unidad exigida por el plan", async () => {
    mockMaintenancePlanFindMany.mockResolvedValue([{
      id: "plan-1",
      vehicleId: "veh-1",
      worksiteId: "ws-1",
      maintenanceType: "preventiva",
      strategy: "hour_meter",
      nextDueDate: null,
      nextDueReading: 1_000,
      advanceDays: 7,
      advanceUnits: 100,
      isActive: true,
      vehicle: { meterType: "hour_meter" },
    }])
    selectResults.push([{ value: 100 }])
    const session = { user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:view", "mantenciones:create"] } } as unknown as Session

    await materializeDueMaintenancePlans(session)

    const where = sqlChunks(whereNodes[0])
    expect(where).toContain("medido_por")
    expect(where).toContain("hora")
  })

  it("impide que un rol acotado modifique políticas documentales globales", async () => {
    const session = { user: { id: "local-manager", isGlobal: false, worksiteIds: ["ws-1"], permissions: ["mantenciones:edit"] } } as unknown as Session

    await expect(saveMaintenanceDocumentPolicy(session, {
      equipmentTypeId: "fet-camion",
      documentType: "work_order",
      requiredAt: "before_complete",
    })).rejects.toThrow("Sólo un rol global puede gestionar políticas documentales")
  })
})

describe("getUpcomingMaintenance", () => {
  const globalSession = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } } as unknown as Session

  // HALLAZGO 36: 2026-08-08T01:30Z son las 21:30 del 07-08 en Chile (UTC−4).
  // Con `toISOString()` la mantención de hoy caía en "vencidas".
  it("usa el día chileno, no el UTC, para separar vencidas de próximas", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-08T01:30:00Z"))
    mockMaintenanceFindMany.mockResolvedValue([])

    await getUpcomingMaintenance(globalSession)

    const wheres = mockMaintenanceFindMany.mock.calls.map((call) => sqlChunks((call[0] as { where: unknown }).where))
    expect(wheres).toHaveLength(2)
    for (const where of wheres) {
      expect(where).toContain("2026-08-07")
      expect(where).not.toContain("2026-08-08")
    }
    // La ventana de 30 días arranca del día chileno, no del UTC.
    expect(wheres[0]).toContain("2026-09-06")
    for (const [options] of mockMaintenanceFindMany.mock.calls) {
      expect(options.columns).not.toHaveProperty("netAmount")
      expect(options.columns).not.toHaveProperty("taxAmount")
      expect(options.columns).not.toHaveProperty("totalAmount")
    }
  })
})

describe("getUsageMaintenanceAlerts", () => {
  // HALLAZGO 11: la faena elegida en el tablero tiene que reencuadrar la alerta.
  it("acota los vehículos a la faena elegida en el tablero", async () => {
    const scopedSession = { user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-1", "ws-2"] } } as unknown as Session
    mockVehicleFindMany.mockResolvedValue([])

    await getUsageMaintenanceAlerts(scopedSession, "ws-1")

    const where = sqlChunks((mockVehicleFindMany.mock.calls[0]![0] as { where: unknown }).where)
    expect(where).toContain("ws-1")
    expect(where).not.toContain("ws-2")
  })

  // CO-023: una lectura menor que la de la última mantención es un medidor
  // reemplazado/reseteado, no "uso bajo el umbral" — antes desaparecía sin aviso.
  it("marca posible reset de medidor en vez de descartar la lectura en silencio", async () => {
    const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } } as unknown as Session
    mockVehicleFindMany.mockResolvedValue([{ id: "veh-1", plate: "AA-BB-11", code: "V-1" }])
    selectResults.push(
      [{ vehicleId: "veh-1", fecha: "2026-08-01", horometro: 5_000, medidoPor: "km" }],
      [{ vehicleId: "veh-1", maintenanceDate: "2026-07-01", odometerReading: 12_000, hourMeterReading: null }],
      [],
    )

    const alerts = await getUsageMaintenanceAlerts(session)

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ possibleMeterReset: true, usageSinceLastMaintenance: -7_000 })
  })

  // Mismo escenario, pero el caso de anomalía del reset ya fue resuelto DESPUÉS
  // de la última mantención: no hay lectura comparable, así que se omite en vez
  // de seguir pidiendo verificación de algo ya aceptado.
  it("omite la alerta cuando el reset ya fue aceptado después de la última mantención", async () => {
    const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } } as unknown as Session
    mockVehicleFindMany.mockResolvedValue([{ id: "veh-1", plate: "AA-BB-11", code: "V-1" }])
    selectResults.push(
      [{ vehicleId: "veh-1", fecha: "2026-08-01", horometro: 5_000, medidoPor: "km" }],
      [{ vehicleId: "veh-1", maintenanceDate: "2026-07-01", odometerReading: 12_000, hourMeterReading: null }],
      [{ vehicleId: "veh-1", ruleCode: "kilometraje_regresivo", cutoffFecha: "2026-07-15" }],
    )

    const alerts = await getUsageMaintenanceAlerts(session)

    expect(alerts).toHaveLength(0)
  })
})


// CO-008: los centros de costo tienen faena; el catálogo completo dejaba
// imputar el gasto de una faena a la estructura de otra.
describe("Maintenance Service (centros de costo con alcance)", () => {
  const scopedSession = {
    user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-1"], permissions: ["mantenciones:view", "mantenciones:create", "mantenciones:edit"] },
  } as unknown as Session

  it("sólo ofrece centros vigentes, transversales o de la faena visible", async () => {
    mockMaintenanceFindMany.mockResolvedValue([])
    mockVehicleFindMany.mockResolvedValue([])

    await getMaintenancePageData(scopedSession)

    const where = sqlChunks((mockCostCenterFindMany.mock.calls[0]![0] as { where: unknown }).where)
    expect(where).toContain("is_active")
    expect(where).toContain("ws-1")
  })

  it("rechaza un centro de costo de otra faena al registrar", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "cc-otra", worksiteId: "ws-2", isActive: true }],
    )

    await expect(createMaintenanceRecord(scopedSession, {
      vehicleId: "veh-1",
      costCenterId: "cc-otra",
      maintenanceDate: "2026-08-20",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    })).rejects.toThrow("El centro de costo pertenece a otra faena")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("rechaza un centro de costo dado de baja", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "cc-vieja", worksiteId: null, isActive: false }],
    )

    await expect(createMaintenanceRecord(scopedSession, {
      vehicleId: "veh-1",
      costCenterId: "cc-vieja",
      maintenanceDate: "2026-08-20",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    })).rejects.toThrow("Centro de costo no disponible")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("acepta un centro transversal sin faena", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "cc-global", worksiteId: null, isActive: true }],
    )

    await createMaintenanceRecord(scopedSession, {
      vehicleId: "veh-1",
      costCenterId: "cc-global",
      maintenanceDate: "2026-08-20",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ costCenterId: "cc-global", worksiteId: "ws-1" }))
  })
})

// CO-012: una mantención heredada sin faena quedaba fuera del listado acotado
// y aun así se podía transicionar por ID desde cualquier faena.
describe("Maintenance Service (faena heredada nula)", () => {
  it("resuelve la faena por el vehículo y rechaza al actor fuera de alcance", async () => {
    selectResults.push(
      [{ id: "man-legacy", vehicleId: "veh-9", worksiteId: null, status: "scheduled", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }],
      [{ id: "veh-9", worksiteId: "ws-antofagasta", isActive: true }],
    )
    const restrictedSession = {
      user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-santiago"], permissions: ["mantenciones:edit"] },
    } as unknown as Session

    await expect(cancelMaintenanceRecord(restrictedSession, "man-legacy", "scheduled", "Duplicada"))
      .rejects.toThrow("No puedes cambiar mantenciones de esta faena")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("permite la transición cuando el vehículo sí está en el alcance", async () => {
    selectResults.push(
      [{ id: "man-legacy", vehicleId: "veh-9", worksiteId: null, status: "scheduled", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }],
      [{ id: "veh-9", worksiteId: "ws-santiago", isActive: true }],
    )
    const scopedSession = {
      user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-santiago"], permissions: ["mantenciones:edit"] },
    } as unknown as Session

    await cancelMaintenanceRecord(scopedSession, "man-legacy", "scheduled", "Duplicada")

    // Dos selects: el registro bloqueado y el equipo del que se deduce la faena.
    // Sin la segunda lectura el permiso se habría concedido por omisión.
    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }))
  })
})

// El guardia del camino de edición no tenía prueba: la línea nunca se ejecutaba.
describe("Maintenance Service (centro de costo al editar)", () => {
  const session = {
    user: { id: "operator", isGlobal: true, worksiteIds: [], permissions: ["mantenciones:edit", "combustibles:view_costs"] },
  } as unknown as Session

  const input = {
    vehicleId: "veh-1",
    maintenanceDate: "2026-08-20",
    maintenanceType: "preventiva",
    netAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
  }

  it("rechaza imputar a un centro de otra faena", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", costCenterId: null, status: "in_progress", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }],
      [{ id: "cc-otra", worksiteId: "ws-2", isActive: true }],
    )

    await expect(updateMaintenanceRecord(session, "man-1", { ...input, costCenterId: "cc-otra" }))
      .rejects.toThrow("El centro de costo pertenece a otra faena")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("no revalida un centro heredado que no cambió: el registro sigue editable", async () => {
    selectResults.push(
      [{ id: "veh-1", worksiteId: "ws-1", isActive: true }],
      [{ id: "man-1", vehicleId: "veh-1", worksiteId: "ws-1", costCenterId: "cc-heredado", status: "in_progress", inspectionFindingId: null, maintenanceType: "preventiva", maintenanceDate: "2026-08-01" }],
    )

    await updateMaintenanceRecord(session, "man-1", { ...input, costCenterId: "cc-heredado" })

    // Sólo dos lecturas: no se consultó el centro de costo.
    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ costCenterId: "cc-heredado" }))
  })
})
