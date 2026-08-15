import { describe, expect, it } from "vitest"
import {
  CERTIFICATION_REQUIREMENTS,
  evaluateLevel,
  findRequirement,
  requirementsForLevel,
  summarizeEvaluation,
  type CertificationEvidence,
} from "@/lib/prevention/cphs-certification"

/** Un comité modelo que cumple todo lo que el sistema puede verificar solo. */
const compliant = (over: Partial<CertificationEvidence> = {}): CertificationEvidence => ({
  committeeActive: true,
  dtRegisteredOn: "2026-01-20",
  parityValid: true,
  parityIssues: [],
  hasPresident: true,
  hasSecretary: true,
  hasFuero: true,
  activeMembers: 6,
  monthsWithClosedMeeting: 8,
  monthsElapsed: 8,
  agreementsTotal: 12,
  agreementsWithCapa: 12,
  programActive: true,
  programActivities: 10,
  orientationCovered: 6,
  incidentsTotal: 2,
  incidentsInvestigated: 2,
  requiredCourseCount: 3,
  monthsWithInspection: 8,
  monthsWithCommitteeInspection: 4,
  iperRevisionsTotal: 1,
  iperRevisionsWithCommittee: 1,
  meetingsInPeriod: 8,
  meetingsWithAgendaSent: 8,
  monthsWithGuest: 8,
  closedMeetingsInPeriod: 8,
  minutesSentToManagement: 8,
  activeCommissions: 2,
  riskMapActive: true,
  riskMapMarkerCount: 3,
  ...over,
})

const NO_MANUAL = new Map<string, { status: "met" | "not_met" | "not_applicable"; detail: string }>()

describe("catálogo de requisitos", () => {
  it("los códigos son únicos", () => {
    const codes = CERTIFICATION_REQUIREMENTS.map((requirement) => requirement.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("Bronce cubre los requisitos del manual de Mutual", () => {
    const codes = requirementsForLevel("bronce").map((requirement) => requirement.code)
    expect(codes).toEqual(expect.arrayContaining([
      "committee_constituted", "dt_registered", "parity_valid", "roles_assigned",
      "fuero_declared", "monthly_meetings", "agreements_tracked", "orientation_training",
      "work_program", "event_investigation", "serious_risk_communication",
    ]))
  })

  it("findRequirement encuentra por código", () => {
    expect(findRequirement("dt_registered")?.check.kind).toBe("auto")
    expect(findRequirement("serious_risk_communication")?.check.kind).toBe("manual")
    expect(findRequirement("no-existe")).toBeUndefined()
  })
})

describe("evaluación automática", () => {
  it("un comité modelo cumple todo lo automático", () => {
    const evaluated = evaluateLevel("bronce", compliant(), NO_MANUAL)
    const autos = evaluated.filter((item) => item.source === "auto")
    expect(autos.every((item) => item.status === "met")).toBe(true)
  })

  it("sin registro ante la DT reporta la brecha", () => {
    const evaluated = evaluateLevel("bronce", compliant({ dtRegisteredOn: null }), NO_MANUAL)
    const dt = evaluated.find((item) => item.code === "dt_registered")
    expect(dt).toMatchObject({ status: "not_met" })
    expect(dt?.detail).toMatch(/Dirección del Trabajo/i)
  })

  it("un mes sin sesionar rompe la cadencia y lo dice con cifras", () => {
    const evaluated = evaluateLevel("bronce", compliant({ monthsWithClosedMeeting: 6, monthsElapsed: 8 }), NO_MANUAL)
    const meetings = evaluated.find((item) => item.code === "monthly_meetings")
    expect(meetings).toMatchObject({ status: "not_met" })
    expect(meetings?.detail).toContain("6 de 8")
  })

  it("un acuerdo sin acción trazable rompe el seguimiento", () => {
    const evaluated = evaluateLevel("bronce", compliant({ agreementsWithCapa: 11 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "agreements_tracked")).toMatchObject({ status: "not_met" })
  })

  /* Un período sin eventos no es una brecha: no hay nada que investigar. */
  it("sin eventos ocurridos, la investigación se da por cumplida", () => {
    const evaluated = evaluateLevel("bronce", compliant({ incidentsTotal: 0, incidentsInvestigated: 0 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "event_investigation")).toMatchObject({ status: "met" })
  })

  it("un evento sin investigación cerrada sí es brecha", () => {
    const evaluated = evaluateLevel("bronce", compliant({ incidentsTotal: 3, incidentsInvestigated: 1 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "event_investigation")).toMatchObject({ status: "not_met" })
  })

  it("la paridad reporta el detalle que calculó el comité", () => {
    const evaluated = evaluateLevel("bronce", compliant({
      parityValid: false, parityIssues: ["El comité no es paritario: 3 contra 2."],
    }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "parity_valid")?.detail).toContain("3 contra 2")
  })

  it("un programa sin actividades no acredita el programa de trabajo", () => {
    const evaluated = evaluateLevel("bronce", compliant({ programActive: true, programActivities: 0 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "work_program")).toMatchObject({ status: "not_met" })
  })

  it("la orientación se mide sobre los integrantes activos", () => {
    const evaluated = evaluateLevel("bronce", compliant({ activeMembers: 6, orientationCovered: 4 }), NO_MANUAL)
    const training = evaluated.find((item) => item.code === "orientation_training")
    expect(training).toMatchObject({ status: "not_met" })
    expect(training?.detail).toContain("4 de 6")
  })
})

describe("niveles Plata y Oro", () => {
  it("Plata y Oro tienen requisitos propios y no se mezclan con Bronce", () => {
    const bronce = requirementsForLevel("bronce").map((item) => item.code)
    const plata = requirementsForLevel("plata").map((item) => item.code)
    const oro = requirementsForLevel("oro").map((item) => item.code)
    expect(plata.length).toBeGreaterThan(0)
    expect(oro.length).toBeGreaterThan(0)
    expect(plata.filter((code) => bronce.includes(code))).toEqual([])
    expect(oro.filter((code) => plata.includes(code))).toEqual([])
  })

  /* Sin cursos declarados en el módulo de capacitación no se puede afirmar
   * cobertura: la brecha señala que falta declararlos, no que falten personas. */
  it("sin cursos exigibles declarados, la capacitación ampliada avisa qué falta", () => {
    const evaluated = evaluateLevel("plata", compliant({ requiredCourseCount: 0 }), NO_MANUAL)
    const training = evaluated.find((item) => item.code === "extended_training")
    expect(training).toMatchObject({ status: "not_met" })
    expect(training?.detail).toMatch(/no hay cursos declarados/i)
  })

  it("la capacitación ampliada cumple con todos los integrantes al día", () => {
    expect(evaluateLevel("plata", compliant(), NO_MANUAL)
      .find((item) => item.code === "extended_training")).toMatchObject({ status: "met" })
  })

  it("un mes sin inspección rompe las inspecciones mensuales", () => {
    const evaluated = evaluateLevel("plata", compliant({ monthsWithInspection: 5, monthsElapsed: 8 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "monthly_inspections")).toMatchObject({ status: "not_met" })
  })

  it("distingue las inspecciones del comité de las de Prevención", () => {
    const evaluated = evaluateLevel("plata", compliant({ monthsWithCommitteeInspection: 0 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "committee_inspections")).toMatchObject({ status: "not_met" })
  })

  it("Oro acredita la participación del comité en la IPER con la sesión declarada", () => {
    expect(evaluateLevel("oro", compliant(), NO_MANUAL)
      .find((item) => item.code === "iper_committee_participation")).toMatchObject({ status: "met" })

    const sinSesion = evaluateLevel("oro", compliant({ iperRevisionsWithCommittee: 0 }), NO_MANUAL)
    expect(sinSesion.find((item) => item.code === "iper_committee_participation")).toMatchObject({ status: "not_met" })
  })

  it("la tabla previa exige haberla enviado en todas las sesiones", () => {
    expect(evaluateLevel("plata", compliant(), NO_MANUAL)
      .find((item) => item.code === "agenda_sent_in_advance")).toMatchObject({ status: "met" })
    expect(evaluateLevel("plata", compliant({ meetingsWithAgendaSent: 6 }), NO_MANUAL)
      .find((item) => item.code === "agenda_sent_in_advance")).toMatchObject({ status: "not_met" })
  })

  /* Una comisión sin integrantes no acredita organización interna, y por eso el
   * servicio sólo cuenta las que tienen alguien asignado. */
  it("las comisiones se acreditan sólo si existen con integrantes", () => {
    expect(evaluateLevel("plata", compliant({ activeCommissions: 0 }), NO_MANUAL)
      .find((item) => item.code === "commissions")).toMatchObject({ status: "not_met" })
  })

  it("la invitación mensual se mide por meses cubiertos", () => {
    expect(evaluateLevel("plata", compliant({ monthsWithGuest: 3, monthsElapsed: 8 }), NO_MANUAL)
      .find((item) => item.code === "guest_participation")).toMatchObject({ status: "not_met" })
  })

  it("el mapa de riesgos exige plano vigente con al menos un marcador", () => {
    expect(evaluateLevel("oro", compliant(), NO_MANUAL)
      .find((item) => item.code === "risk_map")).toMatchObject({ status: "met" })
    expect(evaluateLevel("oro", compliant({ riskMapActive: false }), NO_MANUAL)
      .find((item) => item.code === "risk_map")).toMatchObject({ status: "not_met" })
    expect(evaluateLevel("oro", compliant({ riskMapActive: true, riskMapMarkerCount: 0 }), NO_MANUAL)
      .find((item) => item.code === "risk_map")).toMatchObject({ status: "not_met" })
  })

  it("Oro exige remitir todas las actas cerradas a la administración", () => {
    expect(evaluateLevel("oro", compliant(), NO_MANUAL)
      .find((item) => item.code === "minutes_to_management")).toMatchObject({ status: "met" })
    expect(evaluateLevel("oro", compliant({ minutesSentToManagement: 5 }), NO_MANUAL)
      .find((item) => item.code === "minutes_to_management")).toMatchObject({ status: "not_met" })
  })

  it("sin revisiones de MIPER en el período la participación no se da por cumplida", () => {
    const evaluated = evaluateLevel("oro", compliant({ iperRevisionsTotal: 0, iperRevisionsWithCommittee: 0 }), NO_MANUAL)
    expect(evaluated.find((item) => item.code === "iper_committee_participation")).toMatchObject({ status: "not_met" })
  })
})

describe("requisitos manuales", () => {
  /* Sin declaración se reporta incumplido, no cumplido: para una auditoría, la
   * ausencia de evidencia nunca es evidencia de cumplimiento. */
  it("sin declaración quedan como no cumplidos", () => {
    const evaluated = evaluateLevel("bronce", compliant(), NO_MANUAL)
    const manual = evaluated.find((item) => item.code === "serious_risk_communication")
    expect(manual).toMatchObject({ source: "manual", status: "not_met" })
    expect(manual?.detail).toMatch(/sin evidencia/i)
  })

  it("respetan lo declarado", () => {
    const evaluated = evaluateLevel("bronce", compliant(), new Map([
      ["serious_risk_communication", { status: "met" as const, detail: "Procedimiento DO-12 difundido en marzo." }],
    ]))
    expect(evaluated.find((item) => item.code === "serious_risk_communication")).toMatchObject({
      status: "met", detail: "Procedimiento DO-12 difundido en marzo.",
    })
  })

  it("una declaración manual no puede sobrescribir un requisito automático", () => {
    const evaluated = evaluateLevel("bronce", compliant({ dtRegisteredOn: null }), new Map([
      ["dt_registered", { status: "met" as const, detail: "Intento de declarar a mano." }],
    ]))
    expect(evaluated.find((item) => item.code === "dt_registered")).toMatchObject({ status: "not_met" })
  })
})

describe("resumen del expediente", () => {
  it("no está listo mientras quede una brecha", () => {
    const evaluated = evaluateLevel("bronce", compliant(), NO_MANUAL)
    const summary = summarizeEvaluation(evaluated)
    expect(summary.gaps).toBe(1) // el manual sin declarar
    expect(summary.readyToSubmit).toBe(false)
  })

  it("queda listo cuando todo lo aplicable cumple", () => {
    const evaluated = evaluateLevel("bronce", compliant(), new Map([
      ["serious_risk_communication", { status: "met" as const, detail: "Procedimiento difundido." }],
    ]))
    const summary = summarizeEvaluation(evaluated)
    expect(summary).toMatchObject({ gaps: 0, readyToSubmit: true })
    expect(summary.met).toBe(summary.applicable)
  })

  it("lo declarado no aplicable sale del denominador", () => {
    const evaluated = evaluateLevel("bronce", compliant(), new Map([
      ["serious_risk_communication", { status: "not_applicable" as const, detail: "No corresponde al giro." }],
    ]))
    const summary = summarizeEvaluation(evaluated)
    expect(summary.applicable).toBe(summary.total - 1)
    expect(summary.readyToSubmit).toBe(true)
  })
})
