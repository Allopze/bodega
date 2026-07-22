import { describe, expect, it } from "vitest"
import {
  riskControlSchema,
  riskMatrixDraftSchema,
  riskMatrixTransitionSchema,
  riskMethodologySchema,
  riskReviewTriggerSchema,
} from "@/lib/validation/prevention-module/risk-legal"

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
