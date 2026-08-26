import { z } from "zod"
import { normalizeRiskLevel } from "@/lib/prevention/risk-levels"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const reason = z.string().trim().min(10).max(3000)

/* MIPER-01: el nivel de riesgo era `z.string().min(1)` al escribir y un enum
 * inglés al leer, así que "Alto" o "critico" se guardaban tal cual y la UI los
 * pintaba en gris. Acá se normaliza contra el vocabulario único de
 * lib/prevention/risk-levels y se rechaza lo que no corresponda a un nivel:
 * lo almacenable pasa a ser exactamente lo que la UI sabe etiquetar. */
export const riskLevelSchema = z.string().trim().min(1).max(100)
  .refine((value) => normalizeRiskLevel(value) !== null, { message: "Nivel de riesgo desconocido: usa bajo, medio, alto o crítico." })
  .transform((value) => normalizeRiskLevel(value)!)

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
  /* MIPER-08: 'verified' salió del enum. Un control no nace verificado — quien
   * escribía el peligro declaraba verificado su propio control, sin evidencia y
   * sin que nadie más lo mirara. La verificación es un acto posterior y
   * segregado: `verifyRiskControl` en lib/services/prevention-risk-legal.ts. */
  status: z.enum(["proposed", "implemented", "ineffective"]).default("proposed"),
  evidenceReference: z.string().trim().max(3000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.isCritical && (value.performanceStandard?.length ?? 0) < 5) ctx.addIssue({ code: "custom", path: ["performanceStandard"], message: "Un control crítico exige estándar de desempeño." })
  if (value.isCritical && (value.verificationFrequency?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["verificationFrequency"], message: "Un control crítico exige frecuencia de verificación." })
})

/* Motor de evaluación P×C (lib/prevention/risk-engine.ts): el único dato de
 * evaluación que acepta el cliente es probabilidad y consecuencia. MR
 * (`riskMagnitude`), clasificación (`riskClassification`), `residualLevel` y
 * `residualScore` NO están en este shape — el cliente no puede ni intentar
 * fijarlos; el servidor los calcula siempre (`evaluateRisk()`) antes de
 * persistir. La evaluación "inherente" (antes de controles) es opcional: la
 * plantilla real de la empresa sólo tiene una evaluación (mapea a residual). */
export const riskEvaluationInputSchema = z.object({
  probability: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  consequence: z.union([z.literal(1), z.literal(2), z.literal(4)]),
})

export const riskEntrySchema = z.object({
  matrixId: z.string().min(1),
  process: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), description: z.string().trim().max(2000).nullable().optional() }),
  task: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), isRoutine: z.boolean().default(true) }),
  position: z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(300), workerPositionKey: z.string().trim().max(300).nullable().optional() }),
  hazardCode: z.string().trim().min(1).max(100),
  hazard: z.string().trim().min(3).max(2000),
  /* "Riesgo" (§11.12): concepto distinto de "Peligro" en la plantilla real —
   * columnas separadas PELIGRO/RIESGO. Nullable en BD para no inventar texto
   * en entries históricas, pero requerido acá: toda entrada NUEVA (creador
   * guiado o importador) siempre lo trae. */
  risk: z.string().trim().min(2).max(2000),
  riskFactor: z.string().trim().min(2).max(2000),
  expectedEventOrDamage: z.string().trim().min(3).max(3000),
  exposedPeopleDescription: z.string().trim().min(3).max(2000),
  exposedPeopleCount: z.coerce.number().int().min(0).nullable().optional(),
  isRoutine: z.boolean().default(true),
  specificWorkplace: z.string().trim().max(500).nullable().optional(),
  exposedWorkersFemale: z.coerce.number().int().min(0).nullable().optional(),
  exposedWorkersMale: z.coerce.number().int().min(0).nullable().optional(),
  exposedWorkersOther: z.coerce.number().int().min(0).nullable().optional(),
  genderConsiderations: z.string().trim().min(3).max(3000),
  sensitiveWorkerConsiderations: z.string().trim().min(3).max(3000),
  specialMethodologyReference: z.string().trim().max(1000).nullable().optional(),
  /* Evaluación calculada por el motor — probabilidad/consecuencia. */
  ...riskEvaluationInputSchema.shape,
  /* Evaluación "inherente" opcional (antes de controles). Sigue aceptando el
   * shape libre anterior por compatibilidad con matrices creadas antes del
   * motor P×C; nunca la exige el creador guiado. `null`/ausente cuando no se
   * completa — nunca `{}` como sustituto de "sin evaluar". */
  inherentDimensions: z.record(z.string(), z.unknown()).nullable().optional(),
  inherentScore: z.coerce.number().min(0).nullable().optional(),
  inherentLevel: riskLevelSchema.nullable().optional(),
  controlStatusText: z.enum(["controlled", "partial", "partial_immediate"]).nullable().optional(),
  controlDeadlineText: z.string().trim().max(300).nullable().optional(),
  /* Discrepancia MR/clasificación entre el Excel importado y el cálculo del
   * sistema (§67) — nunca la fija el cliente en el creador guiado, sólo el
   * importador la produce. Se acepta acá porque `addRiskEntryWithClient` es
   * el único punto de escritura, tanto para el creador como para el import. */
  evaluationDivergence: z.record(z.string(), z.unknown()).nullable().optional(),
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
  /* 'draft' es el retorno del revisor (MIPER-10): la máquina sólo avanzaba, así
   * que una versión enviada a revisión con un error se quedaba trabada ahí. El
   * motivo ya es obligatorio para toda transición y queda en el historial.
   * 'approved' no es un destino válido aquí: exigía una sola firma y hoy sólo
   * se alcanza a través de `decideRiskMatrixApprovalSchema`, cuando ambos
   * dominios (Prevención y Operaciones) firman. */
  toStatus: z.enum(["draft", "in_review", "reviewed", "published"]),
  reason,
  effectiveFrom: date.optional(),
})

/* Doble aprobación (§48-51): cada dominio firma por separado, con motivo
 * obligatorio tanto para aprobar como para rechazar — a diferencia de
 * `riskMatrixTransitionSchema`, aquí el motivo siempre es exigible porque no
 * hay ninguna transición "de trámite" (como enviar a revisión) que lo
 * amerite opcional. Mismo mecanismo de excepción de segregación que
 * `riskControlVerificationSchema`. */
export const decideRiskMatrixApprovalSchema = z.object({
  matrixId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  domain: z.enum(["prevention", "operations"]),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(10).max(3000),
  segregationExceptionReason: z.string().trim().max(2000).optional(),
})

/* MIPER-08: verificar un control es un acto separado de escribirlo, con
 * evidencia obligatoria y segregación por identidad —mismo contrato que la
 * verificación CAPA (`capaTransitionSchema`), incluida la excepción
 * fundamentada para quien tenga el permiso de override. */
export const riskControlVerificationSchema = z.object({
  controlId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  effectivenessStatus: z.enum(["effective", "ineffective"]),
  evidenceReference: z.string().trim().min(5).max(3000),
  verificationNote: z.string().trim().min(5).max(3000),
  segregationExceptionReason: z.string().trim().max(2000).optional(),
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
    "protocolo_minsal",
  ]),
  sourceId: z.string().trim().min(1).max(300),
  justification: reason,
})

export const pdtpObligationResolutionSchema = z.object({
  obligationId: z.string().min(1),
  programId: z.string().min(1),
  resolution: reason,
})
