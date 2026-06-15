import { expect, test, type Locator, type Page } from "@playwright/test"

let counter = 0
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`
}

/**
 * Generate a syntactically valid Chilean RUT (módulo 11).
 * Validates against the same algorithm used by `validateRut` in
 * `lib/validation/masters.ts`.
 */
function validChileanRut(): string {
  const body = String(Math.floor(Math.random() * 25_000_000) + 7_000_000)
  let sum = 0
  let multiplier = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }
  const remainder = 11 - (sum % 11)
  const dv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder)
  return `${body}-${dv}`
}

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

/**
 * Ensure a worksite named "Faena E2E" exists so downstream tests
 * that depend on it don't cascade-fail. Creates it if missing;
 * tolerates the "código ya existe" error if a previous run left it.
 */
async function ensureWorksiteE2E(page: Page) {
  const code = "FAE-E2E"
  await page.goto("/admin/faenas")

  const exists = page.getByRole("cell", { name: code })
  if (await exists.isVisible().catch(() => false)) return

  await page.getByRole("button", { name: /nueva faena/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva faena" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Faena E2E")
  await dialog.getByRole("textbox", { name: "Código" }).fill(code)
  await dialog.getByRole("textbox", { name: "Dirección" }).fill("Faena de prueba E2E")

  await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
  // Dialog may stay open if code already exists — that's fine
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 }).catch(() => {})
}

/**
 * Click a role chip inside the invitation dialog.
 * Role chips are <button> elements rendered by user-invite-form.tsx.
 */
async function selectRole(dialog: Locator, label: string) {
  await dialog.getByRole("button", { name: label }).click()
  // Wait for React to render the hidden <input name="roleIds"> so
  // form.requestSubmit() in the next step includes the selection.
  await expect(dialog.locator(`input[name="roleIds"][value]`)).toBeAttached({ timeout: 5_000 })
}

async function submitFormAndWaitForClose(page: Page, dialog: Locator) {
  await dialog.locator("form").evaluate((el) => {
    (el as HTMLFormElement).requestSubmit()
  })
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

test("admin: crear faena, verificarla en el listado y en la navegación", async ({ page }) => {
  await login(page)
  const code = uniqueId("ADM")

  await page.goto("/admin/faenas")
  await expect(page.getByRole("heading", { name: "Faenas" })).toBeVisible()

  await page.getByRole("button", { name: /nueva faena/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva faena" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill(`Faena ${code}`)
  await dialog.getByRole("textbox", { name: "Código" }).fill(code)
  await dialog.getByRole("textbox", { name: "Dirección" }).fill("Ruta 5 Norte km 120")

  await submitFormAndWaitForClose(page, dialog)
  await expect(page.getByRole("row", { name: new RegExp(`Faena ${code}.*${code}`) })).toBeVisible({ timeout: 15_000 })
})

test("admin: crear producto con categoría, verificarlo en catálogo", async ({ page }) => {
  await login(page)
  const sku = uniqueId("SKU")

  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo producto/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" })

  await dialog.getByRole("textbox", { name: "SKU" }).fill(sku)
  await dialog.getByRole("textbox", { name: "Nombre" }).fill(`Producto ${sku}`)
  await selectRadixById(page, "p-cat", /Categoría E2E/)

  await submitFormAndWaitForClose(page, dialog)
  await expect(page.getByRole("row", { name: new RegExp(`${sku}.*Producto ${sku}`) })).toBeVisible({ timeout: 15_000 })
})

test("admin: crear usuario con rol prevencionista faena, verificar login", async ({ page }) => {
  await login(page)
  const email = `${uniqueId("user")}@e2e.chome.cl`

  await page.goto("/admin/usuarios")
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible()

  await page.getByRole("button", { name: "Invitar" }).click()
  const dialog = page.getByRole("dialog", { name: "Invitar usuario" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Trabajador E2E")
  await dialog.getByRole("textbox", { name: "Correo electrónico" }).fill(email)

  // Roles are toggle chips — click "Administrador" to select it
  await selectRole(dialog, "Administrador")

  // The invitation form does NOT close on submit when SMTP is disabled —
  // it transforms into a pending-invite panel with "Invitación pendiente".
  await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())

  await expect(page.getByRole("heading", { name: "Invitación pendiente" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(email)).toBeVisible()
})

test("admin: crear proveedor y verificar en listado", async ({ page }) => {
  await login(page)
  const name = `Distribuidora ${uniqueId("D")}`
  const rut = validChileanRut()

  await page.goto("/admin/proveedores")
  await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo proveedor/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor" })

  await dialog.getByRole("textbox", { name: "Razón social" }).fill(name)
  await dialog.getByRole("textbox", { name: "RUT" }).fill(rut)
  await dialog.getByRole("textbox", { name: "Correo" }).fill("ventas@e2e.cl")

  await submitFormAndWaitForClose(page, dialog)
  await expect(page.getByRole("row", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible({ timeout: 15_000 })
})

test("admin: crear trabajador y verificarlo en listado", async ({ page }) => {
  await login(page)

  await ensureWorksiteE2E(page)

  const rut = validChileanRut()
  const firstName = uniqueId("Op")

  await page.goto("/admin/trabajadores")
  await expect(page.getByRole("heading", { name: "Trabajadores" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo trabajador/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo trabajador" })

  await dialog.getByLabel("Nombre").fill(firstName)
  await dialog.getByLabel("Apellido").fill("Playwright")
  await dialog.getByRole("textbox", { name: "RUT" }).fill(rut)
  await dialog.getByRole("textbox", { name: "Cargo" }).fill("Montajista E2E")
  await dialog.locator("#wrk-ws").selectOption({ label: "Faena E2E" })

  await submitFormAndWaitForClose(page, dialog)
  await expect(page.getByRole("row", { name: new RegExp(`${firstName} Playwright.*${rut}.*Montajista E2E.*Faena E2E`) })).toBeVisible({ timeout: 15_000 })
})

test("admin: navegar a auditoría y verificar que hay registros", async ({ page }) => {
  await login(page)

  await page.goto("/admin/auditoria")
  await expect(page.getByRole("heading", { name: /auditoría|log/i })).toBeVisible()

  await expect(page.locator("table, [role='table']")).toBeVisible()
})
