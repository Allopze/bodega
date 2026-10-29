import { and, count, eq, isNull } from "drizzle-orm"
import {
  mantScheduleBrandRules, mantScheduleGroups, mantScheduleIntervals, mantScheduleItemIntervals,
  mantScheduleItems, mantSchedules,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import type { MantBrandRuleValue, MantUnit } from "@/lib/mantencion/types"
import type { MantSeedData, SeedContext } from "./seed"
import { publishScheduleVersion } from "./schedule-versions"

/**
 * Carga de las pautas (§13): `mant_schedules` + intervalos + sistemas + ítems +
 * matriz ítem × intervalo + reglas por marca, y al final la versión 1 publicada
 * con `publishScheduleVersion` (invariante del módulo: toda pauta viva tiene su
 * snapshot).
 *
 * Idempotente por nombre: si ya hay una pauta viva con ese nombre no se toca
 * —una persona pudo haberla editado en el editor— y sólo se usa para asignar
 * equipos.
 */

export interface SeededSchedule { id: string; name: string; unit: MantUnit }

type SeedPauta = MantSeedData["pautas"][number]

/** §19-1: un `*` o `**` en el nombre marca una actividad por confirmar; el nombre queda limpio y la nota lo recuerda. */
export function cleanItemName(raw: string): { name: string; note: string | null } {
  const name = cleanName(raw.replace(/\*+/g, ""))
  return { name, note: raw.includes("*") ? "Por confirmar" : null }
}

export async function seedSchedules(
  ctx: SeedContext,
  brands: Map<string, { id: string; name: string }>,
): Promise<Map<string, SeededSchedule>> {
  const { tx, data, report } = ctx
  const result = new Map<string, SeededSchedule>()
  for (const pauta of data.pautas) {
    const [existing] = await tx.select().from(mantSchedules)
      .where(and(eq(mantSchedules.nameKey, nameKey(pauta.nombre)), isNull(mantSchedules.deletedAt)))
    if (existing) {
      if (existing.unit !== pauta.unidad) {
        report.warnings.push(`La pauta «${existing.name}» ya existe en ${existing.unit} y el archivo la trae en ${pauta.unidad}; no se modificó.`)
      }
      const [items] = await tx.select({ total: count() }).from(mantScheduleItems)
        .where(and(eq(mantScheduleItems.scheduleId, existing.id), eq(mantScheduleItems.isActive, true)))
      const [intervals] = await tx.select({ total: count() }).from(mantScheduleIntervals)
        .where(and(eq(mantScheduleIntervals.scheduleId, existing.id), eq(mantScheduleIntervals.isActive, true)))
      const [rules] = await tx.select({ total: count() }).from(mantScheduleBrandRules).where(eq(mantScheduleBrandRules.scheduleId, existing.id))
      report.schedules.push({
        name: existing.name, unit: existing.unit as MantUnit, created: false,
        items: items?.total ?? 0, intervals: intervals?.total ?? 0, brandRules: rules?.total ?? 0, version: existing.version,
      })
      result.set(pauta.id, { id: existing.id, name: existing.name, unit: existing.unit as MantUnit })
      continue
    }
    const created = await createSchedule(ctx, pauta, brands)
    report.schedules.push(created.summary)
    result.set(pauta.id, created.schedule)
  }
  return result
}

async function createSchedule(ctx: SeedContext, pauta: SeedPauta, brands: Map<string, { id: string; name: string }>) {
  const { tx, actorUserId } = ctx
  const scheduleId = nanoid()
  await tx.insert(mantSchedules).values({
    id: scheduleId, name: cleanName(pauta.nombre), nameKey: nameKey(pauta.nombre), unit: pauta.unidad,
    origin: pauta.origen ?? null, version: 1,
  })

  const intervalIds = pauta.intervalos.map(() => nanoid())
  await tx.insert(mantScheduleIntervals).values(
    pauta.intervalos.map((value, index) => ({ id: intervalIds[index]!, scheduleId, value })),
  )

  const itemIdByKey = new Map<string, string>()
  const groupRows: Array<typeof mantScheduleGroups.$inferInsert> = []
  const itemRows: Array<typeof mantScheduleItems.$inferInsert> = []
  const cellRows: Array<typeof mantScheduleItemIntervals.$inferInsert> = []
  pauta.grupos.forEach((group, groupIndex) => {
    const groupId = nanoid()
    groupRows.push({ id: groupId, scheduleId, name: cleanName(group.nombre), sortOrder: groupIndex })
    group.items.forEach((item, itemIndex) => {
      const itemId = nanoid()
      const { name, note } = cleanItemName(item.nombre)
      itemIdByKey.set(item.clave, itemId)
      itemRows.push({ id: itemId, scheduleId, groupId, itemKey: item.clave, name, note, sortOrder: itemIndex })
      item.aplicaPorIntervalo.forEach((flag, column) => {
        cellRows.push({ itemId, intervalId: intervalIds[column]!, applies: flag === 1 })
      })
    })
  })
  await tx.insert(mantScheduleGroups).values(groupRows)
  await tx.insert(mantScheduleItems).values(itemRows)
  await tx.insert(mantScheduleItemIntervals).values(cellRows)

  const ruleRows: Array<typeof mantScheduleBrandRules.$inferInsert> = []
  const rules = pauta.reglasPorMarca
  for (const row of rules?.filas ?? []) {
    // §19-2: una fila de la planilla sin ítem equivalente se guarda con `item_id` nulo.
    const itemId = row.claveItem ? itemIdByKey.get(row.claveItem) ?? null : null
    rules!.marcas.forEach((marca, column) => {
      const brand = brands.get(nameKey(marca))
      if (!brand) throw new Error(`La marca «${marca}» de las reglas de «${pauta.nombre}» no está en el catálogo.`)
      ruleRows.push({
        id: nanoid(), scheduleId, itemId, sheetActivity: row.actividadPlanilla, brandId: brand.id,
        value: row.valores[column]! as MantBrandRuleValue,
      })
    })
  }
  if (ruleRows.length > 0) await tx.insert(mantScheduleBrandRules).values(ruleRows)

  const version = await publishScheduleVersion(tx, { scheduleId, userId: actorUserId, summary: "Carga inicial", initial: true })
  return {
    schedule: { id: scheduleId, name: cleanName(pauta.nombre), unit: pauta.unidad },
    summary: {
      name: cleanName(pauta.nombre), unit: pauta.unidad, created: true,
      items: itemRows.length, intervals: pauta.intervalos.length, brandRules: ruleRows.length, version,
    },
  }
}
