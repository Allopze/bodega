import { eq, and, isNull, sql, type SQL } from "drizzle-orm"
import { IT_RETIRED_STATUSES } from "./constants"
import { db } from "@/db"
import {
  itAssets, itAssetTypes, itMaintenances, itTickets, itLicenses,
  itAssetAssignments, worksites,
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
  return db
    .select({
      tramo: sql<string>`CASE
        WHEN ${itAssets.purchaseDate} IS NULL THEN 'sin fecha'
        WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 365 THEN '0-1 año'
        WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 1095 THEN '1-3 años'
        WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 1825 THEN '3-5 años'
        ELSE '5+ años'
      END`,
      total: sql<number>`count(*)::int`,
    })
    .from(itAssets)
    .where(where)
    .groupBy(sql`CASE
      WHEN ${itAssets.purchaseDate} IS NULL THEN 'sin fecha'
      WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 365 THEN '0-1 año'
      WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 1095 THEN '1-3 años'
      WHEN (${todayInChile()}::date - ${itAssets.purchaseDate}::date) <= 1825 THEN '3-5 años'
      ELSE '5+ años'
    END`)
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
