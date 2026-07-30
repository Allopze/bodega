import { expect, test } from "@playwright/test"
import { login, selectRadixById, pickCurrentMonthDate } from "./helpers"

/**
 * Solicitud de EPP con variantes de talla.
 *
 * Reescrito para el modelo actual: `variant-quantity-grid.tsx` fue reemplazado
 * por `VariantSelector`, y con él cambió la semántica, no sólo la interfaz.
 *
 * - Antes: un ítem con una grilla de tallas y una cantidad **por talla**.
 * - Ahora: cada fila del catálogo es una talla, el ítem elige **una** con un
 *   `Select`, y la cantidad es la del propio ítem. Para pedir dos tallas se
 *   agregan dos ítems.
 *
 * El spec anterior buscaba el texto "cantidad por variante" y unos inputs de la
 * grilla; ninguno de los dos existe ya en el código.
 */
test("crear solicitud EPP con variantes: una talla por ítem", async ({ page }) => {
  await login(page)

  await page.goto("/solicitudes")
  await page.getByRole("link", { name: /nueva/i }).click()
  await expect(page.getByRole("heading", { name: /nueva solicitud/i })).toBeVisible()

  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "EPP")
  await selectRadixById(page, "urgency", "Normal")
  // Obligatoria: sin ella el envío queda en "Fecha requerida inválida".
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  // ── Ítem 1: elegir el producto y su talla ────────────────────────────────
  const picker = page.getByPlaceholder(/Buscar en catálogo o escribir producto/i)
  await picker.fill("Casco E2E")
  const listbox = page.getByRole("listbox")
  await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 10_000 })
  await listbox.getByRole("option").first().click()

  // El selector de talla aparece porque la familia tiene una fila por talla.
  const sizeSelect = page.locator('button[id^="size-"]').first()
  await expect(sizeSelect).toBeVisible({ timeout: 10_000 })
  await sizeSelect.click()
  const sizeOption = page.getByRole("option", { name: "M", exact: true })
  await expect(sizeOption).toBeVisible({ timeout: 5000 })
  await sizeOption.click()
  await expect(sizeSelect).toContainText("M")

  const firstQty = page.locator('input[id^="qty-"]').first()
  await firstQty.fill("2")

  // ── Ítem 2: la otra talla va en su propio ítem ──────────────────────────
  await page.getByRole("button", { name: /Agregar ítem/i }).click()
  const secondPicker = page.getByPlaceholder(/Buscar en catálogo o escribir producto/i).last()
  await secondPicker.fill("Casco E2E")
  await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 10_000 })
  await listbox.getByRole("option").first().click()

  const secondSize = page.locator('button[id^="size-"]').last()
  await expect(secondSize).toBeVisible({ timeout: 10_000 })
  await secondSize.click()
  const otherSize = page.getByRole("option", { name: "L", exact: true })
  await expect(otherSize).toBeVisible({ timeout: 5000 })
  await otherSize.click()
  await expect(secondSize).toContainText("L")

  await page.locator('input[id^="qty-"]').last().fill("3")

  // Dos ítems, cada uno con su talla y su cantidad.
  await expect(page.locator('input[id^="qty-"]')).toHaveCount(2)
  await expect(page.getByRole("heading", { name: /Ítems solicitados/ })).toContainText("2 ítems")

  await page.getByRole("button", { name: /enviar a aprobación/i }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 20_000 })

  // El detalle muestra las dos tallas pedidas.
  await expect(page.getByText(/Casco E2E M/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Casco E2E L/).first()).toBeVisible()
})
