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

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteExclusions,
  pdtpExecutions,
  pdtpProgramWorksites,
  pdtpPrograms,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

type AccreditationClient = DB | Tx

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
  /**
   * Higiene industrial: la medición cuantitativa de exposición (N°45) y el
   * pronunciamiento sobre un protocolo MINSAL (N°46-49).
   */
  | "higiene"
  /** Vigilancia médica ocupacional: control efectivamente realizado (N°50). */
  | "vigilancia"
  /**
   * Acta de trabajador nuevo cerrada (`sst_evaluations`): habilitación de una
   * persona. Cierra la N°15, 18, 23, 52 y 63 según sus ítems conformes.
   */
  | "evaluacion_sst"
  /**
   * Documentación SST: una versión publicada (N°43) o los acuses de recibo de
   * una difusión (N°36). El número lo declara el tipo de documento.
   */
  | "documento"
  /** MIPER: la publicación de una revisión de la matriz de la faena (N°35). */
  | "miper"
  /** El propio ciclo de aprobación del programa (N°1: "Aprobar el Programa"). */
  | "aprobacion_programa"
  /** Indicadores de faena: cierre del período mensual (N°7). */
  | "indicadores"
  /** Alcotest (G14, DO-48): un control (N°30/N°31) o un envío mensual de registros (N°32). */
  | "alcotest"
  /**
   * CGRD del DS 44 (G15): constitución del comité (N°79), publicación de la
   * matriz GRD (N°80) o acta de reunión cerrada (N°81).
   */
  | "cgrd"

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
  /**
   * El evento fuente ya constituye validación suficiente. Se usa sólo desde
   * conectores cuyo cierre es el hecho que el programa busca medir, como una
   * inspección declarada ejecutada.
   */
  autoApproveByUserId?: string
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

// ── Resolución compartida de programa y actividades ─────────────────────────

/**
 * No hay un programa PDTP activo que cubra este evento: o no existe ninguno, o
 * el que existe sigue en borrador.
 *
 * Es una clase propia porque **no es lo mismo que una inconsistencia**. Un
 * número de actividad inexistente o una faena fuera del programa son errores
 * que hay que corregir; "el programa todavía no se activa" es el estado normal
 * de la plataforma hasta que Prevención lo firma, y no puede impedir que el
 * trabajo de terreno se registre.
 */
export class PdtpNoActiveProgramError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PdtpNoActiveProgramError"
  }
}

type ResolvedProgramEvent =
  | { ok: true; program: typeof pdtpPrograms.$inferSelect; occurredYear: number; slot: { month: number; week: number } }
  // El programa existe y está activo, pero no cubre el año del evento. Se
  // conserva `programYear` para que el caller (accreditPdtpFromEvent) pueda
  // seguir reportando `skippedOutOfPeriod` con el dato real, no un relleno.
  | { ok: false; occurredYear: number; programYear: number }

/**
 * Resuelve el programa activo aplicable a un evento (faena + fecha), con las
 * mismas reglas que usaba `accreditPdtpFromEvent`: activo, con la faena
 * dentro de su membresía explícita (si declara alguna), y del año del evento.
 * Compartida con `resolvePdtpActivityIdsForNumbers`, que además la usan las
 * obligaciones a demanda (Fase 3) para resolver a qué actividad apuntan.
 *
 * Lanza para "sin programa", "programa no activo" o "faena fuera del
 * programa" — son errores de configuración, no un caso normal. "Fuera del
 * año del programa" no lanza: devuelve `{ ok: false }` y deja rastro en el
 * log, porque ahí el trabajo sí ocurrió y no hay plan vigente que lo
 * contemple.
 *
 * Los dos primeros lanzan `PdtpNoActiveProgramError` y no un `Error` pelado,
 * para que un caller transaccional pueda distinguir "todavía no hay programa"
 * —que es el estado normal de todo el año antes de activarlo— de una
 * inconsistencia real de configuración. Ver el comentario de
 * `onInspectionCompleted`.
 */
async function resolvePdtpActiveProgramForEvent(
  input: { worksiteId: string; occurredAt: string; programId?: string; sourceType: string; sourceId: string },
  client: AccreditationClient,
): Promise<ResolvedProgramEvent> {
  const occurredYear = yearOfOccurrence(input.occurredAt)
  const slot = periodSlot(input.occurredAt)

  // 1. Resolver el programa activo de la faena
  let program: typeof pdtpPrograms.$inferSelect | null = null
  if (input.programId) {
    const [found] = await client
      .select()
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, input.programId))
      .limit(1)
    program = found ?? null
  } else {
    // Buscar el programa activo cuyo año coincida con el año del evento.
    // Si no hay uno del mismo año, usar el más reciente activo.
    const programs = await client
      .select()
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.status, "active"))
      .orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version))
    const memberships = programs.length === 0 ? [] : await client
      .select({ programId: pdtpProgramWorksites.programId, worksiteId: pdtpProgramWorksites.worksiteId })
      .from(pdtpProgramWorksites)
      .where(and(
        inArray(pdtpProgramWorksites.programId, programs.map((candidate) => candidate.id)),
        eq(pdtpProgramWorksites.isActive, true),
      ))
    const membersByProgram = new Map<string, string[]>()
    for (const member of memberships) {
      const current = membersByProgram.get(member.programId) ?? []
      current.push(member.worksiteId)
      membersByProgram.set(member.programId, current)
    }
    const applicable = programs.filter((candidate) => {
      const members = membersByProgram.get(candidate.id) ?? []
      return members.length === 0 || members.includes(input.worksiteId)
    })
    program = applicable.find((p) => p.year === occurredYear) ?? applicable[0] ?? null
  }

  if (!program) {
    throw new PdtpNoActiveProgramError(
      `Sin programa PDTP activo para el evento ${input.sourceType}:${input.sourceId} en faena ${input.worksiteId}.`,
    )
  }

  if (program.status !== "active") {
    throw new PdtpNoActiveProgramError(`El programa ${program.id} no está activo (estado: ${program.status}).`)
  }

  const explicitMemberships = await client
    .select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(
      eq(pdtpProgramWorksites.programId, program.id),
      eq(pdtpProgramWorksites.isActive, true),
    ))
  if (explicitMemberships.length > 0 && !explicitMemberships.some((member) => member.worksiteId === input.worksiteId)) {
    throw new Error(`La faena ${input.worksiteId} no pertenece al programa ${program.id}.`)
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
      "[resolvePdtpActiveProgramForEvent] El evento ocurrió fuera del año del programa activo.",
    )
    return { ok: false, occurredYear, programYear: program.year }
  }

  return { ok: true, program, occurredYear, slot }
}

/**
 * Resuelve el programa activo y mapea números de actividad a sus ids, para
 * quien necesite el destino sin pasar por `accreditPdtpFromEvent` — hoy,
 * `createPdtpObligation` desde el conector de incidentes (Fase 3).
 *
 * Devuelve `null` si el evento cae fuera del año del programa (mismo criterio
 * tolerante que el motor); lanza para el resto de las condiciones de
 * configuración, porque ahí sí es un error, no un caso normal.
 */
export async function resolvePdtpActivityIdsForNumbers(
  input: { worksiteId: string; occurredAt: string; activityNumbers: number[]; programId?: string; sourceType: string; sourceId: string },
  client: AccreditationClient = db,
): Promise<{ programId: string; activityIdByN: Map<number, string>; skippedNotFound: number[] } | null> {
  const resolved = await resolvePdtpActiveProgramForEvent(input, client)
  if (!resolved.ok) return null

  const activityRows = await client
    .select({ id: pdtpActivities.id, n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(and(
      eq(pdtpActivities.programId, resolved.program.id),
      inArray(pdtpActivities.n, input.activityNumbers),
    ))
  const activityIdByN = new Map(activityRows.map((a) => [a.n, a.id]))
  const skippedNotFound = input.activityNumbers.filter((n) => !activityIdByN.has(n))
  return { programId: resolved.program.id, activityIdByN, skippedNotFound }
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Acredita automáticamente las actividades PDTP indicadas a partir de un
 * evento operacional real. Es idempotente: si ya existe una ejecución con
 * la misma clave, la retorna sin crear una nueva (a menos que esté en estado
 * `draft` o `rejected`, en cuyo caso la actualiza a `submitted`, o a
 * `approved` cuando una inspección ejecutada constituye la validación).
 *
 * Una aprobación manual nunca se modifica aquí. Cada evento de integración
 * conserva una fila propia, incluso cuando comparte período con otro evento.
 */
export async function accreditPdtpFromEvent(
  input: AccreditationInput,
  client: AccreditationClient = db,
): Promise<AccreditationResult> {
  if (input.autoApproveByUserId && input.sourceType !== "inspeccion") {
    throw new Error("Sólo las inspecciones pueden aprobar automáticamente su cumplimiento al ejecutarse.")
  }
  if (input.activityNumbers.length === 0) {
    return { accredited: [], skippedExcluded: [], skippedNotFound: [] }
  }

  const executedQuantity = input.executedQuantity ?? 1
  const now = new Date().toISOString()

  // Un `evidenceRef` que sea un artefacto real (ruta de storage o URL) cuenta
  // como evidencia entregada; un rótulo descriptivo ("Inspección completada: …")
  // no lo es.
  const isStorageRef = input.evidenceRef?.startsWith("storage/") ?? false
  const isRealEvidence = isStorageRef || /^https?:\/\//.test(input.evidenceRef ?? "")

  /*
   * PDTP-001 (auditoría 2026-09-14), patrón P4: sin artefacto real, la ejecución
   * quedaba siempre en `not_required` —«esta actividad no pedía evidencia»—, que
   * es una afirmación distinta y más fuerte que la verdadera: «el conector no
   * trajo documento». El enum ya tenía `pending` y ningún camino automático lo
   * escribía nunca.
   *
   * La diferencia importa donde se mide: una actividad cuyo enunciado exige
   * documentar —la N°62, «registrar la entrega de los EPP y **dejar documentada**
   * su entrega» (`ENT-001`)— quedaba fuera del indicador de evidencia faltante,
   * así que quien aprueba no veía nada que le llamara la atención.
   *
   * Quien sabe si hay que documentar es la actividad, no el conector: su
   * `evidenceRequirement` es justamente esa declaración.
   */
  const evidenceStatusFor = (evidenceRequirement: string | null) => {
    if (isRealEvidence) return "provided" as const
    return (evidenceRequirement ?? "").trim().length > 0 ? "pending" as const : "not_required" as const
  }

  const resolved = await resolvePdtpActiveProgramForEvent(
    { worksiteId: input.worksiteId, occurredAt: input.occurredAt, programId: input.programId, sourceType: input.sourceType, sourceId: input.sourceId },
    client,
  )
  if (!resolved.ok) {
    return {
      accredited: [],
      skippedExcluded: [],
      skippedNotFound: [],
      skippedOutOfPeriod: { occurredYear: resolved.occurredYear, programYear: resolved.programYear, activityNumbers: input.activityNumbers },
    }
  }
  const { program, occurredYear, slot } = resolved

  // 2. Resolver las actividades del programa por número
  const activityRows = await client
    // PDTP-001: se trae `evidenceRequirement` porque es la actividad, y no el
    // conector, la que declara si hay que documentar.
    .select({ id: pdtpActivities.id, n: pdtpActivities.n, evidenceRequirement: pdtpActivities.evidenceRequirement })
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
  const exclusionRows = await client
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
    const [existing] = await client
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
      ...(input.autoApproveByUserId ? {
        approvalMode: "automatic_source_event",
        automaticApprovedByUserId: input.autoApproveByUserId,
        automaticApprovalActors: { [idempotencyKey]: input.autoApproveByUserId },
      } : {}),
      ...(input.metadata ?? {}),
    }

    if (existing) {
      // Actualizar ejecución existente (estaba en draft/rejected/submitted)
      const [updated] = await client
        .update(pdtpExecutions)
        .set({
          executedQuantity,
          status: input.autoApproveByUserId ? "approved" : "submitted",
          approvedByUserId: input.autoApproveByUserId ?? null,
          approvedAt: input.autoApproveByUserId ? now : null,
          evidenceText: isStorageRef ? null : (input.evidenceRef ?? null),
          evidenceUrl: isStorageRef ? input.evidenceRef : null,
          evidenceStatus: evidenceStatusFor(activity.evidenceRequirement),
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
        .returning({ id: pdtpExecutions.id })
      if (updated) accredited.push({ activityId: activity.id, activityN: activity.n, executionId: existing.id, created: false })
    } else {
      // Crear nueva ejecución de integración
      const [created] = await client
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
          status: input.autoApproveByUserId ? "approved" : "submitted",
          approvedByUserId: input.autoApproveByUserId ?? null,
          approvedAt: input.autoApproveByUserId ? now : null,
          evidenceText: isStorageRef ? null : (input.evidenceRef ?? null),
          evidenceUrl: isStorageRef ? input.evidenceRef : null,
          evidencePhotos: [],
          origin: "integration",
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey,
          sourceMetadataJson: sourceMetadata,
          evidenceStatus: evidenceStatusFor(activity.evidenceRequirement),
          createdAt: now,
          updatedAt: now,
        })
        // La única colisión posible entre integraciones es la clave idempotente:
        // cada evento tiene su propia fila y puede coexistir con cargas manuales.
        .onConflictDoNothing()
        .returning({ id: pdtpExecutions.id })

      if (created) {
        accredited.push({ activityId: activity.id, activityN: activity.n, executionId: created.id, created: true })
      } else {
        // El mismo evento entró en paralelo: la clave única decide y releemos.
        const [concurrent] = await client
          .select({ id: pdtpExecutions.id, status: pdtpExecutions.status })
          .from(pdtpExecutions)
          .where(eq(pdtpExecutions.idempotencyKey, idempotencyKey))
          .limit(1)
        if (!concurrent) throw new Error("La acreditación colisionó sin una ejecución idempotente recuperable.")
        accredited.push({ activityId: activity.id, activityN: activity.n, executionId: concurrent.id, created: false })
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
 * Las aprobaciones manuales no se tocan (se reportan en `skippedApproved`).
 * Las demás, incluidas las aprobadas automáticamente por el propio evento,
 * pasan a `draft` con nota de reversión en `sourceMetadataJson`.
 *
 * Llamar desde el flujo de cancelación del evento original (inspección
 * cancelada, sesión cancelada, etc.).
 */
export type RevocationInput = {
  sourceType: PdtpAccreditationSourceType
  sourceId: string
  worksiteId: string
  programId?: string
  revokedBy?: string
  reason?: string
}

/** Variante transaccional para callers que ya poseen la transacción fuente. */
export async function revokePdtpAccreditationWithClient(
  input: RevocationInput,
  client: Tx,
): Promise<RevocationResult> {
  // Las filas nuevas son una por evento. `accreditedKeys` se conserva sólo para
  // poder revertir correctamente filas históricas que agregaban varias
  // inspecciones antes de separar las integraciones del índice de período.
  const executions = await client
    .select({
      id: pdtpExecutions.id,
      activityId: pdtpExecutions.activityId,
      status: pdtpExecutions.status,
      executedQuantity: pdtpExecutions.executedQuantity,
      approvedByUserId: pdtpExecutions.approvedByUserId,
      idempotencyKey: pdtpExecutions.idempotencyKey,
      sourceType: pdtpExecutions.sourceType,
      sourceId: pdtpExecutions.sourceId,
      sourceMetadataJson: pdtpExecutions.sourceMetadataJson,
    })
    .from(pdtpExecutions)
    .where(
      and(
        eq(pdtpExecutions.worksiteId, input.worksiteId),
        eq(pdtpExecutions.origin, "integration"),
      ),
    )
    .orderBy(pdtpExecutions.id)
    .for("update")

  const matching = executions.filter((execution) => {
    const metadata = (execution.sourceMetadataJson ?? {}) as Record<string, unknown>
    const keys = Array.isArray(metadata.accreditedKeys) ? metadata.accreditedKeys as string[] : []
    const targetKey = accreditationKey(execution.activityId, input.worksiteId, input.sourceType, input.sourceId)
    return (execution.sourceType === input.sourceType && execution.sourceId === input.sourceId)
      || keys.includes(targetKey)
  })

  const revoked: RevocationResult["revoked"] = []
  const skippedApproved: RevocationResult["skippedApproved"] = []
  const now = new Date().toISOString()

  for (const execution of matching) {
    const prevMetadata = (execution.sourceMetadataJson ?? {}) as Record<string, unknown>
    const contributed = Array.isArray(prevMetadata.accreditedKeys) ? prevMetadata.accreditedKeys as string[] : []
    const targetKey = accreditationKey(execution.activityId, input.worksiteId, input.sourceType, input.sourceId)
    const automaticallyApproved = execution.status === "approved"
      && prevMetadata.approvalMode === "automatic_source_event"
      && ((prevMetadata.sourceType === input.sourceType && prevMetadata.sourceId === input.sourceId)
        || contributed.includes(targetKey))
    if (execution.status === "approved" && !automaticallyApproved) {
      skippedApproved.push({ activityId: execution.activityId, executionId: execution.id })
      continue
    }

    const remainingKeys = contributed.filter((key) => key !== targetKey)
    if (automaticallyApproved && contributed.includes(targetKey) && remainingKeys.length > 0) {
      const actors = prevMetadata.automaticApprovalActors && typeof prevMetadata.automaticApprovalActors === "object"
        ? prevMetadata.automaticApprovalActors as Record<string, string>
        : {}
      const remainingActors = Object.fromEntries(remainingKeys.flatMap((key) => actors[key] ? [[key, actors[key]]] : []))
      const nextPrimaryKey = execution.idempotencyKey === targetKey ? remainingKeys[0]! : execution.idempotencyKey
      const sourcePrefix = `pdtp-accredit:${execution.activityId}:${input.worksiteId}:${input.sourceType}:`
      const nextSourceId = execution.sourceId === input.sourceId && nextPrimaryKey?.startsWith(sourcePrefix)
        ? nextPrimaryKey.slice(sourcePrefix.length)
        : execution.sourceId
      const nextApprover = remainingActors[nextPrimaryKey ?? ""] ?? Object.values(remainingActors)[0] ?? execution.approvedByUserId
      const [updated] = await client.update(pdtpExecutions).set({
        executedQuantity: Math.max(0, execution.executedQuantity - 1),
        approvedByUserId: nextApprover,
        idempotencyKey: nextPrimaryKey,
        sourceId: nextSourceId,
        sourceMetadataJson: {
          ...prevMetadata,
          sourceId: nextSourceId,
          accreditedKeys: remainingKeys,
          automaticApprovalActors: remainingActors,
          revokedAt: now,
          revokedBy: input.revokedBy ?? null,
          revocationReason: input.reason ?? "Evento fuente cancelado o anulado.",
        },
        updatedAt: now,
      }).where(and(
        eq(pdtpExecutions.id, execution.id),
        eq(pdtpExecutions.status, "approved"),
      )).returning({ id: pdtpExecutions.id })
      if (updated) revoked.push({ activityId: execution.activityId, executionId: execution.id })
      continue
    }

    const [updated] = await client
      .update(pdtpExecutions)
      .set({
        status: "draft",
        approvedByUserId: null,
        approvedAt: null,
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
          eq(pdtpExecutions.status, execution.status),
        ),
      )
      .returning({ id: pdtpExecutions.id })
    if (updated) revoked.push({ activityId: execution.activityId, executionId: execution.id })
  }

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

export async function revokePdtpAccreditation(input: RevocationInput): Promise<RevocationResult> {
  return db.transaction((tx) => revokePdtpAccreditationWithClient(input, tx))
}
