import { eq } from "drizzle-orm"
import * as schema from "../../db/schema"
import {
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  pick,
  tableExists,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedPdtp(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  if (!(await tableExists(sql, "pdtp_obligations")) || !(await tableExists(sql, "pdtp_scheduled_instances"))) {
    return { domain: "pdtp", inserted: 0, skipped: 0, notes: ["Faltan tablas PDTP en esta base; no se sembró."] }
  }

  const programs = await db.select().from(schema.pdtpPrograms).limit(5)
  const program = programs.find((entry) => entry.status === "active") ?? programs[0]
  if (!program) {
    return { domain: "pdtp", inserted: 0, skipped: 0, notes: ["No hay programa PDTP; no se sembró."] }
  }
  const activities = await db
    .select()
    .from(schema.pdtpActivities)
    .where(eq(schema.pdtpActivities.programId, program.id))
    .limit(12)
  if (activities.length === 0) {
    return { domain: "pdtp", inserted: 0, skipped: 0, notes: ["El programa PDTP no tiene actividades; no se sembró."] }
  }

  // ── Obligaciones ──────────────────────────────────────────────────────────
  const obligationCount = await countRows(sql, "pdtp_obligations")
  if (obligationCount < 6) {
    const rows: (typeof schema.pdtpObligations.$inferInsert)[] = activities.slice(0, 8).map((activity, index) => {
      const status = index < 4 ? "pending" : index < 6 ? "overdue" : "completed"
      return {
        id: devId("pdtp-obligation", index + 1),
        programId: program.id,
        activityId: activity.id,
        worksiteId: base.worksites[index % base.worksites.length]!.id,
        mode: "on_demand",
        status,
        triggerType: null,
        sourceType: "dev_seed",
        sourceId: `dev-pdtp-obligation-source-${index + 1}`,
        sourceOccurredAt: iso(daysAgo(today, int(rng, 1, 30))),
        dueAt: iso(daysAgo(today, status === "overdue" ? -10 : int(rng, -10, 20))),
        plannedQuantity: 1,
        completedQuantity: status === "completed" ? 1 : 0,
        idempotencyKey: `dev-pdtp-obligation-${index + 1}`,
        origin: "manual",
        manualReason: "Obligación de demostración creada para el entorno de desarrollo.",
        sourceMetadataJson: { origen: "dev-seed" },
        createdByUserId: actors.adminUserId,
        reportedAt: status === "completed" ? iso(daysAgo(today, 2)) : null,
        completedAt: status === "completed" ? iso(daysAgo(today, 2)) : null,
        cancelledByUserId: null,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: iso(daysAgo(today, int(rng, 5, 40))),
        updatedAt: iso(daysAgo(today, int(rng, 1, 5))),
      }
    })
    if (apply) {
      inserted += await insertBatch(rows, async (chunk) =>
        (await db.insert(schema.pdtpObligations).values(chunk).onConflictDoNothing().returning({ id: schema.pdtpObligations.id })).length,
      )
    } else {
      skipped += rows.length
    }
  } else {
    skipped += 8
  }

  // ── Instancias programadas ────────────────────────────────────────────────
  const instanceCount = await countRows(sql, "pdtp_scheduled_instances")
  if (instanceCount < 8) {
    const rows: (typeof schema.pdtpScheduledInstances.$inferInsert)[] = Array.from({ length: 10 }, (_, index) => {
      const activity = activities[index % activities.length]!
      const scheduled = daysAgo(today, int(rng, -20, 60))
      const status = index < 5 ? "pending" : index < 8 ? "completed" : "in_progress"
      return {
        id: devId("pdtp-instance", index + 1),
        programId: program.id,
        activityId: activity.id,
        worksiteId: pick(rng, base.worksites).id,
        scheduledFor: dateOnly(scheduled),
        isoWeekYear: scheduled.getUTCFullYear(),
        isoWeek: int(rng, 1, 52),
        plannedQuantity: 1,
        status,
        responsibleSlug: "prevencionista",
        responsibleUserId: actors.adminUserId,
        responsibleRoleSnapshot: "Prevencionista de demostración",
        startedAt: status === "in_progress" ? iso(daysAgo(today, 2)) : null,
        startedByUserId: status === "in_progress" ? actors.adminUserId : null,
        completedAt: status === "completed" ? iso(daysAgo(today, 1)) : null,
        completedByUserId: status === "completed" ? actors.adminUserId : null,
        notApplicableReason: null,
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
        idempotencyKey: `dev-pdtp-instance-${index + 1}`,
        sourceMetadataJson: { origen: "dev-seed" },
        createdAt: iso(daysAgo(today, int(rng, 5, 40))),
        updatedAt: iso(daysAgo(today, int(rng, 1, 5))),
      }
    })
    if (apply) {
      inserted += await insertBatch(rows, async (chunk) =>
        (await db.insert(schema.pdtpScheduledInstances).values(chunk).onConflictDoNothing().returning({ id: schema.pdtpScheduledInstances.id })).length,
      )
    } else {
      skipped += rows.length
    }
  } else {
    skipped += 10
  }

  log(`  PDTP: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "pdtp", inserted, skipped, notes }
}
