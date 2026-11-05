/**
 * `bulkAssignWorkerPositionAction`: permiso, validación de la entrada, alcance
 * por trabajador (todo o nada), mensajes y qué pantallas se revalidan. El
 * trabajo transaccional —historial, auditoría, idempotencia— lo prueba
 * `worker-positions-service.test.ts` contra PGlite; acá el servicio es un doble.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstPosition = vi.hoisted(() => vi.fn())
const mockBulkAssign = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => ({
  db: { query: { workerPositions: { findFirst: mockFindFirstPosition } } },
}))
vi.mock("@/lib/services/worker-positions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/worker-positions")>()),
  bulkAssignWorkerPosition: mockBulkAssign,
}))
vi.mock("@/lib/services/pdtp-adapters/worker-lifecycle-connector", () => ({
  onWorkerEnteredDotacion: vi.fn(),
}))
vi.mock("@/lib/services/pdtp-adapters/preventive-organization-connector", () => ({
  evaluateWorksitePreventiveOrganization: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))

import { bulkAssignWorkerPositionAction } from "@/app/(app)/admin/trabajadores/actions"
import { WorkerPositionDomainError } from "@/lib/services/worker-positions"

function session(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"], permissions: ["admin:workers"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true, ...overrides,
    },
  }
}

const POSITION = { id: "pos-conductor", name: "Conductor de camión" }

beforeEach(() => {
  vi.resetAllMocks()
  mockRequirePermission.mockResolvedValue(session())
  mockCanAccessWorksite.mockReturnValue(true)
  mockFindFirstPosition.mockResolvedValue(POSITION)
  mockBulkAssign.mockResolvedValue({ changed: ["w-1", "w-2"], unchanged: [] })
})

describe("bulkAssignWorkerPositionAction", () => {
  it("exige admin:workers y no toca nada sin él", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("forbidden"))

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "pos-conductor" })

    expect(result).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockRequirePermission).toHaveBeenCalledWith("admin:workers")
    expect(mockBulkAssign).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("rechaza una selección vacía y un cargo sin elegir, sin llamar al servicio", async () => {
    const empty = await bulkAssignWorkerPositionAction({ workerIds: [], positionId: "pos-conductor" })
    expect(empty).toEqual({ ok: false, message: "Elige al menos un trabajador." })

    const noPosition = await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "  " })
    expect(noPosition).toEqual({ ok: false, message: "Elige un cargo." })

    expect(mockBulkAssign).not.toHaveBeenCalled()
  })

  it("rechaza más trabajadores de los que admite una operación", async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `w-${index}`)

    const result = await bulkAssignWorkerPositionAction({ workerIds: ids, positionId: "pos-conductor" })

    expect(result.ok).toBe(false)
    expect(result.message).toContain("hasta 500")
    expect(mockBulkAssign).not.toHaveBeenCalled()
  })

  it("avisa si el cargo ya no existe", async () => {
    mockFindFirstPosition.mockResolvedValue(undefined)

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "pos-fantasma" })

    expect(result).toEqual({ ok: false, message: "El cargo seleccionado no existe." })
    expect(mockBulkAssign).not.toHaveBeenCalled()
  })

  it("clasifica con el actor de la sesión, origen admin y un motivo por defecto", async () => {
    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1", "w-2"], positionId: "pos-conductor" })

    expect(result).toMatchObject({ ok: true, message: "2 trabajadores clasificados como Conductor de camión." })
    expect(mockBulkAssign).toHaveBeenCalledWith(expect.objectContaining({
      workerIds: ["w-1", "w-2"],
      positionId: "pos-conductor",
      reason: "Clasificación masiva desde Trabajadores",
      actorUserId: "user-1",
      actorEmail: "admin@test.cl",
      source: "admin",
    }))
  })

  it("usa el motivo escrito, recortado", async () => {
    await bulkAssignWorkerPositionAction({
      workerIds: ["w-1"], positionId: "pos-conductor", reason: "  Según la planilla  ",
    })

    expect(mockBulkAssign).toHaveBeenCalledWith(expect.objectContaining({ reason: "Según la planilla" }))
  })

  it("le pasa al servicio el alcance de faena de la sesión, para evaluarlo bajo bloqueo", async () => {
    mockCanAccessWorksite.mockImplementation(((_session: unknown, worksiteId: string) => worksiteId === "ws-1") as never)
    await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "pos-conductor" })

    const { canAccessWorksite } = mockBulkAssign.mock.calls[0]![0] as { canAccessWorksite: (id: string) => boolean }
    expect(canAccessWorksite("ws-1")).toBe(true)
    expect(canAccessWorksite("ws-otra")).toBe(false)
  })

  it("si alguien está fuera de alcance no clasifica a nadie y lo dice", async () => {
    mockBulkAssign.mockRejectedValue(
      new WorkerPositionDomainError("No tienes acceso a la faena de 1 de los trabajadores seleccionados.", "FORBIDDEN"),
    )

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1", "w-ajeno"], positionId: "pos-conductor" })

    expect(result).toEqual({ ok: false, message: "No tienes acceso a la faena de 1 de los trabajadores seleccionados." })
    // Nada se escribió: no hay por qué refrescar pantallas.
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("revalida Trabajadores y lo que depende del cargo: catálogo y Conductores", async () => {
    await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "pos-conductor" })

    const paths = mockRevalidatePath.mock.calls.map(([path]) => path)
    expect(paths).toEqual(expect.arrayContaining(["/admin/trabajadores", "/admin/cargos", "/flota/conductores"]))
  })

  it("distingue a quienes cambiaron de quienes ya tenían el cargo", async () => {
    mockBulkAssign.mockResolvedValue({ changed: ["w-1"], unchanged: ["w-2", "w-3"] })

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1", "w-2", "w-3"], positionId: "pos-conductor" })

    expect(result.message).toBe("1 trabajador clasificado como Conductor de camión. 2 ya tenían ese cargo.")
    expect(result.data).toMatchObject({ changed: ["w-1"], unchanged: ["w-2", "w-3"] })
  })

  it("si nadie cambió, no dice que clasificó a alguien", async () => {
    mockBulkAssign.mockResolvedValue({ changed: [], unchanged: ["w-1", "w-2"] })

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1", "w-2"], positionId: "pos-conductor" })

    expect(result.ok).toBe(true)
    expect(result.message).toBe("Nadie cambió: los 2 trabajadores ya tenían el cargo Conductor de camión.")
  })

  it("no filtra el texto crudo de un error de base de datos", async () => {
    mockBulkAssign.mockRejectedValue(Object.assign(new Error("Failed query: update workers set ..."), { query: "update workers" }))

    const result = await bulkAssignWorkerPositionAction({ workerIds: ["w-1"], positionId: "pos-conductor" })

    expect(result.ok).toBe(false)
    expect(result.message).not.toContain("Failed query")
    expect(result.message).toContain("No se pudo asignar el cargo")
  })
})
