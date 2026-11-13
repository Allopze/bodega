import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El formulario de equipo ya no crea faenas (auditoría 2026-11-13, M12): el nombre de una «faena nueva» que alguien
 * envíe a mano se descarta antes de llegar al servicio, y el servicio rechaza `__new__` (ver
 * `mantencion-equipment-pglite.test.ts`).
 */

const guard = vi.hoisted(() => vi.fn())
const createEquipment = vi.hoisted(() => vi.fn())
const updateEquipment = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard }))
vi.mock("@/lib/services/mantencion/access", () => ({ equipmentScope: () => "all", viewerFromSession: () => ({}) }))
vi.mock("@/lib/services/mantencion/equipment", () => ({ createEquipment, updateEquipment }))
vi.mock("@/lib/services/mantencion/equipment-import", () => ({ buildEquipmentTemplate: vi.fn(), commitEquipmentImport: vi.fn(), IMPORT_MAX_BYTES: 5_000_000, previewEquipmentImport: vi.fn() }))
vi.mock("@/lib/services/mantencion/export-equipment", () => ({ exportEquipment: vi.fn() }))
vi.mock("@/lib/services/mantencion/fleet-incorporation", () => ({ INCORPORATE_MAX_ROWS: 200, incorporateFleetVehicles: vi.fn() }))

const { createEquipmentAction, updateEquipmentAction } = await import("./actions")

const SESSION = { user: { id: "u-jefe", email: "jefe@chome.test" } }

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe("el alta y la edición de equipos no crean faenas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION })
  })

  it("descarta el nombre de una faena nueva aunque venga en el formulario", async () => {
    createEquipment.mockResolvedValue({ ok: false, message: "x", fieldErrors: { worksiteId: "No puedes crear faenas nuevas desde un equipo" } })
    const state = await createEquipmentAction({ ok: false }, form({ code: "KA-1", plate: "ABCD-12", worksiteId: "__new__", newWorksiteName: "Faena Inventada" }))
    expect(createEquipment).toHaveBeenCalledTimes(1)
    expect(createEquipment.mock.calls[0]![1]).toMatchObject({ worksiteId: "__new__", newWorksiteName: "" })
    expect(state).toMatchObject({ ok: false, fieldErrors: { worksiteId: [expect.stringContaining("No puedes crear faenas nuevas")] } })
  })

  it("la edición hace lo mismo", async () => {
    updateEquipment.mockResolvedValue({ ok: false, message: "x", fieldErrors: { worksiteId: "No puedes crear faenas nuevas desde un equipo" } })
    await updateEquipmentAction({ ok: false }, form({ vehicleId: "veh-1", code: "KA-1", plate: "ABCD-12", worksiteId: "__new__", newWorksiteName: "Faena Inventada" }))
    expect(updateEquipment.mock.calls[0]![2]).toMatchObject({ newWorksiteName: "" })
  })
})
