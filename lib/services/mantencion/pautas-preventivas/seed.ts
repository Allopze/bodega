import { and, count, eq, isNull } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import {
  mantScheduleGroups, mantScheduleIntervals, mantScheduleItemIntervals, mantScheduleItems, mantSchedules,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import { buildScheduleSnapshot, publishScheduleVersion } from "../schedule-versions"
import { ITEMS_CAMIONES } from "./items-camiones"
import { ITEMS_MAQUINARIA } from "./items-maquinaria"

/**
 * Pautas de mantención preventiva de los formularios externos (encargo del 2026-11-26): A
 * maquinaria por horas, B camiones/tractos por km y C camiones/tractos por horas. Las tres son
 * cíclicas: el ciclo es el mayor hito y la secuencia vuelve al primero (`suggestInterval`).
 *
 * - Clave estable de la pauta: su nombre normalizado (`name_key`, único entre las vivas); clave de
 *   cada ítem: `itemKey` fijo por posición (`m01`…, `c01`…).
 * - Los formularios son listas planas y el orden del encargo es definitivo, así que cada pauta va
 *   en UN solo sistema («Lista de verificación»): repartir los ítems en sistemas los reordenaría.
 * - Todos los ítems aplican en todos los hitos (no hay relación ítem × hito) y no hay reglas por
 *   marca; el mecánico marca «No aplica» cuando corresponda.
 * - Idempotente: si la pauta ya existe con el mismo contenido no se toca; si existe con contenido
 *   distinto TAMPOCO se toca (pudo editarse a mano) y se informa la diferencia.
 * - Una transacción por pauta. La creación queda en la bitácora con el actor de sistema
 *   `SEED_ACTOR` (sin usuario) y la versión 1 publicada con `publishScheduleVersion`.
 */

export const SEED_ACTOR = "sistema:seed-pautas-preventivas-2026-11"
const GROUP_NAME = "Lista de verificación"
const ORIGIN = "Formularios externos de mantención preventiva (encargo 2026-11-26)"

export interface PreventivePautaSpec {
  name: string
  unit: MantUnit
  intervals: readonly number[]
  keyPrefix: string
  items: readonly string[]
}

export const PREVENTIVE_PAUTAS: readonly PreventivePautaSpec[] = [
  { name: "Pauta mantención preventiva maquinaria — horas", unit: "h", intervals: [300, 600, 900, 1200], keyPrefix: "m", items: ITEMS_MAQUINARIA },
  { name: "Pauta mantención preventiva camiones/tractos — km", unit: "km", intervals: [40000, 80000, 120000], keyPrefix: "c", items: ITEMS_CAMIONES },
  { name: "Pauta mantención preventiva camiones/tractos — horas", unit: "h", intervals: [300, 600, 900], keyPrefix: "c", items: ITEMS_CAMIONES },
]

export function itemKey(spec: PreventivePautaSpec, index: number): string {
  return `${spec.keyPrefix}${String(index + 1).padStart(2, "0")}`
}

export type PautaOutcome =
  | { name: string; status: "creada"; scheduleId: string; items: number; intervals: number[]; version: number }
  | { name: string; status: "sin_cambios"; scheduleId: string; items: number; intervals: number[]; version: number }
  | { name: string; status: "distinta"; scheduleId: string; differences: string[] }

export interface SeedPreventivePautasReport {
  dryRun: boolean
  pautas: PautaOutcome[]
  /** Si esta corrida escribió (o, en simulación, habría escrito) algo. */
  changed: boolean
}

/** Señal para revertir la transacción de una simulación sin tratarla como error. */
class DryRunRollback extends Error {
  constructor(readonly outcome: PautaOutcome) { super("simulación") }
}

/** Compara la pauta viva con lo que el seed sembraría. Lista vacía = mismo contenido. */
async function differencesFor(tx: Tx, existing: typeof mantSchedules.$inferSelect, spec: PreventivePautaSpec): Promise<string[]> {
  const differences: string[] = []
  if (existing.unit !== spec.unit) differences.push(`unidad ${existing.unit} (se esperaba ${spec.unit})`)
  if (!existing.cyclic) differences.push("no está marcada como cíclica")
  const live = await buildScheduleSnapshot(tx, existing.id, existing.version)
  if (live.intervals.join(",") !== spec.intervals.join(",")) {
    differences.push(`hitos ${live.intervals.join(", ")} (se esperaba ${spec.intervals.join(", ")})`)
  }
  const items = live.groups.flatMap((group) => group.items)
  if (items.length !== spec.items.length) differences.push(`${items.length} ítems activos (se esperaban ${spec.items.length})`)
  spec.items.forEach((name, index) => {
    const item = items[index]
    if (!item) return
    if (item.name !== name) differences.push(`ítem ${index + 1}: «${item.name}» (se esperaba «${name}»)`)
    else if (item.key !== itemKey(spec, index)) differences.push(`ítem ${index + 1}: clave ${item.key} (se esperaba ${itemKey(spec, index)})`)
    if (item.applies.some((applies) => !applies)) differences.push(`ítem ${index + 1}: no aplica en todos los hitos`)
  })
  if (live.brandRules.length > 0) differences.push(`${live.brandRules.length} reglas por marca`)
  return differences
}

async function insertPauta(tx: Tx, spec: PreventivePautaSpec): Promise<{ scheduleId: string; version: number }> {
  const scheduleId = nanoid()
  await tx.insert(mantSchedules).values({
    id: scheduleId, name: spec.name, nameKey: nameKey(spec.name), unit: spec.unit, origin: ORIGIN, cyclic: true, version: 1,
  })
  const intervalIds = spec.intervals.map(() => nanoid())
  await tx.insert(mantScheduleIntervals).values(spec.intervals.map((value, index) => ({ id: intervalIds[index]!, scheduleId, value })))
  const groupId = nanoid()
  await tx.insert(mantScheduleGroups).values({ id: groupId, scheduleId, name: GROUP_NAME, sortOrder: 0 })
  const items = spec.items.map((name, index) => ({ id: nanoid(), scheduleId, groupId, itemKey: itemKey(spec, index), name, sortOrder: index }))
  await tx.insert(mantScheduleItems).values(items)
  await tx.insert(mantScheduleItemIntervals).values(
    items.flatMap((item) => intervalIds.map((intervalId) => ({ itemId: item.id, intervalId, applies: true }))),
  )
  const version = await publishScheduleVersion(tx, { scheduleId, userId: null, summary: "Carga inicial (formularios externos)", initial: true })
  await recordAudit({
    userId: null,
    userEmail: SEED_ACTOR,
    action: "create",
    entityType: "mant_schedule",
    entityId: scheduleId,
    entityCode: spec.name,
    newState: { unit: spec.unit, cyclic: true, intervals: [...spec.intervals], items: spec.items.length, version },
    reason: "Seed de pautas preventivas de los formularios externos",
  }, tx)
  return { scheduleId, version }
}

async function seedOne(client: DB, spec: PreventivePautaSpec, dryRun: boolean): Promise<PautaOutcome> {
  try {
    return await client.transaction(async (tx) => {
      const [existing] = await tx.select().from(mantSchedules)
        .where(and(eq(mantSchedules.nameKey, nameKey(spec.name)), isNull(mantSchedules.deletedAt)))
        .for("update")
      if (existing) {
        const differences = await differencesFor(tx, existing, spec)
        if (differences.length > 0) return { name: existing.name, status: "distinta" as const, scheduleId: existing.id, differences }
        const [items] = await tx.select({ total: count() }).from(mantScheduleItems)
          .where(and(eq(mantScheduleItems.scheduleId, existing.id), eq(mantScheduleItems.isActive, true)))
        return { name: existing.name, status: "sin_cambios" as const, scheduleId: existing.id, items: items?.total ?? 0, intervals: [...spec.intervals], version: existing.version }
      }
      const created = await insertPauta(tx, spec)
      const outcome: PautaOutcome = { name: spec.name, status: "creada", ...created, items: spec.items.length, intervals: [...spec.intervals] }
      if (dryRun) throw new DryRunRollback(outcome)
      return outcome
    })
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome
    throw error
  }
}

/** `dryRun`: cada pauta nueva se escribe y se revierte (valida restricciones sin dejar nada). */
export async function seedPreventivePautas(client: DB, options: { dryRun?: boolean } = {}): Promise<SeedPreventivePautasReport> {
  const dryRun = options.dryRun === true
  const pautas: PautaOutcome[] = []
  for (const spec of PREVENTIVE_PAUTAS) pautas.push(await seedOne(client, spec, dryRun))
  return { dryRun, pautas, changed: pautas.some((pauta) => pauta.status === "creada") }
}
