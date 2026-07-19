import { z } from "zod"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const instant = z.string().datetime({ offset: true })
const reason = z.string().trim().min(10).max(3000)

/** RUT chileno con guion y dígito verificador; se normaliza sin puntos. */
const rut = z.string().trim().min(8).max(13).regex(/^\d{7,8}-[\dkK]$/, "RUT inválido: usa formato 12345678-9")

export const CONTRACTOR_RELATIONSHIPS = ["contractor", "subcontractor", "service_provider"] as const

export const contractorCompanySchema = z.object({
  rut,
  legalName: z.string().trim().min(3).max(300),
  tradeName: z.string().trim().max(300).nullable().optional(),
  businessActivity: z.string().trim().max(300).nullable().optional(),
  insuranceAdministrator: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactEmail: z.email("Correo inválido").max(200).nullable().optional(),
  contactPhone: z.string().trim().max(60).nullable().optional(),
  parentCompanyId: z.string().min(1).nullable().optional(),
})

export const contractorContractSchema = z.object({
  code: z.string().trim().min(3).max(60),
  companyId: z.string().min(1),
  worksiteId: z.string().min(1),
  relationship: z.enum(CONTRACTOR_RELATIONSHIPS),
  scope: z.string().trim().min(10).max(3000),
  startsOn: date,
  endsOn: date.nullable().optional(),
  plannedHeadcount: z.number().int().positive().max(100_000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.endsOn && value.endsOn < value.startsOn) {
    ctx.addIssue({ code: "custom", path: ["endsOn"], message: "El término no puede ser anterior al inicio." })
  }
})

export const contractorWorkerSchema = z.object({
  contractId: z.string().min(1),
  rut,
  firstName: z.string().trim().min(2).max(120),
  lastName: z.string().trim().min(2).max(120),
  position: z.string().trim().max(200).nullable().optional(),
  shift: z.string().trim().max(120).nullable().optional(),
  startsOn: date.nullable().optional(),
  endsOn: date.nullable().optional(),
})

export const accreditationRequirementSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(300),
  appliesTo: z.enum(["company", "contract", "worker"]),
  worksiteId: z.string().min(1).nullable().optional(),
  relationship: z.enum(CONTRACTOR_RELATIONSHIPS).nullable().optional(),
  enforcement: z.enum(["blocking", "warning"]).default("blocking"),
  requiresExpiry: z.boolean().default(true),
  legalBasis: z.string().trim().min(5).max(2000),
})

export const accreditationSubmissionSchema = z.object({
  requirementId: z.string().min(1),
  contractId: z.string().min(1),
  contractorWorkerId: z.string().min(1).nullable().optional(),
  documentReference: z.string().trim().min(3).max(2000),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  issuedOn: date.nullable().optional(),
  expiresOn: date.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.issuedOn && value.expiresOn && value.expiresOn < value.issuedOn) {
    ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "El vencimiento no puede ser anterior a la emisión." })
  }
})

export const accreditationReviewSchema = z.object({
  itemId: z.string().min(1),
  decision: z.enum(["approved", "observed"]),
  observation: z.string().trim().max(2000).nullable().optional(),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, ctx) => {
  if (value.decision === "observed" && (value.observation?.trim().length ?? 0) < 5) {
    ctx.addIssue({ code: "custom", path: ["observation"], message: "Observar exige indicar qué debe corregirse." })
  }
})

export const contractAccessSchema = z.object({
  contractId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason,
})

export const contractStatusSchema = z.object({
  contractId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["active", "suspended", "finished"]),
  reason,
})

export const coordinationMeetingSchema = z.object({
  worksiteId: z.string().min(1),
  heldAt: instant,
  subject: z.string().trim().min(5).max(300),
  agenda: z.string().trim().min(10).max(5000),
  attendees: z.array(z.object({
    name: z.string().trim().min(2).max(200),
    organization: z.string().trim().min(2).max(200),
    role: z.string().trim().max(200).nullable().optional(),
  })).min(1, "Una reunión de coordinación exige al menos un asistente."),
  contractIds: z.array(z.string().min(1)).default([]),
  riskExchangeSummary: z.string().trim().max(5000).nullable().optional(),
})

export const coordinationCloseSchema = z.object({
  meetingId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  minutes: z.string().trim().min(10).max(20_000),
  attendedContractIds: z.array(z.string().min(1)).default([]),
  agreements: z.array(z.object({
    finding: z.string().trim().min(3).max(3000),
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    responsibleSnapshot: z.string().trim().max(300).nullable().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    targetDate: date,
  })).default([]),
})
