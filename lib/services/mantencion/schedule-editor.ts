import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantBrands, mantScheduleBrandRules, mantScheduleGroups, mantScheduleIntervals, mantScheduleItemIntervals,
  mantScheduleItems, mantSchedules,
} from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { formatReading, plural } from "@/lib/mantencion/format"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import { inheritedIntervalFor } from "@/lib/mantencion/schedule"
import type { MantBrandRuleValue, MantUnit } from "@/lib/mantencion/types"
import type { MantActor } from "./equipment-history"
import { checkScheduleName, MAX_SCHEDULE_INTERVALS } from "./schedules"
import { publishScheduleVersion } from "./schedule-versions"

/**
 * Ediciones finas de una pauta (§10, regla 15). Cada operación corre en UNA
 * transacción que bloquea la pauta (`FOR UPDATE`, así dos ediciones simultáneas
 * se serializan) y termina con `publishScheduleVersion` —sube la versión y
 * guarda el snapshot que descarga la app— y `recordAudit`. Quitar un ítem o un
 * intervalo lo inactiva (nunca se borra): por eso «Deshacer» lo restituye con su
 * columna intacta. El permiso `mant:schedules:manage` lo exige la acción.
 */

type ScheduleRow = typeof mantSchedules.$inferSelect

export type ScheduleEditResult<T> =
  | { ok: true; message?: string; version: number; data: T }
  | { ok: false; message: string; field?: string }

type Outcome<T> =
  | { ok: true; summary: string; message?: string; data: T }
  | { ok: false; message: string; field?: string }

async function editSchedule<T>(
  actor: MantActor,
  scheduleId: string,
  operation: (tx: Tx, schedule: ScheduleRow) => Promise<Outcome<T>>,
): Promise<ScheduleEditResult<T>> {
  try {
    return await db.transaction(async (tx) => {
      const [schedule] = await tx.select().from(mantSchedules)
        .where(and(eq(mantSchedules.id, scheduleId), isNull(mantSchedules.deletedAt))).for("update").limit(1)
      if (!schedule) return { ok: false as const, message: "Esa pauta ya no existe." }
      const outcome = await operation(tx, schedule)
      if (!outcome.ok) return outcome
      const version = await publishScheduleVersion(tx, { scheduleId, userId: actor.userId, summary: outcome.summary })
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "update",
        entityType: "mant_schedule", entityId: scheduleId, entityCode: schedule.name,
        newState: { version, change: outcome.summary },
      }, tx)
      return { ok: true as const, message: outcome.message, version, data: outcome.data }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: "Ese cambio choca con algo que ya existe en la pauta." }
    throw error
  }
}

const unitOf = (schedule: ScheduleRow) => schedule.unit as MantUnit

export async function renameSchedule(actor: MantActor, scheduleId: string, rawName: string) {
  return editSchedule(actor, scheduleId, async (tx, schedule) => {
    const named = await checkScheduleName(tx, rawName, scheduleId)
    if (!named.ok) return named
    if (named.name === schedule.name) return { ok: true, summary: "Sin cambios de nombre", data: { name: named.name } }
    await tx.update(mantSchedules).set({ name: named.name, nameKey: named.key, updatedAt: new Date().toISOString() }).where(eq(mantSchedules.id, scheduleId))
    return { ok: true, summary: `Nombre cambiado: «${schedule.name}» → «${named.name}»`, message: "Nombre guardado.", data: { name: named.name } }
  })
}

/** Marca o desmarca si un ítem aplica en un intervalo. Tocar la columna la da por revisada. */
export async function setScheduleCell(
  actor: MantActor,
  input: { scheduleId: string; itemId: string; intervalId: string; applies: boolean },
) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const [[item], [interval]] = await Promise.all([
      tx.select().from(mantScheduleItems).where(and(eq(mantScheduleItems.id, input.itemId), eq(mantScheduleItems.scheduleId, schedule.id), eq(mantScheduleItems.isActive, true))).limit(1),
      tx.select().from(mantScheduleIntervals).where(and(eq(mantScheduleIntervals.id, input.intervalId), eq(mantScheduleIntervals.scheduleId, schedule.id), eq(mantScheduleIntervals.isActive, true))).limit(1),
    ])
    if (!item || !interval) return { ok: false, message: "Ese ítem o intervalo ya no está en la pauta. Recarga la página." }
    await tx.insert(mantScheduleItemIntervals)
      .values({ itemId: item.id, intervalId: interval.id, applies: input.applies })
      .onConflictDoUpdate({ target: [mantScheduleItemIntervals.itemId, mantScheduleItemIntervals.intervalId], set: { applies: input.applies } })
    if (interval.needsReview) {
      await tx.update(mantScheduleIntervals).set({ needsReview: false, updatedAt: new Date().toISOString() }).where(eq(mantScheduleIntervals.id, interval.id))
    }
    return {
      ok: true,
      summary: `«${item.name}» ${input.applies ? "aplica" : "ya no aplica"} en ${formatReading(interval.value, unitOf(schedule))}`,
      data: { itemId: item.id, intervalId: interval.id, applies: input.applies },
    }
  })
}

/**
 * Agrega un ítem a un sistema existente (`groupId`) o a uno nuevo (`groupName`,
 * que reutiliza el sistema del mismo nombre si ya existe). Nace aplicando en
 * todos los intervalos; se desmarcan los que no correspondan.
 */
export async function addScheduleItem(
  actor: MantActor,
  input: { scheduleId: string; groupId?: string; groupName?: string; name: string },
) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const name = cleanName(input.name)
    if (name.length < 2) return { ok: false, message: "Escribe el nombre de la actividad.", field: "name" }
    if (name.length > 120) return { ok: false, message: "El nombre de la actividad no puede pasar de 120 caracteres.", field: "name" }

    const groups = await tx.select().from(mantScheduleGroups).where(eq(mantScheduleGroups.scheduleId, schedule.id))
    let group = input.groupId ? groups.find((row) => row.id === input.groupId) : undefined
    if (input.groupId && !group) return { ok: false, message: "Ese sistema ya no está en la pauta. Recarga la página." }
    if (!group) {
      const groupName = cleanName(input.groupName ?? "")
      if (groupName.length < 2) return { ok: false, message: "Escribe el nombre del sistema.", field: "groupName" }
      group = groups.find((row) => nameKey(row.name) === nameKey(groupName))
      if (!group) {
        const [created] = await tx.insert(mantScheduleGroups).values({
          id: nanoid(), scheduleId: schedule.id, name: groupName,
          sortOrder: groups.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
        }).returning()
        group = created!
      }
    }

    const siblings = await tx.select().from(mantScheduleItems).where(eq(mantScheduleItems.groupId, group.id))
    if (siblings.some((item) => item.isActive && nameKey(item.name) === nameKey(name))) {
      return { ok: false, message: `Ese ítem ya está en ${group.name}.`, field: "name" }
    }
    const intervals = await tx.select().from(mantScheduleIntervals)
      .where(and(eq(mantScheduleIntervals.scheduleId, schedule.id), eq(mantScheduleIntervals.isActive, true)))
    const itemId = nanoid()
    await tx.insert(mantScheduleItems).values({
      id: itemId, scheduleId: schedule.id, groupId: group.id,
      itemKey: `x${nanoid(10).replace(/[^A-Za-z0-9]/g, "a")}`, name,
      sortOrder: siblings.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
    })
    if (intervals.length) {
      await tx.insert(mantScheduleItemIntervals).values(intervals.map((interval) => ({ itemId, intervalId: interval.id, applies: true })))
    }
    return {
      ok: true,
      summary: `Ítem agregado en ${group.name}: «${name}»`,
      message: `«${name}» agregado en ${group.name} para todos los intervalos. Desmarca los que no correspondan.`,
      data: { itemId, groupId: group.id },
    }
  })
}

/** Quitar = inactivar (regla 15): el registro firmado conserva su snapshot y «Deshacer» lo restituye. */
export async function setScheduleItemActive(actor: MantActor, input: { scheduleId: string; itemId: string; active: boolean }) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const [item] = await tx.select().from(mantScheduleItems)
      .where(and(eq(mantScheduleItems.id, input.itemId), eq(mantScheduleItems.scheduleId, schedule.id))).limit(1)
    if (!item) return { ok: false, message: "Ese ítem no existe en la pauta." }
    await tx.update(mantScheduleItems).set({ isActive: input.active, updatedAt: new Date().toISOString() }).where(eq(mantScheduleItems.id, item.id))
    return {
      ok: true,
      summary: input.active ? `Ítem restituido: «${item.name}»` : `Ítem quitado: «${item.name}»`,
      data: { itemId: item.id, name: item.name },
    }
  })
}

/**
 * Completa la columna de un intervalo con las celdas que le faltan: todas si el
 * intervalo es nuevo; si es uno que se quitó y vuelve, sólo las de los ítems que
 * nacieron mientras no estaba (las demás conservan lo que ya tenían). Lo que falta
 * hereda de la columna del mayor intervalo activo que lo divide (regla 15).
 */
async function fillMissingCells(
  tx: Tx,
  scheduleId: string,
  interval: { id: string; value: number },
  others: Array<{ id: string; value: number }>,
): Promise<{ filled: number; sourceValue: number | null }> {
  const sourceValue = others.length ? inheritedIntervalFor(others.map((other) => other.value), interval.value) : null
  const source = others.find((other) => other.value === sourceValue)
  const items = await tx.select({ id: mantScheduleItems.id }).from(mantScheduleItems).where(eq(mantScheduleItems.scheduleId, scheduleId))
  if (items.length === 0) return { filled: 0, sourceValue }
  const own = await tx.select({ itemId: mantScheduleItemIntervals.itemId }).from(mantScheduleItemIntervals)
    .where(and(eq(mantScheduleItemIntervals.intervalId, interval.id), inArray(mantScheduleItemIntervals.itemId, items.map((item) => item.id))))
  const have = new Set(own.map((cell) => cell.itemId))
  const missing = items.map((item) => item.id).filter((id) => !have.has(id))
  if (missing.length === 0) return { filled: 0, sourceValue }

  const sourceCells = source
    ? await tx.select().from(mantScheduleItemIntervals)
      .where(and(eq(mantScheduleItemIntervals.intervalId, source.id), inArray(mantScheduleItemIntervals.itemId, missing)))
    : []
  const applies = new Map(sourceCells.map((cell) => [cell.itemId, cell.applies]))
  await tx.insert(mantScheduleItemIntervals)
    .values(missing.map((itemId) => ({ itemId, intervalId: interval.id, applies: applies.get(itemId) ?? false })))
    .onConflictDoNothing()
  return { filled: missing.length, sourceValue }
}

/**
 * Agrega un intervalo. Uno nuevo hereda la columna del MAYOR intervalo existente
 * que lo divide exacto (o la de la base) y queda «por revisar» (regla 15). Si el
 * valor ya existió y se quitó, vuelve con SU columna: no se borran sus celdas ni
 * se copia la de otro intervalo; sólo los ítems que nacieron mientras estaba
 * quitado heredan, y en ese caso la columna queda «por revisar».
 */
export async function addScheduleInterval(actor: MantActor, input: { scheduleId: string; value: number }) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const value = input.value
    if (!Number.isInteger(value) || value <= 0 || value > 9_999_999) {
      return { ok: false, message: "Escribe un número entero mayor que 0.", field: "value" }
    }
    const intervals = await tx.select().from(mantScheduleIntervals).where(eq(mantScheduleIntervals.scheduleId, schedule.id))
    const active = intervals.filter((interval) => interval.isActive)
    if (active.some((interval) => interval.value === value)) return { ok: false, message: "Ese intervalo ya existe.", field: "value" }
    if (active.length >= MAX_SCHEDULE_INTERVALS) return { ok: false, message: `Una pauta admite hasta ${MAX_SCHEDULE_INTERVALS} intervalos.`, field: "value" }

    const unit = unitOf(schedule)
    const label = formatReading(value, unit)
    const dormant = intervals.find((interval) => interval.value === value && !interval.isActive)
    const now = new Date().toISOString()
    let intervalId: string
    if (dormant) {
      intervalId = dormant.id
      await tx.update(mantScheduleIntervals).set({ isActive: true, updatedAt: now }).where(eq(mantScheduleIntervals.id, dormant.id))
    } else {
      intervalId = nanoid()
      await tx.insert(mantScheduleIntervals).values({ id: intervalId, scheduleId: schedule.id, value, needsReview: true })
    }
    const { filled, sourceValue } = await fillMissingCells(tx, schedule.id, { id: intervalId, value }, active)
    const data = { intervalId, value, restored: Boolean(dormant) }

    if (!dormant) {
      return {
        ok: true,
        summary: `Intervalo de ${label} agregado (hereda la columna de ${formatReading(sourceValue ?? value, unit)})`,
        message: `Intervalo de ${label} agregado: copia la columna de ${formatReading(sourceValue ?? value, unit)}. Revísala.`,
        data,
      }
    }
    // Volvió con su columna; si quedaron ítems sin celda (nacieron mientras no estaba) heredaron y hay que mirarlos.
    if (filled > 0 && !dormant.needsReview) {
      await tx.update(mantScheduleIntervals).set({ needsReview: true, updatedAt: now }).where(eq(mantScheduleIntervals.id, dormant.id))
    }
    const inherited = filled > 0 && sourceValue !== null
      ? ` ${plural(filled, "actividad nueva heredó", "actividades nuevas heredaron")} su valor de la columna de ${formatReading(sourceValue, unit)}. Revisa la columna.`
      : ""
    return {
      ok: true,
      summary: `Intervalo de ${label} restituido con su columna${inherited ? ` (${plural(filled, "actividad nueva hereda", "actividades nuevas heredan")} la de ${formatReading(sourceValue!, unit)})` : ""}`,
      message: `Intervalo de ${label} restituido con su columna.${inherited}`,
      data,
    }
  })
}

/** Quitar o restituir un intervalo (inactivar). La pauta conserva al menos uno. */
export async function setScheduleIntervalActive(actor: MantActor, input: { scheduleId: string; intervalId: string; active: boolean }) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const [interval] = await tx.select().from(mantScheduleIntervals)
      .where(and(eq(mantScheduleIntervals.id, input.intervalId), eq(mantScheduleIntervals.scheduleId, schedule.id))).limit(1)
    if (!interval) return { ok: false, message: "Ese intervalo no existe en la pauta." }
    if (!input.active) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(mantScheduleIntervals)
        .where(and(eq(mantScheduleIntervals.scheduleId, schedule.id), eq(mantScheduleIntervals.isActive, true)))
      if (n <= 1) return { ok: false, message: "La pauta necesita al menos un intervalo." }
    }
    await tx.update(mantScheduleIntervals).set({ isActive: input.active, updatedAt: new Date().toISOString() }).where(eq(mantScheduleIntervals.id, interval.id))
    const label = formatReading(interval.value, unitOf(schedule))
    if (input.active && !interval.isActive) {
      // «Deshacer» también devuelve la columna entera; si un ítem nació mientras estaba quitado, hereda y la columna queda por revisar.
      const others = await tx.select({ id: mantScheduleIntervals.id, value: mantScheduleIntervals.value }).from(mantScheduleIntervals)
        .where(and(eq(mantScheduleIntervals.scheduleId, schedule.id), eq(mantScheduleIntervals.isActive, true), ne(mantScheduleIntervals.id, interval.id)))
      const { filled } = await fillMissingCells(tx, schedule.id, { id: interval.id, value: interval.value }, others)
      if (filled > 0 && !interval.needsReview) {
        await tx.update(mantScheduleIntervals).set({ needsReview: true, updatedAt: new Date().toISOString() }).where(eq(mantScheduleIntervals.id, interval.id))
      }
    }
    return {
      ok: true,
      summary: input.active ? `Intervalo restituido: ${label}` : `Intervalo quitado: ${label}`,
      data: { intervalId: interval.id, value: interval.value },
    }
  })
}

/** Da por revisada la columna de un intervalo (o de todos, sin `intervalId`). */
export async function clearIntervalReview(actor: MantActor, input: { scheduleId: string; intervalId?: string }) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    const rows = await tx.update(mantScheduleIntervals)
      .set({ needsReview: false, updatedAt: new Date().toISOString() })
      .where(and(
        eq(mantScheduleIntervals.scheduleId, schedule.id),
        eq(mantScheduleIntervals.needsReview, true),
        input.intervalId ? eq(mantScheduleIntervals.id, input.intervalId) : undefined,
      ))
      .returning({ id: mantScheduleIntervals.id })
    return { ok: true, summary: "Columnas dadas por revisadas", data: { cleared: rows.length } }
  })
}

/** Cambia la regla por marca de una actividad (A aplica · W revisar · X no aplica). */
export async function setScheduleBrandRule(
  actor: MantActor,
  input: { scheduleId: string; activity: string; brandId: string; value: MantBrandRuleValue },
) {
  return editSchedule(actor, input.scheduleId, async (tx, schedule) => {
    if (!["A", "W", "X"].includes(input.value)) return { ok: false, message: "Valor de regla no válido." }
    const existing = await tx.select().from(mantScheduleBrandRules)
      .where(and(eq(mantScheduleBrandRules.scheduleId, schedule.id), eq(mantScheduleBrandRules.sheetActivity, input.activity)))
    if (existing.length === 0) return { ok: false, message: "Esa actividad no tiene reglas por marca en la pauta." }
    const [brand] = await tx.select().from(mantBrands).where(eq(mantBrands.id, input.brandId)).limit(1)
    if (!brand) return { ok: false, message: "Esa marca no existe." }
    const itemId = existing.find((rule) => rule.itemId)?.itemId ?? null
    await tx.insert(mantScheduleBrandRules)
      .values({ id: nanoid(), scheduleId: schedule.id, itemId, sheetActivity: input.activity, brandId: brand.id, value: input.value })
      .onConflictDoUpdate({
        target: [mantScheduleBrandRules.scheduleId, mantScheduleBrandRules.sheetActivity, mantScheduleBrandRules.brandId],
        set: { value: input.value, updatedAt: new Date().toISOString() },
      })
    const label = { A: "aplica", W: "revisar con el fabricante", X: "no aplica" }[input.value]
    return {
      ok: true,
      summary: `Regla por marca: «${input.activity}» en ${brand.name} → ${label}`,
      data: { activity: input.activity, brandId: brand.id, value: input.value },
    }
  })
}
