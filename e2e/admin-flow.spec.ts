import { expect, test, type Locator, type Page } from "@playwright/test"
import { clearRateLimits, enviarAsistenteDeProducto } from "./helpers"


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
    sum += parseInt(body[i]!) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }
  const remainder = 11 - (sum % 11)
  const dv = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder)
  return `${body}-${dv}`
}

async function login(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico", { exact: true }).fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
  await page.getByRole("button", { name: "Ingresar", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).first().click()
}


/**
 * Ensure a worksite named "Faena E2E" exists so downstream tests
 * that depend on it don't cascade-fail. Creates it if missing;
 * tolerates the "código ya existe" error if a previous run left it.
 */
/**
 * Garantiza que exista el cargo que usa la prueba de trabajadores.
 *
 * El campo Cargo dejó de ser texto libre: ahora es un selector contra el
 * catálogo de `/admin/cargos`, así que el cargo tiene que existir antes.
 */
async function ensurePositionE2E(page: Page) {
  await page.goto("/admin/cargos")
  const exists = page.getByRole("row", { name: /Montajista E2E/ })
  if (await exists.first().isVisible().catch(() => false)) return

  await page.getByRole("button", { name: /nuevo registro/i }).click()
  await page.getByRole("menuitem", { name: /nuevo cargo/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo cargo" })
  await dialog.getByRole("textbox", { name: "Código" }).fill("MONTAJISTA-E2E")
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Montajista E2E")

  await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 }).catch(() => {})
  await expect(page.getByRole("row", { name: /Montajista E2E/ }).first()).toBeVisible({ timeout: 15_000 })
}

async function ensureWorksiteE2E(page: Page) {
  const code = "FAE-E2E"
  await page.goto("/admin/faenas")

  // Se comprueba por FILA y por nombre, no por la celda del código: el seed ya
  // crea "Faena E2E" (código E2E-001), así que buscar "FAE-E2E" nunca acertaba
  // y este helper creaba una segunda faena con el mismo nombre. Después,
  // cualquier spec que buscara /Faena E2E/ —el selector de faenas del invite,
  // el alcance del PDTP— fallaba por strict mode con 2 elementos. La celda no
  // sirve para comprobarlo porque concatena nombre y código ("Faena E2EE2E-001").
  const exists = page.getByRole("row", { name: /Faena E2E/ })
  if (await exists.first().isVisible().catch(() => false)) return

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
  const name = `Producto ${uniqueId("E2E")}`

  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo producto/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" })

  await dialog.getByRole("textbox", { name: "Nombre" }).fill(name)
  await selectRadixById(page, "p-cat", /Categoría E2E/)

  await enviarAsistenteDeProducto(page, dialog)

  // The product creation dialog may close via redirect/refresh.
  // Wait for the table to show the new product instead of asserting dialog closed.
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible({ timeout: 15_000 })
})

/**
 * El asistente de 3 pasos y el camino de lote no tenían ninguna cobertura: la
 * prueba de "crear producto" de arriba envía el formulario con
 * `form.requestSubmit()` desde el paso 1, que es un camino que un usuario real
 * no puede tomar (no hay botón de envío hasta el paso 3).
 */
test("admin: asistente de variantes crea un producto por cada talla", async ({ page }) => {
  await login(page)
  // No "Casco E2E…": el fixture tiene una familia llamada exactamente así, y
  // `epp-variant-request-flow.spec.ts` la busca por prefijo en el picker. Como
  // la base E2E es compartida, el producto que crea este test se colaba primero
  // en esa búsqueda y la otra prueba terminaba pidiendo el producto equivocado.
  const familyName = `Casco asistente ${uniqueId("WIZ")}`

  await page.goto("/admin/productos")
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo producto/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" })

  // Paso 1 — información general
  await dialog.getByRole("textbox", { name: "Nombre" }).fill(familyName)
  await selectRadixById(page, "p-cat", /Categoría E2E/)
  await dialog.getByRole("button", { name: /Siguiente/ }).click()

  // Paso 2 — atributos y generación de variantes
  await dialog.getByRole("button", { name: /^\+ Talla$/ }).click()
  await dialog.getByRole("button", { name: /^✓? ?M$/ }).first().click()
  await dialog.getByRole("button", { name: /^✓? ?L$/ }).first().click()
  await dialog.getByRole("button", { name: /Generar variantes \(2 combinaciones\)/ }).click()

  // La vista previa confirma las dos variantes antes de crear.
  await expect(dialog.getByText(`${familyName} M`)).toBeVisible()
  await expect(dialog.getByText(`${familyName} L`)).toBeVisible()

  await dialog.getByRole("button", { name: /Siguiente/ }).click()

  // Paso 3 — proveedor (opcional) y creación del lote.
  // `nextStep` regenera las variantes con un `setTimeout(0)`, así que el pie
  // del asistente se vuelve a montar justo después de cambiar de paso: hay que
  // esperar a que el paso 3 asiente o el click cae sobre un botón que se
  // desmonta y Playwright reintenta para siempre.
  // Llegar al paso 3 no debe crear nada por sí solo: el asistente enviaba el
  // formulario en el propio click de «Siguiente» (React le cambiaba el `type`
  // al mismo nodo), así que los productos nacían sin pasar por acá y el paso de
  // proveedor era inalcanzable.
  await expect(dialog.getByText("Variantes a crear:")).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Crear 2 productos/ })).toBeVisible()

  await dialog.getByRole("button", { name: /Crear 2 productos/ }).click()

  // Las dos variantes se agrupan en UNA fila de familia con su selector de
  // variante, en vez de aparecer sueltas. La categoría E2E no es EPP, así que
  // esto además cubre que el lote crea familia también para productos que no
  // son EPP — sin eso cada talla se listaba como un producto aparte.
  const familyRow = page.getByRole("row", { name: new RegExp(familyName) })
  await expect(familyRow).toHaveCount(1, { timeout: 15_000 })
  await expect(familyRow.getByRole("combobox", { name: /Características/ })).toBeVisible()
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

  // Roles are toggle chips; the E2E fixture exposes the scoped role to invitations.
  await selectRole(dialog, "Solicitante faena")
  await dialog.getByRole("checkbox", { name: /Faena E2E/ }).check()

  // The invitation form does NOT close on submit when SMTP is disabled —
  // it transforms into a pending-invite panel with "Invitación pendiente".
  await dialog.locator("form").evaluate((el) => (el as HTMLFormElement).requestSubmit())

  // Sin SMTP el enlace solo se entrega en ese panel, así que queda abierto
  // hasta que el admin lo cierra (antes lo destruía el remontaje de la
  // plataforma al revalidar). Mientras está abierto, la hoja modal saca la
  // lista del árbol accesible.
  const pendingPanel = page.getByRole("dialog", { name: "Invitación pendiente" })
  await expect(pendingPanel).toBeVisible({ timeout: 30_000 })
  await expect(pendingPanel.getByRole("button", { name: "Copiar enlace al portapapeles" })).toBeVisible()
  await pendingPanel.getByRole("button", { name: "Cerrar", exact: true }).last().click()
  await expect(pendingPanel).toBeHidden()

  await expect(page.getByRole("heading", { name: "Invitaciones enviadas" })).toBeVisible({ timeout: 30_000 })
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
  await ensurePositionE2E(page)

  const rut = validChileanRut()
  const firstName = uniqueId("Op")

  await page.goto("/admin/trabajadores")
  await expect(page.getByRole("heading", { name: "Trabajadores" })).toBeVisible()

  await page.getByRole("button", { name: /nuevo trabajador/i }).click()
  const dialog = page.getByRole("dialog", { name: "Nuevo trabajador" })

  await dialog.getByLabel("Nombre").fill(firstName)
  await dialog.getByLabel("Apellido").fill("Playwright")
  await dialog.getByRole("textbox", { name: "RUT" }).fill(rut)
  await selectRadixById(page, "wrk-pos", /Montajista E2E/)
  await selectRadixById(page, "wrk-ws", "Faena E2E")

  await submitFormAndWaitForClose(page, dialog)
  // El listado pagina de a 25 y el seed ya trae más trabajadores (los del CPHS
  // de más de 25 personas): el nuevo no tiene por qué caer en la primera
  // página. Se busca con el filtro de la barra, como lo haría la persona.
  await page.getByPlaceholder("Filtrar en esta página...").fill(firstName)
  await expect(page.getByRole("row", { name: new RegExp(`${firstName} Playwright.*${rut}.*Montajista E2E.*Faena E2E`) })).toBeVisible({ timeout: 15_000 })
})

test("admin: navegar a auditoría y verificar que hay registros", async ({ page }) => {
  await login(page)

  await page.goto("/admin/auditoria")
  await expect(page.getByRole("heading", { name: /auditoría|log/i })).toBeVisible()

  await expect(page.locator("table, [role='table']")).toBeVisible()
})
