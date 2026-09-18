/**
 * Hero del login (octágono de marca): el estado vive en el `<form>` cliente
 * (`data-auth-state`) y el `<aside>` servidor lo lee con `:has()` — sin
 * Context, sin mutar el DOM (ver `app/globals.css`, `login-form.tsx`).
 *
 * Estas pruebas fijan dos contratos a la vez a propósito: que el form
 * publica el atributo correcto, y que `:has()` efectivamente cruza el grid
 * hasta el aside. Si alguien renombra `.auth-grid` o mueve el SVG fuera de
 * ese subárbol, solo cae la segunda aserción — el diagnóstico es inmediato.
 */
import { test, expect } from "@playwright/test"
import { clearRateLimits } from "./helpers"

// El hero es `hidden lg:flex`: sin este viewport, `.auth-hero-tracer` nunca
// se pinta y toda aserción de animación sería un falso negativo silencioso.
test.use({ viewport: { width: 1280, height: 800 } })

test("SSR: el hero arranca en idle sin depender de hidratación", async ({ page }) => {
  const response = await page.request.get("/login")
  const html = await response.text()
  expect(html).toContain('data-auth-state="idle"')
})

test("pending: el trazador se activa mientras el login está en vuelo", async ({ page }) => {
  await clearRateLimits()
  // Retiene el callback de credenciales para poder observar el estado
  // intermedio; sin esto `pending` dura ~100ms y la aserción es una carrera.
  await page.route("**/api/auth/callback/credentials", async (route) => {
    await new Promise((r) => setTimeout(r, 3_000))
    await route.continue()
  })

  await page.goto("/login")
  await page.getByLabel("Correo electrónico", { exact: true }).fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
  await page.getByRole("button", { name: "Ingresar", exact: true }).click()

  const form = page.locator("form[data-auth-state]")
  await expect(form).toHaveAttribute("data-auth-state", "pending")

  const tracer = page.locator(".auth-hero-tracer")
  await expect(tracer).toHaveCSS("animation-name", "auth-frame-trace")

  await page.unroute("**/api/auth/callback/credentials")
})

test("error: credenciales inválidas invierten el marco y no dejan el loop encendido", async ({ page }) => {
  await clearRateLimits()
  try {
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill("nadie@chome.cl")
    await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()

    await expect(page.getByRole("alert")).toBeVisible()

    const form = page.locator("form[data-auth-state]")
    await expect(form).toHaveAttribute("data-auth-state", "error")

    // El trazador de `pending` no debe seguir animando una vez resuelto el intento.
    const tracer = page.locator(".auth-hero-tracer")
    await expect(tracer).toHaveCSS("opacity", "0")
  } finally {
    await clearRateLimits()
  }
})

test.describe("reduced motion — WCAG 2.3.3", () => {
  // `test.use({ reducedMotion })` no está en las opciones de fixture de esta
  // versión de @playwright/test; el precedente del repo (ui-ux-audit-evidence.spec.ts)
  // lo pasa vía `browser.newContext`, así que este describe arma su propio
  // contexto/página en vez de recibir `page` como fixture.
  test("el hero pierde el movimiento pero conserva la señal de color", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    })
    const page = await context.newPage()

    try {
      await clearRateLimits()
      await page.route("**/api/auth/callback/credentials", async (route) => {
        await new Promise((r) => setTimeout(r, 3_000))
        await route.continue()
      })

      await page.goto("/login")
      await page.getByLabel("Correo electrónico", { exact: true }).fill("admin@e2e.chome.cl")
      await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
      await page.getByRole("button", { name: "Ingresar", exact: true }).click()

      await expect(page.locator("form[data-auth-state]")).toHaveAttribute("data-auth-state", "pending")

      const tracer = page.locator(".auth-hero-tracer")
      // Sin movimiento…
      await expect(tracer).toHaveCSS("animation-name", "none")
      // …pero sin perder la señal: la capa de color/opacidad no está gateada
      // por `no-preference` y sigue comunicando el estado.
      await expect(tracer).toHaveCSS("opacity", "1")
    } finally {
      await context.close()
    }
  })
})
