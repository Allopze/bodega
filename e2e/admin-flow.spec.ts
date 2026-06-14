import { expect, test, type Locator, type Page } from "@playwright/test"

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

async function submitDialogForm(dialog: Locator) {
  await dialog.locator("form").evaluate((form) => {
    ;(form as HTMLFormElement).requestSubmit()
  })
}

test("admin: crear faena, verificarla en el listado y en la navegación", async ({ page }) => {
  await login(page)

  await page.goto("/admin/faenas")
  await expect(page.getByRole("heading", { name: "Faenas" })).toBeVisible()

  await page.getByRole("button", { name: /nueva faena/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva faena" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Faena Admin E2E")
  await dialog.getByRole("textbox", { name: "Código" }).fill("ADM-E2E")
  await dialog.getByRole("textbox", { name: "Dirección" }).fill("Ruta 5 Norte km 120")
  await dialog.getByRole("button", { name: /crear/i }).click()

  await expect(page.getByRole("row", { name: /Faena Admin E2E.*ADM-E2E/ })).toBeVisible()
})

test("admin: crear producto con categoría, verificarlo en catálogo", async ({ page }) => {
  await login(page)

  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo producto/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" })

  await dialog.getByRole("textbox", { name: "SKU" }).fill("E2E-SEC-001")
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Producto Secundario E2E")
  await selectRadixById(page, "p-cat", /Categoría E2E/)

  await submitDialogForm(dialog)

  await expect(page.getByRole("row", { name: /E2E-SEC-001.*Producto Secundario E2E/ })).toBeVisible()
})

test("admin: crear usuario con rol prevencionista faena, verificar login", async ({ page }) => {
  await login(page)

  await page.goto("/admin/usuarios")
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible()

  await page.getByRole("button", { name: "Invitar" }).click()
  const dialog = page.getByRole("dialog", { name: "Invitar usuario" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Trabajador E2E")
  await dialog.getByRole("textbox", { name: "Correo electrónico" }).fill("trabajador@e2e.chome.cl")
  await dialog.getByRole("button", { name: "Administrador" }).click()

  await dialog.getByRole("button", { name: /enviar invitación/i }).click()

  await expect(page.getByRole("heading", { name: "Invitación pendiente" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("trabajador@e2e.chome.cl")).toBeVisible()
})

test("admin: crear proveedor y verificar en listado", async ({ page }) => {
  await login(page)

  await page.goto("/admin/proveedores")
  await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo proveedor/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor" })

  await dialog.getByRole("textbox", { name: "Razón social" }).fill("Distribuidora E2E")
  await dialog.getByRole("textbox", { name: "RUT" }).fill("96.542.490-3")
  await dialog.getByRole("textbox", { name: "Correo" }).fill("ventas@distribuidora-e2e.cl")
  await submitDialogForm(dialog)

  await expect(page.getByRole("row", { name: /Distribuidora E2E.*96542490-3/ })).toBeVisible()
})

test("admin: navegar a auditoría y verificar que hay registros", async ({ page }) => {
  await login(page)

  await page.goto("/admin/auditoria")
  await expect(page.getByRole("heading", { name: /auditoría|log/i })).toBeVisible()

  await expect(page.locator("table, [role='table']")).toBeVisible()
})
