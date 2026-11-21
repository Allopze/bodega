import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Propietario y «ubicación por confirmar» del equipo (Trinorma): `saveVehicleOwnershipAction` y
 * `loadVehicleOwnershipAction` piden `admin:fleet_vehicles` y la faena del equipo en el alcance.
 */

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  canAccessWorksite: vi.fn(),
  findVehicle: vi.fn(),
  setOwnership: vi.fn(),
  createOwner: vi.fn(),
  listOwners: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission, can: vi.fn(() => true), guardPermission: vi.fn() }))
vi.mock("@/lib/auth/scope", () => ({ canAccessWorksite: mocks.canAccessWorksite, serviceWorksiteScope: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    query: { fuelVehicles: { findFirst: (...args: unknown[]) => mocks.findVehicle(...args) } },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  },
}))
vi.mock("@/lib/routing/revalidate-vehicle-ficha", () => ({ revalidateVehicleFicha: vi.fn() }))
vi.mock("@/lib/services/fleet-owners", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/fleet-owners")>()),
  setVehicleOwnershipTx: mocks.setOwnership,
  createFleetOwnerTx: mocks.createOwner,
  listFleetOwners: mocks.listOwners,
}))
vi.mock("@/lib/services/fleet", () => ({ uploadFleetDocument: vi.fn(), deleteFleetDocument: vi.fn(), getFleetOverview: vi.fn(), getFleetProviderGapMonths: vi.fn(), FLEET_OVERVIEW_LOOKBACK_MONTHS: 12 }))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: vi.fn() }))
vi.mock("@/lib/services/contracts/assignments", () => ({ assignVehiclesToContract: vi.fn(), endVehicleAssignment: vi.fn() }))
vi.mock("@/lib/services/fleet-personal-use", () => ({ createPersonalUsePeriod: vi.fn(), deletePersonalUsePeriod: vi.fn(), getPersonalUsePeriodVehicleId: vi.fn(), updatePersonalUsePeriod: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: vi.fn() }))
vi.mock("@/lib/services/mantencion/padron-identity", () => ({ loadPadronMaintenance: vi.fn() }))
vi.mock("@/app/(app)/combustibles/vehiculos/form-catalogs", () => ({ loadVehicleFormCatalogs: vi.fn() }))

const { saveVehicleOwnershipAction } = await import("./actions")
const { loadVehicleOwnershipAction } = await import("./[id]/_ficha/edit-vehicle-action")

const SESSION = { user: { id: "u-1", email: "a@chome.test" } }
const input = { vehicleId: "veh-1", ownerId: "o-1", locationPendingConfirmation: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePermission.mockResolvedValue(SESSION)
  mocks.canAccessWorksite.mockReturnValue(true)
  mocks.findVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "w-a", ownerId: null, locationPendingConfirmation: false })
  mocks.setOwnership.mockResolvedValue({ ok: true, message: "Propietario y ubicación guardados.", data: { changed: true } })
  mocks.createOwner.mockResolvedValue({ ok: true, message: "Empresa creada.", data: { id: "o-new", created: true } })
  mocks.listOwners.mockResolvedValue([{ id: "o-1", name: "Chome", kind: "propia", isActive: true }, { id: "o-2", name: "Vieja", kind: "tercero", isActive: false }])
})

describe("saveVehicleOwnershipAction", () => {
  it("sin permiso rechaza y no escribe", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"))
    expect(await saveVehicleOwnershipAction(input)).toMatchObject({ ok: false })
    expect(mocks.setOwnership).not.toHaveBeenCalled()
  })

  it("con el equipo en una faena fuera del alcance rechaza y no escribe", async () => {
    mocks.canAccessWorksite.mockReturnValue(false)
    const result = await saveVehicleOwnershipAction(input)
    expect(result).toMatchObject({ ok: false, message: "No puedes gestionar vehículos de esta faena" })
    expect(mocks.setOwnership).not.toHaveBeenCalled()
    expect(mocks.createOwner).not.toHaveBeenCalled()
  })

  it("un equipo inexistente se rechaza", async () => {
    mocks.findVehicle.mockResolvedValue(undefined)
    expect(await saveVehicleOwnershipAction(input)).toMatchObject({ ok: false, message: "Vehículo no encontrado" })
  })

  it("caso feliz: asigna la empresa elegida y la marca", async () => {
    const result = await saveVehicleOwnershipAction(input)
    expect(result.ok).toBe(true)
    expect(mocks.setOwnership).toHaveBeenCalledWith({}, expect.objectContaining({ userId: "u-1" }), { vehicleId: "veh-1", ownerId: "o-1", locationPendingConfirmation: true })
  })

  it("crear la empresa en línea: la crea y la asigna en la misma operación", async () => {
    const result = await saveVehicleOwnershipAction({ vehicleId: "veh-1", newOwner: { name: "Nueva SpA", kind: "tercero" }, locationPendingConfirmation: false })
    expect(result.ok).toBe(true)
    expect(mocks.createOwner).toHaveBeenCalled()
    expect(mocks.setOwnership).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ ownerId: "o-new" }))
  })

  it("un tipo de empresa inválido se rechaza antes de tocar la base", async () => {
    const result = await saveVehicleOwnershipAction({ vehicleId: "veh-1", newOwner: { name: "X Ltda", kind: "inventado" }, locationPendingConfirmation: false })
    expect(result.ok).toBe(false)
    expect(mocks.createOwner).not.toHaveBeenCalled()
  })
})

describe("loadVehicleOwnershipAction", () => {
  it("sin permiso rechaza", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"))
    expect(await loadVehicleOwnershipAction("veh-1")).toMatchObject({ ok: false })
    expect(mocks.listOwners).not.toHaveBeenCalled()
  })

  it("con el equipo fuera del alcance rechaza y no entrega el catálogo", async () => {
    mocks.canAccessWorksite.mockReturnValue(false)
    expect(await loadVehicleOwnershipAction("veh-1")).toMatchObject({ ok: false, message: "No puedes editar vehículos de esta faena." })
    expect(mocks.listOwners).not.toHaveBeenCalled()
  })

  it("caso feliz: entrega el valor actual y sólo las empresas activas (más la actual del equipo)", async () => {
    const result = await loadVehicleOwnershipAction("veh-1")
    expect(result).toMatchObject({ ok: true, data: { ownerId: null, locationPendingConfirmation: false } })
    expect(result.ok && result.data.owners.map((owner) => owner.id)).toEqual(["o-1"])
  })
})
