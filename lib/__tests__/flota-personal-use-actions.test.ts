/**
 * Acciones de «Uso personal» de la ficha del equipo.
 *
 * Unitaria, con la base y el servicio simulados (como `flota-change-contract-action`): fija el permiso
 * `flota:personal_use`, el alcance de la faena del EQUIPO y cómo se traduce el formulario. Las reglas
 * de fechas y solapes las prueba el servicio contra PGlite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn())
const mockFindVehicle = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockPeriodVehicle = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission, can: vi.fn(() => true), requirePermission: vi.fn() }))
vi.mock("@/lib/auth/scope", () => ({ canAccessWorksite: mockCanAccessWorksite, serviceWorksiteScope: vi.fn() }))
vi.mock("@/db", () => ({ db: { query: { fuelVehicles: { findFirst: (...args: unknown[]) => mockFindVehicle(...args) } } } }))
vi.mock("@/lib/services/fleet-personal-use", () => ({
  createPersonalUsePeriod: (...args: unknown[]) => mockCreate(...args),
  updatePersonalUsePeriod: (...args: unknown[]) => mockUpdate(...args),
  deletePersonalUsePeriod: (...args: unknown[]) => mockDelete(...args),
  getPersonalUsePeriodVehicleId: (...args: unknown[]) => mockPeriodVehicle(...args),
}))
vi.mock("@/lib/services/contracts/assignments", () => ({ assignVehiclesToContract: vi.fn(), endVehicleAssignment: vi.fn() }))
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

import { deletePersonalUsePeriodAction, savePersonalUsePeriodAction } from "@/app/(app)/flota/actions"
import type { ActionState } from "@/lib/validation/operations"

const prev: ActionState = { ok: false, message: "" }
const session = { user: { id: "user-1", email: "jefa@chome.cl", isGlobal: false, worksiteIds: ["ws-1"], roles: [] } }
const DENIED = { ok: false, message: "No tienes permisos para realizar esta acción" }

function form(fields: Record<string, string> = {}) {
  const data = new FormData()
  data.set("vehicleId", "veh-1")
  data.set("id", "")
  data.set("startedOn", "2026-10-10")
  data.set("endedOn", "2026-10-19")
  data.set("note", "Viaje del dueño")
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session, error: null })
  mockCanAccessWorksite.mockReturnValue(true)
  mockFindVehicle.mockResolvedValue({ id: "veh-1", code: "KA-90", worksiteId: "ws-1" })
  mockCreate.mockResolvedValue({ ok: true, id: "pu-1" })
  mockUpdate.mockResolvedValue({ ok: true, id: "pu-1" })
  mockDelete.mockResolvedValue({ ok: true, id: "pu-1" })
  mockPeriodVehicle.mockResolvedValue("veh-1")
})

describe("savePersonalUsePeriodAction", () => {
  it("sin el permiso no toca la base ni el servicio", async () => {
    mockGuardPermission.mockResolvedValue({ session: null, error: DENIED })
    expect(await savePersonalUsePeriodAction(prev, form())).toEqual(DENIED)
    expect(mockGuardPermission).toHaveBeenCalledWith("flota:personal_use")
    expect(mockFindVehicle).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("con la faena del equipo fuera de su alcance, rechaza", async () => {
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-2" })
    mockCanAccessWorksite.mockReturnValue(false)
    const result = await savePersonalUsePeriodAction(prev, form())
    expect(result).toEqual({ ok: false, message: "No puedes gestionar vehículos de esta faena" })
    expect(mockCanAccessWorksite).toHaveBeenCalledWith(session, "ws-2")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("sin id crea el período y refresca la ficha, Control operacional y combustible", async () => {
    const result = await savePersonalUsePeriodAction(prev, form())
    expect(result.ok).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(
      { userId: "user-1", email: "jefa@chome.cl" },
      { vehicleId: "veh-1", startedOn: "2026-10-10", endedOn: "2026-10-19", note: "Viaje del dueño" },
    )
    const paths = mockRevalidatePath.mock.calls.map((call) => call[0])
    for (const path of ["/flota", "/flota/veh-1/flota", "/control-operacional", "/combustibles", "/dashboard", "/analitica"]) {
      expect(paths).toContain(path)
    }
  })

  it("un término vacío deja el período abierto", async () => {
    await savePersonalUsePeriodAction(prev, form({ endedOn: "", note: "" }))
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), { vehicleId: "veh-1", startedOn: "2026-10-10", endedOn: null, note: null })
  })

  it("con id edita, y el alcance es el del equipo del período, no el del formulario", async () => {
    mockPeriodVehicle.mockResolvedValue("veh-real")
    mockFindVehicle.mockResolvedValue({ id: "veh-real", worksiteId: "ws-1" })
    const result = await savePersonalUsePeriodAction(prev, form({ id: "pu-1", vehicleId: "veh-otro" }))
    expect(result.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith({ userId: "user-1", email: "jefa@chome.cl" }, "pu-1", { startedOn: "2026-10-10", endedOn: "2026-10-19", note: "Viaje del dueño" })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockRevalidatePath.mock.calls.map((call) => call[0])).toContain("/flota/veh-real/flota")
  })

  it("una fecha inválida devuelve el error del campo antes de tocar el servicio", async () => {
    const result = await savePersonalUsePeriodAction(prev, form({ startedOn: "no-es-fecha" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.startedOn?.length).toBeGreaterThan(0)
    expect(mockCreate).not.toHaveBeenCalled()

    const badEnd = await savePersonalUsePeriodAction(prev, form({ endedOn: "31-10-2026" }))
    expect(badEnd.fieldErrors?.endedOn?.length).toBeGreaterThan(0)
  })

  it("devuelve el motivo del servicio sin refrescar nada cuando rechaza", async () => {
    mockCreate.mockResolvedValue({ ok: false, message: "Se cruza con otro uso personal de este equipo (10-10-2026 → 19-10-2026)." })
    const result = await savePersonalUsePeriodAction(prev, form())
    expect(result).toEqual({ ok: false, message: "Se cruza con otro uso personal de este equipo (10-10-2026 → 19-10-2026)." })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe("deletePersonalUsePeriodAction", () => {
  it("sin el permiso no toca el servicio", async () => {
    mockGuardPermission.mockResolvedValue({ session: null, error: DENIED })
    expect(await deletePersonalUsePeriodAction("pu-1")).toEqual(DENIED)
    expect(mockGuardPermission).toHaveBeenCalledWith("flota:personal_use")
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("con la faena del equipo del período fuera de su alcance, rechaza", async () => {
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-2" })
    mockCanAccessWorksite.mockReturnValue(false)
    expect(await deletePersonalUsePeriodAction("pu-1")).toEqual({ ok: false, message: "No puedes gestionar vehículos de esta faena" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("quita el período y refresca", async () => {
    const result = await deletePersonalUsePeriodAction("pu-1")
    expect(result.ok).toBe(true)
    expect(mockDelete).toHaveBeenCalledWith({ userId: "user-1", email: "jefa@chome.cl" }, "pu-1")
    expect(mockRevalidatePath.mock.calls.map((call) => call[0])).toContain("/control-operacional")
  })

  it("un período que ya no existe se informa sin tocar el servicio", async () => {
    mockPeriodVehicle.mockResolvedValue(null)
    expect((await deletePersonalUsePeriodAction("pu-x")).ok).toBe(false)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
