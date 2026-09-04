/**
 * Lectura de brechas de competencia.
 *
 * Vive aparte de `prevention-training.ts` por la misma razón que
 * `prevention-cphs-organization-read.ts`: el conector de obligaciones del PDTP
 * la consume desde un cron, y un conector no debe importar un servicio de
 * dominio que a su vez lo importe de vuelta.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  preventionCommitteeMembers,
  preventionCompetencyRequirements,
  preventionTrainingCourses,
  preventionWorkerCompetencies,
  workers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { computeCompetencyGaps, type CompetencyGap } from "@/lib/prevention/training"
import { todayInChile } from "@/lib/utils"

/** Mismo predicado que `prevention-training.ts`, para que la brecha del cron y la de la UI coincidan. */
function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

/**
 * Las brechas de competencia de un alcance, sin exigir permiso.
 *
 * La autorización la aplica `listCompetencyGaps`, que es la puerta de la UI.
 * El barrido de obligaciones del PDTP (`competency-gap-connector.ts`) corre
 * desde un cron sin sesión y consume esta misma consulta: la brecha que abre el
 * compromiso y la que ve la pantalla son por construcción la misma.
 */
export async function computeCompetencyGapsForScope(scope: WorksiteScope): Promise<CompetencyGap[]> {
  const workerScope = scopeCondition(scope, workers.worksiteId)

  const [workerRows, requirementRows, competencyRows] = await Promise.all([
    db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, position: workers.position, worksiteId: workers.worksiteId, isActive: workers.isActive })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)),
    db.select({
      id: preventionCompetencyRequirements.id,
      courseId: preventionCompetencyRequirements.courseId,
      courseName: preventionTrainingCourses.name,
      scopeType: preventionCompetencyRequirements.scopeType,
      scopeValue: preventionCompetencyRequirements.scopeValue,
      worksiteId: preventionCompetencyRequirements.worksiteId,
      enforcement: preventionCompetencyRequirements.enforcement,
      reason: preventionCompetencyRequirements.reason,
      isActive: preventionCompetencyRequirements.isActive,
    }).from(preventionCompetencyRequirements)
      .innerJoin(preventionTrainingCourses, eq(preventionCompetencyRequirements.courseId, preventionTrainingCourses.id))
      .where(and(eq(preventionCompetencyRequirements.isActive, true), eq(preventionTrainingCourses.isActive, true))),
    db.select({ workerId: preventionWorkerCompetencies.workerId, courseId: preventionWorkerCompetencies.courseId, status: preventionWorkerCompetencies.status, expiresAt: preventionWorkerCompetencies.expiresAt })
      .from(preventionWorkerCompetencies)
      .innerJoin(workers, eq(preventionWorkerCompetencies.workerId, workers.id))
      .where(workerScope),
  ])

  // El padrón de comités sólo se consulta si algún requisito lo necesita: la
  // gran mayoría de los requisitos son por cargo o faena.
  const committeeMembers = requirementRows.some((row) => row.scopeType === "committee")
    ? await loadCommitteeMemberIds()
    : undefined

  return computeCompetencyGaps({
    workers: workerRows,
    requirements: requirementRows,
    competencies: competencyRows,
    asOf: todayInChile(),
    committeeMembers,
  })
}

/** `committeeId` → ids de trabajadores que hoy integran ese comité. */
async function loadCommitteeMemberIds(): Promise<Map<string, Set<string>>> {
  const rows = await db.select({
    committeeId: preventionCommitteeMembers.committeeId,
    workerId: preventionCommitteeMembers.workerId,
  })
    .from(preventionCommitteeMembers)
    .where(eq(preventionCommitteeMembers.status, "active"))

  const byCommittee = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byCommittee.get(row.committeeId)
    if (set) set.add(row.workerId)
    else byCommittee.set(row.committeeId, new Set([row.workerId]))
  }
  return byCommittee
}
