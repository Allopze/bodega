import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpAccreditationBindings,
  pdtpActivities,
  pdtpActivityExecutionConfigs,
  pdtpExecutions,
  pdtpScheduledInstances,
} from "@/db/schema"

const apply = process.argv.includes("--apply")
const now = new Date().toISOString()

/** Vínculos históricos que tienen un destino operativo real equivalente. */
const CONNECTOR_BY_BINDING_SOURCE: Record<string, string> = {
  inspeccion: "inspections",
  capacitacion: "training",
  capacitacion_ocurrencia: "training",
  documento: "documentation",
  campana: "campaigns",
  emergencia: "emergencies",
}

async function main() {
  const [activities, bindings, configured, scheduledInstances, submittedExecutions] = await Promise.all([
    db.select({
      id: pdtpActivities.id,
      catalogActivityId: pdtpActivities.catalogActivityId,
      scheduleDefinition: pdtpActivities.scheduleDefinition,
      status: pdtpActivities.status,
    }).from(pdtpActivities),
    db.select({
      id: pdtpAccreditationBindings.id,
      sourceType: pdtpAccreditationBindings.sourceType,
      catalogActivityId: pdtpAccreditationBindings.catalogActivityId,
      isActive: pdtpAccreditationBindings.isActive,
    }).from(pdtpAccreditationBindings),
    db.select({ activityId: pdtpActivityExecutionConfigs.activityId }).from(pdtpActivityExecutionConfigs),
    db.select({
      activityId: pdtpScheduledInstances.activityId,
      worksiteId: pdtpScheduledInstances.worksiteId,
      scheduledFor: pdtpScheduledInstances.scheduledFor,
      idempotencyKey: pdtpScheduledInstances.idempotencyKey,
    }).from(pdtpScheduledInstances),
    db.select({ id: pdtpExecutions.id }).from(pdtpExecutions).where(eq(pdtpExecutions.status, "submitted")),
  ])

  const duplicateValues = (values: string[]) => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) duplicates.add(value)
      seen.add(value)
    }
    return [...duplicates].sort()
  }
  const naturalInstanceKeys = scheduledInstances.map((row) => [
    row.activityId,
    row.worksiteId,
    String(row.scheduledFor),
  ].join("|"))
  const duplicateNaturalInstanceKeys = duplicateValues(naturalInstanceKeys)
  const duplicateIdempotencyKeys = duplicateValues(scheduledInstances.map((row) => row.idempotencyKey))

  const legacyGridActivityIds = activities
    .filter((activity) => activity.scheduleDefinition == null)
    .map((activity) => activity.id)
  const configuredIds = new Set(configured.map((row) => row.activityId))
  const executionConfigs: Array<{
    id: string
    activityId: string
    destinationConnectorKey: string
    accreditationBindingId: string
    completionPolicy: "source_completed"
    evidenceRequired: boolean
    acceptedEvidenceKinds: string[]
    createdAt: string
    updatedAt: string
  }> = []
  const ambiguousBindings: string[] = []
  const unboundCatalogActivities: string[] = []

  for (const activity of activities) {
    if (activity.status !== "active" || !activity.catalogActivityId || configuredIds.has(activity.id)) continue
    const matches = bindings
      .filter((binding) => binding.isActive && binding.catalogActivityId === activity.catalogActivityId)
      .map((binding) => ({ binding, connectorKey: CONNECTOR_BY_BINDING_SOURCE[binding.sourceType] }))
      .filter((match): match is { binding: (typeof bindings)[number]; connectorKey: string } => Boolean(match.connectorKey))
    const byConnector = new Map<string, typeof matches[number][]>()
    for (const match of matches) byConnector.set(match.connectorKey, [...(byConnector.get(match.connectorKey) ?? []), match])
    if (byConnector.size === 0) {
      unboundCatalogActivities.push(activity.id)
      continue
    }
    if (byConnector.size !== 1 || [...byConnector.values()][0]!.length !== 1) {
      ambiguousBindings.push(activity.id)
      continue
    }
    const match = [...byConnector.values()][0]![0]!
    executionConfigs.push({
      id: `pdtp-exec-config-${activity.id}`,
      activityId: activity.id,
      destinationConnectorKey: match.connectorKey,
      accreditationBindingId: match.binding.id,
      completionPolicy: "source_completed",
      evidenceRequired: false,
      acceptedEvidenceKinds: ["generated_record"],
      createdAt: now,
      updatedAt: now,
    })
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    legacyGridActivities: legacyGridActivityIds.length,
    executionConfigs: executionConfigs.length,
    existingScheduledInstances: scheduledInstances.length,
    duplicateNaturalInstanceKeys,
    duplicateIdempotencyKeys,
    submittedExecutionsPreserved: submittedExecutions.length,
    ambiguousBindings,
    unboundCatalogActivities,
  }

  if (apply) {
    await db.transaction(async (tx) => {
      if (legacyGridActivityIds.length > 0) {
        await tx.update(pdtpActivities)
          .set({ scheduleDefinition: { version: 1, kind: "legacy_grid" }, updatedAt: now })
          .where(and(inArray(pdtpActivities.id, legacyGridActivityIds), isNull(pdtpActivities.scheduleDefinition)))
      }
      if (executionConfigs.length > 0) {
        await tx.insert(pdtpActivityExecutionConfigs).values(executionConfigs)
          .onConflictDoNothing({ target: pdtpActivityExecutionConfigs.activityId })
      }
    })
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
