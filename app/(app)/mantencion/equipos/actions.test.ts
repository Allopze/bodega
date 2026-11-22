import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El formulario de equipo ya no crea faenas (auditoría 2026-11-13, M12): el nombre de una «faena nueva» que alguien
 * envíe a mano se descarta antes de llegar al servicio, y el servicio rechaza `__new__` (ver
 * `mantencion-equipment-pglite.test.ts`). «Editar mantención» sólo lleva pauta, lectura inicial y baja: la identidad
 * se edita en el padrón (crítica 2026-11-15, paso 4b).
 */

const guard = vi.hoisted(() => vi.fn())
const createEquipment = vi.hoisted(() => vi.fn())
const updateEquipmentPlan = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: {} }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard }))
vi.mock("@/lib/services/mantencion/access", () => ({ equipmentScope: () => "all", viewerFromSession: () => ({}) }))
vi.mock("@/lib/services/mantencion/equipment", () => ({ createEquipment, updateEquipmentPlan }))
vi.mock("@/lib/services/mantencion/equipment-import", () => ({ buildEquipmentTemplate: vi.fn(), commitEquipmentImport: vi.fn(), IMPORT_MAX_BYTES: 5_000_000, previewEquipmentImport: vi.fn() }))
vi.mock("@/lib/services/mantencion/export-equipment", () => ({ exportEquipment: vi.fn() }))
vi.mock("@/lib/services/mantencion/fleet-incorporation", () => ({ INCORPORATE_MAX_ROWS: 200, incorporateFleetVehicles: vi.fn() }))

const { createEquipmentAction, updateEquipmentPlanAction } = await import("./actions")

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

  it("devuelve en la faena el rechazo del traslado de una incorporación", async () => {
    createEquipment.mockResolvedValue({ ok: false, message: "x", fieldErrors: { worksiteId: "Llegó a Santa Fe el 18-11: la fecha no puede ser anterior." } })
    const state = await createEquipmentAction({ ok: false }, form({ code: "KA-1", plate: "ABCD-12", worksiteId: "ws-2" }))
    expect(state).toMatchObject({ ok: false, fieldErrors: { worksiteId: [expect.stringContaining("Llegó a Santa Fe")] } })
  })
})

describe("«Editar mantención»", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION })
    updateEquipmentPlan.mockResolvedValue({ ok: true, data: { changed: true }, message: "Cambios guardados en KA-1." })
  })

  it("sólo lleva pauta, lectura inicial y baja: lo que venga de la identidad no llega al servicio", async () => {
    await updateEquipmentPlanAction({ ok: false }, form({
      vehicleId: "veh-1", code: "KA-9", plate: "ZZZZ-99", brandId: "b-otra", worksiteId: "__new__",
      scheduleId: "s-1", initialReading: "40.312", initialReadingDate: "2026-11-01", status: "baja", retiredReason: "Vendido a tercero",
    }))
    expect(updateEquipmentPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-jefe" }),
      "veh-1",
      // Sin la sección de la preventiva declarada (`priorPreventiveForm`), ésta no viaja y no se toca.
      { scheduleId: "s-1", initialReading: 40_312, initialReadingDate: "2026-11-01", priorPreventive: undefined, expectedUpdatedAt: null },
      { active: false, retiredReason: "Vendido a tercero" },
    )
  })

  it("con la sección de la preventiva declarada, viaja con quién la declara, la fuente y la marca de tiempo", async () => {
    await updateEquipmentPlanAction({ ok: false }, form({
      vehicleId: "veh-1", status: "activo", scheduleId: "s-1", initialReading: "435.410", initialReadingDate: "2026-11-20",
      priorPreventiveForm: "1", priorPreventiveDate: "2026-08-20", priorPreventiveReading: "414.394", priorPreventiveInterval: "40000",
      priorPreventiveEvidence: "OT 35513", expectedUpdatedAt: "2026-11-21 21:49:51.123+00",
    }))
    expect(updateEquipmentPlan.mock.calls[0]![2]).toEqual({
      scheduleId: "s-1", initialReading: 435_410, initialReadingDate: "2026-11-20",
      priorPreventive: { date: "2026-08-20", reading: 414_394, intervalValue: 40_000, evidence: "OT 35513", declaredBy: "u-jefe", source: "Editar mantención" },
      expectedUpdatedAt: "2026-11-21 21:49:51.123+00",
    })
  })

  it("sin pauta ni lectura viajan como nulos", async () => {
    await updateEquipmentPlanAction({ ok: false }, form({ vehicleId: "veh-1", status: "activo" }))
    expect(updateEquipmentPlan.mock.calls[0]![2]).toEqual({ scheduleId: null, initialReading: null, initialReadingDate: null, expectedUpdatedAt: null })
  })
})

describe("EQ-1: un error sin campo no lleva `fieldErrors`, para que el formulario muestre el mensaje", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION })
  })

  it("«La ficha cambió mientras la editabas» (control de concurrencia) sale con `fieldErrors` indefinido", async () => {
    updateEquipmentPlan.mockResolvedValue({ ok: false, message: "La ficha cambió mientras la editabas. Recarga la página y vuelve a intentarlo.", fieldErrors: {} })
    const state = await updateEquipmentPlanAction({ ok: false }, form({ vehicleId: "veh-1", status: "activo" }))
    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/La ficha cambió mientras la editabas/)
    expect(state.fieldErrors).toBeUndefined()
  })

  it("lo mismo en el alta: «faena que no administras» no queda tras un `{}`", async () => {
    createEquipment.mockResolvedValue({ ok: false, message: "No administras la faena de ese equipo.", fieldErrors: {} })
    const state = await createEquipmentAction({ ok: false }, form({ code: "KA-1", worksiteId: "ws-9" }))
    expect(state.fieldErrors).toBeUndefined()
    expect(state.message).toMatch(/No administras/)
  })

  it("con errores de campo se conservan, uno por llave", async () => {
    updateEquipmentPlan.mockResolvedValue({ ok: false, message: "x", fieldErrors: { initialReading: "Lectura inválida." } })
    const state = await updateEquipmentPlanAction({ ok: false }, form({ vehicleId: "veh-1", status: "activo" }))
    expect(state.fieldErrors).toEqual({ initialReading: ["Lectura inválida."] })
  })
})
