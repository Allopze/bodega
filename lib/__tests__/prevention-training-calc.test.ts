import { describe, expect, it } from "vitest"
import {
  addMonths,
  assessLegalFloor,
  competencyExpiry,
  computeCompetencyGaps,
  type CompetencyRequirementRow,
  type WorkerRow,
} from "@/lib/prevention/training"
import {
  DS44_ART16_MAX_VALIDITY_MONTHS,
  DS44_ART16_MIN_DURATION_MINUTES,
  trainingCourseSchema,
} from "@/lib/validation/prevention-module/training"

const worker = (over: Partial<WorkerRow> = {}): WorkerRow => ({
  id: "w-1",
  firstName: "Ana",
  lastName: "Pérez",
  position: "Operador maquinaria pesada",
  worksiteId: "ws-1",
  isActive: true,
  ...over,
})

const requirement = (over: Partial<CompetencyRequirementRow> = {}): CompetencyRequirementRow => ({
  id: "req-1",
  courseId: "course-1",
  courseName: "Trabajo en altura",
  scopeType: "position",
  scopeValue: "Operador maquinaria pesada",
  worksiteId: null,
  enforcement: "blocking",
  reason: "Tarea crítica declarada en la MIPER de la faena.",
  isActive: true,
  ...over,
})

describe("vigencia de competencias", () => {
  it("suma meses conservando el último día válido del mes destino", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2026-03-15", 24)).toBe("2028-03-15")
  })

  it("un curso sin vigencia declarada no inventa una fecha de vencimiento", () => {
    expect(competencyExpiry("2026-07-19", null)).toBeNull()
    expect(competencyExpiry("2026-07-19", 24)).toBe("2028-07-19")
  })
})

describe("piso legal DS 44 art. 16", () => {
  it("acepta un curso legal de 8 horas y 24 meses", () => {
    expect(assessLegalFloor({ kind: "legal_mandatory", minimumDurationMinutes: DS44_ART16_MIN_DURATION_MINUTES, validityMonths: DS44_ART16_MAX_VALIDITY_MONTHS })).toEqual([])
  })

  it("rechaza un curso legal bajo el mínimo de 8 horas", () => {
    const findings = assessLegalFloor({ kind: "legal_mandatory", minimumDurationMinutes: 240, validityMonths: 24 })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.field).toBe("minimumDurationMinutes")
    expect(findings[0]?.message).toContain("DS 44")
  })

  it("rechaza un curso legal sin vigencia o con vigencia mayor a 2 años", () => {
    expect(assessLegalFloor({ kind: "legal_mandatory", minimumDurationMinutes: 480, validityMonths: null })[0]?.field).toBe("validityMonths")
    expect(assessLegalFloor({ kind: "legal_mandatory", minimumDurationMinutes: 480, validityMonths: 36 })[0]?.field).toBe("validityMonths")
  })

  it("marca la sesión dictada por debajo de la duración exigida por el curso", () => {
    const findings = assessLegalFloor({ kind: "legal_mandatory", minimumDurationMinutes: 480, validityMonths: 24, deliveredDurationMinutes: 300 })
    expect(findings.some((item) => item.field === "durationMinutes")).toBe(true)
  })

  it("no impone el piso legal a una charla operacional", () => {
    expect(assessLegalFloor({ kind: "operational_talk", minimumDurationMinutes: 30, validityMonths: null })).toEqual([])
  })

  it("el esquema bloquea declarar un curso legal sin fundamento normativo", () => {
    const result = trainingCourseSchema.safeParse({
      code: "LEG-01", name: "Curso legal", kind: "legal_mandatory",
      minimumDurationMinutes: 480, validityMonths: 24, passingScore: 70,
    })
    expect(result.success).toBe(false)
  })

  it("una ODI exige derivar de un peligro de la MIPER", () => {
    const result = trainingCourseSchema.safeParse({
      code: "ODI-01", name: "ODI soldadura", kind: "odi",
      minimumDurationMinutes: 60, passingScore: 70,
    })
    expect(result.success).toBe(false)
  })
})

describe("motor de brechas de competencia", () => {
  const asOf = "2026-07-19"

  it("detecta una competencia nunca obtenida como brecha bloqueante", () => {
    const gaps = computeCompetencyGaps({ workers: [worker()], requirements: [requirement()], competencies: [], asOf })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ workerId: "w-1", gapType: "missing", enforcement: "blocking" })
  })

  it("no reporta brecha cuando la competencia está vigente", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [{ workerId: "w-1", courseId: "course-1", status: "valid", expiresAt: "2027-01-01" }],
      asOf,
    })
    expect(gaps).toEqual([])
  })

  it("trata como vencida una fila 'valid' cuya fecha ya pasó, sin esperar al job", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [{ workerId: "w-1", courseId: "course-1", status: "valid", expiresAt: "2026-01-01" }],
      asOf,
    })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ gapType: "expired", expiredAt: "2026-01-01" })
  })

  it("una competencia sin vencimiento permanece vigente", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [{ workerId: "w-1", courseId: "course-1", status: "valid", expiresAt: null }],
      asOf,
    })
    expect(gaps).toEqual([])
  })

  it("una competencia revocada deja brecha aunque exista la fila", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [{ workerId: "w-1", courseId: "course-1", status: "revoked", expiresAt: "2027-01-01" }],
      asOf,
    })
    expect(gaps[0]?.gapType).toBe("revoked")
  })

  it("ignora trabajadores inactivos", () => {
    const gaps = computeCompetencyGaps({ workers: [worker({ isActive: false })], requirements: [requirement()], competencies: [], asOf })
    expect(gaps).toEqual([])
  })

  it("ignora requisitos desactivados", () => {
    const gaps = computeCompetencyGaps({ workers: [worker()], requirements: [requirement({ isActive: false })], competencies: [], asOf })
    expect(gaps).toEqual([])
  })

  it("un requisito por cargo no alcanza a otro cargo", () => {
    const gaps = computeCompetencyGaps({ workers: [worker({ position: "Administrativo" })], requirements: [requirement()], competencies: [], asOf })
    expect(gaps).toEqual([])
  })

  it("compara cargos ignorando mayúsculas y espacios", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker({ position: "  operador MAQUINARIA pesada " })],
      requirements: [requirement()],
      competencies: [],
      asOf,
    })
    expect(gaps).toHaveLength(1)
  })

  it("un requisito por faena sólo alcanza a esa faena", () => {
    const req = requirement({ scopeType: "worksite", scopeValue: null, worksiteId: "ws-2" })
    expect(computeCompetencyGaps({ workers: [worker()], requirements: [req], competencies: [], asOf })).toEqual([])
    expect(computeCompetencyGaps({ workers: [worker({ worksiteId: "ws-2" })], requirements: [req], competencies: [], asOf })).toHaveLength(1)
  })

  it("un requisito global alcanza a toda la dotación activa", () => {
    const req = requirement({ scopeType: "global", scopeValue: null, enforcement: "warning" })
    const gaps = computeCompetencyGaps({
      workers: [worker(), worker({ id: "w-2", position: "Administrativo", worksiteId: "ws-9" })],
      requirements: [req],
      competencies: [],
      asOf,
    })
    expect(gaps).toHaveLength(2)
    expect(gaps.every((gap) => gap.enforcement === "warning")).toBe(true)
  })

  it("un requisito por tarea no se resuelve por dotación", () => {
    const req = requirement({ scopeType: "task", scopeValue: "izaje" })
    expect(computeCompetencyGaps({ workers: [worker()], requirements: [req], competencies: [], asOf })).toEqual([])
  })

  it("una competencia de otro curso no tapa la brecha", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [{ workerId: "w-1", courseId: "otro-curso", status: "valid", expiresAt: null }],
      asOf,
    })
    expect(gaps).toHaveLength(1)
  })

  it("una competencia reemplazada por una vigente no genera brecha", () => {
    const gaps = computeCompetencyGaps({
      workers: [worker()],
      requirements: [requirement()],
      competencies: [
        { workerId: "w-1", courseId: "course-1", status: "superseded", expiresAt: "2026-01-01" },
        { workerId: "w-1", courseId: "course-1", status: "valid", expiresAt: "2028-01-01" },
      ],
      asOf,
    })
    expect(gaps).toEqual([])
  })
})
