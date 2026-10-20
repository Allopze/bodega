import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E: el filtro de estado de la programación (`/prevencion/inspecciones/programacion`).
 *
 * El estado es UN select con cuatro valores —Todos, Activas, Vencidas y Detenidas— y no un select más
 * un botón «Sólo vencidas»: dos controles para lo mismo dejaban combinaciones imposibles
 * (`estado=paused&vista=vencidas`, siempre vacía). «Vencidas» viaja como `vista=vencidas` (es el enlace
 * que usa la bandeja) y «Activas» / «Detenidas» como `estado`.
 *
 * El fixture no trae programaciones, así que el spec crea la suya por la pantalla, con un intervalo
 * propio que la identifica entre las que dejan los demás specs (`prevencion-inspecciones-catalogo`).
 */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

async function elegirEstado(page: Page, opcion: string) {
  await page.getByRole("combobox", { name: "Filtrar programaciones por estado" }).click()
  await page.getByRole("option", { name: opcion, exact: true }).click()
}

test.describe("Inspecciones — programación: un solo filtro de estado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones/programacion")
    await expectPageTitle(page, "Programación de inspecciones")
  })

  test("Activas, Vencidas y Detenidas filtran y escriben la URL; la detenida lleva su badge", async ({ page }, testInfo) => {
    const intervalo = String(41 + testInfo.retry)
    const sujeto = `Extintores filtro ${RUN}`

    // Alta: el primer vencimiento es hoy, así que la programación nace activa y al día (no vencida).
    await page.getByRole("button", { name: "Nuevo programa" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Nueva programación" })
    await dialog.getByLabel("Plantilla").click()
    await page.getByRole("option", { name: /Inspección de Estado de Extintores · E2E$/ }).click()
    await dialog.getByLabel("Faena del programa").click()
    await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
    await dialog.getByLabel("Frecuencia").click()
    await page.getByRole("option", { name: "Mensual", exact: true }).click()
    await dialog.locator('input[name="intervalDays"]').fill(intervalo)
    await dialog.locator('input[name="subjectType"]').fill(sujeto)
    await dialog.getByRole("button", { name: "Programar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    const fila = page.getByRole("row")
      .filter({ hasText: "Inspección de Estado de Extintores" })
      .filter({ hasText: `cada ${intervalo} días` })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })
    await expect(fila.getByText("Activa", { exact: true })).toBeVisible()

    // El botón suelto «Sólo vencidas» ya no existe: la vista es una opción del select.
    await expect(page.getByRole("button", { name: /Sólo vencidas/ })).toHaveCount(0)

    // Vencidas: la URL lleva `vista`, no `estado`, y la programación al día no aparece.
    await elegirEstado(page, "Vencidas")
    await expect(page).toHaveURL(/[?&]vista=vencidas(&|$)/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/estado=/)
    await expect(fila).toHaveCount(0)
    await expect(page.getByText("No hay programaciones vencidas")).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Filtrar programaciones por estado" })).toHaveText("Vencidas")

    // Detenidas: pasa a `estado=paused` y la `vista` se va (la combinación vacía falsa no existe).
    await elegirEstado(page, "Detenidas")
    await expect(page).toHaveURL(/[?&]estado=paused(&|$)/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/vista=/)
    await expect(fila).toHaveCount(0)

    // Activas: vuelve a aparecer.
    await elegirEstado(page, "Activas")
    await expect(page).toHaveURL(/[?&]estado=active(&|$)/, { timeout: 30_000 })
    await expect(fila).toHaveCount(1)

    // Se detiene, y entonces «Detenidas» la trae con su badge y «Activas» ya no.
    await fila.getByRole("button", { name: "Detener" }).click()
    const detener = page.getByRole("dialog", { name: "¿Detener esta programación?" })
    await detener.locator('textarea[name="reason"]').fill("Programa detenido al terminar la prueba E2E del filtro.")
    await detener.getByRole("button", { name: "Detener programación" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    await expect(fila).toHaveCount(0, { timeout: 15_000 })

    await elegirEstado(page, "Detenidas")
    await expect(page).toHaveURL(/[?&]estado=paused(&|$)/, { timeout: 30_000 })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })
    await expect(fila.getByText("Detenida", { exact: true })).toBeVisible()
    await expect(fila.getByRole("button", { name: "Reactivar" })).toBeVisible()

    // Un solo chip de estado, y quitarlo limpia la URL.
    await page.getByRole("button", { name: "Eliminar filtro Estado" }).click()
    await expect(page).not.toHaveURL(/estado=|vista=/, { timeout: 30_000 })

    // El enlace de la bandeja (`vista=vencidas`) y la forma vieja (`estado=overdue`) abren el mismo filtro.
    const select = page.getByRole("combobox", { name: "Filtrar programaciones por estado" })
    await page.goto("/prevencion/inspecciones/programacion?vista=vencidas")
    await expect(select).toHaveText("Vencidas", { timeout: 30_000 })
    await page.goto("/prevencion/inspecciones/programacion?estado=overdue")
    await expect(select).toHaveText("Vencidas", { timeout: 30_000 })
  })
})
