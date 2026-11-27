/**
 * scripts/apply-camiones-copec-km-2026-11.ts
 *
 * Una sola vez (decisión del usuario, 2026-11-26): los camiones y tractocamiones que cargaron en Copec el último mes
 * miden en kilómetros en Mantención. El 2026-11-25 los camiones de fuera de Biodiversa pasaron a horas con la pauta
 * «Maquinaria pesada» (`apply-medidor-camiones-2026-11.ts`); los que ruedan por ruta (carga Copec reciente) vuelven a
 * kilómetros con la pauta en km que ya usan los de Biodiversa. No es una regla: no se agrega lógica a la app.
 *
 * Pasa por `setEquipmentUnit` (perfil de Mantención, historial del equipo y auditoría); no toca `fuel_vehicles`.
 * Sólo mueve equipos sin lectura inicial, sin registros vigentes y sin OT abiertas: con cualquiera de esas cosas el
 * equipo se informa y se deja como está, para decidirlo a mano.
 *
 * Simulación por defecto (misma transacción, deshecha al final). Idempotente: un equipo que ya mide en km queda «ya estaba».
 *
 *   npx tsx scripts/apply-camiones-copec-km-2026-11.ts --actor-email <correo> --pauta-km <nombre> [--dias 30] [--apply]
 */
import { pathToFileURL } from "node:url"
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantRecords, mantSchedules, mantWorkOrders, users, worksites } from "@/db/schema"
import { setEquipmentUnit } from "@/lib/services/mantencion/equipment-unit-change"

const REASON = "Camión con carga Copec en el último mes: se mide en kilómetros (decisión del usuario, 2026-11-26)"
const TRUCK_FAMILY = "camiones"

type Result = "dry-run" | "aplicado" | "ya estaba" | "omitido"
export interface Outcome { code: string; worksite: string; result: Result; detail?: string }

class DryRunRollback extends Error {}

export async function applyCamionesCopecKm(options: { actorEmail: string; scheduleName: string; days?: number; apply?: boolean }): Promise<Outcome[]> {
  const apply = options.apply ?? false
  const days = options.days ?? 30
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const outcomes: Outcome[] = []
  try {
    await db.transaction(async (tx) => {
      const schedules = await tx.select({ id: mantSchedules.id, unit: mantSchedules.unit }).from(mantSchedules)
        .where(and(eq(mantSchedules.name, options.scheduleName), isNull(mantSchedules.deletedAt)))
      if (schedules.length !== 1) throw new Error(`La pauta «${options.scheduleName}» ${schedules.length === 0 ? "no existe" : "está repetida"}. No se escribió nada.`)
      if (schedules[0]!.unit !== "km") throw new Error(`La pauta «${options.scheduleName}» no se mide en kilómetros. No se escribió nada.`)
      const scheduleId = schedules[0]!.id

      const copec = await tx.execute<{ vehicle_id: string }>(sql`
        SELECT DISTINCT vehicle_id FROM fuel_provider_transactions
         WHERE provider = 'copec' AND vehicle_id IS NOT NULL
           AND occurred_at >= to_char((now() AT TIME ZONE 'America/Santiago') - make_interval(days => ${days}), 'YYYY-MM-DD')
        UNION
        SELECT DISTINCT vehicle_id FROM fuel_cycle_movements
         WHERE source_type = 'copec_tae' AND vehicle_id IS NOT NULL AND occurred_at >= now() - make_interval(days => ${days})`)
      const ids = [...new Set((Array.isArray(copec) ? copec : (copec as { rows: Array<{ vehicle_id: string }> }).rows).map((row) => row.vehicle_id))]
      if (ids.length === 0) return

      const trucks = await tx
        .select({ vehicleId: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksite: worksites.name, unit: mantEquipmentProfiles.unit, initialReading: mantEquipmentProfiles.initialReading })
        .from(fuelVehicles)
        .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
        .innerJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
        .leftJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
        .where(and(inArray(fuelVehicles.id, ids), eq(fuelEquipmentTypes.performanceFamily, TRUCK_FAMILY), eq(fuelVehicles.isActive, true)))
        .orderBy(worksites.name, fuelVehicles.code)

      for (const truck of trucks) {
        const code = truck.code ?? truck.plate ?? truck.vehicleId
        const worksite = truck.worksite ?? "sin faena"
        if (truck.unit !== "h") { outcomes.push({ code, worksite, result: "ya estaba", detail: truck.unit ?? "unidad del tipo" }); continue }
        const [records] = await tx.select({ n: sql<number>`count(*)::int` }).from(mantRecords).where(and(eq(mantRecords.vehicleId, truck.vehicleId), eq(mantRecords.status, "vigente")))
        const [orders] = await tx.select({ n: sql<number>`count(*)::int` }).from(mantWorkOrders).where(and(eq(mantWorkOrders.vehicleId, truck.vehicleId), notInArray(mantWorkOrders.status, ["cerrada", "anulada"])))
        if (truck.initialReading !== null || (records?.n ?? 0) > 0 || (orders?.n ?? 0) > 0) {
          outcomes.push({ code, worksite, result: "omitido", detail: `lectura inicial ${truck.initialReading ?? "—"}, ${records?.n ?? 0} registros, ${orders?.n ?? 0} OT abiertas` })
          continue
        }
        const result = await setEquipmentUnit(tx, actor, { vehicleId: truck.vehicleId, unit: "km", scheduleId, reason: REASON })
        if (!result.ok) throw new Error(`${code}: ${result.message ?? JSON.stringify(result.errors)}. No se escribió nada.`)
        outcomes.push({ code, worksite, result: apply ? "aplicado" : "dry-run", detail: result.message })
      }
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return outcomes
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const args = process.env.COPEC_KM_ARGS ? process.env.COPEC_KM_ARGS.split(" ") : process.argv.slice(2)
  const get = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : arg(name) }
  const actorEmail = get("--actor-email")
  const scheduleName = (get("--pauta-km") ?? "").replace(/_/g, " ")
  if (!actorEmail || !scheduleName) throw new Error("Uso: --actor-email <correo> --pauta-km <nombre, con _ por espacios> [--dias 30] [--apply]")
  const outcomes = await applyCamionesCopecKm({ actorEmail, scheduleName, days: Number(get("--dias") ?? 30), apply: args.includes("--apply") })
  for (const outcome of outcomes) console.log(`${outcome.result.padEnd(9)} ${outcome.code.padEnd(8)} ${outcome.worksite.padEnd(16)} ${outcome.detail ?? ""}`)
  const count = (result: Result) => outcomes.filter((outcome) => outcome.result === result).length
  console.log(`\nTotal: ${outcomes.length} · movidos ${count("aplicado") + count("dry-run")} · ya estaban ${count("ya estaba")} · omitidos ${count("omitido")}${args.includes("--apply") ? "" : " · SIMULACIÓN, no se escribió nada"}`)
}

if (process.env.COPEC_KM_ARGS || import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
}
