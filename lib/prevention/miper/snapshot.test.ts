import { describe, expect, it } from "vitest"
import { changesByEntry, diffSnapshots, type MiperEntrySnapshot, type MiperSnapshot } from "./snapshot"

const header: MiperSnapshot["header"] = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: null,
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: "252086", worksiteName: "Biodiversa",
  siteRepresentativeUserId: "u-admin", siteRepresentativeName: "Jean Paul Recart",
  headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

function entry(id: string, over: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot {
  return {
    id, rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta",
    exposedFemale: 0, exposedMale: 5, exposedOther: 0, riskFactorId: "rf-mecanico", riskFactor: "Mecánico",
    isRoutine: true, hazard: "Camión en movimiento", risk: "Atropello", probableDamage: "Fracturas",
    probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "partial",
    controls: [{ id: `${id}-c1`, hierarchy: "administrative", description: "Procedimiento de carga", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-31", status: "proposed" }],
    ...over,
  }
}

describe("diffSnapshots", () => {
  it("sin foto anterior todo es agregado", () => {
    const diff = diffSnapshots(null, { header, entries: [entry("e1")] })
    expect(diff.hasChanges).toBe(true)
    expect(diff.entries).toEqual([{ kind: "added", entryId: "e1", rowNumber: 1, fields: [] }])
  })

  it("detecta agregadas, eliminadas y modificadas con sus campos, incluidas las medidas", () => {
    const before: MiperSnapshot = { header, entries: [entry("e1"), entry("e2", { rowNumber: 2 })] }
    const after: MiperSnapshot = {
      header: { ...header, headcountTotal: 17, headcountMale: 15 },
      entries: [
        entry("e1", { consequence: 2, magnitude: 4, classification: "moderate" }),
        entry("e3", { rowNumber: 2 }),
        // e2 eliminada
      ],
    }
    const diff = diffSnapshots(before, after)
    expect(diff.headerFields.sort()).toEqual(["headcountMale", "headcountTotal"])
    const byId = changesByEntry(diff)
    expect(byId.get("e1")).toMatchObject({ kind: "modified", fields: ["consequence", "magnitude", "classification"] })
    expect(byId.get("e3")?.kind).toBe("added")
    expect(byId.get("e2")?.kind).toBe("removed")
  })

  it("renumerar filas no es un cambio de contenido, pero editar una medida sí", () => {
    const before: MiperSnapshot = { header, entries: [entry("e1", { rowNumber: 1 })] }
    const renumbered: MiperSnapshot = { header, entries: [entry("e1", { rowNumber: 3 })] }
    expect(diffSnapshots(before, renumbered).hasChanges).toBe(false)
    const controlEdited = entry("e1")
    controlEdited.controls = [{ ...controlEdited.controls[0]!, dueDate: "2026-12-31" }]
    expect(changesByEntry(diffSnapshots(before, { header, entries: [controlEdited] })).get("e1")?.fields).toEqual(["controls"])
  })

  it("una foto sellada antes de la Fase C, sin isExisting ni frecuencia, no marca cambios contra la viva equivalente", () => {
    // `entry()` arma la medida sin las dos claves: es la forma de una foto sellada antes de la Fase C.
    const sealed: MiperSnapshot = { header, entries: [entry("e1")] }
    const live: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: false, verificationFrequency: null })) })] }
    expect(diffSnapshots(sealed, live)).toEqual({ headerFields: [], entries: [], hasChanges: false })
  })

  it("marcar una medida como existente, o cambiar su frecuencia, es un cambio de «Medidas de control»", () => {
    const pending: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: false, verificationFrequency: null })) })] }
    const existing: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: true, verificationFrequency: "Trimestral" })) })] }
    const monthly: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: true, verificationFrequency: "Mensual" })) })] }
    expect(diffSnapshots(pending, existing).entries).toEqual([{ kind: "modified", entryId: "e1", rowNumber: 1, fields: ["controls"] }])
    expect(diffSnapshots(existing, monthly).entries).toEqual([{ kind: "modified", entryId: "e1", rowNumber: 1, fields: ["controls"] }])
  })
})
