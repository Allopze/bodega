import { expect, test, type Page } from "@playwright/test"
import { login, selectRadixById, pickCurrentMonthDate } from "./helpers"

/**
 * Servicios sin precio previo, de punta a punta sobre la app real.
 *
 * Lo que cubre y las pruebas de integración no: que los campos condicionales
 * aparezcan solos al elegir el concepto, que la OC deje pasar la línea con el
 * precio vacío, y que el costo real se registre después y mueva los totales.
 */

const VACUNA = "Vacuna"
const MONOGAS = "Mantención de monogás"
/** Código que no está en el registro: la solicitud tiene que darlo de alta. */
const EQUIPO_NUEVO = "000998877E2E"

async function pickProduct(page: Page, name: string) {
  await page.getByPlaceholder("Buscar en catálogo o escribir producto...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).first().click()
}

test("solicitar, aprobar y comprar servicios con costo pendiente, y registrar el costo real", async ({ page }) => {
  await login(page)

  // ── Solicitud: vacuna (colaborador + dosis) + mantención de monogás (equipo) ─
  await page.goto("/solicitudes/nueva")
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Otros")
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  // Antes de elegir el concepto, ninguno de los campos condicionales existe.
  await expect(page.getByLabel(/Colaborador/)).toHaveCount(0)
  await expect(page.getByLabel(/Número de dosis/)).toHaveCount(0)

  await pickProduct(page, VACUNA)

  // Aparecen sin recargar, sólo por haber elegido "Vacuna".
  await expect(page.getByLabel(/Colaborador/)).toBeVisible()
  const dosis = page.getByLabel(/Número de dosis/)
  await expect(dosis).toBeVisible()
  await expect(page.getByText("Costo pendiente").first()).toBeVisible()
  // La cantidad la manda el nº de dosis: el campo queda de sólo lectura.
  await expect(page.getByLabel("Cantidad")).toHaveAttribute("readonly", "")

  await page.getByLabel(/Colaborador/).fill("Trabajador")
  await page.getByRole("option", { name: /Trabajador E2E/ }).click()
  await dosis.fill("2")
  await expect(page.getByLabel("Cantidad")).toHaveValue("2")

  // Segundo ítem: mantención de monogás sobre un equipo que NO está en el
  // registro. El código lo da de alta al crear la solicitud: exigir la ficha
  // previa dejaba el servicio imposible de pedir.
  await page.getByRole("button", { name: "Agregar ítem" }).click()
  const secondItem = page.locator("form").getByText("2", { exact: true }).first()
  await expect(secondItem).toBeVisible()
  await page.getByPlaceholder("Buscar en catálogo o escribir producto...").fill(MONOGAS)
  await page.getByRole("option", { name: new RegExp(MONOGAS) }).first().click()
  await page.getByLabel(/Código del equipo/).fill(EQUIPO_NUEVO)
  await expect(page.getByText(/se dará de alta/i)).toBeVisible()

  await page.getByRole("button", { name: "Crear y enviar a aprobación" }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })

  // La URL cambia antes de que termine la navegación RSC; esperar el encabezado
  // de la ficha evita leer el h1 "Solicitud" de la pantalla saliente.
  const requestHeading = page.getByRole("heading", { level: 1, name: /^SOL-/ }).first()
  await expect(requestHeading).toBeVisible({ timeout: 15_000 })
  const requestCode = (await requestHeading.textContent())?.trim()
  expect(requestCode).toMatch(/^SOL-/)

  // La ficha dice para quién y sobre qué equipo es, sin re-escribir los datos.
  await expect(page.getByLabel(/Colaborador/).first()).toHaveValue(/Trabajador E2E/)
  await expect(page.getByLabel(/Código del equipo/).first()).toHaveValue(new RegExp(EQUIPO_NUEVO))

  // El registro de equipos se formó solo: la ficha quedó en Administración, en
  // la faena de la solicitud y marcada para completar.
  await page.goto("/admin/equipos")
  const nuevaFicha = page.getByRole("row").filter({ hasText: EQUIPO_NUEVO })
  await expect(nuevaFicha).toContainText("Faena E2E")
  await expect(nuevaFicha).toContainText("Por completar")

  // ── Aprobación: un ítem sin precio se aprueba igual que uno con precio ──────
  await page.goto("/aprobaciones")
  const ownGroup = page.locator("div:has(> ul)").filter({ hasText: requestCode! })
  await expect(ownGroup).toHaveCount(1)
  // "Aprobar todos" y no ítem por ítem: aprobar el primero re-renderiza el
  // grupo y el segundo clic corría contra el desmontaje del diálogo.
  await ownGroup.getByRole("button", { name: /Aprobar todos \(2\)/ }).click()
  await expect(ownGroup).toHaveCount(0, { timeout: 30_000 })

  // ── Compra: la OC acepta la línea sin precio ────────────────────────────────
  await page.goto("/compras/nueva")
  await selectRadixById(page, "ocWorksiteId", "Faena E2E")
  await selectRadixById(page, "supplierId", "Proveedor E2E")

  const monogasRow = page
    .locator('div:has(> label > input[type="checkbox"])')
    .filter({ hasText: `SOL ${requestCode}` })
    .filter({ hasText: MONOGAS })
  await expect(monogasRow).toHaveCount(1)
  await monogasRow.getByLabel(new RegExp(`Incluir ${MONOGAS}`)).check()

  // El precio nace vacío y el subtotal lo dice con palabras, no con $0.
  await expect(monogasRow.getByLabel("Precio unit.")).toHaveValue("")
  await expect(monogasRow.getByText("Costo pendiente")).toBeVisible()
  await expect(page.getByText("Total conocido")).toBeVisible()
  await expect(page.getByText(/1 servicio con costo pendiente/)).toBeVisible()

  await page.getByRole("button", { name: /Crear OC \(1 ítem\)/ }).click()
  await expect(page).toHaveURL(/\/compras\/(?!nueva$)[^/]+$/, { timeout: 15_000 })

  // ── Registro posterior del costo real ───────────────────────────────────────
  await expect(page.getByText("Servicios con costo pendiente")).toBeVisible()
  // La línea se dibuja dos veces (tarjeta móvil + tabla); en escritorio sólo la
  // segunda es visible, y cada una tiene su propio id.
  const costForm = page.locator("form").filter({ hasText: "Costo unitario real" }).last()
  await costForm.getByRole("spinbutton").fill("45000")
  await costForm.getByRole("button", { name: "Registrar costo" }).click()

  // Totales recalculados y traza de quién lo registró.
  // `.last()`: la tarjeta móvil también la dibuja, oculta en escritorio.
  await expect(page.getByText(/Costo registrado el .* por /).last()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("Servicios con costo pendiente")).toHaveCount(0)
  // 45.000 × 1,19: el neto ahora incluye el servicio que nació sin precio.
  await expect(page.getByText("$53.550").last()).toBeVisible()
})
