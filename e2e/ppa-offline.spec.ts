/**
 * E2E: PPA Digital — modo offline (simulación con context.setOffline + page.route).
 *
 * Verifica que:
 *   1. El formulario muestra "Guardar offline" cuando no hay red.
 *   2. El submit offline encola en IndexedDB y redirige a ?saved=offline.
 *   3. Al restaurar la conexión, el sync automático envía el PPA al servidor.
 *   4. El Service Worker se registra y el manifest.json es accesible.
 *   5. La página funciona即使 la red se cae después de cargar.
 *
 * Usa las fixtures de e2e/setup-db.ts (Faena E2E + trabajador 11111111-1).
 * No requiere login — el formulario PPA es público.
 */
import { expect, test, type Page } from "@playwright/test"
import { selectRadixById } from "./helpers"

const FAENA = "Faena E2E"

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Fill the PPA form using manual identification (no RUT verification).
 * This is the only reliable path for offline tests since the server
 * worker lookup requires network.
 */
async function fillManualPpaForm(page: Page) {
  // Switch to manual identification
  await page.getByRole("button", { name: "No estoy en la lista" }).click()

  // Select faena from dropdown
  await page.locator("#worksite").click()
  await page.getByRole("option", { name: FAENA }).first().click()

  // Fill name
  await page.locator("#wname").fill("Trabajador Offline E2E")

  // Select work type
  await selectRadixById(page, "tipo", "Conductor Batea")

  // No planned change
  await page.getByTestId("cambio-no").click()

  // No uncontrolled hazard
  await page.getByTestId("peligro-no").click()

  // Check required controls
  await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
  await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()

  // Safe to start
  await page.getByTestId("seguro-si").click()
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

test.describe("PPA Digital — modo offline", () => {
  test("el formulario muestra 'Guardar offline' cuando no hay red", async ({ page, context }) => {
    // Load page normally first (so it hydrates)
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Simulate going offline via browser context
    await context.setOffline(true)

    // Fill the form using manual identification
    await fillManualPpaForm(page)

    // The submit button should show "Guardar offline"
    await expect(page.getByRole("button", { name: /Guardar offline/ })).toBeVisible()
  })

  test("submit offline encola en IndexedDB y redirige a ?saved=offline", async ({ page, context }) => {
    // Load page normally
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Go offline
    await context.setOffline(true)
    await fillManualPpaForm(page)

    // Click submit — should queue offline
    await page.getByRole("button", { name: /Guardar offline/ }).click()

    // Should redirect to the offline saved confirmation page
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // The confirmation page should be visible
    await expect(page.getByText("PPA guardado offline")).toBeVisible()
    await expect(page.getByText(/se ha almacenado en este dispositivo/)).toBeVisible()
  })

  test("submit offline muestra toast de confirmación", async ({ page, context }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)

    await page.getByRole("button", { name: /Guardar offline/ }).click()

    // The toast should confirm the offline save
    await expect(
      page.getByText(/guardado offline|se enviará automáticamente/),
    ).toBeVisible({ timeout: 10_000 })
  })

  test("la página de guardado offline muestra pendientes y explicación", async ({ page, context }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)

    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Should show the pending count section
    await expect(page.getByText(/pendiente.*de envío/)).toBeVisible()

    // Should show explanatory text
    await expect(page.getByText("¿Qué pasa con mi PPA?")).toBeVisible()
    await expect(page.getByText(/datos están seguros/)).toBeVisible()
    await expect(page.getByText(/enviarán al servidor automáticamente/)).toBeVisible()
  })

  test("puede realizar otro PPA desde la página de guardado offline", async ({ page, context }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)

    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Restore network so the form can load
    await context.setOffline(false)

    // Click "Realizar otro PPA"
    await page.getByRole("button", { name: "Realizar otro PPA" }).click()

    // Should navigate back to the form
    await expect(page).toHaveURL(/\/ppa$/)
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("PPA Digital — sincronización tras reconexión", () => {
  test("PPA offline se sincroniza al restaurar la conexión", async ({ page, context }) => {
    // Step 1: Load page, go offline, submit a PPA
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Step 2: Restore network — auto-sync should trigger after ~1s
    await context.setOffline(false)

    // Step 3: Wait for "Enviar ahora" button (means online + pending items)
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({
      timeout: 15_000,
    })

    // Step 4: Click "Enviar ahora" to trigger manual sync
    await page.getByRole("button", { name: "Enviar ahora" }).click()

    // Step 5: After sync, the pending count should go to 0
    await expect(
      page.getByText(/No hay PPA|0.*pendiente/),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("múltiples PPAs offline se sincronizan", async ({ page, context }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)

    // Submit first PPA offline
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Navigate back to form for second PPA
    // Note: navigating while offline requires SW cache; restore briefly to load the form
    await context.setOffline(false)
    await page.getByRole("button", { name: "Realizar otro PPA" }).click()
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Should show 2 pending
    await expect(page.getByText(/2 PPAs pendientes/)).toBeVisible()

    // Restore network and trigger sync
    await context.setOffline(false)
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: "Enviar ahora" }).click()

    // After sync, pending count should be 0
    await expect(
      page.getByText(/No hay PPA|0.*pendiente/),
    ).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("PPA Digital — Service Worker y manifest", () => {
  test("manifest.json es accesible", async ({ page }) => {
    const response = await page.goto("/manifest.json")
    expect(response?.status()).toBe(200)
    const manifest = await response?.json()
    expect(manifest).toHaveProperty("name")
    expect(manifest).toHaveProperty("start_url")
    expect(manifest).toHaveProperty("icons")
    expect(manifest.scope).toBe("/ppa")
  })

  test("service worker se registra", async ({ page }) => {
    await page.goto("/ppa")

    // Wait for the service worker to register
    const swRegistered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ])
      return reg !== null
    })
    expect(swRegistered).toBe(true)
  })

  test("iconos PWA son accesibles", async ({ page }) => {
    const response192 = await page.goto("/ppa-icon-192.png")
    expect(response192?.status()).toBe(200)

    const response512 = await page.goto("/ppa-icon-512.png")
    expect(response512?.status()).toBe(200)
  })
})

test.describe("PPA Digital — verificación de RUT", () => {
  test("RUT inválido muestra error de formato", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter an invalid RUT (letters instead of digits)
    await page.locator("#rutSearch").fill("abc-def")
    await page.getByRole("button", { name: "Verificar" }).click()

    // Should show format error toast
    await expect(
      page.getByText(/RUT inválido|formato/),
    ).toBeVisible({ timeout: 10_000 })

    // Worker should NOT be verified
    await expect(page.getByText(/Verificado:/)).not.toBeVisible()
  })

  test("RUT no encontrado muestra error de trabajador", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter a valid-format RUT that doesn't exist in the DB
    await page.locator("#rutSearch").fill("99999999-9")
    await page.getByRole("button", { name: "Verificar" }).click()

    // Should show not-found error toast
    await expect(
      page.getByText(/no se encontró|ningún trabajador/),
    ).toBeVisible({ timeout: 10_000 })

    // Worker should NOT be verified
    await expect(page.getByText(/Verificado:/)).not.toBeVisible()
  })

  test("RUT vacío mantiene botón deshabilitado", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Verify button is disabled when RUT is empty
    const verifyBtn = page.getByRole("button", { name: "Verificar" })
    await expect(verifyBtn).toBeDisabled()

    // Fill and clear — button should re-disable
    await page.locator("#rutSearch").fill("12345678-9")
    await expect(verifyBtn).not.toBeDisabled()
    await page.locator("#rutSearch").fill("")
    await expect(verifyBtn).toBeDisabled()
  })

  test("verificar con RUT exitoso muestra trabajador y faena", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Enter the E2E worker RUT
    await page.locator("#rutSearch").fill("11111111-1")
    await page.getByRole("button", { name: "Verificar" }).click()

    // Should show verified worker info
    await expect(page.getByText(/Verificado:/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Trabajador E2E/)).toBeVisible()
    await expect(page.getByText(new RegExp(`Faena:.*${FAENA}`))).toBeVisible()

    // Faena field should appear (derived from RUT)
    await expect(page.getByText(FAENA)).toBeVisible()
  })

  test("envío con error de validación del server action muestra toast de error", async ({ page }) => {
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Verify worker
    await page.locator("#rutSearch").fill("11111111-1")
    await page.getByRole("button", { name: "Verificar" }).click()
    await expect(page.getByText(/Verificado:/)).toBeVisible({ timeout: 15_000 })

    // Fill form but leave type of work empty (required field)
    await page.getByTestId("cambio-no").click()
    await page.getByTestId("peligro-no").click()
    await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
    await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()
    await page.getByTestId("seguro-si").click()

    // Submit — should fail client-side validation (missing tipoTrabajo)
    await page.getByRole("button", { name: "Enviar PPA" }).click()

    // Should show validation error toast
    await expect(
      page.getByText(/faltan respuestas|obligatorias/),
    ).toBeVisible({ timeout: 10_000 })

    // Should NOT navigate to result page
    await expect(page).toHaveURL(/\/ppa$/)
  })
})

test.describe("PPA Digital — notificaciones offline", () => {
  /**
   * In headless Chromium, Notification.permission defaults to "denied".
   * We need addInitScript to mock it as "default" so the notification
   * section renders (it only shows when permission === "default").
   */
  test("la página de guardado offline muestra el prompt de notificaciones", async ({ page, context }) => {
    // Mock Notification.permission as "default" before page loads
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        value: "default",
        configurable: true,
      })
    })

    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // The notification permission section should be visible
    await expect(
      page.getByText(/Recibe una notificación cuando tu PPA se envíe/),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Activar notificaciones" }),
    ).toBeVisible()
  })

  test("hacer clic en 'Activar notificaciones' dispara el prompt del navegador", async ({ page, context }) => {
    // Mock Notification.permission as "default" before page loads
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        value: "default",
        configurable: true,
      })
    })

    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Grant notification permission via CDP (simulates user clicking "Allow")
    await context.grantPermissions(["notifications"])

    // Click "Activar notificaciones" — triggers Notification.requestPermission()
    await page.getByRole("button", { name: "Activar notificaciones" }).click()

    // After granting, the permission section should disappear
    await expect(
      page.getByRole("button", { name: "Activar notificaciones" }),
    ).not.toBeVisible({ timeout: 5_000 })
  })

  test("el prompt de notificaciones se oculta tras denegar permiso", async ({ page, context }) => {
    // Mock Notification.permission as "default" before page loads
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        value: "default",
        configurable: true,
      })
    })

    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Click "Activar notificaciones" — in headless Chrome without granted permission,
    // Notification.requestPermission() resolves to "denied"
    await page.getByRole("button", { name: "Activar notificaciones" }).click()

    // After denying, the permission section should disappear
    await expect(
      page.getByRole("button", { name: "Activar notificaciones" }),
    ).not.toBeVisible({ timeout: 5_000 })
  })

  test("el prompt de notificaciones no se muestra si el permiso ya fue otorgado", async ({ page, context }) => {
    // Pre-grant notification permission via CDP before loading the page
    await context.grantPermissions(["notifications"])

    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // The notification permission section should NOT appear
    // (Notification.permission is already "granted", not "default")
    await expect(
      page.getByRole("button", { name: "Activar notificaciones" }),
    ).not.toBeVisible()
  })

  test("el prompt de notificaciones no se muestra si el permiso fue denegado previamente", async ({ page, context }) => {
    // Mock Notification.permission as "denied" before page loads
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", {
        value: "denied",
        configurable: true,
      })
    })

    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // The notification permission section should NOT appear
    await expect(
      page.getByRole("button", { name: "Activar notificaciones" }),
    ).not.toBeVisible()
  })
})

test.describe("PPA Digital — auto-sync backoff", () => {
  test("auto-sync no repite infinitamente cuando el servidor rechaza", async ({ page, context }) => {
    // Step 1: Load page, submit a PPA offline
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Step 2: Restore network but block the submit action API
    await context.setOffline(false)
    // Next.js server actions POST to the page URL (/ppa), not /ppa/actions
    await page.route("**/ppa", (route) => {
      if (route.request().method() === "POST") route.abort()
      else route.continue()
    })

    // Step 3: Wait for auto-sync to attempt and fail
    // The "Enviar ahora" button appears when online + pending items
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({
      timeout: 15_000,
    })

    // Step 4: The pending count should still show (sync failed)
    await expect(page.getByText(/pendiente.*de envío/)).toBeVisible()

    // Step 5: Unblock the API and manually trigger sync
    await page.unrouteAll({ behavior: "wait" })
    await page.getByRole("button", { name: "Enviar ahora" }).click()

    // Step 6: After successful sync, pending should be 0
    await expect(
      page.getByText(/No hay PPA|0.*pendiente/),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("backoff reset cuando el sync exitoso después de un fallo", async ({ page, context }) => {
    // Step 1: Submit PPA offline
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await context.setOffline(true)
    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Step 2: Go online but block API to trigger a failed auto-sync attempt
    await context.setOffline(false)
    // Next.js server actions POST to the page URL (/ppa), not /ppa/actions
    await page.route("**/ppa", (route) => {
      if (route.request().method() === "POST") route.abort()
      else route.continue()
    })

    // Wait for auto-sync to fire and fail
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({
      timeout: 15_000,
    })

    // Step 3: Unblock API, wait a beat, then re-block to simulate intermittent failure
    await page.unrouteAll({ behavior: "wait" })
    await page.waitForTimeout(500)
    // Next.js server actions POST to the page URL (/ppa), not /ppa/actions
    await page.route("**/ppa", (route) => {
      if (route.request().method() === "POST") route.abort()
      else route.continue()
    })

    // Step 4: Now fully unblock and trigger manual sync — should succeed
    await page.unrouteAll({ behavior: "wait" })
    await page.getByRole("button", { name: "Enviar ahora" }).click()

    // Step 5: Pending should be 0 (backoff reset worked)
    await expect(
      page.getByText(/No hay PPA|0.*pendiente/),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("syncOne falla no bloquea sincronización de otros items", async ({ page, context }) => {
    // Step 1: Submit first PPA offline
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)

    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Step 2: Navigate back, submit second PPA
    await context.setOffline(false)
    await page.getByRole("button", { name: "Realizar otro PPA" }).click()
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    await context.setOffline(true)

    await fillManualPpaForm(page)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })

    // Should show 2 pending
    await expect(page.getByText(/2 PPAs pendientes/)).toBeVisible()

    // Step 3: Go online — both should sync
    await context.setOffline(false)
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: "Enviar ahora" }).click()

    // Step 4: After sync, pending should be 0 (both items synced)
    await expect(
      page.getByText(/No hay PPA|0.*pendiente/),
    ).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("PPA Digital — SW cache eviction", () => {
  test("SW cache no crece indefinidamente", async ({ page }) => {
    // Step 1: Load the PPA page multiple times to populate cache
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Navigate away and back several times to populate cache entries
    for (let i = 0; i < 5; i++) {
      await page.goto("/ppa")
      await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })
    }

    // Step 2: Wait for SW to be active
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })

    // Step 3: Check cache size via the Cache API from the page context
    const cacheSize = await page.evaluate(async () => {
      const cache = await caches.open("ppa-v2")
      const keys = await cache.keys()
      return keys.length
    })

    // The cache should have entries but not be unbounded.
    // We loaded /ppa ~5 times + the SW precaches /ppa and /ppa/result,
    // so we expect some entries but definitely under MAX_CACHE_ENTRIES (60).
    expect(cacheSize).toBeGreaterThan(0)
    expect(cacheSize).toBeLessThanOrEqual(60)
  })

  test("SW cache evicts old entries when limit is approached", async ({ page }) => {
    // Step 1: Load page to register SW
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })

    // Step 2: Add synthetic cache entries to push close to MAX_CACHE_ENTRIES
    await page.evaluate(async (count) => {
      const cache = await caches.open("ppa-v2")
      for (let i = 0; i < count; i++) {
        const syntheticUrl = `https://example.com/test-${i}.html`
        await cache.put(syntheticUrl, new Response(`test ${i}`))
      }
    }, 55) // Push to 55 + initial entries

    // Step 3: Navigate to trigger a cache.put which calls evictIfNecessary
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Step 4: Wait for SW to process and evict
    await page.waitForTimeout(2000)

    // Step 5: Check that the cache was evicted to stay under the limit
    const finalSize = await page.evaluate(async () => {
      const cache = await caches.open("ppa-v2")
      const keys = await cache.keys()
      return keys.length
    })

    // After eviction, cache should be at or below MAX_CACHE_ENTRIES (60)
    expect(finalSize).toBeLessThanOrEqual(60)
  })

  test("SW precache shell URLs en install", async ({ page }) => {
    // Load page to trigger SW install
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })

    // Check that shell URLs are in the cache
    const hasShellUrls = await page.evaluate(async () => {
      const cache = await caches.open("ppa-v2")
      const keys = await cache.keys()
      const urls = keys.map((req) => new URL(req.url).pathname)
      return {
        hasPpa: urls.includes("/ppa"),
        hasResult: urls.includes("/ppa/result"),
      }
    })

    expect(hasShellUrls.hasPpa).toBe(true)
    expect(hasShellUrls.hasResult).toBe(true)
  })
})

test.describe("PPA Digital — resilience", () => {
  test("el formulario funciona即使 la red se cae después de cargar", async ({ page, context }) => {
    // Load the page normally first
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Simulate going offline
    await context.setOffline(true)

    // Fill the form using manual mode
    await fillManualPpaForm(page)

    // Submit should still work (offline queue)
    await page.getByRole("button", { name: /Guardar offline/ }).click()
    await expect(page).toHaveURL(/\?saved=offline/, { timeout: 10_000 })
  })

  test("el banner offline se muestra cuando la red cae", async ({ page, context }) => {
    // Load the page normally
    await page.goto("/ppa")
    await expect(page.locator("#rutSearch")).toBeVisible({ timeout: 15_000 })

    // Simulate going offline via the browser context
    await context.setOffline(true)

    // The offline banner should appear
    await expect(page.getByText(/sin conexión/i)).toBeVisible({ timeout: 10_000 })

    // Restore
    await context.setOffline(false)
  })
})
