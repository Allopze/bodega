import { expect, type Locator, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { resolveE2eDatabaseUrl } from "./environment"
import { login, selectRadixById } from "./helpers"

/**
 * Ayudas compartidas por `mantencion-3a-equipos.spec.ts` y `mantencion-3b-pautas.spec.ts`
 * (§16 E2E 6 y 7). Viven aparte porque las dos specs juntas pasaban el tope de 500
 * líneas por archivo; no es un `*.spec.ts`, así que Playwright no lo ejecuta.
 */

export const JEFE = "jefe.mant@e2e.chome.cl"
export const MECANICO = "mecanico1@e2e.chome.cl"
export const SCHEDULE = "QA Camionetas"
export const ITEM = "Ítem QA E2E"

export const chileDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(Date.now() + offset * 86_400_000))
/** `2026-10-01` → `01-10-2026`, como se escribe en la planilla. */
export const dayMonthYear = (iso: string) => iso.split("-").reverse().join("-")

/** Cada prueba parte con un contexto nuevo (sin cookies): entra como jefatura. */
export const asJefe = (page: Page) => login(page, JEFE)

/** Errores de consola y de página de UNA prueba (§16: la consola de las E2E no debe traer errores). */
export function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

export async function withSql<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = resolveE2eDatabaseUrl()
  expect(url, "E2E_DATABASE_URL").toBeTruthy()
  const sql = postgres(url!, { max: 1 })
  try {
    return await run(sql)
  } finally {
    await sql.end()
  }
}

/** Valor de una ficha de lectura (`<dt>` → `<dd>`) de la ficha del equipo. */
export function fichaValue(page: Page, label: string): Locator {
  return page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd")
}

export function idFromPath(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop() ?? ""
}

export async function scheduleState(name: string) {
  return withSql(async (sql) => {
    const [row] = await sql`select id, version from mant_schedules where name = ${name} and deleted_at is null`
    if (!row) return null
    const versions = await sql`select version, snapshot from mant_schedule_versions where schedule_id = ${row.id} order by version`
    return { id: row.id as string, version: row.version as number, versions }
  })
}

export async function fillEquipmentForm(page: Page, values: {
  code: string; plate?: string; noPlate?: boolean; type: RegExp; brand: string; model: string; year: string
  worksite: string; newWorksite?: string; schedule?: string; reading?: string
}) {
  await page.getByLabel("Código interno", { exact: true }).fill(values.code)
  if (values.noPlate) await page.getByLabel("Sin patente", { exact: true }).check()
  else await page.getByLabel("Patente", { exact: true }).fill(values.plate ?? "")
  await selectRadixById(page, "eq-type", values.type)
  await selectRadixById(page, "eq-brand", values.brand)
  await page.getByLabel("Modelo", { exact: true }).fill(values.model)
  await page.getByLabel("Año", { exact: true }).fill(values.year)
  await selectRadixById(page, "eq-worksite", values.newWorksite ? "Nueva faena…" : values.worksite)
  if (values.newWorksite) await page.getByLabel("Nombre de la faena nueva", { exact: true }).fill(values.newWorksite)
  if (values.schedule) await selectRadixById(page, "eq-schedule", new RegExp(`^${values.schedule}`))
  if (values.reading) await page.getByLabel(/^Lectura actual/).fill(values.reading)
}

export async function importWorkbook(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.addRow(["Código", "Patente", "Tipo de equipo", "Marca", "Modelo", "Año", "Faena", "Pauta", "Lectura inicial", "Fecha de la lectura"])
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
