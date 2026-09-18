import { eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { buildPdtpProgramContentSnapshot } from "./content-digest"
import { getCurrentPdtpBase2026Version, getPdtpTemplateVersion } from "./templates"

type RecordValue = Record<string, unknown>

function records(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.filter((item): item is RecordValue => typeof item === "object" && item !== null)
    : []
}

function recordMap(rows: RecordValue[], key: (row: RecordValue) => string) {
  return new Map(rows.map((row) => [key(row), row]))
}

function canonicalRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRecord)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalRecord(item)]),
  )
}

function changedRowCount(
  currentRows: RecordValue[],
  sourceRows: RecordValue[],
  currentKey: (row: RecordValue) => string,
  sourceKey: (row: RecordValue) => string = currentKey,
  projection: (row: RecordValue) => unknown = (row) => row,
) {
  const current = new Map(currentRows.map((row) => [currentKey(row), JSON.stringify(canonicalRecord(projection(row)))]))
  const source = new Map(sourceRows.map((row) => [sourceKey(row), JSON.stringify(canonicalRecord(projection(row)))]))
  const keys = new Set([...current.keys(), ...source.keys()])
  return [...keys].filter((rowKey) => current.get(rowKey) !== source.get(rowKey)).length
}

function changedSharedRowCount(
  currentRows: RecordValue[],
  sourceRows: RecordValue[],
  currentKey: (row: RecordValue) => string,
  projection: (row: RecordValue) => unknown,
  sourceKey: (row: RecordValue) => string = currentKey,
) {
  const current = recordMap(currentRows, currentKey)
  const source = recordMap(sourceRows, sourceKey)
  return [...current.keys()]
    .filter((rowKey) => source.has(rowKey))
    .filter((rowKey) => JSON.stringify(canonicalRecord(projection(current.get(rowKey)!)))
      !== JSON.stringify(canonicalRecord(projection(source.get(rowKey)!)))).length
}

function activityComparable(activity: RecordValue) {
  const {
    status: _status,
    retiredReason: _retiredReason,
    retiredEffectiveFrom: _retiredEffectiveFrom,
    retiredByUserId: _retiredByUserId,
    retiredAt: _retiredAt,
    ...content
  } = activity
  return content
}

function revisionActivityComparable(activity: RecordValue) {
  return activity
}

function snapshotSchemaVersion(snapshot: RecordValue) {
  return typeof snapshot.schemaVersion === "number" && Number.isInteger(snapshot.schemaVersion)
    ? snapshot.schemaVersion
    : undefined
}

type PairedActivityIdentityMaps = {
  current: Map<string, RecordValue>
  source: Map<string, RecordValue>
  currentByNumber: Map<string, string>
  sourceByNumber: Map<string, string>
}

/**
 * A snapshot may predate the catalog identity columns. When exactly one side
 * has `catalogActivityId`, fall back to the shared activity number so the
 * comparison keeps the same activity instead of reporting a false add/remove.
 * If both sides have different catalog identities, the difference is real and
 * remains an add/remove pair.
 */
function pairedActivityIdentityMaps(currentSnapshot: RecordValue, sourceSnapshot: RecordValue): PairedActivityIdentityMaps {
  const currentActivities = records(currentSnapshot.activities)
  const sourceActivities = records(sourceSnapshot.activities)
  const currentByNumber = new Map(currentActivities.map((activity) => [String(activity.n), activity]))
  const sourceByNumber = new Map(sourceActivities.map((activity) => [String(activity.n), activity]))
  const currentByCatalog = new Map(currentActivities
    .filter((activity) => typeof activity.catalogActivityId === "string" && activity.catalogActivityId)
    .map((activity) => [String(activity.catalogActivityId), activity]))
  const sourceByCatalog = new Map(sourceActivities
    .filter((activity) => typeof activity.catalogActivityId === "string" && activity.catalogActivityId)
    .map((activity) => [String(activity.catalogActivityId), activity]))

  function identityFor(activity: RecordValue, counterpartByNumber: Map<string, RecordValue>, counterpartByCatalog: Map<string, RecordValue>) {
    const catalogId = typeof activity.catalogActivityId === "string" && activity.catalogActivityId
      ? activity.catalogActivityId
      : null
    if (!catalogId) return `number:${String(activity.n)}`
    if (counterpartByCatalog.has(catalogId)) return `catalog:${catalogId}`
    const counterpart = counterpartByNumber.get(String(activity.n))
    if (counterpart && !(typeof counterpart.catalogActivityId === "string" && counterpart.catalogActivityId)) {
      return `number:${String(activity.n)}`
    }
    return `catalog:${catalogId}`
  }

  const currentIdentityByNumber = new Map(currentActivities.map((activity) => [
    String(activity.n), identityFor(activity, sourceByNumber, sourceByCatalog),
  ]))
  const sourceIdentityByNumber = new Map(sourceActivities.map((activity) => [
    String(activity.n), identityFor(activity, currentByNumber, currentByCatalog),
  ]))
  return {
    current: recordMap(currentActivities, (activity) => currentIdentityByNumber.get(String(activity.n))!),
    source: recordMap(sourceActivities, (activity) => sourceIdentityByNumber.get(String(activity.n))!),
    currentByNumber: currentIdentityByNumber,
    sourceByNumber: sourceIdentityByNumber,
  }
}

function rowActivityIdentity(activityByNumber: Map<string, string>, row: RecordValue) {
  const number = String(row.activityNumber)
  return activityByNumber.get(number) ?? `number:${number}`
}

function activityIdentityForNumber(activityByNumber: Map<string, string>, row: RecordValue) {
  const number = String(row.n)
  return activityByNumber.get(number) ?? `number:${number}`
}

function scheduleKey(activityByNumber: Map<string, string>, row: RecordValue) {
  return `${rowActivityIdentity(activityByNumber, row)}:${row.year ?? ""}:${row.month}:${row.week}`
}

function worksiteAdjustmentKey(activityByNumber: Map<string, string>, row: RecordValue) {
  return `${rowActivityIdentity(activityByNumber, row)}:${row.worksiteId}`
}

function scheduleOverrideKey(activityByNumber: Map<string, string>, row: RecordValue) {
  return `${rowActivityIdentity(activityByNumber, row)}:${row.worksiteId}:${row.year}:${row.month}:${row.week}`
}

function worksiteExclusionKey(activityByNumber: Map<string, string>, row: RecordValue) {
  return `${rowActivityIdentity(activityByNumber, row)}:${row.worksiteId}`
}

function retirementProjection(activity: RecordValue) {
  return {
    status: activity.status ?? null,
    retiredReason: activity.retiredReason ?? null,
    retiredEffectiveFrom: activity.retiredEffectiveFrom ?? null,
    retiredByUserId: activity.retiredByUserId ?? null,
    retiredAt: activity.retiredAt ?? null,
  }
}

function rowContentWithoutActivityNumber(row: RecordValue) {
  const { activityNumber: _activityNumber, ...content } = row
  return content
}

function activityIdentity(row: RecordValue) {
  return typeof row.catalogActivityId === "string" && row.catalogActivityId
    ? `catalog:${row.catalogActivityId}`
    : `number:${String(row.n)}`
}

export function pdtpActivityIdentityMatches(activity: RecordValue, identity: string) {
  if (identity.startsWith("number:")) return String(activity.n) === identity.slice("number:".length)
  return activityIdentity(activity) === identity
}

export type PdtpBaseComparison = {
  sourceTemplateVersionId: string
  sourceRevision: number
  sourceDigest: string
  addedActivities: number
  missingActivities: number
  modifiedActivities: number
  retiredActivities: number
  scheduleCellsChanged: number
  worksiteAdjustments: number
  worksiteExclusions: number
}

export type PdtpRevisionDiff = PdtpBaseComparison & {
  /** Siempre es la Base preventiva vigente, no la foto usada al crear v1. */
  comparedTo: "current_base"
  baseTemplateVersionId: string
  items: Array<{
    identity: string
    activityNumber: number | null
    kind: "only_in_revision" | "only_in_base" | "content_changed" | "catalog_revision_changed"
    changedSections?: string[]
  }>
}

function rowsForActivity(snapshot: RecordValue, key: string, activityNumber: number) {
  return records(snapshot[key]).filter((row) => row.activityNumber === activityNumber)
}

function activityRevisionSections(snapshot: RecordValue, activity: RecordValue) {
  const activityNumber = typeof activity.n === "number" ? activity.n : null
  if (activityNumber === null) return { activity: revisionActivityComparable(activity) }
  return {
    activity: revisionActivityComparable(activity),
    schedules: rowsForActivity(snapshot, "schedules", activityNumber),
    memberships: rowsForActivity(snapshot, "memberships", activityNumber),
    checklists: rowsForActivity(snapshot, "checklists", activityNumber),
    sourceLinks: rowsForActivity(snapshot, "sourceLinks", activityNumber),
    exclusions: rowsForActivity(snapshot, "activityWorksiteExclusions", activityNumber),
    executorAssignments: rowsForActivity(snapshot, "executorAssignments", activityNumber),
    worksiteAdjustments: rowsForActivity(snapshot, "activityWorksiteAdjustments", activityNumber),
    scheduleOverrides: rowsForActivity(snapshot, "activityScheduleOverrides", activityNumber),
  }
}

function changedSections(current: RecordValue, source: RecordValue, activity: RecordValue, baseActivity: RecordValue) {
  const currentSections = activityRevisionSections(current, activity)
  const sourceSections = activityRevisionSections(source, baseActivity)
  return Object.keys(currentSections).filter((section) => (
    JSON.stringify(currentSections[section as keyof typeof currentSections])
      !== JSON.stringify(sourceSections[section as keyof typeof sourceSections])
  ))
}

function compareSnapshots(input: {
  current: RecordValue
  source: RecordValue
  sourceTemplateVersionId: string
  sourceRevision: number
  sourceDigest: string
}): PdtpBaseComparison {
  const currentActivities = records(input.current.activities)
  const sourceActivities = records(input.source.activities)
  const activityIdentities = pairedActivityIdentityMaps(input.current, input.source)
  const currentByIdentity = activityIdentities.current
  const sourceByIdentity = activityIdentities.source
  const currentActivityIdentityByNumber = activityIdentities.currentByNumber
  const sourceActivityIdentityByNumber = activityIdentities.sourceByNumber
  let modifiedActivities = 0
  for (const [identity, activity] of currentByIdentity) {
    const original = sourceByIdentity.get(identity)
    if (original && JSON.stringify(activityComparable(activity)) !== JSON.stringify(activityComparable(original))) modifiedActivities += 1
  }

  const currentSchedule = recordMap(records(input.current.schedules), (row) => scheduleKey(currentActivityIdentityByNumber, row))
  const sourceSchedule = recordMap(records(input.source.schedules), (row) => scheduleKey(sourceActivityIdentityByNumber, row))
  const scheduleKeys = new Set([...currentSchedule.keys(), ...sourceSchedule.keys()])
  let scheduleCellsChanged = 0
  for (const key of scheduleKeys) {
    const currentCell = currentSchedule.get(key)
    const sourceCell = sourceSchedule.get(key)
    if (!currentCell || !sourceCell || currentCell.plannedQuantity !== sourceCell.plannedQuantity) scheduleCellsChanged += 1
  }

  const currentAdjustments = records(input.current.activityWorksiteAdjustments)
  const sourceAdjustments = records(input.source.activityWorksiteAdjustments)
  const currentOverrides = records(input.current.activityScheduleOverrides)
  const sourceOverrides = records(input.source.activityScheduleOverrides)
  const currentExclusions = records(input.current.activityWorksiteExclusions)
  const sourceExclusions = records(input.source.activityWorksiteExclusions)
  return {
    sourceTemplateVersionId: input.sourceTemplateVersionId,
    sourceRevision: input.sourceRevision,
    sourceDigest: input.sourceDigest,
    addedActivities: [...currentByIdentity.keys()].filter((identity) => !sourceByIdentity.has(identity)).length,
    missingActivities: [...sourceByIdentity.keys()].filter((identity) => !currentByIdentity.has(identity)).length,
    modifiedActivities,
    // Only a retirement transition or its reason is a change. Counting every
    // currently retired row made an untouched Base look divergent.
    retiredActivities: changedSharedRowCount(
      currentActivities,
      sourceActivities,
      (row) => activityIdentityForNumber(activityIdentities.currentByNumber, row),
      retirementProjection,
      (row) => activityIdentityForNumber(activityIdentities.sourceByNumber, row),
    ),
    scheduleCellsChanged,
    // Additions/removals and edited values are all real deltas. Keep the two
    // dimensions separate in their keys so a schedule override cannot mask a
    // parameter change for the same activity/faena pair.
    worksiteAdjustments: changedRowCount(
      currentAdjustments,
      sourceAdjustments,
      (row) => worksiteAdjustmentKey(currentActivityIdentityByNumber, row),
      (row) => worksiteAdjustmentKey(sourceActivityIdentityByNumber, row),
      rowContentWithoutActivityNumber,
    ) + changedRowCount(
      currentOverrides,
      sourceOverrides,
      (row) => scheduleOverrideKey(currentActivityIdentityByNumber, row),
      (row) => scheduleOverrideKey(sourceActivityIdentityByNumber, row),
      rowContentWithoutActivityNumber,
    ),
    worksiteExclusions: changedRowCount(
      currentExclusions,
      sourceExclusions,
      (row) => worksiteExclusionKey(currentActivityIdentityByNumber, row),
      (row) => worksiteExclusionKey(sourceActivityIdentityByNumber, row),
      rowContentWithoutActivityNumber,
    ),
  }
}

/** Compara contra la revisión exacta fijada al crear el programa, nunca contra
 * la Base vigente actual (que puede haber publicado revisiones posteriores). */
export async function comparePdtpProgramToSourceBase(programId: string): Promise<PdtpBaseComparison | null> {
  const [program] = await db.select({
    sourceTemplateVersionId: pdtpPrograms.sourceTemplateVersionId,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program?.sourceTemplateVersionId) return null

  const sourceVersion = await getPdtpTemplateVersion(program.sourceTemplateVersionId)
  if (!sourceVersion) return null
  const source = sourceVersion.snapshotJson as RecordValue
  const current = await buildPdtpProgramContentSnapshot(programId, undefined, {
    schemaVersion: snapshotSchemaVersion(source),
  }) as RecordValue

  return compareSnapshots({
    current,
    source,
    sourceTemplateVersionId: sourceVersion.id,
    sourceRevision: sourceVersion.version,
    sourceDigest: sourceVersion.contentDigest,
  })
}

/**
 * Diferencias de una revisión contra la Base vigente por identidad de
 * catálogo (con caída al número legado). Sólo observa: ninguna novedad de la
 * Base se aplica al programa sin que el operador la confirme en el editor.
 */
export async function comparePdtpRevisionToCurrentBase(programId: string): Promise<PdtpRevisionDiff | null> {
  const base = await getCurrentPdtpBase2026Version()
  if (!base) return null
  const source = base.version.snapshotJson as RecordValue
  const current = await buildPdtpProgramContentSnapshot(programId, undefined, {
    schemaVersion: snapshotSchemaVersion(source),
  }) as RecordValue
  const summary = compareSnapshots({
    current,
    source,
    sourceTemplateVersionId: base.version.id,
    sourceRevision: base.version.version,
    sourceDigest: base.version.contentDigest,
  })
  const activityIdentities = pairedActivityIdentityMaps(current, source)
  const currentByIdentity = activityIdentities.current
  const sourceByIdentity = activityIdentities.source
  const items: PdtpRevisionDiff["items"] = []
  for (const [identity, activity] of currentByIdentity) {
    const baseActivity = sourceByIdentity.get(identity)
    if (!baseActivity) {
      items.push({ identity, activityNumber: typeof activity.n === "number" ? activity.n : null, kind: "only_in_revision" })
      continue
    }
    if (activity.catalogRevision !== baseActivity.catalogRevision) {
      items.push({ identity, activityNumber: typeof activity.n === "number" ? activity.n : null, kind: "catalog_revision_changed" })
    } else {
      const sections = changedSections(current, source, activity, baseActivity)
      if (sections.length > 0) {
        items.push({
          identity,
          activityNumber: typeof activity.n === "number" ? activity.n : null,
          kind: "content_changed",
          changedSections: sections,
        })
      }
    }
  }
  for (const [identity, activity] of sourceByIdentity) {
    if (!currentByIdentity.has(identity)) {
      items.push({ identity, activityNumber: typeof activity.n === "number" ? activity.n : null, kind: "only_in_base" })
    }
  }
  return {
    ...summary,
    comparedTo: "current_base",
    baseTemplateVersionId: base.version.id,
    items: items.sort((a, b) => (a.activityNumber ?? Number.MAX_SAFE_INTEGER) - (b.activityNumber ?? Number.MAX_SAFE_INTEGER)),
  }
}
