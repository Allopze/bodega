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

function scheduleKey(row: RecordValue) {
  return `${row.activityNumber}:${row.month}:${row.week}`
}

function activityIdentity(row: RecordValue) {
  return typeof row.catalogActivityId === "string" && row.catalogActivityId
    ? `catalog:${row.catalogActivityId}`
    : `number:${String(row.n)}`
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
  const currentByNumber = recordMap(currentActivities, (row) => String(row.n))
  const sourceByNumber = recordMap(sourceActivities, (row) => String(row.n))
  let modifiedActivities = 0
  for (const [number, activity] of currentByNumber) {
    const original = sourceByNumber.get(number)
    if (original && JSON.stringify(activityComparable(activity)) !== JSON.stringify(activityComparable(original))) modifiedActivities += 1
  }

  const currentSchedule = recordMap(records(input.current.schedules), scheduleKey)
  const sourceSchedule = recordMap(records(input.source.schedules), scheduleKey)
  const scheduleKeys = new Set([...currentSchedule.keys(), ...sourceSchedule.keys()])
  let scheduleCellsChanged = 0
  for (const key of scheduleKeys) {
    const currentCell = currentSchedule.get(key)
    const sourceCell = sourceSchedule.get(key)
    if (!currentCell || !sourceCell || currentCell.plannedQuantity !== sourceCell.plannedQuantity) scheduleCellsChanged += 1
  }

  const adjustmentPairs = new Set([
    ...records(input.current.activityWorksiteAdjustments).map((row) => `${row.activityNumber}:${row.worksiteId}`),
    ...records(input.current.activityScheduleOverrides).map((row) => `${row.activityNumber}:${row.worksiteId}`),
    ...records(input.source.activityWorksiteAdjustments).map((row) => `${row.activityNumber}:${row.worksiteId}`),
    ...records(input.source.activityScheduleOverrides).map((row) => `${row.activityNumber}:${row.worksiteId}`),
  ])
  return {
    sourceTemplateVersionId: input.sourceTemplateVersionId,
    sourceRevision: input.sourceRevision,
    sourceDigest: input.sourceDigest,
    addedActivities: [...currentByNumber.keys()].filter((number) => !sourceByNumber.has(number)).length,
    missingActivities: [...sourceByNumber.keys()].filter((number) => !currentByNumber.has(number)).length,
    modifiedActivities,
    retiredActivities: currentActivities.filter((activity) => activity.status === "retired").length,
    scheduleCellsChanged,
    worksiteAdjustments: adjustmentPairs.size,
    worksiteExclusions: records(input.current.activityWorksiteExclusions).length,
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
  const currentByIdentity = recordMap(records(current.activities), activityIdentity)
  const sourceByIdentity = recordMap(records(source.activities), activityIdentity)
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
