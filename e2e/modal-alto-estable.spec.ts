import { test, expect, type Locator, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * Regresión del defecto reportado el 2026-10-29: «Editar vehículo» cambiaba de
 * tamaño al cambiar de pestaña.
 *
 * La causa no era el formulario sino el primitivo: `SheetContent` medía su
 * contenido (`max-h`), así que la pestaña activa definía la caja y la vista
 * saltaba entre General (~330 px) y Combustible (~700 px). Con `stableHeight` el
 * alto es fijo y el cuerpo scrollea; esta prueba lo mide en la pantalla real,
 * no en una convención de clases.
 *
 * Se reutiliza el vehículo sembrado `E2E-FUEL-1`, el mismo de
 * `catalogs-migrated.spec.ts`, para no sumar datos al seed.
 */
async function box(locator: Locator) {
  const measured = await locator.boundingBox()
  expect(measured, "el modal no tiene caja").not.toBeNull()
  return measured!
}

/**
 * Abre el editor del vehículo sembrado.
 *
 * Se filtra por la barra superior antes de buscarlo: el seed trae más vehículos
 * que la primera página de la tabla y `E2E-FUEL-1` (ordenado por patente) cae
 * después de los `B…`.
 */
async function openVehicleEditor(page: Page) {
  await page.goto("/admin/flota-catalogos/vehiculos")
  await page.getByPlaceholder("Filtrar en esta página...").fill("E2E-FUEL-1")
  await page.getByRole("button", { name: "Editar vehículo E2E-FUEL-1" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("modales multivista de alto estable", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("«Editar vehículo» mantiene alto y ancho al recorrer sus pestañas", async ({ page }) => {
    const dialog = await openVehicleEditor(page)
    await expect(dialog.getByRole("tab", { name: "General", exact: true })).toHaveAttribute("aria-selected", "true")

    // La entrada del sheet anima escala: medir antes de que termine da una caja
    // más chica y la comparación fallaría por el zoom, no por el layout.
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
    })

    const base = await box(dialog)

    for (const tab of ["Combustible", "Estado y vigencias", "Documentos", "General"]) {
      await dialog.getByRole("tab", { name: tab, exact: true }).click()
      await expect(dialog.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true")

      const current = await box(dialog)
      expect(Math.abs(current.height - base.height), `el alto cambió en «${tab}»`).toBeLessThanOrEqual(1)
      expect(Math.abs(current.width - base.width), `el ancho cambió en «${tab}»`).toBeLessThanOrEqual(1)
    }
  })

  test("la tira de pestañas no se desplaza con el formulario", async ({ page }) => {
    const dialog = await openVehicleEditor(page)
    await dialog.getByRole("tab", { name: "Combustible", exact: true }).click()
    const panel = dialog.getByRole("tabpanel", { name: "Combustible" })
    await expect(panel).toBeVisible()

    // Se baja hasta el final del panel; el desplazamiento ocurre en el
    // contenedor que agregó `vehicle-form`, no en el sheet entero.
    const scrolled = await panel.evaluate((element) => {
      let node = element.parentElement
      while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
      if (!node) return 0
      node.scrollTop = node.scrollHeight
      return node.scrollTop
    })
    expect(scrolled, "Combustible no scrollea en este viewport: la prueba no probaría nada").toBeGreaterThan(0)

    const tabList = await box(dialog.getByRole("tablist"))
    const frame = await box(dialog)
    expect(tabList.y).toBeGreaterThanOrEqual(frame.y - 1)
    expect(tabList.y + tabList.height).toBeLessThanOrEqual(frame.y + frame.height + 1)
  })
})
