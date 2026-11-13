import { test, expect, type Page } from "@playwright/test"
import { login, pickCurrentMonthDate, textoVisible } from "./helpers"

/** Fecha civil de Chile `dias` días desde hoy: la misma zona con la que el servidor decide qué está vencido. */
function fechaEnChile(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
}

test.describe("Flota — gestión documental", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("vehicle detail shows documents panel", async ({ page }) => {
    await page.goto("/flota/fuel-veh-e2e")
    await expect(page.getByRole("heading", { name: "Documentos", exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test("subir un documento se hace desde una hoja, no desde un formulario siempre abierto", async ({ page }) => {
    await page.goto("/flota/fuel-veh-e2e")
    await expect(page.getByRole("heading", { name: "Documentos", exact: true })).toBeVisible({ timeout: 10_000 })
    // El formulario no está en la página hasta que se pide.
    await expect(page.getByRole("dialog", { name: "Subir documento" })).toHaveCount(0)
    await page.getByRole("button", { name: "Subir documento", exact: true }).click()
    const hoja = page.getByRole("dialog", { name: "Subir documento" })
    await expect(hoja).toBeVisible()
    // Sin elegir el tipo no se puede enviar.
    await expect(hoja.getByRole("button", { name: "Subir documento", exact: true })).toBeDisabled()
    await hoja.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(hoja).toBeHidden()
  })
})

/**
 * Renovar un vencimiento desde la ficha del equipo: «Actualizar» → hoja con el foco en el campo de esa
 * fila → fecha → vista previa → guardar → la fila muestra el nuevo estado. Cada prueba deja el equipo
 * como lo encontró (quita la fecha al terminar): el equipo de fixture lo usan otros specs.
 *
 * `fullyParallel` está apagado, así que las pruebas de este archivo corren una tras otra.
 */
test.describe("Flota — actualizar vencimientos desde la ficha", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/flota/fuel-veh-e2e")
  })

  const vencimientos = (page: Page) => page.getByRole("list", { name: "Vencimientos del equipo" })
  const filaRevision = (page: Page) => vencimientos(page).getByRole("listitem").filter({ hasText: "Revisión técnica" })

  async function abrirHojaDeRevision(page: Page) {
    await vencimientos(page).getByRole("button", { name: "Actualizar Revisión técnica", exact: true }).click()
    const hoja = page.getByRole("dialog", { name: "Actualizar vencimientos" })
    await expect(hoja).toBeVisible()
    return hoja
  }

  async function quitarFechaDeRevision(page: Page) {
    const hoja = await abrirHojaDeRevision(page)
    await hoja.getByRole("button", { name: "Quitar fecha de Revisión técnica", exact: true }).click()
    await hoja.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(hoja).toBeHidden()
    await expect(filaRevision(page).getByText("Sin fecha", { exact: true })).toBeVisible()
  }

  test("la ficha lista los cuatro documentos y cada uno ofrece su «Actualizar»", async ({ page }) => {
    await expect(vencimientos(page).getByRole("listitem")).toHaveCount(4)
    for (const documento of ["SOAP", "Permiso de circulación", "Revisión técnica", "Seguro"]) {
      await expect(vencimientos(page).getByRole("button", { name: `Actualizar ${documento}`, exact: true })).toBeVisible()
    }
  })

  test("renovar la revisión técnica: el foco entra al campo, la vista previa avanza y la fila queda por vencer", async ({ page }) => {
    const hoja = await abrirHojaDeRevision(page)

    // El foco va al campo de la fila desde la que se abrió, no al botón de cerrar.
    await expect(hoja.getByRole("button", { name: /^Revisión técnica/ })).toBeFocused()
    // Sin cambios no hay nada que guardar.
    await expect(hoja.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled()

    await pickCurrentMonthDate(page, /^Revisión técnica/, fechaEnChile(0))
    // «Quedará: …» se ve antes de guardar.
    await expect(hoja.getByText("vence hoy")).toBeVisible()
    await expect(hoja.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled()

    await hoja.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(hoja).toBeHidden()
    await expect(textoVisible(page, "Vencimiento actualizado")).toBeVisible()

    // La fila dice el estado con texto, no solo con color.
    await expect(filaRevision(page).getByText("Por vencer", { exact: true })).toBeVisible()
    await expect(filaRevision(page).getByText("vence hoy")).toBeVisible()

    // Y persiste: recargar no lo cambia.
    await page.reload()
    await expect(filaRevision(page).getByText("vence hoy")).toBeVisible()

    await quitarFechaDeRevision(page)
  })

  test("una fecha pasada se ve como vencida, y «Quitar fecha» la devuelve a «Sin fecha»", async ({ page }) => {
    const hoja = await abrirHojaDeRevision(page)
    await pickCurrentMonthDate(page, /^Revisión técnica/, fechaEnChile(-1))
    await hoja.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(hoja).toBeHidden()

    await expect(filaRevision(page).getByText("Vencido", { exact: true })).toBeVisible()
    await expect(filaRevision(page).getByText("venció hace 1 día")).toBeVisible()
    // Lo vencido sube al primer lugar de la tarjeta.
    await expect(vencimientos(page).getByRole("listitem").first()).toContainText("Revisión técnica")

    await quitarFechaDeRevision(page)
  })

  test("cancelar la hoja no guarda lo que se eligió", async ({ page }) => {
    const hoja = await abrirHojaDeRevision(page)
    await pickCurrentMonthDate(page, /^Revisión técnica/, fechaEnChile(0))
    await hoja.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(hoja).toBeHidden()

    await expect(filaRevision(page).getByText("Sin fecha", { exact: true })).toBeVisible()
    // Al reabrir, el campo vuelve a lo guardado (vacío), no a lo que se había elegido sin guardar.
    const reabierta = await abrirHojaDeRevision(page)
    await expect(reabierta.getByRole("button", { name: "Revisión técnica", exact: true })).toBeVisible()
    await expect(reabierta.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled()
  })
})
