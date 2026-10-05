import { eq, and, isNull, sql, type SQL } from "drizzle-orm"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { IT_RETIRED_STATUSES } from "./constants"
import { db } from "@/db"
import {
  itAssets, itAssetTypes, itMaintenances, itTickets, itLicenses,
  itAssetAssignments, worksites, itSystemAccess, itWorkerChecklists, itChecklistTasks, workers,
} from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { licenseScopeCondition } from "./licenses"
import type { TiWorksiteScope } from "./scope"

/* ── Agregados del dashboard y reportes TI ───────────────────────────────── */

export interface TiDashboardCounts {
  totalAssets: number
  assigned: number
  available: number
  inRepair: number
  retired: number
  openTickets: number
  criticalTickets: number
  warrantiesExpiring30: number
  warrantiesExpiring60: number
  warrantiesExpiring90: number
  licensesRenewing14: number
  maintenanceCostYear: number
  activeAssignments: number
}

/** Estados terminales: fuera del "parque vigente" que muestra el inventario. */
const RETIRED_STATUSES = sql`(${sql.join(IT_RETIRED_STATUSES.map((s) => sql`${s}`), sql`, `)})`

/**
 * Predicado del parque vigente. Los gráficos de composición (tipo, faena,
 * antigüedad) describen lo que la empresa opera hoy: mezclar bajas inflaba los
 * tramos de antigüedad justo donde se decide qué reemplazar.
 */
function activeParkWhere(scope?: SQL) {
  const base = scope ? and(isNull(itAssets.deletedAt), scope) : isNull(itAssets.deletedAt)
  return and(base, sql`${itAssets.status} NOT IN ${RETIRED_STATUSES}`)
}

export async function getTiDashboardCounts(
  assetScope?: SQL,
  ticketScope?: SQL,
  worksiteIds: TiWorksiteScope = "all",
): Promise<TiDashboardCounts> {
  const assetWhere = assetScope ? and(isNull(itAssets.deletedAt), assetScope) : isNull(itAssets.deletedAt)
  // El parque vigente excluye bajas/pérdidas/robos, igual que `listAssets`: el
  // tile "Activos" enlaza al inventario y ambos deben decir el mismo número.
  const activeAssetWhere = and(assetWhere, sql`${itAssets.status} NOT IN ${RETIRED_STATUSES}`)
  const today = todayInChile()

  const [assets, tickets, warranties, licenses, maintenance, assignments] = await Promise.all([
    db.select({
      total: sql<number>`count(*) filter (where ${itAssets.status} NOT IN ${RETIRED_STATUSES})::int`,
      assigned: sql<number>`count(*) filter (where ${itAssets.status} = 'asignado')::int`,
      available: sql<number>`count(*) filter (where ${itAssets.status} = 'disponible')::int`,
      inRepair: sql<number>`count(*) filter (where ${itAssets.status} = 'en_reparacion')::int`,
      retired: sql<number>`count(*) filter (where ${itAssets.status} IN ${RETIRED_STATUSES})::int`,
    }).from(itAssets).where(assetWhere),

    db.select({
      open: sql<number>`count(*)::int`,
      critical: sql<number>`count(*) filter (where ${itTickets.priority} = 'critica')::int`,
    }).from(itTickets)
      .where(ticketScope
        ? and(sql`${itTickets.status} IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor')`, ticketScope)
        : sql`${itTickets.status} IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor')`),

    // Garantías solo del parque vigente: una garantía por vencer de un activo
    // ya dado de baja no es accionable, y las alertas del cron ya lo excluyen.
    db.select({
      w30: sql<number>`count(*) filter (where ${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 30)::text)::int`,
      w60: sql<number>`count(*) filter (where ${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 60)::text)::int`,
      w90: sql<number>`count(*) filter (where ${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 90)::text)::int`,
    }).from(itAssets).where(activeAssetWhere),

    // Las licencias no tienen clave de faena propia: se acotan por las faenas
    // de sus asignaciones vigentes, igual que `listLicenses`.
    db.select({
      renewing14: sql<number>`count(*) filter (where ${itLicenses.renewalDate} IS NOT NULL AND ${itLicenses.renewalDate} >= ${today} AND ${itLicenses.renewalDate} <= (${today}::date + 14)::text AND ${itLicenses.isActive})::int`,
    }).from(itLicenses).where(licenseScopeCondition(worksiteIds)),

    db.select({
      yearCost: sql<number>`coalesce(sum(${itMaintenances.cost}), 0)::float8`,
    }).from(itMaintenances)
      .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
      .where(and(
        sql`${itMaintenances.date} >= (${today}::date - interval '1 year')::text`,
        isNull(itAssets.deletedAt),
        isNull(itMaintenances.voidedAt),
        assetScope ?? sql`true`,
      )),

    db.select({
      active: sql<number>`count(*)::int`,
    }).from(itAssetAssignments)
      .innerJoin(itAssets, eq(itAssetAssignments.assetId, itAssets.id))
      .where(and(
        isNull(itAssetAssignments.returnedAt),
        isNull(itAssets.deletedAt),
        assetScope ?? sql`true`,
      )),
  ])

  return {
    totalAssets: assets[0]?.total ?? 0,
    assigned: assets[0]?.assigned ?? 0,
    available: assets[0]?.available ?? 0,
    inRepair: assets[0]?.inRepair ?? 0,
    retired: assets[0]?.retired ?? 0,
    openTickets: tickets[0]?.open ?? 0,
    criticalTickets: tickets[0]?.critical ?? 0,
    warrantiesExpiring30: warranties[0]?.w30 ?? 0,
    warrantiesExpiring60: warranties[0]?.w60 ?? 0,
    warrantiesExpiring90: warranties[0]?.w90 ?? 0,
    licensesRenewing14: licenses[0]?.renewing14 ?? 0,
    maintenanceCostYear: maintenance[0]?.yearCost ?? 0,
    activeAssignments: assignments[0]?.active ?? 0,
  }
}

export async function getAssetsByType(scope?: SQL) {
  const where = activeParkWhere(scope)
  return db
    .select({
      name: itAssetTypes.name,
      total: sql<number>`count(*)::int`,
    })
    .from(itAssets)
    .innerJoin(itAssetTypes, eq(itAssets.assetTypeId, itAssetTypes.id))
    .where(where)
    .groupBy(itAssetTypes.name)
    .orderBy(sql`count(*) DESC`)
}

export async function getAssetsByWorksite(scope?: SQL) {
  const where = activeParkWhere(scope)
  return db
    .select({
      worksiteName: sql<string>`coalesce(${worksites.name}, 'Sin faena')`,
      total: sql<number>`count(*)::int`,
    })
    .from(itAssets)
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .where(where)
    .groupBy(worksites.name)
    .orderBy(sql`count(*) DESC`)
}

/** Incluye a propósito los estados terminales: son parte de esta dimensión. */
export async function getAssetsByStatus(scope?: SQL) {
  const where = scope ? and(isNull(itAssets.deletedAt), scope) : isNull(itAssets.deletedAt)
  return db
    .select({
      status: itAssets.status,
      total: sql<number>`count(*)::int`,
    })
    .from(itAssets)
    .where(where)
    .groupBy(itAssets.status)
}

/** Gasto mensual de reparación (últimos 12 meses) — doble eje con cantidad. */
export async function getMaintenanceCostByMonth(assetScope?: SQL) {
  return db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${itMaintenances.date}::date), 'YYYY-MM')`,
      cost: sql<number>`coalesce(sum(${itMaintenances.cost}), 0)::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .where(and(
      sql`${itMaintenances.date} >= (${todayInChile()}::date - interval '12 months')::text`,
      isNull(itAssets.deletedAt),
      isNull(itMaintenances.voidedAt),
      assetScope ?? sql`true`,
    ))
    .groupBy(sql`date_trunc('month', ${itMaintenances.date}::date)`)
    .orderBy(sql`date_trunc('month', ${itMaintenances.date}::date)`)
}

/** Antigüedad del parque por tramo (en años desde la compra). */
export async function getAssetsByAge(scope?: SQL) {
  const where = activeParkWhere(scope)
  const today = todayInChile()
  return db
    .select({
      tramo: sql<string>`CASE
        WHEN ${itAssets.purchaseDate} IS NULL THEN 'sin fecha'
        WHEN (${today}::date - ${itAssets.purchaseDate}::date) <= 365 THEN '0-1 año'
        WHEN (${today}::date - ${itAssets.purchaseDate}::date) <= 1095 THEN '1-3 años'
        WHEN (${today}::date - ${itAssets.purchaseDate}::date) <= 1825 THEN '3-5 años'
        ELSE '5+ años'
      END`,
      total: sql<number>`count(*)::int`,
    })
    .from(itAssets)
    .where(where)
    // `group by 1` = la primera columna del SELECT. No se puede repetir el CASE
    // aquí: cada interpolación emite su propio placeholder ($1..$3 en el SELECT,
    // $7..$9 en el GROUP BY), así que para Postgres serían expresiones distintas
    // y rechazaba la consulta con 42803 («purchase_date must appear in the GROUP
    // BY clause»), tumbando el dashboard de TI completo.
    .groupBy(sql`1`)
}

/** Tickets por categoría. */
export async function getTicketsByCategory(scope?: SQL) {
  return db
    .select({
      category: itTickets.category,
      total: sql<number>`count(*)::int`,
    })
    .from(itTickets)
    .where(scope ?? undefined)
    .groupBy(itTickets.category)
    .orderBy(sql`count(*) DESC`)
}

/** Tickets por mes (últimos 12 meses). */
export async function getTicketsByMonth(scope?: SQL) {
  return db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${itTickets.createdAt}), 'YYYY-MM')`,
      total: sql<number>`count(*)::int`,
    })
    .from(itTickets)
    .where(scope ?? undefined)
    .groupBy(sql`date_trunc('month', ${itTickets.createdAt})`)
    .orderBy(sql`date_trunc('month', ${itTickets.createdAt})`)
}


/* ── Atención hoy (tablero Resumen) ──────────────────────────────────────── */

export interface TiAttentionWorksiteCount { name: string; total: number }
export interface TiAttentionItem {
  key: string
  label: string
  /** Qué hay que hacer, en una frase. */
  hint: string
  total: number
  byWorksite: TiAttentionWorksiteCount[]
  /** Listado ya filtrado donde se actúa (contrato con L3–L6). */
  href: string
}

type RawBreakdown = { name: string | null; total: number }[]

function toItem(meta: Omit<TiAttentionItem, "total" | "byWorksite">, rows: RawBreakdown): TiAttentionItem {
  const byWorksite = rows
    .filter((row) => row.total > 0)
    .map((row) => ({ name: row.name ?? "Sin faena", total: row.total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "es"))
  return { ...meta, total: byWorksite.reduce((sum, row) => sum + row.total, 0), byWorksite }
}

const OPEN_TICKET_STATUSES = sql`('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor')`
/** Mismos 24 h de aviso que `ticketSlaStage` (TICKET_SLA_WARNING_HOURS). */
const TICKET_WARNING_INTERVAL = sql`interval '24 hours'`

/**
 * Pendientes reales del módulo, cada uno con su desglose por faena y el
 * listado filtrado donde se resuelven. El alcance se aplica por la columna de
 * faena propia de cada entidad (`worksiteScopeSqlFor`): un rol acotado nunca ve
 * un conteo de una faena ajena. Solo devuelve filas con conteo > 0.
 */
export async function getTiAttentionItems(
  scope: TiWorksiteScope,
  now: Date = new Date(),
): Promise<TiAttentionItem[]> {
  const today = todayInChile()
  const nowIso = now.toISOString()

  const assetScope = worksiteScopeSqlFor(scope, itAssets.worksiteId)
  const assignmentScope = worksiteScopeSqlFor(scope, itAssetAssignments.worksiteId)
  const ticketScope = worksiteScopeSqlFor(scope, itTickets.worksiteId)
  const workerScope = worksiteScopeSqlFor(scope, workers.worksiteId)
  const liveAsset = and(isNull(itAssets.deletedAt), assetScope)
  const liveParkAsset = and(liveAsset, sql`${itAssets.status} NOT IN ${RETIRED_STATUSES}`)

  const countBy = sql<number>`count(*)::int`

  const assignmentBase = () => db
    .select({ name: worksites.name, total: countBy })
    .from(itAssetAssignments)
    .innerJoin(itAssets, eq(itAssetAssignments.assetId, itAssets.id))
    .innerJoin(worksites, eq(itAssetAssignments.worksiteId, worksites.id))

  const ticketBase = () => db
    .select({ name: worksites.name, total: countBy })
    .from(itTickets)
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))

  const [
    unsigned, overdueLoans, overdueTickets, dueSoonTickets, warranties,
    licenses, inactiveAccess, offboardings, longRepairs,
  ] = await Promise.all([
    assignmentBase().where(and(
      isNull(itAssetAssignments.returnedAt), isNull(itAssets.deletedAt), assignmentScope,
      eq(itAssetAssignments.acceptanceStatus, "pendiente"),
    )).groupBy(worksites.name),

    assignmentBase().where(and(
      isNull(itAssetAssignments.returnedAt), isNull(itAssets.deletedAt), assignmentScope,
      eq(itAssetAssignments.kind, "loan"),
      sql`${itAssetAssignments.expectedReturnDate} < ${today}::date`,
    )).groupBy(worksites.name),

    ticketBase().where(and(
      sql`${itTickets.status} IN ${OPEN_TICKET_STATUSES}`, ticketScope,
      sql`${itTickets.dueAt} < ${nowIso}::timestamptz`,
    )).groupBy(worksites.name),

    ticketBase().where(and(
      sql`${itTickets.status} IN ${OPEN_TICKET_STATUSES}`, ticketScope,
      sql`${itTickets.dueAt} >= ${nowIso}::timestamptz`,
      sql`${itTickets.dueAt} <= ${nowIso}::timestamptz + ${TICKET_WARNING_INTERVAL}`,
    )).groupBy(worksites.name),

    db.select({ name: worksites.name, total: countBy })
      .from(itAssets)
      .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
      .where(and(
        liveParkAsset,
        sql`${itAssets.warrantyEndDate} >= ${today}`,
        sql`${itAssets.warrantyEndDate} <= (${today}::date + 30)::text`,
      )).groupBy(worksites.name),

    // Las licencias no tienen faena propia: se acotan por las de sus
    // asignaciones (`licenseScopeCondition`) y se cuentan sin desglose.
    db.select({ name: sql<string | null>`null`, total: countBy })
      .from(itLicenses)
      .where(and(
        licenseScopeCondition(scope),
        eq(itLicenses.isActive, true),
        sql`${itLicenses.renewalDate} >= ${today}`,
        sql`${itLicenses.renewalDate} <= (${today}::date + 14)::text`,
      )),

    db.select({ name: worksites.name, total: sql<number>`count(distinct ${workers.id})::int` })
      .from(itSystemAccess)
      .innerJoin(workers, eq(itSystemAccess.workerId, workers.id))
      .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
      .where(and(eq(workers.isActive, false), eq(itSystemAccess.status, "activo"), workerScope))
      .groupBy(worksites.name),

    db.select({ name: worksites.name, total: countBy })
      .from(itWorkerChecklists)
      .innerJoin(workers, eq(itWorkerChecklists.workerId, workers.id))
      .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
      .where(and(
        eq(itWorkerChecklists.kind, "offboarding"),
        isNull(itWorkerChecklists.completedAt),
        workerScope,
        sql`EXISTS (SELECT 1 FROM ${itChecklistTasks} t WHERE t.checklist_id = ${itWorkerChecklists.id} AND t.done = false)`,
      )).groupBy(worksites.name),

    // Días en reparación = desde el último movimiento de estado del historial;
    // sin historial se usa la última edición del activo.
    db.select({ name: worksites.name, total: countBy })
      .from(itAssets)
      .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
      .where(and(
        liveAsset,
        eq(itAssets.status, "en_reparacion"),
        sql`coalesce(
          (SELECT max(h.created_at) FROM it_asset_history h
            WHERE h.asset_id = ${itAssets.id} AND h.action IN ('status_changed', 'assigned', 'returned')),
          ${itAssets.updatedAt}
        ) < ${nowIso}::timestamptz - interval '14 days'`,
      )).groupBy(worksites.name),
  ])

  const items = [
    toItem({ key: "acuse", label: "Actas sin acuse de recibo", hint: "Registra el acuse o declara que no hubo", href: "/ti/asignaciones?acuse=pendiente" }, unsigned),
    toItem({ key: "prestamos", label: "Préstamos vencidos", hint: "Pide la devolución o renueva el plazo", href: "/ti/asignaciones?prestamo=vencido" }, overdueLoans),
    toItem({ key: "tickets-vencidos", label: "Tickets fuera de plazo", hint: "Ya pasó el plazo de atención", href: "/ti/tickets?vencimiento=vencido" }, overdueTickets),
    toItem({ key: "tickets-por-vencer", label: "Tickets que vencen en 24 horas", hint: "Atiéndelos antes de que se atrasen", href: "/ti/tickets?vencimiento=por_vencer" }, dueSoonTickets),
    toItem({ key: "garantias", label: "Garantías que vencen en 30 días", hint: "Reclama o cotiza reemplazo a tiempo", href: "/ti/garantias?ventana=expiring_30" }, warranties),
    toItem({ key: "licencias", label: "Licencias por renovar en 14 días", hint: "Confirma la renovación con el responsable", href: "/ti/licencias?renovacion=proxima" }, licenses),
    toItem({ key: "accesos-inactivos", label: "Ex trabajadores con accesos activos", hint: "Revoca los accesos que siguen abiertos", href: "/ti/accesos?revision=inactivos" }, inactiveAccess),
    toItem({ key: "egresos", label: "Egresos con tareas pendientes", hint: "Completa la lista de egreso", href: "/ti/accesos?vista=ingreso-egreso" }, offboardings),
    toItem({ key: "reparaciones", label: "Equipos en reparación hace más de 14 días", hint: "Pregunta al proveedor o da de baja", href: "/ti/activos?estado=en_reparacion" }, longRepairs),
  ]
  return items.filter((item) => item.total > 0)
}

/** Equipos del parque vigente por faena, partidos en 4 grupos de estado. */
export async function getAssetsByWorksiteGroup(scope?: SQL) {
  return db
    .select({
      worksiteName: sql<string>`coalesce(${worksites.name}, 'Sin faena')`,
      inUse: sql<number>`count(*) filter (where ${itAssets.status} IN ('asignado', 'en_prestamo'))::int`,
      available: sql<number>`count(*) filter (where ${itAssets.status} = 'disponible')::int`,
      inRepair: sql<number>`count(*) filter (where ${itAssets.status} = 'en_reparacion')::int`,
      other: sql<number>`count(*) filter (where ${itAssets.status} NOT IN ('asignado', 'en_prestamo', 'disponible', 'en_reparacion'))::int`,
    })
    .from(itAssets)
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .where(activeParkWhere(scope))
    .groupBy(worksites.name)
    .orderBy(sql`count(*) DESC`)
}
