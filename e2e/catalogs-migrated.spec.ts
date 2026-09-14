import { test, expect } from "@playwright/test"
import { login } from "./helpers"

const catalogRoutes = [
  { path: "/admin/faenas", title: "Faenas" },
  { path: "/admin/trabajadores", title: "Trabajadores" },
  { path: "/admin/proveedores", title: "Proveedores" },
  { path: "/admin/centros-costo", title: "Centros de costo" },
  { path: "/admin/productos", title: "Productos" },
  { path: "/admin/catalogos-productos", title: "Catálogos de productos" },
  { path: "/admin/flota-catalogos/vehiculos", title: "Vehículos de combustible" },
  { path: "/admin/flota-catalogos/proveedores-combustible", title: "Proveedores de combustible" },
]

test.describe("Catálogos administrativos migrados", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("todos los catálogos tienen una ruta administrativa navegable", async ({ page }) => {
    for (const route of catalogRoutes) {
      await page.goto(route.path)
      await expect(page.getByRole("heading", { name: route.title }).first()).toBeVisible()
      await expect(page.getByPlaceholder("Filtrar en esta página...")).toBeVisible()
    }
  })

  test("el hub de flota enlaza las superficies canónicas", async ({ page }) => {
    await page.goto("/admin/flota-catalogos")
    await expect(page.getByRole("heading", { name: "Catálogos de flota" })).toBeVisible()
    // Acotado a `<main>`: desde que el panel lateral de administración lista los
    // hijos de "Catálogos de flota", cada destino existe dos veces y ambas
    // visibles, así que filtrar por visibilidad no desempata. Lo que esta prueba
    // afirma es lo que ofrece el hub, no lo que ofrece el panel.
    const hub = page.getByRole("main")
    await expect(hub.getByRole("link", { name: /Vehículos/ })).toHaveAttribute("href", "/admin/flota-catalogos/vehiculos")
    await expect(hub.getByRole("link", { name: /Proveedores de combustible/ })).toHaveAttribute("href", "/admin/flota-catalogos/proveedores-combustible")
  })

  test("vehículos mantienen edición, desactivación y reactivación", async ({ page }) => {
    await page.goto("/admin/flota-catalogos/vehiculos")
    await expect(page.getByRole("cell", { name: "E2E-FUEL-1", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Editar vehículo E2E-FUEL-1" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("tab", { name: "General" })).toBeVisible()
    await dialog.getByRole("tab", { name: "Combustible" }).click()
    await dialog.locator('input[name="compatibleProductIds"][value="fuel-diesel"]').check()
    await dialog.getByRole("tab", { name: "General" }).click()
    await dialog.getByLabel("Modelo").fill("Hilux E2E Validado")
    await dialog.getByRole("button", { name: "Guardar cambios" }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole("button", { name: "Desactivar vehículo E2E-FUEL-1" }).click()
    await expect(page.getByRole("dialog")).toContainText("¿Desactivar vehículo?")
    await page.getByRole("dialog").getByLabel("Motivo").fill("Baja temporal para validar el ciclo E2E")
    await page.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click()
    await page.getByRole("tab", { name: /Inactivos/ }).click()
    await expect(page.getByRole("button", { name: "Activar vehículo E2E-FUEL-1" })).toBeVisible()

    await page.getByRole("button", { name: "Activar vehículo E2E-FUEL-1" }).click()
    await page.getByRole("dialog").getByLabel("Motivo").fill("Reactivación para completar el ciclo E2E")
    await page.getByRole("dialog").getByRole("button", { name: "Reactivar" }).click()
    await expect(page.getByRole("button", { name: "Desactivar vehículo E2E-FUEL-1" })).toBeVisible()
  })

  test("proveedores de combustible mantienen crear y ciclo de estado", async ({ page }) => {
    // fuel_suppliers.rut es unique: si un retry reintenta con el mismo RUT
    // tras un intento previo que sí alcanzó a crear el proveedor, la segunda
    // creación falla por duplicado y el diálogo queda abierto con un error
    // que nada tiene que ver con la causa original. Un sufijo único por
    // intento evita ese falso negativo en retries.
    const unique = Date.now().toString().slice(-6)
    const supplierName = `Proveedor Catálogo E2E ${unique}`

    await page.goto("/admin/flota-catalogos/proveedores-combustible")
    await page.getByRole("button", { name: "Nuevo proveedor" }).first().click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Razón social").fill(supplierName)
    await dialog.getByLabel("RUT").fill(`76.444.${unique}-6`)
    await dialog.getByLabel("Email").fill(`catalogo-e2e-${unique}@chome.cl`)
    await dialog.getByRole("button", { name: "Crear proveedor" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("cell", { name: supplierName, exact: true })).toBeVisible()

    await page.getByRole("button", { name: `Desactivar proveedor de combustible ${supplierName}` }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click()
    await expect(page.getByRole("button", { name: `Activar proveedor de combustible ${supplierName}` })).toBeVisible()
    await page.getByRole("button", { name: `Activar proveedor de combustible ${supplierName}` }).click()
    await expect(page.getByRole("button", { name: `Desactivar proveedor de combustible ${supplierName}` })).toBeVisible()
  })
})
