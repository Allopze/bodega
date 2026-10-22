import type { Session } from "next-auth"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeEvidence, fuelTaeLoadingPoints, fuelTaeSubmissions, fuelSupplyMedia, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { mandanteWorksitesSql, type ControlFilters } from "../filters"
import type { LoadingPointType, SealChainStatus } from "../contracts"
import { RESERVED_LABEL, sealMissingSql, submissionWhere } from "./field-filters"

/**
 * Control de sellos por supervisor y detalle por equipo (C-04..C-07).
 * Nombres de personas solo con `combustibles:view_personal`; sin el permiso el
 * agrupado y los conteos siguen igual pero el nombre sale «Reservado».
 */

export interface PersonalAccess { canViewPersonal: boolean }

export interface SupervisorSealRow {
  key: string
  name: string
  loads: number
  liters: number
  /** C-05: cargas iniciadas sin sello retirado. */
  withoutRemovedSeal: number
  /** C-06: cargas terminadas sin sello nuevo instalado. */
  withoutInstalledSeal: number
  /** Cargas cuyo sello retirado no es el instalado en la carga anterior. */
  chainBreaks: number
}

export interface SealJustificationRow {
  supervisorKey: string
  submissionId: string
  loadedAt: string
  equipment: string
  missing: "removed" | "installed" | "both"
  reason: string | null
}

const SUPERVISOR_KEY = sql<string>`coalesce(${fuelTaeSubmissions.supervisorWorkerId}, 'n:' || upper(btrim(regexp_replace(${fuelTaeSubmissions.supervisorNameSnapshot}, '\\s+', ' ', 'g'))))`

/** C-04/C-05/C-06 en una sola pasada: cargas, litros y faltas de sello por supervisor. */
export async function getSupervisorSealSummary(session: Session | null, filters: ControlFilters, access: PersonalAccess): Promise<SupervisorSealRow[]> {
  const rows = await db.select({
    key: SUPERVISOR_KEY,
    name: sql<string>`max(${fuelTaeSubmissions.supervisorNameSnapshot})`,
    loads: sql<number>`count(*)::int`,
    liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8`,
    withoutRemovedSeal: sql<number>`(count(*) filter (where ${sealMissingSql(fuelTaeSubmissions.removedSealNumber)}))::int`,
    withoutInstalledSeal: sql<number>`(count(*) filter (where ${sealMissingSql(fuelTaeSubmissions.installedSealNumber)}))::int`,
    chainBreaks: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.sealChainStatus} = 'mismatch'))::int`,
  }).from(fuelTaeSubmissions)
    .where(submissionWhere(session, filters))
    .groupBy(SUPERVISOR_KEY)
    .orderBy(desc(sql`count(*)`), SUPERVISOR_KEY)
  return rows.map((row, index) => ({
    ...row,
    // Con nombre reservado la llave deja de ser derivable del nombre.
    key: access.canViewPersonal ? row.key : `s${index}`,
    name: access.canViewPersonal ? row.name : RESERVED_LABEL,
  }))
}

const JUSTIFICATION_LIMIT_PER_SUPERVISOR = 20

/** Cargas sin sello con su motivo declarado, hasta 20 por supervisor (las más recientes). */
export async function getSealJustifications(session: Session | null, filters: ControlFilters, access: PersonalAccess): Promise<SealJustificationRow[]> {
  const missingRemoved = sealMissingSql(fuelTaeSubmissions.removedSealNumber)
  const missingInstalled = sealMissingSql(fuelTaeSubmissions.installedSealNumber)
  const ranked = db.select({
    key: SUPERVISOR_KEY.as("sup_key"),
    id: fuelTaeSubmissions.id,
    loadedAt: fuelTaeSubmissions.loadedAt,
    equipment: sql<string>`coalesce(${fuelVehicles.code}, ${fuelTaeSubmissions.equipmentCodeSnapshot})`.as("equipment"),
    removedMissing: sql<boolean>`${missingRemoved}`.as("removed_missing"),
    installedMissing: sql<boolean>`${missingInstalled}`.as("installed_missing"),
    reason: fuelTaeSubmissions.noSealReason,
    rank: sql<number>`row_number() over (partition by ${SUPERVISOR_KEY} order by ${fuelTaeSubmissions.loadedAt} desc)`.as("rank"),
  }).from(fuelTaeSubmissions)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId))
    .where(and(submissionWhere(session, filters), sql`(${missingRemoved} or ${missingInstalled})`))
    .as("ranked")
  const rows = await db.select().from(ranked).where(sql`${ranked.rank} <= ${JUSTIFICATION_LIMIT_PER_SUPERVISOR}`).orderBy(ranked.key, desc(ranked.loadedAt))

  // El mapa de llaves enmascaradas debe coincidir con el de `getSupervisorSealSummary` (mismo orden).
  const maskedKeys = access.canViewPersonal ? null : await maskedKeyMap(session, filters)
  return rows.map((row) => ({
    supervisorKey: maskedKeys ? (maskedKeys.get(row.key) ?? "s?") : row.key,
    submissionId: row.id,
    loadedAt: row.loadedAt,
    equipment: row.equipment,
    missing: row.removedMissing && row.installedMissing ? "both" : row.removedMissing ? "removed" : "installed",
    reason: row.reason?.trim() ? row.reason.trim() : null,
  }))
}

async function maskedKeyMap(session: Session | null, filters: ControlFilters): Promise<Map<string, string>> {
  const rows = await db.select({ key: SUPERVISOR_KEY }).from(fuelTaeSubmissions)
    .where(submissionWhere(session, filters))
    .groupBy(SUPERVISOR_KEY)
    .orderBy(desc(sql`count(*)`), SUPERVISOR_KEY)
  return new Map(rows.map((row, index) => [row.key, `s${index}`]))
}

export interface SealDetailRow {
  id: string
  loadedAt: string
  loadedAtSource: string
  equipment: string
  plate: string | null
  worksiteName: string
  loadingPointType: LoadingPointType | null
  loadingPointName: string | null
  mediumName: string | null
  liters: number
  meterType: string
  meterReading: number | null
  driver: string
  supervisor: string
  removedSeal: string | null
  installedSeal: string | null
  noSealReason: string | null
  sealChainStatus: SealChainStatus
  sealChainExpected: string | null
  notes: string | null
  evidenceCount: number
}

const evidenceCountSql = sql<number>`(select count(*)::int from ${fuelTaeEvidence} where ${fuelTaeEvidence.submissionId} = ${fuelTaeSubmissions.id})`

/** C-07: detalle de cargas con todas las columnas, paginado, con filtro por equipo. */
export async function listSealDetail(
  session: Session | null,
  filters: ControlFilters,
  access: PersonalAccess & { limit: number; offset: number },
): Promise<{ rows: SealDetailRow[]; total: number }> {
  const where = submissionWhere(session, filters, { withEquipment: true })
  const [rows, totals] = await Promise.all([
    db.select({
      id: fuelTaeSubmissions.id,
      loadedAt: fuelTaeSubmissions.loadedAt,
      loadedAtSource: fuelTaeSubmissions.loadedAtSource,
      equipment: sql<string>`coalesce(${fuelVehicles.code}, ${fuelTaeSubmissions.equipmentCodeSnapshot})`,
      plate: sql<string | null>`coalesce(${fuelVehicles.plate}, ${fuelTaeSubmissions.plateSnapshot})`,
      worksiteName: worksites.name,
      loadingPointType: fuelTaeLoadingPoints.type,
      loadingPointName: fuelTaeLoadingPoints.name,
      mediumName: fuelSupplyMedia.name,
      liters: fuelTaeSubmissions.liters,
      meterType: fuelTaeSubmissions.meterType,
      meterReading: fuelTaeSubmissions.meterReading,
      driver: fuelTaeSubmissions.driverNameSnapshot,
      supervisor: fuelTaeSubmissions.supervisorNameSnapshot,
      removedSeal: fuelTaeSubmissions.removedSealNumber,
      installedSeal: fuelTaeSubmissions.installedSealNumber,
      noSealReason: fuelTaeSubmissions.noSealReason,
      sealChainStatus: fuelTaeSubmissions.sealChainStatus,
      sealChainExpected: fuelTaeSubmissions.sealChainExpected,
      notes: fuelTaeSubmissions.notes,
      evidenceCount: evidenceCountSql,
    }).from(fuelTaeSubmissions)
      .innerJoin(worksites, eq(worksites.id, fuelTaeSubmissions.worksiteId))
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId))
      .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeLoadingPoints.id, fuelTaeSubmissions.loadingPointId))
      .leftJoin(fuelSupplyMedia, eq(fuelSupplyMedia.id, fuelTaeSubmissions.supplyMediumId))
      .where(where)
      .orderBy(desc(fuelTaeSubmissions.loadedAt), desc(fuelTaeSubmissions.id))
      .limit(access.limit).offset(access.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(fuelTaeSubmissions).where(where),
  ])
  return {
    total: totals[0]?.total ?? 0,
    rows: rows.map((row) => ({
      ...row,
      loadingPointType: (row.loadingPointType as LoadingPointType | null) ?? null,
      sealChainStatus: row.sealChainStatus as SealChainStatus,
      driver: access.canViewPersonal ? row.driver : RESERVED_LABEL,
      supervisor: access.canViewPersonal ? row.supervisor : RESERVED_LABEL,
    })),
  }
}

/** Equipos con cargas de terreno en el alcance y mandante (sin período: el selector no debe cambiar de contenido al mover el mes). */
export async function listSealVehicles(session: Session | null, filters: ControlFilters): Promise<Array<{ id: string; label: string }>> {
  const rows = await db.selectDistinct({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelTaeSubmissions)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId))
    .where(and(
      sql`${fuelTaeSubmissions.status} <> 'voided'`,
      worksiteScopeSql(session, fuelTaeSubmissions.worksiteId, filters.worksiteId),
      filters.mandanteId ? sql`${fuelTaeSubmissions.worksiteId} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
    ))
    .orderBy(fuelVehicles.code, fuelVehicles.plate)
    .limit(500)
  return rows.map((row) => ({ id: row.id, label: row.code ? `${row.code} · ${row.plate}` : row.plate }))
}
