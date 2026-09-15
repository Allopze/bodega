import { and, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpAccreditationBindings, pdtpCatalogActivities } from "@/db/schema"
import { nanoid } from "@/lib/id"

export const PDTP_BINDING_EVENT_TYPES = ["execute", "review", "publish", "acknowledge", "close", "complete_drill"] as const
export type PdtpBindingEventType = (typeof PDTP_BINDING_EVENT_TYPES)[number]
type Client = DB | Tx

export async function listPdtpAccreditationBindings(input: {
  sourceType: string
  sourceIds: string[]
}, client: Client = db) {
  if (input.sourceIds.length === 0) return []
  return client.select({
    id: pdtpAccreditationBindings.id,
    sourceType: pdtpAccreditationBindings.sourceType,
    sourceId: pdtpAccreditationBindings.sourceId,
    eventType: pdtpAccreditationBindings.eventType,
    catalogActivityId: pdtpAccreditationBindings.catalogActivityId,
    isActive: pdtpAccreditationBindings.isActive,
  }).from(pdtpAccreditationBindings).where(and(
    eq(pdtpAccreditationBindings.sourceType, input.sourceType),
    inArray(pdtpAccreditationBindings.sourceId, [...new Set(input.sourceIds)]),
  ))
}

export async function resolvePdtpBindingCatalogIds(input: {
  sourceType: string
  sourceId: string
  eventType: PdtpBindingEventType
}, client: Client = db): Promise<string[]> {
  const rows = await client.select({ catalogActivityId: pdtpAccreditationBindings.catalogActivityId })
    .from(pdtpAccreditationBindings)
    .where(and(
      eq(pdtpAccreditationBindings.sourceType, input.sourceType),
      eq(pdtpAccreditationBindings.sourceId, input.sourceId),
      eq(pdtpAccreditationBindings.eventType, input.eventType),
      eq(pdtpAccreditationBindings.isActive, true),
    ))
  return rows.map((row) => row.catalogActivityId)
}

/** Deployment-1 bridge: normalized bindings win; legacy numbers are used only
 * when a source has not been migrated yet. */
export async function resolvePdtpAccreditationTarget(input: {
  sourceType: string
  sourceId: string
  eventType: PdtpBindingEventType
  legacyActivityNumbers?: number[] | null
}, client: Client = db): Promise<{ catalogActivityIds?: string[]; activityNumbers?: number[] }> {
  const catalogActivityIds = await resolvePdtpBindingCatalogIds(input, client)
  if (catalogActivityIds.length > 0) return { catalogActivityIds }
  const activityNumbers = Array.isArray(input.legacyActivityNumbers) ? input.legacyActivityNumbers : []
  return activityNumbers.length > 0 ? { activityNumbers } : {}
}

export async function replacePdtpAccreditationBindings(input: {
  sourceType: string
  sourceId: string
  eventType: PdtpBindingEventType
  catalogActivityIds: string[]
  updatedByUserId?: string
}, client: Client = db) {
  const ids = [...new Set(input.catalogActivityIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length > 0) {
    const existing = await client.select({ id: pdtpCatalogActivities.id }).from(pdtpCatalogActivities)
      .where(inArray(pdtpCatalogActivities.id, ids))
    if (existing.length !== ids.length) throw new Error("Una o más actividades de catálogo no existen.")
    const retired = await client.select({ id: pdtpCatalogActivities.id }).from(pdtpCatalogActivities)
      .where(and(inArray(pdtpCatalogActivities.id, ids), eq(pdtpCatalogActivities.status, "retired")))
    const currentlyLinked = await resolvePdtpBindingCatalogIds(input, client)
    const linked = new Set(currentlyLinked)
    if (retired.some((row) => !linked.has(row.id))) {
      throw new Error("Una actividad retirada no puede seleccionarse nuevamente.")
    }
  }
  const now = new Date().toISOString()
  await client.update(pdtpAccreditationBindings).set({ isActive: false, updatedAt: now }).where(and(
    eq(pdtpAccreditationBindings.sourceType, input.sourceType),
    eq(pdtpAccreditationBindings.sourceId, input.sourceId),
    eq(pdtpAccreditationBindings.eventType, input.eventType),
  ))
  for (const catalogActivityId of ids) {
    await client.insert(pdtpAccreditationBindings).values({
      id: `pdtp-binding-${nanoid()}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: input.eventType,
      catalogActivityId,
      isActive: true,
      createdByUserId: input.updatedByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [pdtpAccreditationBindings.sourceType, pdtpAccreditationBindings.sourceId, pdtpAccreditationBindings.eventType, pdtpAccreditationBindings.catalogActivityId],
      set: { isActive: true, updatedAt: now },
    })
  }
  return ids
}
