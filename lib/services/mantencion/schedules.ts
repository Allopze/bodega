import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelVehicles, mantBrands, mantEquipmentProfiles, mantScheduleBrandRules, mantScheduleGroups, mantScheduleIntervals,
  mantScheduleItemIntervals, mantScheduleItems, mantSchedules, worksites,
} from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import { inheritedIntervalFor } from "@/lib/mantencion/schedule"
import type { MantBrandRuleValue, MantUnit } from "@/lib/mantencion/types"
import { formatDate, todayInChile } from "@/lib/utils"
import type { MantActionResult } from "./result"
import { writeEquipmentHistory, type MantActor } from "./equipment-history"
import { publishScheduleVersion } from "./schedule-versions"

/**
 * Pautas (§10): lectura para la lista y el editor, alta (vacía o copia de otra)
 * y eliminación. Las ediciones finas —celdas, ítems, intervalos, reglas— están
 * en `schedule-editor.ts`; la asignación de equipos, en `schedule-assign.ts`.
 * Todo cambio de pauta termina publicando una versión (regla 15) en la misma
 * transacción; el permiso `mant:schedules:manage` lo exige la acción.
 */

export const MAX_SCHEDULE_INTERVALS = 12

export interface ScheduleListRow {
  id: string
  name: string
  unit: MantUnit
  intervals: number[]
  itemCount: number
  equipmentCount: number
  hasBrandRules: boolean
  version: number
}

/** Lista de pautas vivas con lo que muestra la tabla: intervalos, ítems, equipos y reglas por marca. */
export async function listSchedules(): Promise<ScheduleListRow[]> {
  const schedules = await db.select().from(mantSchedules).where(isNull(mantSchedules.deletedAt)).orderBy(asc(mantSchedules.name))
  if (schedules.length === 0) return []
  const ids = schedules.map((schedule) => schedule.id)
  const [intervals, items, equipment, rules] = await Promise.all([
    db.select({ scheduleId: mantScheduleIntervals.scheduleId, value: mantScheduleIntervals.value })
      .from(mantScheduleIntervals)
      .where(and(inArray(mantScheduleIntervals.scheduleId, ids), eq(mantScheduleIntervals.isActive, true)))
      .orderBy(asc(mantScheduleIntervals.value)),
    db.select({ scheduleId: mantScheduleItems.scheduleId, n: sql<number>`count(*)::int` })
      .from(mantScheduleItems)
      .where(and(inArray(mantScheduleItems.scheduleId, ids), eq(mantScheduleItems.isActive, true)))
      .groupBy(mantScheduleItems.scheduleId),
    db.select({ scheduleId: mantEquipmentProfiles.scheduleId, n: sql<number>`count(*)::int` })
      .from(mantEquipmentProfiles)
      .innerJoin(fuelVehicles, and(eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId), eq(fuelVehicles.isActive, true)))
      .where(inArray(mantEquipmentProfiles.scheduleId, ids))
      .groupBy(mantEquipmentProfiles.scheduleId),
    db.selectDistinct({ scheduleId: mantScheduleBrandRules.scheduleId })
      .from(mantScheduleBrandRules)
      .where(inArray(mantScheduleBrandRules.scheduleId, ids)),
  ])
  const itemCount = new Map(items.map((row) => [row.scheduleId, row.n]))
  const equipmentCount = new Map(equipment.map((row) => [row.scheduleId ?? "", row.n]))
  const withRules = new Set(rules.map((row) => row.scheduleId))
  return schedules.map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    unit: schedule.unit as MantUnit,
    intervals: intervals.filter((row) => row.scheduleId === schedule.id).map((row) => row.value),
    itemCount: itemCount.get(schedule.id) ?? 0,
    equipmentCount: equipmentCount.get(schedule.id) ?? 0,
    hasBrandRules: withRules.has(schedule.id),
    version: schedule.version,
  }))
}

export interface EditorInterval { id: string; value: number; needsReview: boolean }
export interface EditorItem {
  id: string
  key: string
  name: string
  /** Aviso del editor, p. ej. «Por confirmar» (decisión §19-1). */
  note: string | null
  /** Si aplica en cada intervalo, por id de intervalo. */
  applies: Record<string, boolean>
}
export interface EditorGroup { id: string; name: string; items: EditorItem[] }
export interface EditorBrandRuleRow {
  /** Nombre de la actividad en la planilla; es la clave de la fila. */
  activity: string
  /** La fila corresponde a un ítem vivo de la pauta (las demás no afectan la app). */
  inSchedule: boolean
  values: Record<string, MantBrandRuleValue>
}

export interface ScheduleEditorModel {
  id: string
  name: string
  unit: MantUnit
  version: number
  origin: string | null
  intervals: EditorInterval[]
  groups: EditorGroup[]
  brandRules: { brands: Array<{ id: string; name: string }>; rows: EditorBrandRuleRow[] }
  equipment: { total: number; byWorksite: Array<{ worksiteId: string; worksiteName: string; count: number }> }
}

/** Todo lo que el editor necesita de una pauta viva, o `null` si no existe. */
export async function loadScheduleEditor(scheduleId: string): Promise<ScheduleEditorModel | null> {
  const [schedule] = await db.select().from(mantSchedules)
    .where(and(eq(mantSchedules.id, scheduleId), isNull(mantSchedules.deletedAt))).limit(1)
  if (!schedule) return null
  const [intervals, groups, items, rules, equipment] = await Promise.all([
    db.select().from(mantScheduleIntervals)
      .where(and(eq(mantScheduleIntervals.scheduleId, scheduleId), eq(mantScheduleIntervals.isActive, true)))
      .orderBy(asc(mantScheduleIntervals.value)),
    db.select().from(mantScheduleGroups).where(eq(mantScheduleGroups.scheduleId, scheduleId))
      .orderBy(asc(mantScheduleGroups.sortOrder), asc(mantScheduleGroups.createdAt)),
    db.select().from(mantScheduleItems)
      .where(and(eq(mantScheduleItems.scheduleId, scheduleId), eq(mantScheduleItems.isActive, true)))
      .orderBy(asc(mantScheduleItems.sortOrder), asc(mantScheduleItems.createdAt)),
    db.select({
      activity: mantScheduleBrandRules.sheetActivity, itemId: mantScheduleBrandRules.itemId,
      brandId: mantScheduleBrandRules.brandId, brandName: mantBrands.name, value: mantScheduleBrandRules.value,
    })
      .from(mantScheduleBrandRules)
      .innerJoin(mantBrands, eq(mantBrands.id, mantScheduleBrandRules.brandId))
      .where(eq(mantScheduleBrandRules.scheduleId, scheduleId))
      .orderBy(asc(mantScheduleBrandRules.sheetActivity)),
    db.select({ worksiteId: worksites.id, worksiteName: worksites.name, n: sql<number>`count(*)::int` })
      .from(mantEquipmentProfiles)
      .innerJoin(fuelVehicles, and(eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId), eq(fuelVehicles.isActive, true)))
      .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
      .where(eq(mantEquipmentProfiles.scheduleId, scheduleId))
      .groupBy(worksites.id, worksites.name),
  ])
  const itemIds = items.map((item) => item.id)
  const cells = itemIds.length
    ? await db.select().from(mantScheduleItemIntervals).where(inArray(mantScheduleItemIntervals.itemId, itemIds))
    : []
  const cellMap = new Map(cells.map((cell) => [`${cell.itemId}:${cell.intervalId}`, cell.applies]))
  const liveItemIds = new Set(itemIds)

  const brands = new Map<string, string>()
  const rows = new Map<string, EditorBrandRuleRow>()
  for (const rule of rules) {
    brands.set(rule.brandId, rule.brandName)
    const row = rows.get(rule.activity) ?? { activity: rule.activity, inSchedule: false, values: {} }
    row.inSchedule = row.inSchedule || (rule.itemId !== null && liveItemIds.has(rule.itemId))
    row.values[rule.brandId] = rule.value as MantBrandRuleValue
    rows.set(rule.activity, row)
  }
  const equipmentRows = equipment
    .map((row) => ({ worksiteId: row.worksiteId, worksiteName: row.worksiteName, count: row.n }))
    .sort((a, b) => b.count - a.count || a.worksiteName.localeCompare(b.worksiteName, "es"))

  return {
    id: schedule.id,
    name: schedule.name,
    unit: schedule.unit as MantUnit,
    version: schedule.version,
    origin: schedule.origin,
    intervals: intervals.map((interval) => ({ id: interval.id, value: interval.value, needsReview: interval.needsReview })),
    groups: groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        items: items.filter((item) => item.groupId === group.id).map((item) => ({
          id: item.id,
          key: item.itemKey,
          name: item.name,
          note: item.note,
          applies: Object.fromEntries(intervals.map((interval) => [interval.id, cellMap.get(`${item.id}:${interval.id}`) ?? false])),
        })),
      }))
      // Un sistema sin ítems vivos no se muestra: reaparece si se deshace el último «Quitar».
      .filter((group) => group.items.length > 0),
    brandRules: {
      brands: [...brands].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es")),
      rows: [...rows.values()],
    },
    equipment: { total: equipmentRows.reduce((sum, row) => sum + row.count, 0), byWorksite: equipmentRows },
  }
}

/** «10000, 20.000 40000» → `[10000, 20000, 40000]`; `null` si algún valor no es un entero positivo. */
export function parseIntervalList(text: string): number[] | null {
  const tokens = text.split(/[,;\s]+/).map((token) => token.replace(/\./g, "")).filter(Boolean)
  if (tokens.length === 0) return null
  const values: number[] = []
  for (const token of tokens) {
    if (!/^\d{1,7}$/.test(token)) return null
    const value = Number(token)
    if (value <= 0) return null
    values.push(value)
  }
  return [...new Set(values)].sort((a, b) => a - b)
}

export interface CreateScheduleInput {
  name: string
  unit: MantUnit
  intervals: number[]
  /** Pauta de la que se copian sistemas, ítems y reglas por marca; `null` = pauta vacía. */
  copyFromId: string | null
}

type FieldFailure = { ok: false; message: string; field?: string }

/** Nombre de pauta: 2 a 80 caracteres y único (normalizado) entre las vivas. */
export async function checkScheduleName(
  client: Pick<Tx, "select">,
  rawName: string,
  exceptId: string | null,
): Promise<{ ok: true; name: string; key: string } | FieldFailure> {
  const name = cleanName(rawName)
  if (name.length < 2) return { ok: false, message: "Escribe un nombre para la pauta.", field: "name" }
  if (name.length > 80) return { ok: false, message: "El nombre de la pauta no puede pasar de 80 caracteres.", field: "name" }
  const key = nameKey(name)
  const [clash] = await client.select({ id: mantSchedules.id }).from(mantSchedules)
    .where(and(eq(mantSchedules.nameKey, key), isNull(mantSchedules.deletedAt))).limit(1)
  if (clash && clash.id !== exceptId) return { ok: false, message: "Ya existe una pauta con ese nombre.", field: "name" }
  return { ok: true, name, key }
}

/** Crea una pauta vacía o copia de otra de la misma unidad, y publica su versión 1. */
export async function createSchedule(actor: MantActor, input: CreateScheduleInput): Promise<MantActionResult<{ id: string }>> {
  if (input.unit !== "km" && input.unit !== "h") return { ok: false, message: "Elige si la pauta se mide en kilómetros o en horas.", field: "unit" }
  if (input.intervals.length === 0) return { ok: false, message: "Escribe al menos un intervalo (números mayores que 0).", field: "intervals" }
  if (input.intervals.length > MAX_SCHEDULE_INTERVALS) {
    return { ok: false, message: `Una pauta admite hasta ${MAX_SCHEDULE_INTERVALS} intervalos.`, field: "intervals" }
  }
  try {
    return await db.transaction(async (tx) => {
      const named = await checkScheduleName(tx, input.name, null)
      if (!named.ok) return named
      let source: { id: string; name: string } | null = null
      if (input.copyFromId) {
        const [row] = await tx.select().from(mantSchedules)
          .where(and(eq(mantSchedules.id, input.copyFromId), isNull(mantSchedules.deletedAt))).limit(1)
        if (!row) return { ok: false as const, message: "La pauta que quieres copiar ya no existe.", field: "copyFromId" }
        if (row.unit !== input.unit) return { ok: false as const, message: "Solo se puede copiar una pauta que se mida en la misma unidad.", field: "copyFromId" }
        source = { id: row.id, name: row.name }
      }
      const id = nanoid()
      const origin = `${source ? `Copia de «${source.name}». ` : ""}Creada por ${actor.email ?? "jefatura"} el ${formatDate(todayInChile())}.`
      await tx.insert(mantSchedules).values({ id, name: named.name, nameKey: named.key, unit: input.unit, origin, version: 1, updatedBy: actor.userId })
      if (source) await copyScheduleBody(tx, source.id, id, input.intervals)
      else await tx.insert(mantScheduleIntervals).values(input.intervals.map((value) => ({ id: nanoid(), scheduleId: id, value })))
      await publishScheduleVersion(tx, { scheduleId: id, userId: actor.userId, summary: source ? `Pauta creada a partir de «${source.name}»` : "Pauta creada", initial: true })
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "create",
        entityType: "mant_schedule", entityId: id, entityCode: named.name,
        newState: { name: named.name, unit: input.unit, intervals: input.intervals, copiedFrom: source?.name ?? null },
      }, tx)
      return { ok: true as const, data: { id }, message: source ? `Pauta creada a partir de «${source.name}». Ajusta los ítems y asigna equipos.` : "Pauta creada. Agrega ítems y asigna equipos." }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: "Ya existe una pauta con ese nombre.", field: "name" }
    throw error
  }
}

/**
 * Copia sistemas, ítems (con su clave estable), matriz y reglas por marca. Un
 * intervalo que la pauta de origen no tenía hereda su columna (regla 15) y
 * queda «por revisar».
 */
async function copyScheduleBody(tx: Tx, sourceId: string, targetId: string, values: number[]) {
  const [intervals, groups, items, rules] = await Promise.all([
    tx.select().from(mantScheduleIntervals).where(and(eq(mantScheduleIntervals.scheduleId, sourceId), eq(mantScheduleIntervals.isActive, true))),
    tx.select().from(mantScheduleGroups).where(eq(mantScheduleGroups.scheduleId, sourceId)).orderBy(asc(mantScheduleGroups.sortOrder)),
    tx.select().from(mantScheduleItems).where(and(eq(mantScheduleItems.scheduleId, sourceId), eq(mantScheduleItems.isActive, true))),
    tx.select().from(mantScheduleBrandRules).where(eq(mantScheduleBrandRules.scheduleId, sourceId)),
  ])
  const sourceValues = intervals.map((interval) => interval.value)
  const newIntervals = values.map((value) => ({ id: nanoid(), scheduleId: targetId, value, needsReview: !sourceValues.includes(value) }))
  await tx.insert(mantScheduleIntervals).values(newIntervals)

  const cells = items.length
    ? await tx.select().from(mantScheduleItemIntervals).where(inArray(mantScheduleItemIntervals.itemId, items.map((item) => item.id)))
    : []
  const sourceApplies = new Map(cells.map((cell) => [`${cell.itemId}:${cell.intervalId}`, cell.applies]))
  const sourceIntervalByValue = new Map(intervals.map((interval) => [interval.value, interval.id]))

  const groupIds = new Map<string, string>()
  const withItems = groups.filter((group) => items.some((item) => item.groupId === group.id))
  if (withItems.length) {
    await tx.insert(mantScheduleGroups).values(withItems.map((group) => {
      const id = nanoid()
      groupIds.set(group.id, id)
      return { id, scheduleId: targetId, name: group.name, sortOrder: group.sortOrder }
    }))
  }
  const itemIds = new Map<string, string>()
  const newItems = items.map((item) => {
    const id = nanoid()
    itemIds.set(item.id, id)
    return { id, scheduleId: targetId, groupId: groupIds.get(item.groupId)!, itemKey: item.itemKey, name: item.name, note: item.note, sortOrder: item.sortOrder }
  })
  if (newItems.length) await tx.insert(mantScheduleItems).values(newItems)
  const newCells = items.flatMap((item) => newIntervals.map((interval) => {
    const from = sourceValues.includes(interval.value) ? interval.value : inheritedIntervalFor(sourceValues, interval.value)
    const sourceInterval = sourceIntervalByValue.get(from)
    return {
      itemId: itemIds.get(item.id)!,
      intervalId: interval.id,
      applies: sourceInterval ? (sourceApplies.get(`${item.id}:${sourceInterval}`) ?? false) : false,
    }
  }))
  if (newCells.length) await tx.insert(mantScheduleItemIntervals).values(newCells)
  if (rules.length) {
    await tx.insert(mantScheduleBrandRules).values(rules.map((rule) => ({
      id: nanoid(), scheduleId: targetId, itemId: rule.itemId ? (itemIds.get(rule.itemId) ?? null) : null,
      sheetActivity: rule.sheetActivity, brandId: rule.brandId, value: rule.value,
    })))
  }
}

/**
 * Elimina una pauta (borrado lógico). Los equipos que la usaban quedan sin
 * pauta, cada uno con su rastro en el historial; los registros ya firmados no
 * cambian porque guardan su propio snapshot.
 */
export async function deleteSchedule(actor: MantActor, scheduleId: string): Promise<MantActionResult<{ released: number }>> {
  return db.transaction(async (tx) => {
    const [schedule] = await tx.select().from(mantSchedules)
      .where(and(eq(mantSchedules.id, scheduleId), isNull(mantSchedules.deletedAt))).for("update").limit(1)
    if (!schedule) return { ok: false as const, message: "Esa pauta ya no existe." }
    const holders = await tx
      .select({ vehicleId: mantEquipmentProfiles.vehicleId })
      .from(mantEquipmentProfiles)
      .where(eq(mantEquipmentProfiles.scheduleId, scheduleId))
    const now = new Date().toISOString()
    if (holders.length) {
      await tx.update(mantEquipmentProfiles)
        .set({ scheduleId: null, updatedAt: now, updatedBy: actor.userId })
        .where(eq(mantEquipmentProfiles.scheduleId, scheduleId))
      for (const holder of holders) {
        await writeEquipmentHistory(tx, {
          vehicleId: holder.vehicleId, action: "schedule_change",
          summary: `Pauta eliminada: «${schedule.name}»`,
          changes: { Pauta: { from: schedule.name, to: null } },
          userId: actor.userId,
        })
      }
    }
    await tx.update(mantSchedules)
      .set({ deletedAt: now, deletedBy: actor.userId, updatedAt: now, updatedBy: actor.userId })
      .where(eq(mantSchedules.id, scheduleId))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "delete",
      entityType: "mant_schedule", entityId: scheduleId, entityCode: schedule.name,
      oldState: { name: schedule.name, version: schedule.version },
      newState: { equipmentWithoutSchedule: holders.length },
    }, tx)
    return {
      ok: true as const,
      data: { released: holders.length },
      message: holders.length ? `Pauta eliminada. ${holders.length === 1 ? "1 equipo quedó" : `${holders.length} equipos quedaron`} sin pauta.` : "Pauta eliminada.",
    }
  })
}

/** Equipos activos sin pauta (o con la pauta eliminada): el aviso de la lista de pautas. */
export async function countActiveEquipmentWithoutSchedule(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, and(eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId), eq(fuelVehicles.isActive, true)))
    .leftJoin(mantSchedules, and(eq(mantSchedules.id, mantEquipmentProfiles.scheduleId), isNull(mantSchedules.deletedAt)))
    .where(isNull(mantSchedules.id))
  return row?.n ?? 0
}
