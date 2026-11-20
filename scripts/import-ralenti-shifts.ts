/**
 * Importa a la plataforma los turnos de operación de la página original «Ralentí Cholguán».
 *
 * Lee un JSON exportado de esa página: un arreglo de `RalentiShiftDoc`
 * (`{ id, equipo, fecha, ini, fin, operador, obs?, actualizado? }`) o un objeto
 * `{ "turnos": [...] }`. El archivo trae nombres de personas: guardarlo FUERA del repo.
 *
 *   npm run db:import-ralenti-shifts -- --file=/ruta/turnos.json --author-email=<correo>           # informa, no escribe
 *   npm run db:import-ralenti-shifts -- --file=/ruta/turnos.json --author-email=<correo> --apply   # escribe
 *
 * - Equipo: `fuel_vehicles.code` exacto. Operador: trabajador activo por nombre
 *   (sin tildes ni mayúsculas; «Jose Briceño» calza con «José Ignacio Briceño Soto»).
 * - Si algo no calza el script no escribe nada, aunque venga `--apply`, y lo lista.
 * - El id original queda en `import_ref` (`ralenti:<id>`): correrlo dos veces no duplica.
 * - Los turnos que se cruzan por operador se importan tal cual y se listan para corregirlos
 *   en la plataforma (al editarlos, la regla de cruces ya aplica).
 * - Con `--apply` todo va en una sola transacción, con una constancia resumen en la bitácora.
 * - `--fuera-servicio=<json>` (opcional) lista las marcas «fuera de servicio» de la página
 *   original (`[{ equipo, fecha, motivo, obs }]` u objeto `{ "fuera_servicio": [...] }`). NO se
 *   importan: una avería es el estado del equipo, que se revisa en su ficha.
 *
 * Se corre a mano, una vez; no forma parte del deploy.
 */
import { readFileSync } from "node:fs"
import { and, between, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fleetOperationShifts, fuelVehicles, users, workers, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { hourKeyId, shiftHourKeys } from "@/lib/fleet/shifts/hours"
import { planShiftImport, type RalentiShiftDoc } from "@/lib/fleet/shifts/import-plan"
import { addDaysToPlainDate } from "@/lib/utils"

function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = argv.indexOf(`--${name}`)
  const next = index >= 0 ? argv[index + 1] : undefined
  return next && !next.startsWith("--") ? next : undefined
}

function readDocs(file: string): RalentiShiftDoc[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
  const list = Array.isArray(parsed) ? parsed : (parsed as { turnos?: unknown } | null)?.turnos
  if (!Array.isArray(list)) throw new Error("El archivo debe ser un arreglo de turnos o un objeto { \"turnos\": [...] }.")
  return list as RalentiShiftDoc[]
}

interface OutOfServiceMark {
  equipo: string
  fecha: string
  motivo?: string
  obs?: string
}

function readOutOfServiceMarks(file: string): OutOfServiceMark[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
  const list = Array.isArray(parsed) ? parsed : (parsed as { fuera_servicio?: unknown } | null)?.fuera_servicio
  if (!Array.isArray(list)) throw new Error("--fuera-servicio debe ser un arreglo de marcas o un objeto { \"fuera_servicio\": [...] }.")
  return (list as OutOfServiceMark[]).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.equipo.localeCompare(b.equipo))
}

async function main(argv = process.argv.slice(2)) {
  const file = argValue(argv, "file")
  const authorEmail = argValue(argv, "author-email")
  const apply = argv.includes("--apply")
  if (!file) throw new Error("Falta --file=<json>.")
  if (!authorEmail) throw new Error("Falta --author-email=<correo>: los turnos y la bitácora necesitan un responsable.")

  const docs = readDocs(file)

  const author = await db.query.users.findFirst({
    where: and(eq(users.email, authorEmail), eq(users.isActive, true)),
    columns: { id: true, email: true },
  })
  if (!author) throw new Error(`No hay un usuario activo con el correo ${authorEmail}.`)

  const vehicles = (await db.select({ id: fuelVehicles.id, code: fuelVehicles.code }).from(fuelVehicles))
    .flatMap((vehicle) => (vehicle.code ? [{ id: vehicle.id, code: vehicle.code }] : []))
  const activeWorkers = await db
    .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, worksiteName: worksites.name })
    .from(workers)
    .innerJoin(worksites, eq(worksites.id, workers.worksiteId))
    .where(eq(workers.isActive, true))
  const existing = await db
    .select({ importRef: fleetOperationShifts.importRef })
    .from(fleetOperationShifts)
    .where(isNotNull(fleetOperationShifts.importRef))
  const existingImportRefs = new Set(existing.flatMap((row) => (row.importRef ? [row.importRef] : [])))

  const plan = planShiftImport(docs, { vehicles, workers: activeWorkers, existingImportRefs })

  // Cruces por equipo contra turnos que ya están en la plataforma (p. ej. registrados a mano antes de importar).
  if (plan.rows.length > 0) {
    const dates = plan.rows.map((row) => row.shiftDate).sort()
    const existingShifts = await db.select({
      vehicleId: fleetOperationShifts.vehicleId, shiftDate: fleetOperationShifts.shiftDate,
      startHour: fleetOperationShifts.startHour, endHour: fleetOperationShifts.endHour,
      operatorName: fleetOperationShifts.operatorNameSnapshot, importRef: fleetOperationShifts.importRef,
    }).from(fleetOperationShifts).where(and(
      isNull(fleetOperationShifts.voidedAt),
      inArray(fleetOperationShifts.vehicleId, [...new Set(plan.rows.map((row) => row.vehicleId))]),
      between(fleetOperationShifts.shiftDate, addDaysToPlainDate(dates[0]!, -1), addDaysToPlainDate(dates[dates.length - 1]!, 1)),
    ))
    const codeById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.code]))
    for (const row of plan.rows) {
      const hours = new Set(shiftHourKeys(row).map(hourKeyId))
      const clash = existingShifts.find((other) => other.vehicleId === row.vehicleId && other.importRef !== row.importRef
        && shiftHourKeys(other).some((key) => hours.has(hourKeyId(key))))
      if (clash) {
        plan.errors.push(`Equipo ${codeById.get(row.vehicleId)}: el turno ${row.shiftDate} ${row.startHour}–${row.endHour} (${row.operatorName}) se cruza con uno ya registrado en la plataforma (${clash.shiftDate} ${clash.startHour}–${clash.endHour}, ${clash.operatorName}).`)
      }
    }
  }

  console.log(`Turnos en el archivo: ${docs.length}`)
  console.log(`A importar: ${plan.rows.length}`)
  console.log(`Ya importados: ${plan.alreadyImported}`)
  console.log(`Errores: ${plan.errors.length}`)
  for (const error of plan.errors) console.log(`  - ${error}`)
  const worksiteByWorker = new Map(activeWorkers.map((worker) => [worker.id, worker.worksiteName]))
  console.log(`Operadores (confirmar que cada uno quedó con la persona correcta): ${plan.operatorMatches.length}`)
  for (const match of plan.operatorMatches) console.log(`  - ${match.operator} → ${match.workerName} (${worksiteByWorker.get(match.workerId) ?? "sin faena"})`)
  console.log(`Cruces por operador (se importan tal cual): ${plan.operatorOverlaps.length}`)
  for (const overlap of plan.operatorOverlaps) console.log(`  - ${overlap}`)
  const outOfServiceFile = argValue(argv, "fuera-servicio")
  if (outOfServiceFile) {
    const marks = readOutOfServiceMarks(outOfServiceFile)
    console.log(`Marcas «fuera de servicio» de la página original (NO se importan; revisar el estado en la ficha del equipo): ${marks.length}`)
    for (const mark of marks) console.log(`  - ${mark.equipo} ${mark.fecha}: ${mark.motivo ?? "sin motivo"}${mark.obs ? ` · ${mark.obs}` : ""}`)
  }

  if (plan.errors.length > 0) {
    console.log(apply ? "\nHay errores: no se escribió nada." : "\nHay errores: corrígelos antes de aplicar.")
    process.exitCode = 1
    return
  }
  if (!apply) {
    console.log("\nDry-run: no se escribió nada. Agrega --apply para importar.")
    return
  }
  if (plan.rows.length === 0) {
    console.log("\nNada que importar.")
    return
  }

  await db.transaction(async (tx) => {
    await tx.insert(fleetOperationShifts).values(plan.rows.map((row) => ({
      id: nanoid(),
      vehicleId: row.vehicleId,
      shiftDate: row.shiftDate,
      startHour: row.startHour,
      endHour: row.endHour,
      operatorWorkerId: row.operatorWorkerId,
      operatorNameSnapshot: row.operatorName,
      notes: row.notes,
      importRef: row.importRef,
      createdBy: author.id,
      updatedBy: author.id,
    })))
    await recordAudit({
      userId: author.id,
      userEmail: author.email,
      action: "create",
      entityType: "fleet_operation_shift_import",
      entityId: `ralenti:${new Date().toISOString()}`,
      newState: {
        importados: plan.rows.length,
        yaImportados: plan.alreadyImported,
        crucesPorOperador: plan.operatorOverlaps.length,
        desde: plan.rows.reduce((min, row) => (row.shiftDate < min ? row.shiftDate : min), plan.rows[0]!.shiftDate),
        hasta: plan.rows.reduce((max, row) => (row.shiftDate > max ? row.shiftDate : max), plan.rows[0]!.shiftDate),
      },
      reason: "Importación de los turnos de «Ralentí Cholguán»",
    }, tx)
  })
  console.log(`\nImportados ${plan.rows.length} turnos.`)
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
