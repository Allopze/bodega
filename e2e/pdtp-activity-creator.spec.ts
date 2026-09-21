import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

test.describe.serial("PDTP — creador unificado de actividades", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("crea y programa una actividad desde el editor y expone el mismo flujo en Administración", async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`))
    const suffix = Date.now().toString(36).toUpperCase()
    const title = `Inspección unificada E2E ${suffix}`
    const code = `PDT-E2E-UNIFICADA-${suffix}`

    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    const creator = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar actividad al programa" }) })
    await creator.getByRole("button", { name: "Crear nueva" }).click()
    await creator.getByLabel("Título", { exact: true }).fill(title)
    await creator.getByLabel("Descripción de la actividad", { exact: true }).fill("Inspeccionar controles preventivos del flujo unificado E2E")
    await creator.getByLabel("Guía de ejecución", { exact: true }).fill("Registrar responsable, frecuencia y evidencia de la inspección")
    await creator.getByText("Detalles adicionales", { exact: true }).click()
    await creator.getByLabel("Código estable", { exact: true }).fill(code)
    await creator.getByRole("button", { name: "Guardar actividad" }).click()

    await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible({ timeout: 15_000 })

    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    expect(databaseUrl, "E2E_DATABASE_URL es necesaria para verificar la escritura").toBeTruthy()
    const sql = postgres(databaseUrl!, { max: 1 })
    try {
      const [stored] = await sql<{
        responsible_display: string
        schedule_mode: string
        recurrence_rule: { frequency: string; plannedQuantity: number }
      }[]>`
        select a.responsible_display, a.schedule_mode, a.recurrence_rule
        from pdtp_activities a
        join pdtp_catalog_activities c on c.id = a.catalog_activity_id
        where a.program_id = 'pdtp-draft-e2e' and c.code = ${code}
      `
      expect(stored).toMatchObject({
        responsible_display: "Prevencionista E2E",
        schedule_mode: "scheduled",
        recurrence_rule: { frequency: "monthly", plannedQuantity: 1 },
      })
    } finally {
      await sql.end()
    }

    await page.goto("/admin/pdtp-catalogos")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("button", { name: "Nueva actividad" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Nueva plantilla" })).toBeVisible()
    await page.getByRole("button", { name: "Nueva actividad" }).click()
    const dialog = page.getByRole("dialog", { name: "Nueva actividad" })
    await expect(dialog.getByLabel("Programa anual")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Crear nueva" })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog.getByRole("button", { name: "Guardar actividad" })).toBeVisible()
    await dialog.getByRole("button", { name: "Cerrar" }).click()
    await page.goto("/prevencion/pdtp/pdtp-draft-e2e/editar")
    const mobileCreator = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar actividad al programa" }) })
    await expect(mobileCreator.getByRole("button", { name: "Crear nueva" })).toBeVisible()
    await expect(mobileCreator.getByRole("button", { name: "Guardar actividad" })).toBeVisible()

    expect(consoleErrors).toEqual([])
    expect(failedRequests).toEqual([])
  })
})
