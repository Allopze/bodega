import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import postgres from "postgres"
import sharp from "sharp"
import { createMantencionFilePath, resolveMantencionDir, resolveMantencionFile } from "../lib/storage/config"
import { resolveE2eDatabaseUrl } from "./environment"

/**
 * Siembra del tablero de mantención estilo Looker (`mantencion-panel-looker.spec.ts`).
 *
 * Todo es propio y lleva el prefijo `QA`: dos faenas, tres equipos con ficha (dos camiones y una
 * máquina por horas), cinco pautas del histórico con su detalle por ítem, tres OT con su
 * correctiva y conductor, y fotos de respaldo con archivo REAL en el directorio de storage
 * de la aplicación. `cleanupLooker` lo borra todo —filas y archivos— y se corre antes (restos de
 * una corrida abortada) y después.
 *
 * Fechas FIJAS, no «hoy − N días»: el histórico de formularios cuenta sólo antes del corte
 * (`FORMS_CUTOVER_DATE`, 2026-12-01) y una fecha relativa lo cruzaría sola a los pocos días,
 * sacando las pautas del tablero sin que cambiara nada en el código. Las OT cuentan siempre. La
 * prueba mira el período `PERIOD`, que contiene todas las fechas y termina antes de hoy.
 */

export const RUTA = "/mantencion/panel"
export const PERIOD = "desde=2026-10-01&hasta=2026-11-20"
export const CUTOVER = "2026-12-01"

export const QA = {
  wsA: { id: "qa-looker-ws-a", name: "QA_ Faena Looker A", code: "QA-LKR-A" },
  wsB: { id: "qa-looker-ws-b", name: "QA_ Faena Looker B", code: "QA-LKR-B" },
  /** Camión de la faena A. */
  a1: { id: "qa-looker-veh-a1", code: "QA-LK-A1", plate: "QALKA1" },
  /** Camión de la faena B. */
  b1: { id: "qa-looker-veh-b1", code: "QA-LK-B1", plate: "QALKB1" },
  /** Máquina por horas de la faena A. */
  m1: { id: "qa-looker-veh-m1", code: "QA-LK-M1", plate: "QALKM1" },
  otA1: "OT-QA-LOOKER-0001",
  otB1: "OT-QA-LOOKER-0002",
  otM1: "OT-QA-LOOKER-0003",
  recordA1: "MR-QA-LOOKER-1",
  recordB1: "MR-QA-LOOKER-2",
  recordM1: "MR-QA-LOOKER-3",
  driverA: { key: "qa-e2e-looker-driver", name: "QA_ CONDUCTOR LOOKER" },
  driverB: { key: "qa-e2e-looker-driver-2", name: "QA_ CONDUCTOR DOS" },
  driverM: { key: "qa-e2e-looker-driver-m", name: "QA_ OPERADOR MAQUINA" },
  mechanicA: "QA_ MECANICO UNO",
  mechanicB: "QA_ MECANICO DOS",
  mechanicM: "QA_ MECANICO TRES",
  /** Id de la foto de la correctiva de la OT A1 (UUID: la ruta de la foto lo exige). */
  photoWork: "5a0e2c1d-7b3f-4e8a-9c61-aa1d00000001",
  /** Id de la foto de una preventiva de la plataforma. */
  photoPreventive: "5a0e2c1d-7b3f-4e8a-9c61-aa1d00000002",
  recordP: "MR-QA-LOOKER-P",
} as const

/** Pautas históricas. `check` es el `source_key`; la columna de la matriz lo lleva como `h:<key>`. */
export const CHECKS = {
  a1Oct: { key: "qa-e2e-looker-check-a1-oct", date: "2026-10-14" },
  a1Nov: { key: "qa-e2e-looker-check-a1-nov", date: "2026-11-10" },
  b1Nov: { key: "qa-e2e-looker-check-b1-nov", date: "2026-11-12" },
  m1Nov: { key: "qa-e2e-looker-check-m1-nov", date: "2026-11-05" },
  m1Oct: { key: "qa-e2e-looker-check-m1-oct", date: "2026-10-20" },
} as const

export const OT_DATES = { a1: "2026-11-12", b1: "2026-10-20", m1: "2026-11-08" } as const

type Item = [name: string, result: "realizado" | "no_realizado" | "no_aplica"]
const OIL: Item[] = [["QA_ Cambio aceite motor", "realizado"], ["QA_ Revisión frenos", "no_realizado"], ["QA_ Revisión ABS", "no_aplica"]]
const OIL_OK: Item[] = [["QA_ Cambio aceite motor", "realizado"], ["QA_ Revisión frenos", "realizado"], ["QA_ Revisión ABS", "realizado"]]
const OIL_B: Item[] = [["QA_ Cambio aceite motor", "no_realizado"], ["QA_ Revisión frenos", "realizado"], ["QA_ Revisión ABS", "no_aplica"]]
const HYD: Item[] = [["QA_ Nivel hidráulico", "realizado"], ["QA_ Filtro de aire", "realizado"], ["QA_ Mangueras", "no_aplica"]]
const HYD_B: Item[] = [["QA_ Nivel hidráulico", "no_realizado"], ["QA_ Filtro de aire", "realizado"], ["QA_ Mangueras", "realizado"]]

type Sql = postgres.Sql

export async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const url = resolveE2eDatabaseUrl()
  if (!url) throw new Error("E2E_DATABASE_URL es obligatoria")
  const sql = postgres(url, { max: 1 })
  try {
    return await run(sql)
  } finally {
    await sql.end()
  }
}

const VEHICLE_IDS = [QA.a1.id, QA.b1.id, QA.m1.id]
const WORKSITE_IDS = [QA.wsA.id, QA.wsB.id]
const OT_FOLIOS = [QA.otA1, QA.otB1, QA.otM1]
const RECORD_FOLIOS = [QA.recordA1, QA.recordB1, QA.recordM1, QA.recordP]
const PHOTO_IDS = [QA.photoWork, QA.photoPreventive]

/** Borra filas y archivos QA. Es idempotente y no falla si no hay nada. */
export async function cleanupLooker(sql: Sql) {
  const photos = await sql<Array<{ storage_key: string }>>`select storage_key from mant_record_photos where id in ${sql(PHOTO_IDS)}`
  for (const photo of photos) {
    const absolute = resolveMantencionFile(photo.storage_key)
    if (absolute) rmSync(absolute, { force: true })
  }
  // Un archivo que quedó sin fila (corrida abortada entre escribir y registrar) se encuentra por su id.
  try {
    for (const name of readdirSync(resolveMantencionDir())) {
      if (PHOTO_IDS.some((id) => name.startsWith(id))) rmSync(path.join(resolveMantencionDir(), name), { force: true })
    }
  } catch {
    // El directorio todavía no existe: no hay nada que borrar.
  }
  await sql`delete from mant_record_photos where id in ${sql(PHOTO_IDS)}`
  await sql`delete from mant_records where folio in ${sql(RECORD_FOLIOS)}`
  await sql`delete from mant_work_orders where folio in ${sql(OT_FOLIOS)}`
  await sql`delete from mant_drivers where name_key in ${sql([QA.driverA.key, QA.driverB.key, QA.driverM.key])}`
  // Los ítems del detalle caen por cascada.
  await sql`delete from mant_historical_schedule_checks where source_key like 'qa-e2e-looker-check-%'`
  await sql`delete from mant_equipment_history where vehicle_id in ${sql(VEHICLE_IDS)}`
  await sql`delete from mant_equipment_profiles where vehicle_id in ${sql(VEHICLE_IDS)}`
  await sql`delete from fuel_vehicles where id in ${sql(VEHICLE_IDS)}`
  await sql`delete from worksites where id in ${sql(WORKSITE_IDS)}`
}

async function insertCheck(
  sql: Sql,
  adminId: string,
  row: { key: string; date: string; label: string; vehicle: { id: string; code: string; plate: string }; worksite: { id: string; name: string }; done: number; notDone: number; na: number; mechanic: string; form: string },
  index: number,
  items: Item[],
) {
  await sql`
    insert into mant_historical_schedule_checks (
      source_key, fingerprint, source_file, source_sheet, source_row, submitted_at, performed_on,
      form_kind, schedule_label, equipment_text, vehicle_id, equipment_match, worksite_text, worksite_id,
      reading, done_count, not_done_count, not_applicable_count, compliance, mechanic, observations,
      is_test, fields, imported_by
    ) values (
      ${row.key}, ${row.key}, 'QA_looker.xlsx', 'PAUTAS_PREVENTIVAS', ${index + 2}, ${`${row.date} 10:00:00`}, ${row.date},
      ${row.form}, ${row.label}, ${`${row.vehicle.code} / ${row.vehicle.plate}`}, ${row.vehicle.id}, 'linked',
      ${row.worksite.name}, ${row.worksite.id}, 150000, ${row.done}, ${row.notDone}, ${row.na},
      ${row.done / (row.done + row.notDone)}, ${row.mechanic}, ${`QA_ Observación ${row.vehicle.code}`},
      false, ${sql.json([])}, ${adminId}
    )`
  for (const [position, [name, result]] of items.entries()) {
    await sql`
      insert into mant_historical_schedule_items (source_key, check_source_key, item_name, result, sort_order)
      values (${`${row.key}-item-${position}`}, ${row.key}, ${name}, ${result}, ${position})`
  }
}

/** PNG real (no un archivo vacío): el servidor lo lee del disco y el navegador lo decodifica. */
async function storePhoto(id: string) {
  const width = 96
  const height = 64
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 39, g: 137, b: 77 } } }).png().toBuffer()
  const sha256 = createHash("sha256").update(png).digest("hex")
  const storageKey = createMantencionFilePath(`${id}-${sha256.slice(0, 12)}.png`)
  const absolute = resolveMantencionFile(storageKey)
  if (!absolute) throw new Error("Ruta de foto inválida")
  mkdirSync(resolveMantencionDir(), { recursive: true })
  writeFileSync(absolute, png)
  return { storageKey, sha256, bytes: png.length, width, height }
}

/** Archivos de una foto sembrada que siguen en el directorio de storage. */
export function photoFilesOnDisk(id: string): string[] {
  try {
    return readdirSync(resolveMantencionDir()).filter((name) => name.startsWith(id))
  } catch {
    return []
  }
}

/** Filas QA y archivos de foto que quedan en la base y en el disco: tras `cleanupLooker` deben ser 0. */
export async function leftovers(sql: Sql): Promise<number> {
  const [row] = await sql`
    select (select count(*) from mant_work_orders where folio like 'OT-QA-LOOKER-%')
         + (select count(*) from mant_records where folio like 'MR-QA-LOOKER-%')
         + (select count(*) from mant_historical_schedule_checks where source_key like 'qa-e2e-looker-check-%')
         + (select count(*) from mant_historical_schedule_items where check_source_key like 'qa-e2e-looker-check-%')
         + (select count(*) from mant_record_photos where id in ${sql(PHOTO_IDS)})
         + (select count(*) from mant_drivers where name_key like 'qa-e2e-looker-driver%')
         + (select count(*) from mant_equipment_profiles where vehicle_id in ${sql(VEHICLE_IDS)})
         + (select count(*) from fuel_vehicles where id in ${sql(VEHICLE_IDS)})
         + (select count(*) from worksites where id in ${sql(WORKSITE_IDS)}) as n`
  return Number(row?.n) + PHOTO_IDS.reduce((sum, id) => sum + photoFilesOnDisk(id).length, 0)
}

export async function seedLooker(sql: Sql) {
  await cleanupLooker(sql)
  // En la base E2E está `admin@e2e.chome.cl`; contra una base de desarrollo el usuario puede ser
  // otro: el sembrado sólo necesita un usuario activo que exista.
  const [e2eAdmin] = await sql`select id from users where email = 'admin@e2e.chome.cl'`
  const [admin] = e2eAdmin ? [e2eAdmin] : await sql`select id from users where is_active order by created_at limit 1`
  const [odometer] = await sql`select id, slug, name from fuel_equipment_types where default_meter_type = 'odometer' and is_active order by name limit 1`
  const [hourMeter] = await sql`select id, slug, name from fuel_equipment_types where default_meter_type = 'hour_meter' and is_active order by name limit 1`
  const [brand] = await sql`select id from mant_brands order by id limit 1`
  if (!admin || !odometer || !hourMeter || !brand) {
    throw new Error("La carga E2E no trae un administrador, un tipo por km, un tipo por horas y una marca de mantención")
  }

  for (const site of [QA.wsA, QA.wsB]) {
    await sql`insert into worksites (id, name, code, is_active) values (${site.id}, ${site.name}, ${site.code}, true)`
  }
  const vehicles = [
    { v: QA.a1, ws: QA.wsA.id, type: odometer, meter: "odometer" },
    { v: QA.b1, ws: QA.wsB.id, type: odometer, meter: "odometer" },
    { v: QA.m1, ws: QA.wsA.id, type: hourMeter, meter: "hour_meter" },
  ]
  for (const { v, ws, type, meter } of vehicles) {
    await sql`
      insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id, meter_type, brand, model, year, is_active)
      values (${v.id}, ${v.code}, ${v.plate}, ${type.slug}, ${type.id}, ${ws}, ${meter}, 'Scania', 'QA Modelo', 2021, true)`
    await sql`insert into mant_equipment_profiles (vehicle_id, brand_id) values (${v.id}, ${brand.id})`
  }

  const km = { v: QA.a1, ws: QA.wsA, form: "CAMIONES" }
  const checks = [
    { ...km, ...CHECKS.a1Oct, label: "40.000 KM", done: 39, notDone: 1, na: 9, mechanic: QA.mechanicA, items: OIL },
    { ...km, ...CHECKS.a1Nov, label: "10.000 KM", done: 30, notDone: 10, na: 0, mechanic: QA.mechanicA, items: OIL_OK },
    { v: QA.b1, ws: QA.wsB, form: "CAMIONES", ...CHECKS.b1Nov, label: "40.000 KM", done: 20, notDone: 20, na: 3, mechanic: QA.mechanicB, items: OIL_B },
    { v: QA.m1, ws: QA.wsA, form: "MAQUINARIA", ...CHECKS.m1Nov, label: "300 H", done: 18, notDone: 2, na: 4, mechanic: QA.mechanicM, items: HYD },
    { v: QA.m1, ws: QA.wsA, form: "MAQUINARIA", ...CHECKS.m1Oct, label: "600 H", done: 10, notDone: 10, na: 2, mechanic: QA.mechanicM, items: HYD_B },
  ]
  for (const [index, check] of checks.entries()) {
    await insertCheck(sql, admin.id, { key: check.key, date: check.date, label: check.label, vehicle: check.v, worksite: check.ws, done: check.done, notDone: check.notDone, na: check.na, mechanic: check.mechanic, form: check.form }, index, check.items)
  }

  for (const driver of [QA.driverA, QA.driverB, QA.driverM]) {
    await sql`insert into mant_drivers (id, name, name_key, is_active) values (${randomUUID()}, ${driver.name}, ${driver.key}, true)`
  }
  const driverId = async (key: string) => (await sql<Array<{ id: string }>>`select id from mant_drivers where name_key = ${key}`)[0]!.id

  const jobs = [
    { ot: QA.otA1, record: QA.recordA1, v: QA.a1, ws: QA.wsA.id, unit: "km", day: OT_DATES.a1, hours: 2.5, reading: 150100, driver: QA.driverA, type: odometer },
    { ot: QA.otB1, record: QA.recordB1, v: QA.b1, ws: QA.wsB.id, unit: "km", day: OT_DATES.b1, hours: 4, reading: 90100, driver: QA.driverB, type: odometer },
    { ot: QA.otM1, record: QA.recordM1, v: QA.m1, ws: QA.wsA.id, unit: "h", day: OT_DATES.m1, hours: 6, reading: 4510, driver: QA.driverM, type: hourMeter },
  ]
  for (const job of jobs) {
    const snapshot = sql.json({
      code: job.v.code, plate: job.v.plate, noPlate: false, type: job.type.name, brand: "Scania", model: "QA Modelo", year: 2021,
      worksite: job.ws === QA.wsA.id ? QA.wsA.name : QA.wsB.name, unit: job.unit,
    })
    const entryAt = `${job.day}T12:00:00Z`
    const workOrderId = randomUUID()
    await sql`
      insert into mant_work_orders (
        id, folio, vehicle_id, worksite_id, equipment_snapshot, repair, maintenance, request_date,
        requested_by_user_id, requester_name, repair_description, status, assigned_to_user_id,
        assigned_by_user_id, assigned_at, workshop_kind, workshop_entry_at, estimated_delivery_date,
        started_at, started_by_user_id, action_type, labor_hours, work_performed, entry_odometer, entry_hourmeter
      ) values (
        ${workOrderId}, ${job.ot}, ${job.v.id}, ${job.ws}, ${snapshot}, true, false, ${job.day},
        ${admin.id}, 'QA_ Solicitante', ${`QA_ Trabajo correctivo ${job.v.code}`}, 'en_ejecucion', ${admin.id},
        ${admin.id}, ${entryAt}, 'interno', ${entryAt}, ${job.day},
        ${entryAt}, ${admin.id}, 'correctiva', ${job.hours}, ${`QA_ Trabajo correctivo ${job.v.code}`},
        ${job.unit === "km" ? job.reading : null}, ${job.unit === "h" ? job.reading : null}
      )`
    const recordId = randomUUID()
    await sql`
      insert into mant_records (
        id, folio, kind, vehicle_id, equipment_snapshot, worksite_id, reading, unit, work_date,
        registered_by, executor_kind, executor_user_id, executor_name, signed_at, received_at,
        status, review, work_order_id
      ) values (
        ${recordId}, ${job.record}, 'C', ${job.v.id}, ${snapshot}, ${job.ws}, ${job.reading}, ${job.unit}, ${job.day},
        ${admin.id}, 'yo', ${admin.id}, 'QA_ Mecánico', ${entryAt}, ${entryAt},
        'vigente', 'pendiente', ${workOrderId}
      )`
    await sql`
      insert into mant_record_correctives (record_id, work_types, oils, description, no_parts, hours, in_workshop)
      values (${recordId}, ${sql.json(["Mecánico"])}, ${sql.json([])}, ${`QA_ Trabajo correctivo ${job.v.code}`}, true, ${job.hours}, false)`
    await sql`
      insert into mant_record_drivers (record_id, driver_id, driver_name)
      values (${recordId}, ${await driverId(job.driver.key)}, ${job.driver.name})`
    if (job.ot === QA.otA1) {
      const photo = await storePhoto(QA.photoWork)
      await sql`
        insert into mant_record_photos (id, record_id, kind, storage_key, mime_type, sha256, bytes, width, height, stamped_at, uploaded_by, sort_order)
        values (${QA.photoWork}, ${recordId}, 'correctiva', ${photo.storageKey}, 'image/png', ${photo.sha256}, ${photo.bytes}, ${photo.width}, ${photo.height}, ${`${job.day}T12:00:00Z`}, ${admin.id}, 0)`
    }
  }
}

/**
 * Preventiva firmada en la plataforma del camión A1, con su foto de filtros. Sólo cuenta desde el
 * corte de los formularios (2026-12-01): antes de esa fecha el tablero no la muestra por diseño,
 * así que la prueba que la usa se salta hasta entonces.
 */
export async function seedNativePreventive(sql: Sql, workDate: string) {
  const [admin] = await sql`select id from users where email = 'admin@e2e.chome.cl'`
  const recordId = randomUUID()
  const snapshot = sql.json({ code: QA.a1.code, plate: QA.a1.plate, noPlate: false, type: "Camión", brand: "Scania", model: "QA Modelo", year: 2021, worksite: QA.wsA.name, unit: "km" })
  await sql`
    insert into mant_records (
      id, folio, kind, vehicle_id, equipment_snapshot, worksite_id, reading, unit, work_date,
      registered_by, executor_kind, executor_user_id, executor_name, signed_at, received_at,
      status, review, schedule_version, schedule_name_snapshot, interval_value, suggested_interval_value, notes
    ) values (
      ${recordId}, ${QA.recordP}, 'P', ${QA.a1.id}, ${snapshot}, ${QA.wsA.id}, 160000, 'km', ${workDate},
      ${admin!.id}, 'yo', ${admin!.id}, 'QA_ Mecánico', ${`${workDate}T12:00:00Z`}, ${`${workDate}T12:00:00Z`},
      'vigente', 'pendiente', 1, 'Camiones y tractos', 10000, 10000, 'QA_ Preventiva de prueba'
    )`
  await sql`
    insert into mant_record_items (id, record_id, item_key, group_name, item_name, sort_order, value, reason)
    values (${randomUUID()}, ${recordId}, 'qa1', 'Motor', 'QA_ Cambio aceite motor', 0, 'R', null),
           (${randomUUID()}, ${recordId}, 'qa2', 'Frenos', 'QA_ Revisión frenos', 1, 'NR', 'QA_ Sin repuesto')`
  const photo = await storePhoto(QA.photoPreventive)
  await sql`
    insert into mant_record_photos (id, record_id, kind, storage_key, mime_type, sha256, bytes, width, height, stamped_at, uploaded_by, sort_order)
    values (${QA.photoPreventive}, ${recordId}, 'filtros', ${photo.storageKey}, 'image/png', ${photo.sha256}, ${photo.bytes}, ${photo.width}, ${photo.height}, ${`${workDate}T12:00:00Z`}, ${admin!.id}, 0)`
}
