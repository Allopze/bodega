import { asc, count, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpExecutions,
  pdtpImportBatches,
  pdtpPrograms,
  preventionPdtpSourceLinks,
} from "@/db/schema"

const apply = process.argv.includes("--apply")

async function main() {
  const legacyObjectiveLinks = await db.select({
    id: preventionPdtpSourceLinks.id,
    activityId: preventionPdtpSourceLinks.activityId,
    sourceId: preventionPdtpSourceLinks.sourceId,
  }).from(preventionPdtpSourceLinks)
    .where(eq(preventionPdtpSourceLinks.sourceType, "internal_objective"))
  if (legacyObjectiveLinks.length > 0) {
    throw new Error(
      "No se puede aplicar la migración PDTP anual: aún existen vínculos source_type=internal_objective. " +
      `Revísalos y elimínalos o reclasifícalos antes de continuar: ${JSON.stringify(legacyObjectiveLinks)}`,
    )
  }

  const duplicateYears = await db.select({
    year: pdtpPrograms.year,
    total: count(),
  }).from(pdtpPrograms)
    .groupBy(pdtpPrograms.year)
    .having(sql`count(*) > 1`)

  const years = duplicateYears.filter((row) => Number(row.total) > 1).map((row) => row.year)
  if (years.length === 0) {
    console.log(JSON.stringify({ ok: true, apply, legacyObjectiveLinks: 0, duplicateYears: [], removedProgramIds: [] }, null, 2))
    return
  }

  const programs = await db.select().from(pdtpPrograms)
    .where(inArray(pdtpPrograms.year, years))
    .orderBy(asc(pdtpPrograms.year), asc(pdtpPrograms.createdAt), asc(pdtpPrograms.version))
  const removedProgramIds: string[] = []
  const blocked: Array<{
    year: number
    programId: string
    status: string
    activities: number
    executions: number
    imports: number
    hasReviewHistory: boolean
  }> = []
  const decisions: Array<{ year: number; keep: string; remove: string[] }> = []

  for (const year of years) {
    const annual = programs.filter((program) => program.year === year)
    const keep = annual[0]!
    const removable: string[] = []
    for (const candidate of annual.slice(1)) {
      const [activityRows, executionRows, importRows] = await Promise.all([
        db.select({ total: count() }).from(pdtpActivities).where(eq(pdtpActivities.programId, candidate.id)),
        db.select({ total: count() }).from(pdtpExecutions)
          .innerJoin(pdtpActivities, eq(pdtpExecutions.activityId, pdtpActivities.id))
          .where(eq(pdtpActivities.programId, candidate.id)),
        db.select({ total: count() }).from(pdtpImportBatches).where(eq(pdtpImportBatches.programId, candidate.id)),
      ])
      const activities = Number(activityRows[0]?.total ?? 0)
      const executions = Number(executionRows[0]?.total ?? 0)
      const imports = Number(importRows[0]?.total ?? 0)
      const hasReviewHistory = Boolean(
        candidate.contentDigest
        || candidate.reviewStartedAt
        || candidate.approvedByJdprUserId
        || candidate.approvedByLegalUserId
        || candidate.activatedAt
        || candidate.rejectedAt
        || candidate.archivedAt,
      )
      if (candidate.status !== "draft" || activities > 0 || executions > 0 || imports > 0 || hasReviewHistory) {
        blocked.push({
          year,
          programId: candidate.id,
          status: candidate.status,
          activities,
          executions,
          imports,
          hasReviewHistory,
        })
      } else {
        removable.push(candidate.id)
      }
    }
    decisions.push({ year, keep: keep.id, remove: removable })
  }

  if (blocked.length > 0) {
    throw new Error(`No se puede imponer unicidad anual. Hay duplicados con contenido: ${JSON.stringify(blocked)}`)
  }

  if (apply) {
    await db.transaction(async (tx) => {
      for (const decision of decisions) {
        if (decision.remove.length === 0) continue
        await tx.delete(pdtpPrograms).where(inArray(pdtpPrograms.id, decision.remove))
        removedProgramIds.push(...decision.remove)
      }
    })
  }

  console.log(JSON.stringify({ ok: true, apply, legacyObjectiveLinks: 0, duplicateYears: decisions, removedProgramIds }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    const cause = error instanceof Error ? error.cause : undefined
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : ""
    if (code === "42P01") {
      console.log(JSON.stringify({
        ok: true,
        apply,
        skipped: true,
        reason: "Las tablas PDTP aún no existen; corresponde a una base nueva y drizzle-kit puede crearlas.",
      }, null, 2))
      process.exit(0)
    }
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
