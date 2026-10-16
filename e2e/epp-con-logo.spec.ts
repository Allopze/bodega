import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { idFromUrl, login, pickCurrentMonthDate, selectRadixById, textoVisible } from "./helpers"

/**
 * Las prendas EPP llevan logo siempre: `Logo: Con logo` viaja desde el catálogo
 * (atributo `select` de un solo valor) hasta la OC que recibe el proveedor.
 * Diseño: docs/superpowers/specs/2026-10-15-epp-con-logo-design.md (§8).
 *
 * Recorre por la interfaz todo el camino, porque cada tramo lo resuelve una
 * pieza distinta y ninguna prueba unitaria cubre el encadenamiento:
 *
 *   Solicitudes (copia el select de un solo valor a request_item_attributes)
 *     → Aprobaciones (chip «Logo: Con logo»)
 *     → Nueva OC
 *     → OC impresa (sub-línea «Logo: Con logo» sólo en la polera).
 *
 * Siembra: este spec escribe el catálogo directo en la BD, sin pasar por los
 * servicios. Por eso la polera recibe el atributo `Logo` AQUÍ, explícito, y la
 * prueba no depende de la garantía del servidor (que toda escritura de catálogo
 * agregue `Logo` a las prendas elegibles; eso lo cubren las suites PGlite). El
 * botín queda SIN `Logo` a propósito: es el control negativo.
 *
 * Datos con prefijo `QA_`; al terminar los productos se desactivan para que no
 * contaminen los listados de otros specs. El resto (solicitud, OC) queda como en
 * `purchase-flow`, que tampoco lo borra.
 */

const POLERA = { id: "qa-logo-polera", sku: "QA-LOGO-POLERA", name: "Polera Polo QA_ Logo", talla: "M" }
const BOTIN = { id: "qa-logo-botin", sku: "QA-LOGO-BOTIN", name: "Botín QA_ Logo", talla: "42" }

function connect() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL es obligatoria para esta prueba.")
  return postgres(databaseUrl, { max: 1 })
}

async function seedCatalog() {
  const sql = connect()
  try {
    for (const [index, product] of [POLERA, BOTIN].entries()) {
      // Idempotente: un reintento de Playwright vuelve a pasar por aquí y debe
      // dejar los productos activos aunque el `afterAll` anterior los apagó.
      await sql`
        insert into products (id, sku, name, category_id, unit_of_measure, reference_price, is_epp, is_active)
        values (${product.id}, ${product.sku}, ${product.name}, 'cat-epp-e2e', 'unidad', 5000, true, true)
        on conflict (id) do update set is_active = true, is_epp = true, name = excluded.name
      `
      await sql`
        insert into product_attributes (id, product_id, name, type, is_required, options, sort_order)
        values (${`${product.id}-talla`}, ${product.id}, 'Talla', 'select', true, ${JSON.stringify([product.talla])}, 0)
        on conflict (id) do nothing
      `
      await sql`
        insert into product_suppliers (id, product_id, supplier_id, unit_price, is_preferred)
        values (${`ps-${product.id}`}, ${product.id}, 'sup-e2e', 5000, true)
        on conflict (id) do nothing
      `
      if (index === 0) {
        // Sólo la polera: es la prenda elegible. Lo que el servidor escribiría
        // al dar de alta una polera, escrito a mano porque este seed es SQL.
        await sql`
          insert into product_attributes (id, product_id, name, type, is_required, options, sort_order)
          values (${`${product.id}-logo`}, ${product.id}, 'Logo', 'select', true, ${JSON.stringify(["Con logo"])}, 1)
          on conflict (id) do nothing
        `
      }
    }
  } finally {
    await sql.end()
  }
}

async function deactivateCatalog() {
  const sql = connect()
  try {
    await sql`update products set is_active = false where id in ${sql([POLERA.id, BOTIN.id])}`
  } finally {
    await sql.end()
  }
}

async function addCatalogItem(page: Page, name: string, quantity: string, isFirst: boolean) {
  if (!isFirst) await page.getByRole("button", { name: /Agregar ítem/i }).click()
  const picker = page.getByPlaceholder(/Buscar en catálogo o escribir producto/i).last()
  await picker.fill(name)
  const option = page.getByRole("option", { name: new RegExp(name) })
  await expect(option.first()).toBeVisible({ timeout: 15_000 })
  await option.first().click()
  await page.locator('input[id^="qty-"]').last().fill(quantity)
}

test.describe("EPP con logo: de la solicitud a la OC impresa", () => {
  test.beforeAll(seedCatalog)
  test.afterAll(deactivateCatalog)

  test("la polera lleva «Logo: Con logo» hasta la OC y el botín no", async ({ page }) => {
    await login(page)

    // ── Solicitudes ──────────────────────────────────────────────────────────
    await page.goto("/solicitudes/nueva")
    await expect(page.getByRole("heading", { name: /nueva solicitud/i })).toBeVisible()
    await selectRadixById(page, "worksiteId", "Faena E2E")
    await selectRadixById(page, "requestType", "EPP")
    await selectRadixById(page, "urgency", "Normal")
    // Obligatoria: sin ella el envío queda en "Fecha requerida inválida".
    await pickCurrentMonthDate(page, "Seleccionar fecha")

    await addCatalogItem(page, POLERA.name, "2", true)
    // El select de un solo valor llega resuelto al ítem: el formulario lo
    // muestra en el nombre de la variante, no como campo que haya que llenar.
    await expect(textoVisible(page, /Polera Polo QA_ Logo.*Logo: Con logo/)).not.toHaveCount(0)

    await addCatalogItem(page, BOTIN.name, "3", false)
    await expect(textoVisible(page, /Botín QA_ Logo/)).not.toHaveCount(0)
    // El único «Logo: Con logo» de la pantalla es el de la polera.
    await expect(textoVisible(page, /Logo: Con logo/)).toHaveCount(1)

    await page.getByRole("button", { name: /enviar a aprobación/i }).click()
    // Las prendas no tienen stock en el fixture: no aparece la advertencia de
    // disponibilidad y el flujo sigue directo al detalle.
    await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 20_000 })

    // El código es el título; `textContent` porque el h1 es `lg:sr-only` en desktop.
    const requestCode = (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? ""
    expect(requestCode).toMatch(/^SOL-/)

    // El detalle conserva lo registrado: polera con logo, botín sin él.
    const poleraCard = page.getByRole("article").filter({ hasText: POLERA.name }).filter({ visible: true })
    const botinCard = page.getByRole("article").filter({ hasText: BOTIN.name }).filter({ visible: true })
    await expect(poleraCard).toHaveCount(1)
    await expect(poleraCard).toContainText("Logo: Con logo")
    await expect(botinCard).toHaveCount(1)
    await expect(botinCard).not.toContainText("Logo:")

    // ── Aprobaciones ─────────────────────────────────────────────────────────
    await page.goto("/aprobaciones")
    // Acotado a SU solicitud: la bandeja puede traer pendientes de otros specs.
    const ownGroup = page.locator("div:has(> ul)").filter({ hasText: requestCode })
    await expect(ownGroup).toHaveCount(1)
    const poleraRow = ownGroup.getByRole("listitem").filter({ hasText: POLERA.name })
    const botinRow = ownGroup.getByRole("listitem").filter({ hasText: BOTIN.name })
    await expect(poleraRow).toHaveCount(1)
    await expect(poleraRow.getByText("Logo: Con logo", { exact: true })).toBeVisible()
    await expect(botinRow).toHaveCount(1)
    await expect(botinRow.getByText(/Logo:/)).toHaveCount(0)

    // Con dos ítems cada fila tiene su «Aprobar»: se aprueba el grupo completo,
    // que se envía directo, sin diálogo de confirmación.
    await ownGroup.getByRole("button", { name: "Aprobar todos (2)", exact: true }).click()
    await expect(ownGroup).toHaveCount(0, { timeout: 30_000 })

    // ── Nueva OC ─────────────────────────────────────────────────────────────
    await page.goto("/compras/nueva")
    await selectRadixById(page, "ocWorksiteId", "Faena E2E")
    await selectRadixById(page, "supplierId", "Proveedor E2E")
    // Las filas son el div cuyo hijo directo es la casilla; se acota por el
    // código de la solicitud que este spec creó.
    const ownRows = page
      .locator('div:has(> label > input[type="checkbox"])')
      .filter({ hasText: `SOL ${requestCode}` })
    await expect(ownRows).toHaveCount(2)
    // `exact: false` por defecto: el nombre accesible lleva el sufijo de atributos.
    await ownRows.getByLabel(new RegExp(`Incluir ${POLERA.name}`)).check()
    await ownRows.getByLabel(new RegExp(`Incluir ${BOTIN.name}`)).check()
    await page.getByRole("button", { name: /Crear OC \(2 ítems\)/ }).click()
    await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
    // `idFromUrl` y no la cola cruda de la URL: el redirect trae `?actualizada=`.
    const orderId = idFromUrl(page)
    expect(orderId).toBeTruthy()

    // ── OC impresa ───────────────────────────────────────────────────────────
    await page.goto(`/compras/${orderId}/print`)
    const sheet = page.locator(".sheet")
    await expect(sheet).toContainText(POLERA.name)
    const poleraLine = sheet.locator("tbody tr").filter({ hasText: POLERA.name })
    const botinLine = sheet.locator("tbody tr").filter({ hasText: BOTIN.name })
    await expect(poleraLine).toHaveCount(1)
    await expect(botinLine).toHaveCount(1)
    // Sub-línea «Logo: Con logo» (`.item-note`) en la polera y sólo en ella.
    await expect(poleraLine.locator(".item-note").filter({ hasText: /^Logo: Con logo$/ })).toHaveCount(1)
    await expect(botinLine).not.toContainText("Logo:")
    await expect(sheet.getByText("Logo: Con logo")).toHaveCount(1)
  })
})
