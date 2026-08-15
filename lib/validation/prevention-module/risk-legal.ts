import { z } from "zod"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const reason = z.string().trim().min(10).max(3000)

export const riskMethodologySchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(300),
  versionLabel: z.string().trim().min(1).max(80),
  kind: z.enum(["primary", "special"]),
  authoritySource: z.string().trim().min(3).max(1000),
  configuration: z.record(z.string(), z.unknown()).default({}),
})

export const riskMatrixDraftSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(5).max(500),
  methodologyId: z.string().min(1),
  revisionReason: reason,
  participationSummary: z.string().trim().min(10).max(5000),
  /* Sesión del comité que revisó la matriz. Vuelve verificable la participación
   * del CPHS que `participationSummary` sólo describe en prosa. */
  committeeMeetingId: z.string().min(1).nullable().optional(),
  consultationEvidenceReference: z.string().trim().min(3).max(2000),
  sourceMatrixId: z.string().min(1).optional(),
  sourceImportBatchId: z.string().min(1).optional(),
})

export const riskControlSchema = z.object({
  description: z.string().trim().min(3).max(3000),
  hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"]),
  isExisting: z.boolean().default(false),
  isCritical: z.boolean().default(false),
  performanceStandard: z.string().trim().max(3000).nullable().optional(),
  verificationFrequency: z.string().trim().max(300).nullable().optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().min(2).max(300),
  dueDate: date.nullable().optional(),
  status: z.enum(["proposed", "implemented", "verified", "ineffective"]).default("proposed"),
  evidenceReference: z.string().trim().max(3000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.isCritical && (value.performanceStandard?.length ?? 0) < 5) ctx.addIssue({ code: "custom", path: ["performanceStandard"], message: "Un control crítico exige estándar de desempeño." })
  if (value.isCritical && (value.verificationFrequency?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["verificationFrequency"], message: "Un control crítico exige frecuencia de verificación." })
})

export const riskEntrySchema = z.object({
  matrixId: z.string().min(1),
  process: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), description: z.string().trim().max(2000).nullable().optional() }),
  task: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), isRoutine: z.boolean().default(true) }),
  position: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), workerPositionKey: z.string().trim().max(300).nullable().optional() }),
  hazardCode: z.string().trim().min(1).max(100),
  hazard: z.string().trim().min(3).max(2000),
  riskFactor: z.string().trim().min(2).max(2000),
  expectedEventOrDamage: z.string().trim().min(3).max(3000),
  exposedPeopleDescription: z.string().trim().min(3).max(2000),
  exposedPeopleCount: z.coerce.number().int().min(0).nullable().optional(),
  genderConsiderations: z.string().trim().min(3).max(3000),
  sensitiveWorkerConsiderations: z.string().trim().min(3).max(3000),
  specialMethodologyReference: z.string().trim().max(1000).nullable().optional(),
  inherentDimensions: z.record(z.string(), z.unknown()),
  inherentScore: z.coerce.number().min(0).nullable().optional(),
  inherentLevel: z.string().trim().min(1).max(100),
  residualDimensions: z.record(z.string(), z.unknown()),
  residualScore: z.coerce.number().min(0).nullable().optional(),
  residualLevel: z.string().trim().min(1).max(100),
  isCritical: z.boolean().default(false),
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().min(2).max(300),
  evidenceReference: z.string().trim().max(3000).nullable().optional(),
  sourceRowNumber: z.number().int().positive().nullable().optional(),
  sourceOriginal: z.record(z.string(), z.unknown()).nullable().optional(),
  sourceNormalized: z.record(z.string(), z.unknown()).nullable().optional(),
  normalizationDecision: z.string().trim().max(2000).nullable().optional(),
  controls: z.array(riskControlSchema).max(50).default([]),
})

export const riskMatrixTransitionSchema = z.object({
  matrixId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  toStatus: z.enum(["in_review", "reviewed", "approved", "published"]),
  reason,
  effectiveFrom: date.optional(),
})

export const riskReviewTriggerSchema = z.object({
  worksiteId: z.string().min(1),
  matrixId: z.string().min(1).nullable().optional(),
  triggerType: z.enum(["annual", "work_change", "work_accident", "occupational_disease", "grave_imminent", "new_material_process", "audit_finding", "critical_control_failure", "legal_change", "manual"]),
  sourceType: z.string().trim().min(2).max(100),
  sourceId: z.string().trim().min(1).max(300),
  description: z.string().trim().min(5).max(3000),
  assignedToUserId: z.string().min(1).nullable().optional(),
  dueAt: date,
  idempotencyKey: z.string().trim().min(5).max(500),
})

export const legalRequirementDraftSchema = z.object({
  code: z.string().trim().min(2).max(100),
  sourceType: z.enum(["legal", "regulatory", "contractual", "standard", "internal"]),
  authority: z.string().trim().min(2).max(300),
  sourceTitle: z.string().trim().min(3).max(1000),
  sourceReference: z.string().trim().min(2).max(500),
  sourceUrl: z.url().max(3000).nullable().optional(),
  article: z.string().trim().min(1).max(500),
  requirement: z.string().trim().min(10).max(5000),
  versionLabel: z.string().trim().min(1).max(100),
  validFrom: date,
  validTo: date.nullable().optional(),
  topic: z.string().trim().min(2).max(300),
  chomeRole: z.string().trim().min(3).max(1000),
  evidenceRequired: z.string().trim().min(3).max(3000),
  frequency: z.string().trim().min(2).max(500),
  sourceRequirementId: z.string().min(1).optional(),
})

export const legalRequirementTransitionSchema = z.object({
  requirementId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  toStatus: z.enum(["in_review", "reviewed", "approved", "published"]),
  reason,
})

export const legalApplicabilityProposalSchema = z.object({
  requirementId: z.string().min(1),
  worksiteId: z.string().min(1),
  processId: z.string().min(1).nullable().optional(),
  activityReference: z.string().trim().max(1000).nullable().optional(),
  applicabilityStatus: z.enum(["proposed_applicable", "proposed_not_applicable"]),
  rationale: reason,
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().min(2).max(300),
  evidenceReference: z.string().trim().max(3000).nullable().optional(),
  evidenceDueAt: date.nullable().optional(),
})

export const legalApplicabilityApprovalSchema = z.object({
  applicabilityId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason,
})

export const legalComplianceAssessmentSchema = z.object({
  applicabilityId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(["compliant", "partial", "noncompliant"]),
  finding: z.string().trim().max(3000).nullable().optional(),
  evidenceReference: z.string().trim().max(3000).nullable().optional(),
  nextAssessmentAt: date.nullable().optional(),
  capa: z.object({
    actionDescription: z.string().trim().min(5).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    responsibleSnapshot: z.string().trim().min(2).max(300),
    targetDate: date,
    priority: z.enum(["low", "medium", "high", "critical"]).default("high"),
  }).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.status === "compliant" && (value.evidenceReference?.length ?? 0) < 3) ctx.addIssue({ code: "custom", path: ["evidenceReference"], message: "El cumplimiento exige evidencia." })
  if (["partial", "noncompliant"].includes(value.status) && ((value.finding?.length ?? 0) < 5 || !value.capa)) ctx.addIssue({ code: "custom", path: ["capa"], message: "Una brecha exige hallazgo y CAPA." })
})

export const pdtpSourceLinkSchema = z.object({
  activityId: z.string().min(1),
  worksiteId: z.string().min(1),
  sourceType: z.enum([
    "risk_control", "legal_requirement", "incident_capa", "audit", "contractual_obligation",
    "capacitacion", "inspeccion", "cphs", "epp", "emergencia", "campana",
  ]),
  sourceId: z.string().trim().min(1).max(300),
  justification: reason,
})

export const pdtpObligationResolutionSchema = z.object({
  obligationId: z.string().min(1),
  programId: z.string().min(1),
  resolution: reason,
})
