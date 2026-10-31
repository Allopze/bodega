import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantBrands, mantScheduleBrandRules, mantScheduleIntervals, mantScheduleItemIntervals, mantScheduleItems, mantSchedules,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { formatReading } from "@/lib/mantencion/format"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantBrandRuleValue, MantScheduleSnapshot, MantUnit } from "@/lib/mantencion/types"
import { buildScheduleSnapshot, getScheduleSnapshot } from "./schedule-versions"

/**
 * Borrador de una pauta (regla 15). Las tablas vivas SON el borrador; lo publicado
 * es el snapshot de `mant_schedule_versions` con la versión vigente de la pauta.
 * Este módulo compara uno con otro (`scheduleDraftDiff`, `listDirtyScheduleIds`) y
 * devuelve las tablas vivas al estado publicado (`restoreDraft`). Publicar y
 * descartar, con su transacción y su auditoría, están en `schedule-editor.ts`.
 */

type Reader = Pick<Tx, "select">

/** Tope de líneas de `changes`: 19 cambios y, si hay más, «y N cambios más». */
const MAX_CHANGES = 20

const RULE_LABEL: Record<MantBrandRuleValue, string> = { A: "aplica", W: "revisar con el fabricante", X: "no aplica" }

/** Lo comparable de un snapshot: sin `id` ni `version`, con el orden normalizado. */
interface Comparable {
  name: string
  unit: MantUnit
  intervals: number[]
  items: Array<{ key: string; group: string; name: string; applies: Record<number, boolean> }>
  rules: Array<{ itemKey: string; brandId: string; value: MantBrandRuleValue }>
}

function comparable(snapshot: MantScheduleSnapshot): Comparable {
  const items = snapshot.groups.flatMap((group) => group.items.map((item) => ({
    key: item.key,
    group: group.name,
    name: item.name,
    applies: Object.fromEntries(snapshot.intervals.map((value, index) => [value, item.applies[index] ?? false])) as Record<number, boolean>,
  })))
  return {
    name: snapshot.name,
    unit: snapshot.unit,
    intervals: [...snapshot.intervals].sort((a, b) => a - b),
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
    rules: snapshot.brandRules
      .map((rule) => ({ itemKey: rule.itemKey, brandId: rule.brandId, value: rule.value }))
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey) || a.brandId.localeCompare(b.brandId) || a.value.localeCompare(b.value)),
  }
}

export function sameSnapshotContent(a: MantScheduleSnapshot, b: MantScheduleSnapshot): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
}

function capChanges(changes: string[]): string[] {
  if (changes.length <= MAX_CHANGES) return changes
  return [...changes.slice(0, MAX_CHANGES - 1), `y ${changes.length - (MAX_CHANGES - 1)} cambios más`]
}

/** Cambios legibles (en español) entre lo publicado y el estado vivo. */
function describeChanges(published: MantScheduleSnapshot, live: MantScheduleSnapshot, brandNames: Map<string, string>): string[] {
  const a = comparable(published)
  const b = comparable(live)
  const unit = b.unit
  const changes: string[] = []

  if (a.name !== b.name) changes.push(`Nombre: «${a.name}» → «${b.name}»`)

  for (const value of b.intervals.filter((v) => !a.intervals.includes(v))) changes.push(`Intervalo agregado: ${formatReading(value, unit)}`)
  for (const value of a.intervals.filter((v) => !b.intervals.includes(v))) changes.push(`Intervalo quitado: ${formatReading(value, unit)}`)
  const common = b.intervals.filter((v) => a.intervals.includes(v))

  const before = new Map(a.items.map((item) => [item.key, item]))
  const after = new Map(b.items.map((item) => [item.key, item]))
  for (const item of b.items) if (!before.has(item.key)) changes.push(`Ítem agregado en ${item.group}: «${item.name}»`)
  for (const item of a.items) if (!after.has(item.key)) changes.push(`Ítem quitado: «${item.name}»`)
  for (const item of b.items) {
    const old = before.get(item.key)
    if (!old) continue
    const on = common.filter((v) => !old.applies[v] && item.applies[v])
    const off = common.filter((v) => old.applies[v] && !item.applies[v])
    if (on.length) changes.push(`«${item.name}» ahora aplica en ${on.map((v) => formatReading(v, unit)).join(", ")}`)
    if (off.length) changes.push(`«${item.name}» ya no aplica en ${off.map((v) => formatReading(v, unit)).join(", ")}`)
  }

  const ruleKey = (rule: { itemKey: string; brandId: string }) => `${rule.itemKey}\u0000${rule.brandId}`
  const oldRules = new Map(a.rules.map((rule) => [ruleKey(rule), rule]))
  const newRules = new Map(b.rules.map((rule) => [ruleKey(rule), rule]))
  const itemName = (key: string) => before.get(key)?.name ?? after.get(key)?.name ?? key
  const brandName = (id: string) => brandNames.get(id) ?? "otra marca"
  for (const rule of newRules.values()) {
    const old = oldRules.get(ruleKey(rule))
    if (!old || old.value !== rule.value) changes.push(`Regla por marca: «${itemName(rule.itemKey)}» en ${brandName(rule.brandId)} → ${RULE_LABEL[rule.value]}`)
  }
  for (const rule of oldRules.values()) {
    if (!newRules.has(ruleKey(rule)) && after.has(rule.itemKey)) changes.push(`Regla por marca quitada: «${itemName(rule.itemKey)}» en ${brandName(rule.brandId)}`)
  }
  return changes
}

export interface ScheduleDraftDiff {
  dirty: boolean
  publishedVersion: number
  changes: string[]
}

/** Compara el estado vivo de la pauta (el borrador) con su snapshot publicado. */
export async function scheduleDraftDiff(scheduleId: string, client: Reader = db): Promise<ScheduleDraftDiff> {
  const [schedule] = await client.select({ version: mantSchedules.version }).from(mantSchedules).where(eq(mantSchedules.id, scheduleId)).limit(1)
  if (!schedule) throw new Error(`Pauta ${scheduleId} no existe`)
  const [published, live] = await Promise.all([
    getScheduleSnapshot(scheduleId, schedule.version, client),
    buildScheduleSnapshot(client, scheduleId, schedule.version),
  ])
  if (!published) return { dirty: true, publishedVersion: schedule.version, changes: ["La pauta no tiene una versión publicada"] }
  if (sameSnapshotContent(published, live)) return { dirty: false, publishedVersion: schedule.version, changes: [] }
  const brandIds = [...new Set([...published.brandRules, ...live.brandRules].map((rule) => rule.brandId))]
  const brands = brandIds.length
    ? await client.select({ id: mantBrands.id, name: mantBrands.name }).from(mantBrands).where(inArray(mantBrands.id, brandIds))
    : []
  const changes = describeChanges(published, live, new Map(brands.map((brand) => [brand.id, brand.name])))
  return {
    dirty: true,
    publishedVersion: schedule.version,
    changes: capChanges(changes.length ? changes : ["Cambios en la estructura de la pauta"]),
  }
}

/** Ids (de entre `scheduleIds`) con cambios sin publicar; una sola consulta de versiones para toda la lista. */
export async function listDirtyScheduleIds(scheduleIds: string[], client: Reader = db): Promise<Set<string>> {
  if (scheduleIds.length === 0) return new Set()
  const rows = await client.select({ id: mantSchedules.id, version: mantSchedules.version }).from(mantSchedules).where(inArray(mantSchedules.id, scheduleIds))
  const dirty = await Promise.all(rows.map(async (row) => {
    const [published, live] = await Promise.all([getScheduleSnapshot(row.id, row.version, client), buildScheduleSnapshot(client, row.id, row.version)])
    return !published || !sameSnapshotContent(published, live) ? row.id : null
  }))
  return new Set(dirty.filter((id): id is string => id !== null))
}

/**
 * Deja las tablas vivas de modo que `buildScheduleSnapshot` coincida con el
 * snapshot publicado: reactiva o inactiva ítems e intervalos, reescribe las
 * celdas y las reglas por marca y devuelve el nombre. Lo que el snapshot no trae
 * y existió, queda inactivo (nunca se borra: los registros firmados lo conservan).
 * Corre dentro de la transacción que ya bloqueó la pauta.
 */
export async function restoreDraft(tx: Tx, scheduleId: string, snapshot: MantScheduleSnapshot): Promise<void> {
  const now = new Date().toISOString()
  const [schedule] = await tx.select().from(mantSchedules).where(eq(mantSchedules.id, scheduleId)).limit(1)
  if (!schedule) throw new Error(`Pauta ${scheduleId} no existe`)
  if (schedule.name !== snapshot.name) {
    await tx.update(mantSchedules).set({ name: snapshot.name, nameKey: nameKey(snapshot.name), updatedAt: now }).where(eq(mantSchedules.id, scheduleId))
  }

  // Intervalos, por valor.
  const intervals = await tx.select().from(mantScheduleIntervals).where(eq(mantScheduleIntervals.scheduleId, scheduleId))
  const wanted = new Set(snapshot.intervals)
  const intervalByValue = new Map<number, string>()
  for (const interval of intervals) {
    if (wanted.has(interval.value)) {
      intervalByValue.set(interval.value, interval.id)
      if (!interval.isActive) await tx.update(mantScheduleIntervals).set({ isActive: true, updatedAt: now }).where(eq(mantScheduleIntervals.id, interval.id))
    } else if (interval.isActive) {
      await tx.update(mantScheduleIntervals).set({ isActive: false, updatedAt: now }).where(eq(mantScheduleIntervals.id, interval.id))
    }
  }
  for (const value of wanted) {
    if (intervalByValue.has(value)) continue
    const id = nanoid()
    await tx.insert(mantScheduleIntervals).values({ id, scheduleId, value })
    intervalByValue.set(value, id)
  }

  // Ítems, por clave.
  const items = await tx.select().from(mantScheduleItems).where(eq(mantScheduleItems.scheduleId, scheduleId))
  const snapshotItems = new Map(snapshot.groups.flatMap((group) => group.items).map((item) => [item.key, item]))
  const itemByKey = new Map<string, string>()
  for (const item of items) {
    if (snapshotItems.has(item.itemKey)) {
      itemByKey.set(item.itemKey, item.id)
      if (!item.isActive) await tx.update(mantScheduleItems).set({ isActive: true, updatedAt: now }).where(eq(mantScheduleItems.id, item.id))
    } else if (item.isActive) {
      await tx.update(mantScheduleItems).set({ isActive: false, updatedAt: now }).where(eq(mantScheduleItems.id, item.id))
    }
  }

  // Celdas de los ítems publicados: sólo se escriben las que difieren.
  const itemIds = [...itemByKey.values()]
  const existing = itemIds.length
    ? await tx.select().from(mantScheduleItemIntervals).where(inArray(mantScheduleItemIntervals.itemId, itemIds))
    : []
  const current = new Map(existing.map((cell) => [`${cell.itemId}:${cell.intervalId}`, cell.applies]))
  const cells: Array<{ itemId: string; intervalId: string; applies: boolean }> = []
  for (const [key, item] of snapshotItems) {
    const itemId = itemByKey.get(key)
    if (!itemId) continue
    snapshot.intervals.forEach((value, index) => {
      const intervalId = intervalByValue.get(value)!
      const applies = item.applies[index] ?? false
      if (current.get(`${itemId}:${intervalId}`) !== applies) cells.push({ itemId, intervalId, applies })
    })
  }
  for (let from = 0; from < cells.length; from += 1000) {
    await tx.insert(mantScheduleItemIntervals).values(cells.slice(from, from + 1000))
      .onConflictDoUpdate({
        target: [mantScheduleItemIntervals.itemId, mantScheduleItemIntervals.intervalId],
        set: { applies: sql`excluded.applies` },
      })
  }

  // Reglas por marca de los ítems publicados: las que el snapshot no trae se quitan, las demás recuperan su valor.
  if (itemIds.length) {
    const rules = await tx.select().from(mantScheduleBrandRules)
      .where(and(eq(mantScheduleBrandRules.scheduleId, scheduleId), inArray(mantScheduleBrandRules.itemId, itemIds)))
    const keyById = new Map([...itemByKey].map(([key, id]) => [id, key]))
    const remaining = new Map<string, MantBrandRuleValue[]>()
    for (const rule of snapshot.brandRules) {
      const key = `${rule.itemKey}\u0000${rule.brandId}`
      remaining.set(key, [...(remaining.get(key) ?? []), rule.value])
    }
    const loose: typeof rules = []
    for (const rule of rules) {
      const list = remaining.get(`${keyById.get(rule.itemId!)}\u0000${rule.brandId}`)
      const at = list?.indexOf(rule.value as MantBrandRuleValue) ?? -1
      if (list && at >= 0) list.splice(at, 1)
      else loose.push(rule)
    }
    for (const rule of loose) {
      const list = remaining.get(`${keyById.get(rule.itemId!)}\u0000${rule.brandId}`)
      const value = list?.shift()
      if (value) await tx.update(mantScheduleBrandRules).set({ value, updatedAt: now }).where(eq(mantScheduleBrandRules.id, rule.id))
      else await tx.delete(mantScheduleBrandRules).where(eq(mantScheduleBrandRules.id, rule.id))
    }
  }
}
