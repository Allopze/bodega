import { eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { buildPdtpProgramContentSnapshot } from "./content-digest"
import { getPdtpTemplateVersion } from "./templates"

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

function scheduleKey(row: RecordValue) {
  return `${row.activityNumber}:${row.month}:${row.week}`
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

/** Compara contra la revisión exacta fijada al crear el programa, nunca contra
 * la Base vigente actual (que puede haber publicado revisiones posteriores). */
export async function comparePdtpProgramToSourceBase(programId: string): Promise<PdtpBaseComparison | null> {
  const [program] = await db.select({
    sourceTemplateVersionId: pdtpPrograms.sourceTemplateVersionId,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program?.sourceTemplateVersionId) return null

  const sourceVersion = await getPdtpTemplateVersion(program.sourceTemplateVersionId)
  if (!sourceVersion) return null
  const current = await buildPdtpProgramContentSnapshot(programId) as RecordValue
  const source = sourceVersion.snapshotJson as RecordValue

  const currentActivities = records(current.activities)
  const sourceActivities = records(source.activities)
  const currentByNumber = recordMap(currentActivities, (row) => String(row.n))
  const sourceByNumber = recordMap(sourceActivities, (row) => String(row.n))
  let modifiedActivities = 0
  for (const [number, activity] of currentByNumber) {
    const original = sourceByNumber.get(number)
    if (original && JSON.stringify(activityComparable(activity)) !== JSON.stringify(activityComparable(original))) {
      modifiedActivities += 1
    }
  }

  const currentSchedule = recordMap(records(current.schedules), scheduleKey)
  const sourceSchedule = recordMap(records(source.schedules), scheduleKey)
  const scheduleKeys = new Set([...currentSchedule.keys(), ...sourceSchedule.keys()])
  let scheduleCellsChanged = 0
  for (const key of scheduleKeys) {
    const currentCell = currentSchedule.get(key)
    const sourceCell = sourceSchedule.get(key)
    if (!currentCell || !sourceCell || currentCell.plannedQuantity !== sourceCell.plannedQuantity) {
      scheduleCellsChanged += 1
    }
  }

  const adjustmentPairs = new Set([
    ...records(current.activityWorksiteAdjustments).map((row) => `${row.activityNumber}:${row.worksiteId}`),
    ...records(current.activityScheduleOverrides).map((row) => `${row.activityNumber}:${row.worksiteId}`),
  ])

  return {
    sourceTemplateVersionId: sourceVersion.id,
    sourceRevision: sourceVersion.version,
    sourceDigest: sourceVersion.contentDigest,
    addedActivities: [...currentByNumber.keys()].filter((number) => !sourceByNumber.has(number)).length,
    missingActivities: [...sourceByNumber.keys()].filter((number) => !currentByNumber.has(number)).length,
    modifiedActivities,
    retiredActivities: currentActivities.filter((activity) => activity.status === "retired").length,
    scheduleCellsChanged,
    worksiteAdjustments: adjustmentPairs.size,
    worksiteExclusions: records(current.activityWorksiteExclusions).length,
  }
}
