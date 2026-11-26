import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { resolveE2eDatabaseUrl } from "./environment"
import { login, textoVisible } from "./helpers"

const headers = ["Marca temporal", "Dirección de correo electrónico", "Puntuación", "FAENA", "Orden de trabajo", "TIPO DE ACCION", "ACEITE", "TIPO DE TRABAJO", "QUIEN", "EXTERNO", "CONDUCTOR", "Equipo", "ODOMETRO U HOROMETRO", "TRABAJO REALIZADO", "REPUESTOS", "FECHA INGRESO EQUIPO TALLER", "FECHA SALIDA TALLER", "HORAS TRABAJADAS", "FOTOGRAFIA"]
function trackFailures(page: Page, errors: string[]) {
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error" && !/favicon/i.test(message.text())) errors.push(message.text()) })
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? ""
    if (failure.includes("ERR_ABORTED") && request.url().includes("_rsc=")) return
    const url = new URL(request.url())
    // Beacon de `AppVisitTracker` (`fetch` con keepalive): Chromium lo reporta ERR_ABORTED al descargar
    // el documento aunque la petición ya terminó (recibió 204 y la visita quedó en `app_visits`; medido
    // en 18 pantallas, con pausa y sin ella). Es una vista del navegador, no una visita perdida.
    if (failure.includes("ERR_ABORTED") && request.method() === "POST" && url.pathname === "/api/apps/visita") return
    // Server Actions (cabecera `next-action`): Chromium a veces cierra con ERR_ABORTED una acción cuya
    // respuesta ya se consumió (la pantalla pintó el resultado de esa misma respuesta antes del aviso;
    // la traza la registra con 200 y ~60 ms). Cada acción de este caso se afirma por lo que muestra la
    // pantalla o la base —«2 respuestas · 2 nuevas», «2 trabajos guardados», el vínculo del equipo—, así
    // que una acción que de verdad no llegó ya falla ahí; un corte de red real sigue pasando por aquí.
    if (failure.includes("ERR_ABORTED") && request.method() === "POST" && "next-action" in request.headers()) return
    errors.push(`Fallo de red: ${failure} ${request.method()} ${request.resourceType()} ${url.pathname} [${[...url.searchParams.keys()].join(",")}]`)
  })
  page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`) })
}

test("importa y consulta historia, conserva pendientes y permite conciliarlos", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  const url = resolveE2eDatabaseUrl()
  expect(url).toBeTruthy()
  const sql = postgres(url!, { max: 1 })
  const [vehicle] = await sql`select v.id, v.code, v.plate from fuel_vehicles v join mant_equipment_profiles p on p.vehicle_id = v.id join worksites w on w.id = v.worksite_id where w.name = 'Biodiversa' and v.code is not null order by v.code limit 1`
  if (!vehicle) throw new Error("No hay un equipo E2E en Biodiversa.")
  const marker = randomUUID().slice(0, 8)
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("BIODIVERSA")
  sheet.addRow(headers)
  sheet.addRow(["19/08/2025 10:00:00", `qa-${marker}@example.test`, 0, "BIODIVERSA", `QA-${marker}`, "ACCION PREVENTIVA", "", "MECANICO", "Persona QA", "", "", `${vehicle.code} / ${vehicle.plate}`, 0, `Trabajo QA ${marker}`, "", "18/08/2025", "19/08/2025", 2, ""])
  sheet.addRow(["19/08/2025", `qa-${marker}@example.test`, 0, "FAENA QA DESCONOCIDA", `QB-${marker}`, "ACCION PREDICTIVA", "", "MECANICO", "Persona QA", "", "", `QA-${marker} / LPRS-56`, "", `Trabajo pendiente ${marker}`, "", "18/08/2025", "", 1, "https://drive.google.com/qa-foto"])
  const payload = { name: `qa-${marker}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }
  const errors: string[] = []
  trackFailures(page, errors)

  try {
    await login(page, "jefe.mant@e2e.chome.cl")
    await page.goto("/mantencion/registros")
    await page.getByRole("link", { name: "Historial de mantenciones", exact: true }).click()
    // Sin historial, la acción está en la cabecera y también en el estado vacío (A4): ambas llevan al mismo lugar.
    await page.getByRole("link", { name: "Importar respuestas de formularios", exact: true }).first().click()
    await expect(page.locator("#historical-import-file")).toBeEnabled()
    await page.locator("#historical-import-file").setInputFiles(payload)
    await expect(page.getByText(/2 respuestas · 2 nuevas/)).toBeVisible()
    await expect(page.getByText(/1 con equipo identificado · 1 sin coincidencia/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("vista-previa-desktop.png"), fullPage: true })
    await page.getByRole("button", { name: "Importar respuestas de formularios", exact: true }).click()
    await expect(page.getByText(/2 trabajos guardados/)).toBeVisible()
    // El resultado llega antes que el refresco que la acción trae en el mismo stream: navegar en ese instante
    // corta el resto (ERR_ABORTED con la carga ya hecha). Igual que más abajo, se espera a que la red quede quieta.
    await page.waitForLoadState("networkidle")
    // Lo importado se ve, tal como se guardó, en «Respuestas de formularios» (que además es donde se concilia): las filas de
    // este caso son de agosto de 2025 y quedarían fuera de los últimos 12 meses del Historial de mantenciones.
    await page.getByRole("link", { name: "Ver las respuestas de formularios", exact: true }).click()
    await expect(page).toHaveURL(/vista=formularios/)
    // La búsqueda se aplica sola al escribir (sin botón «Buscar»): espera a que viaje en la URL.
    await page.getByRole("searchbox", { name: "Buscar en el historial" }).fill(marker)
    await expect(page).toHaveURL(new RegExp(`q=${marker}`))
    await expect(textoVisible(page, `Trabajo QA ${marker}`)).toBeVisible()
    await expect(textoVisible(page, `Trabajo pendiente ${marker}`)).toBeVisible()

    const supervisorContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const supervisor = await supervisorContext.newPage()
    trackFailures(supervisor, errors)
    await login(supervisor, "supervisor@e2e.chome.cl")
    await supervisor.goto(`/mantencion/registros/historicos?vista=formularios&q=${marker}`)
    await expect(textoVisible(supervisor, `Trabajo QA ${marker}`)).toBeVisible()
    await expect(supervisor.getByText(`Trabajo pendiente ${marker}`, { exact: true })).toHaveCount(0)
    await expect(supervisor.getByRole("link", { name: "Importar respuestas de formularios", exact: true })).toHaveCount(0)
    await expect(supervisor.getByRole("link", { name: /Ver el trabajo de/ })).toBeVisible()
    expect(await supervisor.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    // `screenshot` oculta el cursor con un `style` inline sobre el campo de búsqueda. Si cae antes de que la
    // página hidrate (en `next dev` pasa siempre), React avisa «hydration mismatch» y `errors` deja de estar
    // vacío. Con la red quieta —medido 3 de 3 sin este paso fallaba y 3 de 3 con él pasa— hidrató primero.
    await supervisor.waitForLoadState("networkidle")
    await supervisor.screenshot({ path: testInfo.outputPath("historial-supervision-movil.png"), fullPage: true })
    await supervisorContext.close()

    await page.getByRole("link", { name: `QA-${marker} / LPRS-56` }).click()
    await expect(page).toHaveURL(/\/mantencion\/registros\/historicos\/[a-f0-9]{64}$/)
    // La ficha dice el tipo con su insignia; los datos tal como venían en el formulario van plegados.
    await expect(page.getByText("Predictiva", { exact: true })).toBeVisible()
    await page.getByText(/^Ver los \d+ campos tal como venían en el formulario$/).click()
    await expect(page.getByText("ACCION PREDICTIVA", { exact: true })).toBeVisible()
    await expect(page.getByText("Fecha de envío", { exact: true })).toBeVisible()
    await expect(page.getByText("19-08-2025", { exact: true })).toBeVisible()
    await expect(page.getByText("FOTOGRAFIA", { exact: true })).toHaveCount(0)
    await expect(page.getByText("https://drive.google.com/qa-foto", { exact: true })).toHaveCount(0)
    await page.getByRole("combobox", { name: "Equipo", exact: true }).fill(String(vehicle.code))
    await page.getByRole("option", { name: `${vehicle.code} / ${vehicle.plate}`, exact: true }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).fill("Biodiversa")
    await page.getByRole("option", { name: "Biodiversa", exact: true }).click()
    await page.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(page.getByText("Equipo sin identificar", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: `QA-${marker} / LPRS-56`, exact: true })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await page.goto(`/mantencion/equipos/${vehicle.id}`)
    // La hoja de vida del equipo muestra su línea de tiempo (de cualquier fecha) y lleva al historial filtrado por él.
    await expect(page.getByRole("heading", { name: "Historial de mantenciones" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Ver todo el historial de este equipo", exact: true })).toHaveAttribute("href", new RegExp(`/mantencion/registros/historicos\\?equipo=${vehicle.id}&periodo=todo`))

    await page.waitForLoadState("networkidle")
    await page.goto("/mantencion/registros/historicos/importar")
    await expect(page.locator("#historical-import-file")).toBeEnabled()
    sheet.getRow(3).getCell(1).value = "19/08/2025 11:00:00"
    sheet.getRow(3).getCell(19).value = "https://drive.google.com/qa-foto-cambiada"
    await page.locator("#historical-import-file").setInputFiles({ ...payload, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) })
    await expect(page.getByText(/2 respuestas · 0 nuevas · 2 ya importadas/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Importar respuestas de formularios", exact: true })).toBeDisabled()
    expect(errors).toEqual([])
  } finally { await sql.end() }
})
