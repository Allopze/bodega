import { z } from "zod"
import { checkEvidence, evidencePathSchema } from "@/lib/validation/evidence-contract"

const reason = z.string().trim().min(10).max(2000)
const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Evidencia del CGRD, bajo el contrato único (P4): una ruta del storage de
 * CGRD, o una URL http/https alcanzable. Obligatoria en cada acto que
 * acredita una actividad del PDTP — constituir, publicar, cerrar acta —, no
 * "cualquier cosa": un acto sin evidencia no es oponible ante un fiscalizador.
 */
const evidenceUrl = z.string().trim().min(1, "Adjunta la evidencia.").refine(
  (value) => evidencePathSchema().safeParse(value).success || checkEvidence({ kind: "url", reference: value }).length === 0,
  "La evidencia debe ser un archivo subido o una URL http/https",
)

export const grdCommitteeConstituteSchema = z.object({
  worksiteId: z.string().min(1),
  name: z.string().trim().min(3).max(300),
  constitutedOn: plainDate,
  mandateEndsOn: plainDate,
  evidenceUrl,
})

export const grdCoordinatorDesignateSchema = z.object({
  worksiteId: z.string().min(1),
  workerId: z.string().min(1),
  designatedOn: plainDate,
  evidenceUrl,
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

/** Publica la matriz en borrador: único acto de la N°80, sin revisión ni
 *  aprobación intermedias — una sola persona la publica con su evidencia. */
export const grdMatrixPublishSchema = z.object({
  matrixId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  evidenceUrl,
})

/**
 * Anula un acta mal cargada y revierte la N°81 que acreditó. No borra la fila:
 * el acta acreditó, y su rastro explica por qué el programa contó y después
 * descontó esa sesión.
 */
export const grdMeetingAnnulSchema = z.object({
  meetingId: z.string().min(1),
  reason,
})

/**
 * Registra el acta de una sesión ya realizada — no convoca, no programa: se
 * carga después del hecho, como el resto de las constancias del módulo.
 */
export const grdMeetingRecordSchema = z.object({
  committeeId: z.string().min(1),
  heldOn: z.iso.datetime({ offset: true }),
  agenda: z.string().trim().min(10).max(5000),
  minutes: z.string().trim().min(20).max(20_000),
  quorumReached: z.boolean(),
  evidenceUrl,
  /**
   * La casilla del programa que esta acta llena. Opcional: una sesión
   * extraordinaria se registra igual y no cuenta en el denominador.
   */
  slotId: z.string().min(1).nullable().optional(),
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
