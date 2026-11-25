/**
 * scripts/apply-medidor-camiones-2026-11.ts
 *
 * Los camiones y tractocamiones de producción miden en horas (horómetro) en Mantención y los de
 * Biodiversa, que van por ruta, en kilómetros (decisión del usuario, 2026-11-25). Este script mueve
 * a horas los equipos que ya estaban en el módulo: lo que el alta nueva decide por la regla de
 * `lib/mantencion/equipment-unit.ts`, aquí se aplica a los existentes.
 *
 * Es sólo de Mantención: pasa por `setEquipmentUnit`, que escribe el perfil (`mant_equipment_profiles`)
 * y no toca `fuel_vehicles` (el medidor y el rendimiento de Combustible no cambian). Por cada equipo:
 *   - la unidad pasa a horas;
 *   - se suelta la pauta en km (o se pone `--pauta-horas`, si ya existe una pauta en horas);
 *   - la lectura inicial y la preventiva declarada anterior a la plataforma, que estaban en km, se
 *     limpian (la lectura inicial en horas sale de `--lecturas`, si se entrega);
 *   - los registros de Mantención existentes NO se tocan: quedan en km como historia, y dejan de
 *     alimentar la lectura y el estado de la pauta del equipo.
 *
 * Los equipos de la faena `BIODIVERSA` se dejan como están (kilómetros). Si esa faena no existe con
 * ese código, el script se detiene: sin ella no puede distinguir a quién dejar en kilómetros.
 *
 * Simulación por defecto: corre el mismo código en una transacción y la deshace. Idempotente: un
 * equipo que ya mide en horas queda «ya estaba».
 *
 *   npx tsx scripts/apply-medidor-camiones-2026-11.ts --actor-email <correo> [--pauta-horas <nombre>] [--lecturas <json>]
 *   npx tsx scripts/apply-medidor-camiones-2026-11.ts --actor-email <correo> [--pauta-horas <nombre>] [--lecturas <json>] --apply
 *
 * `--lecturas` es un JSON `{ "KPL-133": { "reading": 6638, "date": "2026-11-09" } }`, con la clave
 * por código o patente, con la última lectura del horómetro de cada equipo.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantRecords, mantSchedules, users, worksites } from "@/db/schema"
import { equipmentCodeKey, plateKey } from "@/lib/mantencion/equipment-identity"
import { ODOMETER_TRUCK_WORKSITE_CODE, TRUCK_PERFORMANCE_FAMILY, effectiveMaintenanceUnit } from "@/lib/mantencion/equipment-unit"
import { setEquipmentUnit } from "@/lib/services/mantencion/equipment-unit-change"

const REASON = "Los camiones de producción miden en horas (horómetro) y los de Biodiversa en kilómetros (decisión del usuario, 2026-11-25)"

export interface InitialHoursReading { reading: number; date: string }
export type InitialHoursReadings = Record<string, InitialHoursReading>

type Result = "dry-run" | "aplicado" | "ya estaba" | "omitido"
export interface Outcome {
  code: string
  worksite: string
  result: Result
  detail?: string
}
export interface MedidorReport {
  outcomes: Outcome[]
  /** Equipos en la faena que se queda en kilómetros: no se tocan. */
  keptInKm: number
  /** Camiones sin baja que no están en Mantención (sin perfil): no se tocan. */
  withoutProfile: number
}
class DryRunRollback extends Error {}

export interface ApplyOptions {
  actorEmail: string
  apply?: boolean
  /** Nombre de una pauta en horas ya creada, que se asigna a todos los equipos movidos. */
  scheduleName?: string
  readings?: InitialHoursReadings
}

/** `readings` indexado por código o patente normalizados, para buscar por cualquiera de los dos. */
function indexReadings(readings: InitialHoursReadings | undefined): Map<string, InitialHoursReading> {
  const index = new Map<string, InitialHoursReading>()
  for (const [key, value] of Object.entries(readings ?? {})) {
    index.set(`c:${equipmentCodeKey(key)}`, value)
    index.set(`p:${plateKey(key)}`, value)
  }
  return index
}

export async function applyMedidorCamiones(options: ApplyOptions): Promise<MedidorReport> {
  const apply = options.apply ?? false
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const readings = indexReadings(options.readings)
  const report: MedidorReport = { outcomes: [], keptInKm: 0, withoutProfile: 0 }

  try {
    await db.transaction(async (tx) => {
      const [kmSite] = await tx.select({ id: worksites.id }).from(worksites).where(eq(worksites.code, ODOMETER_TRUCK_WORKSITE_CODE)).limit(1)
      if (!kmSite) throw new Error(`No existe la faena con código ${ODOMETER_TRUCK_WORKSITE_CODE}: sin ella no se sabe qué camiones se quedan en kilómetros. No se escribió nada.`)

      let scheduleId: string | null = null
      if (options.scheduleName) {
        const rows = await tx.select({ id: mantSchedules.id, unit: mantSchedules.unit }).from(mantSchedules)
          .where(and(eq(mantSchedules.name, options.scheduleName), isNull(mantSchedules.deletedAt)))
        if (rows.length !== 1) throw new Error(`La pauta «${options.scheduleName}» ${rows.length === 0 ? "no existe" : "está repetida"}. No se escribió nada.`)
        if (rows[0]!.unit !== "h") throw new Error(`La pauta «${options.scheduleName}» se mide en kilómetros, no en horas. No se escribió nada.`)
        scheduleId = rows[0]!.id
      }

      const trucks = await tx
        .select({
          vehicleId: fuelVehicles.id,
          code: fuelVehicles.code,
          plate: fuelVehicles.plate,
          worksiteId: fuelVehicles.worksiteId,
          worksiteName: worksites.name,
          profileUnit: mantEquipmentProfiles.unit,
          typeMeter: fuelEquipmentTypes.defaultMeterType,
          hasProfile: mantEquipmentProfiles.vehicleId,
        })
        .from(fuelVehicles)
        .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
        .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
        .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
        .where(and(eq(fuelEquipmentTypes.performanceFamily, TRUCK_PERFORMANCE_FAMILY), eq(fuelVehicles.isActive, true)))
        .orderBy(worksites.name, fuelVehicles.code)

      for (const truck of trucks) {
        const label = truck.code ?? truck.plate
        if (truck.hasProfile === null) { report.withoutProfile += 1; continue }
        if (truck.worksiteId === kmSite.id) { report.keptInKm += 1; continue }

        const reading = readings.get(`c:${equipmentCodeKey(truck.code)}`) ?? readings.get(`p:${plateKey(truck.plate)}`)
        const unit = effectiveMaintenanceUnit(truck.profileUnit, truck.typeMeter)
        const base = { code: label, worksite: truck.worksiteName }
        if (!unit) { report.outcomes.push({ ...base, result: "omitido", detail: "su tipo no se mide en km ni en horas" }); continue }

        const [kmRecords] = await tx.select({ n: mantRecords.id }).from(mantRecords)
          .where(and(eq(mantRecords.vehicleId, truck.vehicleId), eq(mantRecords.unit, "km"), eq(mantRecords.status, "vigente"))).limit(1)
        const result = await setEquipmentUnit(tx, actor, {
          vehicleId: truck.vehicleId,
          unit: "h",
          scheduleId,
          initialReading: reading?.reading ?? null,
          initialReadingDate: reading?.date ?? null,
          reason: REASON,
        })
        if (!result.ok) {
          report.outcomes.push({ ...base, result: "omitido", detail: result.message })
          continue
        }
        if (!result.data.changed) { report.outcomes.push({ ...base, result: "ya estaba" }); continue }
        const notes = [
          kmRecords ? "sus registros en km quedan como historia" : "sin registros en km",
          scheduleId ? "pauta en horas asignada" : "sin pauta hasta que haya una en horas",
          reading ? "lectura inicial en horas cargada" : "sin lectura inicial en horas",
        ]
        report.outcomes.push({ ...base, result: apply ? "aplicado" : "dry-run", detail: notes.join("; ") })
      }
      // La simulación corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return report
}

export function printMedidorReport(report: MedidorReport, apply: boolean) {
  for (const o of report.outcomes) console.log(`  ${o.code.padEnd(10)} ${o.worksite.padEnd(20)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  const n = (r: Result) => report.outcomes.filter((o) => o.result === r).length
  console.log(`\n${apply ? `${n("aplicado")} aplicado(s)` : `${n("dry-run")} por aplicar (simulación)`}, ${n("ya estaba")} ya estaban, ${n("omitido")} omitido(s).`)
  console.log(`${report.keptInKm} de la faena ${ODOMETER_TRUCK_WORKSITE_CODE} se quedan en kilómetros; ${report.withoutProfile} camiones sin ficha de Mantención no se tocan.`)
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${flag}.`)
  return value
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argValue(argv, "--actor-email")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  const readingsPath = argValue(argv, "--lecturas")
  const readings = readingsPath ? (JSON.parse(readFileSync(readingsPath, "utf8")) as InitialHoursReadings) : undefined
  console.log(`Camiones de producción a horas (Mantención) — ${apply ? "escribiendo" : "simulación (no escribe)"}`)
  printMedidorReport(await applyMedidorCamiones({ actorEmail, apply, scheduleName: argValue(argv, "--pauta-horas"), readings }), apply)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
