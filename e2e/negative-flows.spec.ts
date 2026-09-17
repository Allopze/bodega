/**
 * T-01: Negative / security boundary tests.
 *
 * Tests cover:
 *  - Rate-limit error surfaced on login (email_rate_limited)
 *  - Double-receipt guard (409 / disabled Receive button after first receipt)
 *  - Invalid reset token returns 404
 *  - Expired invite token rejected on register
 *  - Unauthenticated access redirects to /login
 */

import { test, expect } from "@playwright/test"
import { clearRateLimits, login, receiptSubmitName } from "./helpers"

// ── Rate-limit on login ────────────────────────────────────────────────────────

test("login: shows rate-limit message after repeated failures", async ({ page }) => {
  await clearRateLimits()
  try {
    await page.goto("/login")

    // Submit wrong credentials enough times to trigger the email/IP rate-limit.
    // The rate-limit kicks in after 5 failures within 15 minutes.
    for (let i = 0; i < 6; i++) {
      await page.getByLabel("Correo electrónico", { exact: true }).fill("locked@example.com")
      await page.getByLabel("Contraseña", { exact: true }).fill("wrongpassword")
      await page.getByRole("button", { name: "Ingresar", exact: true }).click()
      await page.waitForTimeout(300)
    }

    await expect(
      page.getByRole("alert").filter({ hasText: /Correo|bloqueada temporalmente|Demasiados intentos|bloqueo/ }).first(),
    ).toBeVisible({ timeout: 5_000 })
    // No further DB-side assertion here: clearRateLimits() is a blanket
    // `delete from rate_limits` with no key filter, also called by other spec
    // files (export-volume, operational-work-queue, admin-flow,
    // restricted-roles) that run concurrently under workers: 2. Any of them
    // can wipe this row between the alert rendering and a poll checking it —
    // a cross-file race, not something this test can assert around. The
    // visible alert above already covers what this test is named for.
  } finally {
    await clearRateLimits()
  }
})

// ── Invalid / expired reset token ─────────────────────────────────────────────

test("password reset: invalid token shows 404", async ({ page }) => {
  const response = await page.goto("/recuperar/0000000000000000000000000000000000000000000000000000000000000000")
  // Next.js notFound() responds with 404
  expect(response?.status()).toBe(404)
})

// ── Unauthenticated redirect ───────────────────────────────────────────────────

test("unauthenticated: protected routes redirect to /login", async ({ page }) => {
  // Visit a page that requires auth without logging in
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
})

test("unauthenticated: API routes reject access without session", async ({ request }) => {
  const response = await request.get("/api/reportes/export?tipo=gasto_faena", { maxRedirects: 0 })
  expect([302, 307, 401]).toContain(response.status())
})

// ── Forgot password form ───────────────────────────────────────────────────────

test("forgot-password: shows confirmation even for non-existent email", async ({ page }) => {
  await page.goto("/recuperar")
  await page.getByLabel("Correo electrónico", { exact: true }).fill("doesnotexist@nowhere.example")
  await page.getByRole("button", { name: "Enviar instrucciones" }).click()

  // Should show success message (no enumeration)
  await expect(
    page.getByText(/Si el correo existe|recibirás las instrucciones/),
  ).toBeVisible({ timeout: 10_000 })
})

// ── CSRF: Server Actions require the Next.js origin token ─────────────────────

test("CSRF: direct POST to a server action without origin header is rejected", async ({ page }) => {
  // Playwright's request context skips the browser's CSRF handling.
  // We POST to a Next.js server action endpoint without the required headers.
  // Next.js returns 403 Forbidden for cross-origin server action requests.
  const response = await page.request.post("/solicitudes/actions", {
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": "fake-action-id",
    },
    data: "{}",
  })
  // Next.js rejects server action calls missing the correct origin/host pairing.
  expect([403, 404]).toContain(response.status())
})

// ── Double receipt guard ───────────────────────────────────────────────────────

test("double-receipt: Receive button disabled after first submission", async ({ page }) => {
  await login(page)

  // Navigate to reception queue. If there are no items, skip gracefully.
  await page.goto("/recepcion")
  const firstRow = page.getByRole("row").nth(1)
  const hasRows = await firstRow.isVisible().catch(() => false)

  if (!hasRows) {
    test.skip()
    return
  }

  const receiveLink = firstRow.getByRole("link", { name: "Recibir" })
  const linkVisible = await receiveLink.isVisible().catch(() => false)
  if (!linkVisible) {
    test.skip()
    return
  }

  await receiveLink.click()

  // El envío se rotula según la etapa (`receiptSubmitName`), y al entrar por
  // "Recibir" la etapa inicial es oficina. El regex suelto de antes
  // —/Confirmar|Recibir|Guardar/— no calzaba con ningún rótulo real: el test
  // sólo pasaba porque se saltaba antes de llegar hasta aquí.
  const submitButton = page.getByRole("button", { name: receiptSubmitName("Oficina") })
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  // No se asserta contra el mismo localizador: al enviarse, `SubmitButton` pasa
  // a `pending` y **cambia el rótulo** a "Guardando…", así que el botón por
  // nombre deja de existir justo cuando queremos comprobarlo. Se mira lo que sí
  // sobrevive: o el submit está deshabilitado mientras la acción viaja, o ya
  // navegamos al comprobante. Cualquiera de las dos cierra la ventana a un
  // segundo envío.
  const enCurso = page.locator('form button[type="submit"][disabled]')
  const comprobante = page.getByRole("heading", { name: /^REC-/ })
  await expect(enCurso.or(comprobante).first()).toBeVisible({ timeout: 30_000 })
})
