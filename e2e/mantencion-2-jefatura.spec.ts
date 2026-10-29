import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import postgres from "postgres"
import sharp from "sharp"
import { resolveE2eDatabaseUrl } from "./environment"
import { expectPageTitle, login } from "./helpers"

/**
 * §16 E2E 5 · Jefatura de mantención: panel, registros, detalle, Excel y PDF.
 *
 * Con estado y en orden: corre después de las specs del mecánico (`mantencion-1…4`)
 * y no depende de lo que dejaron. Para que el resultado sea determinista siembra
 * SUS PROPIOS registros directo en la base (folios `…-91xx`, que el correlativo
 * real nunca alcanza), con fotos reales en `storage/mantencion/`, en equipos de
 * Biodiversa fuera de los tres que usan las specs de la app («Próximos» a 40.000)
 * y uno de otra faena. Así se verifican las vistas de jefatura sin acoplarlas a
 * cómo se crearon los registros (eso ya lo prueban las specs del mecánico).
 *
 * Los locators siguen «Locators in this repository» de AGENTS.md: `getByRole`
 * (ignora los nodos ocultos de las vistas duplicadas) y `exact: true` cuando un
 * rótulo es prefijo de otro.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const JEFE = "jefe.mant@e2e.chome.cl"
const SUPERVISOR = "supervisor@e2e.chome.cl"
const USER = { mec1: "user-mant-mec1-e2e", mec2: "user-mant-mec2-e2e", jefe: "user-mant-jefe-e2e" } as const

interface Seeded { id: string; folio: string; code: string; plate: string }
interface Vehicle { id: string; code: string; plate: string; worksite_id: string; worksite: string }
const rec: Record<"A" | "B" | "C" | "D", Seeded> = {
  A: { id: randomUUID(), folio: "MP-BIO-9101", code: "", plate: "" },
  B: { id: randomUUID(), folio: "MC-BIO-9102", code: "", plate: "" },
  C: { id: randomUUID(), folio: "MP-OTR-9103", code: "", plate: "" },
  D: { id: randomUUID(), folio: "MP-BIO-9104", code: "", plate: "" },
}
const photoIds = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), b2: randomUUID(), b3: randomUUID(), c1: randomUUID(), c2: randomUUID() }

const chileDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(Date.now() + offset * 86_400_000))
/** Errores de consola y de página de UNA prueba (§16: la consola de las E2E no debe traer errores). */
function trackConsole(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

async function parsePdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return { pageCount: result.total, text: result.text }
  } finally {
    await parser.destroy()
  }
}

async function download(page: Page, button: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button, exact: true }).click(),
  ])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile((await file.path()) as string)
  return { workbook, filename: file.suggestedFilename() }
}

async function kpiNumber(page: Page, label: RegExp): Promise<number> {
  const text = await page.getByRole("link", { name: label }).locator("p").nth(1).innerText()
  return Number(text.replace(/\D/g, ""))
}

test("siembra de registros propios con fotos reales", async () => {
  const url = resolveE2eDatabaseUrl()
  expect(url, "E2E_DATABASE_URL").toBeTruthy()
  const sql = postgres(url!, { max: 1 })
  try {
    const bio = await sql`
      select v.id, v.code, v.plate, v.worksite_id, w.name as worksite
      from fuel_vehicles v
      join mant_equipment_profiles p on p.vehicle_id = v.id
      join fuel_equipment_types t on t.id = v.equipment_type_id
      join worksites w on w.id = v.worksite_id
      where t.default_meter_type = 'odometer' and v.is_active and w.name = 'Biodiversa'
      order by v.code`
    // Los tres primeros de Biodiversa son los «Próximos» de las specs de la app: no se tocan.
    const [bio1, bio2] = bio.slice(3) as Vehicle[]
    const [other] = (await sql`
      select v.id, v.code, v.plate, v.worksite_id, w.name as worksite
      from fuel_vehicles v
      join mant_equipment_profiles p on p.vehicle_id = v.id
      join fuel_equipment_types t on t.id = v.equipment_type_id
      join worksites w on w.id = v.worksite_id
      where t.default_meter_type = 'odometer' and v.is_active and w.name <> 'Biodiversa'
      order by v.code limit 1`) as unknown as Vehicle[]
    if (!bio1 || !bio2 || !other) throw new Error("La carga inicial no trae equipos km suficientes para sembrar")
    rec.A.code = bio1.code; rec.A.plate = bio1.plate
    rec.D.code = bio1.code; rec.D.plate = bio1.plate
    rec.B.code = bio2.code; rec.B.plate = bio2.plate
    rec.C.code = other.code; rec.C.plate = other.plate
    const [driver] = await sql`select id, name from mant_drivers order by name limit 1`
    if (!driver) throw new Error("La carga inicial no trae conductores")

    const snapshot = (v: { code: string; plate: string; worksite: string }) => sql.json({
      code: v.code, plate: v.plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: v.worksite, unit: "km",
    })
    const now = new Date().toISOString()
    const base = (id: string, folio: string, kind: "P" | "C", v: Vehicle, registeredBy: string, executorUserId: string, executorKind: string, executorName: string, workDate: string, reading: number) => ({
      id, folio, kind, vehicle_id: v.id, equipment_snapshot: snapshot(v), worksite_id: v.worksite_id, out_of_worksite: false, reading, unit: "km",
      work_date: workDate, registered_by: registeredBy, executor_kind: executorKind, executor_user_id: executorUserId, executor_name: executorName,
      signed_at: now, received_at: now,
    })
    const preventive = { schedule_version: 1, schedule_name_snapshot: "Camiones y tractos", interval_value: 40_000, suggested_interval_value: 40_000, notes: "Sin novedad en la revisión" }

    await sql`insert into mant_records ${sql({ ...base(rec.A.id, rec.A.folio, "P", bio1, USER.mec1, USER.mec1, "yo", "Mecánico Uno E2E", chileDay(-1), 120_100), ...preventive })}`
    // D: misma máquina, otra pauta elegida a mano, con salto de lectura y marcada como duplicada de A.
    await sql`insert into mant_records ${sql({
      ...base(rec.D.id, rec.D.folio, "P", bio1, USER.mec1, USER.mec1, "yo", "Mecánico Uno E2E", chileDay(-2), 120_050),
      ...preventive, interval_value: 20_000, manual_schedule_reason: "Pedido de la jefatura", reading_jump_alert: true, duplicate_of_record_id: rec.A.id,
    })}`
    await sql`insert into mant_records ${sql({ ...base(rec.B.id, rec.B.folio, "C", bio2, USER.mec2, USER.mec1, "otro_mecanico", "Mecánico Uno E2E", chileDay(-3), 120_300) })}`
    await sql`insert into mant_records ${sql({ ...base(rec.C.id, rec.C.folio, "P", other, USER.jefe, USER.jefe, "yo", "Jefatura Mantención E2E", chileDay(-2), 120_400), ...preventive })}`

    // postgres-js arma las columnas con las claves de la primera fila: todas llevan las mismas.
    const item = (recordId: string, key: string, group: string, name: string, order: number, value: "R" | "NR", reason: string | null = null, warning = false) => ({
      id: randomUUID(), record_id: recordId, item_key: key, group_name: group, item_name: name, sort_order: order, value, reason, manufacturer_warning: warning,
    })
    await sql`insert into mant_record_items ${sql([
      item(rec.A.id, "e2e-1", "Motor", "Revisión aceite motor", 0, "R"),
      item(rec.A.id, "e2e-2", "Motor", "Cambio filtro de aire", 1, "R"),
      item(rec.A.id, "e2e-3", "Frenos", "Pastillas de freno", 2, "NR", "Falta repuesto", true),
      item(rec.D.id, "e2e-1", "Motor", "Revisión aceite motor", 0, "R"),
      item(rec.C.id, "e2e-1", "Motor", "Revisión aceite motor", 0, "R"),
    ])}`
    await sql`insert into mant_record_correctives ${sql({
      record_id: rec.B.id, work_types: sql.json(["Mecánico"]), oils: sql.json([]), description: "Cambio de manguera hidráulica", no_parts: false,
      hours: 3.5, in_workshop: true, workshop_entry_date: chileDay(-3),
    })}`
    await sql`insert into mant_record_parts ${sql({ id: randomUUID(), record_id: rec.B.id, quantity: 2, description: "Manguera hidráulica 1/2", sort_order: 0 })}`
    await sql`insert into mant_record_drivers ${sql({ record_id: rec.B.id, driver_id: driver.id, driver_name: driver.name })}`

    // Fotos de verdad en el disco que sirve `/api/mantencion/fotos/{id}`. La segunda de A trae un
    // sello de hace 100 días y ningún período sin señal: el detalle debe advertirlo (regla 8).
    const directory = path.join(process.cwd(), "storage", "mantencion")
    mkdirSync(directory, { recursive: true })
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#4b4f54" } }).png().toBuffer()
    const photos: Array<[string, string, string, string]> = [
      [photoIds.a1, rec.A.id, "filtros", now], [photoIds.a2, rec.A.id, "sticker", new Date(Date.now() - 100 * 86_400_000).toISOString()],
      [photoIds.b1, rec.B.id, "correctiva", now], [photoIds.b2, rec.B.id, "correctiva", now], [photoIds.b3, rec.B.id, "correctiva", now],
      [photoIds.c1, rec.C.id, "filtros", now], [photoIds.c2, rec.C.id, "sticker", now],
    ]
    for (const [id, recordId, kind, stampedAt] of photos) {
      writeFileSync(path.join(directory, `${id}.png`), png)
      await sql`insert into mant_record_photos ${sql({
        id, record_id: recordId, kind, storage_key: `storage/mantencion/${id}.png`, mime_type: "image/png", sha256: "0".repeat(64),
        bytes: png.length, width: 640, height: 480, stamped_at: stampedAt, uploaded_by: USER.mec1,
      })}`
    }
  } finally {
    await sql.end()
  }
})

test("el panel muestra los cuatro indicadores, el gráfico con sus datos y cada uno lleva a su subconjunto", async ({ page }) => {
  const consoleErrors = trackConsole(page)
  await login(page, JEFE)
  await page.goto("/mantencion/panel")
  await expectPageTitle(page, "Panel de mantención")

  // A1: como máximo cuatro tarjetas de indicador.
  await expect(page.locator("[data-kpi-card]")).toHaveCount(4)
  // La correctiva sembrada lleva 3 días sin novedad: el tile de taller avisa «sin actualizar».
  await expect(page.getByRole("link", { name: /^Equipos en taller/ })).toContainText("sin actualizar")

  // Gráfico apilado: se dibuja, tiene nombre accesible y su tabla «Ver datos» repite las cifras.
  await expect(page.getByRole("img", { name: /^Registros por semana/ })).toBeVisible()
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible()
  await page.getByText("Ver datos", { exact: true }).click()
  await expect(page.getByRole("table", { name: "Registros por semana" })).toBeVisible()

  // La correctiva abierta aparece en «En taller ahora» y lleva a su detalle.
  await expect(page.locator(`a[href="/mantencion/registros/${rec.B.id}"]`)).toBeVisible()

  // Los indicadores llevan a su subconjunto, no al total.
  await page.getByRole("link", { name: /^Mantenciones vencidas/ }).click()
  await expect(page).toHaveURL(/\/mantencion\/equipos\?estado=vencida/)
  await page.goto("/mantencion/panel")
  await page.getByRole("link", { name: /^Equipos en taller/ }).click()
  await expect(page).toHaveURL(/\/mantencion\/registros\?.*situacion=en_taller/)
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toHaveCount(0)

  await page.goto("/mantencion/panel")
  await page.getByRole("link", { name: /^Registros · / }).click()
  await expect(page).toHaveURL(/\/mantencion\/registros\?.*estado=vigente/)

  // Una barra de la flota lleva a Equipos ya filtrado.
  await page.goto("/mantencion/panel")
  await page.getByRole("link", { name: /^Vencida: \d+ equipos?\. Ver esos equipos/ }).click()
  await expect(page).toHaveURL(/\/mantencion\/equipos\?estado=vencida/)

  // El período cambia la URL sin recargar y deja el botón marcado.
  await page.goto("/mantencion/panel")
  await page.getByRole("button", { name: "7 días", exact: true }).click()
  await expect(page).toHaveURL(/periodo=7/)
  await expect(page.getByRole("button", { name: "7 días", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(consoleErrors, `errores de consola: ${consoleErrors.join(" | ")}`).toEqual([])
})

test("el panel exporta un Excel con los indicadores y las semanas como fecha", async ({ page }) => {
  await login(page, JEFE)
  await page.goto("/mantencion/panel?periodo=todo")
  const { workbook, filename } = await download(page, "Exportar a Excel")
  expect(filename).toMatch(/^panel-mantencion-\d{4}-\d{2}-\d{2}\.xlsx$/)
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["Indicadores", "Registros por semana", "Estado de la flota", "Metadatos"]))
  const weeks = workbook.getWorksheet("Registros por semana")!
  expect(weeks.getRow(2).getCell(1).value).toBeInstanceOf(Date)
  expect(weeks.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.Date)
})

test("registros: indicadores con su rango, filtros en la URL y orden por columna", async ({ page }) => {
  const consoleErrors = trackConsole(page)
  await login(page, JEFE)
  await page.goto("/mantencion/registros")
  await expectPageTitle(page, "Registros de mantención")
  await expect(page.getByRole("heading", { level: 2, name: /^Indicadores · registros del \d{2}-\d{2}-\d{4} al \d{2}-\d{2}-\d{4}/ })).toBeVisible()
  for (const seeded of [rec.A, rec.B, rec.C, rec.D]) {
    await expect(page.getByRole("link", { name: `Ver el registro ${seeded.folio}` })).toBeVisible()
  }

  // Tipo (lista) → sólo la correctiva, con su pastilla removible.
  await page.getByRole("combobox", { name: "Filtrar por tipo de mantención" }).click()
  await page.getByRole("option", { name: "Correctiva", exact: true }).click()
  await expect(page).toHaveURL(/tipo=C/)
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toHaveCount(0)
  await page.getByRole("button", { name: "Eliminar filtro Tipo" }).click()
  await expect(page).not.toHaveURL(/tipo=C/)

  // Búsqueda de equipo en el servidor.
  await page.getByRole("searchbox", { name: "Buscar equipo por código o patente" }).fill(rec.C.code)
  await expect(page).toHaveURL(/equipo=/)
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.C.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toHaveCount(0)

  // «Más filtros»: alerta de salto de lectura → sólo D.
  await page.goto("/mantencion/registros")
  await page.getByRole("button", { name: "Más filtros", exact: true }).click()
  await page.getByRole("combobox", { name: "Alerta" }).click()
  await page.getByRole("option", { name: "Salto de lectura", exact: true }).click()
  await expect(page).toHaveURL(/alerta=salto/)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.D.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Más filtros \(1 activo\)/ })).toBeVisible()

  // «Hecho por» ≠ «Registrado por» (regla 10): B lo hizo el mecánico 1 pero lo registró el 2.
  await page.goto(`/mantencion/registros?hecho=u:${USER.mec1}`)
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toBeVisible()
  await page.goto(`/mantencion/registros?registro=${USER.mec2}`)
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toHaveCount(0)

  // Orden por la columna Folio.
  await page.goto("/mantencion/registros")
  await page.getByRole("link", { name: /^Folio/ }).click()
  await expect(page).toHaveURL(/orden=folio/)
  await expect(page.getByRole("columnheader", { name: /^Folio/ })).toHaveAttribute("aria-sort", /ascending|descending/)
  expect(consoleErrors, `errores de consola: ${consoleErrors.join(" | ")}`).toEqual([])
})

test("registros: el Excel trae sus cinco hojas, fechas reales y la autoría «en nombre de»", async ({ page }) => {
  await login(page, JEFE)
  await page.goto("/mantencion/registros")
  const { workbook, filename } = await download(page, "Exportar a Excel")
  expect(filename).toMatch(/^registros-mantencion-\d{4}-\d{2}-\d{2}\.xlsx$/)
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining([
    "Registros", "Ítems de preventivas", "Repuestos", "Conductores", "Actualizaciones de taller", "Metadatos",
  ]))

  const sheet = workbook.getWorksheet("Registros")!
  const headers = (sheet.getRow(1).values as unknown[]).slice(1) as string[]
  const column = (name: string) => headers.indexOf(name) + 1
  expect(sheet.getRow(1).font?.bold).toBe(true)
  expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
  expect(sheet.autoFilter).toBeTruthy()

  let sawDates = false
  let authorship = ""
  sheet.eachRow((row, index) => {
    if (index === 1) return
    for (const name of ["Fecha del trabajo", "Firmado en el teléfono", "Recibido en la plataforma"]) {
      const cell = row.getCell(column(name))
      expect(cell.value, `${name} debe ser una fecha`).toBeInstanceOf(Date)
      expect(cell.type).toBe(ExcelJS.ValueType.Date)
      sawDates = true
    }
    expect(typeof row.getCell(column("Lectura")).value).toBe("number")
    if (row.getCell(1).value === rec.B.folio) authorship = String(row.getCell(column("Detalle de autoría")).value)
  })
  expect(sawDates).toBe(true)
  expect(authorship).toBe("Registrado por Mecánico Dos E2E en nombre de Mecánico Uno E2E")
})

test("detalle: datos, alertas, firmas y visor de fotos a pantalla completa", async ({ page }) => {
  const consoleErrors = trackConsole(page)
  await login(page, JEFE)
  await page.goto("/mantencion/registros")
  await page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` }).click()
  await expect(page).toHaveURL(new RegExp(`/mantencion/registros/${rec.A.id}$`))
  await expectPageTitle(page, /^Preventiva 40\.000 km · /)

  await expect(page.getByRole("heading", { level: 2, name: "Resultado de la pauta", exact: true })).toBeVisible()
  await expect(page.getByText(/Pastillas de freno — Falta repuesto/)).toBeVisible()
  await expect(page.getByText(/Confirmar con la pauta del fabricante/)).toBeVisible()
  // Regla 8: sello y recepción separados más de 72 h sin período sin señal.
  await expect(page.getByRole("list", { name: "Alertas del registro" })).toContainText("difieren más de 72 h")
  await expect(page.getByText("Jefatura · segunda etapa")).toBeVisible()

  // Visor: abrir, cambiar de foto con flecha y con botón, acercar, foco atrapado y Esc.
  const thumb = page.getByRole("button", { name: /Filtros usados/ })
  await thumb.click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("img", { name: /Filtros usados/ })).toBeVisible()
  await expect(dialog).toContainText("1 de 2")
  await expect(dialog).toContainText("Sello")
  await page.keyboard.press("ArrowRight")
  await expect(dialog).toContainText("2 de 2")
  await expect(dialog.getByRole("img", { name: /Sticker de mantención/ })).toBeVisible()
  await dialog.getByRole("button", { name: "Foto anterior", exact: true }).click()
  await expect(dialog).toContainText("1 de 2")
  await dialog.getByRole("button", { name: "Acercar", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Ajustar a la pantalla", exact: true })).toBeEnabled()
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Tab")
  expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(thumb).toBeFocused()

  // D lleva las tres etiquetas de alerta y el enlace a la preventiva que duplica.
  await page.goto(`/mantencion/registros/${rec.D.id}`)
  const alerts = page.getByRole("list", { name: "Alertas del registro" })
  await expect(alerts).toContainText("Salto de lectura")
  await expect(alerts).toContainText("Pauta elegida a mano")
  await expect(alerts).toContainText("Preventiva duplicada")
  await expect(alerts.getByRole("link", { name: new RegExp(rec.A.folio) })).toHaveAttribute("href", `/mantencion/registros/${rec.A.id}`)
  await expect(page.getByText(/Motivo: Pedido de la jefatura/)).toBeVisible()

  // B se registró en nombre de otro mecánico y trae su trabajo, repuestos, taller y las tres fotos.
  await page.goto(`/mantencion/registros/${rec.B.id}`)
  await expect(page.getByText("Registrado por Mecánico Dos E2E en nombre de Mecánico Uno E2E")).toBeVisible()
  await expect(page.getByText("Manguera hidráulica 1/2")).toBeVisible()
  await expect(page.getByRole("button", { name: /Foto del trabajo 3 de 3/ })).toBeVisible()
  await expect(page.getByText("Sigue en taller", { exact: true })).toBeVisible()

  expect(consoleErrors, `errores de consola: ${consoleErrors.join(" | ")}`).toEqual([])
})

test("PDF: páginas, folio, firma de jefatura pendiente y el mismo archivo en la segunda descarga", async ({ page }) => {
  await login(page, JEFE)
  const url = `/api/mantencion/registros/${rec.A.id}/pdf`
  const first = await page.request.get(url)
  expect(first.status()).toBe(200)
  expect(first.headers()["content-type"]).toContain("application/pdf")
  expect(first.headers()["content-disposition"]).toContain(rec.A.folio)
  const bytes = await first.body()
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")

  const { pageCount, text } = await parsePdf(bytes)
  expect(pageCount).toBeGreaterThanOrEqual(1)
  expect(text).toContain(rec.A.folio)
  // La hoja imprime las etiquetas de firma en mayúsculas (CSS `uppercase`) y el texto del PDF
  // las conserva así: se compara sin distinguir mayúsculas.
  expect(text.toLowerCase()).toContain("firma jefatura (segunda etapa)")
  expect(text).toContain("Pastillas de freno")
  expect(text).toContain("Falta repuesto")
  // «Página X de Y» en cada hoja, con Y = el total real.
  expect(text).toMatch(/Página\s+1\s+de\s+\d+/)
  const total = Number(/Página\s+1\s+de\s+(\d+)/.exec(text)?.[1])
  expect(total).toBe(pageCount)
  expect(text).not.toContain("ANULADO")

  // Archivado: la segunda descarga entrega EL MISMO archivo, no uno re-impreso.
  const second = await page.request.get(url)
  expect(second.status()).toBe(200)
  expect(Buffer.compare(bytes, await second.body())).toBe(0)
})

test("Excel de un solo registro desde su detalle", async ({ page }) => {
  await login(page, JEFE)
  await page.goto(`/mantencion/registros/${rec.D.id}`)
  const { workbook, filename } = await download(page, "Exportar a Excel")
  expect(filename).toContain(rec.D.folio)
  expect(workbook.getWorksheet("Registros")!.rowCount).toBe(2)
})

test("observar un registro y marcarlo revisado", async ({ page }) => {
  await login(page, JEFE)
  await page.goto(`/mantencion/registros/${rec.D.id}`)
  await page.getByRole("button", { name: "Observar", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: /^Observar / })
  await expect(dialog).toBeVisible()
  // Enviar con el texto vacío no es posible.
  await expect(dialog.getByRole("button", { name: "Enviar observación", exact: true })).toBeDisabled()
  await dialog.getByLabel("¿Qué hay que revisar?").fill("Falta la foto legible del sticker E2E")
  await dialog.getByRole("button", { name: "Enviar observación", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("Falta la foto legible del sticker E2E")).toBeVisible()
  await expect(page.getByText("Aún sin respuesta del mecánico.")).toBeVisible()
  await expect(page.getByText("Observado", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Marcar revisado", exact: true }).click()
  await expect(page.getByText("Revisado", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Marcar revisado", exact: true })).toHaveCount(0)
})

test("anular exige motivo, ofrece el registro corregido y desaparece de los cálculos", async ({ page }) => {
  const consoleErrors = trackConsole(page)
  await login(page, JEFE)
  await page.goto("/mantencion/panel?periodo=todo")
  const before = await kpiNumber(page, /^Registros · /)
  expect(before).toBeGreaterThanOrEqual(4)

  await page.goto(`/mantencion/registros/${rec.A.id}`)
  await page.getByRole("button", { name: "Anular", exact: true }).click()
  const confirm = page.getByRole("dialog", { name: /^Anular / })
  await expect(confirm).toBeVisible()
  // Sin motivo (o con uno corto) el botón con el verbo no se habilita.
  await expect(confirm.getByRole("button", { name: "Anular registro", exact: true })).toBeDisabled()
  await confirm.getByLabel("Motivo de la anulación").fill("corto")
  await expect(confirm.getByRole("button", { name: "Anular registro", exact: true })).toBeDisabled()
  await confirm.getByLabel("Motivo de la anulación").fill("Se registró en el equipo equivocado (E2E)")
  await confirm.getByRole("button", { name: "Anular registro", exact: true }).click()

  const after = page.getByRole("dialog", { name: "Registro anulado" })
  await expect(after).toBeVisible()
  await expect(after.getByRole("link", { name: "Crear registro corregido" })).toHaveAttribute("href", `/m/mantencion?corregir=${rec.A.id}`)
  // «Cerrar» existe dos veces (el botón del pie y la X del diálogo): da igual cuál.
  await after.getByRole("button", { name: "Cerrar", exact: true }).first().click()

  // Sigue visible, marcado, con su motivo; ya no ofrece anular ni observar.
  await expect(page.getByText(/Motivo: Se registró en el equipo equivocado \(E2E\)/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Anular", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Observar", exact: true })).toHaveCount(0)

  // Fuera de los cálculos: el indicador del panel baja en uno…
  await page.goto("/mantencion/panel?periodo=todo")
  expect(await kpiNumber(page, /^Registros · /)).toBe(before - 1)
  // …la lista lo conserva marcado, pero «vigentes» ya no lo trae.
  await page.goto("/mantencion/registros")
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toBeVisible()
  await page.goto("/mantencion/registros?estado=vigente")
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toHaveCount(0)
  await page.goto("/mantencion/registros?estado=anulado")
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.A.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.D.folio}` })).toHaveCount(0)

  expect(consoleErrors, `errores de consola: ${consoleErrors.join(" | ")}`).toEqual([])
})

test("el PDF de un registro anulado se vuelve a generar y dice ANULADO con su motivo", async ({ page }) => {
  await login(page, JEFE)
  const response = await page.request.get(`/api/mantencion/registros/${rec.A.id}/pdf`)
  expect(response.status()).toBe(200)
  const { text } = await parsePdf(await response.body())
  expect(text).toContain("ANULADO")
  expect(text).toContain("Se registró en el equipo equivocado (E2E)")
  expect(text).toContain(rec.A.folio)
})

test("el supervisor de Biodiversa ve su faena, no la ajena, y no puede anular", async ({ page }) => {
  await login(page, SUPERVISOR)
  await page.goto("/mantencion/registros")
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.B.folio}` })).toBeVisible()
  await expect(page.getByRole("link", { name: `Ver el registro ${rec.C.folio}` })).toHaveCount(0)

  // El registro de otra faena responde 404 por su URL y por su PDF; el de la suya sí se descarga.
  const foreign = await page.goto(`/mantencion/registros/${rec.C.id}`)
  expect(foreign?.status()).toBe(404)
  expect((await page.request.get(`/api/mantencion/registros/${rec.C.id}/pdf`)).status()).toBe(404)
  expect((await page.request.get(`/api/mantencion/registros/${rec.D.id}/pdf`)).status()).toBe(200)

  // Puede observar (su faena), pero anular es sólo de jefatura.
  await page.goto(`/mantencion/registros/${rec.B.id}`)
  await expect(page.getByRole("button", { name: "Observar", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Anular", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Marcar revisado", exact: true })).toHaveCount(0)

  // El panel de un supervisor es el de su faena: no ofrece otras faenas para elegir.
  await page.goto("/mantencion/panel")
  await expectPageTitle(page, "Panel de mantención")
  await expect(page.getByRole("combobox", { name: "Faena" })).toHaveCount(0)
})
