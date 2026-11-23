import { describe, expect, it } from "vitest"
import { buildRows } from "../fleet-view"
import { flowReducer, photosLostOnPick, type FlowAction } from "../flow"
import { newDraft, type FlowDraft } from "../flow-types"
import { staleChoices, staleMessage, validateAll, validateStep, type FlowCtx } from "../flow-validate"
import { UUID, equipment, storedCatalog } from "./fixtures"

const ROW = buildRows(storedCatalog("u-1", [equipment()]), [])[0] ?? null
const LISTS = { drivers: [{ id: "d-1", name: "AEDO" }], oils: [{ id: "o-1", name: "Motor" }], mechanics: [{ id: "u-2", name: "Luis Campos" }], workshops: [{ id: "w-1", name: "Melo" }], workTypes: [{ id: "t-1", name: "Mecánico" }] }
const ctx: FlowCtx = { row: ROW, today: "2026-10-28", catalog: LISTS }

const run = (draft: FlowDraft, ...actions: FlowAction[]) => actions.reduce((state, action) => flowReducer(state, action), draft)
const base = () => newDraft({ userId: "u-1", kind: "C", vehicleId: "veh-1", now: new Date("2026-10-28T15:00:00Z") })

/** Un borrador de correctiva completo y válido, con las listas del catálogo de la prueba. */
function valid(): FlowDraft {
  return {
    ...base(), readingText: "40400", description: "Cambio de manguera", inWorkshop: false,
    jobs: [{ workTypeId: "t-1", hours: 2, noParts: true, parts: [{ quantity: "1", description: "" }] }],
    noOilChange: true, driverIds: ["d-1"], photos: { filtros: null, sticker: null, correctiva: [UUID(1)] },
  }
}

describe("APP-2: cambiar de equipo con fotos", () => {
  const withPhotos = (): FlowDraft => ({ ...base(), kind: "P", photos: { filtros: UUID(1), sticker: UUID(2), correctiva: [] } })

  it("con fotos tomadas, la pantalla debe pedir confirmar: devuelve las fotos a soltar", () => {
    expect(photosLostOnPick(withPhotos(), "veh-2")).toEqual([UUID(1), UUID(2)])
    expect(photosLostOnPick({ ...base(), photos: { filtros: null, sticker: null, correctiva: [UUID(3)] } }, "veh-2")).toEqual([UUID(3)])
  })

  it("al confirmar (despachar el cambio) las fotos salen del borrador y los pasos vuelven a «Falta»", () => {
    const draft = run(withPhotos(), { type: "pickEquipment", vehicleId: "veh-2", schedule: null })
    expect(draft.vehicleId).toBe("veh-2")
    expect(draft.photos).toEqual({ filtros: null, sticker: null, correctiva: [] })
    const errors = validateStep(draft, "fotos", { ...ctx, row: ROW })
    expect(errors.photo_filtros).toBeTruthy()
    expect(errors.photo_sticker).toBeTruthy()
  })

  it("sin fotos no hay nada que confirmar; elegir el mismo equipo ni con fotos ni sin ellas las toca", () => {
    expect(photosLostOnPick(base(), "veh-2")).toEqual([])
    expect(photosLostOnPick(withPhotos(), "veh-1")).toEqual([])
    const same = run(withPhotos(), { type: "pickEquipment", vehicleId: "veh-1", schedule: null })
    expect(same.photos.filtros).toBe(UUID(1))
  })

  it("con una OT el equipo es fijo: no hay cambio ni fotos que perder", () => {
    const linked = { ...withPhotos(), workOrderId: "ot-1" }
    expect(photosLostOnPick(linked, "veh-2")).toEqual([])
    expect(run(linked, { type: "pickEquipment", vehicleId: "veh-2", schedule: null })).toBe(linked)
  })
})

describe("APP-3: lo elegido que ya no está en el catálogo", () => {
  it("el borrador válido pasa; sin catálogo (aún no bajó) no se juzga nada", () => {
    expect(validateStep(valid(), "trabajo", ctx)).toEqual({})
    expect(validateStep({ ...valid(), driverIds: ["x"] }, "trabajo", { ...ctx, catalog: null })).toEqual({})
  })

  it("un conductor desactivado se detecta antes de firmar, con el nombre si quedó guardado", () => {
    const draft: FlowDraft = { ...valid(), driverIds: ["d-1", "d-9"], idNames: { "d-9": "PEREZ" } }
    expect(validateStep(draft, "trabajo", ctx).drivers).toBe("Quita “PEREZ”: ya no está disponible.")
    expect(validateAll(draft, ["trabajo"], ctx)?.errors.drivers).toBeTruthy()
    const anonymous = { ...draft, idNames: undefined }
    expect(validateStep(anonymous, "trabajo", ctx).drivers).toBe("Quita un conductor que ya no está disponible.")
  })

  it("quitarlo (el chip «Ya no disponible · quitar») deja el borrador firmable", () => {
    const draft = run({ ...valid(), driverIds: ["d-1", "d-9"] }, { type: "toggleId", field: "driverIds", id: "d-9" })
    expect(draft.driverIds).toEqual(["d-1"])
    expect(validateAll(draft, ["trabajo"], ctx)).toBeNull()
  })

  it("un aceite desactivado y un tipo de trabajo desactivado también se detectan", () => {
    const oil = { ...valid(), noOilChange: false, oilIds: ["o-1", "o-9"] }
    expect(validateStep(oil, "trabajo", ctx).oil).toBe("Quita un aceite que ya no está disponible.")
    const job = { ...valid(), jobs: [{ workTypeId: "t-9", hours: 1, noParts: true, parts: [] }, ...valid().jobs], idNames: { "t-9": "Soldadura" } }
    expect(validateStep(job, "trabajo", ctx)["job:t-9"]).toBe("Quita “Soldadura”: ya no está disponible.")
  })

  it("el ejecutor desactivado pide elegir de nuevo (mecánico y taller externo)", () => {
    const mechanic = { ...valid(), executorKind: "otro_mecanico" as const, executorUserId: "u-9", idNames: { "u-9": "Pedro Soto" } }
    expect(validateStep(mechanic, "trabajo", ctx).executor).toBe("Elige otro mecánico: “Pedro Soto” ya no está disponible.")
    const workshop = { ...valid(), executorKind: "externo" as const, executorWorkshopId: "w-9" }
    expect(validateStep(workshop, "trabajo", ctx).executor).toBe("Elige otro taller: el que habías elegido ya no está disponible.")
    // El ejecutor guardado del tipo que no se usa no estorba.
    expect(staleChoices({ ...valid(), executorKind: "yo", executorUserId: "u-9" }, LISTS)).toEqual([])
  })

  it("toggleId y jobAdd recuerdan el nombre sólo al agregar", () => {
    const added = run(base(), { type: "toggleId", field: "driverIds", id: "d-1", name: "AEDO" }, { type: "jobAdd", workTypeId: "t-1", name: "Mecánico" })
    expect(added.idNames).toEqual({ "d-1": "AEDO", "t-1": "Mecánico" })
    expect(staleMessage({ kind: "driver", id: "d-1", name: "AEDO" })).toBe("Quita “AEDO”: ya no está disponible.")
  })
})

