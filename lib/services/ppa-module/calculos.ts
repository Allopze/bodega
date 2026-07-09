import { eq, and, or, inArray, desc, ilike, gte, lte, sql } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { ppaSubmissions } from "@/db/schema/ppa"
import { worksites } from "@/db/schema/worksites"
import type { PpaRow } from "./evaluaciones"

export interface PpaListFilters {
  worksiteIds: string[] | "all"
  estado?: string
  tipoTrabajo?: string
  workerId?: string
  worksiteId?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

function buildPpaConditions(filters: PpaListFilters) {
  if (filters.worksiteIds !== "all" && filters.worksiteIds.length === 0) return null

  const conditions = []
  if (filters.worksiteIds !== "all") conditions.push(inArray(ppaSubmissions.worksiteId, filters.worksiteIds))
  if (filters.estado === "pendientes") {
    conditions.push(inArray(ppaSubmissions.estado, ["detenido", "en_correccion"]))
  } else if (filters.estado === "autorizado") {
    conditions.push(inArray(ppaSubmissions.estado, ["autorizado", "aprobado_auto"]))
  } else if (filters.estado) {
    conditions.push(eq(ppaSubmissions.estado, filters.estado))
  }
  if (filters.tipoTrabajo) conditions.push(eq(ppaSubmissions.tipoTrabajo, filters.tipoTrabajo))
  if (filters.workerId)    conditions.push(eq(ppaSubmissions.workerId, filters.workerId))
  if (filters.worksiteId)  conditions.push(eq(ppaSubmissions.worksiteId, filters.worksiteId))
  if (filters.dateFrom)    conditions.push(gte(ppaSubmissions.createdAt, filters.dateFrom))
  if (filters.dateTo)      conditions.push(lte(ppaSubmissions.createdAt, filters.dateTo))
  if (filters.search) {
    const like = `%${filters.search.trim()}%`
    const term = or(ilike(ppaSubmissions.workerName, like), ilike(worksites.name, like))
    if (term) conditions.push(term)
  }
  return conditions
}

// Columns needed for the PPA list view — excludes large JSONB blobs.
const LIST_COLUMNS = {
  id: ppaSubmissions.id,
  worksiteId: ppaSubmissions.worksiteId,
  workerId: ppaSubmissions.workerId,
  workerName: ppaSubmissions.workerName,
  workerRut: ppaSubmissions.workerRut,
  workerCompany: ppaSubmissions.workerCompany,
  manualIdentificacion: ppaSubmissions.manualIdentificacion,
  tipoTrabajo: ppaSubmissions.tipoTrabajo,
  esCritica: ppaSubmissions.esCritica,
  resultado: ppaSubmissions.resultado,
  estado: ppaSubmissions.estado,
  publicToken: ppaSubmissions.publicToken,
  publicTokenRevokedAt: ppaSubmissions.publicTokenRevokedAt,
  reviewedBy: ppaSubmissions.reviewedBy,
  fuiAlLugar: ppaSubmissions.fuiAlLugar,
  decision: ppaSubmissions.decision,
  reviewedAt: ppaSubmissions.reviewedAt,
  createdAt: ppaSubmissions.createdAt,
  updatedAt: ppaSubmissions.updatedAt,
} satisfies Record<string, PgColumn>

export async function listPpa(
  filters: PpaListFilters,
  limit = 50,
  offset = 0,
): Promise<PpaRow[]> {
  const conditions = buildPpaConditions(filters)
  if (conditions === null) return []

  if (filters.search) {
    const rows = await db
      .select({ ...LIST_COLUMNS, worksiteName: worksites.name })
      .from(ppaSubmissions)
      .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ppaSubmissions.createdAt))
      .limit(limit)
      .offset(offset)
    return rows as unknown as PpaRow[]
  }

  const submissions = await db
    .select(LIST_COLUMNS)
    .from(ppaSubmissions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ppaSubmissions.createdAt))
    .limit(limit)
    .offset(offset)

  if (submissions.length === 0) return []

  const ids = [...new Set(submissions.map((s) => s.worksiteId))]
  const wsRows = ids.length > 0
    ? await db.select({ id: worksites.id, name: worksites.name })
        .from(worksites)
        .where(inArray(worksites.id, ids))
    : []
  const wsMap = new Map(wsRows.map((w) => [w.id, w.name]))

  return submissions.map((s) => ({ ...s, worksiteName: wsMap.get(s.worksiteId) ?? null })) as unknown as PpaRow[]
}

export async function countPpa(filters: PpaListFilters): Promise<number> {
  const conditions = buildPpaConditions(filters)
  if (conditions === null) return 0

  const base = db.select({ count: sql<number>`count(*)::int` }).from(ppaSubmissions)
  const q = filters.search
    ? base.leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    : base

  const rows = await q.where(conditions.length > 0 ? and(...conditions) : undefined)
  return rows[0]?.count ?? 0
}

export async function getPpa(id: string, worksiteIds: string[] | "all"): Promise<PpaRow | null> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return null

  const rows = await db
    .select({ submission: ppaSubmissions, worksiteName: worksites.name })
    .from(ppaSubmissions)
    .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    .where(eq(ppaSubmissions.id, id))
    .limit(1)

  if (rows.length === 0) return null
  const { submission, worksiteName } = rows[0]!
  if (worksiteIds !== "all" && !worksiteIds.includes(submission.worksiteId)) return null
  return { ...submission, worksiteName }
}

export interface PpaStats {
  total: number
  detenidos: number
  aprobadosAuto: number
  autorizados: number
  rechazados: number
  pendientes: number
  porcentajeDesviaciones: number
  avgResponseMinutes: number | null
  topReasons: { reason: string; count: number }[]
  topTareas: { tipoTrabajo: string; count: number }[]
  topFaenas: { worksiteName: string; count: number }[]
}

export async function getPpaStats(worksiteIds: string[] | "all"): Promise<PpaStats> {
  const empty: PpaStats = {
    total: 0, detenidos: 0, aprobadosAuto: 0, autorizados: 0, rechazados: 0,
    pendientes: 0, porcentajeDesviaciones: 0, avgResponseMinutes: null,
    topReasons: [], topTareas: [], topFaenas: [],
  }
  if (worksiteIds !== "all" && worksiteIds.length === 0) return empty

  const scopeCond = worksiteIds !== "all"
    ? inArray(ppaSubmissions.worksiteId, worksiteIds)
    : undefined

  const [totals] = await db
    .select({
      total:              sql<number>`count(*)::int`,
      detenidos:          sql<number>`count(*) filter (where ${ppaSubmissions.resultado} = 'detenido')::int`,
      aprobadosAuto:      sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'aprobado_auto')::int`,
      autorizados:        sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'autorizado')::int`,
      rechazados:         sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'rechazado')::int`,
      pendientes:         sql<number>`count(*) filter (where ${ppaSubmissions.estado} in ('detenido', 'en_correccion'))::int`,
      avgResponseMinutes: sql<number | null>`round(avg(extract(epoch from (${ppaSubmissions.reviewedAt} - ${ppaSubmissions.createdAt})) / 60) filter (where ${ppaSubmissions.reviewedAt} >= ${ppaSubmissions.createdAt}))`,
    })
    .from(ppaSubmissions)
    .where(scopeCond)

  const [topReasonsResult, topTareasRows, topFaenasRows] = await Promise.all([
    db.execute(sql`
      SELECT value AS reason, count(*)::int AS count
      FROM ppa_submissions,
           jsonb_array_elements_text(ppa_submissions.triggered_reasons) AS value
      ${scopeCond ? sql`WHERE ${scopeCond}` : sql``}
      GROUP BY value
      ORDER BY count DESC
      LIMIT 5
    `),

    db.select({
      tipoTrabajo: ppaSubmissions.tipoTrabajo,
      count:       sql<number>`count(*)::int`,
    }).from(ppaSubmissions)
      .where(scopeCond)
      .groupBy(ppaSubmissions.tipoTrabajo)
      .orderBy(sql`count(*) desc`)
      .limit(5),

    db.select({
      worksiteName: worksites.name,
      count:        sql<number>`count(*)::int`,
    }).from(ppaSubmissions)
      .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
      .where(and(scopeCond, eq(ppaSubmissions.resultado, "detenido")))
      .groupBy(worksites.name)
      .orderBy(sql`count(*) desc`)
      .limit(5),
  ])

  const total     = totals?.total ?? 0
  const detenidos = totals?.detenidos ?? 0

  return {
    total,
    detenidos,
    aprobadosAuto:          totals?.aprobadosAuto ?? 0,
    autorizados:            totals?.autorizados ?? 0,
    rechazados:             totals?.rechazados ?? 0,
    pendientes:             totals?.pendientes ?? 0,
    porcentajeDesviaciones: total > 0 ? Math.round((detenidos / total) * 100) : 0,
    avgResponseMinutes:     totals?.avgResponseMinutes ?? null,
    topReasons:             (topReasonsResult as Record<string, unknown>[]).map((r) => ({ reason: String(r.reason), count: Number(r.count) })),
    topTareas:              topTareasRows.map((r) => ({ tipoTrabajo: r.tipoTrabajo, count: r.count })),
    topFaenas:              topFaenasRows.map((r) => ({ worksiteName: r.worksiteName ?? "—", count: r.count })),
  }
}
