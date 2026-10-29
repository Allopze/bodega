import type { Tx } from "@/db"
import type { SyncCorrectiveRecord, SyncWarning } from "@/lib/mantencion/contracts"
import { todayInChile } from "@/lib/utils"
import { loadCatalogNames } from "./records-create-context"
import { reject, type Author, type CorrectivePlan, type RecordPlan, type Validated } from "./records-create-types"
import { findAppUsers } from "./sync-app-users"

/**
 * Reglas de una correctiva (§8-9) que el servidor revalida: catálogos
 * existentes y activos, exclusiones «no se cambió aceite» / «no se usaron
 * repuestos», ejecutor, fecha de ingreso a taller y conductores.
 */

const HOURS_WARNING_OVER = 12

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

export async function validateCorrective(
  tx: Tx,
  input: SyncCorrectiveRecord,
  author: Author,
): Promise<Validated<{ corrective: CorrectivePlan; executor: RecordPlan["executor"]; warnings: SyncWarning[] }>> {
  if (input.noOilChange && input.oilIds.length > 0) {
    return reject("«No se cambió aceite» no puede ir junto con un aceite marcado.", "oilIds")
  }
  if (!input.noOilChange && input.oilIds.length === 0) {
    return reject("Marca el aceite que se cambió o «No se cambió aceite».", "oilIds")
  }
  if (input.noParts && input.parts.length > 0) {
    return reject("«No se usaron repuestos» no puede ir junto con repuestos agregados.", "parts")
  }
  if (!input.noParts && input.parts.length === 0) {
    return reject("Agrega los repuestos usados o marca «No se usaron repuestos».", "parts")
  }

  const today = todayInChile()
  if (input.inWorkshop) {
    if (!input.workshopEntryDate) return reject("Falta la fecha en que el equipo entró a taller.", "workshopEntryDate")
    if (input.workshopEntryDate > today) return reject("La fecha de ingreso a taller no puede ser futura.", "workshopEntryDate")
  }

  const workTypeIds = unique(input.workTypeIds)
  const oilIds = unique(input.oilIds)
  const driverIds = unique(input.driverIds)
  const workshopIds = input.executor.kind === "externo" ? [input.executor.workshopId] : []
  const names = await loadCatalogNames(tx, { workTypes: workTypeIds, oils: oilIds, workshops: workshopIds, drivers: driverIds })

  const workTypes = workTypeIds.map((id) => names.workTypes.get(id))
  if (workTypes.some((name) => !name)) return reject("Un tipo de trabajo ya no está disponible. Actualiza la app y vuelve a elegirlo.", "workTypeIds")
  const oils = oilIds.map((id) => names.oils.get(id))
  if (oils.some((name) => !name)) return reject("Un aceite ya no está disponible. Actualiza la app y vuelve a elegirlo.", "oilIds")
  const drivers = driverIds.map((id) => ({ id, name: names.drivers.get(id) }))
  if (drivers.some((driver) => !driver.name)) return reject("Un conductor ya no está disponible. Actualiza la app y vuelve a elegirlo.", "driverIds")

  const executor = await resolveExecutor(tx, input, author, names.workshops)
  if (!executor.ok) return executor

  const warnings: SyncWarning[] = []
  if (input.hours > HOURS_WARNING_OVER) {
    warnings.push({ code: "hours_over_12", message: `Se declararon ${input.hours} horas de trabajo: jefatura lo verá marcado.` })
  }

  return {
    ok: true,
    value: {
      warnings,
      executor: executor.value,
      corrective: {
        workTypes: workTypes as string[],
        oils: oils as string[],
        description: input.description,
        noParts: input.noParts,
        hours: input.hours,
        inWorkshop: input.inWorkshop,
        entryDate: input.inWorkshop ? input.workshopEntryDate : null,
        workOrder: input.workOrder?.trim() || null,
        parts: input.parts.map((part) => ({ quantity: part.quantity, description: part.description })),
        drivers: drivers as Array<{ id: string; name: string }>,
      },
    },
  }
}

/** Quién hizo el trabajo (regla 10): yo, otro mecánico de la app o un taller externo del catálogo. */
async function resolveExecutor(
  tx: Tx,
  input: SyncCorrectiveRecord,
  author: Author,
  workshops: Map<string, string>,
): Promise<Validated<RecordPlan["executor"]>> {
  const executor = input.executor
  if (executor.kind === "yo") {
    return { ok: true, value: { kind: "yo", userId: author.userId, workshopId: null, name: author.name } }
  }
  if (executor.kind === "externo") {
    const name = workshops.get(executor.workshopId)
    if (!name) return reject("El taller externo ya no está disponible. Actualiza la app y vuelve a elegirlo.", "executor")
    return { ok: true, value: { kind: "externo", userId: null, workshopId: executor.workshopId, name } }
  }
  if (executor.userId === author.userId) {
    return reject("Si el trabajo lo hiciste tú, elige «Yo» en vez de «Otro mecánico».", "executor")
  }
  const [mechanic] = await findAppUsers(tx, { ids: [executor.userId] })
  if (!mechanic) return reject("Ese mecánico no existe o no tiene la app habilitada.", "executor")
  return { ok: true, value: { kind: "otro_mecanico", userId: mechanic.id, workshopId: null, name: mechanic.name } }
}
