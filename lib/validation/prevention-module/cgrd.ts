import { z } from "zod"

const reason = z.string().trim().min(10).max(2000)
const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const grdCommitteeConstituteSchema = z.object({
  worksiteId: z.string().min(1),
  name: z.string().trim().min(3).max(300),
  constitutedOn: plainDate,
  mandateEndsOn: plainDate,
})

export const grdCoordinatorDesignateSchema = z.object({
  worksiteId: z.string().min(1),
  workerId: z.string().min(1),
  designatedOn: plainDate,
})

export const grdCoordinatorEndSchema = z.object({
  coordinatorId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason: reason,
})

export const grdCommitteeDissolveSchema = z.object({
  committeeId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason,
})

export const grdMemberAddSchema = z.object({
  committeeId: z.string().min(1),
  workerId: z.string().min(1),
  role: z.enum(["presidente", "secretario", "integrante"]).nullable().optional(),
})

export const grdMemberRemoveSchema = z.object({
  memberId: z.string().min(1),
  reason,
})

export const grdMatrixDraftSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(5).max(500),
  revisionReason: reason,
})

export const grdThreatUpsertSchema = z.object({
  matrixId: z.string().min(1),
  name: z.string().trim().min(3).max(300),
  origin: z.enum(["obligatoria", "detectada"]),
  historicalAnalysis: z.string().trim().min(10).max(5000),
  legalRequirement: z.string().trim().min(10).max(5000),
  workPlan: z.string().trim().min(10).max(5000),
  emergencyScenarioId: z.string().min(1).nullable().optional(),
})

export const grdThreatRemoveSchema = z.object({
  threatId: z.string().min(1),
})

export const grdMatrixTransitionSchema = z.object({
  matrixId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  // 'draft' es el retorno del revisor, mismo criterio que MIPER-10: una
  // versión enviada a revisión con una amenaza mal evaluada no debe quedar
  // trabada sin poder corregirse.
  toStatus: z.enum(["draft", "in_review", "reviewed", "approved", "published"]),
  reason,
})

export const grdMeetingScheduleSchema = z.object({
  committeeId: z.string().min(1),
  scheduledFor: z.iso.datetime({ offset: true }),
  agenda: z.string().trim().min(10).max(5000),
})

export const grdMeetingCloseSchema = z.object({
  meetingId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  minutes: z.string().trim().min(20).max(20_000),
  quorumReached: z.boolean(),
  /**
   * Cada acuerdo se deriva a CAPA común, igual que en el CPHS: un acuerdo con
   * responsable y plazo que no se persigue hasta el cierre no es seguimiento.
   * Vacío es válido — un acta puede no producir acuerdos.
   */
  agreements: z.array(z.object({
    description: z.string().trim().min(5).max(3000),
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    targetDate: plainDate,
  })).default([]),
})

export const grdMeetingCancelSchema = z.object({
  meetingId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason,
})
