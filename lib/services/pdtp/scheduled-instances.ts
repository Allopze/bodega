import { createHash } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteAssignees,
  pdtpActivityWorksiteExclusions,
  pdtpProgramWorksites,
  pdtpPrograms,
  pdtpScheduledInstances,
  worksites,
  type NewPdtpScheduledInstance,
} from "@/db/schema"
import { expandPdtpScheduleDefinition, type PdtpScheduleDefinition } from "./schedule-definition"
import { codeYear } from "@/lib/utils"

type ProgramPeriod = {
  id: string
  year?: number
  periodStart?: string | null
  periodEnd?: string | null
}

type ActivityScheduleInput = {
  id: string
  programId: string
  scheduleDefinition: PdtpScheduleDefinition | null
  responsibleSlugs: unknown
}

export type PdtpScheduledInstanceSeed = Pick<NewPdtpScheduledInstance,
  "id" | "programId" | "activityId" | "worksiteId" | "scheduledFor" | "isoWeekYear" | "isoWeek" |
  "plannedQuantity" | "status" | "responsibleSlug" | "responsibleUserId" | "responsibleRoleSnapshot" | "idempotencyKey" | "sourceMetadataJson"
>

function stableId(activityId: string, worksiteId: string, scheduledFor: string): string {
  return `pdtp-scheduled-${createHash("sha256").update(`${activityId}\u0000${worksiteId}\u0000${scheduledFor}`).digest("hex").slice(0, 32)}`
}

export function pdtpScheduledInstanceIdempotencyKey(activityId: string, worksiteId: string, scheduledFor: string): string {
  return `pdtp-scheduled:${activityId}:${worksiteId}:${scheduledFor}`
}

function firstResponsibleSlug(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0)
  return first?.trim() ?? null
}

function programRange(program: ProgramPeriod): { startDate: string; endDate: string } {
  const year = program.year ?? Number(program.periodStart?.slice(0, 4) ?? codeYear())
  return {
    startDate: program.periodStart ?? `${year}-01-01`,
    endDate: program.periodEnd ?? `${year}-12-31`,
  }
}

export function buildPdtpScheduledInstanceRows(input: {
  program: ProgramPeriod
  activity: ActivityScheduleInput
  worksiteIds: string[]
}): PdtpScheduledInstanceSeed[] {
  if (!input.activity.scheduleDefinition || input.activity.scheduleDefinition.kind === "legacy_grid") return []
  const occurrences = expandPdtpScheduleDefinition(input.activity.scheduleDefinition, programRange(input.program))
  const responsibleSlug = firstResponsibleSlug(input.activity.responsibleSlugs)
  return input.worksiteIds.flatMap((worksiteId) => occurrences.map((occurrence) => {
    const idempotencyKey = pdtpScheduledInstanceIdempotencyKey(input.activity.id, worksiteId, occurrence.scheduledFor)
    return {
      id: stableId(input.activity.id, worksiteId, occurrence.scheduledFor),
      programId: input.program.id,
      activityId: input.activity.id,
      worksiteId,
      scheduledFor: occurrence.scheduledFor,
      isoWeekYear: occurrence.isoWeekYear,
      isoWeek: occurrence.isoWeek,
      plannedQuantity: occurrence.plannedQuantity,
      status: "pending" as const,
      responsibleSlug,
      responsibleUserId: null,
      responsibleRoleSnapshot: null,
      idempotencyKey,
      sourceMetadataJson: { generatedFrom: "schedule_definition", scheduleVersion: input.activity.scheduleDefinition?.version ?? 1 },
    }
  }))
}

export type PdtpScheduledInstanceDerivedStatus = "pending" | "in_progress" | "submitted" | "completed" | "completed_late" | "overdue" | "not_applicable" | "cancelled"

export function derivePdtpScheduledInstanceStatus(input: {
  status: string
  scheduledFor: string
  completedAt?: string | null
  now?: string
}): PdtpScheduledInstanceDerivedStatus {
  const now = (input.now ?? new Date().toISOString()).slice(0, 10)
  if (input.status === "completed") {
    return input.completedAt && input.completedAt.slice(0, 10) > input.scheduledFor ? "completed_late" : "completed"
  }
  if ((input.status === "pending" || input.status === "in_progress" || input.status === "submitted") && now > input.scheduledFor) return "overdue"
  return input.status as PdtpScheduledInstanceDerivedStatus
}

async function resolveMaterializationWorksites(
  program: typeof pdtpPrograms.$inferSelect,
  requestedIds: string[] | undefined,
  client: Tx | typeof db,
): Promise<string[]> {
  const requested = requestedIds ? [...new Set(requestedIds)] : null
  const members = await client.select({ worksiteId: pdtpProgramWorksites.worksiteId })
    .from(pdtpProgramWorksites)
    .where(and(eq(pdtpProgramWorksites.programId, program.id), eq(pdtpProgramWorksites.isActive, true)))
  const memberIds = members.map((row) => row.worksiteId)
  const candidates = requested ?? (memberIds.length > 0 ? memberIds : program.appliesToAllWorksites
    ? (await client.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true))).map((row) => row.id)
    : [])
  if (candidates.length === 0) return []
  const active = await client.select({ id: worksites.id }).from(worksites).where(and(eq(worksites.isActive, true), inArray(worksites.id, candidates)))
  const activeSet = new Set(active.map((row) => row.id))
  return candidates.filter((id) => activeSet.has(id) && (memberIds.length === 0 || memberIds.includes(id)))
}

/** Materializes date-backed definitions without creating native module records. */
export async function materializePdtpScheduledInstances(input: {
  programId: string
  activityIds?: string[]
  worksiteIds?: string[]
  now?: string
}): Promise<{ created: number; existing: number; skipped: number }> {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const activities = await db.select().from(pdtpActivities).where(and(
    eq(pdtpActivities.programId, input.programId),
    eq(pdtpActivities.status, "active"),
    ...(input.activityIds?.length ? [inArray(pdtpActivities.id, input.activityIds)] : []),
  ))
  const worksiteIds = await resolveMaterializationWorksites(program, input.worksiteIds, db)
  if (worksiteIds.length === 0 || activities.length === 0) return { created: 0, existing: 0, skipped: activities.length }
  const exclusions = await db.select({ activityId: pdtpActivityWorksiteExclusions.activityId, worksiteId: pdtpActivityWorksiteExclusions.worksiteId })
    .from(pdtpActivityWorksiteExclusions)
    .where(inArray(pdtpActivityWorksiteExclusions.activityId, activities.map((activity) => activity.id)))
  const excluded = new Set(exclusions.map((row) => `${row.activityId}:${row.worksiteId}`))
  const seeds = activities.flatMap((activity) => buildPdtpScheduledInstanceRows({
    program,
    activity: { ...activity, scheduleDefinition: activity.scheduleDefinition as PdtpScheduleDefinition | null },
    worksiteIds: worksiteIds.filter((worksiteId) => !excluded.has(`${activity.id}:${worksiteId}`)),
  }))
  if (seeds.length === 0) return { created: 0, existing: 0, skipped: activities.length }
  // La asignación nominal por faena ya existe en el modelo PDTP. Se copia la
  // persona y el rol efectivo de cada fecha sin reemplazar el slug responsable
  // firmado; si la nómina cambia después, el histórico sigue contestando quién
  // recibió esa ocurrencia concreta.
  const assignments = await db.select({
    activityId: pdtpActivityWorksiteAssignees.activityId,
    worksiteId: pdtpActivityWorksiteAssignees.worksiteId,
    userId: pdtpActivityWorksiteAssignees.userId,
    roleId: pdtpActivityWorksiteAssignees.roleId,
    validFrom: pdtpActivityWorksiteAssignees.validFrom,
    validUntil: pdtpActivityWorksiteAssignees.validUntil,
  }).from(pdtpActivityWorksiteAssignees).where(and(
    inArray(pdtpActivityWorksiteAssignees.activityId, activities.map((activity) => activity.id)),
    inArray(pdtpActivityWorksiteAssignees.worksiteId, worksiteIds),
  ))
  const assignedSeeds = seeds.map((seed) => {
    const effective = assignments
      .filter((assignment) => assignment.activityId === seed.activityId
        && assignment.worksiteId === seed.worksiteId
        && assignment.validFrom <= seed.scheduledFor
        && (!assignment.validUntil || assignment.validUntil >= seed.scheduledFor))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    return effective
      ? { ...seed, responsibleUserId: effective.userId, responsibleRoleSnapshot: effective.roleId }
      : seed
  })
  const now = input.now ?? new Date().toISOString()
  const created = await db.transaction(async (tx) => {
    // Una recurrencia anual por muchas faenas puede superar el límite práctico
    // de parámetros de PostgreSQL si se envía como un único INSERT. Los lotes
    // mantienen la misma transacción y la misma clave idempotente.
    let insertedCount = 0
    for (let offset = 0; offset < assignedSeeds.length; offset += 500) {
      const batch = assignedSeeds.slice(offset, offset + 500)
      const inserted = await tx.insert(pdtpScheduledInstances).values(batch.map((seed) => ({
        ...seed,
        createdAt: now,
        updatedAt: now,
      }))).onConflictDoNothing({ target: pdtpScheduledInstances.idempotencyKey }).returning({ id: pdtpScheduledInstances.id })
      insertedCount += inserted.length
    }
    return insertedCount
  })
  return { created, existing: assignedSeeds.length - created, skipped: activities.length - new Set(assignedSeeds.map((seed) => seed.activityId)).size }
}

/**
 * Reconciliación idempotente de todos los programas activos. Se ejecuta al
 * activar y desde el cron operativo para cubrir faenas incorporadas después de
 * la activación o una corrida que quedó a medias. No crea registros nativos
 * del submódulo: sólo deja disponibles las ocurrencias que luego se inician
 * desde su conector.
 */
export async function reconcilePdtpScheduledInstances(input: {
  programId?: string
  limit?: number
} = {}): Promise<{ programs: number; created: number; existing: number; skipped: number }> {
  const programs = await db.select({ id: pdtpPrograms.id })
    .from(pdtpPrograms)
    .where(and(
      eq(pdtpPrograms.status, "active"),
      input.programId ? eq(pdtpPrograms.id, input.programId) : undefined,
    ))
    .limit(input.limit ?? 100)
  let created = 0
  let existing = 0
  let skipped = 0
  for (const program of programs) {
    const result = await materializePdtpScheduledInstances({ programId: program.id })
    created += result.created
    existing += result.existing
    skipped += result.skipped
  }
  return { programs: programs.length, created, existing, skipped }
}
