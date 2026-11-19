/**
 * lib/services/app-visits.ts — Registro y lectura de visitas por app.
 *
 * Una «visita» es entrar a una app: navegar entre pantallas de la misma app
 * dentro de 30 minutos no suma otra. Eso lo decide la base (no el cliente),
 * así que el contador no depende de cuántas pestañas o recargas haya.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm"
import { db } from "@/db"
import { appVisits } from "@/db/schema"
import { resolveModuleRoute } from "@/lib/services/module-toggles"
import { findApp } from "@/lib/apps/catalog"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import type { AppVisitRow, AppVisitorRow } from "@/lib/apps/metrics"

/** Volver a la misma app antes de este plazo es la misma visita. */
export const VISIT_GAP_MINUTES = 30

/** App de una ruta, o null si la ruta no es de ninguna app (Inicio, perfil…). */
export function appIdForPath(pathname: string): string | null {
  const resolved = resolveModuleRoute(pathname)
  if (!resolved) return null
  return findApp(resolved.moduleId) ? resolved.moduleId : null
}

export async function recordAppVisit(userId: string, pathname: string, now: Date = new Date()): Promise<string | null> {
  const moduleId = appIdForPath(pathname)
  if (!moduleId) return null
  const nowIso = now.toISOString()
  const gapStart = new Date(now.getTime() - VISIT_GAP_MINUTES * 60_000).toISOString()
  await db.insert(appVisits)
    .values({ userId, moduleId, day: todayInChile(now), views: 1, lastVisitAt: nowIso })
    .onConflictDoUpdate({
      target: [appVisits.userId, appVisits.moduleId, appVisits.day],
      set: {
        views: sql`${appVisits.views} + case when ${appVisits.lastVisitAt} < ${gapStart} then 1 else 0 end`,
        lastVisitAt: nowIso,
      },
    })
  return moduleId
}

/** Apps que la persona abrió más recientemente (últimos 30 días), la más reciente primero. */
export async function getRecentAppIds(userId: string, limit = 4, now: Date = new Date()): Promise<string[]> {
  const rows = await db.select({ moduleId: appVisits.moduleId, lastAt: sql<string>`max(${appVisits.lastVisitAt})` })
    .from(appVisits)
    .where(and(eq(appVisits.userId, userId), gte(appVisits.day, addDaysToPlainDate(todayInChile(now), -30))))
    .groupBy(appVisits.moduleId)
    .orderBy(desc(sql`max(${appVisits.lastVisitAt})`))
    .limit(limit)
  return rows.map((row) => row.moduleId)
}

/**
 * Visitas por app de los últimos `days` días civiles, más los pares persona–app
 * (para contar personas distintas sin sumar dos veces a quien abrió dos apps).
 */
export async function getAppVisitWindow(days: number, now: Date = new Date()): Promise<{
  visits: AppVisitRow[]
  visitors: AppVisitorRow[]
  trackedSince: string | null
}> {
  const since = addDaysToPlainDate(todayInChile(now), -(days - 1))
  const [visits, visitors, [first]] = await Promise.all([
    db.select({
      moduleId: appVisits.moduleId,
      visits: sql<number>`sum(${appVisits.views})::int`,
      lastVisitAt: sql<string | null>`max(${appVisits.lastVisitAt})`,
    }).from(appVisits).where(gte(appVisits.day, since)).groupBy(appVisits.moduleId),
    db.selectDistinct({ moduleId: appVisits.moduleId, userId: appVisits.userId })
      .from(appVisits).where(gte(appVisits.day, since)),
    db.select({ day: sql<string | null>`min(${appVisits.day})` }).from(appVisits),
  ])
  return {
    visits: visits.map((row) => ({ ...row, visits: Number(row.visits) })),
    visitors,
    trackedSince: first?.day ?? null,
  }
}
