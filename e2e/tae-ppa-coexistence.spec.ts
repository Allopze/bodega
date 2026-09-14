/**
 * E2E: coexistencia de las PWA PPA y TAE (Fase 1 del plan de control TAE).
 *
 * Ambas viven bajo /(public) pero deben instalarse y funcionar offline de
 * forma independiente: service workers con scope distinto (/ppa vs /tae),
 * cachés separadas (ppa-v2 vs tae-v1) y bases IndexedDB separadas
 * (ppa-offline vs tae-offline). Verifica que instalar/visitar una no borra
 * ni interfiere con los pendientes offline de la otra.
 */
import { expect, test } from "@playwright/test"
import { fillManualPpaForm } from "./helpers"

test.describe("PPA + TAE — coexistencia de PWAs", () => {
  test("ambos service workers se registran con scope propio y no se pisan", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })

    await page.goto("/tae")
    await expect(page.getByText("Escanea el QR TAE")).toBeVisible({ timeout: 15_000 })
    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistrations().then((regs) => regs.some((reg) => reg.scope.endsWith("/tae"))),
      undefined,
      { timeout: 15_000 },
    )

    const scopes = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations()
      return regs.map((reg) => new URL(reg.scope).pathname)
    })

    expect(scopes).toContain("/ppa")
    expect(scopes).toContain("/tae")
    // Ninguno de los dos debe registrar scope "/" (intercepta todo el sitio).
    expect(scopes).not.toContain("/")
  })

  test("instalar/visitar TAE no borra ni toca los pendientes offline de PPA", async ({ page, context }) => {
    // 0. Visitar ambas rutas online primero para que cada SW instale y precachee su
    //    shell — igual que un usuario real instalando la app antes de perder señal.
    //    Sin este paso, un goto() offline a una ruta nunca visitada falla directo con
    //    ERR_INTERNET_DISCONNECTED porque no hay nada cacheado que servir.
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })

    await page.goto("/tae")
    await expect(page.getByText("Escanea el QR TAE")).toBeVisible({ timeout: 15_000 })
    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistrations().then((regs) => regs.some((reg) => reg.scope.endsWith("/tae"))),
      undefined,
      { timeout: 15_000 },
    )

    // 1. Volver a PPA y usarlo offline para dejar un pendiente en IndexedDB "ppa-offline".
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page.getByText("PPA guardado offline", { exact: true })).toBeVisible({ timeout: 10_000 })

    const pendingBefore = await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("ppa-offline")
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("submissions", "readonly")
        const countRequest = tx.objectStore("submissions").count()
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      }
      request.onerror = () => reject(request.error)
    }))
    expect(pendingBefore).toBeGreaterThanOrEqual(1)

    // 2. Ir a TAE (sigue offline) e instalar su propio SW/cola — no debe tocar "ppa-offline".
    await page.goto("/tae")
    await expect(page.getByText("Escanea el QR TAE")).toBeVisible({ timeout: 15_000 })

    // 3. Confirmar que el pendiente de PPA sigue intacto (IndexedDB es por origen,
    //    no por ruta, así que se puede leer desde cualquier página del mismo origen).
    const pendingAfter = await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("ppa-offline")
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction("submissions", "readonly")
        const countRequest = tx.objectStore("submissions").count()
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      }
      request.onerror = () => reject(request.error)
    }))
    expect(pendingAfter).toBe(pendingBefore)

    // 4. Volver a /ppa, restaurar la conexión y confirmar que el pendiente sigue
    //    siendo sincronizable de punta a punta (no quedó corrupto por la visita a TAE).
    //    offline-saved.tsx solo se muestra tras un envío fresco (estado local, no
    //    persistido), así que se llega a él repitiendo el envío offline — el punto
    //    de esta aserción es que "Enviar ahora" complete sin error, no la UI en sí.
    // Se recupera la conexión ANTES de volver a /ppa y se vuelve a cortar, igual
    // que en el paso 1. `setOffline(true)` sobre un contexto que ya estaba
    // offline no emite el evento `offline`, y `useOnlineStatus` sólo cambia de
    // estado por ese evento o por `navigator.onLine` al montar: el formulario se
    // quedaba mostrando "Enviar PPA" y el clic esperaba un botón inexistente.
    await context.setOffline(false)
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)
    // El corte tiene que haber llegado al documento antes de llenar el paso 3:
    // el rótulo del botón de envío se decide con ese estado.
    await page.waitForFunction(() => navigator.onLine === false, undefined, { timeout: 15_000 })
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page.getByText(/2 PPAs pendientes/)).toBeVisible({ timeout: 10_000 })

    await context.setOffline(false)
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Enviar ahora" }).click()
    await expect(page.getByRole("button", { name: "Enviar ahora" })).not.toBeVisible({ timeout: 15_000 })
  })

  test("tae-manifest.json y los iconos propios de TAE son accesibles", async ({ page }) => {
    const manifestResponse = await page.goto("/tae-manifest.json")
    expect(manifestResponse?.status()).toBe(200)
    const manifest = await manifestResponse?.json()
    expect(manifest.scope).toBe("/tae")
    expect(manifest.start_url).toBe("/tae")
    // No debe reutilizar el branding de PPA (icons de /ppa-icon-*).
    const iconSrcs = (manifest.icons as Array<{ src: string }>).map((icon) => icon.src)
    for (const src of iconSrcs) expect(src.startsWith("/ppa-icon")).toBe(false)

    for (const src of iconSrcs) {
      const iconResponse = await page.goto(src)
      expect(iconResponse?.status()).toBe(200)
    }
  })
})
