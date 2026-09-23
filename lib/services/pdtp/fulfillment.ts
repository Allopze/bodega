/**
 * lib/services/pdtp/fulfillment.ts
 *
 * Plataforma de cumplimiento (Fase 2 del plan de código del PDTP,
 * 2026-09-02). Dos problemas que el motor de acreditación por sí solo no
 * resuelve:
 *
 * 1. **Pérdida silenciosa.** `accreditPdtpFromEvent` lanza si el programa no
 *    está activo, si la faena no pertenece al programa o si el evento cae
 *    fuera de su año — y cada conector (`pdtp-accreditation-connectors.ts`,
 *    `hygiene-accreditation-connector.ts`, `incident-accreditation-
 *    connector.ts`, `worker-onboarding-connector.ts`) se lo traga con
 *    `logger.error` y sigue. Mientras el programa está en `draft`, todo hecho
 *    operacional que ocurre desaparece sin dejar rastro recuperable.
 *    `recordPdtpFulfillmentEvent` es el reemplazo de ese `try/catch`: escribe
 *    primero un evento durable, intenta acreditar, y dEja el evento en
 *    `pending` o `error` en vez de perder el intento.
 *
 * 2. **Destino disperso.** El `CASE` que decide a dónde manda `/pendientes`
 *    una actividad vive incrustado en el SQL de
 *    `lib/services/operational-work-queue.ts`; antes producía un 404 real
 *    (`/prevencion/constancias` no existía). La ruta ya existe, pero
 *    `resolvePdtpFulfillmentTarget` sigue siendo
 *    el único lugar que debe decidir eso, para que `/pendientes`, el tablero y
 *    la planilla consuman la misma respuesta.
 *
 * No duplica el motor: `accreditPdtpFromEvent` y `revokePdtpAccreditation`
 * siguen siendo la única escritura en `pdtp_executions`. Esta capa es el
 * libro de intentos alrededor de esas dos funciones.
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutionConfigs,
  pdtpActivityExecutorAssignments,
  pdtpCatalogActivities,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpAccreditationBindings,
  pdtpFulfillmentEvents,
  pdtpFulfillmentEventTargets,
  pdtpScheduledInstances,
  pdtpResponsibleCatalog,
  permissions,
  pdtpProgramWorksites,
  pdtpPrograms,
  rolePermissions,
  roles,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import {
  accreditPdtpFromEvent,
  revokePdtpAccreditationWithClient,
  PdtpNoActiveProgramError,
  type AccreditationInput,
  type AccreditationResult,
  type RevocationInput,
} from "./accreditation"
import { engancheDestinationFor } from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"
import { PDTP_NO_EXECUTOR_ROLE_REASON } from "@/lib/prevention/pdtp"
import { describePdtpInstrumentGap, type PdtpCoverageInstrument } from "./instrument-gap"
import { loadPdtpInstrumentIndex, type PdtpInstrumentRecord } from "./instruments"
import { legacyPdtpActivityNumberForCatalogId } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import { getPdtpExecutionConnector } from "./connectors"
import { recordPdtpScheduledInstanceOutcome } from "./scheduled-execution"
import { todayInChile } from "@/lib/utils"

type QueryClient = DB | Tx

/**
 * Marca al comienzo de `pdtp_fulfillment_events.lastError` cuando la falla fue
 * `PdtpNoActiveProgramError`: "todavía no hay programa activo" (o el que hay
 * sigue en revisión), que es el estado normal entre la firma legal y la
 * activación, no una brecha de cableado. La columna sólo guarda
 * `err.message` — el `name` de la clase se pierde si no se conserva acá—, así
 * que este prefijo es la única señal estable que le queda a quien lea el libro
 * después: `countPdtpFulfillmentBacklog` la usa para no contarlos como error
 * bloqueante, en vez de adivinar por el texto en español (que puede cambiar).
 */
export const NO_ACTIVE_PROGRAM_LAST_ERROR_TAG = "[no-active-program]"

function formatFulfillmentLastError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof PdtpNoActiveProgramError) return `${NO_ACTIVE_PROGRAM_LAST_ERROR_TAG} ${message}`
  return message
}

function fulfillmentIdempotencyKey(sourceType: string, sourceId: string, eventType: "completed" | "revoked"): string {
  return `pdtp-fulfillment:${eventType}:${sourceType}:${sourceId}`
}

/**
 * La clave idempotente se reutiliza cuando una fuente se corrige. El reloj del
 * sistema puede devolver el mismo milisegundo para la corrección y la
 * revocación, así que el timestamp lógico debe avanzar siempre para que el
 * reconciliador pueda ordenar la última intención del origen.
 */
function nextEventTimestamp(previous?: string | null): string {
  const now = Date.now()
  const previousMs = previous ? Date.parse(previous) : Number.NaN
  return new Date(Math.max(now, Number.isFinite(previousMs) ? previousMs + 1 : now)).toISOString()
}

async function upsertPendingEvent(input: {
  sourceType: string
  sourceId: string
  eventType: "completed" | "revoked"
  worksiteId: string
  occurredAt: string
  quantity: number
  evidenceRef: string | null
  activityNumbers?: number[]
  catalogActivityIds?: string[]
  sourceVersion: string | null
  returnHref: string | null
  periodOverride: { year: number; month: number; week: number } | null
  plannedYear?: number | null
  autoApproveByUserId?: string | null
}, client: QueryClient = db) {
  const idempotencyKey = fulfillmentIdempotencyKey(input.sourceType, input.sourceId, input.eventType)

  const [existing] = await client.select().from(pdtpFulfillmentEvents)
    .where(eq(pdtpFulfillmentEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (existing) {
    const now = nextEventTimestamp(existing.updatedAt)
    await client.update(pdtpFulfillmentEvents)
      .set({
        // A source may be completed again after a reversible correction. The
        // durable event must become retryable again; retaining an old
        // `accredited`/`error` status here could make the new completion
        // invisible to reconciliation if the post-transaction attempt fails.
        status: "pending",
        programId: null,
        resultJson: {},
        lastError: null,
        reconciledAt: null,
        attempts: existing.attempts + 1,
        worksiteId: input.worksiteId,
        occurredAt: input.occurredAt,
        quantity: input.quantity,
        evidenceRef: input.evidenceRef,
        sourceVersion: input.sourceVersion,
        returnHref: input.returnHref,
        activityNumbers: input.activityNumbers ?? [],
        periodOverrideJson: input.periodOverride,
        plannedYear: input.plannedYear === undefined ? existing.plannedYear : input.plannedYear,
        autoApproveByUserId: input.autoApproveByUserId === undefined
          ? existing.autoApproveByUserId
          : input.autoApproveByUserId,
        updatedAt: now,
      })
      .where(eq(pdtpFulfillmentEvents.id, existing.id))
    await replaceEventTargets(existing.id, input.catalogActivityIds, now, client)
    return existing.id
  }
  const now = nextEventTimestamp()
  const id = `pdtp-fulfillment-${nanoid()}`
  const [inserted] = await client.insert(pdtpFulfillmentEvents).values({
    id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    eventType: input.eventType,
    sourceVersion: input.sourceVersion,
    periodOverrideJson: input.periodOverride,
    worksiteId: input.worksiteId,
    occurredAt: input.occurredAt,
    quantity: input.quantity,
    evidenceRef: input.evidenceRef,
    returnHref: input.returnHref,
    idempotencyKey,
    status: "pending",
    activityNumbers: input.activityNumbers ?? [],
    plannedYear: input.plannedYear ?? null,
    autoApproveByUserId: input.autoApproveByUserId ?? null,
    resultJson: {},
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: pdtpFulfillmentEvents.idempotencyKey }).returning({ id: pdtpFulfillmentEvents.id })
  if (inserted) {
    await replaceEventTargets(inserted.id, input.catalogActivityIds, now, client)
    return inserted.id
  }

  // Carrera: otra llamada concurrente insertó primero. Se suma el intento a
  // esa fila en vez de fallar.
  const [concurrent] = await client.select({ id: pdtpFulfillmentEvents.id, attempts: pdtpFulfillmentEvents.attempts })
    .from(pdtpFulfillmentEvents).where(eq(pdtpFulfillmentEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (!concurrent) throw new Error("No se pudo crear ni recuperar el evento de cumplimiento.")
  await client.update(pdtpFulfillmentEvents).set({ attempts: concurrent.attempts + 1, updatedAt: now }).where(eq(pdtpFulfillmentEvents.id, concurrent.id))
  await replaceEventTargets(concurrent.id, input.catalogActivityIds, now, client)
  return concurrent.id
}

async function replaceEventTargets(
  eventId: string,
  catalogActivityIds: string[] | undefined,
  now: string,
  client: QueryClient,
) {
  // `undefined` means a legacy caller in deployment 1: preserve any targets
  // produced by the backfill. An explicit array is the new source of truth.
  if (catalogActivityIds === undefined) return
  const uniqueIds = [...new Set(catalogActivityIds)]
  await client.delete(pdtpFulfillmentEventTargets).where(eq(pdtpFulfillmentEventTargets.eventId, eventId))
  if (uniqueIds.length === 0) return
  await client.insert(pdtpFulfillmentEventTargets).values(uniqueIds.map((catalogActivityId) => ({
    id: `pdtp-target:${eventId}:${catalogActivityId}`,
    eventId,
    catalogActivityId,
    createdAt: now,
  })))
}

async function resolveEventTargets(eventId: string, result: AccreditationResult) {
  if (result.accredited.length === 0) return
  const annualIds = result.accredited.map((entry) => entry.activityId)
  const annualRows = await db.select({
    id: pdtpActivities.id,
    n: pdtpActivities.n,
    catalogActivityId: pdtpActivities.catalogActivityId,
  }).from(pdtpActivities).where(inArray(pdtpActivities.id, annualIds))
  for (const annual of annualRows) {
    if (!annual.catalogActivityId) continue
    await db.update(pdtpFulfillmentEventTargets).set({
      resolvedActivityId: annual.id,
      activityNumberSnapshot: annual.n,
    }).where(and(
      eq(pdtpFulfillmentEventTargets.eventId, eventId),
      eq(pdtpFulfillmentEventTargets.catalogActivityId, annual.catalogActivityId),
    ))
  }
}

const CHILE_CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function fulfillmentCivilDate(occurredAt: string): string {
  if (CHILE_CIVIL_DATE_PATTERN.test(occurredAt)) return occurredAt
  const parsed = Date.parse(occurredAt)
  if (!Number.isFinite(parsed)) return occurredAt.slice(0, 10)
  return todayInChile(parsed)
}

function connectorAcceptsFulfillmentEvent(
  connectorKey: string,
  sourceType: AccreditationInput["sourceType"],
  metadata: Record<string, unknown>,
): boolean {
  const connector = getPdtpExecutionConnector(connectorKey)
  if (!connector) return false
  const eventKey = typeof metadata.eventKey === "string" ? metadata.eventKey.trim() : ""
  return connector.supportedEvents.some((event) => event.sourceType === sourceType && (!eventKey || event.key === eventKey))
}

/**
 * Enlaza el hecho nativo que ya acreditó el ledger con la ocurrencia fechada
 * que lo originó. La acreditación por actividad/número sigue siendo la fuente
 * de verdad para `pdtp_executions`; esta costura sólo cambia el estado de la
 * instancia y guarda la referencia verificable del registro fuente.
 *
 * La selección es deliberadamente una sola ocurrencia por actividad: la más
 * reciente exigible en la faena y no posterior al hecho. Si el hecho vuelve a
 * entrar, la ejecución idempotente ya estará enlazada y la instancia terminal
 * no vuelve a ser candidata.
 */
export async function linkPdtpScheduledInstancesToFulfillment(
  input: AccreditationInput,
  result: AccreditationResult,
  client: QueryClient = db,
): Promise<void> {
  if (result.accredited.length === 0) return

  const activityIds = [...new Set(result.accredited.map((entry) => entry.activityId))]
  const occurredDate = fulfillmentCivilDate(input.occurredAt)
  const candidates = await client.select({
    id: pdtpScheduledInstances.id,
    activityId: pdtpScheduledInstances.activityId,
    scheduledFor: pdtpScheduledInstances.scheduledFor,
    status: pdtpScheduledInstances.status,
    completionPolicy: pdtpActivityExecutionConfigs.completionPolicy,
    destinationConnectorKey: pdtpActivityExecutionConfigs.destinationConnectorKey,
  }).from(pdtpScheduledInstances)
    .innerJoin(
      pdtpActivityExecutionConfigs,
      eq(pdtpActivityExecutionConfigs.activityId, pdtpScheduledInstances.activityId),
    )
    .where(and(
      inArray(pdtpScheduledInstances.activityId, activityIds),
      eq(pdtpScheduledInstances.worksiteId, input.worksiteId),
      inArray(pdtpScheduledInstances.status, ["pending", "in_progress", "submitted"]),
      lte(pdtpScheduledInstances.scheduledFor, occurredDate),
    ))
    .orderBy(desc(pdtpScheduledInstances.scheduledFor), desc(pdtpScheduledInstances.createdAt))

  const metadata = input.metadata ?? {}
  const sourceApproved = Boolean(input.autoApproveByUserId)
    || metadata.sourceApproved === true
    || metadata.approvalStatus === "approved"
    || (typeof metadata.approvedAt === "string" && metadata.approvedAt.trim().length > 0)
  const usedInstances = new Set<string>()

  for (const accredited of result.accredited) {
    const candidate = candidates.find((row) => (
      row.activityId === accredited.activityId
      && !usedInstances.has(row.id)
      && connectorAcceptsFulfillmentEvent(row.destinationConnectorKey, input.sourceType, metadata)
    ))
    if (!candidate) continue

    let action: "submit" | "complete" | null = null
    if (candidate.completionPolicy === "source_completed") action = "complete"
    else if (candidate.completionPolicy === "source_approved") action = sourceApproved ? "complete" : "submit"
    else if (candidate.completionPolicy === "checklist_completed") {
      action = metadata.checklistCompleted === true || metadata.checklistStatus === "completed"
        ? "complete"
        : "submit"
    }
    if (!action) continue

    usedInstances.add(candidate.id)
    try {
      await recordPdtpScheduledInstanceOutcome({
        instanceId: candidate.id,
        action,
        userId: input.autoApproveByUserId ?? null,
        evidenceRef: input.evidenceRef ?? null,
        completedAt: input.occurredAt,
        sourceMetadata: {
          ...metadata,
          sourceRecordId: input.sourceId,
          sourceType: input.sourceType,
          sourceCompleted: true,
          executionId: accredited.executionId,
          ...(sourceApproved ? { sourceApproved: true, approvedAt: input.occurredAt } : {}),
        },
      }, client)
    } catch (err) {
      // El hecho nativo ya está guardado y acreditado. Una política de
      // evidencia incompleta o una carrera de otro enlace no debe deshacerlo;
      // queda en el libro durable para que un reintento posterior reconcilie
      // la instancia sin duplicar la ejecución.
      logger.warn({
        err,
        instanceId: candidate.id,
        activityId: candidate.activityId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      }, "[pdtp-fulfillment] No se pudo enlazar la instancia programada al hecho nativo.")
    }
  }
}

/**
 * Deja el hecho anotado como `pending` **dentro de la transacción del módulo
 * fuente**, sin intentar acreditar.
 *
 * Existe para el único caso en que un caller transaccional sabe de antemano que
 * el motor no puede acreditar —no hay programa activo— pero el hecho igual debe
 * sobrevivir: cerrar una inspección mientras el programa anual todavía se
 * redacta. `reconcilePdtpFulfillmentEvents` toma los `pending` y los acredita
 * cuando el programa se activa.
 *
 * **Escribe con el cliente que recibe, y eso es el punto.** Usar la conexión
 * global desde dentro de una transacción abierta es lo que no se puede hacer:
 * en producción se arriesga a bloquearse contra los candados de esa misma
 * transacción, y sobre una sola conexión —PGlite en los tests— directamente
 * cuelga. Además da la semántica correcta: si el cierre del run se revierte, el
 * evento se revierte con él y no queda prometido un cumplimiento que nadie hizo.
 */
export async function recordPendingPdtpFulfillmentEvent(
  input: AccreditationInput & { sourceVersion?: string; returnHref?: string },
  client: QueryClient,
): Promise<void> {
  await upsertPendingEvent({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    eventType: "completed",
    worksiteId: input.worksiteId,
    occurredAt: input.occurredAt,
    quantity: input.executedQuantity ?? 1,
    evidenceRef: input.evidenceRef ?? null,
    activityNumbers: input.activityNumbers,
    catalogActivityIds: input.catalogActivityIds,
    sourceVersion: input.sourceVersion ?? null,
    returnHref: input.returnHref ?? null,
    periodOverride: input.plannedPeriod ?? null,
    plannedYear: input.plannedYear,
    autoApproveByUserId: input.autoApproveByUserId,
  }, client)
}

/**
 * Registra un intento de acreditación de forma durable y lo ejecuta.
 *
 * Reemplaza el patrón `try { accreditPdtpFromEvent(input) } catch { log }` que
 * usaban los adaptadores: la diferencia es que un fallo —programa en borrador,
 * faena fuera del programa, actividad retirada— queda en la base como un evento
 * `pending`/`error` reprocesable, no sólo en un log. Ya no queda ningún llamador
 * con el patrón viejo.
 *
 * Nunca lanza: un fallo al escribir el evento durable tampoco debe tumbar la
 * transacción del módulo fuente, que es la misma garantía que ya ofrecía
 * `safeAccredit`.
 */
export async function recordPdtpFulfillmentEvent(input: AccreditationInput & {
  sourceVersion?: string
  returnHref?: string
}): Promise<AccreditationResult | null> {
  let normalizedInput = input
  if (input.catalogActivityIds?.length) {
    const uniqueIds = [...new Set(input.catalogActivityIds)]
    const existing = await db.select({ id: pdtpCatalogActivities.id }).from(pdtpCatalogActivities)
      .where(inArray(pdtpCatalogActivities.id, uniqueIds))
    if (existing.length !== uniqueIds.length) {
      const legacyNumbers = uniqueIds.map(legacyPdtpActivityNumberForCatalogId)
      if (legacyNumbers.every((number): number is number => number !== null)) {
        // Compatibilidad estrictamente temporal: si el código se despliega
        // después de crear las tablas pero antes del backfill, el hecho sigue
        // quedando durable con su snapshot numérico. En un ambiente migrado
        // (la ruta normal) nunca entra aquí y se crean objetivos normalizados.
        normalizedInput = { ...input, catalogActivityIds: undefined, activityNumbers: legacyNumbers }
      }
    }
  }
  let eventId: string
  try {
    eventId = await upsertPendingEvent({
      sourceType: normalizedInput.sourceType,
      sourceId: normalizedInput.sourceId,
      eventType: "completed",
      worksiteId: normalizedInput.worksiteId,
      occurredAt: normalizedInput.occurredAt,
      quantity: normalizedInput.executedQuantity ?? 1,
      evidenceRef: normalizedInput.evidenceRef ?? null,
      activityNumbers: normalizedInput.activityNumbers,
      catalogActivityIds: normalizedInput.catalogActivityIds,
      sourceVersion: input.sourceVersion ?? null,
      returnHref: input.returnHref ?? null,
      periodOverride: input.plannedPeriod ?? null,
      plannedYear: input.plannedYear,
      autoApproveByUserId: input.autoApproveByUserId,
    })
  } catch (err) {
    // No se pudo ni dejar constancia del intento. Mismo criterio que antes:
    // el hecho fuente ya está confirmado en su propia transacción y esto no
    // debe tumbarlo.
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId }, "[pdtp-fulfillment] No se pudo registrar el evento durable.")
    return null
  }

  try {
    const result = await accreditPdtpFromEvent(normalizedInput)
    await resolveEventTargets(eventId, result)
    await linkPdtpScheduledInstancesToFulfillment(normalizedInput, result)
    const now = new Date().toISOString()
    await db.update(pdtpFulfillmentEvents).set({
      status: result.accredited.length > 0 ? "accredited" : "rejected",
      resultJson: result as unknown as Record<string, unknown>,
      // La versión efectiva la resolvió el motor a partir de faena + fecha.
      // Nunca persistir la sugerencia del conector: un reintento de un hecho
      // anterior a v+1 puede resolverse legítimamente en v1 aunque el caller
      // todavía traiga el id de v2, y el reconciliador no trae ningún id.
      programId: result.resolvedProgramId ?? null,
      updatedAt: now,
    }).where(eq(pdtpFulfillmentEvents.id, eventId))
    if (result.skippedNotFound.length > 0) {
      logger.warn(
        { sourceType: input.sourceType, sourceId: input.sourceId, skippedNotFound: result.skippedNotFound },
        "[pdtp-fulfillment] Actividades no encontradas en el programa activo.",
      )
    }
    return result
  } catch (err) {
    const now = new Date().toISOString()
    const lastError = formatFulfillmentLastError(err)
    await db.update(pdtpFulfillmentEvents).set({ status: "error", lastError, updatedAt: now })
      .where(eq(pdtpFulfillmentEvents.id, eventId))
    logger.error(
      { err, sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId },
      "[pdtp-fulfillment] Error en auto-acreditación PDTP; el evento queda pendiente de reconciliar.",
    )
    return null
  }
}

/** Igual que `recordPdtpFulfillmentEvent`, para el sentido inverso. */
export async function recordPdtpFulfillmentRevocation(input: RevocationInput): Promise<void> {
  let eventId: string
  try {
    eventId = await upsertPendingEvent({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: "revoked",
      worksiteId: input.worksiteId,
      occurredAt: new Date().toISOString(),
      quantity: 0,
      evidenceRef: input.reason ?? null,
      activityNumbers: [],
      sourceVersion: null,
      returnHref: null,
      periodOverride: null,
      plannedYear: null,
      autoApproveByUserId: null,
    })
  } catch (err) {
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId }, "[pdtp-fulfillment] No se pudo registrar la revocación durable.")
    return
  }

  try {
    const result = await db.transaction((tx) => revokePdtpAccreditationWithClient(input, tx))
    const now = new Date().toISOString()
    await db.update(pdtpFulfillmentEvents).set({
      status: "revoked", resultJson: result as unknown as Record<string, unknown>, updatedAt: now,
    }).where(eq(pdtpFulfillmentEvents.id, eventId))
  } catch (err) {
    const now = new Date().toISOString()
    const lastError = formatFulfillmentLastError(err)
    await db.update(pdtpFulfillmentEvents).set({ status: "error", lastError, updatedAt: now })
      .where(eq(pdtpFulfillmentEvents.id, eventId))
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId, worksiteId: input.worksiteId }, "[pdtp-fulfillment] Error al revertir la acreditación PDTP.")
  }
}

/** Variante transaccional: conserva la revocación junto con el cambio de
 * estado de la ocurrencia que la origina. */
export async function recordPendingPdtpFulfillmentRevocation(
  input: RevocationInput,
  client: QueryClient,
): Promise<void> {
  await upsertPendingEvent({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    eventType: "revoked",
    worksiteId: input.worksiteId,
    occurredAt: new Date().toISOString(),
    quantity: 0,
    evidenceRef: input.reason ?? null,
    activityNumbers: [],
    sourceVersion: null,
    returnHref: null,
    periodOverride: null,
    plannedYear: null,
    autoApproveByUserId: null,
  }, client)
}

/**
 * Reprocesa los eventos que quedaron `pending` o `error` — al activar un
 * programa, al corregir un mapeo, o por reintento manual. Idempotente por
 * `idempotency_key`: `accreditPdtpFromEvent` no duplica una ejecución ya
 * creada, así que reintentar un evento que en el fondo ya se resolvió no
 * tiene efecto.
 *
 * No procesa hechos anteriores a `activatedAt` de ningún programa por su
 * cuenta: sólo reintenta eventos que YA están en el libro porque el propio
 * hecho operacional los escribió. Una carga histórica retroactiva es una
 * decisión aparte, con motivo y aprobación explícitos.
 */
export async function reconcilePdtpFulfillmentEvents(input: { limit?: number } = {}): Promise<{
  processed: number
  accredited: number
  rejected: number
  stillPending: number
  errored: number
}> {
  const limit = input.limit ?? 200
  const pending = await db.select().from(pdtpFulfillmentEvents)
    .where(inArray(pdtpFulfillmentEvents.status, ["pending", "error"]))
    .orderBy(pdtpFulfillmentEvents.createdAt)
    .limit(limit)

  const targetRows = pending.length === 0 ? [] : await db.select({
    eventId: pdtpFulfillmentEventTargets.eventId,
    catalogActivityId: pdtpFulfillmentEventTargets.catalogActivityId,
  }).from(pdtpFulfillmentEventTargets).where(inArray(pdtpFulfillmentEventTargets.eventId, pending.map((event) => event.id)))
  const catalogIdsByEvent = new Map<string, string[]>()
  for (const target of targetRows) {
    const ids = catalogIdsByEvent.get(target.eventId) ?? []
    ids.push(target.catalogActivityId)
    catalogIdsByEvent.set(target.eventId, ids)
  }

  let accredited = 0
  let rejected = 0
  let stillPending = 0
  let errored = 0

  // Un `completed` en pending/error puede tener un `revoked` posterior: las dos
  // filas coexisten porque la clave idempotente separa por `eventType`.
  // Coalescemos la última intención por fuente antes de procesar el lote. Esto
  // evita que una corrección posterior a la revocación sea revocada de nuevo
  // sólo porque la fila `completed` conserva su `createdAt` original.
  const pendingSourceIds = pending.map((event) => event.sourceId)
  const relatedRows = pendingSourceIds.length === 0 ? [] : await db.select({
    id: pdtpFulfillmentEvents.id,
    sourceType: pdtpFulfillmentEvents.sourceType,
    sourceId: pdtpFulfillmentEvents.sourceId,
    eventType: pdtpFulfillmentEvents.eventType,
    status: pdtpFulfillmentEvents.status,
    createdAt: pdtpFulfillmentEvents.createdAt,
    updatedAt: pdtpFulfillmentEvents.updatedAt,
  })
    .from(pdtpFulfillmentEvents)
    .where(inArray(pdtpFulfillmentEvents.sourceId, pendingSourceIds))
  type RelatedEvent = (typeof relatedRows)[number]
  const latestBySourceAndType = new Map<string, RelatedEvent>()
  for (const row of relatedRows) {
    const key = `${row.sourceType}:${row.sourceId}:${row.eventType}`
    const previous = latestBySourceAndType.get(key)
    if (!previous || `${row.updatedAt}:${row.createdAt}:${row.id}` > `${previous.updatedAt}:${previous.createdAt}:${previous.id}`) {
      latestBySourceAndType.set(key, row)
    }
  }

  const latestFor = (event: RelatedEvent, eventType: "completed" | "revoked") =>
    latestBySourceAndType.get(`${event.sourceType}:${event.sourceId}:${eventType}`)

  for (const event of pending) {
    if (event.eventType === "completed") {
      // The simplified training flow can correct an occurrence back to
      // `not_completed` and then complete it again with new evidence. Its
      // idempotency key is intentionally stable, so an old revocation row may
      // coexist with a newer completion attempt. Only suppress a completion
      // that is older than (or from the same write as) the latest revocation.
      const revoked = latestFor(event, "revoked")
      if (revoked && `${event.updatedAt}:${event.createdAt}:${event.id}` <= `${revoked.updatedAt}:${revoked.createdAt}:${revoked.id}`) {
        // Terminal, no pendiente: dejarlo en `pending` lo haría reintentar para
        // siempre contra una fuente que ya no existe.
        await db.update(pdtpFulfillmentEvents).set({
          status: "rejected",
          lastError: "El hecho fue revocado en su módulo de origen: no se reintenta.",
          updatedAt: new Date().toISOString(),
        }).where(eq(pdtpFulfillmentEvents.id, event.id))
        rejected++
        continue
      }
      const catalogActivityIds = catalogIdsByEvent.get(event.id)
      const result = await recordPdtpFulfillmentEvent({
        sourceType: event.sourceType as AccreditationInput["sourceType"],
        sourceId: event.sourceId,
        worksiteId: event.worksiteId,
        ...(catalogActivityIds?.length
          ? { catalogActivityIds }
          : { activityNumbers: (event.activityNumbers as number[]) ?? [] }),
        occurredAt: event.occurredAt,
        executedQuantity: Number(event.quantity),
        evidenceRef: event.evidenceRef ?? undefined,
        sourceVersion: event.sourceVersion ?? undefined,
        returnHref: event.returnHref ?? undefined,
        plannedPeriod: event.periodOverrideJson ?? undefined,
        plannedYear: event.plannedYear ?? undefined,
        autoApproveByUserId: event.autoApproveByUserId ?? undefined,
      })
      if (!result) {
        errored++
      } else {
        const [refreshed] = await db.select({ status: pdtpFulfillmentEvents.status })
          .from(pdtpFulfillmentEvents)
          .where(eq(pdtpFulfillmentEvents.id, event.id))
          .limit(1)
        if (refreshed?.status === "accredited") accredited++
        else if (refreshed?.status === "rejected") rejected++
        else if (refreshed?.status === "error") errored++
        else stillPending++
      }
    } else {
      const completed = latestFor(event, "completed")
      if (completed && `${completed.updatedAt}:${completed.createdAt}:${completed.id}` > `${event.updatedAt}:${event.createdAt}:${event.id}`) {
        await db.update(pdtpFulfillmentEvents).set({
          status: "rejected",
          lastError: "El origen volvió a marcarse como hecho: no se reintenta la revocación anterior.",
          updatedAt: nextEventTimestamp(event.updatedAt),
        }).where(eq(pdtpFulfillmentEvents.id, event.id))
        rejected++
        continue
      }
      await recordPdtpFulfillmentRevocation({
        sourceType: event.sourceType as RevocationInput["sourceType"],
        sourceId: event.sourceId,
        worksiteId: event.worksiteId,
        reason: event.evidenceRef ?? undefined,
      })
      const [refreshed] = await db.select({ status: pdtpFulfillmentEvents.status }).from(pdtpFulfillmentEvents).where(eq(pdtpFulfillmentEvents.id, event.id)).limit(1)
      if (refreshed?.status === "revoked") accredited++
      else if (refreshed?.status === "rejected") rejected++
      else if (refreshed?.status === "error") errored++
      else stillPending++
    }
  }

  return { processed: pending.length, accredited, rejected, stillPending, errored }
}

// ── Destino externo (`resolvePdtpFulfillmentTarget`) ───────────────────────

export type PdtpFulfillmentTarget = {
  kind: "operational" | "fallback"
  module: string
  href: string
  ctaLabel: string
  event: string
}

/**
 * El destino externo por mecanismo, sin depender del `worksiteId` — es el
 * mismo `CASE` que hoy vive incrustado en `operational-work-queue.ts:778-791`
 * y antes producía el 404 de `/prevencion/constancias`. Único lugar que debe decidir
 * esto; `/pendientes`, el tablero y la planilla consumen esta respuesta.
 */
export function resolvePdtpFulfillmentTarget(
  activity: { mechanism: string; n?: number; programId?: string },
  worksiteId: string,
): PdtpFulfillmentTarget {
  if (activity.mechanism === "constancia") {
    return {
      kind: "operational",
      module: "constancias",
      href: `/prevencion/constancias?faena=${worksiteId}`,
      ctaLabel: "Dejar constancia",
      event: "constancia enviada con evidencia",
    }
  }
  if (activity.mechanism === "enganche" || activity.mechanism === "compuesta") {
    // Con el contrato de cumplimiento se manda al módulo donde el trabajo se
    // hace de verdad, en vez de devolver a todo el mundo a la planilla.
    const destination = activity.n === undefined ? null : engancheDestinationFor(activity.n)
    const href = destination?.href(worksiteId, activity.programId) ?? null
    if (destination && href) {
      return {
        kind: "operational",
        module: destination.module,
        href,
        ctaLabel: "Ir a cumplirla",
        event: "registro del módulo de origen",
      }
    }
    return {
      kind: "fallback",
      module: "pdtp",
      href: `/prevencion/pdtp/actividades?faena=${worksiteId}&vista=semana`,
      ctaLabel: "Ver cómo se cumple",
      event: "registro del módulo de origen",
    }
  }
  return {
    kind: "fallback",
    module: "pdtp",
    href: `/prevencion/pdtp/actividades?faena=${worksiteId}&vista=semana`,
    ctaLabel: "Registrar cumplimiento",
    event: "registro manual en la planilla",
  }
}

// ── Compuerta 81/81 ──────────────────────────────────────────────────────

export type PdtpFulfillmentCoverageStatus =
  | "ready"
  /** El contrato operativo acredita el hecho en un flujo segregado válido. */
  | "segregated_valid"
  | "config_required"
  | "code_gap"
  /** El mecanismo existe, pero no hay un destino operativo configurable. */
  | "destination_not_configured"
  | "permission_gap"
  /** El destino requiere acreditar un hecho y todavía no se eligió quién lo hace. */
  | "executor_required"
  /** Hay ejecutores declarados, pero ninguno tiene el permiso del destino. */
  | "executor_permission_gap"
  | "decision_required"
  /**
   * El número está declarado —hay plantilla, curso o plan con ese `n`— pero el
   * instrumento no está vigente: la plantilla sigue en `draft`, el curso no
   * tiene ninguna versión `published`, o el plan de emergencia no está
   * `approved`. Declarar no es poder ejecutar: sólo una plantilla `approved` se
   * puede programar o ejecutar, `createTrainingSession` rechaza cualquier curso
   * sin versión `published`, y la N°84 necesita un plan `approved` para poder
   * programar un simulacro.
   *
   * **No bloquea el envío ni la activación; queda visible como riesgo operativo.**
   * Enviar a revisión es sobre el contenido firmado —el catálogo de
   * actividades— y activar sólo bloquea lo que no tiene destino o ejecutor
   * dentro del programa. La separación no crea un candado circular: aprobar
   * plantillas, publicar versiones de curso y aprobar planes de emergencia no
   * tocan ninguna tabla `pdtp_*`, así que toda esa configuración puede
   * resolverse entre el envío a revisión y la activación sin invalidar las
   * firmas (`computePdtpProgramContentDigest` sólo lee tablas `pdtp_*`).
   */
  | "instrument_required"

export type PdtpFulfillmentCoverageIssue = {
  /**
   * `pdtpActivities.id`. Sin esto ninguna clasificación puede enlazar a **su**
   * fila: el informe sólo llevaba `n`, y con `n` se llega a una sección, no a
   * una actividad.
   */
  activityId: string
  n: number
  activity: string
  status: PdtpFulfillmentCoverageStatus
  reason: string
  /** Información operativa para una CTA legible; nunca concede permisos. */
  destinationModule?: string
  requiredPermission?: string
  executorRoleLabels?: string[]
  suggestedExecutorRoleIds?: string[]
  /**
   * Caminos **alternativos** de resolución: basta con uno. Ver la cabecera de
   * `./instrument-gap` — la semántica de disyunción no es un detalle de
   * presentación, sale de que `instrumentIssueFor` corta con
   * `usableGlobally.has(n)`.
   */
  instruments?: PdtpCoverageInstrument[]
}

/**
 * Actividades cuyo número está **fijo en el código de un conector**, y que por
 * eso no aparecen —ni tienen por qué aparecer— en ninguna tabla de
 * configuración.
 *
 * El criterio es literal y no admite parientes: el número es una constante en
 * el conector. Que un conector *reciba* el número no basta. La N°36, la N°43 y
 * la N°84 estuvieron acá por esa confusión —sus números vienen de
 * `sst_document_types` y de `prevention_emergency_plans`— y estar en la lista
 * las eximía justo de la verificación que les correspondía: la compuerta las
 * daba por listas con las dos tablas vacías. La N°83 sí pertenece:
 * `PDTP_EMERGENCY_PLAN_ACTIVITY_NUMBER` es una constante del conector.
 *
 * Se mantiene a mano porque no hay un registro único de "qué número acredita
 * cada conector" — es la misma razón por la que el diagnóstico de agosto tuvo
 * que auditarse actividad por actividad. Actualizarla es el costo de agregar un
 * conector nuevo.
 */
const STRUCTURALLY_WIRED_ACTIVITY_NUMBERS = new Set([
  1, 9, 11,           // programa, revisión por la dirección, CPHS
  7,                  // indicadores de faena (Fase 4.1)
  15, 18, 19, 23, 52, // acta de trabajador nuevo (la N°19 es la carpeta, T47)
  17,                 // RE-28 de personas sensibles (worker-sensitivity-connector)
  20,                 // coordinación con el mandante (Task 12, external-engagement-accreditation-connector)
  35,                 // MIPER
  45, 46, 47, 48, 49, 50, // higiene y vigilancia
  62,                 // entrega de EPP
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, // incidentes RE-20
  83,                 // plan de emergencia aprobado (la N°84 la declara el plan)
  30, 31, 32,         // alcotest (G14, prevention-alcotest.ts)
  79, 80, 81,         // CGRD del DS 44 (G15, prevention-cgrd.ts)
])

/**
 * Permisos vigentes por rol, leídos de la base y no del manifest: el manifest
 * es la semilla por defecto, y lo que decide si alguien entra son los grants
 * que estén realmente cargados.
 */
async function permissionsByRoleId(client: QueryClient): Promise<Map<string, Set<string>>> {
  const rows = await client.select({ roleId: roles.id, permission: permissions.name })
    .from(rolePermissions)
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
  const byRole = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byRole.get(row.roleId) ?? new Set<string>()
    set.add(row.permission)
    byRole.set(row.roleId, set)
  }
  return byRole
}

/**
 * Permiso que exige el módulo donde se registra el cumplimiento, según el
 * mecanismo.
 *
 * Sólo se verifican los dos mecanismos cuyo destino se conoce:
 *
 * - `constancia` se marca en Constancias.
 * - `formulario` se registra dentro del propio PDTP.
 *
 * `enganche` y `compuesta` devuelven `null` acá a propósito: su destino real
 * depende de la actividad —una cierra en Inspecciones, otra en Capacitación,
 * otra en EPP— y lo resuelve `engancheDestinationPermissionFor` contra
 * `fulfillment-contract-2026.ts`, más abajo. Lo que esta función responde es
 * sólo "¿qué permiso exige la planilla?", y a esas dos no las cumple la
 * planilla.
 *
 * Para `compuesta` la razón es además que **nadie la ejecuta**: se cumple
 * cuando sus componentes están completos —la N°52 cierra con el acta de
 * trabajador nuevo—, así que exigirle a su responsable el permiso de la
 * planilla comprobaba algo que no hace falta para cumplirla, y podía bloquear
 * el envío del programa por una configuración legítima. Eso vale para este
 * chequeo y **sólo** para éste: el del acto que la acredita sí le corresponde.
 */
function destinationPermissionFor(mechanism: string): string | null {
  if (mechanism === "constancia") return "prevention:constancias:execute"
  if (mechanism === "formulario") return "prevention:pdtp:execute"
  return null
}

/**
 * El permiso del acto que acredita una actividad de enganche, según el contrato
 * de cumplimiento 2026. `null` cuando no hay módulo de destino, cuando la
 * actividad no está en el mapa, o cuando su cumplimiento está segregado a
 * propósito del responsable declarado.
 */
function engancheDestinationPermissionFor(n: number): { permission: string; module: string } | null {
  const destination = engancheDestinationFor(n)
  if (!destination || !destination.permission || destination.segregated) return null
  return { permission: destination.permission, module: destination.module }
}

/*
 * "¿Está declarado?" y "¿está vigente?" son la misma lectura con y sin un
 * `WHERE` de estado, así que las resuelve `loadPdtpInstrumentIndex` en una sola
 * pasada (ver `./instruments`). Acá vivían dos funciones —
 * `activityNumbersDeclaredGlobally` y `activityNumbersDeclaredPerWorksite`—
 * que releían las mismas cinco tablas sin filtro; el resultado eran 11 `SELECT`
 * en tres olas para seis tablas, y ninguna de las dos mitades sabía **cuál**
 * instrumento declaraba cada número, que es lo único accionable.
 */

/**
 * Faenas contra las que se exige la declaración por faena: las miembros del
 * programa, o todas las activas cuando el programa declaró alcance corporativo.
 * Un programa sin miembros y sin esa declaración devuelve un denominador vacío
 * (la activación lo bloquea por separado), para no presentar cobertura de una
 * versión que todavía no tiene alcance ejecutable.
 */
export type PdtpCoverageScope = { worksiteIds?: string[] }

async function programWorksiteIds(
  client: QueryClient,
  programId: string,
  options?: PdtpCoverageScope,
): Promise<string[]> {
  const visibleWorksiteIds = options?.worksiteIds
  const visibleWorksiteSet = visibleWorksiteIds ? new Set(visibleWorksiteIds) : null
  const [[program], members] = await Promise.all([
    client.select({ appliesToAllWorksites: pdtpPrograms.appliesToAllWorksites })
      .from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, programId))
      .limit(1),
    client.select({ worksiteId: pdtpProgramWorksites.worksiteId })
      .from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true))),
  ])
  if (members.length > 0) {
    return members
      .map((row) => row.worksiteId)
      .filter((worksiteId) => !visibleWorksiteSet || visibleWorksiteSet.has(worksiteId))
  }
  if (!program?.appliesToAllWorksites) return []
  const active = await client.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true))
  return active
    .map((row) => row.id)
    .filter((worksiteId) => !visibleWorksiteSet || visibleWorksiteSet.has(worksiteId))
}

/**
 * Faenas donde cada actividad NO aplica. La compuerta las tiene que descontar
 * del denominador: exigirle plan de emergencia a una faena que declaró no
 * hacer simulacros es pedir configuración para trabajo que nadie prometió.
 */
async function excludedWorksitesByActivity(
  client: QueryClient,
  activityIds: string[],
): Promise<Map<string, Set<string>>> {
  if (activityIds.length === 0) return new Map()
  const rows = await client.select({
    activityId: pdtpActivityWorksiteExclusions.activityId,
    worksiteId: pdtpActivityWorksiteExclusions.worksiteId,
  }).from(pdtpActivityWorksiteExclusions)
    .where(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds))
  const byActivity = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byActivity.get(row.activityId) ?? new Set<string>()
    set.add(row.worksiteId)
    byActivity.set(row.activityId, set)
  }
  return byActivity
}

/**
 * Por qué una actividad de enganche o compuesta no tiene destino declarado, si
 * es que no lo tiene.
 *
 * Un número respaldado sólo por una tabla **por faena** está cableado si y sólo
 * si **todas** las faenas del programa donde la actividad aplica lo declaran:
 * prometer simulacros en siete faenas y tener el plan en una es tener seis
 * faenas sin dónde cumplir. Las faenas que la actividad excluye no son
 * denominador: nadie prometió trabajo ahí.
 */
function wiringIssueFor(
  activity: { id: string; n: number; activity: string },
  ctx: {
    declaredGlobally: Set<number>
    declaredPerWorksite: Map<number, Set<string>>
    worksiteIds: string[]
    worksiteNameById: Map<string, string>
    excludedWorksiteIds: Set<string>
  },
): PdtpFulfillmentCoverageIssue | null {
  if (STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) return null
  if (ctx.declaredGlobally.has(activity.n)) return null

  // Las faenas donde la actividad no aplica no son denominador.
  const applicableWorksiteIds = ctx.worksiteIds.filter((id) => !ctx.excludedWorksiteIds.has(id))
  if (applicableWorksiteIds.length === 0) return null

  const declaringWorksites = ctx.declaredPerWorksite.get(activity.n)
  if (declaringWorksites) {
    const missing = applicableWorksiteIds.filter((id) => !declaringWorksites.has(id))
    if (missing.length === 0) return null
    const names = missing.map((id) => ctx.worksiteNameById.get(id) ?? id)
    return {
      activityId: activity.id, n: activity.n, activity: activity.activity, status: "config_required",
      reason: `Su número no está declarado en ${missing.length} de las ${applicableWorksiteIds.length} faenas donde aplica: ${names.join(", ")}.`,
    }
  }

  return {
    activityId: activity.id, n: activity.n, activity: activity.activity, status: "config_required",
    reason: "Su número no está declarado en ninguna plantilla, curso, campaña, plan o tipo de documento.",
  }
}

/**
 * Declarado no es vigente. Espeja a `wiringIssueFor` —misma resta de
 * exclusiones, misma lógica por faena— pero mira si el instrumento que declara
 * el número está en un estado que de verdad se puede ejecutar: una plantilla
 * `approved`, un curso con versión `published`, un plan de emergencia
 * `approved`. Sólo se llama para números que `wiringIssueFor` ya dejó pasar
 * (declarados en algún lado): repetir el chequeo de "¿está declarado?" acá
 * sería ruido.
 */
function instrumentIssueFor(
  activity: { id: string; n: number; activity: string },
  ctx: {
    usableGlobally: Set<number>
    usablePerWorksite: Map<number, Set<string>>
    /** Todos los instrumentos que declaran cada número, vigentes y no: es lo
     *  que permite nombrar el que falta en vez de enumerar los que podrían
     *  faltar. */
    instrumentsByNumber: Map<number, PdtpInstrumentRecord[]>
    worksiteIds: string[]
    worksiteNameById: Map<string, string>
    excludedWorksiteIds: Set<string>
  },
): PdtpFulfillmentCoverageIssue | null {
  if (STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) return null
  if (ctx.usableGlobally.has(activity.n)) return null

  const applicableWorksiteIds = ctx.worksiteIds.filter((id) => !ctx.excludedWorksiteIds.has(id))
  if (applicableWorksiteIds.length === 0) return null

  /* La decisión de si hay problema no cambió: `usablePerWorksite` con entrada
   * significa "hay instrumento por faena vigente en algunas"; sin entrada,
   * "en ninguna". Lo único que cambia es que ahora se puede decir cuál. */
  const usableWorksites = ctx.usablePerWorksite.get(activity.n)
  const perWorksiteCandidates = (ctx.instrumentsByNumber.get(activity.n) ?? [])
    .filter((record) => record.kind === "emergency_plan")
  let missingWorksiteIds: string[]
  if (usableWorksites) {
    missingWorksiteIds = applicableWorksiteIds.filter((id) => !usableWorksites.has(id))
    if (missingWorksiteIds.length === 0) return null
  } else {
    // Ninguna faena tiene instrumento por faena vigente. Sólo se enumeran las
    // faenas cuando lo que declara el número es un plan de emergencia —el caso
    // de la N°84—: para una plantilla o un curso, que son globales, listar
    // faenas manda al operador a arreglar lo que no tiene.
    missingWorksiteIds = perWorksiteCandidates.length > 0 ? applicableWorksiteIds : []
  }

  const candidates = (ctx.instrumentsByNumber.get(activity.n) ?? []).filter((record) => !record.usable)
  const { reason, instruments } = describePdtpInstrumentGap({
    n: activity.n,
    candidates,
    missingWorksites: missingWorksiteIds.map((id) => ({ id, name: ctx.worksiteNameById.get(id) ?? id })),
    applicableWorksiteCount: applicableWorksiteIds.length,
  })

  return {
    activityId: activity.id, n: activity.n, activity: activity.activity,
    status: "instrument_required", reason, instruments,
  }
}

/**
 * Compuerta que exige, por actividad activa del programa, un destino externo
 * declarado y verificable. Se llama desde `pdtpSubmitReviewBlockers` y desde
 * `activatePdtpProgram`: no debe volver a ser posible activar un programa que
 * promete trabajo sin ofrecer dónde realizarlo.
 *
 * Devuelve la lista de problemas encontrados (vacía = compuerta pasada). No
 * lanza: el llamador decide si un problema bloquea o sólo se muestra. Las
 * compuertas de ciclo de vida omiten `options` para evaluar el programa
 * completo; las vistas autenticadas pueden pasar el alcance visible para no
 * exponer nombres de faenas fuera de la sesión.
 */
export async function assertPdtpFulfillmentCoverage(
  programId: string,
  client: QueryClient = db,
  options?: PdtpCoverageScope,
): Promise<PdtpFulfillmentCoverageIssue[]> {
  const [program] = await client.select({ version: pdtpPrograms.version, status: pdtpPrograms.status })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  // Los programas históricos no reciben ejecutores inventados por migración.
  // Una v1 ya activa muestra el riesgo para que se abra una revisión, pero la
  // compuerta sólo lo exige en v+1, que es donde se puede configurar sin
  // mutar evidencia ni la huella firmada del programa en curso.
  const requiresExecutorConfiguration = program.version > 1 || program.status === "active"
  const activities = await client.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active")))
  if (activities.length === 0) return []

  const activityIds = activities.map((activity) => activity.id)
  const [
    instrumentIndex,
    worksiteIds,
    worksiteRows,
    responsibleRows,
    executorRows,
    executionConfigRows,
    bindingRows,
    roleRows,
    permissionsByRole,
    excludedByActivity,
    manualSubjectRows,
  ] = await Promise.all([
    loadPdtpInstrumentIndex(client),
    programWorksiteIds(client, programId, options),
    client.select({ id: worksites.id, name: worksites.name }).from(worksites),
    client.select().from(pdtpResponsibleCatalog),
    client.select({
      activityId: pdtpActivityExecutorAssignments.activityId,
      roleId: roles.id,
      roleLabel: roles.label,
    }).from(pdtpActivityExecutorAssignments)
      .innerJoin(roles, eq(roles.id, pdtpActivityExecutorAssignments.roleId))
      .where(inArray(pdtpActivityExecutorAssignments.activityId, activityIds)),
    client.select({
      activityId: pdtpActivityExecutionConfigs.activityId,
      destinationConnectorKey: pdtpActivityExecutionConfigs.destinationConnectorKey,
      accreditationBindingId: pdtpActivityExecutionConfigs.accreditationBindingId,
    }).from(pdtpActivityExecutionConfigs)
      .where(inArray(pdtpActivityExecutionConfigs.activityId, activityIds)),
    client.select({
      id: pdtpAccreditationBindings.id,
      isActive: pdtpAccreditationBindings.isActive,
    }).from(pdtpAccreditationBindings),
    client.select({ id: roles.id, name: roles.name }).from(roles),
    permissionsByRoleId(client),
    excludedWorksitesByActivity(client, activityIds),
    client.select({
      activityId: pdtpActivityWorksiteParams.activityId,
      worksiteId: pdtpActivityWorksiteParams.worksiteId,
      expectedSubjectCount: pdtpActivityWorksiteParams.expectedSubjectCount,
    }).from(pdtpActivityWorksiteParams).where(inArray(pdtpActivityWorksiteParams.activityId, activityIds)),
  ])
  const { global: declaredGlobally, perWorksite: declaredPerWorksite } = instrumentIndex.declared
  const { global: usableGlobally, perWorksite: usablePerWorksite } = instrumentIndex.usable
  const worksiteNameById = new Map(worksiteRows.map((row) => [row.id, row.name]))
  const roleBySlug = new Map(responsibleRows.map((row) => [row.slug, row.roleName ?? row.operatedByRoleName]))
  const executorRolesByActivity = new Map<string, Array<{ id: string; label: string }>>()
  for (const row of executorRows) {
    const assigned = executorRolesByActivity.get(row.activityId) ?? []
    assigned.push({ id: row.roleId, label: row.roleLabel })
    executorRolesByActivity.set(row.activityId, assigned)
  }
  const executionConfigByActivity = new Map(executionConfigRows.map((row) => [row.activityId, row]))
  const activeBindingIds = new Set(bindingRows.filter((row) => row.isActive).map((row) => row.id))
  const roleIdByName = new Map(roleRows.map((row) => [row.name, row.id]))
  const manualSubjectWorksitesByActivity = new Map<string, Set<string>>()
  for (const row of manualSubjectRows) {
    if ((row.expectedSubjectCount ?? 0) <= 0) continue
    const ids = manualSubjectWorksitesByActivity.get(row.activityId) ?? new Set<string>()
    ids.add(row.worksiteId)
    manualSubjectWorksitesByActivity.set(row.activityId, ids)
  }

  const issues: PdtpFulfillmentCoverageIssue[] = []
  for (const activity of activities) {
    const slugs = (activity.responsibleSlugs as string[] | null) ?? []
    const roles = slugs.map((slug) => roleBySlug.get(slug)).filter((role): role is string => Boolean(role))
    if (roles.length === 0) {
      issues.push({
        activityId: activity.id, n: activity.n, activity: activity.activity, status: "permission_gap",
        reason: PDTP_NO_EXECUTOR_ROLE_REASON,
      })
      continue
    }

    // Las actividades creadas con el calendario nuevo no tienen un número
    // histórico que pueda resolver `resolvePdtpFulfillmentTarget`. Su destino
    // persistido es la fuente de verdad y se valida con el registro de
    // conectores; el contrato 2026 queda reservado para las filas heredadas.
    const executionConfig = executionConfigByActivity.get(activity.id)
    const isConfiguredSchedule = Boolean(
      executionConfig
      && activity.scheduleDefinition
      && typeof activity.scheduleDefinition === "object"
      && (activity.scheduleDefinition as { kind?: unknown }).kind !== "legacy_grid",
    )
    if (isConfiguredSchedule) {
      const connector = getPdtpExecutionConnector(executionConfig?.destinationConnectorKey)
      if (!connector) {
        issues.push({
          activityId: activity.id, n: activity.n, activity: activity.activity, status: "destination_not_configured",
          reason: "La actividad nueva referencia un conector operativo que ya no está disponible.",
        })
        continue
      }
      if (executionConfig?.accreditationBindingId && !activeBindingIds.has(executionConfig.accreditationBindingId)) {
        issues.push({
          activityId: activity.id, n: activity.n, activity: activity.activity, status: "config_required",
          reason: "El instrumento seleccionado para la actividad nueva ya no está vigente.",
          destinationModule: connector.label,
          requiredPermission: connector.configurePermission,
        })
        continue
      }
      const assignedExecutors = executorRolesByActivity.get(activity.id) ?? []
      const responsibleRoleIds = roles
        .map((roleName) => roleIdByName.get(roleName))
        .filter((roleId): roleId is string => Boolean(roleId))
      const candidateExecutorIds = assignedExecutors.length > 0
        ? assignedExecutors.map((role) => role.id)
        : responsibleRoleIds
      if (requiresExecutorConfiguration && candidateExecutorIds.length === 0) {
        issues.push({
          activityId: activity.id, n: activity.n, activity: activity.activity, status: "executor_required",
          reason: `Se acredita en ${connector.label}; falta asignar un rol con permiso para registrar el hecho.`,
          destinationModule: connector.label,
          requiredPermission: connector.executePermission,
          suggestedExecutorRoleIds: [...permissionsByRole.entries()]
            .filter(([, grants]) => grants.has(connector.executePermission))
            .map(([roleId]) => roleId),
        })
        continue
      }
      if (requiresExecutorConfiguration && !candidateExecutorIds.some((roleId) => permissionsByRole.get(roleId)?.has(connector.executePermission))) {
        issues.push({
          activityId: activity.id, n: activity.n, activity: activity.activity, status: "executor_permission_gap",
          reason: `Se acredita en ${connector.label}, pero ningún responsable/ejecutor tiene el permiso operativo requerido.`,
          destinationModule: connector.label,
          requiredPermission: connector.executePermission,
          executorRoleLabels: assignedExecutors.map((role) => role.label),
          suggestedExecutorRoleIds: [...permissionsByRole.entries()]
            .filter(([, grants]) => grants.has(connector.executePermission))
            .map(([roleId]) => roleId),
        })
        continue
      }
      if (activity.indicatorMode === "coverage" && !activity.subjectSource) {
        const excluded = excludedByActivity.get(activity.id) ?? new Set<string>()
        const applicableWorksiteIds = worksiteIds.filter((id) => !excluded.has(id))
        const configuredWorksiteIds = manualSubjectWorksitesByActivity.get(activity.id) ?? new Set<string>()
        const missingWorksiteIds = applicableWorksiteIds.filter((id) => !configuredWorksiteIds.has(id))
        if (missingWorksiteIds.length > 0) {
          const names = missingWorksiteIds.map((id) => worksiteNameById.get(id) ?? id)
          issues.push({
            activityId: activity.id, n: activity.n, activity: activity.activity, status: "decision_required",
            reason: `Se mide por cobertura sin fuente automática y falta definir un padrón manual positivo en: ${names.join(", ")}.`,
          })
        }
      }
      continue
    }

    if (activity.mechanism === "sin_definir") {
      issues.push({ activityId: activity.id, n: activity.n, activity: activity.activity, status: "code_gap", reason: "Sin mecanismo de acreditación clasificado." })
      continue
    }

    if (activity.mechanism === "constancia" && !activity.evidenceRequirement?.trim()) {
      issues.push({ activityId: activity.id, n: activity.n, activity: activity.activity, status: "config_required", reason: "Es constancia y no declara evidencia mínima." })
      continue
    }

    // `compuesta` entra en la verificación de cableado igual que `enganche`.
    // La exención que tenía estaba razonada para el chequeo de PERMISO —nadie
    // la ejecuta, se cumple cuando sus componentes cierran— y se arrastró hasta
    // acá, donde no aplica: una compuesta sin ningún componente que la acredite
    // no se cumple sola, no se cumple nunca. Es lo que dejaba pasar a la N°16 y
    // la N°17.
    if (activity.mechanism === "enganche" || activity.mechanism === "compuesta") {
      const issue = wiringIssueFor(activity, {
        declaredGlobally, declaredPerWorksite, worksiteIds, worksiteNameById,
        excludedWorksiteIds: excludedByActivity.get(activity.id) ?? new Set<string>(),
      })
      if (issue) {
        issues.push(issue)
        continue
      }

      // Declarado no es vigente. Va después del cableado —una actividad sin
      // número declarado ya salió como `config_required` y repetirlo sería
      // ruido— y antes del destino, porque sin instrumento el permiso del
      // destino es una pregunta prematura.
      if (!STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) {
        const instrumentIssue = instrumentIssueFor(activity, {
          usableGlobally, usablePerWorksite, worksiteIds, worksiteNameById,
          instrumentsByNumber: instrumentIndex.byNumber,
          excludedWorksiteIds: excludedByActivity.get(activity.id) ?? new Set<string>(),
        })
        if (instrumentIssue) {
          issues.push(instrumentIssue)
          continue
        }
      }
    }

    // Tener un instrumento vigente no basta si la tarjeta termina en la
    // planilla del PDTP: esa vista permite seguir el estado, pero no ejecutar
    // el acto que acredita la actividad. Un número nuevo sin entrada en el
    // contrato (o un `formulario` todavía manual) debe bloquear la activación
    // hasta que exista un destino operativo concreto.
    const target = resolvePdtpFulfillmentTarget(
      { mechanism: activity.mechanism, n: activity.n, programId },
      worksiteIds[0] ?? "",
    )
    if (target.kind === "fallback") {
      issues.push({
        activityId: activity.id, n: activity.n, activity: activity.activity, status: "destination_not_configured",
        reason: "No tiene un destino operativo concreto: todavía cae a la planilla genérica del PDTP.",
      })
      continue
    }

    // Un flujo segregado no es una brecha de permiso: el contrato exige que
    // quien planifica no sea quien acredita o aprueba el hecho. Exponerlo
    // como estado explícito evita que el panel lo confunda con una actividad
    // "lista" por accidente o con un ejecutor que falte.
    const contractDestination = activity.mechanism === "enganche" || activity.mechanism === "compuesta"
      ? engancheDestinationFor(activity.n)
      : null
    if (contractDestination?.segregated) {
      issues.push({
        activityId: activity.id,
        n: activity.n,
        activity: activity.activity,
        status: "segregated_valid",
        reason: `Flujo segregado válido: ${contractDestination.segregated}`,
        destinationModule: contractDestination.module,
      })
      continue
    }

    // Planificar y acreditar son responsabilidades distintas. Se contrasta el
    // permiso del módulo solamente contra los ejecutores asignados; los flujos
    // que el contrato declara segregados devuelven `null` y se conservan como
    // válidos sin pedir un grant incompatible con su control de aprobación.
    const directPermission = destinationPermissionFor(activity.mechanism)
    const enganchePermission = activity.mechanism === "enganche" || activity.mechanism === "compuesta"
      ? engancheDestinationPermissionFor(activity.n)
      : null
    const destination = enganchePermission
      ?? (directPermission ? {
        permission: directPermission,
        module: activity.mechanism === "constancia" ? "Constancias" : "Programa preventivo",
      } : null)
    if (destination && requiresExecutorConfiguration) {
      const executorRoles = executorRolesByActivity.get(activity.id) ?? []
      const suggestedExecutorRoleIds = [...permissionsByRole.entries()]
        .filter(([, grants]) => grants.has(destination.permission))
        .map(([roleId]) => roleId)
      if (executorRoles.length === 0) {
        issues.push({
          activityId: activity.id,
          n: activity.n,
          activity: activity.activity,
          status: "executor_required",
          reason: `Se acredita en ${destination.module}; falta asignar al menos un rol ejecutor para registrar ese hecho.`,
          destinationModule: destination.module,
          requiredPermission: destination.permission,
          suggestedExecutorRoleIds,
        })
        continue
      }
      if (!executorRoles.some((role) => permissionsByRole.get(role.id)?.has(destination.permission))) {
        issues.push({
          activityId: activity.id,
          n: activity.n,
          activity: activity.activity,
          status: "executor_permission_gap",
          reason: `Se acredita en ${destination.module}, pero ninguno de los ejecutores asignados puede registrar el hecho.`,
          destinationModule: destination.module,
          requiredPermission: destination.permission,
          executorRoleLabels: executorRoles.map((role) => role.label),
          suggestedExecutorRoleIds,
        })
        continue
      }
    }

    // Sin fuente automática, un padrón manual explícito y positivo por cada
    // faena aplicable es una decisión válida. Sólo se advierte cuando falta al
    // menos una faena; las excluidas no forman parte del denominador.
    if (activity.indicatorMode === "coverage" && !activity.subjectSource) {
      const excluded = excludedByActivity.get(activity.id) ?? new Set<string>()
      const applicableWorksiteIds = worksiteIds.filter((id) => !excluded.has(id))
      const configuredWorksiteIds = manualSubjectWorksitesByActivity.get(activity.id) ?? new Set<string>()
      const missingWorksiteIds = applicableWorksiteIds.filter((id) => !configuredWorksiteIds.has(id))
      if (missingWorksiteIds.length > 0) {
        const names = missingWorksiteIds.map((id) => worksiteNameById.get(id) ?? id)
        issues.push({
          activityId: activity.id, n: activity.n, activity: activity.activity, status: "decision_required",
          reason: `Se mide por cobertura sin fuente automática y falta definir un padrón manual positivo en: ${names.join(", ")}.`,
        })
      }
    }
  }

  return issues
}
