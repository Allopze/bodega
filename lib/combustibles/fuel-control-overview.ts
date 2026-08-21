import type { Session } from "next-auth"
import { and, eq, gte, ilike, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelConsumptionRecords,
  fuelLoads,
  fuelTaeEvidence,
  fuelTaeSubmissions,
  fuelVehicles,
  worksites,
} from "@/db/schema"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { previousPeriod } from "@/lib/services/analytics-module/helpers"
import { buildConsumptionWhere, type ConsumptionFilters } from "./consumption-queries"
import { mergeFuelControlWorksites, percentVariation, type FuelControlWorksiteRow } from "./fuel-control-overview.helpers"
import { can } from "@/lib/auth/can"

export interface FuelControlOverview {
  billed: {
    liters: number
    amount: number | null
    records: number
    variationLitersPct: number | null
  }
  tae: null | {
    liters: number
    loads: number
    equipment: number
    pendingReview: number
    observed: number
    missingSeals: number
    missingEvidence: number
    variationLitersPct: number | null
  }
  byWorksite: FuelControlWorksiteRow[]
}

interface FuelControlOverviewOptions {
  includeTae: boolean
  filters: Required<Pick<ConsumptionFilters, "fromDate" | "toDate">> & ConsumptionFilters
}

export async function getFuelControlOverview(session: Session, options: FuelControlOverviewOptions): Promise<FuelControlOverview> {
  const canViewCosts = can(session, "combustibles:view") && can(session, "combustibles:view_costs")
  const { filters } = options
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const billingWhere = and(
    accountableFuelLoadsWhere(),
    gte(fuelLoads.loadDate, filters.fromDate),
    lte(fuelLoads.loadDate, filters.toDate),
    filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
    filters.patente ? or(ilike(fuelVehicles.plate, `%${filters.patente}%`), ilike(fuelVehicles.code, `%${filters.patente}%`)) : undefined,
    filters.associated === "no" ? sql`false` : undefined,
    worksiteScopeSql(session, fuelLoads.worksiteId),
  )
  const previousBillingWhere = and(
    accountableFuelLoadsWhere(),
    gte(fuelLoads.loadDate, previous.fromDate),
    lte(fuelLoads.loadDate, previous.toDate),
    filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
    filters.patente ? or(ilike(fuelVehicles.plate, `%${filters.patente}%`), ilike(fuelVehicles.code, `%${filters.patente}%`)) : undefined,
    filters.associated === "no" ? sql`false` : undefined,
    worksiteScopeSql(session, fuelLoads.worksiteId),
  )
  const tctWhere = buildConsumptionWhere(session, filters)

  const [[billing], [previousBilling], billedByWorksite, tctByWorksite, taeResult] = await Promise.all([
    db.select({
      liters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
      amount: canViewCosts ? sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)` : sql<null>`null`,
      records: sql<number>`count(*)`,
    }).from(fuelLoads).innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelLoads.vehicleId)).where(billingWhere),
    db.select({ liters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)` })
      .from(fuelLoads).innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelLoads.vehicleId)).where(previousBillingWhere),
    db.select({
      worksiteId: fuelLoads.worksiteId,
      worksiteName: worksites.name,
      liters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
    }).from(fuelLoads)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelLoads.vehicleId))
      .innerJoin(worksites, eq(worksites.id, fuelLoads.worksiteId))
      .where(billingWhere)
      .groupBy(fuelLoads.worksiteId, worksites.name),
    db.select({
      worksiteId: fuelConsumptionRecords.worksiteId,
      worksiteName: worksites.name,
      liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)`,
    }).from(fuelConsumptionRecords)
      .innerJoin(worksites, eq(worksites.id, fuelConsumptionRecords.worksiteId))
      .where(tctWhere)
      .groupBy(fuelConsumptionRecords.worksiteId, worksites.name),
    options.includeTae ? getTaeOverview(session, filters, previous) : Promise.resolve(null),
  ])

  const billedLiters = Number(billing?.liters ?? 0)
  const taeByWorksite = taeResult?.byWorksite ?? []

  return {
    billed: {
      liters: billedLiters,
      amount: canViewCosts ? Number(billing?.amount ?? 0) : null,
      records: Number(billing?.records ?? 0),
      variationLitersPct: percentVariation(billedLiters, Number(previousBilling?.liters ?? 0)),
    },
    tae: taeResult?.summary ?? null,
    byWorksite: mergeFuelControlWorksites({
      billed: billedByWorksite.map(toWorksiteChannel),
      tae: taeByWorksite.map(toWorksiteChannel),
      tct: tctByWorksite.map(toWorksiteChannel),
    }),
  }
}

async function getTaeOverview(
  session: Session,
  filters: Required<Pick<ConsumptionFilters, "fromDate" | "toDate">> & ConsumptionFilters,
  previous: { fromDate: string; toDate: string },
) {
  const currentWhere = taeWhere(session, { ...filters, fromDate: filters.fromDate, toDate: filters.toDate })
  const previousWhere = taeWhere(session, { ...filters, fromDate: previous.fromDate, toDate: previous.toDate })
  const [[current], [previousRow], byWorksite] = await Promise.all([
    db.select({
      liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
      loads: sql<number>`count(*)`,
      equipment: sql<number>`count(distinct ${fuelTaeSubmissions.equipmentCodeSnapshot})`,
      pendingReview: sql<number>`count(*) filter (where ${fuelTaeSubmissions.status} = 'submitted')`,
      observed: sql<number>`count(*) filter (where ${fuelTaeSubmissions.status} = 'observed')`,
      missingSeals: sql<number>`count(*) filter (where ${fuelTaeSubmissions.removedSealNumber} is null or btrim(${fuelTaeSubmissions.removedSealNumber}) = '' or ${fuelTaeSubmissions.installedSealNumber} is null or btrim(${fuelTaeSubmissions.installedSealNumber}) = '')`,
      missingEvidence: sql<number>`count(*) filter (where (select count(distinct ${fuelTaeEvidence.kind}) from ${fuelTaeEvidence} where ${fuelTaeEvidence.submissionId} = ${fuelTaeSubmissions.id}) < 4)`,
    }).from(fuelTaeSubmissions).where(currentWhere),
    db.select({ liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)` })
      .from(fuelTaeSubmissions).where(previousWhere),
    db.select({
      worksiteId: fuelTaeSubmissions.worksiteId,
      worksiteName: worksites.name,
      liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)`,
    }).from(fuelTaeSubmissions)
      .innerJoin(worksites, eq(worksites.id, fuelTaeSubmissions.worksiteId))
      .where(currentWhere)
      .groupBy(fuelTaeSubmissions.worksiteId, worksites.name),
  ])

  const liters = Number(current?.liters ?? 0)
  return {
    summary: {
      liters,
      loads: Number(current?.loads ?? 0),
      equipment: Number(current?.equipment ?? 0),
      pendingReview: Number(current?.pendingReview ?? 0),
      observed: Number(current?.observed ?? 0),
      missingSeals: Number(current?.missingSeals ?? 0),
      missingEvidence: Number(current?.missingEvidence ?? 0),
      variationLitersPct: percentVariation(liters, Number(previousRow?.liters ?? 0)),
    },
    byWorksite,
  }
}

function taeWhere(session: Session, filters: ConsumptionFilters & { fromDate: string; toDate: string }) {
  return and(
    ne(fuelTaeSubmissions.status, "voided"),
    sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date >= ${filters.fromDate}::date`,
    sql`(${fuelTaeSubmissions.loadedAt} at time zone 'America/Santiago')::date <= ${filters.toDate}::date`,
    filters.worksiteId ? eq(fuelTaeSubmissions.worksiteId, filters.worksiteId) : undefined,
    filters.patente ? or(ilike(fuelTaeSubmissions.plateSnapshot, `%${filters.patente}%`), ilike(fuelTaeSubmissions.equipmentCodeSnapshot, `%${filters.patente}%`)) : undefined,
    filters.associated === "yes" ? isNotNull(fuelTaeSubmissions.vehicleId) : undefined,
    filters.associated === "no" ? isNull(fuelTaeSubmissions.vehicleId) : undefined,
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
  )
}

function toWorksiteChannel(row: { worksiteId: string | null; worksiteName: string; liters: number }) {
  return {
    worksiteId: row.worksiteId ?? "unassigned",
    worksiteName: row.worksiteName,
    liters: Number(row.liters),
  }
}
