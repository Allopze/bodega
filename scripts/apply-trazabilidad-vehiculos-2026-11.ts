/**
 * scripts/apply-trazabilidad-vehiculos-2026-11.ts
 *
 * Completa la flota con lo que aporta la planilla «TRAZABILIDAD VEHICULOS.xlsx» (hoja TRAZABILIDAD,
 * 2026-11-24): el N.º de serie (llave del cruce con VisionLink) y el año, SOLO donde el equipo de la
 * flota no los tiene. Nunca pisa un dato que ya existe, no crea equipos y no toca la faena (eso es
 * `transferVehiclesTx`).
 *
 * Reglas, pensadas para que un dato dudoso se omita y se informe en vez de adivinarse:
 *   - El equipo se identifica sólo por PATENTE (la planilla repite códigos entre equipos distintos).
 *     Una patente con filas contradictorias entre sí se omite.
 *   - Serie: se limpia (mayúsculas, sin espacios internos ni punto final) y sólo se acepta si queda
 *     alfanumérica de 6 a 20 caracteres, o un VIN de 17 si hubo que limpiarla. Se omite si es igual al
 *     N.º de motor o a la patente, si otra fila de la planilla trae la misma serie para otro equipo, o
 *     si ya la tiene otro equipo de la flota (índice único `fuel_vehicles_serial_number_key`).
 *   - Año: entre 1950 y el año actual. Si la flota ya trae otro año se informa como diferencia.
 *
 * Simulación por defecto: una transacción, rollback y bitácora por equipo. Idempotente.
 *
 *   npx tsx scripts/apply-trazabilidad-vehiculos-2026-11.ts --planilla <xlsx> --actor-email <correo>           # simulación
 *   npx tsx scripts/apply-trazabilidad-vehiculos-2026-11.ts --planilla <xlsx> --actor-email <correo> --apply   # escribe
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, users } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { plateKey } from "@/lib/mantencion/equipment-identity"
import { loadXlsxTolerant } from "@/lib/reports/xlsx-normalize"
import { codeYear } from "@/lib/utils"

const REASON = "Completar serie y año desde la planilla de trazabilidad de vehículos (2026-11-24)"

export interface TrazabilidadRow { code: string; plate: string; serial: string; motor: string; year: string }

type Result = "dry-run" | "aplicado" | "ya estaba" | "omitido" | "diferencia"
export interface Outcome { item: string; field: "serie" | "año"; value: string; result: Result; detail?: string }
export interface TrazabilidadReport { outcomes: Outcome[]; notInFleet: number }
class DryRunRollback extends Error {}

const text = (value: unknown): string => {
  if (value == null) return ""
  if (typeof value === "object" && "text" in (value as object)) return String((value as { text: unknown }).text ?? "").trim()
  if (typeof value === "object" && "result" in (value as object)) return String((value as { result: unknown }).result ?? "").trim()
  return String(value).trim()
}
const headerKey = (raw: unknown) => text(raw).toUpperCase().replace(/[^A-Z0-9]/g, "")

export async function readTrazabilidad(bytes: ArrayBuffer | Uint8Array): Promise<TrazabilidadRow[]> {
  const workbook = await loadXlsxTolerant(bytes)
  if (!workbook) throw new Error("No se pudo leer la planilla: el archivo no es un Excel válido.")
  const sheet = workbook.getWorksheet("TRAZABILIDAD")
  if (!sheet) throw new Error("La planilla no tiene la hoja «TRAZABILIDAD».")
  const columns = new Map<string, number>()
  for (let column = 1; column <= 40; column++) columns.set(headerKey(sheet.getRow(1).getCell(column).value), column)
  const need = (key: string) => {
    const column = columns.get(key)
    if (!column) throw new Error(`La hoja TRAZABILIDAD no tiene la columna ${key}.`)
    return column
  }
  const [cCode, cPlate, cSerial, cMotor, cYear] = [need("CODINTERNO"), need("PATENTE"), need("NSERIE"), need("NMOTOR"), need("AO")]
  const rows: TrazabilidadRow[] = []
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number)
    const parsed = { code: text(row.getCell(cCode).value), plate: text(row.getCell(cPlate).value), serial: text(row.getCell(cSerial).value), motor: text(row.getCell(cMotor).value), year: text(row.getCell(cYear).value) }
    if (parsed.plate) rows.push(parsed)
  }
  return rows
}

/** Devuelve la serie lista para guardar, o el motivo por el que no es confiable. */
export function cleanSerial(raw: string): { serial: string } | { reject: string } {
  const original = raw.trim().toUpperCase()
  if (!original) return { reject: "sin serie" }
  if (/^[A-Z0-9][A-Z0-9-]{5,19}$/.test(original)) return { serial: original }
  const compact = original.replace(/[\s.]/g, "")
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(compact)) return { serial: compact }
  return { reject: `«${original}» no parece un N.º de serie (se omite sin adivinar)` }
}

export async function applyTrazabilidadVehiculos(options: { rows: readonly TrazabilidadRow[]; actorEmail: string; apply?: boolean }): Promise<TrazabilidadReport> {
  const apply = options.apply ?? false
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const currentYear = Number(codeYear())

  const byPlate = new Map<string, TrazabilidadRow[]>()
  for (const row of options.rows) {
    const key = plateKey(row.plate)
    if (key) byPlate.set(key, [...(byPlate.get(key) ?? []), row])
  }
  // Una serie que la planilla repite en equipos distintos es sospechosa en todos ellos.
  const plateBySerial = new Map<string, Set<string>>()
  for (const [key, rows] of byPlate) for (const row of rows) {
    const cleaned = cleanSerial(row.serial)
    if ("serial" in cleaned) plateBySerial.set(cleaned.serial, new Set([...(plateBySerial.get(cleaned.serial) ?? []), key]))
  }

  const report: TrazabilidadReport = { outcomes: [], notInFleet: 0 }
  try {
    await db.transaction(async (tx) => {
      const fleet = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, serialNumber: fuelVehicles.serialNumber, year: fuelVehicles.year, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles)
      const serialOwner = new Map(fleet.filter((v) => v.serialNumber).map((v) => [v.serialNumber!.toUpperCase(), v.id]))
      const seen = new Set<string>()
      for (const vehicle of fleet) {
        const rows = byPlate.get(plateKey(vehicle.plate))
        if (!rows) continue
        seen.add(plateKey(vehicle.plate))
        const label = vehicle.code ?? vehicle.plate
        const patch: { serialNumber?: string; year?: number } = {}

        // Serie
        const serials = new Set(rows.map((row) => row.serial.trim().toUpperCase()).filter(Boolean))
        if (serials.size > 0) {
          if (vehicle.serialNumber) {
            const same = [...serials].some((s) => s === vehicle.serialNumber!.toUpperCase())
            report.outcomes.push({ item: label, field: "serie", value: vehicle.serialNumber, result: same ? "ya estaba" : "diferencia", detail: same ? undefined : `la flota ya trae otra serie; planilla: ${[...serials].join(" / ")}` })
          } else if (serials.size > 1) {
            report.outcomes.push({ item: label, field: "serie", value: [...serials].join(" / "), result: "omitido", detail: "la planilla trae series distintas para la misma patente" })
          } else {
            const raw = [...serials][0]!
            const cleaned = cleanSerial(raw)
            const motors = new Set(rows.map((row) => row.motor.replace(/[^A-Za-z0-9]/g, "").toUpperCase()).filter(Boolean))
            if ("reject" in cleaned) report.outcomes.push({ item: label, field: "serie", value: raw, result: "omitido", detail: cleaned.reject })
            else if (motors.has(cleaned.serial.replace(/[^A-Z0-9]/g, "")) || plateKey(cleaned.serial) === plateKey(vehicle.plate)) report.outcomes.push({ item: label, field: "serie", value: cleaned.serial, result: "omitido", detail: "es igual al N.º de motor o a la patente" })
            else if ((plateBySerial.get(cleaned.serial)?.size ?? 0) > 1) report.outcomes.push({ item: label, field: "serie", value: cleaned.serial, result: "omitido", detail: "la planilla trae la misma serie en otro equipo" })
            else if (serialOwner.has(cleaned.serial)) report.outcomes.push({ item: label, field: "serie", value: cleaned.serial, result: "omitido", detail: "ya la tiene otro equipo de la flota" })
            else {
              patch.serialNumber = cleaned.serial
              report.outcomes.push({ item: label, field: "serie", value: cleaned.serial, result: apply ? "aplicado" : "dry-run", detail: cleaned.serial !== raw.toUpperCase() ? `limpiada desde «${raw}»` : undefined })
            }
          }
        }

        // Año
        const years = new Set(rows.map((row) => row.year.trim()).filter((y) => /^\d{4}$/.test(y)).map(Number))
        if (years.size === 1) {
          const year = [...years][0]!
          if (vehicle.year) {
            if (vehicle.year !== year) report.outcomes.push({ item: label, field: "año", value: String(vehicle.year), result: "diferencia", detail: `la flota dice ${vehicle.year}; la planilla ${year}` })
          } else if (year < 1950 || year > currentYear) report.outcomes.push({ item: label, field: "año", value: String(year), result: "omitido", detail: "fuera de rango" })
          else {
            patch.year = year
            report.outcomes.push({ item: label, field: "año", value: String(year), result: apply ? "aplicado" : "dry-run" })
          }
        }

        if (patch.serialNumber || patch.year) {
          if (patch.serialNumber) serialOwner.set(patch.serialNumber, vehicle.id)
          // Sólo estas dos columnas: la faena y todo lo demás quedan como estaban.
          await tx.update(fuelVehicles).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, vehicle.id))
          await recordAudit({
            userId: actor.userId, userEmail: actor.email, action: "update", entityType: "fuel_vehicle", entityId: vehicle.id, entityCode: vehicle.plate,
            oldState: { serialNumber: vehicle.serialNumber, year: vehicle.year }, newState: { serialNumber: patch.serialNumber ?? vehicle.serialNumber, year: patch.year ?? vehicle.year },
            reason: REASON, worksiteId: vehicle.worksiteId,
          }, tx)
        }
      }
      report.notInFleet = [...byPlate.keys()].filter((key) => !seen.has(key)).length
      // La simulación corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return report
}

export function printReport(report: TrazabilidadReport, apply: boolean) {
  const n = (r: Result, f?: Outcome["field"]) => report.outcomes.filter((o) => o.result === r && (!f || o.field === f)).length
  for (const result of ["omitido", "diferencia"] as const) {
    const list = report.outcomes.filter((o) => o.result === result)
    if (list.length === 0) continue
    console.log(`\n${result === "omitido" ? "Omitidos (no se cargan)" : "Diferencias (no se pisan)"}:`)
    for (const o of list) console.log(`  ${o.item.padEnd(10)} ${o.field.padEnd(6)} ${o.value.padEnd(24)} ${o.detail ?? ""}`)
  }
  const done: Result = apply ? "aplicado" : "dry-run"
  console.log(`\n${apply ? "Aplicado" : "Por aplicar (simulación)"}: ${n(done, "serie")} series y ${n(done, "año")} años. Ya estaban: ${n("ya estaba")}. Omitidos: ${n("omitido")}. Diferencias: ${n("diferencia")}.`)
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
  const planilla = argValue(argv, "--planilla")
  if (!planilla) throw new Error("Falta --planilla <xlsx>.")
  const rows = await readTrazabilidad(readFileSync(planilla))
  console.log(`Trazabilidad de vehículos (${rows.length} filas) — ${apply ? "escribiendo" : "simulación (no escribe)"}`)
  printReport(await applyTrazabilidadVehiculos({ rows, actorEmail, apply }), apply)
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
