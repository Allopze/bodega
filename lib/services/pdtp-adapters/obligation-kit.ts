/**
 * lib/services/pdtp-adapters/obligation-kit.ts
 *
 * La disciplina de errores del conector del RE-20, escrita una vez.
 *
 * `incident-accreditation-connector.ts` la inauguró: resolver el programa
 * activo, crear la obligación, y tragarse todo lo que falle para que un
 * problema del PDTP nunca tumbe el hecho operacional que lo originó. Los tres
 * conectores nuevos —organización preventiva (N°11), ciclo de vida del
 * trabajador (N°15/16/52) y brecha de competencia (N°57)— necesitan lo mismo,
 * así que en vez de copiarla tres veces vive acá.
 *
 * Dos diferencias deliberadas con el conector de incidentes:
 *
 * 1. **Las condiciones esperadas se cuentan, no se loguean.** Un programa en
 *    borrador, una faena fuera del programa o una actividad excluida no son
 *    fallas: son el estado normal de buena parte del año. Dos barridos diarios
 *    sobre todas las faenas convertirían eso en miles de líneas de log sin
 *    información. Sólo las fallas reales llegan a `logger.error`.
 *
 * 2. **El sujeto es explícito.** Una obligación del RE-20 se identifica por su
 *    incidente, que es un id único. Las de acá son de sujetos recurrentes —una
 *    faena, una persona, una persona+curso— que pueden abrir un caso nuevo
 *    cuando el anterior ya cerró. El sujeto viaja en `sourceMetadata.subjectKey`
 *    y el episodio en el `sourceId`.
 */

import { db } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { eq } from "drizzle-orm"
import { logger } from "@/lib/logger"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import {
  createPdtpObligation,
  findOpenPdtpObligationBySubject,
  reportPdtpObligation,
} from "@/lib/services/pdtp/obligations"
import { resolvePdtpEffectiveActivitiesForWorksite } from "@/lib/services/pdtp/worksites"

export type ObligationOutcome =
  | "opened"
  | "already_open"
  | "skipped_excluded"
  | "skipped_no_program"
  | "skipped_out_of_period"
  | "error"

export type ObligationSweepCounters = {
  opened: number
  alreadyOpen: number
  skipped: number
  errors: number
}

export function emptySweepCounters(): ObligationSweepCounters {
  return { opened: 0, alreadyOpen: 0, skipped: 0, errors: 0 }
}

export function countOutcome(counters: ObligationSweepCounters, outcome: ObligationOutcome): void {
  if (outcome === "opened") counters.opened += 1
  else if (outcome === "already_open") counters.alreadyOpen += 1
  else if (outcome === "error") counters.errors += 1
  else counters.skipped += 1
}

/**
 * El actor que queda como autor de una obligación abierta por un barrido.
 *
 * No existe un usuario de sistema en esta plataforma y no se inventa uno:
 * `pdtp_obligations.created_by_user_id` es FK real a `users`. La convención
 * vigente para trabajo materializado por cron es heredar el actor del registro
 * que lo programó (`prevention-inspection-scheduler.ts` hereda el del programa
 * de inspecciones), así que acá se hereda del programa PDTP. Puede ser `null`
 * —los tres campos son nullable— y la columna lo admite.
 */
export async function resolvePdtpProgramActorUserId(programId: string): Promise<string | null> {
  const [program] = await db.select({
    activatedByUserId: pdtpPrograms.activatedByUserId,
    elaboratedByUserId: pdtpPrograms.elaboratedByUserId,
    approvedByJdprUserId: pdtpPrograms.approvedByJdprUserId,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null
  return program.activatedByUserId ?? program.elaboratedByUserId ?? program.approvedByJdprUserId ?? null
}

/**
 * Resuelve la actividad de un número para una faena, tolerando como estado
 * normal todo lo que el motor considera error de configuración.
 *
 * `resolvePdtpActivityIdsForNumbers` **lanza** para "sin programa activo" y
 * "la faena no pertenece al programa", y devuelve `null` para "el evento cae
 * fuera del año". Para un conector de barrido las tres son lo mismo: no hay
 * nada que hacer y no hay nada que reportar.
 */
async function resolveActivity(input: {
  activityNumber: number
  worksiteId: string
  occurredAt: string
  sourceType: string
  sourceId: string
}): Promise<{ programId: string; activityId: string } | "skipped_no_program" | "skipped_out_of_period"> {
  const resolved = await resolvePdtpActivityIdsForNumbers({
    worksiteId: input.worksiteId,
    occurredAt: input.occurredAt,
    activityNumbers: [input.activityNumber],
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  }).catch(() => "throws" as const)

  if (resolved === "throws") return "skipped_no_program"
  if (resolved === null) return "skipped_out_of_period"
  const activityId = resolved.activityIdByN.get(input.activityNumber)
  if (!activityId) return "skipped_no_program"
  return { programId: resolved.programId, activityId }
}

/**
 * Abre la obligación de una actividad para un sujeto, si no hay ya una abierta.
 *
 * Nunca lanza. El llamador cuenta el resultado; sólo `"error"` significa que
 * algo se rompió de verdad.
 *
 * La exclusión por faena se pre-chequea con
 * `resolvePdtpEffectiveActivitiesForWorksite` en vez de dejar que
 * `createPdtpObligation` lance: distinguir una exclusión legítima de una falla
 * real por el texto de un mensaje en español es exactamente la clase de
 * acoplamiento que después nadie se atreve a tocar. Quien barre muchos sujetos
 * de la misma faena puede pasar `effectiveActivityIds` ya resuelto para no
 * repetir la consulta.
 */
export async function ensureSubjectObligation(input: {
  activityNumber: number
  worksiteId: string
  subjectKey: string
  sourceType: string
  sourceId: string
  occurredAt: string
  userId: string | null
  sourceMetadata?: Record<string, unknown>
  effectiveActivityIds?: Set<string>
}): Promise<ObligationOutcome> {
  try {
    const resolved = await resolveActivity(input)
    if (typeof resolved === "string") return resolved

    const effective = input.effectiveActivityIds
      ?? new Set((await resolvePdtpEffectiveActivitiesForWorksite(resolved.programId, input.worksiteId)).map((a) => a.id))
    if (!effective.has(resolved.activityId)) return "skipped_excluded"

    const open = await findOpenPdtpObligationBySubject({
      activityId: resolved.activityId,
      worksiteId: input.worksiteId,
      subjectKey: input.subjectKey,
    })
    if (open) return "already_open"

    const { created } = await createPdtpObligation({
      activityId: resolved.activityId,
      worksiteId: input.worksiteId,
      origin: "integration",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceOccurredAt: input.occurredAt,
      sourceMetadata: { subjectKey: input.subjectKey, ...(input.sourceMetadata ?? {}) },
      userId: input.userId,
      // El conector corre después de que el llamador ya validó su propio
      // permiso, o desde un cron que no tiene sesión. Mismo contrato que
      // `ensureIncidentObligation`.
      scope: "all",
    })
    return created ? "opened" : "already_open"
  } catch (err) {
    logger.error(
      { err, activityNumber: input.activityNumber, worksiteId: input.worksiteId, subjectKey: input.subjectKey },
      "[pdtp-obligation-kit] No se pudo abrir la obligación del sujeto.",
    )
    return "error"
  }
}

/**
 * Reporta la obligación abierta de un sujeto.
 *
 * Tolerante a que no exista: `logger.warn` y sigue, igual que
 * `reportIncidentObligation`. Esa advertencia es la señal de que el abridor no
 * disparó —el barrido no había corrido todavía, o el trabajador entró antes de
 * que existiera este código—, y es justamente lo que se quiere ver en el log.
 */
export async function reportSubjectObligation(input: {
  activityNumber: number
  worksiteId: string
  subjectKey: string
  occurredAt: string
  evidenceText: string
  userId: string
  executedQuantity?: number
}): Promise<"reported" | "no_obligation" | "error"> {
  try {
    const resolved = await resolveActivity({
      activityNumber: input.activityNumber,
      worksiteId: input.worksiteId,
      occurredAt: input.occurredAt,
      sourceType: "obligacion",
      sourceId: input.subjectKey,
    })
    if (typeof resolved === "string") return "no_obligation"

    const obligation = await findOpenPdtpObligationBySubject({
      activityId: resolved.activityId,
      worksiteId: input.worksiteId,
      subjectKey: input.subjectKey,
    })
    if (!obligation) {
      logger.warn(
        { activityNumber: input.activityNumber, worksiteId: input.worksiteId, subjectKey: input.subjectKey },
        "[pdtp-obligation-kit] No hay obligación abierta para este sujeto; no se reporta.",
      )
      return "no_obligation"
    }

    await reportPdtpObligation({
      obligationId: obligation.id,
      executedQuantity: input.executedQuantity ?? 1,
      evidenceText: input.evidenceText,
      reportedAt: input.occurredAt,
      userId: input.userId,
      scope: "all",
    })
    return "reported"
  } catch (err) {
    logger.error(
      { err, activityNumber: input.activityNumber, worksiteId: input.worksiteId, subjectKey: input.subjectKey },
      "[pdtp-obligation-kit] No se pudo reportar la obligación del sujeto.",
    )
    return "error"
  }
}
