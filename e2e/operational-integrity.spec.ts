import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * La mesa de integridad opera sobre `prod-qa-integridad-e2e`, un fixture propio:
 * reconocer o resolver aquí no toca ninguna fila sobre la que otro spec afirma.
 */
const QA_CASE = "Guante QA Integridad E2E"

test("escanea, filtra y navega la mesa de integridad conservando el alcance", async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  /**
   * El App Router prefetchea cada enlace visible (`_rsc=`) y cancela esas
   * peticiones al navegar: `ERR_ABORTED` sobre un prefetch es funcionamiento
   * normal, no una regresión. Sólo interesa lo que falló por sí mismo.
   */
  page.on("requestfailed", (request) => {
    const url = new URL(request.url())
    if (url.origin !== new URL(page.url() || "http://localhost").origin) return
    if (url.searchParams.has("_rsc")) return
    if (request.failure()?.errorText === "net::ERR_ABORTED") return
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "sin detalle"}`)
  })

  await login(page)
  await page.goto("/bodega/trazabilidad?tab=integridad&faena=ws-e2e")

  await expect(page.getByRole("heading", { name: "Integridad operacional" })).toBeVisible({ timeout: 10_000 })

  // El ledger arranca vacío: el caso existe recién después de escanear.
  await page.getByRole("button", { name: "Revisar integridad" }).click()

  const qaCase = page.getByRole("listitem").filter({ hasText: QA_CASE })
  await expect(qaCase).toHaveCount(1, { timeout: 15_000 })
  await expect(qaCase.getByText("El saldo físico no coincide con el último movimiento.")).toBeVisible()
  await expect(qaCase.getByText("Crítico")).toBeVisible()

  // Filtrar por un dominio ajeno lo esconde; volver a Bodega lo recupera.
  await page.getByLabel("Dominio").click()
  await page.getByRole("option", { name: "Compras" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: QA_CASE })).toHaveCount(0)

  await page.getByLabel("Dominio").click()
  await page.getByRole("option", { name: "Bodega" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: QA_CASE })).toHaveCount(1)

  // El CTA lleva al kardex exacto del producto y la faena del caso.
  await qaCase.getByRole("link", { name: "Ver evidencia" }).click()
  await expect(page).toHaveURL(/\/bodega\?.*producto=prod-qa-integridad-e2e/)
  await expect(page).toHaveURL(/faena=ws-e2e/)

  // Volver conserva la pestaña y la faena.
  await page.goBack()
  await expect(page).toHaveURL(/tab=integridad/)
  await expect(page).toHaveURL(/faena=ws-e2e/)
  await expect(page.getByRole("listitem").filter({ hasText: QA_CASE })).toHaveCount(1)

  expect(consoleErrors, `errores de consola: ${consoleErrors.join(" | ")}`).toHaveLength(0)
  expect(failedRequests, `requests fallidos: ${failedRequests.join(" | ")}`).toHaveLength(0)
})

test("reconocer exige motivo y verificar no cierra un caso que sigue presente", async ({ page }) => {
  await login(page)
  await page.goto("/bodega/trazabilidad?tab=integridad&faena=ws-e2e")
  await page.getByRole("button", { name: "Revisar integridad" }).click()

  const qaCase = page.getByRole("listitem").filter({ hasText: QA_CASE })
  await expect(qaCase).toHaveCount(1, { timeout: 15_000 })

  /**
   * El escaneo revalida las vistas operacionales y vuelve a montar la lista.
   * Sin esperar a que eso termine, el formulario de acuse se desprende del DOM
   * a mitad de la interacción.
   */
  await page.waitForLoadState("networkidle")

  await qaCase.getByRole("button", { name: "Reconocer caso" }).click()
  await qaCase.getByLabel("Motivo").fill("Diferencia QA revisada con bodega en terreno")
  await qaCase.getByRole("button", { name: "Reconocer", exact: true }).click()
  await expect(qaCase.getByText("Reconocido")).toBeVisible({ timeout: 10_000 })

  /**
   * El descuadre sigue en la base: verificar vuelve a correr el detector y el
   * caso no puede cerrarse. Es la garantía central del ledger — nadie cierra un
   * caso apretando un botón.
   *
   * La comprobación es el estado persistido tras recargar, no el toast: el
   * aviso se desvanece, y lo que debe seguir siendo cierto es que el caso no
   * quedó resuelto en la base.
   */
  await qaCase.getByRole("button", { name: "Verificar corrección" }).click()
  await expect(qaCase.getByRole("button", { name: "Verificando…" })).toHaveCount(0, { timeout: 15_000 })

  await page.reload()
  const afterVerify = page.getByRole("listitem").filter({ hasText: QA_CASE })
  await expect(afterVerify.getByText("Reconocido")).toBeVisible({ timeout: 10_000 })
  await expect(afterVerify.getByText("Resuelto")).toHaveCount(0)
  await expect(page.getByRole("link", { name: /Resueltos 0/ })).toBeVisible()
})
