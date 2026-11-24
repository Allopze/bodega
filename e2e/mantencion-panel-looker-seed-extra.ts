import { expect, type Download, type Locator, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { baseInterval, suggestInterval } from "../lib/mantencion/schedule"
import { trackConsole } from "./mantencion-3-helpers"
import { PERIOD, QA, RUTA, withSql } from "./mantencion-panel-looker-seed"

/**
 * Siembra EXTRA del tablero Looker (`mantencion-panel-looker-export.spec.ts` y `-cobertura.spec.ts`). Se suma a
 * `seedLooker` y trae lo que ésa no tiene: más de 25 correctivos (para que «Exportar Excel» difiera de la página
 * visible), diez pautas de UN equipo (el tope de 8 de la matriz), dos pautas con % distintos (el promedio de los %),
 * una máquina por horas con pauta y preventiva declarada (A, B, delta, próxima y faltantes), y el acceso temporal
 * de dos usuarios E2E ya existentes (un alcance de una faena y un permiso de ver el Panel sin exportar).
 *
 * Todo es propio (`QA`): equipos `qa-looker-veh-x*`, correctivos `qa-e2e-looker-work-*` y pautas
 * `qa-e2e-looker-check-x*` (el prefijo de `cleanupLooker`, así `leftovers` las cuenta). `cleanupExtra` corre ANTES de
 * `cleanupLooker`: los equipos extra no deben quedar con filas colgando. Fechas FIJAS (ver `mantencion-panel-looker-seed.ts`).
 *
 * Los usuarios NO se crean: `audit_log` es de sólo agregar y su `user_id` no tiene `ON DELETE`, de modo que un usuario
 * que exporta (la exportación se audita) no se podría borrar nunca. Se ajusta el acceso de dos usuarios del fixture
 * E2E y `restoreAccess` lo devuelve a su estado de origen (también al arrancar, si una corrida anterior murió a medias).
 *
 * Al final del archivo van las ayudas de página y de lectura de Excel que comparten los dos specs (locators del tablero,
 * `ready`, `tabTo`, `readBook`): viven aquí porque un spec no puede importar de otro y así no se repiten en cada uno.
 */

export { withSql }
type Sql = postgres.Sql

export const EX = {
  /** Camión de la faena A con 30 correctivos del formulario (más de una página de 25). */
  bulk: { id: "qa-looker-veh-x1", code: "QA-LK-X1", plate: "QALKX1" },
  /** Camión de la faena A con diez pautas con detalle en octubre y dos en septiembre. */
  matrix: { id: "qa-looker-veh-x2", code: "QA-LK-X2", plate: "QALKX2" },
  /** Máquina por horas de la faena A con pauta de horas y preventiva declarada. */
  machine: { id: "qa-looker-veh-x3", code: "QA-LK-X3", plate: "QALKX3" },
  bulkDriver: "QA_ CONDUCTOR BULK",
  bulkRows: 30,
  mechanicX: "QA_ MECANICO CUATRO",
  oldItem: "QA_ Ítem solo de pautas antiguas",
} as const

export const SEPTEMBER = "desde=2026-09-01&hasta=2026-09-30"

/** Referencia (`order_text`) del correctivo `n` (1..30): `QA-BULK-01`. Su fecha es 2026-10-(n + 1). */
export const bulkRef = (n: number) => `QA-BULK-${String(n).padStart(2, "0")}`
export const bulkDate = (n: number) => `2026-10-${String(n + 1).padStart(2, "0")}`

/** Diez pautas de octubre del equipo de la matriz: 03, 06, … 30 (la `i`-ésima es el día 3·i). */
export const MATRIX_DAYS = Array.from({ length: 10 }, (_, index) => `2026-10-${String((index + 1) * 3).padStart(2, "0")}`)
/** Dos pautas de septiembre con % distintos: 2/0 → 100 % y 1/4 → 20 % (promedio 60 %; el cociente de totales daría 43 %). */
export const SEPTEMBER_CHECKS = [
  { key: "qa-e2e-looker-check-x2-sep-a", date: "2026-09-08", done: 2, notDone: 0, na: 5 },
  { key: "qa-e2e-looker-check-x2-sep-b", date: "2026-09-22", done: 1, notDone: 4, na: 0 },
] as const

/** La preventiva declarada de la máquina: B es su lectura; A, la próxima y los faltantes salen de la regla vigente. */
export const MACHINE_PRIOR = { date: "2026-11-02", reading: 4520, interval: 900, evidence: "QA_ Respaldo X3" } as const
export const MACHINE_CURRENT = { reading: 4780, date: "2026-11-15" } as const

const BIODIVERSA = "Biodiversa"
export const USERS = {
  /** Supervisor de mantención del fixture: `mant:export` + `mant:records:view_worksite`, alcance por faena. */
  scoped: { id: "user-mant-sup-e2e", email: "supervisor@e2e.chome.cl" },
  /** Mecánico del fixture: sin `mant:export`; aquí se le suma ver el Panel por faena. */
  noExport: { id: "user-mant-mec1-e2e", email: "mecanico1@e2e.chome.cl" },
} as const

const EXTRA_VEHICLES = [EX.bulk.id, EX.matrix.id, EX.machine.id]

/** Pauta de horas vigente y sus intervalos, tal como los publica la base E2E (no se inventan: salen de ahí). */
export async function hoursSchedule(sql: Sql): Promise<{ id: string; intervals: number[] }> {
  const [row] = await sql<Array<{ id: string; intervals: number[] }>>`
    select s.id, v.snapshot->'intervals' as intervals
      from mant_schedules s
      join mant_schedule_versions v on v.schedule_id = s.id and v.version = s.version
     where s.deleted_at is null and v.snapshot->>'unit' = 'h'
     order by s.name limit 1`
  if (!row) throw new Error("La base E2E no trae una pauta de horas vigente")
  return { id: row.id, intervals: row.intervals.map(Number) }
}

async function adminId(sql: Sql): Promise<string> {
  const [admin] = await sql`select id from users where email = 'admin@e2e.chome.cl'`
  if (!admin) throw new Error("La base E2E no trae admin@e2e.chome.cl")
  return admin.id as string
}

async function insertVehicle(sql: Sql, vehicle: { id: string; code: string; plate: string }, meter: "odometer" | "hour_meter", extra?: { scheduleId: string }) {
  const [type] = await sql`select id, slug from fuel_equipment_types where default_meter_type = ${meter} and is_active order by name limit 1`
  const [brand] = await sql`select id from mant_brands order by id limit 1`
  if (!type || !brand) throw new Error("La carga E2E no trae un tipo de equipo ni una marca de mantención")
  await sql`
    insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id, meter_type, brand, model, year, is_active)
    values (${vehicle.id}, ${vehicle.code}, ${vehicle.plate}, ${type.slug}, ${type.id}, ${QA.wsA.id}, ${meter}, 'Scania', 'QA Modelo', 2021, true)`
  if (!extra) {
    await sql`insert into mant_equipment_profiles (vehicle_id, brand_id) values (${vehicle.id}, ${brand.id})`
    return
  }
  await sql`
    insert into mant_equipment_profiles (
      vehicle_id, brand_id, schedule_id, initial_reading, initial_reading_date,
      prior_preventive_date, prior_preventive_reading, prior_preventive_interval, prior_preventive_evidence
    ) values (
      ${vehicle.id}, ${brand.id}, ${extra.scheduleId}, ${MACHINE_CURRENT.reading}, ${MACHINE_CURRENT.date},
      ${MACHINE_PRIOR.date}, ${MACHINE_PRIOR.reading}, ${MACHINE_PRIOR.interval}, ${MACHINE_PRIOR.evidence}
    )`
}

async function insertCheck(
  sql: Sql,
  admin: string,
  row: { key: string; date: string; done: number; notDone: number; na: number; items: Array<[string, Result]> },
  index: number,
) {
  await sql`
    insert into mant_historical_schedule_checks (
      source_key, fingerprint, source_file, source_sheet, source_row, submitted_at, performed_on,
      form_kind, schedule_label, equipment_text, vehicle_id, equipment_match, worksite_text, worksite_id,
      reading, done_count, not_done_count, not_applicable_count, compliance, mechanic, observations,
      is_test, fields, imported_by
    ) values (
      ${row.key}, ${row.key}, 'QA_looker.xlsx', 'PAUTAS_PREVENTIVAS', ${index + 2}, ${`${row.date} 10:00:00`}, ${row.date},
      'CAMIONES', '10.000 KM', ${`${EX.matrix.code} / ${EX.matrix.plate}`}, ${EX.matrix.id}, 'linked',
      ${QA.wsA.name}, ${QA.wsA.id}, 150000, ${row.done}, ${row.notDone}, ${row.na},
      ${row.done + row.notDone > 0 ? row.done / (row.done + row.notDone) : null}, ${EX.mechanicX}, ${`QA_ Observación ${row.date}`},
      false, ${sql.json([])}, ${admin}
    )`
  for (const [position, [name, result]] of row.items.entries()) {
    await sql`
      insert into mant_historical_schedule_items (source_key, check_source_key, item_name, result, sort_order)
      values (${`${row.key}-item-${position}`}, ${row.key}, ${name}, ${result}, ${position})`
  }
}

/** Borra lo extra (filas y equipos). Idempotente; corre antes de `cleanupLooker`. */
export async function cleanupExtra(sql: Sql) {
  await sql`delete from mant_historical_records where source_key like 'qa-e2e-looker-work-%'`
  await sql`delete from mant_historical_schedule_checks where source_key like 'qa-e2e-looker-check-x%'`
  await sql`delete from mant_equipment_history where vehicle_id in ${sql(EXTRA_VEHICLES)}`
  await sql`delete from mant_equipment_profiles where vehicle_id in ${sql(EXTRA_VEHICLES)}`
  await sql`delete from fuel_vehicles where id in ${sql(EXTRA_VEHICLES)}`
  await restoreAccess(sql)
}

/** Filas extra que quedan: tras `cleanupExtra` deben ser 0 (los accesos se comprueban con `accessIsOriginal`). */
export async function extraLeftovers(sql: Sql): Promise<number> {
  const [row] = await sql`
    select (select count(*) from mant_historical_records where source_key like 'qa-e2e-looker-work-%')
         + (select count(*) from mant_historical_schedule_checks where source_key like 'qa-e2e-looker-check-x%')
         + (select count(*) from mant_equipment_profiles where vehicle_id in ${sql(EXTRA_VEHICLES)})
         + (select count(*) from fuel_vehicles where id in ${sql(EXTRA_VEHICLES)}) as n`
  return Number(row?.n)
}

type Result = "realizado" | "no_realizado" | "no_aplica"
const BASE_ITEMS: Array<[string, Result]> = [["QA_ Cambio aceite motor", "realizado"], ["QA_ Revisión frenos", "no_realizado"]]

/** 30 correctivos del formulario del camión extra: 1,5 h cada uno, un solo conductor, un día cada uno (02 a 31 de octubre). */
async function insertBulkCorrectives(sql: Sql, admin: string) {
  await insertVehicle(sql, EX.bulk, "odometer")
  for (let n = 1; n <= EX.bulkRows; n++) {
    await sql`
      insert into mant_historical_records (
        source_key, fingerprint, source_file, source_sheet, source_row, submitted_at, worksite_text, worksite_id,
        equipment_text, vehicle_id, equipment_match, order_text, kind_text, reading_text, description,
        entry_date, hours_text, fields, imported_by, action_type, labor_hours, is_test
      ) values (
        ${`qa-e2e-looker-work-${n}`}, ${`qa-e2e-looker-work-${n}`}, 'QA_looker.xlsx', 'MANTENCIONES', ${n + 1},
        ${`${bulkDate(n)} 09:00:00`}, ${QA.wsA.name}, ${QA.wsA.id}, ${`${EX.bulk.code} / ${EX.bulk.plate}`}, ${EX.bulk.id}, 'linked',
        ${bulkRef(n)}, 'CORRECTIVA', '150000', ${`QA_ Trabajo masivo ${n}`},
        ${bulkDate(n)}, '1,5', ${sql.json([{ header: "CONDUCTOR", value: EX.bulkDriver }])}, ${admin}, 'correctiva', 1.5, false
      )`
  }
}

/** Diez pautas con detalle de octubre (+ las dos de septiembre) del equipo de la matriz. Las dos más antiguas traen un ítem propio. */
async function insertMatrixChecks(sql: Sql, admin: string) {
  await insertVehicle(sql, EX.matrix, "odometer")
  for (const [index, date] of MATRIX_DAYS.entries()) {
    const items: Array<[string, Result]> = index < 2 ? [...BASE_ITEMS, [EX.oldItem, "realizado"]] : BASE_ITEMS
    await insertCheck(sql, admin, { key: `qa-e2e-looker-check-x2-${date}`, date, done: 3, notDone: 1, na: 0, items }, index)
  }
  for (const [index, check] of SEPTEMBER_CHECKS.entries()) {
    await insertCheck(sql, admin, { ...check, items: BASE_ITEMS }, MATRIX_DAYS.length + index)
  }
}

/**
 * Siembra lo extra que se pida (limpia antes). Devuelve los intervalos de la pauta de horas cuando se sembró la máquina,
 * que son los que gobiernan A, la próxima y los faltantes.
 */
export async function seedExtra(sql: Sql, parts: { bulk?: boolean; matrix?: boolean; machine?: boolean }): Promise<number[]> {
  await cleanupExtra(sql)
  const admin = await adminId(sql)
  if (parts.bulk) await insertBulkCorrectives(sql, admin)
  if (parts.matrix) await insertMatrixChecks(sql, admin)
  if (!parts.machine) return []
  const schedule = await hoursSchedule(sql)
  await insertVehicle(sql, EX.machine, "hour_meter", { scheduleId: schedule.id })
  return schedule.intervals
}

/* ── Accesos temporales (usuarios del fixture) ───────────────────────────── */

async function biodiversaId(sql: Sql): Promise<string> {
  const [site] = await sql`select id from worksites where name = ${BIODIVERSA}`
  if (!site) throw new Error(`La base E2E no trae la faena ${BIODIVERSA}`)
  return site.id as string
}

/** Estado de origen: el supervisor sólo en Biodiversa (principal) y el mecánico sin `view_worksite` directo y sólo en Biodiversa. */
export async function restoreAccess(sql: Sql) {
  const bio = await biodiversaId(sql)
  await sql`delete from worksite_users where user_id = ${USERS.scoped.id} and worksite_id <> ${bio}`
  await sql`
    insert into worksite_users (user_id, worksite_id, is_primary) values (${USERS.scoped.id}, ${bio}, true)
    on conflict (user_id, worksite_id) do update set is_primary = true`
  await sql`delete from worksite_users where user_id = ${USERS.noExport.id} and worksite_id <> ${bio}`
  await sql`delete from user_permissions where user_id = ${USERS.noExport.id} and permission_id in (select id from permissions where name = 'mant:records:view_worksite')`
}

export async function accessIsOriginal(sql: Sql): Promise<boolean> {
  const bio = await biodiversaId(sql)
  const sites = await sql<Array<{ user_id: string; worksite_id: string; is_primary: boolean }>>`
    select user_id, worksite_id, is_primary from worksite_users where user_id in ${sql([USERS.scoped.id, USERS.noExport.id])}`
  const direct = await sql`select 1 from user_permissions where user_id = ${USERS.noExport.id}`
  return direct.length === 0 && sites.length === 2 && sites.every((site) => site.worksite_id === bio && site.is_primary)
}

/** El supervisor pasa a tener SÓLO la faena A (la de los datos QA): `mant:export` con alcance de una faena. */
export async function scopeSupervisorToFaenaA(sql: Sql) {
  await restoreAccess(sql)
  const bio = await biodiversaId(sql)
  await sql`delete from worksite_users where user_id = ${USERS.scoped.id} and worksite_id = ${bio}`
  await sql`insert into worksite_users (user_id, worksite_id, is_primary) values (${USERS.scoped.id}, ${QA.wsA.id}, true)`
}

/** El mecánico ve el Panel de la faena A (`mant:records:view_worksite`, sin `mant:export`). */
export async function grantMechanicPanelWithoutExport(sql: Sql) {
  await restoreAccess(sql)
  await sql`
    insert into user_permissions (user_id, permission_id)
    select ${USERS.noExport.id}, id from permissions where name = 'mant:records:view_worksite'`
  await sql`insert into worksite_users (user_id, worksite_id, is_primary) values (${USERS.noExport.id}, ${QA.wsA.id}, false)`
}

/* ── Ayudas de página y de Excel compartidas por los dos specs ───────────── */

export const rx = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
export const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key)
export const tabUrl = (tab: string, extra: Record<string, string> = {}, period = PERIOD) =>
  `${RUTA}?${new URLSearchParams({ pestana: tab, ...Object.fromEntries(new URLSearchParams(period)), ...extra }).toString()}`

export const filterBar = (page: Page) => page.locator("[data-looker-filter-bar]")
export const otTable = (page: Page) => page.getByRole("table", { name: "Órdenes de trabajo y correctivas del período" })
export const driversTable = (page: Page) => page.getByRole("table", { name: "Conductores del período" })
export const plateTable = (page: Page) => page.getByRole("table", { name: "Cumplimiento por patente" })
export const matrixOf = (page: Page) => page.getByRole("table", { name: "Matriz de checklist de pautas" })
export const row = (table: Locator, text: string) => table.getByRole("row", { name: rx(text) })
export const barsOf = (page: Page, name: string) => page.getByRole("group", { name })

/** Chip de la barra («Faena: QA_ …»), con su botón de quitar. */
export const chipsOf = (page: Page, label: string) =>
  filterBar(page).locator("span").filter({ has: page.getByRole("button", { name: `Eliminar filtro ${label}`, exact: true }) })

/** Los controles existen en el HTML del servidor; el clic recién funciona al hidratar (la marca la pone un efecto). */
export async function ready(page: Page, { cross = true }: { cross?: boolean } = {}) {
  await expect(page.locator("[data-looker-filter-ready]")).toBeVisible({ timeout: 30_000 })
  // Una pestaña sin filas ni barras (alcance sin datos) no tiene controles cruzados que esperar: basta la barra de filtros.
  if (cross) await expect(page.locator("[data-cross-filter-ready]").first()).toBeVisible({ timeout: 30_000 })
}

/** Errores de consola y respuestas 4xx/5xx del origen: un tablero sano no deja ninguno. El spec los comprueba en `afterEach`. */
export function watchProblems(page: Page): string[] {
  const problems = trackConsole(page)
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(new URL(page.url()).origin)) problems.push(`${response.status()} ${response.url()}`)
  })
  return problems
}

/** Navegación por teclado: parte de `from` (un clic fija el punto de partida de Tab) y avanza hasta `target`. */
export async function tabTo(page: Page, from: Locator, target: Locator, max = 80) {
  await from.click()
  for (let step = 0; step < max; step++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((el) => el === document.activeElement)) return step + 1
  }
  throw new Error(`Tab no llegó al control tras ${max} pulsaciones`)
}

/* Excel: se lee el archivo descargado, no una réplica del servicio. */
export type Cell = string | number | boolean | null
export interface Sheet { header: string[]; rows: Cell[][] }
export type Book = Map<string, Sheet>

/** Una celda vacía es «sin dato»: el libro la escribe como texto vacío y aquí vuelve a ser `null`. */
function cellValue(value: ExcelJS.CellValue): Cell {
  if (value == null || value === "") return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("")
    if ("text" in value) return String(value.text)
    if ("result" in value) return (value.result as Cell) ?? null
    return JSON.stringify(value)
  }
  return value
}

export async function readBook(download: Download): Promise<Book> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile((await download.path()) as string)
  const book: Book = new Map()
  for (const sheet of workbook.worksheets) {
    const all: Cell[][] = []
    sheet.eachRow({ includeEmpty: false }, (excelRow) => {
      all.push(Array.from({ length: sheet.columnCount }, (_, index) => cellValue(excelRow.getCell(index + 1).value)))
    })
    book.set(sheet.name, { header: (all[0] ?? []).map((cell) => String(cell ?? "")), rows: all.slice(1) })
  }
  return book
}

/** Todo el texto del libro (hojas, encabezados y celdas) para buscar lo que NO debe estar. */
export function bookText(book: Book): string {
  return [...book].flatMap(([name, sheet]) => [name, ...sheet.header, ...sheet.rows.flat().map(String)]).join("\n")
}

/** El valor de la columna `header` de una fila de la hoja. */
export function field(sheet: Sheet, cells: Cell[], header: string): Cell {
  const index = sheet.header.findIndex((name) => name === header)
  if (index < 0) throw new Error(`La hoja no tiene la columna «${header}»: ${sheet.header.join(" | ")}`)
  return cells[index] ?? null
}

/** La fila de «Filtros» o «Metadatos» (dos columnas: concepto y detalle) por su concepto; «Nota» se repite: `all`. */
export function pairs(sheet: Sheet, concept: string): string[] {
  return sheet.rows.filter((cells) => cells[0] === concept).map((cells) => String(cells[1] ?? ""))
}

/** La fila que expresa la regla vigente para la máquina extra: lo que debe mostrar la pantalla y traer el Excel. */
export function machinePlanning(intervals: readonly number[]) {
  const programmed = suggestInterval(intervals, MACHINE_PRIOR.reading).point
  const base = baseInterval(intervals)
  const next = programmed + base
  const remaining = next - MACHINE_CURRENT.reading
  return {
    programmed,
    real: MACHINE_PRIOR.reading,
    current: MACHINE_CURRENT.reading,
    next,
    delta: programmed - MACHINE_PRIOR.reading,
    remaining,
    base,
    // Faltantes ≤ 0 vencida; hasta el 15 % de la base, por vencer; si no, al día (`equipmentStatus`, `remainingTone`).
    situation: remaining <= 0 ? "Vencida" : remaining <= base * 0.15 ? "Por vencer" : "Al día",
  }
}
