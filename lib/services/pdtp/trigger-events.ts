import { eq, or } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpActivities, pdtpPrograms, pdtpTriggerEvents } from "@/db/schema"
import { createPdtpObligation } from "./obligations"
import { getPdtpExecutionConnector } from "./connectors"
import type { PdtpScheduleDefinition } from "./schedule-definition"
import { logger } from "@/lib/logger"

type QueryClient = Tx | DB

export function pdtpTriggerEventIdempotencyKey(input: {
  connectorKey: string
  eventKey: string
  sourceType: string
  sourceId: string
  worksiteId: string
}): string {
  return `pdtp-trigger:${input.connectorKey}:${input.eventKey}:${input.sourceType}:${input.sourceId}:${input.worksiteId}`
}

export function assertPdtpTriggerEventSupported(connectorKey: string, eventKey: string): void {
  const connector = getPdtpExecutionConnector(connectorKey)
  if (!connector) throw new Error(`El conector de evento ${connectorKey} no está registrado.`)
  if (!connector.supportedEvents.some((event) => event.key === eventKey)) {
    throw new Error(`El evento ${eventKey} no está soportado por el conector ${connector.label}.`)
  }
}

function assertPdtpTriggerSourceType(connectorKey: string, eventKey: string, sourceType: string): void {
  const connector = getPdtpExecutionConnector(connectorKey)
  const event = connector?.supportedEvents.find((candidate) => candidate.key === eventKey)
  if (!event || event.sourceType !== sourceType) {
    throw new Error(`El tipo de fuente ${sourceType} no corresponde al evento ${eventKey}.`)
  }
}

export type PdtpTriggerEventInput = {
  connectorKey: string
  eventKey: string
  sourceType: string
  sourceId: string
  worksiteId: string
  occurredAt: string
  payload?: Record<string, unknown>
  client?: QueryClient
}

export async function recordPdtpTriggerEvent(input: PdtpTriggerEventInput): Promise<{ event: typeof pdtpTriggerEvents.$inferSelect; created: boolean }> {
  assertPdtpTriggerEventSupported(input.connectorKey, input.eventKey)
  assertPdtpTriggerSourceType(input.connectorKey, input.eventKey, input.sourceType)
  const client = input.client ?? db
  const idempotencyKey = pdtpTriggerEventIdempotencyKey(input)
  const [existing] = await client.select().from(pdtpTriggerEvents).where(eq(pdtpTriggerEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (existing) return { event: existing, created: false }
  const now = new Date().toISOString()
  const [created] = await client.insert(pdtpTriggerEvents).values({
    id: `pdtp-trigger-${idempotencyKey.slice("pdtp-trigger:".length).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    connectorKey: input.connectorKey,
    eventKey: input.eventKey,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    worksiteId: input.worksiteId,
    occurredAt: input.occurredAt,
    idempotencyKey,
    payloadJson: input.payload ?? {},
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: pdtpTriggerEvents.idempotencyKey }).returning()
  if (created) return { event: created, created: true }
  const [concurrent] = await client.select().from(pdtpTriggerEvents).where(eq(pdtpTriggerEvents.idempotencyKey, idempotencyKey)).limit(1)
  if (!concurrent) throw new Error("No se pudo registrar ni recuperar el evento disparador.")
  return { event: concurrent, created: false }
}

/**
 * Productores de dominio se ejecutan después de confirmar su propio registro.
 * Un fallo del libro de disparadores debe quedar observable y reintentable sin
 * deshacer ese registro fuente; por eso los adaptadores usan esta envoltura.
 */
export async function recordPdtpTriggerEventSafe(input: PdtpTriggerEventInput): Promise<void> {
  try {
    await recordPdtpTriggerEvent(input)
  } catch (error) {
    logger.warn({ err: error, connectorKey: input.connectorKey, eventKey: input.eventKey, sourceId: input.sourceId }, "[pdtp-trigger-events] No se pudo registrar el evento fuente.")
  }
}

function isScheduleEvent(value: unknown): value is Extract<PdtpScheduleDefinition, { kind: "event" }> {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "event")
}

/**
 * Reconciles durable source events into obligations. It intentionally leaves a
 * matching event pending while its program is not active; activation can then
 * replay the same event without inventing a second occurrence.
 */
export async function reconcilePdtpTriggerEvents(input: { limit?: number; now?: Date } = {}) {
  const limit = Math.min(500, Math.max(1, input.limit ?? 100))
  const events = await db.select().from(pdtpTriggerEvents)
    .where(or(eq(pdtpTriggerEvents.status, "pending"), eq(pdtpTriggerEvents.status, "error")))
    .orderBy(pdtpTriggerEvents.occurredAt)
    .limit(limit)
  if (events.length === 0) return { processed: 0, pending: 0, ignored: 0, errors: 0 }

  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.status, "active"))
  const programs = await db.select({ id: pdtpPrograms.id, status: pdtpPrograms.status }).from(pdtpPrograms)
  const activePrograms = new Set(programs.filter((program) => program.status === "active").map((program) => program.id))
  let processed = 0
  let pending = 0
  let ignored = 0
  let errors = 0

  for (const event of events) {
    const matches = activities.filter((activity) => {
      if (!activePrograms.has(activity.programId)) return false
      const definition = activity.scheduleDefinition
      return isScheduleEvent(definition)
        && definition.triggerConnectorKey === event.connectorKey
        && definition.triggerEventKey === event.eventKey
    })
    const inactiveMatches = activities.some((activity) => {
      const definition = activity.scheduleDefinition
      return isScheduleEvent(definition)
        && definition.triggerConnectorKey === event.connectorKey
        && definition.triggerEventKey === event.eventKey
    })
    if (matches.length === 0) {
      if (inactiveMatches) {
        pending++
        continue
      }
      await db.update(pdtpTriggerEvents).set({ status: "ignored", processedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(pdtpTriggerEvents.id, event.id))
      ignored++
      continue
    }

    try {
      const obligations: string[] = []
      for (const activity of matches) {
        const result = await createPdtpObligation({
          activityId: activity.id,
          worksiteId: event.worksiteId,
          origin: "integration",
          sourceType: event.sourceType,
          sourceId: event.sourceId,
          sourceOccurredAt: event.occurredAt,
          sourceMetadata: { triggerEventId: event.id, connectorKey: event.connectorKey, eventKey: event.eventKey, payload: event.payloadJson },
          userId: null,
          scope: "all",
        })
        obligations.push(result.obligation.id)
      }
      const now = new Date().toISOString()
      await db.update(pdtpTriggerEvents).set({ status: "processed", obligationId: obligations[0] ?? null, processedAt: now, attempts: event.attempts + 1, lastError: null, updatedAt: now }).where(eq(pdtpTriggerEvents.id, event.id))
      processed++
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al reconciliar el evento."
      const isNotReady = /programa.*activo|programas activos|retirada|no admite nuevas obligaciones/i.test(message)
      const now = new Date().toISOString()
      await db.update(pdtpTriggerEvents).set({ status: isNotReady ? "pending" : "error", attempts: event.attempts + 1, lastError: message, updatedAt: now }).where(eq(pdtpTriggerEvents.id, event.id))
      if (isNotReady) pending++
      else errors++
    }
  }
  return { processed, pending, ignored, errors }
}
