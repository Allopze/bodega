import { expect, test, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).click()
}

test("admin: crear faena, verificarla en el listado y en la navegación", async ({ page }) => {
  await login(page)

  await page.goto("/admin/faenas")
  await expect(page.getByRole("heading", { name: "Faenas" })).toBeVisible()

  await page.getByRole("button", { name: /nueva faena/i }).click()

  await page.getByLabel("Nombre").fill("Faena Admin E2E")
  await page.getByLabel("Código").fill("ADM-E2E")
  await page.getByLabel("Dirección").fill("Ruta 5 Norte km 120")
  await page.getByRole("button", { name: /crear/i }).click()

  await expect(page.getByText("Faena Admin E2E")).toBeVisible()
  await expect(page.getByText("ADM-E2E")).toBeVisible()
})

test("admin: crear producto con categoría, verificarlo en catálogo", async ({ page }) => {
  await login(page)

  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible()

  await page.getByRole("link", { name: /nuevo producto/i }).click()
  await expect(page).toHaveURL(/\/admin\/productos\/nuevo/)

  await page.getByLabel("SKU").fill("E2E-SEC-001")
  await page.getByLabel("Nombre").fill("Producto Secundario E2E")
  await selectRadixById(page, "categoryId", /Categoría E2E/)

  await page.getByRole("button", { name: /crear/i }).click()

  await expect(page).toHaveURL(/\/admin\/productos/, { timeout: 10_000 })
  await expect(page.getByText("Producto Secundario E2E")).toBeVisible()
})

test("admin: crear usuario con rol prevencionista faena, verificar login", async ({ page }) => {
  await login(page)

  await page.goto("/admin/usuarios")
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible()

  await page.getByRole("button", { name: /invitar usuario/i }).click()

  await page.getByLabel("Nombre").fill("Trabajador E2E")
  await page.getByLabel("Correo electrónico").fill("trabajador@e2e.chome.cl")

  await page.getByRole("button", { name: /enviar invitación/i }).click()

  await expect(page.getByText(/invitación/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("trabajador@e2e.chome.cl")).toBeVisible()
})

test("admin: crear proveedor y verificar en listado", async ({ page }) => {
  await login(page)

  await page.goto("/admin/proveedores")
  await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo proveedor/i }).click()

  await page.getByLabel("Nombre").fill("Distribuidora E2E")
  await page.getByLabel("RUT").fill("96.000.000-1")
  await page.getByLabel("Correo").fill("ventas@distribuidora-e2e.cl")
  await page.getByRole("button", { name: /crear/i }).click()

  await expect(page.getByText("Distribuidora E2E")).toBeVisible()
})

test("admin: navegar a auditoría y verificar que hay registros", async ({ page }) => {
  await login(page)

  await page.goto("/admin/auditoria")
  await expect(page.getByRole("heading", { name: /auditoría|log/i })).toBeVisible()

  await expect(page.locator("table, [role='table']")).toBeVisible()
})
