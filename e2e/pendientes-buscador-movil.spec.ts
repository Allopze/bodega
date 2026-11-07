import { expect, test, type Locator, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * UX-02 (auditoría UI/UX 2026-11-07): a 390 px el buscador de «Mis pendientes»
 * medía 358 × 16 px. El `<input>` llevaba `h-11 … flex-1` dentro de un `flex-col`;
 * en columna `flex-1` fija la base en 0 y anulaba la altura, y como además era un
 * `<input>` crudo con `text-xs`, iOS hacía zoom al enfocarlo (< 16 px). La cola
 * usa ahora el `Input` compartido, que mide 44 px y usa 16 px en móvil.
 *
 * Se mide la caja renderizada y no las clases: lo que falló fue el cálculo de
 * layout, no la presencia de `h-11`.
 */

const BUSCADOR = "Buscar en pendientes"
// Fixture de `setup-db.ts` (120 solicitudes aprobadas): la 117 está en la cola y la búsqueda
// la deja sola, sin las otras 119.
const CODIGO_CONOCIDO = "SOL-BULK-E2E-117"

async function buscadorMovil(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await page.goto("/pendientes")
  const buscador = page.getByRole("searchbox", { name: BUSCADOR })
  await expect(buscador).toBeVisible()
  return buscador
}

test.describe("Mis pendientes: el buscador en móvil (UX-02)", () => {
  test("mide al menos 44 px de alto, ocupa el ancho y usa 16 px para que iOS no haga zoom", async ({ page }) => {
    const buscador = await buscadorMovil(page)

    const box = await buscador.boundingBox()
    expect(box, "el buscador no tiene caja visible").not.toBeNull()
    expect(box?.height, "el buscador debe medir al menos 44 px de alto en móvil").toBeGreaterThanOrEqual(44)
    // Columna a todo el ancho: ya no depende de `flex-1`.
    expect(box?.width, "el buscador debe ocupar el ancho de la pantalla").toBeGreaterThan(300)

    const fontSize = await buscador.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize, "con menos de 16 px iOS hace zoom al enfocar el campo").toBeGreaterThanOrEqual(16)

    // El botón de debajo conserva su objetivo táctil.
    const boton = await page.getByRole("button", { name: "Buscar", exact: true }).boundingBox()
    expect(boton?.height).toBeGreaterThanOrEqual(44)
  })

  test("escribir y pulsar «Buscar» filtra la cola, y una búsqueda sin coincidencias lo dice", async ({ page }) => {
    const buscador = await buscadorMovil(page)
    const lista = page.getByRole("list", { name: "Pendientes operacionales" })
    const buscar = page.getByRole("button", { name: "Buscar", exact: true })

    // Un clic anterior a la hidratación enviaría el formulario nativo (sin `name`
    // en el campo, recarga la página sin `q`): se reintenta hasta que la URL cambie.
    await expect(async () => {
      await buscador.fill("zzz-no-existe-zzz")
      await buscar.click()
      await expect(page).toHaveURL(/[?&]q=zzz-no-existe-zzz/, { timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByText("No hay pendientes con estos filtros")).toBeVisible()
    await expect(lista).toHaveCount(0)

    await buscador.fill(CODIGO_CONOCIDO)
    await buscar.click()
    await expect(page).toHaveURL(new RegExp(`[?&]q=${CODIGO_CONOCIDO}`))
    await expect(lista).toContainText(CODIGO_CONOCIDO)
    // Ninguna tarjeta ajena a la búsqueda: filtró de verdad, no sólo cambió la URL.
    await expect(lista.getByRole("listitem").filter({ hasNotText: CODIGO_CONOCIDO })).toHaveCount(0)
  })
})
