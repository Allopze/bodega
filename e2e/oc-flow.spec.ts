import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * Camino completo de una OC por oficina, que es el flujo del negocio:
 * emitida → enviada → llegada a oficina (parcial y total) → recepción en faena
 * (parcial y total) → recibida → cerrada.
 *
 * Existe porque el estado `supplier_confirmed` sacaba la OC del conjunto
 * recibible y la dejaba imposible de recibir: ningún test recorría el camino
 * completo, así que el callejón sin salida pasó desapercibido.
 */

const OC_ID = "oc-flow-e2e"
const ITEM_LABEL = "Cantidad a recibir de Guante E2E"

async function registerReception(page: Page, stage: "Oficina" | "Faena", quantity: number) {
  await page.goto(`/recepcion/nueva?oc=${OC_ID}`)
  await page.getByRole("button", { name: new RegExp(`Recepción en ${stage}`, "i") }).click()
  const qty = page.getByLabel(ITEM_LABEL)
  await qty.fill(String(quantity))
  await page.getByRole("button", { name: "Marcar como recibido" }).click()
  // `/\/recepcion\/[^/]+$/` también matchea `/recepcion/nueva`, que es la URL en
  // la que ya estamos: la espera se cumplía sola y el test seguía a la OC antes
  // de que el server action commiteara, leyendo el estado anterior. Con la
  // máquina cargada (2 workers) eso fallaba de forma reproducible. Esperar el
  // código de la recepción creada ancla la espera al efecto real.
  await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })
}

async function expectOcState(page: Page, state: RegExp) {
  await page.goto(`/compras/${OC_ID}`)
  await expect(page.getByRole("heading", { name: /OC-2026-0090/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(state).first()).toBeVisible()
}

test.describe("Flujo OC por oficina", () => {
  test("avanza de enviada a cerrada pasando por oficina y faena", async ({ page }) => {
    await login(page)

    // ── Emitida → enviada ────────────────────────────────────────────────────
    await page.goto(`/compras/${OC_ID}`)
    await page.getByRole("button", { name: "Marcar como enviada" }).click()
    await expect(page.getByText(/Enviada/).first()).toBeVisible({ timeout: 15_000 })

    // El estado retirado no debe volver a ofrecerse.
    await expect(page.getByRole("button", { name: /Confirmada por proveedor/i })).toHaveCount(0)

    // Con la OC enviada el siguiente paso es la oficina, y está ofrecido.
    await expect(page.getByText(/10 unidades por llegar a oficina/)).toBeVisible()
    await expect(page.getByRole("link", { name: /Registrar llegada a oficina/i }))
      .toHaveAttribute("href", `/recepcion/nueva?oc=${OC_ID}`)

    // ── Llegada a oficina: parcial y luego el saldo ───────────────────────────
    await registerReception(page, "Oficina", 4)
    await expectOcState(page, /Oficina parcial/)
    await expect(page.getByText(/6 unidades por llegar a oficina/)).toBeVisible()

    await registerReception(page, "Oficina", 6)
    await expectOcState(page, /En oficina/)
    // Todo en oficina: ahora el paso es faena.
    await expect(page.getByRole("link", { name: /Recepcionar en faena/i })).toBeVisible()

    // ── Recepción en faena: parcial y luego el saldo ──────────────────────────
    await registerReception(page, "Faena", 4)
    await expectOcState(page, /Rec\. parcial/)
    await expect(page.getByText(/6 unidades pendientes/)).toBeVisible()

    // ── Recepción completa → cierre automático ───────────────────────────────
    // Recibir el saldo cierra la orden en la misma transacción
    // (`closeOrderTx` desde `rollupOrderReceiptStatus`): "Recibida" es un
    // estado transitorio que la interfaz nunca llega a mostrar, y por eso no
    // hay un paso manual de cierre una vez que todo llegó.
    await registerReception(page, "Faena", 6)
    await expectOcState(page, /Completada/)
    // Nada pendiente: el CTA de recepción desaparece.
    await expect(page.getByRole("link", { name: /Recepcionar en faena/i })).toHaveCount(0)
    // Y tampoco se ofrece cerrar algo que ya está cerrado.
    await expect(page.getByRole("button", { name: "Cerrar orden" })).toHaveCount(0)
  })
})
