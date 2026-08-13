/**
 * lib/services/pdtp/accreditation.ts
 *
 * Motor de auto-acreditación PDTP (Fase 2, Plan 2026-07-22).
 *
 * Convierte eventos operacionales reales (inspección completada, sesión de
 * capacitación cerrada, acta de EPP, reunión CPHS, simulacro de emergencia)
 * en ejecuciones PDTP idempotentes con `origin: 'integration'`.
 *
 * Principios:
 * - Solo se acredita cuando el evento está **confirmado** (no en borrador).
 * - La clave idempotente evita duplicados ante reintentos.
 * - Una ejecución ya `approved` no se toca (el aprobador manual prevalece).
 * - La reversión (`revokePdtpAccreditation`) pasa la ejecución a `draft`
 *   y anota el motivo en `sourceMetadataJson` para trazabilidad.
 * - Una actividad excluida de la faena (R4) no se acredita: se retorna
 *   vacío sin error.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteExclusions,
  pdtpExecutions,
  pdtpPrograms,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

// ── Tipos públicos ────────────────────────────────────────────────────────────

/** Fuentes operacionales que pueden auto-acreditar actividades PDTP. */
export type PdtpAccreditationSourceType =
  | "inspeccion"
  | "capacitacion"
  | "epp"
  | "cphs"
  | "emergencia"
  | "campana"
  | "incident"
  /** El propio ciclo de aprobación del programa (N°1: "Aprobar el Programa"). */
  | "aprobacion_programa"

export type AccreditationResult = {
  /** Ejecuciones creadas o actualizadas (una por actividad acreditada). */
  accredited: Array<{ activityId: string; activityN: number; executionId: string; created: boolean }>
  /** Actividades omitidas porque están excluidas de la faena (R4). */
  skippedExcluded: number[]
  /** Actividades no encontradas en el programa activo (no error fatal, se registra en log). */
  skippedNotFound: number[]
  /**
   * El evento ocurrió en un año que el programa resuelto no cubre. No se
   * acredita nada: una ejecución sellada con el año del programa mentiría
   * sobre cuándo ocurrió el trabajo, y sellada con el año real sería invisible
   * para `loadProgramScheduleAndExecutions`, que filtra por `program.year`.
   */
  skippedOutOfPeriod?: { occurredYear: number; programYear: number; activityNumbers: number[] }
}

export type AccreditationInput = {
  sourceType: PdtpAccreditationSourceType
  /** ID del objeto real (run, session, delivery, meeting, drill…). */
  sourceId: string
  worksiteId: string
  /** Números de actividad PDTP a acreditar (campo `n`, no el id). */
  activityNumbers: number[]
  /** Si se omite, busca el programa activo para la faena (primer `active`). */
  programId?: string
  /** ISO timestamp del evento real — determina el mes/semana PDTP. */
  occurredAt: string
  /** Cantidad ejecutada (default 1). */
  executedQuantity?: number
  /** URL o texto breve de evidencia para la ejecución. */
  evidenceRef?: string
  /** Metadatos adicionales que se persisten en sourceMetadataJson. */
  metadata?: Record<string, unknown>
}

// ── Helpers internos ──────────────────────────────────────────────────────────

const CHILE_MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  month: "numeric",
  day: "numeric",
})

const CHILE_YEAR_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
})

function periodSlot(occurredAt: string): { month: number; week: number } {
  const at = new Date(occurredAt)
  const parts = Object.fromEntries(
    CHILE_MONTH_DAY_FORMAT
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  )
  return { month: parts.month!, week: Math.min(4, Math.ceil(parts.day! / 7)) }
}

function yearOfOccurrence(occurredAt: string): number {
  const at = new Date(occurredAt)
  const parts = Object.fromEntries(
    CHILE_YEAR_FORMAT
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  )
  return parts.year!
}

/** Construye la clave idempotente para una acreditación por evento. */
function accreditationKey(
  activityId: string,
  worksiteId: string,
  sourceType: string,
  sourceId: string,
): string {
  return `pdtp-accredit:${activityId}:${worksiteId}:${sourceType}:${sourceId}`
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Acredita automáticamente las actividades PDTP indicadas a partir de un
 * evento operacional real. Es idempotente: si ya existe una ejecución con
 * la misma clave, la retorna sin crear una nueva (a menos que esté en estado
 * `draft` o `rejected`, en cuyo caso la actualiza a `submitted`).
 *
 * Una ejecución `approved` nunca se modifica aquí.
 */
export async function accreditPdtpFromEvent(
  input: AccreditationInput,
): Promise<AccreditationResult> {
  if (input.activityNumbers.length === 0) {
    return { accredited: [], skippedExcluded: [], skippedNotFound: [] }
  }

  const occurredYear = yearOfOccurrence(input.occurredAt)
  const slot = periodSlot(input.occurredAt)
  const executedQuantity = input.executedQuantity ?? 1
  const now = new Date().toISOString()

  // Un `evidenceRef` que sea un artefacto real (ruta de storage o URL) cuenta
  // como evidencia entregada; un rótulo descriptivo ("Inspección completada: …")
  // no debe inflar la métrica de evidencia → queda "not_required".
  const isStorageRef = input.evidenceRef?.startsWith("storage/") ?? false
  const isRealEvidence = isStorageRef || /^https?:\/\//.test(input.evidenceRef ?? "")

  // 1. Resolver el programa activo de la faena
  let program: typeof pdtpPrograms.$inferSelect | null = null
  if (input.programId) {
    const [found] = await db
      .select()
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, input.programId))
      .limit(1)
    program = found ?? null
  } else {
    // Buscar el programa activo cuyo año coincida con el año del evento.
    // Si no hay uno del mismo año, usar el más reciente activo.
    const programs = await db
      .select()
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.status, "active"))
      .orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
      .limit(10)
    program = programs.find((p) => p.year === occurredYear) ?? programs[0] ?? null
  }

  if (!program) {
    throw new Error(
      `[accreditPdtpFromEvent] Sin programa PDTP activo para acreditar el evento ${input.sourceType}:${input.sourceId} en faena ${input.worksiteId}.`,
    )
  }

  if (program.status !== "active") {
    throw new Error(
      `[accreditPdtpFromEvent] El programa ${program.id} no está activo (estado: ${program.status}).`,
    )
  }

  // El programa resuelto tiene que cubrir el año en que ocurrió el evento. La
  // selección de arriba cae al programa activo más reciente cuando no hay uno
  // del año del evento, y antes eso acreditaba igual sellando la fila con
  // `program.year`: una capacitación de enero 2027 quedaba archivada como
  // ejecución de 2026, mes 1, indistinguible de una real de ese mes.
  // Preferimos no acreditar y dejar rastro: el trabajo ocurrió, pero no hay
  // plan vigente que lo contemple.
  if (program.year !== occurredYear) {
    logger.warn(
      {
        sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId,
        programId: program.id, programYear: program.year, occurredYear,
      },
      "[accreditPdtpFromEvent] El evento ocurrió fuera del año del programa activo; no se acredita.",
    )
    return {
      accredited: [],
      skippedExcluded: [],
      skippedNotFound: [],
      skippedOutOfPeriod: { occurredYear, programYear: program.year, activityNumbers: input.activityNumbers },
    }
  }

  // 2. Resolver las actividades del programa por número
  const activityRows = await db
    .select({ id: pdtpActivities.id, n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(
      and(
        eq(pdtpActivities.programId, program.id),
        inArray(pdtpActivities.n, input.activityNumbers),
      ),
    )

  const foundNs = new Set(activityRows.map((a) => a.n))
  const skippedNotFound = input.activityNumbers.filter((n) => !foundNs.has(n))
  if (skippedNotFound.length > 0) {
    logger.warn(
      { programId: program.id, skippedNotFound, sourceType: input.sourceType, sourceId: input.sourceId },
      "[accreditPdtpFromEvent] Actividades no encontradas en el programa; se omiten.",
    )
  }

  if (activityRows.length === 0) {
    return { accredited: [], skippedExcluded: [], skippedNotFound }
  }

  // 3. Filtrar actividades excluidas de esta faena (R4)
  const exclusionRows = await db
    .select({ activityId: pdtpActivityWorksiteExclusions.activityId })
    .from(pdtpActivityWorksiteExclusions)
    .where(
      and(
        inArray(
          pdtpActivityWorksiteExclusions.activityId,
          activityRows.map((a) => a.id),
        ),
        eq(pdtpActivityWorksiteExclusions.worksiteId, input.worksiteId),
      ),
    )
  const excludedIds = new Set(exclusionRows.map((e) => e.activityId))
  const skippedExcluded = activityRows.filter((a) => excludedIds.has(a.id)).map((a) => a.n)
  const eligibleActivities = activityRows.filter((a) => !excludedIds.has(a.id))

  if (eligibleActivities.length === 0) {
    return { accredited: [], skippedExcluded, skippedNotFound }
  }

  // 4. Upsert idempotente para cada actividad elegible
  const accredited: AccreditationResult["accredited"] = []

  for (const activity of eligibleActivities) {
    const idempotencyKey = accreditationKey(
      activity.id,
      input.worksiteId,
      input.sourceType,
      input.sourceId,
    )

    // Verificar si ya existe
    const [existing] = await db
      .select({ id: pdtpExecutions.id, status: pdtpExecutions.status })
      .from(pdtpExecutions)
      .where(eq(pdtpExecutions.idempotencyKey, idempotencyKey))
      .limit(1)

    if (existing?.status === "approved") {
      // Respetamos la aprobación manual: retornamos como ya procesado
      accredited.push({ activityId: activity.id, activityN: activity.n, executionId: existing.id, created: false })
      continue
    }

    const executionId = existing?.id ?? `pdtp-accredit-${nanoid()}`
    const sourceMetadata: Record<string, unknown> = {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: input.occurredAt,
      ...(input.metadata ?? {}),
    }

    // Celda del período (`pdtp_executions_activity_scope_period_unique`). Si ya
    // hay una ejecución ahí y no es la nuestra, insertar levanta un 23505 que
    // `safeAccredit` se traga: la segunda inspección de la semana —o la primera,
    // si ya había una carga manual en esa celda— desaparecía sin rastro.
    const [periodRow] = existing ? [] : await db
      .select({
        id: pdtpExecutions.id,
        status: pdtpExecutions.status,
        executedQuantity: pdtpExecutions.executedQuantity,
        sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
      })
      .from(pdtpExecutions)
      .where(and(
        eq(pdtpExecutions.activityId, activity.id),
        eq(pdtpExecutions.worksiteId, input.worksiteId),
        eq(pdtpExecutions.year, occurredYear),
        eq(pdtpExecutions.month, slot.month),
        eq(pdtpExecutions.week, slot.week),
        isNull(pdtpExecutions.obligationId),
      ))
      .limit(1)

    if (periodRow) {
      // Sumamos el evento a la celda en vez de perderlo. La lista de claves ya
      // contabilizadas mantiene la idempotencia: reintentar el mismo evento no
      // vuelve a sumar. Una ejecución aprobada no se toca.
      const meta = (periodRow.sourceMetadataJson ?? {}) as Record<string, unknown>
      const contributed = Array.isArray(meta.accreditedKeys) ? (meta.accreditedKeys as string[]) : []
      if (contributed.includes(idempotencyKey)) {
        accredited.push({ activityId: activity.id, activityN: activity.n, executionId: periodRow.id, created: false })
      } else if (periodRow.status === "approved") {
        logger.warn(
          { executionId: periodRow.id, sourceType: input.sourceType, sourceId: input.sourceId, activityN: activity.n },
          "[accreditPdtpFromEvent] La celda del período ya tiene una ejecución aprobada; no se suma el evento.",
        )
      } else {
        await db.update(pdtpExecutions).set({
          executedQuantity: periodRow.executedQuantity + executedQuantity,
          sourceMetadataJson: { ...meta, accreditedKeys: [...contributed, idempotencyKey] },
          updatedAt: now,
        }).where(and(
          eq(pdtpExecutions.id, periodRow.id),
          sql`${pdtpExecutions.status} <> 'approved'`,
        ))
        accredited.push({ activityId: activity.id, activityN: activity.n, executionId: periodRow.id, created: false })
      }
      continue
    }

    if (existing) {
      // Actualizar ejecución existente (estaba en draft/rejected/submitted)
      await db
        .update(pdtpExecutions)
        .set({
          executedQuantity,
          status: "submitted",
          evidenceText: isStorageRef ? null : (input.evidenceRef ?? null),
          evidenceUrl: isStorageRef ? input.evidenceRef : null,
          evidenceStatus: isRealEvidence ? "provided" : "not_required",
          sourceMetadataJson: sourceMetadata,
          updatedAt: now,
        })
        .where(
          and(
            eq(pdtpExecutions.id, existing.id),
            // Nunca degradar una aprobación (doble-check en escritura)
            sql`${pdtpExecutions.status} <> 'approved'`,
          ),
        )
      accredited.push({ activityId: activity.id, activityN: activity.n, executionId: existing.id, created: false })
    } else {
      // Crear nueva ejecución de integración
      const [created] = await db
        .insert(pdtpExecutions)
        .values({
          id: executionId,
          activityId: activity.id,
          worksiteId: input.worksiteId,
          // Igual a `program.year` por el guard de arriba; se escribe el año de
          // ocurrencia para que la invariante quede explícita en el código.
          year: occurredYear,
          month: slot.month,
          week: slot.week,
          executedQuantity,
          status: "submitted",
          evidenceText: isStorageRef ? null : (input.evidenceRef ?? null),
          evidenceUrl: isStorageRef ? input.evidenceRef : null,
          evidencePhotos: [],
          origin: "integration",
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey,
          sourceMetadataJson: { ...sourceMetadata, accreditedKeys: [idempotencyKey] },
          evidenceStatus: isRealEvidence ? "provided" : "not_required",
          createdAt: now,
          updatedAt: now,
        })
        // Sin `target`: cubre tanto la clave idempotente como el índice único de
        // período, que es el que puede chocar en una carrera con otra fuente.
        .onConflictDoNothing()
        .returning({ id: pdtpExecutions.id })

      if (created) {
        accredited.push({ activityId: activity.id, activityN: activity.n, executionId: created.id, created: true })
      } else {
        // Conflicto de unicidad: alguien más insertó mientras tanto — leemos.
        // Puede haber chocado por la clave idempotente (mismo evento en paralelo)
        // o por el índice de período (otra fuente ganó la celda entre nuestro
        // SELECT y este INSERT); hay que mirar las dos, o el evento se pierde.
        const [concurrent] = await db
          .select({ id: pdtpExecutions.id, status: pdtpExecutions.status })
          .from(pdtpExecutions)
          .where(eq(pdtpExecutions.idempotencyKey, idempotencyKey))
          .limit(1)
        if (concurrent) {
          accredited.push({ activityId: activity.id, activityN: activity.n, executionId: concurrent.id, created: false })
        } else {
          const [concurrentPeriod] = await db
            .select({ id: pdtpExecutions.id })
            .from(pdtpExecutions)
            .where(and(
              eq(pdtpExecutions.activityId, activity.id),
              eq(pdtpExecutions.worksiteId, input.worksiteId),
              eq(pdtpExecutions.year, occurredYear),
              eq(pdtpExecutions.month, slot.month),
              eq(pdtpExecutions.week, slot.week),
              isNull(pdtpExecutions.obligationId),
            ))
            .limit(1)
          if (concurrentPeriod) {
            logger.warn(
              { executionId: concurrentPeriod.id, sourceType: input.sourceType, sourceId: input.sourceId },
              "[accreditPdtpFromEvent] Otra fuente tomó la celda del período en paralelo; el evento no se sumó.",
            )
          }
        }
      }
    }
  }

  logger.info(
    {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      worksiteId: input.worksiteId,
      programId: program.id,
      accreditedCount: accredited.length,
      skippedExcluded: skippedExcluded.length,
      skippedNotFound: skippedNotFound.length,
    },
    "[accreditPdtpFromEvent] Acreditación completada.",
  )

  return { accredited, skippedExcluded, skippedNotFound }
}

// ── Reversión ─────────────────────────────────────────────────────────────────

export type RevocationResult = {
  revoked: Array<{ activityId: string; executionId: string }>
  skippedApproved: Array<{ activityId: string; executionId: string }>
}

/**
 * Revierte las ejecuciones auto-acreditadas para un evento dado.
 * Las ejecuciones `approved` no se tocan (se reportan en `skippedApproved`).
 * Las demás pasan a `draft` con nota de reversión en `sourceMetadataJson`.
 *
 * Llamar desde el flujo de cancelación del evento original (inspección
 * cancelada, sesión cancelada, etc.).
 */
export async function revokePdtpAccreditation(input: {
  sourceType: PdtpAccreditationSourceType
  sourceId: string
  worksiteId: string
  programId?: string
  revokedBy?: string
  reason?: string
}): Promise<RevocationResult> {
  const keyPrefix = `pdtp-accredit:%:${input.worksiteId}:${input.sourceType}:${input.sourceId}`

  // Buscar todas las ejecuciones que coincidan con este evento (sin conocer activityId)
  const executions = await db
    .select({
      id: pdtpExecutions.id,
      activityId: pdtpExecutions.activityId,
      status: pdtpExecutions.status,
      sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
    })
    .from(pdtpExecutions)
    .where(
      and(
        eq(pdtpExecutions.sourceType, input.sourceType),
        eq(pdtpExecutions.sourceId, input.sourceId),
        eq(pdtpExecutions.worksiteId, input.worksiteId),
        eq(pdtpExecutions.origin, "integration"),
      ),
    )

  const matching = executions  // WHERE ya filtra por source; no-op in-memory

  const revoked: RevocationResult["revoked"] = []
  const skippedApproved: RevocationResult["skippedApproved"] = []
  const now = new Date().toISOString()

  for (const execution of matching) {
    if (execution.status === "approved") {
      skippedApproved.push({ activityId: execution.activityId, executionId: execution.id })
      continue
    }

    const prevMetadata = (execution.sourceMetadataJson ?? {}) as Record<string, unknown>
    await db
      .update(pdtpExecutions)
      .set({
        status: "draft",
        sourceMetadataJson: {
          ...prevMetadata,
          revokedAt: now,
          revokedBy: input.revokedBy ?? null,
          revocationReason: input.reason ?? "Evento fuente cancelado o anulado.",
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(pdtpExecutions.id, execution.id),
          sql`${pdtpExecutions.status} <> 'approved'`,
        ),
      )
    revoked.push({ activityId: execution.activityId, executionId: execution.id })
  }

  void keyPrefix // suppress unused warning (kept for documentation clarity)

  logger.info(
    {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      worksiteId: input.worksiteId,
      revokedCount: revoked.length,
      skippedApproved: skippedApproved.length,
    },
    "[revokePdtpAccreditation] Reversión completada.",
  )

  return { revoked, skippedApproved }
}
