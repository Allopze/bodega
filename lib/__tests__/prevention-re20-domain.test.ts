import { describe, expect, it } from "vitest"
import * as incidentDomain from "@/lib/prevention/incidents"
import {
  RE20_QUALITY_CRITERIA, RE20_QUALITY_RESULTS, RE20_REVIEW_DECISIONS, calculateRe20Deadlines,
  deriveRe20RootCauses, deriveRe20Trajectories, nextRe20FollowupDueAt, re20ApplicableTaskIds,
  re20CausalGraphCompletenessIssues, re20TreeRequired, validateRe20CausalGraph,
} from "@/lib/prevention/incidents"

function domainFunction(name: string) {
  const candidate = Reflect.get(incidentDomain, name)
  expect(candidate).toBeTypeOf("function")
  return typeof candidate === "function" ? candidate : () => []
}

describe("dominio RE-20", () => {
  it("acepta relaciones causales verificables con varios antecedentes", () => {
    const validate = domainFunction("validateRe20CausalGraph")
    expect(Reflect.apply(validate, undefined, [{
      events: [
        { id: "H1", description: "La carga se desplazó", verified: true, source: "Foto 1" },
        { id: "H2", description: "La traba estaba abierta", verified: true, source: "Declaración" },
        { id: "H3", description: "La carga cayó", verified: true, source: "Foto 2" },
      ],
      relations: [
        { from: "H1", to: "H3", type: "conjunction" },
        { from: "H2", to: "H3", type: "conjunction" },
      ],
    }])).toEqual([])
  })

  it("rechaza relaciones que forman un ciclo o apuntan a hechos inexistentes", () => {
    const validate = domainFunction("validateRe20CausalGraph")

    expect(Reflect.apply(validate, undefined, [{
      events: [
        { id: "H1", description: "Hecho uno", verified: true, source: "Foto" },
        { id: "H2", description: "Hecho dos", verified: true, source: "Acta" },
      ],
      relations: [
        { from: "H1", to: "H2", type: "chain" },
        { from: "H2", to: "H1", type: "chain" },
      ],
    }])).toContain("El árbol contiene un ciclo causal.")

    expect(Reflect.apply(validate, undefined, [{
      events: [{ id: "H1", description: "Hecho uno", verified: true, source: "Foto" }],
      relations: [{ from: "H1", to: "H9", type: "chain" }],
    }])).toContain("La relación causal apunta a un hecho inexistente.")
  })

  it("trata independent como arista dirigida: participa en ciclos pero no es causalidad circular por sí sola", () => {
    const validate = domainFunction("validateRe20CausalGraph")
    const events = [
      { id: "H1", description: "Hecho uno", verified: true, source: "Foto" },
      { id: "H2", description: "Hecho dos", verified: true, source: "Acta" },
    ]
    expect(Reflect.apply(validate, undefined, [{ events, relations: [{ from: "H1", to: "H2", type: "independent" }] }])).toEqual([])
    expect(Reflect.apply(validate, undefined, [{
      events,
      relations: [{ from: "H1", to: "H2", type: "independent" }, { from: "H2", to: "H1", type: "independent" }],
    }])).toContain("El árbol contiene un ciclo causal.")
  })

  it("rechaza auto-relaciones, duplicados e ids vacíos o repetidos", () => {
    const events = [{ id: "H1", description: "a", verified: true }, { id: "H2", description: "b", verified: true }]
    const errors = validateRe20CausalGraph({
      events,
      relations: [
        { from: "H1", to: "H1", type: "chain" },
        { from: "H1", to: "H2", type: "chain" },
        { from: "H1", to: "H2", type: "chain" },
      ],
    })
    expect(errors).toHaveLength(2)
    expect(validateRe20CausalGraph({ events: [{ id: " ", description: "", verified: false }, ...events, events[0]!], relations: [] })).toHaveLength(2)
    expect(validateRe20CausalGraph({ events, relations: [] })).toEqual([])
  })

  describe("completitud del árbol", () => {
    const ev = (...ids: string[]) => ids.map((id) => ({ id, description: id, verified: true }))
    const tree = {
      events: ev("H1", "H2", "H3", "H4", "H5"),
      relations: [
        { from: "H2", to: "H1", type: "chain" as const },
        { from: "H3", to: "H2", type: "conjunction" as const },
        { from: "H4", to: "H2", type: "conjunction" as const },
        { from: "H5", to: "H3", type: "chain" as const },
      ],
    }

    it("un árbol con conjunción es completo y deriva raíces y trayectorias", () => {
      expect(re20CausalGraphCompletenessIssues(tree)).toEqual([])
      expect(deriveRe20RootCauses(tree)).toEqual(["H4", "H5"])
      expect(deriveRe20Trajectories(tree)).toEqual([["H4", "H2", "H1"], ["H5", "H3", "H2", "H1"]])
    })

    it("exige H1 final y sin consecuencias", () => {
      expect(re20CausalGraphCompletenessIssues({ events: ev("H2"), relations: [] })).toContain("Falta el hecho final H1 (lesión o daño).")
      const issues = re20CausalGraphCompletenessIssues({ events: ev("H1", "H2"), relations: [{ from: "H1", to: "H2", type: "chain" }] })
      expect(issues).toContain("H1 es el hecho final y no puede tener consecuencias.")
    })

    it("verifica coherencia de tipos chain, conjunction e independent", () => {
      const chain = re20CausalGraphCompletenessIssues({
        events: ev("H1", "H2", "H3"),
        relations: [{ from: "H2", to: "H1", type: "chain" }, { from: "H3", to: "H1", type: "chain" }],
      })
      expect(chain.some((i) => i.startsWith("H1:") && i.includes("cadena"))).toBe(true)
      const conj = re20CausalGraphCompletenessIssues({ events: ev("H1", "H2"), relations: [{ from: "H2", to: "H1", type: "conjunction" }] })
      expect(conj.some((i) => i.includes("conjunción"))).toBe(true)
      const indep = re20CausalGraphCompletenessIssues({ events: ev("H1", "H2"), relations: [{ from: "H2", to: "H1", type: "independent" }] })
      expect(indep.some((i) => i.includes("independiente"))).toBe(true)
      const ok = re20CausalGraphCompletenessIssues({
        events: ev("H1", "H2", "H3"),
        relations: [{ from: "H2", to: "H3", type: "independent" }, { from: "H2", to: "H1", type: "independent" }, { from: "H3", to: "H1", type: "conjunction" }],
      })
      expect(ok).toEqual([])
    })

    it("detecta hechos causales que no alcanzan H1 y excluye los no causales de las raíces", () => {
      const issues = re20CausalGraphCompletenessIssues({
        events: ev("H1", "H2", "H3", "H4"),
        relations: [{ from: "H2", to: "H1", type: "chain" }, { from: "H4", to: "H3", type: "chain" }],
      })
      expect(issues).toContain("H4: el hecho causal no conduce al hecho final H1.")
      const ctx = { events: [{ id: "H1", description: "", verified: true }, { id: "H2", description: "", verified: true, causal: false }], relations: [{ from: "H2", to: "H1", type: "chain" as const }] }
      expect(deriveRe20RootCauses(ctx)).toEqual([])
      expect(re20CausalGraphCompletenessIssues(ctx)).toContain("El árbol no tiene ninguna causa raíz.")
    })
  })

  it("expone los 13 criterios de calidad con el texto literal del Excel", () => {
    expect(RE20_QUALITY_CRITERIA.map((c) => [c.id, c.criterion, c.verification])).toEqual([
      ["timeliness", "Oportunidad", "La investigación se inició prontamente y se preservaron las evidencias disponibles."],
      ["participation", "Participación", "Se incorporó a personas trabajadoras y sus representantes, con enfoque de género e inclusión."],
      ["objectivity", "Objetividad", "El relato y los hechos no contienen juicios de valor, culpabilización ni suposiciones no identificadas."],
      ["traceability", "Trazabilidad", "Cada hecho relevante se respalda con una fuente o evidencia."],
      ["coherence", "Coherencia", "Relato, línea de tiempo, listado de hechos y árbol son consistentes entre sí."],
      ["depth", "Profundidad", "El análisis no se detuvo en «error humano» y alcanzó condiciones técnicas u organizacionales."],
      ["root_causes", "Causas raíz", "Las causas raíz corresponden a hechos sin antecedentes causales verificables adicionales."],
      ["measures", "Medidas", "Cada causa raíz tiene al menos una medida específica, viable y priorizada por jerarquía de control."],
      ["planning", "Planificación", "Las medidas tienen responsable, plazo, recursos, evidencia y verificador."],
      ["risk_assessment", "IPER", "Se revisó la necesidad de actualizar la matriz IPER y otros instrumentos preventivos."],
      ["effectiveness", "Eficacia", "Se definió cómo y cuándo se evaluará la eficacia y el riesgo residual."],
      ["confidentiality", "Confidencialidad", "Los antecedentes personales, médicos y declaraciones están bajo acceso restringido."],
      ["report_attachments", "Registro", "El informe y sus anexos están foliados, respaldados y disponibles para las entidades competentes."],
    ])
    expect(RE20_QUALITY_CRITERIA.every((c) => c.label === c.verification)).toBe(true)
    expect(RE20_QUALITY_RESULTS.map((r) => r.label)).toEqual(["Cumple", "Parcial", "No cumple"])
    expect(RE20_REVIEW_DECISIONS.map((r) => r.label)).toEqual(["Aprobado", "Aprobado con observaciones", "Requiere corrección"])
  })

  it("determina tareas aplicables y árbol obligatorio por tipo de evento", () => {
    expect(re20ApplicableTaskIds("commute_accident", {})).toEqual(["notify", "preliminary_report", "witness_statements", "diat"])
    const work = re20ApplicableTaskIds("work_accident", {})
    expect(work).toContain("post_accident_meeting")
    expect(work).toContain("diat")
    expect(work).toContain("effectiveness_verification")
    const nearMiss = re20ApplicableTaskIds("dangerous_incident", { nearMissPotential: "Bajo" })
    expect(nearMiss).not.toContain("diat")
    expect(nearMiss).not.toContain("injured_interview")
    expect(nearMiss).not.toContain("post_accident_meeting")
    expect(re20ApplicableTaskIds("material_damage", {})).not.toContain("diat")
    expect(re20ApplicableTaskIds("vehicle_event", { isFatalOrSerious: true })).toContain("diat")
    expect(re20TreeRequired("dangerous_incident", { nearMissPotential: "Medio" })).toBe(false)
    expect(re20TreeRequired("dangerous_incident", { nearMissPotential: null })).toBe(false)
    expect(re20TreeRequired("dangerous_incident", { nearMissPotential: "Grave o fatal" })).toBe(true)
    expect(re20TreeRequired("dangerous_incident", { nearMissPotential: "critical" })).toBe(true)
    expect(re20TreeRequired("work_accident", {})).toBe(true)
  })

  it("DIAT es null para daño material y el seguimiento se agenda cada followupDays", () => {
    const base = { occurredAt: "2026-10-20T10:00:00.000Z", knownAt: "2026-10-20T10:30:00.000Z" }
    expect(calculateRe20Deadlines({ ...base, eventType: "material_damage" }).diat).toBeNull()
    expect(calculateRe20Deadlines({ ...base, eventType: "material_damage", isFatalOrSerious: true }).diat).toEqual({ dueAt: "2026-10-21T10:30:00.000Z", kind: "legal" })
    expect(calculateRe20Deadlines({ ...base, eventType: "work_accident", reintegrationAt: "2026-11-01T08:00:00.000Z" }).postAccidentMeeting.dueAt).toBe("2026-11-01T08:00:00.000Z")
    expect(nextRe20FollowupDueAt("2026-10-20T10:00:00.000Z")).toBe("2026-11-03T10:00:00.000Z")
  })

  it("separa vencimientos internos del vencimiento legal DIAT", () => {
    const calculate = domainFunction("calculateRe20Deadlines")
    expect(Reflect.apply(calculate, undefined, [{
      occurredAt: "2026-10-20T10:00:00.000Z",
      knownAt: "2026-10-20T10:30:00.000Z",
      preliminaryAt: "2026-10-20T11:00:00.000Z",
      qualityApprovedAt: "2026-10-21T10:00:00.000Z",
    }])).toEqual({
      preliminary: { dueAt: "2026-10-20T13:00:00.000Z", kind: "internal" },
      witnessStatements: { dueAt: "2026-10-20T15:00:00.000Z", kind: "internal" },
      diat: { dueAt: "2026-10-21T10:30:00.000Z", kind: "legal" },
      injuredInterview: { dueAt: "2026-10-21T11:00:00.000Z", kind: "internal" },
      definitive: { dueAt: "2026-10-23T11:00:00.000Z", kind: "internal" },
      diffusion: { dueAt: "2026-10-22T10:00:00.000Z", kind: "internal" },
      occurredAt: "2026-10-20T10:00:00.000Z",
      postAccidentMeeting: { dueAt: null, kind: "internal" },
    })
  })

  it("mantiene mapeadas las trece hojas del formato RE-20", () => {
    expect(Reflect.get(incidentDomain, "RE20_WORKBOOK_SHEETS")).toEqual([
      "PASO A PASO",
      "INV.PRE.ACC",
      "DECLARACIÓN INDIVIDUAL",
      "Entrevista CPHyS-Ejecutivo-Otro",
      "INV.DEF.ACC",
      "ÁRBOL DE CAUSAS",
      "REVISIÓN DE CALIDAD",
      "DIAT",
      "INF.DIFUSIÓN",
      "Seguimiento Acc. CTP STP",
      "Seguimiento Incidente daño",
      "Reporte Cuasi Accidente",
      "Clasificación",
    ])
  })

  it("incluye las listas activas del libro, incluso las heredadas como sin uso", () => {
    const options = Reflect.get(incidentDomain, "RE20_CLASSIFICATION_OPTIONS")
    expect(Array.isArray(options)).toBe(true)
    if (!Array.isArray(options)) return

    expect(new Set(options.map((item) => item.category)).size).toBeGreaterThan(25)
    expect(options).toContainEqual(expect.objectContaining({
      category: "legacy_substandard_act",
      name: "Conducir, operar sin autoriz.",
      isActive: true,
    }))
    expect(options).toContainEqual(expect.objectContaining({
      category: "causal_relation",
      name: "Conjunción",
      isActive: true,
    }))
  })
})
