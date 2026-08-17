import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isLegalRequirementInForce } from "@/lib/services/prevention-risk-legal"
import {
  LEGAL_APPLICABILITY_STATUS_LABELS,
  LEGAL_COMPLIANCE_STATUS_LABELS,
  LEGAL_REQUIREMENT_STATUS_LABELS,
  legalStatusVariant,
} from "@/lib/prevention/badges"
import {
  RISK_LEVELS,
  RISK_LEVEL_COLOR,
  RISK_LEVEL_LABEL,
  normalizeRiskLevel,
} from "@/lib/prevention/risk-levels"
import {
  riskControlSchema,
  riskEntrySchema,
  riskLevelSchema,
  riskMatrixDraftSchema,
  riskMatrixTransitionSchema,
  riskMethodologySchema,
  riskReviewTriggerSchema,
} from "@/lib/validation/prevention-module/risk-legal"

const validEntry = {
  matrixId: "mat-101",
  process: { code: "PROC-01", name: "Operación planta" },
  task: { code: "TASK-01", name: "Operar cinta", isRoutine: true },
  position: { code: "POS-01", name: "Operador" },
  hazardCode: "MEC-01",
  hazard: "Atrapamiento en cinta transportadora",
  riskFactor: "Partes móviles sin resguardo",
  expectedEventOrDamage: "Amputación o lesión grave",
  exposedPeopleDescription: "Operadores y mantenedores",
  genderConsiderations: "Evaluar diferencias de exposición y ajuste de EPP.",
  sensitiveWorkerConsiderations: "Validar restricciones sin exponer diagnósticos.",
  inherentDimensions: { probability: 4, consequence: 5 },
  inherentLevel: "Alto",
  residualDimensions: { probability: 2, consequence: 5 },
  residualLevel: "Medio",
  responsibleSnapshot: "Jefatura de operaciones",
}

describe("Prevention Risk & Legal Validation Schemas", () => {
  it("validates valid risk methodology configurations", () => {
    const validMethodology = {
      code: "METH-ISP-01",
      name: "Matriz ISP de Evaluación de Riesgos",
      versionLabel: "2026.1",
      kind: "primary",
      authoritySource: "Ministerio de Salud / ISP Chile",
      configuration: { probabilityScale: 5, consequenceScale: 5 },
    }

    expect(riskMethodologySchema.parse(validMethodology)).toMatchObject(validMethodology)
  })

  it("validates draft risk matrix schema requiring detailed justification", () => {
    const validDraft = {
      worksiteId: "ws-faena-1",
      title: "Matriz MIPER Faena Minera Norte 2026",
      methodologyId: "meth-123",
      revisionReason: "Revisión anual obligatoria según DS 44 Artículo 73",
      participationSummary: "Consulta realizada con el Comité Paritario de Higiene y Seguridad",
      consultationEvidenceReference: "ACTA-CPHS-2026-04",
    }

    expect(riskMatrixDraftSchema.parse(validDraft)).toMatchObject(validDraft)
  })

  it("requires performance standard and verification frequency for CRITICAL risk controls", () => {
    const invalidCriticalControl = {
      description: "Extintor de PQS 10kg en tablero eléctrico",
      hierarchy: "engineering",
      isExisting: true,
      isCritical: true, // Control crítico
      performanceStandard: "", // Inválido: < 5 caracteres
      verificationFrequency: "", // Inválido: < 2 caracteres
      responsibleSnapshot: "Juan Pérez (Prevencionista)",
    }

    expect(() => riskControlSchema.parse(invalidCriticalControl)).toThrow(/estándar de desempeño/i)
  })

  it("accepts valid CRITICAL risk control with performance standard and frequency", () => {
    const validCriticalControl = {
      description: "Sistema de parada de emergencia en cinta transportadora",
      hierarchy: "engineering",
      isExisting: true,
      isCritical: true,
      performanceStandard: "Inspección de accionamiento e interrupción en menos de 2 segundos",
      verificationFrequency: "Semanal",
      responsibleSnapshot: "María Silva (Jefa de Mantención)",
    }

    expect(riskControlSchema.parse(validCriticalControl)).toMatchObject(validCriticalControl)
  })

  it("validates review triggers with idempotency keys", () => {
    const validTrigger = {
      worksiteId: "ws-1",
      triggerType: "work_accident",
      sourceType: "incident",
      sourceId: "inc-2026-99",
      description: "Actualización de matriz por accidente grave con tiempo perdido en área chancado",
      dueAt: "2026-08-15",
      idempotencyKey: "trigger-inc-2026-99-annual",
    }

    expect(riskReviewTriggerSchema.parse(validTrigger)).toMatchObject(validTrigger)
  })

  // MIPER-01: el nivel era texto libre al escribir y un enum inglés al leer, así
  // que "Alto", "critico" y "moderate" convivían en la misma columna y la UI
  // pintaba en gris todo lo que no fuera inglés.
  it("normaliza el nivel de riesgo a un vocabulario único y rechaza lo que no lo es", () => {
    expect(riskLevelSchema.parse("Alto")).toBe("high")
    expect(riskLevelSchema.parse("  CRÍTICO ")).toBe("critical")
    expect(riskLevelSchema.parse("moderate")).toBe("medium")
    expect(riskLevelSchema.parse("medio")).toBe("medium")
    expect(riskLevelSchema.parse("low")).toBe("low")
    expect(() => riskLevelSchema.parse("Regular")).toThrow(/nivel de riesgo desconocido/i)
    expect(normalizeRiskLevel("no es un nivel")).toBeNull()
  })

  it("todo nivel almacenable tiene etiqueta y color, y la restricción de base coincide", () => {
    for (const level of RISK_LEVELS) {
      expect(RISK_LEVEL_LABEL[level]).toBeTruthy()
      expect(RISK_LEVEL_COLOR[level]).toMatch(/^var\(--color-/)
      // Redundante a propósito: si alguien agrega un nivel a la lista sin darle
      // alias, deja de ser almacenable por el schema y la UI nunca lo verá.
      expect(normalizeRiskLevel(level)).toBe(level)
    }
    const schema = readFileSync(path.join(process.cwd(), "db/schema/prevention/risk-legal.ts"), "utf8")
    const constraint = `IN (${RISK_LEVELS.map((level) => `'${level}'`).join(", ")})`
    expect(schema).toContain(`prevention_risk_entries_residual_level_valid", sql\`\${table.residualLevel} ${constraint}`)
    expect(schema).toContain(`prevention_risk_entries_inherent_level_valid", sql\`\${table.inherentLevel} ${constraint}`)
  })

  // MIPER-08: quien escribía el peligro declaraba verificado su propio control
  // en el mismo payload, sin evidencia y sin que nadie más lo mirara.
  it("un control no puede nacer verificado", () => {
    const control = {
      description: "Enclavamiento de parada de emergencia",
      hierarchy: "engineering",
      isExisting: true,
      isCritical: false,
      responsibleSnapshot: "Jefatura de mantención",
    }
    expect(riskControlSchema.parse({ ...control, status: "implemented" }).status).toBe("implemented")
    expect(() => riskControlSchema.parse({ ...control, status: "verified" })).toThrow()
    expect(() => riskEntrySchema.parse({ ...validEntry, controls: [{ ...control, status: "verified" }] })).toThrow()
    expect(riskEntrySchema.parse({ ...validEntry, controls: [control] }).controls[0]!.status).toBe("proposed")
  })

  /* LEGAL-09: la ficha del requisito pintaba el enum crudo ("not_applicable")
   * y la mesa de trabajo tenía su propio diccionario, incompleto. Lo que hay
   * que cubrir no es el camino feliz sino TODO valor que la base admite: la
   * fuente de esa lista son las restricciones CHECK, así que se leen de ahí y
   * no de una lista escrita a mano que se olvidaría de crecer. */
  it("todo estado almacenable del registro legal tiene etiqueta en español", () => {
    const schema = readFileSync(path.join(process.cwd(), "db/schema/prevention/risk-legal.ts"), "utf8")
    const storableValues = (constraint: string) => {
      const match = schema.match(new RegExp(`"${constraint}", sql\`[^\`]*IN \\(([^)]*)\\)`))
      if (!match) throw new Error(`No se encontró la restricción ${constraint} en el esquema`)
      return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, ""))
    }
    const cases: Array<[string, Record<string, string>]> = [
      ["prevention_legal_requirements_status_valid", LEGAL_REQUIREMENT_STATUS_LABELS],
      ["prevention_legal_applicabilities_status_valid", LEGAL_APPLICABILITY_STATUS_LABELS],
      ["prevention_legal_applicabilities_compliance_valid", LEGAL_COMPLIANCE_STATUS_LABELS],
    ]
    for (const [constraint, labels] of cases) {
      const values = storableValues(constraint)
      expect(values.length).toBeGreaterThan(1)
      for (const value of values) {
        expect(labels[value], `${constraint}: falta etiqueta para "${value}"`).toBeTruthy()
        expect(labels[value]).not.toBe(value)
        expect(legalStatusVariant(value)).toBeTruthy()
      }
      // Y nada de más: una etiqueta para un valor que la base no admite es una
      // etiqueta que nadie va a ver y que oculta el diccionario que falta.
      expect(Object.keys(labels).sort()).toEqual([...values].sort())
    }
    // 'not_applicable' es el mismo valor en dos vocabularios distintos: la faena
    // no está alcanzada por el requisito / no hay cumplimiento que evaluar.
    expect(LEGAL_APPLICABILITY_STATUS_LABELS.not_applicable).not.toBe(LEGAL_COMPLIANCE_STATUS_LABELS.not_applicable)
  })

  it("validates matrix state transition schemas", () => {
    const validTransition = {
      matrixId: "mat-101",
      expectedVersion: 2,
      toStatus: "approved",
      reason: "Aprobación formal por Gerencia de Operaciones y Prevención",
      effectiveFrom: "2026-08-01",
    }

    expect(riskMatrixTransitionSchema.parse(validTransition)).toMatchObject(validTransition)
  })
})

describe("ventana de vigencia del requisito legal (LEGAL-03)", () => {
  const TODAY = "2026-08-16"
  const req = (over: Partial<{ status: string; validFrom: string; validTo: string | null }>) => ({
    status: "published", validFrom: "2026-01-01", validTo: null, ...over,
  } as Parameters<typeof isLegalRequirementInForce>[0])

  it("una versión publicada rige dentro de su ventana y no fuera de ella", () => {
    expect(isLegalRequirementInForce(req({}), TODAY)).toBe(true)
    expect(isLegalRequirementInForce(req({ validFrom: "2026-09-01" }), TODAY)).toBe(false)
    expect(isLegalRequirementInForce(req({ validTo: "2026-08-15" }), TODAY)).toBe(false)
    expect(isLegalRequirementInForce(req({ validTo: TODAY }), TODAY)).toBe(true)
  })

  /**
   * El caso que dejaba una ventana muerta: publicar la enmienda con anticipación
   * superaba la versión anterior en el acto, así que entre hoy y la entrada en
   * vigor de la nueva el artículo no regía por ninguna de las dos filas.
   */
  it("la versión superada sigue rigiendo hasta que entra en vigor su reemplazo, sin traslape", () => {
    const anterior = req({ status: "superseded", validTo: "2026-08-31" })
    const nueva = req({ validFrom: "2026-09-01" })

    expect(isLegalRequirementInForce(anterior, TODAY)).toBe(true)
    expect(isLegalRequirementInForce(nueva, TODAY)).toBe(false)

    // El día del relevo rige exactamente una: la anterior cerró el día previo.
    expect(isLegalRequirementInForce(anterior, "2026-09-01")).toBe(false)
    expect(isLegalRequirementInForce(nueva, "2026-09-01")).toBe(true)
  })

  it("una superada sin fecha de término no rige: sin ventana no hay vigencia que sostener", () => {
    expect(isLegalRequirementInForce(req({ status: "superseded", validTo: null }), TODAY)).toBe(false)
  })

  it("un borrador nunca rige, aunque su ventana esté abierta", () => {
    expect(isLegalRequirementInForce(req({ status: "draft" }), TODAY)).toBe(false)
  })
})
