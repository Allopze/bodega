import { expect, test } from "@playwright/test"
import ExcelJS from "exceljs"
import { expectPageTitle, selectRadixById } from "./helpers"
import { chileDay, dayMonthYear, asJefe, trackConsole, withSql, fichaValue, idFromPath, fillEquipmentForm, importWorkbook } from "./mantencion-3-helpers"

/**
 * §16 E2E 6 · Jefatura de mantención: equipos (sigue en `mantencion-3b-pautas.spec.ts`).
 *
 * Con estado y en orden: corre después de la spec de jefatura (`mantencion-2-jefatura`)
 * y sólo depende de la carga inicial (120 equipos, las pautas «Camiones y tractos» y
 * «Maquinaria pesada») y de la cuenta `jefe.mant@e2e.chome.cl`. Todo lo que crea lleva
 * el prefijo `QA-` / `QA ` para reconocerlo, y al final deja los equipos de prueba
 * dados de baja.
 *
 * E2E 6 (equipos): alta con faena nueva escrita con otra tilde (se reutiliza la
 * existente), edición, importación con vista previa (filas válidas y con error) y baja.
 * E2E 7 (pautas): crear copiando otra, agregar un intervalo y un ítem, quitar con
 * «Deshacer», asignar equipos con el resumen de cambios, y comprobar que la app del
 * mecánico recibe la pauta nueva; por último eliminarla.
 *
 * Los locators siguen «Locators in this repository» de AGENTS.md: `getByRole`
 * (ignora los nodos ocultos de las vistas duplicadas) y `exact: true` cuando un
 * rótulo es prefijo de otro. Las versiones y los snapshots de las pautas se leen de la
 * base: la pantalla no muestra la versión en un nodo visible a todos los anchos.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const ids = { eq1: "", eq2: "", im1: "" }

test.describe("E2E 6 · Equipos", () => {
  test("la lista ordena por estado, filtra por la URL y pagina con «Mostrar 50 más»", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/equipos")
    await expectPageTitle(page, "Equipos")
    // La carga inicial deja tres camiones de Biodiversa «Próximos» (39.900 km): encabezan la lista
    // (salvo que alguna spec anterior haya dejado equipos vencidos, que van antes).
    await expect(page.getByRole("row").nth(1)).toContainText(/Vencida|Próxima/)
    await expect(page.getByText(/^Mostrando 50 de \d+ equipos$/)).toBeVisible()
    await page.getByRole("button", { name: "Mostrar 50 más", exact: true }).click()
    await expect(page.getByText(/^Mostrando 100 de \d+ equipos$/)).toBeVisible()

    // Los encabezados ordenables anuncian su orden; el tercer clic vuelve al orden por estado.
    const faenaHeader = page.getByRole("columnheader", { name: /Faena/ })
    await page.getByRole("button", { name: /^Ordenar por Faena/ }).click()
    await expect(faenaHeader).toHaveAttribute("aria-sort", "ascending")
    await page.getByRole("button", { name: /^Ordenar por Faena/ }).click()
    await expect(faenaHeader).toHaveAttribute("aria-sort", "descending")
    await page.getByRole("button", { name: /^Ordenar por Faena/ }).click()
    await expect(faenaHeader).not.toHaveAttribute("aria-sort", /./)

    // El estado viaja en la URL (el panel enlaza así) y aparece como filtro activo que se puede quitar.
    await page.goto("/mantencion/equipos?estado=proxima")
    await expect(page.getByRole("button", { name: "Eliminar filtro Estado", exact: true })).toBeVisible()
    await expect(page.getByRole("row").nth(1)).toContainText("Próxima")
    await page.getByRole("button", { name: "Eliminar filtro Estado", exact: true }).click()
    await expect(page).not.toHaveURL(/estado=/)
    expect(errors).toEqual([])
  })

  test("agrega un equipo: la faena escrita con otra tilde reutiliza la existente (regla 17)", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/equipos")
    await page.getByRole("link", { name: "Nuevo equipo", exact: true }).click()
    await expectPageTitle(page, "Nuevo equipo")
    const worksitesBefore = await withSql(async (sql) => Number((await sql`select count(*) as n from worksites`)[0]?.n))

    await fillEquipmentForm(page, {
      code: "qa-eq1", plate: "zzzb 71", type: /^Camión ·/, brand: "Scania", model: "R450", year: "2021",
      worksite: "", newWorksite: "  cholguán ", schedule: "Camiones y tractos", reading: "12.345",
    })
    await page.getByRole("button", { name: "Crear equipo", exact: true }).click()

    await expect(page).toHaveURL(/\/mantencion\/equipos\/(?!nuevo)[^/?]+/)
    ids.eq1 = idFromPath(page)
    await expect(page.getByText(/Equipo QA-EQ1 creado/)).toBeVisible()
    await expectPageTitle(page, "QA-EQ1")
    // El código se normalizó y la patente quedó con guion; la faena es la que ya existía.
    await expect(fichaValue(page, "Código interno")).toHaveText("QA-EQ1")
    await expect(fichaValue(page, "Patente")).toHaveText("ZZZB-71")
    await expect(fichaValue(page, "Faena")).toHaveText("Cholguan")
    await expect(fichaValue(page, "Pauta")).toHaveText("Camiones y tractos")
    expect(await withSql(async (sql) => Number((await sql`select count(*) as n from worksites`)[0]?.n))).toBe(worksitesBefore)
    // El historial dice que se creó, con fecha y autor en una línea.
    await expect(page.getByRole("heading", { name: "Historial de cambios" })).toBeVisible()
    await expect(page.getByText("Equipo creado", { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })

  test("agrega un equipo «Sin patente» en Biodiversa y sin pauta, y rechaza una patente repetida", async ({ page }) => {
    await asJefe(page)
    await page.goto("/mantencion/equipos/nuevo")
    // Repetir la patente de QA-EQ1 se rechaza con el equipo que ya la tiene.
    await fillEquipmentForm(page, { code: "QA-EQ2", plate: "ZZZB-71", type: /^Camión ·/, brand: "Scania", model: "R450", year: "2020", worksite: "Biodiversa" })
    await page.getByRole("button", { name: "Crear equipo", exact: true }).click()
    await expect(page.getByText(/La patente ZZZB-71 ya está en el equipo QA-EQ1/)).toBeVisible()
    await expect(page).toHaveURL(/\/mantencion\/equipos\/nuevo/)

    await page.getByLabel("Sin patente", { exact: true }).check()
    await expect(page.getByRole("textbox", { name: "Patente", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Crear equipo", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/equipos\/(?!nuevo)[^/?]+/)
    ids.eq2 = idFromPath(page)
    // Código y patente coinciden: la ficha muestra uno solo y dice que no tiene patente.
    await expect(fichaValue(page, "Código interno")).toHaveText("QA-EQ2")
    await expect(fichaValue(page, "Patente")).toHaveText("Sin patente")
    await expect(fichaValue(page, "Pauta")).toHaveText("Sin pauta")
  })

  test("edita la ficha: se abre en lectura, la faena se normaliza y el historial lo cuenta", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/equipos/${ids.eq1}`)
    // Modo lectura: no hay formulario hasta «Editar ficha».
    await expect(page.getByRole("textbox", { name: "Modelo", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Editar ficha", exact: true }).click()
    await page.getByRole("textbox", { name: "Modelo", exact: true }).fill("R500")
    await selectRadixById(page, "eq-worksite", "Nueva faena…")
    await page.getByRole("textbox", { name: "Nombre de la faena nueva", exact: true }).fill("TENO")
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click()

    await expect(page.getByText("Cambios guardados en QA-EQ1.")).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Modelo", exact: true })).toHaveCount(0)
    await expect(fichaValue(page, "Modelo")).toHaveText("R500")
    await expect(fichaValue(page, "Faena")).toHaveText("Teno")
    await expect(page.getByText(/Editado · Modelo: R450 → R500 · Faena: Cholguan → Teno/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test("la plantilla de importación es un Excel con la hoja Equipos y las listas vigentes", async ({ page }) => {
    await asJefe(page)
    await page.goto("/mantencion/equipos/importar")
    await expectPageTitle(page, "Importar equipos")
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Descargar plantilla (.xlsx)", exact: true }).click(),
    ])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile((await file.path()) as string)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Equipos", "Listas", "Instrucciones"])
    expect(workbook.getWorksheet("Equipos")?.getRow(1).getCell(1).value).toBe("Código")
    expect(file.suggestedFilename()).toBe("plantilla-equipos-mantencion.xlsx")
  })

  test("importa con vista previa: filas válidas, con error y cambios sobre un equipo existente", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto("/mantencion/equipos/importar")
    const readingDate = chileDay(-5)
    const buffer = await importWorkbook([
      ["QA-IM1", "ZZZC-72", "Camión", "Scania", "P360", 2020, "Biodiversa", "Camiones y tractos", 40100, dayMonthYear(readingDate)], // nuevo, válido
      ["QA-IM2", "XXX-999", "Camión", "Marca inexistente", null, null, "Biodiversa", null, null, null], // dos errores
      ["QA-EQ1", null, null, null, "R600", null, null, null, null, null], // existente: sólo cambia el modelo
    ])
    await page.locator("#equipment-import-file").setInputFiles({
      name: "equipos-qa.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    })

    await expect(page.getByRole("heading", { name: "3. Revisa y confirma" })).toBeVisible()
    await expect(page.getByText("1 equipo nuevo · 1 por actualizar · 1 fila con error")).toBeVisible()
    const preview = page.getByRole("region", { name: "Vista previa de la importación" })
    await expect(preview.getByRole("row").filter({ hasText: "QA-IM2" })).toContainText("Con error")
    await expect(preview.getByRole("row").filter({ hasText: "QA-IM2" })).toContainText(/patente válida/)
    await expect(preview.getByRole("row").filter({ hasText: "QA-IM2" })).toContainText(/Marca inexistente/)
    await expect(preview.getByRole("row").filter({ hasText: "QA-IM1" })).toContainText("Nuevo")
    await expect(preview.getByRole("row").filter({ hasText: "QA-EQ1" })).toContainText("Modelo: R500 → R600")
    // La vista previa no escribe nada.
    expect(await withSql(async (sql) => (await sql`select 1 from fuel_vehicles where code = 'QA-IM1'`).length)).toBe(0)

    await page.getByRole("button", { name: "Importar 2 equipos", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Importación lista" })).toBeVisible()
    await expect(page.getByText("1 equipo creado · 1 actualizado · 1 fila con error")).toBeVisible()

    const imported = await withSql(async (sql) => sql`
      select v.id, v.plate, v.model, p.initial_reading::float8 as initial_reading, p.initial_reading_date, p.schedule_id
      from fuel_vehicles v join mant_equipment_profiles p on p.vehicle_id = v.id where v.code = 'QA-IM1'`)
    expect(imported).toHaveLength(1)
    ids.im1 = imported[0]!.id as string
    expect(imported[0]).toMatchObject({ plate: "ZZZC-72", model: "P360", initial_reading: 40100, initial_reading_date: readingDate })
    expect(await withSql(async (sql) => (await sql`select 1 from fuel_vehicles where code = 'QA-IM2'`).length)).toBe(0)
    expect(await withSql(async (sql) => (await sql`select model from fuel_vehicles where code = 'QA-EQ1'`)[0]?.model)).toBe("R600")
    // Cada fila escrita quedó en el historial con la acción «import» y hay una auditoría de la importación.
    expect(await withSql(async (sql) => (await sql`select 1 from mant_equipment_history where vehicle_id = ${ids.im1} and action = 'import'`).length)).toBe(1)
    expect(await withSql(async (sql) => (await sql`select 1 from audit_log where entity_type = 'mant_equipment_import'`).length)).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test("la búsqueda de la barra superior encuentra el equipo importado", async ({ page }) => {
    await asJefe(page)
    await page.goto("/mantencion/equipos")
    await page.getByRole("searchbox", { name: "Filtrar en esta página", exact: true }).fill("qa-im")
    await expect(page.getByRole("link", { name: "QA-IM1", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "QA-EQ1", exact: true })).toHaveCount(0)
  })

  test("da de baja un equipo con motivo y lo reactiva; las bajas no salen por defecto", async ({ page }) => {
    const errors = trackConsole(page)
    await asJefe(page)
    await page.goto(`/mantencion/equipos/${ids.im1}`)
    await page.getByRole("button", { name: "Editar ficha", exact: true }).click()
    await page.getByRole("radio", { name: "Dado de baja", exact: true }).check()
    // Sin motivo no se da de baja.
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click()
    await expect(page.getByText(/Explica el motivo de la baja en al menos 10 caracteres/)).toBeVisible()
    await page.getByRole("textbox", { name: "Motivo de la baja", exact: true }).fill("Vendido a un tercero")
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click()
    await expect(page.getByText("Cambios guardados en QA-IM1.")).toBeVisible()
    await expect(fichaValue(page, "Estado")).toHaveText("Dado de baja · Vendido a un tercero")
    await expect(page.getByText(/Dado de baja: Vendido a un tercero/)).toBeVisible()

    await page.goto("/mantencion/equipos")
    await page.getByRole("searchbox", { name: "Filtrar en esta página", exact: true }).fill("qa-im1")
    await expect(page.getByRole("link", { name: "QA-IM1", exact: true })).toHaveCount(0)
    await page.getByLabel("Mostrar dados de baja", { exact: true }).check()
    await expect(page).toHaveURL(/bajas=1/)
    await expect(page.getByRole("row").filter({ hasText: "QA-IM1" })).toContainText("Dado de baja")

    // Reactivar lo devuelve a la lista normal.
    await page.goto(`/mantencion/equipos/${ids.im1}`)
    await page.getByRole("button", { name: "Editar ficha", exact: true }).click()
    await page.getByRole("radio", { name: "Activo", exact: true }).check()
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click()
    await expect(fichaValue(page, "Estado")).toHaveText("Activo")
    expect(await withSql(async (sql) => (await sql`select action from mant_equipment_history where vehicle_id = ${ids.im1} order by created_at desc, id desc limit 2`).map((row) => row.action))).toEqual(["reactivate", "retire"])
    expect(errors).toEqual([])
  })
})
