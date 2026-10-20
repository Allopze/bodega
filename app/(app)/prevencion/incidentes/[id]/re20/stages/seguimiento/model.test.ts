import { describe, expect, it } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import { normalizeRe20Data } from "../../workspace-data"
import {
  applyFollowupToData, emptyFollowupForm, followupBlockers, followupKind, followupPayload, levelFromFlags, measureLevel, nextFollowupDue,
  parseMeetingNotes, serializeMeetingNotes, type FollowupForm, type FollowupRecord,
} from "./model"

const base = normalizeRe20Data({
  measures: [
    { id: "M1", rootCauseId: "H2", description: "Instalar drenaje", responsibleUserId: "resp", controlType: "" },
    { id: "M2", description: "Capacitar al turno", responsibleUserId: "resp" },
  ],
})
const m1 = base.measures[0]!
const m2 = base.measures[1]!

function form(patch: Partial<FollowupForm>): FollowupForm {
  return { ...emptyFollowupForm(m1), followupDate: "2026-10-20", note: "Se revisó en terreno el avance", ...patch }
}

describe("seguimiento quincenal de medidas", () => {
  it("elige RE-20-09 sólo para daño material o ambiental", () => {
    expect(followupKind("material_damage")).toBe("damage")
    expect(followupKind("environmental_spill")).toBe("damage")
    expect(followupKind("work_accident")).toBe("accident")
    expect(followupKind("dangerous_incident")).toBe("accident")
  })

  it("el estado triple es acumulativo: no hay combinaciones inválidas", () => {
    expect(levelFromFlags({})).toBe("pending")
    expect(levelFromFlags({ implementedAt: "2026-10-01" })).toBe("implemented")
    expect(levelFromFlags({ implementedAt: "2026-10-01", verified: true })).toBe("verified")
    expect(levelFromFlags({ verified: true, effective: true })).toBe("effective")
    const payload = followupPayload(form({ level: "effective", implementedAt: "2026-10-10", verifierUserId: "v1", verifiedAt: "2026-10-19", residualRisk: "Bajo" }), m1, "accident")
    expect(payload).toMatchObject({ verified: true, effective: true, implementedAt: "2026-10-10", verifierUserId: "v1", residualRisk: "Bajo", measureId: "M1", rootCauseId: "H2" })
  })

  it("verificar exige fecha de implementación, verificador distinto del responsable, fecha y riesgo residual", () => {
    expect(followupBlockers(form({ level: "pending" }), m1)).toEqual([])
    expect(followupBlockers(form({ level: "implemented" }), m1).map((b) => b.fieldId)).toEqual(["re20-seguimiento-form-implementedAt"])
    const verified = form({ level: "verified", implementedAt: "2026-10-10", verifierUserId: "resp", verifiedAt: "2026-10-19" })
    expect(followupBlockers(verified, m1).map((b) => b.label)).toEqual([expect.stringContaining("distinto del responsable"), "El riesgo residual"])
    expect(followupBlockers({ ...verified, verifierUserId: "v1", residualRisk: "Bajo" }, m1)).toEqual([])
  })

  it("valida la nota y los días perdidos", () => {
    expect(followupBlockers(form({ note: "ok" }), m1)).toHaveLength(1)
    expect(followupBlockers(form({ lostDays: "tres" }), m1).map((b) => b.fieldId)).toEqual(["re20-seguimiento-form-lostDays"])
    expect(followupPayload(form({ lostDays: "3", lossDescription: "x" }), m1, "accident")).toMatchObject({ lostDays: 3 })
    expect(followupPayload(form({ lostDays: "3", lossDescription: "Defensa" }), m1, "damage")).toMatchObject({ lossDescription: "Defensa" })
  })

  it("el último seguimiento manda sobre el estado de la medida", () => {
    const records: FollowupRecord[] = [
      { id: "a", kind: "accident", followupDate: "2026-10-05", note: "x", measureId: "M1", implementedAt: "2026-10-05", verified: false, effective: false },
      { id: "b", kind: "accident", followupDate: "2026-10-19", note: "y", measureId: "M1", implementedAt: "2026-10-05", verified: true, effective: true },
    ]
    expect(measureLevel(m1, records)).toBe("effective")
    expect(measureLevel(m2, records)).toBe("pending")
  })

  it("el próximo vencimiento cuenta 14 días desde el último seguimiento", () => {
    const records: FollowupRecord[] = [{ id: "a", kind: "accident", followupDate: "2026-10-05", note: "x", measureId: "M1", verified: false, effective: false }]
    expect(nextFollowupDue(records, DEFAULT_RE20_SLA_POLICY, "2026-10-01T00:00:00.000Z")).toBe("2026-10-19T12:00:00.000Z")
    expect(nextFollowupDue([], DEFAULT_RE20_SLA_POLICY, "2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z")
  })

  it("la verificación pasa a la medida y cierra las tareas cuando todas están verificadas", () => {
    const first = applyFollowupToData(base, { measureId: "M1", level: "effective", verifierUserId: "v1", verifiedAt: "2026-10-19", residualRisk: "Bajo" })
    expect(first.measures[0]).toMatchObject({ verifierUserId: "v1", effectiveness: { result: "Eficaz", residualRisk: "Bajo" } })
    expect(first.tasks.find((t) => t.id === "accident_followup")?.status).toBe("in_progress")
    expect(first.tasks.find((t) => t.id === "effectiveness_verification")).toBeUndefined()
    const justVerified = applyFollowupToData(base, { measureId: "M1", level: "verified", verifierUserId: "v1", verifiedAt: "2026-10-19", residualRisk: "Bajo" })
    expect(justVerified.measures[0]?.effectiveness?.result).toBeUndefined()
    const second = applyFollowupToData(first, { measureId: "M2", level: "effective", verifierUserId: "v1", verifiedAt: "2026-10-20", residualRisk: "Medio" })
    expect(second.tasks.find((t) => t.id === "effectiveness_verification")?.status).toBe("completed")
    expect(second.tasks.find((t) => t.id === "accident_followup")?.status).toBe("completed")
  })
})

describe("reunión post accidente", () => {
  it("guarda y lee las tres partes en la nota de la tarea", () => {
    const note = serializeMeetingNotes({ causes: "Se repasó el árbol", newMeasures: "Barandas nuevas", reinstruction: "Hecha por el comité" })
    expect(note).toBe("Revisión de causas y medidas con la persona: Se repasó el árbol\nNuevas medidas acordadas: Barandas nuevas\nReinstrucción: Hecha por el comité")
    expect(parseMeetingNotes(note)).toEqual({ causes: "Se repasó el árbol", newMeasures: "Barandas nuevas", reinstruction: "Hecha por el comité" })
    expect(serializeMeetingNotes({ causes: "", newMeasures: "", reinstruction: "" })).toBeNull()
  })

  it("conserva una nota anterior sin encabezados", () => {
    expect(parseMeetingNotes("Reunión hecha el lunes")).toEqual({ causes: "Reunión hecha el lunes", newMeasures: "", reinstruction: "" })
  })
})
