import { describe, expect, it } from "vitest"
import { mapLegacyRow, parseLegacyDate, type LegacyFormRow, type LegacyLookups } from "@/lib/services/mantencion/legacy-import"

/** El importador de los Google Forms está preparado, no conectado: aquí se fija su mapeo puro. */

const lookups: LegacyLookups = {
  vehicleByCodeOrPlate: (text) => (text === "KA-135" ? { id: "v1", unit: "km" } : null),
  userByName: (name) => (name === "Javier Roa" ? { id: "u1" } : null),
  workshopByName: (name) => (name === "Maestranza Melo" ? { id: "w1" } : null),
  workTypeByName: (name) => (name === "Mecánico" ? { id: "t1" } : null),
  oilByName: (name) => (name === "Motor" ? { id: "o1" } : null),
  driverByName: (name) => (name === "AEDO POLANCO JOSE A." ? { id: "d1" } : null),
  itemKeyByActivity: (_form, activity) => (activity === "Revisión aceite motor" ? "k1" : null),
}

const base = {
  sourceRowId: "fila:12", submittedAt: "15/09/2026 10:20:31", responderName: "Javier Roa", equipmentText: "ka 135", reading: 40_312, workDateText: "14/09/2026",
}

describe("parseLegacyDate", () => {
  it("lee dd/mm/aaaa, dd-mm-aaaa e ISO, con o sin hora, y descarta fechas imposibles", () => {
    expect(parseLegacyDate("14/09/2026")).toBe("2026-09-14")
    expect(parseLegacyDate("4-9-2026 10:20:31")).toBe("2026-09-04")
    expect(parseLegacyDate("2026-09-14T10:20:00")).toBe("2026-09-14")
    expect(parseLegacyDate("31/02/2026")).toBeNull()
    expect(parseLegacyDate("ayer")).toBeNull()
    expect(parseLegacyDate(null)).toBeNull()
  })
})

describe("mapLegacyRow", () => {
  it("mapea una preventiva a un borrador con su origen, sin hora de firma, y avisa de lo que no calzó", () => {
    const row: LegacyFormRow = {
      ...base, form: "preventiva_camiones", intervalValue: 40_000, notes: " Sin novedad ",
      items: [{ name: "Revisión aceite motor", value: "R" }, { name: "Actividad desconocida", value: "NR", reason: "Falta repuesto" }],
    }
    const result = mapLegacyRow(row, lookups)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft).toMatchObject({
      origin: { source: "google_forms", form: "preventiva_camiones", sourceRowId: "fila:12" },
      kind: "P", vehicleId: "v1", unit: "km", reading: 40_312, workDate: "2026-09-14", registeredByUserId: "u1", signedAt: null,
      preventive: { intervalValue: 40_000, notes: "Sin novedad", items: [{ itemKey: "k1", value: "R", reason: null }] },
      corrective: null,
    })
    expect(result.draft.warnings).toEqual(["Actividad «Actividad desconocida» sin ítem equivalente en la pauta."])
  })

  it("mapea una correctiva resolviendo catálogos y ejecutor; lo que no existe queda como advertencia", () => {
    const row: LegacyFormRow = {
      ...base, form: "correctiva", workDateText: null, reading: null, responderName: "Alguien que ya no está",
      workTypes: ["Mecánico", "Hidráulico"], oils: ["Motor"], description: "Cambio de manguera", hours: 2, inWorkshop: true,
      driverNames: ["AEDO POLANCO JOSE A.", "Conductor fantasma"], executorText: "Maestranza Melo",
    }
    const result = mapLegacyRow(row, lookups)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft).toMatchObject({
      kind: "C", workDate: "2026-09-15", reading: null, registeredByUserId: null,
      corrective: { workTypeIds: ["t1"], oilIds: ["o1"], driverIds: ["d1"], executor: { kind: "externo", workshopId: "w1" }, inWorkshop: true },
    })
    expect(result.draft.warnings).toEqual(expect.arrayContaining([
      "«Alguien que ya no está» no es usuario de la plataforma.",
      "Sin fecha de trabajo: se usó la fecha de envío del formulario.",
      "Sin lectura de odómetro u horómetro.",
      "Tipo de trabajo «Hidráulico» no está en el catálogo.",
      "Conductor «Conductor fantasma» no está en el catálogo.",
    ]))
  })

  it("rechaza (sin inventar) equipo desconocido, fecha ilegible y preventiva sin ítems reconocibles", () => {
    const unknown = mapLegacyRow({ ...base, form: "correctiva", equipmentText: "XX-00" }, lookups)
    expect(unknown).toEqual({ ok: false, reasons: ["Equipo «XX-00» no existe en la flota de mantención."] })
    const badDate = mapLegacyRow({ ...base, form: "correctiva", workDateText: "??", submittedAt: "??" }, lookups)
    expect(badDate.ok).toBe(false)
    const noItems = mapLegacyRow({ ...base, form: "preventiva_camiones", items: [{ name: "Otra cosa", value: "R" }] }, lookups)
    expect(noItems).toEqual({ ok: false, reasons: ["Ninguna actividad de la fila calza con un ítem de la pauta."] })
  })
})
