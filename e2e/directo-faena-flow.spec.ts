import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * Camino alternativo de despacho: **directo a faena**, sin checkpoint de
 * oficina. `sent` pasa a `partially_received` y luego a `received`/`closed`.
 *
 * No tenía ninguna cobertura: `oc-flow.spec.ts` recorre sólo `via_oficina`, y
 * `recepcion-flow.spec.ts` verifica el título de la página. Quedaban sin probar
 * la guarda que rechaza registrar oficina sobre una OC directa
 * (`receiving.ts`), el cap que topea la recepción contra lo pedido —y no contra
 * lo llegado a oficina, que en este modo es siempre 0— y el cierre automático.
 */

const OC_ID = "oc-directo-faena-e2e"
const OC_CODE = /OC-2026-0092/
const ITEM_LABEL = "Cantidad a recibir de Guante E2E"

async function registerFaenaReception(page: Page, quantity: number) {
  await page.goto(`/recepcion/nueva?oc=${OC_ID}`)
  const qty = page.getByLabel(ITEM_LABEL)
  await qty.fill(String(quantity))
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  // Anclar la espera al efecto real (el correlativo de la recepción creada):
  // `/\/recepcion\/[^/]+$/` también matchea `/recepcion/nueva`, la URL en la que
  // ya estamos, así que la espera se cumpliría sola.
  await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })
}

async function expectOcState(page: Page, state: RegExp) {
  await page.goto(`/compras/${OC_ID}`)
  await expect(page.getByRole("heading", { name: OC_CODE })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(state).first()).toBeVisible()
}

test.describe("Flujo OC directo a faena", () => {
  test("avanza de enviada a cerrada en un solo paso de recepción", async ({ page }) => {
    await login(page)

    await page.goto(`/compras/${OC_ID}`)
    await page.getByRole("button", { name: "Emitir y enviar" }).click()
    await expect(page.getByText(/Pendiente de recepción/).first()).toBeVisible({ timeout: 15_000 })

    // El siguiente paso es faena directamente: no se ofrece la llegada a oficina.
    await expect(page.getByRole("link", { name: /Recepcionar en faena/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /Registrar llegada a oficina/i })).toHaveCount(0)

    // Y el formulario tampoco ofrece la etapa oficina: si la ofreciera, el
    // servicio rechazaría el envío y quedaría un camino muerto en pantalla.
    await page.goto(`/recepcion/nueva?oc=${OC_ID}`)
    await expect(page.getByRole("button", { name: /Recepción en oficina/i })).toHaveCount(0)
    await expect(page.getByLabel(ITEM_LABEL)).toBeVisible()

    // Recepción parcial: el saldo se mide contra lo pedido, no contra oficina
    // (que en este modo nunca recibe nada).
    await registerFaenaReception(page, 3)
    await expectOcState(page, /Recibido en faena \(parcial\)/)

    // El saldo cierra la orden en la misma transacción (state-badge rotula
    // `closed` de una OC como "Completada").
    await registerFaenaReception(page, 5)
    await expectOcState(page, /Completada/)
  })
})
