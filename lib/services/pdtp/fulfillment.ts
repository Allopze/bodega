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
 *    `lib/services/operational-work-queue.ts` y produce hoy un 404 real
 *    (`/prevencion/constancias` no existe). `resolvePdtpFulfillmentTarget` es
 *    el único lugar que debe decidir eso, para que `/pendientes`, el tablero y
 *    la planilla consuman la misma respuesta.
 *
 * No duplica el motor: `accreditPdtpFromEvent` y `revokePdtpAccreditation`
 * siguen siendo la única escritura en `pdtp_executions`. Esta capa es el
 * libro de intentos alrededor de esas dos funciones.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpCatalogActivities,
  pdtpActivityWorksiteExclusions,
  pdtpActivityWorksiteParams,
  pdtpFulfillmentEvents,
  pdtpFulfillmentEventTargets,
  pdtpResponsibleCatalog,
  permissions,
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionInspectionTemplates,
  pdtpProgramWorksites,
  preventionTrainingCourses,
  rolePermissions,
  roles,
  sstDocumentTypes,
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
import { usablePdtpInstrumentNumbers } from "./instruments"
import { legacyPdtpActivityNumberForCatalogId } from "@/lib/services/pdtp-adapters/catalog-activities-2026"

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
    const now = new Date().toISOString()
    await db.update(pdtpFulfillmentEvents).set({
      status: result.accredited.length > 0 ? "accredited" : "rejected",
      resultJson: result as unknown as Record<string, unknown>,
      programId: input.programId ?? null,
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
 * y produce el 404 de `/prevencion/constancias`. Único lugar que debe decidir
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
  | "config_required"
  | "code_gap"
  | "permission_gap"
  | "decision_required"
  /**
   * El destino de una actividad de enganche declara un permiso que ninguno de
   * sus responsables tiene. **No bloquea**, y no es un descuido: buena parte de
   * estos casos son segregación de deberes, no errores de RBAC —quien redacta
   * el plan de emergencia no es quien lo firma—. Se reporta para que una
   * persona revise la lista y decida cuáles son grants faltantes y cuáles son
   * la norma funcionando. Promoverlo a bloqueante antes de esa revisión es
   * repetir el episodio de la N°84.
   */
  | "destination_review"
  /**
   * El número está declarado —hay plantilla, curso o plan con ese `n`— pero el
   * instrumento no está vigente: la plantilla sigue en `draft`, el curso no
   * tiene ninguna versión `published`, o el plan de emergencia no está
   * `approved`. Declarar no es poder ejecutar: sólo una plantilla `approved` se
   * puede programar o ejecutar, `createTrainingSession` rechaza cualquier curso
   * sin versión `published`, y la N°84 necesita un plan `approved` para poder
   * programar un simulacro.
   *
   * **Bloquea la activación y sólo advierte al enviar a revisión.** Enviar a
   * revisión es sobre el contenido firmado —el catálogo de actividades—;
   * activar es sobre que el programa sea ejecutable. La separación no crea un
   * candado circular: aprobar plantillas, publicar versiones de curso y
   * aprobar planes de emergencia no tocan ninguna tabla `pdtp_*`, así que toda
   * esa configuración puede resolverse entre el envío a revisión y la
   * activación sin invalidar las firmas (`computePdtpProgramContentDigest`
   * sólo lee tablas `pdtp_*`).
   */
  | "instrument_required"

export type PdtpFulfillmentCoverageIssue = {
  n: number
  activity: string
  status: PdtpFulfillmentCoverageStatus
  reason: string
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
async function permissionsByRoleName(client: QueryClient): Promise<Map<string, Set<string>>> {
  const rows = await client.select({ role: roles.name, permission: permissions.name })
    .from(rolePermissions)
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
  const byRole = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byRole.get(row.role) ?? new Set<string>()
    set.add(row.permission)
    byRole.set(row.role, set)
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

/**
 * Números declarados en catálogos **globales**: una plantilla, un curso o un
 * tipo de documento vale para todo el programa.
 *
 * Los dos arreglos de `sst_document_types` se unen a propósito: uno acredita al
 * publicar y el otro por acuse de recibo, pero para "¿tiene destino declarado?"
 * cualquiera de los dos sirve.
 */
async function activityNumbersDeclaredGlobally(client: QueryClient): Promise<Set<number>> {
  const [templates, courses, docTypes] = await Promise.all([
    client.select({ n: preventionInspectionTemplates.pdtpActivityNumbers }).from(preventionInspectionTemplates),
    client.select({ n: preventionTrainingCourses.pdtpActivityNumbers }).from(preventionTrainingCourses),
    client.select({
      n: sstDocumentTypes.pdtpActivityNumbers,
      ack: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers,
    }).from(sstDocumentTypes),
  ])
  const set = new Set<number>()
  for (const row of templates) for (const n of (row.n as number[] | null) ?? []) set.add(n)
  for (const row of courses) for (const n of (row.n as number[] | null) ?? []) set.add(n)
  for (const row of docTypes) {
    for (const n of (row.n as number[] | null) ?? []) set.add(n)
    for (const n of (row.ack as number[] | null) ?? []) set.add(n)
  }
  return set
}

/**
 * Números declarados en registros que existen **por faena**: los planes de
 * emergencia y las campañas.
 *
 * Se cuentan aparte porque un solo plan en una faena no acredita nada en las
 * otras seis. Antes las cinco tablas se leían juntas y globalmente, así que un
 * plan en cualquier parte daba la N°84 por resuelta en todo el programa —
 * exactamente la respuesta que impedía que el informe dijera "no hay plan en la
 * faena X", que es lo único accionable.
 */
async function activityNumbersDeclaredPerWorksite(client: QueryClient): Promise<{
  byNumber: Map<number, Set<string>>
  /** Subconjunto declarado por un plan de emergencia (cualquier estado, no
   *  sólo `approved`). Sirve para que `instrumentIssueFor` nombre el
   *  instrumento correcto cuando ninguna faena tiene uno vigente: sin esto, la
   *  N°84 (que sólo declara plan de emergencia) recibía el mensaje genérico
   *  de plantilla/curso, que le dice al operador que arregle lo que no tiene. */
  planNumbers: Set<number>
}> {
  const [campaigns, plans] = await Promise.all([
    client.select({ n: preventionCampaigns.pdtpActivityNumbers, worksiteId: preventionCampaigns.worksiteId }).from(preventionCampaigns),
    client.select({ n: preventionEmergencyPlans.pdtpActivityNumbers, worksiteId: preventionEmergencyPlans.worksiteId }).from(preventionEmergencyPlans),
  ])
  const byNumber = new Map<number, Set<string>>()
  for (const rows of [campaigns, plans]) {
    for (const row of rows) {
      for (const n of (row.n as number[] | null) ?? []) {
        const set = byNumber.get(n) ?? new Set<string>()
        set.add(row.worksiteId)
        byNumber.set(n, set)
      }
    }
  }
  const planNumbers = new Set<number>()
  for (const row of plans) for (const n of (row.n as number[] | null) ?? []) planNumbers.add(n)
  return { byNumber, planNumbers }
}

/**
 * Faenas contra las que se exige la declaración por faena: las miembros del
 * programa, o todas las activas cuando el programa no declara membresía —que es
 * el mismo criterio con que el motor decide si una faena puede operarlo.
 */
async function programWorksiteIds(client: QueryClient, programId: string): Promise<string[]> {
  const members = await client.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
  if (members.length > 0) return members.map((row) => row.worksiteId)
  const active = await client.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true))
  return active.map((row) => row.id)
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
  activity: { n: number; activity: string },
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
      n: activity.n, activity: activity.activity, status: "config_required",
      reason: `Su número no está declarado en ${missing.length} de las ${applicableWorksiteIds.length} faenas donde aplica: ${names.join(", ")}.`,
    }
  }

  return {
    n: activity.n, activity: activity.activity, status: "config_required",
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
  activity: { n: number; activity: string },
  ctx: {
    usableGlobally: Set<number>
    usablePerWorksite: Map<number, Set<string>>
    worksiteIds: string[]
    worksiteNameById: Map<string, string>
    excludedWorksiteIds: Set<string>
    /** Números declarados por un plan de emergencia (cualquier estado). Ver
     *  `activityNumbersDeclaredPerWorksite`. */
    planNumbers: Set<number>
  },
): PdtpFulfillmentCoverageIssue | null {
  if (STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) return null
  if (ctx.usableGlobally.has(activity.n)) return null

  const applicableWorksiteIds = ctx.worksiteIds.filter((id) => !ctx.excludedWorksiteIds.has(id))
  if (applicableWorksiteIds.length === 0) return null

  const usableWorksites = ctx.usablePerWorksite.get(activity.n)
  if (usableWorksites) {
    const missing = applicableWorksiteIds.filter((id) => !usableWorksites.has(id))
    if (missing.length === 0) return null
    const names = missing.map((id) => ctx.worksiteNameById.get(id) ?? id)
    return {
      n: activity.n, activity: activity.activity, status: "instrument_required",
      reason: `Su plan de emergencia no está aprobado en ${missing.length} de las ${applicableWorksiteIds.length} faenas donde aplica: ${names.join(", ")}.`,
    }
  }

  // Ninguna faena tiene un instrumento vigente (`usablePerWorksite` ni
  // siquiera trae la entrada). Si lo que declaró el número fue un plan de
  // emergencia — el caso de la N°84 —, decirlo: el mensaje genérico de
  // plantilla/curso manda al operador a arreglar lo que no tiene.
  if (ctx.planNumbers.has(activity.n)) {
    return {
      n: activity.n, activity: activity.activity, status: "instrument_required",
      reason: "Su número está declarado en un plan de emergencia, pero ninguna faena donde aplica tiene uno aprobado.",
    }
  }

  return {
    n: activity.n, activity: activity.activity, status: "instrument_required",
    reason: "Su número está declarado, pero su plantilla no tiene una versión aprobada o su curso no tiene ninguna versión publicada.",
  }
}

/**
 * Compuerta que exige, por actividad activa del programa, un destino externo
 * declarado y verificable. Se llama desde `pdtpSubmitReviewBlockers` y desde
 * `activatePdtpProgram`: no debe volver a ser posible activar un programa que
 * promete trabajo sin ofrecer dónde realizarlo.
 *
 * Devuelve la lista de problemas encontrados (vacía = compuerta pasada). No
 * lanza: el llamador decide si un problema bloquea o sólo se muestra.
 */
export async function assertPdtpFulfillmentCoverage(programId: string, client: QueryClient = db): Promise<PdtpFulfillmentCoverageIssue[]> {
  const activities = await client.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active")))
  if (activities.length === 0) return []

  const activityIds = activities.map((activity) => activity.id)
  const [
    declaredGlobally,
    { byNumber: declaredPerWorksite, planNumbers },
    { global: usableGlobally, perWorksite: usablePerWorksite },
    worksiteIds,
    worksiteRows,
    responsibleRows,
    permissionsByRole,
    excludedByActivity,
    manualSubjectRows,
  ] = await Promise.all([
    activityNumbersDeclaredGlobally(client),
    activityNumbersDeclaredPerWorksite(client),
    usablePdtpInstrumentNumbers(client),
    programWorksiteIds(client, programId),
    client.select({ id: worksites.id, name: worksites.name }).from(worksites),
    client.select().from(pdtpResponsibleCatalog),
    permissionsByRoleName(client),
    excludedWorksitesByActivity(client, activityIds),
    client.select({
      activityId: pdtpActivityWorksiteParams.activityId,
      worksiteId: pdtpActivityWorksiteParams.worksiteId,
      expectedSubjectCount: pdtpActivityWorksiteParams.expectedSubjectCount,
    }).from(pdtpActivityWorksiteParams).where(inArray(pdtpActivityWorksiteParams.activityId, activityIds)),
  ])
  const worksiteNameById = new Map(worksiteRows.map((row) => [row.id, row.name]))
  const roleBySlug = new Map(responsibleRows.map((row) => [row.slug, row.roleName ?? row.operatedByRoleName]))
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
        n: activity.n, activity: activity.activity, status: "permission_gap",
        reason: "Ninguno de sus responsables declarados mapea a un rol RBAC real ni a un operador de plataforma.",
      })
      continue
    }

    if (activity.mechanism === "sin_definir") {
      issues.push({ n: activity.n, activity: activity.activity, status: "code_gap", reason: "Sin mecanismo de acreditación clasificado." })
      continue
    }

    // Que el responsable exista como rol no basta: ese rol tiene que poder
    // entrar a donde el trabajo se registra. Antes la compuerta se quedaba en
    // el mapeo, así que una actividad pasaba con un responsable que abría la
    // tarjeta en /pendientes y se encontraba con un 403.
    const requiredPermission = destinationPermissionFor(activity.mechanism)
    if (requiredPermission && !roles.some((role) => permissionsByRole.get(role)?.has(requiredPermission))) {
      issues.push({
        n: activity.n, activity: activity.activity, status: "permission_gap",
        reason: `Ninguno de sus responsables (${roles.join(", ")}) tiene ${requiredPermission}, el permiso del módulo donde se registra.`,
      })
      continue
    }

    if (activity.mechanism === "constancia" && !activity.evidenceRequirement?.trim()) {
      issues.push({ n: activity.n, activity: activity.activity, status: "config_required", reason: "Es constancia y no declara evidencia mínima." })
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
          usableGlobally, usablePerWorksite, worksiteIds, worksiteNameById, planNumbers,
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
        n: activity.n, activity: activity.activity, status: "code_gap",
        reason: "No tiene un destino operativo concreto: todavía cae a la planilla genérica del PDTP.",
      })
      continue
    }

    // Destino conocido: se **reporta**, no se bloquea. El mapa es nuevo y buena
    // parte de lo que encuentra es segregación de deberes —quien redacta el plan
    // de emergencia no es quien lo firma—, no grants que falten. Va después de
    // la verificación de cableado: una actividad sin destino declarado ya salió
    // como `config_required` y repetirlo sería ruido.
    //
    // `compuesta` entra acá igual que `enganche`, y es la tercera vez que hay
    // que decir lo mismo: la exención de `compuesta` se razonó una sola vez, para
    // el chequeo de PERMISO de la planilla —nadie la ejecuta, se cumple cuando
    // sus componentes cierran— y después se arrastró al chequeo de cableado (ya
    // corregido) y a éste. Acá tampoco aplica: la N°15, la N°18, la N°23 y la
    // N°52 se acreditan al cerrar el acta de trabajador nuevo, que exige
    // `sst:close`, y ninguno de sus responsables lo tiene. Que nadie la "ejecute"
    // no significa que su acto acreditador no tenga dueño.
    if (activity.mechanism === "enganche" || activity.mechanism === "compuesta") {
      const destination = engancheDestinationPermissionFor(activity.n)
      if (destination && !roles.some((role) => permissionsByRole.get(role)?.has(destination.permission))) {
        issues.push({
          n: activity.n, activity: activity.activity, status: "destination_review",
          reason: `Se cumple en ${destination.module} y ninguno de sus responsables (${roles.join(", ")}) tiene ${destination.permission}.`,
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
          n: activity.n, activity: activity.activity, status: "decision_required",
          reason: `Se mide por cobertura sin fuente automática y falta definir un padrón manual positivo en: ${names.join(", ")}.`,
        })
      }
    }
  }

  return issues
}
