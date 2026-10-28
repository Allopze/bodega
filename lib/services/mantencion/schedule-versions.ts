import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantScheduleBrandRules, mantScheduleGroups, mantScheduleIntervals, mantScheduleItemIntervals,
  mantScheduleItems, mantSchedules, mantScheduleVersions,
} from "@/db/schema"
import type { MantBrandRuleValue, MantScheduleSnapshot, MantUnit } from "@/lib/mantencion/types"

/**
 * Versiones de pauta (regla 15).
 *
 * INVARIANTE del módulo: toda pauta viva tiene una fila en
 * `mant_schedule_versions` con `version = mant_schedules.version` y el snapshot
 * de su estado actual. Quien edita una pauta (editor, asignación no, seed sí)
 * termina su transacción con `publishScheduleVersion`, que sube la versión y
 * escribe el snapshot. La app del mecánico descarga ese snapshot y el servidor
 * revalida cada preventiva contra la versión con que se firmó.
 */

type Reader = Pick<Tx, "select">

/** Arma el snapshot del estado ACTUAL de la pauta (sólo intervalos e ítems activos). */
export async function buildScheduleSnapshot(client: Reader, scheduleId: string, version: number): Promise<MantScheduleSnapshot> {
  const [schedule] = await client.select().from(mantSchedules).where(eq(mantSchedules.id, scheduleId)).limit(1)
  if (!schedule) throw new Error(`Pauta ${scheduleId} no existe`)
  const [intervals, groups, items] = await Promise.all([
    client.select().from(mantScheduleIntervals)
      .where(and(eq(mantScheduleIntervals.scheduleId, scheduleId), eq(mantScheduleIntervals.isActive, true)))
      .orderBy(asc(mantScheduleIntervals.value)),
    client.select().from(mantScheduleGroups)
      .where(eq(mantScheduleGroups.scheduleId, scheduleId))
      .orderBy(asc(mantScheduleGroups.sortOrder), asc(mantScheduleGroups.createdAt)),
    client.select().from(mantScheduleItems)
      .where(and(eq(mantScheduleItems.scheduleId, scheduleId), eq(mantScheduleItems.isActive, true)))
      .orderBy(asc(mantScheduleItems.sortOrder), asc(mantScheduleItems.createdAt)),
  ])
  const itemIds = items.map((item) => item.id)
  const [matrix, rules] = await Promise.all([
    itemIds.length
      ? client.select().from(mantScheduleItemIntervals).where(inArray(mantScheduleItemIntervals.itemId, itemIds))
      : Promise.resolve([]),
    client.select({ itemId: mantScheduleBrandRules.itemId, brandId: mantScheduleBrandRules.brandId, value: mantScheduleBrandRules.value })
      .from(mantScheduleBrandRules)
      .where(and(eq(mantScheduleBrandRules.scheduleId, scheduleId), isNotNull(mantScheduleBrandRules.itemId))),
  ])
  const applies = new Map(matrix.map((cell) => [`${cell.itemId}:${cell.intervalId}`, cell.applies]))
  const keyById = new Map(items.map((item) => [item.id, item.itemKey]))
  return {
    id: schedule.id,
    name: schedule.name,
    unit: schedule.unit as MantUnit,
    version,
    intervals: intervals.map((interval) => interval.value),
    groups: groups
      .map((group) => ({
        name: group.name,
        items: items
          .filter((item) => item.groupId === group.id)
          .map((item) => ({
            key: item.itemKey,
            name: item.name,
            applies: intervals.map((interval) => applies.get(`${item.id}:${interval.id}`) ?? false),
          })),
      }))
      .filter((group) => group.items.length > 0),
    brandRules: rules
      .filter((rule) => rule.itemId && keyById.has(rule.itemId))
      .map((rule) => ({ itemKey: keyById.get(rule.itemId!)!, brandId: rule.brandId, value: rule.value as MantBrandRuleValue })),
  }
}

/**
 * Cierra una edición: sube `version` (salvo `initial`, que publica la versión
 * actual tal cual, para el seed) y guarda el snapshot. Debe correr dentro de la
 * misma transacción que el cambio.
 */
export async function publishScheduleVersion(
  tx: Tx,
  input: { scheduleId: string; userId: string | null; summary: string; initial?: boolean },
): Promise<number> {
  const [row] = input.initial
    ? await tx.select({ version: mantSchedules.version }).from(mantSchedules).where(eq(mantSchedules.id, input.scheduleId))
    : await tx.update(mantSchedules)
      .set({ version: sql`${mantSchedules.version} + 1`, updatedAt: new Date().toISOString(), updatedBy: input.userId })
      .where(eq(mantSchedules.id, input.scheduleId))
      .returning({ version: mantSchedules.version })
  if (!row) throw new Error(`Pauta ${input.scheduleId} no existe`)
  const snapshot = await buildScheduleSnapshot(tx, input.scheduleId, row.version)
  await tx.insert(mantScheduleVersions)
    .values({ scheduleId: input.scheduleId, version: row.version, snapshot: snapshot as unknown as Record<string, unknown>, summary: input.summary, createdBy: input.userId })
    .onConflictDoUpdate({
      target: [mantScheduleVersions.scheduleId, mantScheduleVersions.version],
      set: { snapshot: snapshot as unknown as Record<string, unknown>, summary: input.summary },
    })
  return row.version
}

/** Snapshot de una versión concreta (la que usó un borrador). */
export async function getScheduleSnapshot(scheduleId: string, version: number, client: Reader = db): Promise<MantScheduleSnapshot | null> {
  const [row] = await client.select({ snapshot: mantScheduleVersions.snapshot })
    .from(mantScheduleVersions)
    .where(and(eq(mantScheduleVersions.scheduleId, scheduleId), eq(mantScheduleVersions.version, version)))
    .limit(1)
  return (row?.snapshot as unknown as MantScheduleSnapshot | undefined) ?? null
}

/** Snapshots vigentes de varias pautas (la versión actual de cada una). */
export async function getCurrentScheduleSnapshots(scheduleIds: string[], client: Reader = db): Promise<MantScheduleSnapshot[]> {
  if (scheduleIds.length === 0) return []
  const rows = await client.select({ snapshot: mantScheduleVersions.snapshot })
    .from(mantScheduleVersions)
    .innerJoin(mantSchedules, and(
      eq(mantSchedules.id, mantScheduleVersions.scheduleId),
      eq(mantSchedules.version, mantScheduleVersions.version),
    ))
    .where(inArray(mantScheduleVersions.scheduleId, scheduleIds))
  return rows.map((row) => row.snapshot as unknown as MantScheduleSnapshot)
}
