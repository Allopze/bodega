import { and, count, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { sstEvaluations, sstScheduledFollowups } from "@/db/schema/sst"

export async function getDashboardStats(worksiteIds: string[] | "all"): Promise<{ total: number; borrador: number; cerrado: number; habilitados: number; noHabilitados: number; pendingFollowups: number }> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return { total: 0, borrador: 0, cerrado: 0, habilitados: 0, noHabilitados: 0, pendingFollowups: 0 }

  const scopeCond = worksiteIds !== "all" ? inArray(sstEvaluations.worksiteId, worksiteIds) : undefined
  const [[statsRow], [followupsRow]] = await Promise.all([
    db.select({
      total: count(), borrador: sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.estado} = 'borrador')`,
      cerrado: sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.estado} = 'cerrado')`,
      habilitados: sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.resultadoFinal} IN ('habilitado_autonomo', 'habilitado_restricciones'))`,
      noHabilitados: sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.resultadoFinal} = 'no_habilitado')`,
    }).from(sstEvaluations).where(scopeCond),
    db.select({ pending: count() }).from(sstScheduledFollowups)
      .innerJoin(sstEvaluations, eq(sstScheduledFollowups.evaluationId, sstEvaluations.id))
      .where(scopeCond ? and(eq(sstScheduledFollowups.realizado, false), scopeCond) : eq(sstScheduledFollowups.realizado, false)),
  ])

  return { total: Number(statsRow?.total ?? 0), borrador: Number(statsRow?.borrador ?? 0), cerrado: Number(statsRow?.cerrado ?? 0), habilitados: Number(statsRow?.habilitados ?? 0), noHabilitados: Number(statsRow?.noHabilitados ?? 0), pendingFollowups: Number(followupsRow?.pending ?? 0) }
}
