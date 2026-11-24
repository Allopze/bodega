import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("retiro de mantenciones antiguas", () => {
  test("las rutas antiguas responden 404 y los módulos vigentes siguen disponibles", async ({ page }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const failedRequests: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("requestfailed", (request) => {
      const url = new URL(request.url())
      const errorText = request.failure()?.errorText
      if (url.searchParams.has("_rsc") && errorText === "net::ERR_ABORTED") return
      // Beacon de `AppVisitTracker` (`fetch` con keepalive): Chromium lo reporta ERR_ABORTED al
      // descargar el documento aunque la petición ya terminó. Medido (18 pantallas, con pausa y sin
      // ella): las 18 recibieron 204, el log del dev trae un `POST /api/apps/visita 204` por cada beacon
      // emitido y cada visita quedó en `app_visits`. Es una vista del navegador, no una visita perdida.
      if (url.pathname === "/api/apps/visita" && request.method() === "POST" && errorText === "net::ERR_ABORTED") return
      failedRequests.push(`${request.url()}: ${errorText ?? "failed"}`)
    })

    await login(page)

    expect((await page.request.get("/mantenciones")).status()).toBe(404)
    expect((await page.request.get("/api/mantenciones/documentos/legacy-id")).status()).toBe(404)

    const mantencion = await page.goto("/mantencion/panel")
    expect(mantencion?.status()).toBe(200)
    await expect(page.getByRole("heading", { name: "Panel de mantención", exact: true })).toBeVisible()

    const ti = await page.goto("/ti/mantenciones")
    expect(ti?.status()).toBe(200)
    await expect(page.getByRole("heading", { name: "Mantenciones", exact: true })).toBeVisible()

    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
    expect(failedRequests).toEqual([])
  })
})
