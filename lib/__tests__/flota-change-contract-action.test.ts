/**
 * `changeVehicleContractAction`: «Cambiar contrato» de la ficha del equipo.
 *
 * Unitaria, con la base y el servicio de asignaciones simulados (como `flota-update-expiries-action`):
 * fija el permiso, el alcance de la faena del equipo y cómo se traduce el formulario a una asignación
 * o a un término. Las vigencias y los traslapes los prueba el servicio contra PGlite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn())
const mockFindVehicle = vi.hoisted(() => vi.fn())
const mockAssign = vi.hoisted(() => vi.fn())
const mockEnd = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission, can: vi.fn(() => true), requirePermission: vi.fn() }))
vi.mock("@/lib/auth/scope", () => ({ canAccessWorksite: mockCanAccessWorksite, serviceWorksiteScope: vi.fn() }))
vi.mock("@/db", () => ({ db: { query: { fuelVehicles: { findFirst: (...args: unknown[]) => mockFindVehicle(...args) } } } }))
vi.mock("@/lib/services/contracts/assignments", () => ({
  assignVehiclesToContract: (...args: unknown[]) => mockAssign(...args),
  endVehicleAssignment: (...args: unknown[]) => mockEnd(...args),
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/fleet", () => ({
  uploadFleetDocument: vi.fn(),
  deleteFleetDocument: vi.fn(),
  getFleetOverview: vi.fn(),
  getFleetProviderGapMonths: vi.fn(),
  FLEET_OVERVIEW_LOOKBACK_MONTHS: 12,
}))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: vi.fn(async () => ({ warningDays: 30 })) }))
vi.mock("@/lib/storage/config", () => ({
  resolveFleetDir: vi.fn(() => "/tmp/test-fleet"),
  createFleetDocumentPath: vi.fn((name: string) => `fleet/${name}`),
  resolveStorageFile: (dir: string, name: string) => `${dir}/${name}`,
}))
vi.mock("node:fs", () => ({ promises: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() } }))
vi.mock("@/lib/file-validation", () => ({
  validateFileBuffer: vi.fn(() => ({ error: null, mimeType: "application/pdf" })),
  MimeType: { PROOF: "application/pdf" },
}))

import { changeVehicleContractAction } from "@/app/(app)/flota/actions"
import type { ActionState } from "@/lib/validation/operations"

const prev: ActionState = { ok: false, message: "" }
const session = { user: { id: "user-1", email: "jefa@chome.cl", isGlobal: false, worksiteIds: ["ws-1"], roles: [] } }

function form(fields: Record<string, string>) {
  const data = new FormData()
  data.set("vehicleId", "veh-1")
  data.set("validFrom", "2026-11-18")
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session, error: null })
  mockCanAccessWorksite.mockReturnValue(true)
  mockFindVehicle.mockResolvedValue({ id: "veh-1", plate: "BPDH-67", code: "KA-90", worksiteId: "ws-1" })
  mockAssign.mockResolvedValue({ ok: true, assigned: 1, warnings: [] })
  mockEnd.mockResolvedValue({ ok: true })
})

describe("changeVehicleContractAction", () => {
  it("exige mant:equipment:manage y alcance de la faena", async () => {
    await changeVehicleContractAction(prev, form({ contractId: "c-1" }))
    expect(mockGuardPermission).toHaveBeenCalledWith("mant:equipment:manage")
    // El alcance es el de la faena del EQUIPO, no el de lo que diga el formulario.
    expect(mockCanAccessWorksite).toHaveBeenCalledWith(session, "ws-1")

    // Sin el permiso no se toca la base ni el servicio.
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })
    const denied = await changeVehicleContractAction(prev, form({ contractId: "c-1" }))
    expect(denied).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(mockFindVehicle).not.toHaveBeenCalled()
    expect(mockAssign).not.toHaveBeenCalled()
    expect(mockEnd).not.toHaveBeenCalled()

    // Con el permiso pero la faena del equipo fuera de su alcance, tampoco.
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-2" })
    mockCanAccessWorksite.mockReturnValue(false)
    const outOfScope = await changeVehicleContractAction(prev, form({ contractId: "c-1" }))
    expect(outOfScope.ok).toBe(false)
    expect(mockAssign).not.toHaveBeenCalled()
    expect(mockEnd).not.toHaveBeenCalled()
  })

  it("con contrato asigna el equipo desde el día indicado y refresca la ficha y el Panel", async () => {
    const result = await changeVehicleContractAction(prev, form({ contractId: "c-1", validFrom: "2026-11-20" }))

    expect(result.ok).toBe(true)
    expect(mockAssign).toHaveBeenCalledWith(
      { userId: "user-1", email: "jefa@chome.cl" },
      { contractId: "c-1", vehicleIds: ["veh-1"], validFrom: "2026-11-20" },
    )
    expect(mockEnd).not.toHaveBeenCalled()
    const paths = mockRevalidatePath.mock.calls.map((call) => call[0])
    expect(paths).toContain("/control-operacional")
    expect(paths).toContain("/flota/veh-1/flota")
  })

  it("«Sin contrato» (contractId vacío) termina la asignación el día anterior", async () => {
    const result = await changeVehicleContractAction(prev, form({ contractId: "", validFrom: "2026-11-20" }))

    expect(result.ok).toBe(true)
    expect(mockEnd).toHaveBeenCalledWith({ userId: "user-1", email: "jefa@chome.cl" }, { vehicleId: "veh-1", lastDay: "2026-11-19" })
    expect(mockAssign).not.toHaveBeenCalled()
  })

  it("devuelve el motivo del servicio sin refrescar nada cuando rechaza", async () => {
    mockAssign.mockResolvedValue({ ok: false, message: "KA-90 ya tiene una asignación desde el 01-06-2026" })

    const result = await changeVehicleContractAction(prev, form({ contractId: "c-1" }))

    expect(result).toEqual({ ok: false, message: "KA-90 ya tiene una asignación desde el 01-06-2026" })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("una fecha inválida se rechaza antes de tocar el servicio", async () => {
    const result = await changeVehicleContractAction(prev, form({ contractId: "", validFrom: "no-es-fecha" }))

    expect(result.ok).toBe(false)
    expect(mockEnd).not.toHaveBeenCalled()
    expect(mockAssign).not.toHaveBeenCalled()
  })
})
